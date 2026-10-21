#!/usr/bin/env gamedev-python
"""Render the spec data (design/spec/data/*.yaml) into human-readable tables:

    design/spec/02-economy.md   resources, items by tier (with sprite notes), recipes, buildings
    design/spec/05-research.md  packs, Seminars and staffing, the tech tree by tier, infinite and
                                trigger techs, and pacing against Factorio 2.0

Factorio's reference numbers come from the 2.0.77 dumps in design/round1/E-data
(tech2077.json, techq.json, recipe2077.json). Hand-written sections (change
registers, objections) live in this file as text blocks, so a re-run reproduces
both documents exactly. Edit the YAML, then run:

    gamedev-python tools/render_spec.py            # rewrite 02 and 05
    gamedev-python tools/render_spec.py --check    # write nothing; exit 1 if 02 or 05 is stale
"""
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "design/spec/data"
SPEC = ROOT / "design/spec"
EDATA = ROOT / "design/round1/E-data"

LETTER = {"memo": "R", "report": "G", "proceedings": "M", "article": "B", "preprint": "P", "model-card": "Y",
          "system-card": "W"}
LETTER_ORDER = "RGMBPYW"
COLOR = {"memo": "Red", "report": "Green", "proceedings": "Black", "article": "Blue", "preprint": "Purple",
         "model-card": "Yellow", "system-card": "White"}
FPACK = {"automation-science-pack": "memo", "logistic-science-pack": "report", "military-science-pack": "proceedings",
         "chemical-science-pack": "article", "production-science-pack": "preprint", "utility-science-pack": "model-card",
         "space-science-pack": "system-card"}
MAIN_TIERS = ["memo", "report", "article", "preprint", "model-card", "system-card"]


# ------------------------------------------------------------------ loading and helpers
def load():
    d = {k: yaml.safe_load((DATA / f"{k}.yaml").read_text()) for k in
         ("items", "resources", "recipes", "entities", "technologies", "enemies")}
    for k in ("tiles", "world"):
        p = DATA / f"{k}.yaml"
        d[k] = (yaml.safe_load(p.read_text()) or []) if p.exists() else []
    d["meta"] = yaml.safe_load((DATA / "meta.yaml").read_text())
    for k in ("items", "resources", "recipes", "entities", "technologies", "tiles", "world"):
        d[k + "_by"] = {x["id"]: x for x in d[k]}
    return d


def num(x):
    if isinstance(x, float) and not x.is_integer():
        return f"{x:,.2f}".rstrip("0").rstrip(".")
    return f"{int(round(x)):,}"


def cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ")


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(cell(c) for c in r) + " |" for r in rows]
    return "\n".join(out) + "\n"


def eval_formula(f, L):
    return eval(f.replace("^", "**"), {"__builtins__": {}}, {"L": L})


def unit_count(f, L):
    """A multi-level technology's unit count at level L: the formula's value rounded half up (10 §5.12)."""
    return math.floor(eval_formula(f, L) + 0.5)


class Ctx:
    def __init__(self, d):
        self.d = d
        self.items, self.recipes, self.ents, self.techs = (d["items_by"], d["recipes_by"], d["entities_by"],
                                                           d["technologies_by"])
        self.unlocked_by = defaultdict(list)
        for t in d["technologies"]:
            for r in (t.get("unlocks") or {}).get("recipes") or []:
                self.unlocked_by[r].append(t["id"])
        self.recipe_for = {}
        for r in d["recipes"]:
            for p in r["products"]:
                self.recipe_for.setdefault(p["id"], r)
        self.crafters = defaultdict(list)
        for e in d["entities"]:
            for c in e.get("categories") or []:
                self.crafters[c].append(e["name"])

    def iname(self, i):
        return self.items[i]["name"] if i in self.items else i

    def rname(self, r):
        rec = self.recipes[r]
        return rec.get("name") or self.iname(rec["products"][0]["id"])

    def tname(self, t):
        tech = self.techs[t]
        if "count_formula" not in tech:
            return tech["name"]
        first, last = tech.get("first_level", 1), tech.get("max_level")
        if last == "infinite":
            return f"{tech['name']} {first}+" if first > 1 else tech["name"]
        return f"{tech['name']} {first}–{last}"

    def amounts(self, lst, products=False):
        out = []
        for e in lst:
            s = f"{num(e['amount'])} {self.iname(e['id'])}"
            if products and "probability" in e:
                s = f"{e['probability'] * 100:g}% → {s}"
            if products and e.get("catalyst"):
                s += " (returned)" if e["catalyst"] >= e["amount"] else f" ({num(e['catalyst'])} returned)"
            out.append(s)
        return " + ".join(out)

    def unlock_of_recipe(self, r):
        ts = self.unlocked_by.get(r) or []
        return ", ".join(self.tname(t) for t in ts) or "start"

    def tech_tier(self, t):
        packs = list(((t.get("cost") or {}).get("packs") or {}).keys())
        if not packs:
            return None
        return max(packs, key=lambda p: LETTER_ORDER.index(LETTER[p]) if p != "proceedings" else -1)

    def cost_str(self, t):
        if "trigger" in t:
            return "Trigger: " + trigger_str(self, t["trigger"])
        c = t["cost"]
        letters = "".join(sorted((LETTER[p] for p in c["packs"]), key=LETTER_ORDER.index))
        if "count_formula" in t:
            last = t.get("max_level")
            lv = f"L = {t.get('first_level', 1)}–{last}" if last != "infinite" else f"L ≥ {t.get('first_level', 1)}"
            return f"{t['count_formula']} × {letters} · {num(c['time'])} s ({lv})"
        return f"{num(c['count'])} × {letters} · {num(c['time'])} s"


# ------------------------------------------------------------------ citations (08 §9) and generated tooltips (DECISIONS §34)
MINUS = "−"
AMMO_NAMES = {"bullet": "magazines", "rocket": "rockets", "landmine": "land mines", "laser": "lasers",
              "beam": "laser beams", "electric": "discharge", "arc": "arcs", "artillery-shell": "artillery shells"}


def surname(a):
    return a.split(",")[0].strip()


def short_cite(c):
    names = [surname(a) for a in c["authors"]]
    if c.get("more_authors") or len(names) >= 5:
        who = f"{names[0]} et al."
    elif len(names) == 1:
        who = names[0]
    else:
        who = ", ".join(names[:-1]) + " & " + names[-1]
    return f"{who}, {c['year']}"


def short_citation(t):
    cs = sorted(t.get("citation") or [], key=lambda c: c["year"])
    return "(" + "; ".join(short_cite(c) for c in cs) + ")" if cs else ""


def long_cite(c):
    a = list(c["authors"])
    if len(a) == 1:
        who = a[0]
    elif c.get("more_authors"):
        who = ", ".join(a) + ", et al."
    else:
        who = ", ".join(a[:-1]) + ", & " + a[-1]
    if c.get("role") == "editor":
        who += " (Ed.)."
    title = c["title"] if c["title"][-1] in "?!." else c["title"] + "."
    out = f"{who} ({c['year']}). {title}"
    if c.get("venue"):
        out += f" {c['venue']}."
    if c.get("url"):
        out += f" {c['url']}"
    return out


def signed_pct(v):
    s = f"{abs(v) * 100:g}%"
    return ("+" if v >= 0 else MINUS) + s


def effect_lines(ctx, t):
    """The generated effect lines of a technology (meta.effects.<type>.line), merged as Factorio merges them."""
    effects = ctx.d["meta"]["effects"]
    r_default = ctx.d["meta"]["world_settings"]["returns_to_research"]
    m_default = r_default["g"] ** r_default["default"]
    lines = []
    for ef in (t.get("unlocks") or {}).get("effects") or []:
        tpl = (effects.get(ef["type"]) or {}).get("line", ef["type"])
        v = ef.get("value")
        if "multiplier_from" in ef:
            mult = f"×{m_default:.3g} (default setting)"
        else:
            mult = f"×{ef['multiplier']:g}" if "multiplier" in ef else ""
        f = dict(
            pct=signed_pct(v) if isinstance(v, (int, float)) else "",
            n=(f"+{v:g}" if v >= 0 else f"{MINUS}{abs(v):g}") if isinstance(v, (int, float)) else "",
            mult=mult,
            amount=signed_pct(v) if isinstance(v, (int, float)) else mult,
            fraction=f"{ef['fraction'] * 100:g}%" if "fraction" in ef else "",
            category=AMMO_NAMES.get(ef.get("category"), ef.get("category", "")),
            turret=(ctx.ents.get(ef.get("turret")) or {}).get("name", "").lower() if ef.get("turret") else "",
            recipes=", ".join(ctx.rname(r) for r in ef.get("recipes") or []),
            entities=join_and([ctx.ents[e]["name"] for e in ef.get("entities") or []]),
            quality=next((q["name"] for q in ctx.d["meta"]["quality"]["tiers"] if q["id"] == ef.get("quality")), ""),
            output=signed_pct(ef["output"]) if "output" in ef else "",
            energy=signed_pct(ef["energy"]) if "energy" in ef else "")
        line = tpl.format(**f)
        lines.append(line[0].upper() + line[1:])
    merged = []
    for line in lines:
        head, sep, tail = line.partition(": ")
        if sep and merged and merged[-1].startswith(head + ": ") and head in ("Damage", "Fire rate", "Quality tier"):
            merged[-1] += ", " + tail
            if head == "Quality tier":
                merged[-1] = merged[-1].replace("Quality tier: ", "Quality tiers: ", 1)
        else:
            merged.append(line)
    return merged


def join_and(names):
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def unlock_names(ctx, t):
    names, containers = [], []
    for r in (t.get("unlocks") or {}).get("recipes") or []:
        rec = ctx.recipes[r]
        if rec.get("container"):
            kind = "drives" if any(i["id"] == "drive" for i in rec["ingredients"] + rec["products"]) else "barrels"
            if kind not in containers:
                containers.append(kind)
            continue
        names.append(ctx.rname(r))
    names += [f"filling and emptying {k}" for k in containers]
    return names


def tooltip(ctx, t):
    """Definition clause, unlocks, effect lines, note, short citation: the technology tooltip (08 §5.1, §9.1)."""
    parts = []
    if t.get("desc"):
        parts.append(t["desc"])
    un = unlock_names(ctx, t)
    if un:
        parts.append("Unlocks: " + ", ".join(un) + ".")
    parts += [line + "." for line in effect_lines(ctx, t)]
    if t.get("note"):
        parts.append(t["note"])
    if t.get("citation"):
        parts.append(short_citation(t))
    return " ".join(parts)


def tech_year(t):
    return max((c["year"] for c in t.get("citation") or []), default=None)



def trigger_str(ctx, trig):
    ty = trig["type"]
    if ty == "start":
        return "researched at start"
    if ty == "craft-item":
        return f"craft {trig.get('count', 1)} {ctx.iname(trig['item'])}"
    if ty == "mine-entity":
        res = ctx.d["resources_by"].get(trig["entity"])
        return f"mine {ctx.iname(res['yields']) if res else trig['entity']}"
    if ty == "launch":
        return f"complete a frontier run carrying a {ctx.iname(trig['item'])}"
    if ty == "craft-recipe":
        n = trig.get("count", 1)
        return f"complete {n} {ctx.rname(trig['recipe'])} craft{'' if n == 1 else 's'}"
    return f"{ty} {trig.get('item') or trig.get('entity') or ''}"


# ------------------------------------------------------------------ raw cost (same method for both games)
def raw_cost_fn(recipes, raw, prefer=None):
    """recipes: list of {id, ingredients:[{id,amount}], products:[{id,amount,probability}]}.
    First recipe per product (or the preferred one); net of returned ingredients; byproducts ignored."""
    maker = {}
    for r in recipes:
        for p in r["products"]:
            maker.setdefault(p["id"], r)
    for item, rid in (prefer or {}).items():
        maker[item] = next(r for r in recipes if r["id"] == rid)
    memo = {}

    def cost(item, stack=()):
        if item in raw:
            return Counter({item: 1.0})
        if item in memo:
            return memo[item]
        if item in stack or item not in maker:
            return Counter({f"?{item}": 1.0})
        r = maker[item]
        out, ins = Counter(), Counter()
        for p in r["products"]:
            out[p["id"]] += p["amount"] * p.get("probability", 1.0)
        for i in r["ingredients"]:
            ins[i["id"]] += i["amount"]
        n = out[item] - ins.get(item, 0)
        total = Counter()
        for ing, amount in ins.items():
            net = amount - out.get(ing, 0)
            if ing == item or net <= 0:
                continue
            for k, v in cost(ing, stack + (item,)).items():
                total[k] += v * net / n
        memo[item] = total
        return total

    return cost


def factorio_recipes():
    out = []
    for r in json.loads((EDATA / "recipe2077.json").read_text()):
        name = r["name"]
        if r.get("parameter") or name.endswith("-barrel") or "recycling" in name:
            continue
        ins = [{"id": i["name"], "amount": i["amount"]} for i in r.get("ingredients") or []]
        prods = []
        for p in r.get("results") or []:
            amt = p.get("amount", (p.get("amount_min", 0) + p.get("amount_max", 0)) / 2)
            d = {"id": p["name"], "amount": amt}
            if "probability" in p:
                d["probability"] = p["probability"]
            prods.append(d)
        out.append({"id": name, "ingredients": ins, "products": prods})
    return out


def factorio_techs():
    techs = json.loads((EDATA / "tech2077.json").read_text()) + json.loads((EDATA / "techq.json").read_text())
    return {t["name"]: t for t in techs if t.get("type") == "technology"}


F_RAW = {"iron-ore", "copper-ore", "coal", "stone", "water", "crude-oil", "uranium-ore", "wood"}
F_PREFER = {"petroleum-gas": "basic-oil-processing", "heavy-oil": "advanced-oil-processing",
            "light-oil": "advanced-oil-processing", "solid-fuel": "solid-fuel-from-light-oil"}


def factorio_pack_costs():
    recs = factorio_recipes()
    cost = raw_cost_fn(recs, F_RAW, F_PREFER)
    out = {}
    for fp, ours in FPACK.items():
        if fp == "space-science-pack":
            c = Counter()
            for k, v in cost("rocket-part").items():
                c[k] += v * 100
            for k, v in cost("satellite").items():
                c[k] += v
            out[ours] = Counter({k: v / 1000 for k, v in c.items()})
        else:
            out[ours] = cost(fp)
    return out


def our_recipes(ctx):
    return [{"id": r["id"], "ingredients": r["ingredients"], "products": r["products"]} for r in ctx.d["recipes"]]


def our_pack_costs(ctx, sig_runs=None):
    recs = our_recipes(ctx)
    raw = {res["yields"] for res in ctx.d["resources"]}
    if sig_runs is not None:  # significant results at a steady state of the experiment loop
        recs = [r for r in recs if r["id"] != "analysis"]
        recs.insert(0, {"id": "sig-virtual", "products": [{"id": "significant-result", "amount": 1}],
                        "ingredients": [{"id": "benchmark", "amount": sig_runs},
                                        {"id": "drive", "amount": sig_runs * 0.02}]})
    cost = raw_cost_fn(recs, raw)
    return {p: cost(p) for p in ctx.d["meta"]["tiers"]}


def fmt_cost(c, keys):
    return [f"{c.get(k, 0):.1f}" if c.get(k, 0) else "–" for k in keys]


# ------------------------------------------------------------------ research statistics
def closure(techs, tid, key="prerequisites"):
    out, stack = set(), [tid]
    while stack:
        t = stack.pop()
        for p in techs[t].get(key) or []:
            if p in techs and p not in out:
                out.add(p)
                stack.append(p)
    return out


def our_tech_units(t):
    """[(count, time, packs)] per level for finite techs; None for infinite."""
    if "trigger" in t:
        return []
    c = t["cost"]
    if "count_formula" in t:
        if t.get("max_level") == "infinite":
            return None
        return [(unit_count(t["count_formula"], L), c["time"], c["packs"])
                for L in range(t.get("first_level", 1), t["max_level"] + 1)]
    return [(c["count"], c["time"], c["packs"])]


def factorio_tech_units(t):
    u = t.get("unit")
    if not u:
        return []
    if t.get("max_level") == "infinite":
        return None
    packs = {FPACK[i[0]]: i[1] for i in u["ingredients"]}
    if "count" in u:
        return [(u["count"], u["time"], packs)]
    return None


def tier_key(packs):
    letters = [LETTER[p] for p in packs]
    main = [l for l in letters if l != "M"]
    top = max(main, key=LETTER_ORDER.index) if main else "R"
    return top + ("+M" if "M" in letters else "")


def research_stats(units_fn, techs):
    """Packs and lab-seconds of finite research, by tier key (highest main pack, '+M' if it costs Proceedings)."""
    packs, labsec, ntech, by_tier = Counter(), Counter(), Counter(), defaultdict(Counter)
    infinite = triggers = 0
    for t in techs.values():
        u = units_fn(t)
        if u is None:
            infinite += 1
            continue
        if not u:
            triggers += 1
            continue
        key = tier_key(u[0][2])
        ntech[key] += 1
        for count, time, pk in u:
            labsec[key] += count * time
            for p, n in pk.items():
                packs[p] += count * n
                by_tier[key][p] += count * n
    return packs, labsec, ntech, infinite, triggers, by_tier


def path_stats(units_fn, techs, target):
    cl = closure(techs, target)
    packs, labsec, n = Counter(), 0, 0
    for tid in cl:
        u = units_fn(techs[tid]) or []
        if u:
            n += 1
        for count, time, pk in u:
            labsec += count * time
            for p, k in pk.items():
                packs[p] += count * k
    return len(cl), n, packs, labsec


def takeoff_order(ctx):
    """meta.endgame.takeoff_order as (technology id, level or None) pairs: the order Research scheduling follows
    (R5-gate D10; 04 §5.1)."""
    return [(e, None) if isinstance(e, str) else next(iter(e.items())) for e in ctx.d["meta"]["endgame"]["takeoff_order"]]


def hardware_slots(ctx):
    """Each takeoff hardware technology with the Model generation level it follows in the takeoff order."""
    out, lv = [], None
    for tid, level in takeoff_order(ctx):
        if tid == "model-generation":
            lv = level
        elif tid != "model-generation-25" and "count_formula" not in ctx.techs[tid]:
            out.append((tid, lv))
    return out


def returns_presets(ctx):
    """(r, label) for each Returns-to-research preset; the default r is ln 2 / ln 1.5, shown as 1.71 (R5-gate D12b)."""
    rtr = ctx.d["meta"]["world_settings"]["returns_to_research"]
    return list(zip(rtr["options"], rtr.get("labels") or [f"{r:g}" for r in rtr["options"]]))


def default_returns(ctx):
    rtr = ctx.d["meta"]["world_settings"]["returns_to_research"]
    return rtr["default"], dict(returns_presets(ctx))[rtr["default"]]


def takeoff_cards(ctx, r):
    """System cards actually consumed by Model generation 6–25 and the takeoff hardware, at returns r (G)."""
    mg, mg25 = ctx.techs["model-generation"], ctx.techs["model-generation-25"]
    m = ctx.d["meta"]["world_settings"]["returns_to_research"]["g"] ** r
    first, last = mg["first_level"], mg["max_level"]
    total = sum(unit_count(mg["count_formula"], L) / m ** (L - first) for L in range(first, last + 1))
    total += mg25["cost"]["count"] / m ** (last + 1 - first)
    hwc = sum(ctx.techs[t]["cost"]["count"] / m ** (lv - 5) for t, lv in hardware_slots(ctx))
    return total, hwc


# ------------------------------------------------------------------ 02-economy
BUILDING_GROUPS = [
    ("Mining and extraction", ["burner-mining-drill", "electric-mining-drill", "offshore-pump", "crawler"]),
    ("Smelting and transcription", ["stone-furnace", "steel-furnace", "electric-furnace", "keypunch", "tokenizer"]),
    ("Assembly and chemistry", ["assembling-machine-1", "assembling-machine-2", "assembling-machine-3", "chemical-plant",
                                "centrifuge", "verifier"]),
    ("Data and training", ["data-refinery", "data-plant", "trainer", "switch", "endpoint"]),
    ("Research", ["seminar", "terminal", "research-hall", "frontier-cluster"]),
    ("Power", ["boiler", "steam-engine", "solar-panel", "accumulator", "nuclear-reactor", "heat-pipe", "heat-exchanger",
               "steam-turbine", "fusion-reactor", "fusion-generator", "small-electric-pole", "medium-electric-pole",
               "big-electric-pole", "substation"]),
    ("Cooling", ["cooling-tower", "dry-cooler", "water-exchanger"]),
    ("Belts and inserters", ["transport-belt", "fast-transport-belt", "express-transport-belt", "underground-belt",
                             "fast-underground-belt", "express-underground-belt", "splitter", "fast-splitter",
                             "express-splitter", "burner-inserter", "inserter", "long-handed-inserter", "fast-inserter",
                             "bulk-inserter"]),
    ("Storage and agents", ["wooden-chest", "iron-chest", "steel-chest", "active-provider-chest", "passive-provider-chest",
                            "storage-chest", "buffer-chest", "requester-chest", "agent-hub"]),
    ("Pipes and data lines", ["pipe", "pipe-to-ground", "pump", "storage-tank", "data-line", "underground-line",
                              "repeater", "data-lake"]),
    ("Rail and vehicles", ["rail", "train-stop", "rail-signal", "rail-chain-signal", "locomotive", "cargo-wagon",
                           "fluid-wagon", "data-wagon", "car", "half-track", "legged-agent", "artillery-wagon"]),
    ("Circuits and control", ["decider-combinator", "arithmetic-combinator", "constant-combinator", "selector-combinator",
                              "power-switch", "programmable-speaker", "display-panel", "small-lamp", "radar",
                              "area-scanner", "deployer"]),
    ("Containment and the Wild line", ["monitor", "fence", "gate", "gun-turret", "laser-turret", "arc-turret",
                                       "artillery-turret", "interceptor-bay", "land-mine"]),
]


def energy_str(e):
    en = e.get("energy") or {}
    src, kw = en.get("source"), en.get("kw", 0)
    tag = {"electric": "", "burner": " fuel", "heat": " heat"}.get(src, "")
    if en.get("per_movement_kj") and not kw:
        return f"{en['per_movement_kj']:g} kJ per move{tag}"
    if src in (None, "none") or not kw:
        return "–"
    p = f"{kw / 1000:g} MW" if kw >= 1000 else f"{kw:g} kW"
    if en.get("priority") == "interruptible":
        tag += ", interruptible"
    if en.get("priority") == "lamp":
        tag += ", while lit"
    if en.get("drain_kw"):
        tag += f" (drain {en['drain_kw']:g} kW)"
    return p + tag


def heat_str(e):
    h = e.get("heat") or {}
    if "class" in h:
        txt = f"{h['class']} (T* {CLASS_T[h['class']]} °C)"
        return txt + (", with a Researcher" if h.get("while") == "researcher" else "")
    if h.get("emission") == "twice-output":
        return "2 × electrical output"
    if h.get("emission") == "none":
        return "none" + (" (waste heat only)" if h.get("waste_heat") else "")
    if "removes_kw" in h:
        return f"removes {h['removes_kw'] / 1000:g} MW"
    en = e.get("energy") or {}
    if en.get("source") in (None, "none") or not (en.get("kw") or en.get("per_movement_kj")):
        return "–"
    return "draw"


CLASS_T = {}

EXTRA_KEYS = ["items_per_s", "max_gap", "slots", "capacity", "wire_reach", "supply_area_distance", "pumping_per_s",
              "steam_per_s", "water_per_s", "temp_c", "min_temperature_c", "max_temperature_c", "max_kw", "peak_kw",
              "capacity_mj", "flow_kw", "heat_mw", "neighbor_bonus", "range", "health", "clean_interval_s",
              "accelerator_slots", "weights_slots", "plasma_per_s", "plasma_mw", "electric_kw", "distribution_efficiency",
              "profile", "sector_range_chunks", "nearby_range_chunks", "energy_per_sector_mj", "energy_per_nearby_scan_kj",
              "parts_required", "payloads", "empty_launch", "dispatch_radius", "returns"]


def extra_str(e):
    x = e.get("extra") or {}
    parts = [f"{k}={x[k]}" if not isinstance(x[k], list) else f"{k}={', '.join(map(str, x[k]))}"
             for k in EXTRA_KEYS if k in x and not isinstance(x[k], dict)]
    if e.get("staff_slots"):
        parts.append(f"staff slot {e['staff_slots']}, demand {e.get('staff_demand', 1)}")
    if e.get("deploys"):
        parts.append("deploys")
    if e.get("consumes"):
        parts.append("uses " + ", ".join(e["consumes"]))
    if e.get("produces"):
        parts.append("makes " + ", ".join(e["produces"]))
    if e.get("placement"):
        parts += [f"{k.replace('_', ' ')} {v}" for k, v in e["placement"].items()]
    if e.get("allowed_effects"):
        parts.append("modules: " + ", ".join(e["allowed_effects"]) + " only")
    if e.get("effect_receiver"):
        parts.append("no module or Switch effects")
    if e["id"] == "research-hall":
        parts.append("tiers " + "; ".join(f"{t['item']}: speed {t['speed']} at {t['kw'] / 1000:g} MW" for t in x["tiers"]))
    return "; ".join(parts) or "–"


def speed_str(e):
    for k, lab in (("crafting_speed", ""), ("mining_speed", "mine ")):
        if e.get(k) is not None:
            return f"{lab}{e[k]:g}"
    return "–"


def render_economy(ctx):
    d, meta = ctx.d, ctx.d["meta"]
    CLASS_T.update(meta["heat"]["classes"])
    out = []
    w = out.append
    n_items = sum(1 for i in d["items"] if i["type"] == "item")
    n_fluids = sum(1 for i in d["items"] if i["type"] == "fluid")
    n_build = sum(1 for i in d["items"] if i.get("places"))
    w("# 02 — The economy\n")
    w("*Generated by `tools/render_spec.py` from `design/spec/data/*.yaml` (R2-D, round 2; R4-data, round 4). Edit the "
      "YAML and re-run; do not edit this file by hand. Sections marked (hand-written) come from text blocks in the "
      "renderer.*\n")
    w("## 0. Summary\n")
    w(f"- **{n_items} items and {n_fluids} fluids** ({n_build} of the items place buildings), "
      f"**{len(d['resources'])} resources**, **{len(d['recipes'])} recipes**, **{len(d['entities'])} entities**, "
      f"**{sum(1 for t in d['technologies'] if not t.get('hidden'))} technologies** (plus "
      f"{sum(1 for t in d['technologies'] if t.get('hidden'))} hidden; see `05-research.md`) and "
      f"**{len(d['enemies'])} runaway prototypes** (`enemies.yaml`).\n")
    w(ECONOMY_SUMMARY)
    # 1 resources
    w("## 1. Resources\n")
    rows = []
    patches = ((meta.get("world") or {}).get("patches") or {}).get("resources") or {}
    spread = ((meta.get("world") or {}).get("patches") or {}).get("start_amount_spread")
    for r in d["resources"]:
        fin = "infinite, decays to a floor" if r.get("infinite") else ("infinite" if r["kind"] == "offshore" else "finite")
        mt = r.get("mining_time", "–")
        where = r.get("autoplace", "")
        p = patches.get(r["id"])
        if p:   # the typed numbers of meta.world.patches (01 §4)
            st = p.get("start")
            nums = ([f"starting patch {num(st['amount'])}" + (f" ±{spread:.0%}" if spread else "")
                     + f", {num(st['per_tile'])} per tile"] if st else [])
            nums.append(f"patches: {num(p['cell_tiles'])}-tile cells at p {p['probability']:g}, r₀ {p['radius_tiles']:g}, "
                        f"{num(p['per_tile'])} per tile" + (f", none within {num(p['not_within_tiles'])} tiles of spawn"
                                                            if p.get("not_within_tiles") else ""))
            where += " *(" + "; ".join(nums) + ")*"
        rows.append([f"**{r['name']}** `{r['id']}`", r["kind"], ctx.iname(r["yields"]), mt,
                     fin + (f"; needs {ctx.iname(r['requires_fluid'])}" if r.get("requires_fluid") else ""),
                     where, r.get("mirrors", "")])
    w(table(["Resource", "Kind", "Yields", "Mining time", "Finite?", "Where it spawns", "Mirrors"], rows))
    # 2 items by tier
    w("\n## 2. Items and fluids by tier\n")
    w("The tier is the science tier in which an item first matters. Sprite lines are 32 px legibility notes; "
      "`ISO` means Factorio's icon, recoloured where the line says so. Building items are listed in §4.\n")
    for tier in meta["tiers"]:
        rows = []
        for it in d["items"]:
            if it.get("tier") != tier or it.get("places"):
                continue
            stack = it.get("stack", "fluid")
            extra = []
            if it.get("fuel_value"):
                extra.append(f"fuel {num(it['fuel_value'])} MJ")
            if it.get("module"):
                extra.append(", ".join(f"{k} {v * 100:+g}%" for k, v in it["module"].items()))
            if it.get("spoil"):
                extra.append(f"spoils into {ctx.iname(it['spoil']['into'])} after {it['spoil']['ticks'] // 3600} min "
                             f"({it['spoil']['setting']} only)")
            rows.append([f"**{it['name']}** `{it['id']}`", stack, it.get("mirrors", ""), it.get("sprite", ""),
                         it.get("desc", "") + (f" *({'; '.join(extra)})*" if extra else "")])
        w(f"\n### {COLOR[tier]}: {ctx.iname(tier)} tier ({len(rows)})\n")
        w(table(["Item", "Stack", "Mirrors", "Sprite (32 px)", "Tooltip"], rows))
    # 3 recipes
    w("\n## 3. Recipes\n")
    w("Grouped by crafting category. *Unlocked by* names the technology (`start` = Prior art, researched when the game "
      "begins). Times are at crafting speed 1. Container fills are listed together at the end.\n")
    by_cat = defaultdict(list)
    for r in d["recipes"]:
        if r.get("container"):
            continue
        by_cat[r["category"]].append(r)
    for cat in meta["crafting_categories"]:
        rs = by_cat.get(cat)
        if not rs:
            continue
        makers = ", ".join(ctx.crafters.get(cat, [])) or "–"
        if cat == "crafting":
            makers = "hand, " + makers
        w(f"\n### {cat} — {makers}\n")
        rows = []
        for r in rs:
            flags = []
            if r.get("pseudo"):
                flags.append("pseudo-recipe")
            if r.get("victory"):
                flags.append("victory")
            if r.get("note"):
                flags.append(r["note"])
            rows.append([f"**{ctx.rname(r['id'])}** `{r['id']}`", ctx.amounts(r["ingredients"]),
                         ctx.amounts(r["products"], True), num(r["time"]), ctx.unlock_of_recipe(r["id"]),
                         (r.get("mirrors") or "") + (f" *({'; '.join(flags)})*" if flags else "")])
        w(table(["Recipe", "Ingredients", "Products", "Time (s)", "Unlocked by", "Mirrors / notes"], rows))
    rows = [[f"`{r['id']}`", ctx.amounts(r["ingredients"]), ctx.amounts(r["products"], True), num(r["time"]),
             ctx.unlock_of_recipe(r["id"])] for r in d["recipes"] if r.get("container")]
    w("\n### Container fills (assembling machines 2–3)\n")
    w(table(["Recipe", "Ingredients", "Products", "Time (s)", "Unlocked by"], rows))
    # 4 buildings
    w("\n## 4. Buildings\n")
    w("Energy is the active draw, with the ISO drain where there is one (burner draws are fuel burn, 3× Factorio's: "
      "DECISIONS §18). Heat: a computing class with its throttle limit T*, or how the building emits (DECISIONS §24: "
      "generators emit 2 × their electrical output, boilers and reactors nothing for the conversion); every other machine "
      "emits its draw (`draw`). Speed is crafting, research or mining speed. The tooltip column is the description, "
      "where a building has one (about one in five: DECISIONS §34).\n")
    listed = set()
    for title, ids in BUILDING_GROUPS:
        rows = []
        for eid in ids:
            e = ctx.ents[eid]
            listed.add(eid)
            rec = ctx.recipes.get(eid)
            rtxt = f"{ctx.amounts(rec['ingredients'])} ({num(rec['time'])} s)" if rec else "–"
            tip = e.get("desc", "") + (f" *Handbook: {e['handbook_note']}*" if e.get("handbook_note") else "")
            rows.append([f"**{e['name']}** `{eid}`", "×".join(map(str, e["size"])), energy_str(e), speed_str(e),
                         e.get("module_slots", "–") if e.get("module_slots") else "–", heat_str(e), extra_str(e),
                         rtxt, ctx.unlock_of_recipe(eid), e.get("mirrors", ""), tip or "–"])
        w(f"\n### {title}\n")
        w(table(["Building", "Size", "Energy", "Speed", "Modules", "Heat", "Key numbers", "Recipe (time)",
                 "Unlocked by", "Mirrors", "Tooltip"], rows))
    missing = [e["id"] for e in d["entities"] if e["id"] not in listed]
    assert not missing, f"buildings not grouped: {missing}"
    w("\n### Building sprites\n")
    rows = [[ctx.ents[i["places"]]["name"], i["sprite"]] for i in d["items"] if i.get("places")]
    w(table(["Building", "Sprite (icon and entity)"], rows))
    # 5 heat
    w("\n## 5. Heat, cooling and power (summary of `meta.heat`; mechanics in 03-pressure)\n")
    h = meta["heat"]
    rows = []
    for cls, tmax in h["classes"].items():
        members = [e["name"] + (" (with a Researcher in its staff slot)" if (e.get("heat") or {}).get("while") == "researcher" else "")
                   for e in d["entities"] if (e.get("heat") or {}).get("class") == cls]
        rows.append([cls, f"{tmax} °C", f"{tmax + h['liquid_cooled_bonus_k']} °C", ", ".join(members) or "none"])
    w(table(["Class", "T*", "T* liquid-cooled", "Buildings"], rows))
    em = h["emission"]
    w(f"\n- **Emission (DECISIONS §24):** {em['default']} *Twice-output:* {em['twice-output']} *None:* {em['none']} "
      f"*Waste heat:* {em['waste_heat']} {em['solar_and_storage']}\n- **Thermal efficiency:** {h['thermal_efficiency']}\n"
      f"- **Throttle:** {h['throttle']['formula']} (span {h['throttle']['span_k']} K, floor {h['throttle']['floor']}); "
      f"applies to {h['throttle']['applies_to']}; power draw {h['throttle']['power_draw']}.\n"
      f"- **Coolant loop:** machines take coolant at ≤ {h['coolant']['machine_takes_at_or_below_c']} °C and return it "
      f"at {h['coolant']['machine_returns_c']} °C; coolers take it at ≥ {h['coolant']['cooler_takes_at_or_above_c']} °C "
      f"and return it at {h['coolant']['cooler_returns_c']} °C; {h['coolant']['mj_per_unit']} unit carries 1 MJ. "
      f"Liquid share 70% after Liquid cooling, 90% after Immersion cooling. {h['coolant']['filter_rule']}\n"
      f"- **Interruptible power (G):** {', '.join(ctx.ents[i]['name'] if i in ctx.ents else ctx.iname(i) for i in h['interruptible_power'])}.\n"
      f"- **Ground:** κ per tile from `tiles.yaml` (§10), plus {h['loss']['per_tree_per_s']:g} s⁻¹ per healthy tree; "
      f"trees lose a leaf stage every {h['loss']['leaf_stage_s']} s above {h['tree_damage_c']} °C.\n")
    # 6 quality
    q = meta["quality"]
    w("\n## 6. Quality (Space Age's model, with a verifier ladder)\n")
    w(table(["Tier", "Level", "Unlocked by"],
            [[t["name"], t["level"], ctx.tname(t["unlocked_by"]) if t.get("unlocked_by") else "start"] for t in q["tiers"]]))
    w(f"\n- **Module:** the Comparator 1–3 ({', '.join(f'{ctx.iname(c)}: quality +{ctx.items[c]['module']['quality'] * 100:g}%' for c in ('comparator', 'comparator-2', 'comparator-3'))}; speed −5% each). "
      f"Coprocessors carry Factorio 2.0's quality penalty ({', '.join(signed_pct(ctx.items[c]['module']['quality']) for c in ('coprocessor', 'coprocessor-2', 'coprocessor-3'))}).\n"
      f"- **Rolls:** {q['model']}. Next-tier chance {q['next_tier_chance']:.0%}; stats +{q['stat_bonus_per_level']:.0%} per level "
      f"({q['entity_stats']}); the Verifier returns {q['recycle_return']:.0%}.\n- **Verifier rule (A's adopt list, impl L5):** {q['verifier_rule']}\n"
      f"- **Catalysts:** {q['catalysts']} **Recipe quality:** {q['recipe_quality']}\n"
      f"- **Productivity (DECISIONS §30):** {sum(1 for r in d['recipes'] if r.get('allow_productivity'))} recipes allow it "
      f"(`allow_productivity`): the mirrors of Factorio 2.0's 42 eligible recipes plus the experiment loop. Learned "
      f"controllers and productivity research apply to these only.\n")
    # 7 experiment loop
    w(EXPERIMENT_SECTION.format(**experiment_numbers(ctx)))
    # 8 deployment
    w(DEPLOYMENT_SECTION)
    # 9 changes
    w(ECONOMY_CHANGES)
    # 10 tiles, world objects, salvage
    w(world_section(ctx))
    w(render_objections("02", ctx))
    return "\n".join(out)


def world_section(ctx):
    d = ctx.d
    rows = [[f"**{t['name']}** `{t['id']}`", t["kappa_per_s"] if t["kappa_per_s"] is not None else "–",
             "yes" if t["buildable"] else "no", t["walking_speed"] if t["walking_speed"] is not None else "blocks",
             ctx.iname(t["placed_by"]) if t.get("placed_by") else "–", "yes" if t.get("minable_back") else "no",
             ", ".join(t.get("biome") or []) or ("town" if t.get("town") else "–")] for t in d["tiles"]]
    tiles = table(["Tile", "κ (s⁻¹)", "Buildable", "Walking speed", "Placed by", "Mined back", "Biome"], rows)
    rows = []
    for o in d["world"]:
        y = ", ".join(f"{a if not isinstance(a, list) else f'{a[0]}–{a[1]}'} {ctx.iname(i)}" for i, a in (o.get("yields") or {}).items())
        rows.append([f"**{o['name']}** `{o['id']}`", o["kind"], "×".join(map(str, o["size"])), o.get("mining_time", "–"),
                     y or "–", o.get("note", "")])
    world = table(["Object", "Kind", "Size", "Mining time (s)", "Yields", "Notes"], rows)
    sal = d["meta"]["start"]["salvage"]
    crate = ", ".join(f"{n} {ctx.iname(i)}" for i, n in sal["crate"].items())
    piece = ", ".join(f"{n} {ctx.iname(i)}" for i, n in sal["per_piece"].items())
    return f"""
## 10. Tiles, world objects and the salvage

**Tiles** (`tiles.yaml`, impl B3). κ is 03 §1.2's Newton-cooling coefficient; a chunk's κ is the mean of its 1,024 tiles plus its trees. Walking speeds are Factorio 2.0's. Items place the concretes and landfill (`places_tile`).

{tiles}
**World objects** (`world.yaml`, impl J9): what worldgen places and the character mines or clicks but never builds. Rocks yield Quartz where Factorio's yield stone. Town buildings are `town-block` tiles.

{world}
**The {sal['name']}** (`meta.start.salvage`, DECISIONS §33; 01 §9): within {sal['within_tiles']} tiles of spawn, {sal['wreck_pieces']} wreck pieces ({piece} each) and one crate ({crate}), each mined by hand in {sal['mining_time']} s. Description: "{sal['desc']}" Handbook: "{sal['handbook_note']}" The radar is the salvage's one assembled machine; no crafted item claims to be surplus.
"""


def experiment_numbers(ctx):
    rec = ctx.recipes
    t_exp, t_an, t_meta = rec["experiment"]["time"], rec["analysis"]["time"], rec["meta-analysis"]["time"]
    p_sig, p_null = 0.05, 0.95
    per_run_meta = p_sig + p_null / 3          # Kovarex: 3 nulls become 1 significant result
    runs_meta, runs_plain = 1 / per_run_meta, 1 / p_sig
    art_per_s = 1.0                            # 60 Articles per minute
    sig_per_s = art_per_s / 2
    r_meta, r_plain = sig_per_s * runs_meta, sig_per_s * runs_plain
    return dict(
        t_exp=num(t_exp), t_an=num(t_an), t_meta=num(t_meta),
        runs_meta=f"{runs_meta:.2f}", runs_plain=f"{runs_plain:.0f}",
        an_meta=f"{r_meta * t_an:.1f}", an_plain=f"{r_plain * t_an:.0f}",
        meta_m=f"{r_meta * p_null / 3 * t_meta:.1f}", exp_meta=f"{r_meta * t_exp:.1f}", exp_plain=f"{r_plain * t_exp:.0f}",
        bench_meta=f"{r_meta:.2f}", bench_plain=f"{r_plain:.0f}", bench_d="0.5",
        prose_meta=f"{r_meta * 15:.0f}", prose_plain=f"{r_plain * 15:.0f}",
        boot_runs=f"{40 / p_sig:.0f}", boot_trainer_h=f"{(40 / p_sig) * t_an / 3600:.1f}")


# ------------------------------------------------------------------ 05-research
def render_research(ctx):
    d, meta = ctx.d, ctx.d["meta"]
    techs = ctx.techs
    out = []
    w = out.append
    trig = sorted((t for t in d["technologies"] if "trigger" in t), key=lambda t: t.get("code", ""))
    hidden = [t for t in d["technologies"] if t.get("hidden")]
    multi = [t for t in d["technologies"] if "count_formula" in t]
    inf = [t for t in multi if t.get("max_level") == "infinite"]
    finite = [t for t in d["technologies"] if "cost" in t and "count_formula" not in t]
    waves = playthrough_waves()
    w("# 05 — Research\n")
    w("*Generated by `tools/render_spec.py` from `design/spec/data/technologies.yaml` and friends (R2-D, round 2; "
      "R4-data, round 4). Edit the YAML and re-run. Sections marked (hand-written) come from text blocks in the "
      "renderer.*\n")
    w("## 0. Summary\n")
    errs, warns = validator_counts()
    reg = Counter(t.get("regime") for t in d["technologies"] if not t.get("hidden"))
    w(f"- **{len(d['technologies']) - len(hidden)} technologies:** {len(trig) - len(hidden)} by trigger (one of them, "
      f"*Prior art*, researched at start), {len(finite)} finite single-level, {len(multi) - len(inf)} finite multi-level "
      f"(*Model generation* 6–24) and {len(inf)} infinite. E's tree had 240; §8 lists the 11 added and the 1 dropped."
      + (f" Besides them, {len(hidden)} hidden trigger technology: "
         + ", ".join(f"*{t['name']}* (`{t['id']}`)" for t in hidden)
         + ", the closure event, which every technology paid in System cards alone waits for (§3, §6; R5-gate D9)."
         if hidden else "") + "\n"
      f"- **Regimes (DECISIONS §35):** {reg['cited']} cited, {reg['infrastructure']} infrastructure, {reg['beyond']} beyond the "
      f"literature; {sum(len(t.get('citation') or []) for t in d['technologies'])} citation entries. Literature by era:\n\n"
      + literature_table(ctx) +
      f"\n- **Validator:** {errs} errors, {warns} warnings; the research playthrough reaches all {len(waves)} "
      f"technologies{' (the hidden one included)' if hidden else ''} in {max(waves.values())} waves, and no "
      f"technology has a hidden prerequisite.\n")
    w(RESEARCH_SUMMARY)
    # 1 packs
    w("## 1. Papers (science packs)\n")
    rows = []
    gate = {}
    for t in d["technologies"]:
        for r in (t.get("unlocks") or {}).get("recipes") or []:
            if r in meta["tiers"]:
                gate[r] = t["id"]
    for p in meta["tiers"]:
        r = ctx.recipe_for.get(p)
        rec = (f"{ctx.amounts(r['ingredients'])} → {ctx.amounts(r['products'], True)}, {num(r['time'])} s"
               if r and not r.get("pseudo") else
               "1,000 per completed frontier run (`launch`); after closure, Research halls write them "
               "(1 Dataset → 1 per 60 s)")
        g = gate.get(p) or ("in-context-learning" if p == "system-card" else None)
        rows.append([COLOR[p], f"**{ctx.iname(p)}** `{p}`", ctx.items[p].get("mirrors", ""), rec,
                     f"{ctx.tname(g)} ({ctx.cost_str(techs[g])})" if g else "–", ctx.items[p].get("desc", "")])
    w(table(["Colour", "Paper", "Mirrors", "Recipe", "Gateway technology", "Tooltip"], rows))
    w(PACK_NOTES)
    # 2 seminars and staffing
    w(staffing_section(ctx))
    # 3 triggers
    w("\n## 3. Trigger technologies\n")
    rows = [[t.get("code", ""), f"**{t['name']}** `{t['id']}`" + (" (hidden)" if t.get("hidden") else ""),
             trigger_str(ctx, t["trigger"]), ", ".join(ctx.tname(p) for p in t["prerequisites"]) or "–", regime_str(t),
             "— (hidden: no card, no tooltip; closure, 04 §1)" if t.get("hidden") else tooltip(ctx, t)] for t in trig]
    w(table(["Code", "Technology", "Trigger", "Prerequisites", "Regime", "Tooltip"], rows))
    # 4 tree by tier
    w("\n## 4. The tree by tier\n")
    w("A technology's tier is the highest main pack it costs, as Factorio sorts them; anything that costs Proceedings is "
      "listed in Branch M (§4.7). Within a tier, rows follow the playthrough wave in which the technology first "
      "becomes researchable (column *W*). Costs read `count × packs · time per unit`; R G M B P Y W are Memo, Report, "
      "Proceedings, Article, Preprint, Model card, System card. *Regime* is DECISIONS §35's (cited with its year, "
      "infrastructure, or beyond with its field year). The tooltip is generated (DECISIONS §34; 08 §9.1): the definition "
      "clause (`desc`, on about one technology in three), the unlocks, the effect lines (`meta.effects`), the `note`, "
      "and the short citation.\n")
    groups = defaultdict(list)
    for t in d["technologies"]:
        if "trigger" in t or t.get("max_level") == "infinite":
            continue
        packs = t["cost"]["packs"]
        key = "M" if "proceedings" in packs else LETTER[ctx.tech_tier(t)]
        groups[key].append(t)
    titles = {"R": "Red: Memo (automatic computation)", "G": "Green: Report (programming)",
              "B": "Blue: Article (statistical learning)", "P": "Purple: Preprint (deep learning)",
              "Y": "Yellow: Model card (agents)", "W": "White: System card (takeoff)",
              "M": "Branch M: Proceedings (evaluation, containment and the Wild line)"}
    for i, key in enumerate("RGBPYWM", 1):
        ts = sorted(groups[key], key=lambda t: (waves.get(t["id"], 99), t.get("code", "")))
        n_branch = sum(1 for t in ctx.d["technologies"] if t.get("branch") == "M")
        what = (f"{len(ts)} technologies that cost Proceedings ({n_branch} carry `branch: M`; the others sit in the tier "
                f"of their highest pack above)") if key == "M" else f"{len(ts)} technologies"
        w(f"\n### 4.{i} {titles[key]} — {what}\n")
        rows = [[t.get("code", ""), waves.get(t["id"], ""), f"**{ctx.tname(t['id'])}**" + (" ★" if t.get("essential") else "")
                 + f" `{t['id']}`", ", ".join(ctx.tname(p) for p in t["prerequisites"]) or "–", ctx.cost_str(t),
                 regime_str(t), tooltip(ctx, t)] for t in ts]
        w(table(["Code", "W", "Technology", "Prerequisites", "Cost", "Regime", "Tooltip"], rows))
    # 5 infinite
    w("\n## 5. Infinite technologies\n")
    w("Every infinite technology has a geometric cost (DECISIONS §12): ×2 per level, ×1.5 for the ones whose effect "
      "compounds slowly, and Factorio's own 1000 + 3^(L−1) × 1000 (tending to ×3) for Artillery reload. `L` is the level; the first level shown is the one after the finite series.\n")
    rows = [[t.get("code", ""), f"**{t['name']}** `{t['id']}`", t.get("first_level", 1), ctx.cost_str(t),
             ", ".join(ctx.tname(p) for p in t["prerequisites"]), regime_str(t), tooltip(ctx, t)] for t in inf]
    w(table(["Code", "Technology", "From level", "Cost", "Prerequisites", "Regime", "Tooltip"], rows))
    # 6 takeoff
    w(takeoff_section(ctx))
    # 7 pacing
    w(pacing_section(ctx))
    # 8 changes
    w(RESEARCH_CHANGES)
    # 9 references
    w(references_section(ctx))
    w(render_objections("05", ctx))
    return "\n".join(out)


def regime_str(t):
    if t.get("regime") == "cited":
        return f"cited {tech_year(t)}"
    if t.get("regime") == "beyond":
        fy = t.get("field_year")
        return f"beyond {fy}" if isinstance(fy, int) else f"beyond ({fy})"
    return "infra"


ERA_TIER = [("Automatic computation", "Memo"), ("Programming", "Report"), ("Statistical learning", "Article"),
            ("Deep learning", "Preprint"), ("Agents", "Model card"), ("Takeoff", "System card")]


def literature_table(ctx):
    eras = ctx.d["meta"]["citation_rules"]["era_end"]
    rows, running = [], None
    for era, tier in ERA_TIER:
        ys = [tech_year(t) for t in ctx.d["technologies"] if t.get("era") == era and t.get("regime") == "cited"]
        top = max(ys) if ys else None
        running = max(x for x in (running, top) if x is not None) if (running or top) else None
        rows.append([era, tier, sum(1 for t in ctx.d["technologies"] if t.get("era") == era and t.get("regime") == "cited"),
                     top or "–", running or "–", eras.get(era, "–")])
    return table(["Era", "Paper", "Cited technologies", "Latest citation in the era", "Literature at the era's end",
                  "Era limit (08 §9.3)"], rows)


def references_section(ctx):
    lines = []
    for t in ctx.d["technologies"]:
        if t.get("regime") != "cited":
            continue
        lines.append(f"- **{ctx.tname(t['id'])}** {short_citation(t)}")
        for c in sorted(t["citation"], key=lambda c: c["year"]):
            lines.append(f"  - {long_cite(c)}")
    n_works = len({(c['title'], c['year']) for t in ctx.d['technologies'] for c in t.get('citation') or []})
    return (f"""
## 9. References (generated)

The long form of every citation (08 §9.2), in data order, as the technology detail panel, the Handbook and the credits print it. {sum(1 for t in ctx.d['technologies'] if t.get('regime') == 'cited')} cited technologies carry {sum(len(t.get('citation') or []) for t in ctx.d['technologies'])} citation entries ({n_works} distinct works). Every entry was checked against publisher, DOI, arXiv, ACL, IEEE/ACM or archive records in round 4; R3-accuracy fixed the years and authors. A work cited by several technologies (*Dennard scaling 1–5*) is listed under each.

""" + "\n".join(lines) + "\n")


def validator_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location("validate_spec", ROOT / "tools/validate_spec.py")
    v = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(v)
    return v


def validator_counts():
    v = validator_module()
    rep = v.Report()
    data = v.load(DATA, rep)
    v.run_checks(data, rep)
    return len(rep.errors), len(rep.warnings)


def playthrough_waves():
    import importlib.util
    spec = importlib.util.spec_from_file_location("validate_spec", ROOT / "tools/validate_spec.py")
    v = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(v)
    rep = v.Report()
    data = v.load(DATA, rep)
    ix = v.index(data, rep)
    return v.playthrough(data, ix, rep)


def staffing_section(ctx):
    meta = ctx.d["meta"]
    s = meta["staffing"]
    sem = ctx.ents["seminar"]
    res = ctx.items["researcher"]
    rr = ctx.recipes["researcher"]
    term = ctx.ents["terminal"]
    tr = ctx.recipes["terminal"]
    t0 = ", ".join(f"{k} {v}" for k, v in s["t0"].items())
    ups, radius = [], s["radius"]
    waves = playthrough_waves()
    for t in sorted(ctx.d["technologies"], key=lambda t: waves.get(t["id"], 99)):
        for ef in (t.get("unlocks") or {}).get("effects") or []:
            if ef["type"] == "staffing-radius":
                radius = round(radius * ef["multiplier"])
                ups.append(f"*{t['name']}* → {radius}")
    term_tech = next(t for t in ctx.d["technologies"] if "terminal" in (t["unlocks"].get("recipes") or []))
    hw = meta["hollow_work"]
    sup = s["supply"]
    return f"""
## 2. Seminars, staffing and Researchers

**Seminar** (`seminar`, mirrors Factorio's lab): {"×".join(map(str, sem["size"]))}, {sem["energy"]["kw"]:g} kW, research speed {sem["crafting_speed"]:g}, {sem["module_slots"]} module slots and **{sem["staff_slots"]} staff slot** (a new slot type next to the module slots). Tooltip: "{sem["desc"]}"

**Staffing** (B's L9; rules and calibration in 01 §8, R4-world; DECISIONS §23):
- **Supply:** {sup["formula"]} (×{sup["max_multiplier"]:g} from W = {(sup["max_multiplier"] - 1) / sup["per_field_year"]:g}, field year {1945 + int((sup["max_multiplier"] - 1) / sup["per_field_year"])}). T0 by town class: {t0}. {int(s["university_share"]["town"] * 100)}% of plain towns have a university; villages none.
- **Demand:** {s["demand"]["formula"]}, with {s["demand"]["working_share"]}. {s["demand"]["researcher"][0].upper() + s["demand"]["researcher"][1:]}.
- **Coverage:** {s["coverage"]}. Radius {s["radius"]} tiles, raised by {", ".join(ups)}.
- **Networks:** {s["network"]}.
- {s["uncovered"][0].upper() + s["uncovered"][1:]}.

**Terminal** (`terminal`, DECISIONS §23d): {"×".join(map(str, term["size"]))}, {term["energy"]["kw"]:g} kW, {ctx.amounts(tr["ingredients"])} ({num(tr["time"])} s), unlocked by *{term_tech["name"]}* (Report tier), which requires *Packet switching* so that data lines exist. Rule: {s["terminal"]}. It gives data lines a job before Preprint (FUN-07). Tooltip: "{term["desc"]}"

**Researcher** (`researcher`): {ctx.amounts(rr["ingredients"])} → {ctx.amounts(rr["products"], True)} in the Trainer, {num(rr["time"])} s. In a staff slot it staffs the Seminar fully and leaves its network's demand; it draws {res["staff"]["kw"]} kW of interruptible power {res["staff"]["draws"]}, scaled only by *Energy per operation*; the Seminar then throttles as an accelerator-class machine; it is a deploying building at tier {res["staff"]["model_tier"]} and may do hollow work: {hw["formula"]}, shown as **{hw["display"]}**; stopped from consuming papers by *Interpretability*. Tooltip: "{res["desc"]}"

| Seminar state | Research speed | Notes |
|---|---|---|
| No staff in range, no Researcher | 0 | status *No staff* |
| Town staff | speed × min(1, ΣT / Σ demand) of its network | demand grows with module and Switch speed (DECISIONS §23a) |
| Researcher in the staff slot | full speed × the heat throttle of its chunk | removes the talent cap; draws 500 kW |
"""


def takeoff_section(ctx):
    rows = []
    mg, mg25 = ctx.techs["model-generation"], ctx.techs["model-generation-25"]
    rtr = ctx.d["meta"]["world_settings"]["returns_to_research"]
    m = rtr["g"] ** rtr["default"]
    r_default, r_label = default_returns(ctx)
    first, last = mg["first_level"], mg["max_level"]
    for L in range(first, last + 2):
        cost = unit_count(mg["count_formula"], L) if L <= last else mg25["cost"]["count"]
        cards = cost / m ** (L - first)
        rows.append([L, num(cost), f"×{m ** (L - first):,.0f}", num(cards)])
    hw_rows = []
    for tid, lv in hardware_slots(ctx):
        t = ctx.techs[tid]
        hw_rows.append([f"after MG {lv}", f"**{t['name']}**", num(t["cost"]["count"]),
                        ", ".join(ctx.tname(p) for p in t["prerequisites"]), regime_str(t), tooltip(ctx, t)])
    unit_s = num(ctx.techs["model-generation"]["cost"]["time"])
    rs = []
    for r, lab in returns_presets(ctx):
        g, hw = takeoff_cards(ctx, r)
        rs.append([lab, f"{rtr['g'] ** r:.2f}", num(g), num(hw), num(g + hw)])
    order = takeoff_order(ctx)
    hw_ids = {t for t, _ in hardware_slots(ctx)}
    tail = order[max(i for i, (t, _) in enumerate(order) if t in hw_ids) + 1:]
    tail_lv = [lv for t, lv in tail if t == "model-generation"]
    tail_txt = (f"*Model generation* {tail_lv[0]}–{tail_lv[-1]}, " if tail_lv else "") + " and ".join(
        f"*{ctx.techs[t]['name']}*" for t, _ in tail if t != "model-generation")
    return f"""
## 6. The takeoff (G's model, R2-W's order)

*Model generation* is one multi-level technology for levels 6–24 plus a separate capstone, *Model generation 25*, which also unlocks the Final report (the last run's payload). Level *L* costs 2400 × 1.5^(L − 6) System cards at {unit_s} s per unit (DECISIONS §23c: every technology paid in System cards alone takes {unit_s} s) and multiplies research per paper by m = 1.5^r, globally and retroactively: the effect carries `multiplier_from: returns_to_research`, never a literal (impl J14). The default r is ln 2 / ln 1.5 ≈ {r_default:.4f}, shown as {r_label}, so m = {m:g} exactly (R5-gate D12b). Both are `beyond` the literature, with field years 2025 + 0.5 × (L − 5) (01 §12.1); the Fifth Generation reference is a Handbook note, not a citation (DECISIONS §35). Closure is the first System card written by a Research hall (DECISIONS §16); its *Research run* researches the hidden *Loop closed* (§3), which *Model generation* and the hardware below require, so nothing here can be researched before closure (R5-gate D9). The takeoff runs from closure to Model generation 25.

{table(["Level", "Cost (research units, rounded half up)", "Research per paper while researching", f"System cards actually consumed (default r: m = {m:g})"], rows)}
The takeoff hardware follows G's φ = 0.15 rule: each costs 15% of the Model generation level it is meant to follow. Prerequisites cannot name a level of a multi-level technology, so in data they require *Loop closed* (or the previous tech of their own line, and *Nuclear power* or *Liquid cooling* where their buildings need it). *Research scheduling* follows the order below, `meta.endgame.takeoff_order`, which then runs on through {tail_txt} (R5-gate D10; 04 §5.1). Citations for three of them (*Wafer-scale integration*, *Photonic interconnect*, *Sparse inference*) are deferred until their sources are verified (R5-gate D14, DECISIONS §42; 04 §5).

{table(["Intended slot", "Technology", "Cost (System cards)", "Prerequisites", "Regime", "Tooltip"], hw_rows)}
System cards actually consumed by the takeoff, by world setting (research per paper multiplies by m each level):

{table(["Returns to research r", "m", "Model generation 6–25", "Hardware techs", "Total"], rs)}
G's figure of about 10,000 System cards for the whole takeoff holds at the default. Every pre-closure white technology is paid by frontier runs at 1,000 System cards each (1,500 after *Chain of thought*).
"""


def pct(a, b):
    return f"{(a / b - 1) * 100:+.0f}%" if b else "new"


def pacing_section(ctx):
    ftechs = factorio_techs()
    takeoff = {tid for tid, t in ctx.techs.items() if "cost" in t and set(t["cost"]["packs"]) == {"system-card"}}
    ours = {tid: t for tid, t in ctx.techs.items() if tid not in takeoff}
    fpk, flab, fn, _, _, fby = research_stats(factorio_tech_units, ftechs)
    opk, olab, on, _, _, oby = research_stats(our_tech_units, ours)
    fw = sum((c for k, c in fby.items() if k.startswith("W")), Counter())
    ow = sum((c for k, c in oby.items() if k.startswith("W")), Counter())
    rows = []
    for p in ["memo", "report", "proceedings", "article", "preprint", "model-card", "system-card"]:
        f, o = fpk.get(p, 0), opk.get(p, 0)
        rows.append([f"{COLOR[p]} ({ctx.iname(p)})", num(f), num(o), pct(o, f), num(fw.get(p, 0)), num(ow.get(p, 0)),
                     pct(o - ow.get(p, 0), f - fw.get(p, 0)) if f - fw.get(p, 0) else "–"])
    pack_table = table(["Pack", "Factorio 2.0 + quality", "Here", "Change", "of which white-tier techs: Factorio",
                        "here", "Change without the white tier"], rows)
    rows, deltas = [], {}
    for k in ["R", "G", "B", "P", "Y", "W"]:
        fk, ok = flab.get(k, 0), olab.get(k, 0)
        deltas[k] = pct(ok, fk)
        fm, om = flab.get(k + "+M", 0), olab.get(k + "+M", 0)
        rows.append([k, fn.get(k, 0), num(fk), on.get(k, 0), num(ok), deltas[k],
                     f"{fn.get(k + '+M', 0)} / {on.get(k + '+M', 0)}", f"{num(fm)} / {num(om)}"])
    tk = [ctx.techs[t] for t in sorted(takeoff) if ctx.techs[t].get("max_level") != "infinite"]   # units of infinite techs are excluded
    units = sum(sum(c for c, _, _ in (our_tech_units(t) or [])) for t in tk)
    r_default, r_label = default_returns(ctx)
    g, hw = takeoff_cards(ctx, r_default)
    rows.append(["W, takeoff", "–", "–", len(tk), f"{num(round(units))} research units",
                 f"≈ {num(round(g + hw, -2))} System cards consumed at r = {r_label} (§6)", "–", "–"])
    tier_table = table(["Tier", "Factorio techs", "Factorio lab-s", "Techs here", "Lab-s here", "Change",
                        "+M techs (F / here)", "+M lab-s (F / here)"], rows)
    fcl, fn_, fpath, flabsec = path_stats(factorio_tech_units, ftechs, "space-science-pack")
    ocl, on_, opath, olabsec = path_stats(our_tech_units, ctx.techs, "in-context-learning")
    path_rows = [["Technologies in the prerequisite closure", fcl, ocl],
                 ["of which cost packs", fn_, on_],
                 ["Lab-seconds", num(flabsec), f"{num(olabsec)} ({pct(olabsec, flabsec)})"]]
    for p in ["memo", "report", "article", "preprint", "model-card"]:
        path_rows.append([f"{ctx.iname(p)} packs", num(fpath.get(p, 0)), num(opath.get(p, 0))])
    path_table = table(["Path to the first launch / frontier run", "Factorio 2.0", "Here"], path_rows)
    fc = factorio_pack_costs()
    plain = our_pack_costs(ctx, sig_runs=20)
    meta = our_pack_costs(ctx, sig_runs=1 / (0.05 + 0.95 / 3))
    fkeys = ["iron-ore", "copper-ore", "coal", "stone", "crude-oil", "uranium-ore"]
    okeys = ["iron-ore", "copper-ore", "coal", "quartz", "records", "crawl"]
    rows = []
    for p in ["memo", "report", "article", "proceedings", "preprint", "model-card", "system-card"]:
        rows.append([f"{COLOR[p]} ({ctx.iname(p)})" + (", no Meta-analysis" if p == "article" else ""),
                     " / ".join(fmt_cost(fc[p], fkeys)), " / ".join(fmt_cost(plain[p], okeys))])
        if p == "article":
            rows.append([f"{COLOR[p]} ({ctx.iname(p)}), Meta-analysis running", "", " / ".join(fmt_cost(meta[p], okeys))])
    raw_table = table(["Pack", "Factorio: iron / copper / coal / stone / crude / uranium",
                       "Here: iron / copper / coal / quartz / records / crawl"], rows)

    changes = sorted(((opk[p] - ow[p]) / (fpk[p] - fw[p]) - 1) * 100
                     for p in ["memo", "report", "article", "preprint", "model-card"])
    lo, hi = f"{changes[0]:+.0f}%", f"{changes[-1]:+.0f}%"

    def ratio(p, ok, fk, src=None):
        c = (src or plain)[p]
        return c.get(ok, 0) / fc[p][fk] if fc[p].get(fk) else 0

    notes = [
        f"- **Lab time by tier** stays within Factorio's shape: red {deltas['R']}, green {deltas['G']}, blue {deltas['B']}, "
        f"purple {deltas['P']}, yellow {deltas['Y']}. The increases are E's additions (*Artificial intelligence*, "
        f"*Expert systems*, *Packet switching*, the cooling and Dennard lines, *Interpretability*, *Preference tuning*) "
        f"and round 2's (*Fluid handling*, *Hypothesis testing*, *Meta-analysis*).",
        f"- **The path to the first run** costs {pct(olabsec, flabsec)} lab time against Factorio's path to the first launch.",
        f"- **Pack totals** rise mostly through the **white tier**: E's pre-closure techs (*Chain of thought*, *Self-play*, "
        f"*Test-time compute*, *Automated research*, *Formal verification*) cost every pack. Without the white tier, "
        f"the red-to-yellow totals change by {lo} to {hi}.",
        f"- **The Article** carries the experiment loop: without Meta-analysis its crawl is "
        f"{ratio('article', 'crawl', 'crude-oil'):.1f}× Factorio's crude per blue pack; with Meta-analysis at steady state "
        f"{ratio('article', 'crawl', 'crude-oil', meta):.2f}×. Metals stay at Factorio's (iron "
        f"{meta['article']['iron-ore']:.1f} against {fc['article']['iron-ore']:.1f}). See 02 §7.",
        f"- **Preprint:** crawl {ratio('preprint', 'crawl', 'crude-oil'):.2f}× Factorio's crude, iron "
        f"{ratio('preprint', 'iron-ore', 'iron-ore'):.2f}×, copper {ratio('preprint', 'copper-ore', 'copper-ore'):.2f}× "
        f"(checkpoints cost Trainer time, not circuits; D).",
        f"- **Model card:** crawl {ratio('model-card', 'crawl', 'crude-oil'):.2f}×, iron "
        f"{ratio('model-card', 'iron-ore', 'iron-ore'):.2f}×, copper {ratio('model-card', 'copper-ore', 'copper-ore'):.2f}× "
        f"(D's calibration, plus the Ratings' drive).",
        f"- **System card:** iron {ratio('system-card', 'iron-ore', 'iron-ore'):.2f}×, copper "
        f"{ratio('system-card', 'copper-ore', 'copper-ore'):.2f}×, crawl {ratio('system-card', 'crawl', 'crude-oil'):.2f}× "
        f"of Factorio's space science per pack.",
        "- The time model (G's regimes, the 50-minute reference takeoff) is R2-W's, in 04-endgame; these tables check "
        "that the factory's demand stays Factorio-shaped.",
    ]
    return f"""
## 7. Pacing against Factorio 2.0

Factorio's numbers are computed by this renderer from the 2.0.77 base + quality data in `round1/E-data/` (`tech2077.json`, `techq.json`, `recipe2077.json`), the same way as ours. Infinite technologies are excluded. The **takeoff** technologies, those paid in System cards alone (*Model generation*, the hardware line, *Fusion power*), are reported apart: their research units are divided by research per paper, which doubles with each Model generation level (§6).

**Packs consumed by finite research** (takeoff excluded):

{pack_table}
**Lab-seconds by tier** (a technology's tier is its highest main pack; "+M" columns cost Proceedings too):

{tier_table}
**The path to the first launch** (Factorio: everything *Space science pack* requires; here: everything *In-context learning* requires):

{path_table}
**Raw cost of one pack** (first recipe per item, catalysts and returned drives net; significant results at 20 runs each without Meta-analysis and at 2.73 with it; crude and crawl through *basic* processing, so divide both by about 2.2 for full cracking; water omitted):

{raw_table}
**Reading.**
{chr(10).join(notes)}
"""


# ------------------------------------------------------------------ hand-written sections
ECONOMY_SUMMARY = """- **Base:** D's round-1 production economy (`round1/D-data`), kept wherever DECISIONS did not change it: quartz plays stone, archives (records) at towns, the data refinery (crawl → junk / text / prose, cracked by Denoising and Rephrasing), coal chemistry, the chip ladder Logic board → Processor → Accelerator, Checkpoints as catalysts, the Trainer, the frontier run.
- **Added in round 2 (DECISIONS, F, G, A's adopt list, R2-W):** heat on every entity (computing classes, thermal plants, three coolers and Coolant); containment (Monitor, Evaluation set, Rollback) and the Wild preset's defense line; equipment and armor; quality (Comparator 1–3, five tiers, the Verifier); the experiment loop (Experiment, Analysis, Meta-analysis); deployment (Endpoint, Ratings); the endgame (Research hall, Frontier checkpoint, Accelerator 2–4, Final report, fusion); the Constructor.
- **Round 4 (DECISIONS §21–§38, the five round-3 critiques):** the experiment loop at 1 / 2.4 / 12 s; thermal-plant heat at the generators; Research halls without modules or Switch effects; the Switch as a computing machine; productivity eligibility and catalysts that never roll quality; the Terminal; the empty launch; tiles, world objects and one Laboratory salvage; the Decision unit and the Half-track; descriptions on about one item or building in five. §9 lists every change.
- **Every building has a stat line; about one in five items and buildings carries a description** (DECISIONS §34; 08 §5.1). A building item shows its building's. Tooltips follow H: one functional fact, and wit only where the fact itself is the joke.
- **Thermal plants conserve energy (DECISIONS §18, §24):** fuel values and burner draws are 3× Factorio's, so item flows are unchanged; a boiler burns 5.4 MW for 1.8 MW of steam, and the generators it feeds reject 2 × their output as heat.
"""

EXPERIMENT_SECTION = """
## 7. The experiment loop (A's adopt list: uranium's and Kovarex's shapes)

| Step | Recipe | Machine | Shape |
|---|---|---|---|
| Experiment | 1 Drive + 1 Benchmark → 1 Recorded run, {t_exp} s | Data plant | chemical-plant recipe |
| Analysis | 1 Recorded run → 98% the Drive back, 5% Significant result, 95% Null result, {t_an} s | Trainer | uranium processing |
| Meta-analysis | 40 Significant + 5 Null → 41 Significant + 2 Null, {t_meta} s | Trainer | Kovarex |
| Article | 2 Engine unit + 3 Processor + 1 Significant result → 2, 24 s | assembler | chemical science pack, the sulfur slot |

- **Times (DECISIONS §22, balance M3).** Experiment {t_exp} s, Analysis {t_an} s, Meta-analysis {t_meta} s: all three scaled together, keeping Kovarex's 1 : 5 ratio. The Article line is then about 1.15× Factorio's blue in machines with Meta-analysis running.
- α's definition sits on the Analysis recipe as a Handbook note: "α = 0.05 is the chance of a significant result when there is no effect." Nothing else comments on it. The first chest tier is the **File drawer** (Rosenthal, 1979, cited nowhere in the UI); it carries no description (08 §10.1). Analysis yields exactly Rosenthal's 5% and 95% (R3-accuracy §5).
- **What it costs.** Without Meta-analysis one significant result takes {runs_plain} runs; with Meta-analysis at steady state it takes {runs_meta} (each run yields 0.05 significant results plus 0.95 nulls, and Meta-analysis turns 3 nulls into 1 significant result). Meta-analysis needs 40 significant results to start: {boot_runs} runs of bootstrap ({boot_trainer_h} Trainer-hours), Kovarex's grind.
- **Build size at 60 Articles per minute** (0.5 significant results/s), machines at speed 1: with Meta-analysis {an_meta} Trainers on Analysis, {meta_m} on Meta-analysis, {exp_meta} Data plants on Experiments and {bench_meta} Benchmarks/s ({prose_meta} prose/s); without it {an_plain} Trainers, {exp_plain} Data plants and {bench_plain} Benchmarks/s ({prose_plain} prose/s). D's Article took {bench_d} Benchmark/s at that rate. The loop makes Meta-analysis the Article's Kovarex: optional for the first hundreds of Articles, worth it at scale.
- **Productivity** applies to all three steps and to the Article (DECISIONS §30; Kovarex's catalyst excluded, as in Factorio).
- **Scooped (off by default, on in Race mode):** significant results spoil into **Baselines** after 15 minutes ("Was state of the art."); *Meta-analysis (baselines)* accepts them in place of nulls.
"""

DEPLOYMENT_SECTION = """
## 8. Deployment, containment and the Wild line

- **Endpoint** (deploying building, F; unlocked by *Deep learning*): 3×3, 1 MW, cluster class, 2 module slots, placed on an exchange tap (`placement: must_be_on exchange`); it keeps working after the exchange closes to crawlers. Recipe *Ratings*: 1 Checkpoint (returned) + 1 Drive → 1 Ratings, 10 s. Each Ratings adds 2 × 10⁻⁴ to Σ, σ's accumulator (DECISIONS §29; ×0.5 after *Watermarking*). Its model tier is global: 1 / 2 / 3 after *Deep learning* / *Attention* / *Instruction tuning*.
- **Ratings** ("Pairs of answers, one marked better.") are preference data from deployment (B L16): 1 per 3 Model cards (R2-W) and 100 per Post-training payload.
- **Model collapse** (DECISIONS §31, R3-accuracy M4; 03 §2.2): before *Synthetic detection*, Checkpoint and Post-training payload run at speed × (1 − σ·c), c being the share of the Site's recent text and prose that came from crawling (`meta.world.model_collapse`). An archive-fed Site trains clean. After detection, crawler output × (1 − σ) and no penalty.
- **Containment (the Contained default; 03 §3):** the Power switch (30 s without power cleans a compromised machine), the **Monitor** (2×2, 300 kW, range 24; one Evaluation set per clean, every 5 s; unlocked by *Threat monitoring*; runs no learned weights), **Evaluation sets** (1 Benchmark + 1 Adversarial set → 2, Data plant) and *Rollback recovery*: a hidden rollback input takes a Checkpoint (tiers 1–3) or a Frontier checkpoint (tier 4) and cleans the machine at once. Deploying buildings: Endpoint, Research hall (tier 4, DECISIONS §28), a Seminar holding a Researcher (tier 4). Spread is one copy per infection per interval (DECISIONS §27). The leak counts *Verification* techs (R3-accuracy M3).
- **The Terminal** (DECISIONS §23d; §2 of 05) joins a far university to a Seminar network over a data line; it is not susceptible and makes no runaway link of its own.
- **The empty launch** (`launch-empty`, coherence M7, adopted with R4-world): a frontier run without a payload returns its Frontier checkpoint and no System cards. The payload's description no longer claims the mechanic.
- **The Wild preset** adds Factorio's military loop with F's nouns: Fence and Gate, Gun turret with Magazine / AP / DU magazines, Laser turret, Arc turret, Artillery (turret, wagon, shell), the Interceptor bay with Interceptors 1–3, Land mines, Legged agents with rockets and the EMP warhead. The **Half-track** (DECISIONS §38) keeps the tank's armor and has no cannon, so cannon shells are gone. The runaway prototypes are in `enemies.yaml`.
- **The Constructor** is not a computing machine by its recipe: 1 Steel chest + 10 Logic board + 5 Decision unit (coherence M8). The Area scanner: 1 Radar + 5 Logic board + 5 Copper cable.
"""

ECONOMY_CHANGES = """
## 9. Changes (hand-written)

### 9.1 Round 2: from D's round-1 data

| # | Change | Why |
|---|---|---|
| 1 | Article: Benchmark → **Significant result** | A's experiment loop (adopt list #1) |
| 2 | Model card: + 1 Ratings; Post-training payload: + 100 Ratings (six ingredients, as the satellite's) | R2-W: deployment scales with yellow; B L16: the payload is preference data from deployment |
| 3 | Researcher: Checkpoint → **Frontier checkpoint** (returned); every frontier run also returns a Frontier checkpoint; *Copy weights* makes copies on blank drives | G: the Researcher needs the weights only a completed run returns |
| 4 | Data refinery: 10 Concrete → 20 Quartz (ISO's 10 stone bricks) | E's tree puts the refinery before *Concrete*; the closure check found the hidden prerequisite |
| 5 | Repeater: 1 Steel plate → 1 Iron plate | it is unlocked by *Packet switching*, which has no steel among its prerequisites |
| 6 | *Kovarex enrichment process* → **Enrichment cascade** | H: no living people in names (E's name) |
| 7 | Pseudo-recipes *boil-steam* and *burn-fuel-cell* removed | boilers, heat exchangers and reactors declare `consumes`/`produces` (SCHEMA) |
| 8 | Nuclear reactor fuel category chemical → nuclear | bug |
| 9 | `emissions_per_min` removed; modules lose their pollution effect | heat is energy (L4, F) |
| 10 | Fuel values and burner draws ×3 | DECISIONS §18 |
| 11 | Wooden chest → **File drawer** (display name) | A's adopt list |
| 12 | Defense line, armor and equipment added | DECISIONS §6 keeps Wild as a preset; E's tree needs them |
| 13 | Start recipes: Factorio 2.0's start set without the magazine and light armor, plus Keypunch, Token and Iron stick (Silicon takes stone brick's slot), held by *Prior art* | E's tree (ISO 2.0), no handheld weapons, and A's "first hour as short as vanilla" |
| 14 | Junk tooltip "Can be rephrased" → "Can be denoised" | D's chain cracks junk by Denoising |
| 15 | Armored vehicle unarmed; cannon shells dropped; Artillery shell = 8 Steel + 8 Copper + 16 Explosives + 1 Radar | B L14 outranks E and F |
| 16 | Equipment recipes: low density structure → Steel plate 1:1 | the Rack (D's LDS) is a 42 U cabinet, not a suit part |

### 9.2 Round 4: the round-3 critiques

| # | Change | Source |
|---|---|---|
| 1 | Experiment 5 → 1 s, Analysis 12 → 2.4 s, Meta-analysis (both) 60 → 12 s | DECISIONS §22; balance M3 |
| 2 | Heat: steam engine, steam turbine and fusion generator emit 2 × their electrical output (`twice-output`); boiler, heat exchanger and both reactors `none`; the fission reactor's waste heat at 1,000 °C (`waste_heat`) | DECISIONS §24; balance M4; fun FUN-04; R4-world |
| 3 | Research hall: 0 module slots, no module or Switch effects (`effect_receiver`); 20 accelerator slots, a weights slot and an output for swapped accelerators; mixed tiers average; statuses | DECISIONS §25; impl L1 |
| 4 | Switch: its own thermal class `network` (T* 40 °C); a throttled Switch scales its transmitted effects | DECISIONS §26; balance M5; R4-world |
| 5 | `allow_productivity` on the mirrors of Factorio 2.0's 42 eligible recipes and the experiment loop; every catalyst product `affected_by_quality: false` | DECISIONS §30; balance B1; impl L5 |
| 6 | **Terminal** (entity, item, recipe), unlocked by *Time-sharing* | DECISIONS §23d; fun FUN-02 B, FUN-07 |
| 7 | **Launch without a payload** (`launch-empty`, pseudo): 100 Run shards → 1 Frontier checkpoint, no System cards; unlocked by *Scaling laws* | coherence M7, C2; R4-world |
| 8 | **Laboratory salvage** defined once in `meta.start.salvage`: 6 wreck pieces of 5 Iron plates, a crate of 1 Radar, 10 Logic boards, 20 Copper cable; the Radar's "Surplus from a wartime laboratory." moves to the salvage's Handbook note | DECISIONS §33; impl B2; coherence B1, M13 |
| 9 | `tiles.yaml` (18 tiles: κ, buildability, walking speed, placement) and `world.yaml` (trees, three rocks, campus, exchange office, mine entrance); trees leave `resources.yaml`; concretes and landfill get `places_tile` | impl B3, J9 |
| 10 | Boiler 6 water/s, heat exchanger 10.309 water/s (1 water → 10 steam, 2.0.7); water and steam 0.2 kJ/K per unit (water corrected to 2 kJ/K, at most 100 °C, and steam's limit set to 5,000 °C: factorio-data 2.0.77 fluid.lua, D1-r1) | impl J3 |
| 11 | ISO drains (`drain_kw`) on crafting machines, inserters and pumps; inserter energy per movement and rotation, the burner inserter's ×3 (150 kJ) with no fixed draw | impl N30, J4 |
| 12 | Threshold unit → **Decision unit**, "Outputs while its conditions hold." | DECISIONS §37 (refined); R3-accuracy M1 |
| 13 | Tank → **Half-track** (item, entity, recipe, technology), unarmed, 80 slots | DECISIONS §38; coherence M14 |
| 14 | Constructor: 1 Steel chest + 10 Logic board + 5 Decision unit; Area scanner: 1 Radar + 5 Logic board + 5 Copper cable | coherence M8 |
| 15 | Descriptions cut to about one item or building in five (keep-list kept verbatim; building items show their building's); replacements per coherence §2.1 and R3-accuracy §2.4 | DECISIONS §34, §36 |
| 16 | Coprocessor 1–3: quality −1 / −1.5 / −2.5% (Factorio 2.0.7) | R3-accuracy §2.3 |
| 17 | `placement` as data (Crawler and Endpoint on an exchange; offshore pump and water exchanger touch water); the cooling tower accepts consumption effects only; coolant filter rule | impl arch gap 5, J20 |
| 18 | Cooling tower: 1 water per 2.43 MJ (latent heat at 30 °C) | R3-accuracy §2.5 |
| 19 | Recipe *Photolithography* → **Wafer** (photolithography patterns a wafer, it does not make one) | R3-accuracy §2.3 |
| 20 | Exchange `min_yield` deleted (the floor is the world's); Endpoint `model_tier` text deleted (the tier is global) | impl N8, N6 |
| 21 | Sprites: Dataset a tape reel; Checkpoint and Frontier checkpoint bare hexagon chips; Significant, Null and Baseline sheets told apart by a green band | fun FUN-09 |
| 22 | Recipe notes → `handbook_note`, without symbols ("Prose follows the junk share of new writing.") | DECISIONS §34; 08 §10.1 |
| 23 | Monitor `mirrors` leads with `gun-turret` (its 2×2 defaults); Handbook note "Runs no learned weights." | impl J23; coherence m22 |
"""

RESEARCH_SUMMARY = """- **Base:** E's tree (`round1/E-data/tree.json`): every Factorio 2.0 base and quality technology mirrored one to one, plus E's additions, with E's costs, prerequisites and codes. Unlock targets carry D's recipe ids (E's Appendix A).
- **DECISIONS §11, §35:** *Model generation* runs from level 6 to 25, and level 25 is the capstone; both are `beyond` the literature, and the Fifth Generation reference is a Handbook note. G's numbers set its cost (2400 × 1.5^(L − 6)) and the takeoff hardware's.
- **Endgame additions (G, R2-W):** the six takeoff techs E lacked, *Energy per operation* (in place of E's Model generation 21+), and the capstone as its own technology.
- **A's adopt list:** *Hypothesis testing* (gates the Article) and *Meta-analysis*; quality's verifier ladder; the Constructor only at the finale.
- **Round 4:** every technology has a citation **regime** (cited, infrastructure, beyond) and the cited ones carry verified long-form citations (DECISIONS §35); the tooltip text is the definition clause only, with unlocks, effect lines and the short citation generated (DECISIONS §34); R3-accuracy's corrections are applied (§8.2); takeoff technologies take 60 s per unit (DECISIONS §23c).
- **Round 5 (DECISIONS §40):** the hidden trigger technology *Loop closed* gates every technology paid in System cards alone behind closure (R5-gate D9); *Research scheduling* follows `meta.endgame.takeoff_order` (D10); the default r is ln 2 / ln 1.5, so m = 2 exactly (D12b). §8.3 lists the changes.
"""

PACK_NOTES = """
- **Proceedings opens after blue.** D's recipe makes it from an Adversarial set (junk's direct use, unlocked by *Paraphrase generation*) and a Benchmark, so *Game theory* requires *Paraphrase generation* (Objection 1).
- **The yellow gateway follows the purple one.** Model cards take Ratings from Endpoints, which *Deep learning* unlocks, so *Expected utility* requires *Deep learning*.
- **System cards** come from frontier runs (1,000 per run; ×1.5 after *Chain of thought*) until closure, then also from Research halls. A run launched without a payload returns only its Frontier checkpoint.
"""

RESEARCH_CHANGES = """
## 8. Changes (hand-written)

### 8.1 Round 2: from E's tree

**Renamed** (E's names described H's provisional items; D's mechanical mapping wins and H's rules apply to names, DECISIONS §9):

| E's technology | Here | Why |
|---|---|---|
| Synthetics (Rubin, 1993) | **Cross-validation** (Stone, 1974; Geisser, 1975) | the plastics slot holds Dataset and Benchmark: training data and held-out data |
| Spam filtering (Sahami et al., 1998) | **Sulfur processing** (ISO, uncited) | the sulfur slot holds D's coal chemistry |
| Memory wall (Wulf & McKee, 1995) | **Warehouse-scale computing** (Barroso & Hölzle, 2009) | the low-density-structure slot holds the Rack |
| Mass digitization (Michel et al., 2011) | **Synthetic data** (Rubin, 1993) | the coal-liquefaction slot holds D's synthetic-data recipe |

**Added (11):** *Fluid handling*, *Hypothesis testing* and *Meta-analysis* (A), *Model generation 25* (the capstone), G's takeoff hardware *Two-phase cooling*, *Fleet scheduling*, *Sparse inference*, *Microfluidic cooling*, *Self-reproducing automata* (the Constructor) and *Nanofabrication*, and G's *Energy per operation*. **Dropped (1):** *Model generation 21+*.

**Prerequisites added** (each closes a hidden prerequisite): *Integrated circuit* ← *Sulfur processing*; *Sulfur processing* ← *Fluid handling*; *Game theory* ← *Paraphrase generation*; *Warehouse-scale computing* ← *Batteries*; *Fluid wagon* ← *Fluid handling*, *Packet switching*; *Statistical learning* ← *Hypothesis testing*; *Expected utility* ← *Deep learning*.

**Unlocks moved, costs and effects changed:** as listed in round 2 (Evaluation set with the Monitor; Adversarial set to *Paraphrase generation*; the launch to *Preference tuning*; the Tokenizer to *Electric furnace*; data lines to *Packet switching*; Endpoint and Ratings to *Deep learning*; the takeoff hardware at G's φ costs; *Model generation* 2400 × 1.5^(L − 6); *Mining productivity 4+* and *Interceptor count 5+* ×1.5 per level; staffing radius ×1.5 from *Packet switching* and *Web search*).

### 8.2 Round 4: the round-3 critiques

**Renamed:**

| Round 3 | Round 4 | Why |
|---|---|---|
| Zone refining (Pfann, 1952) | **Regenerative furnace** (`regenerative-furnace`, uncited) | zone refining purifies semiconductors; the steel furnace is a regenerative furnace (coherence M10) |
| Penetration testing (Linde, 1975) | **Terminal ballistics** (`terminal-ballistics`, uncited) | it unlocks AP rounds; the security pun failed the five-second test (coherence M11) |
| Reference monitor (Anderson, 1972) | **Threat monitoring** (`threat-monitoring`; Anderson, 1980) | the Monitor detects and cleans; a reference monitor prevents (R3-accuracy §2.3) |
| Mobile robotics | **Mobile automata** (`mobile-automata`) | "robot" is on 08's never-list; Nilsson's own title (R3-accuracy §2.4) |
| Context length 1–3 | **Lift capacity 1–3** (`lift-capacity-1..3`) | context length is not payload (coherence m18; R3-accuracy §2.3) |
| Tank | **Half-track** (`half-track`) | an unarmed armored vehicle is not a tank (DECISIONS §38) |

**Citations** (R3-accuracy §1–§3; DECISIONS §36): Hollerith 1890 → **1889**; Dantzig 1947 → **1949**; Kung & Leiserson 1978 → **1979**; Kilby 1958 → **1959** (patents by filing year); Snell et al. → **Snell, Lee, Xu & Kumar**; FLAN Wei et al. 2022 → **2021**, with **Mishra, Khashabi, Baral & Hajishirzi (2021)**; **Borel (1921)** beside von Neumann (1928); Baran 1964 → **1962**; Koster 1994 → **Eichmann (1994); McBryan (1994)**; Brooks 1991 → **1989**; **King (1969)** beside Floyd and Hoare; Cavnar & Trenkle 1994 → **Maron (1961)**; Feigenbaum 1977 → **Buchanan, Sutherland & Feigenbaum (1969)**; Rosenblatt 1958 → **1957**; Vapnik & Chervonenkis 1971 → **1968**; Solaiman et al. 2019 → **Badaskar, Agarwal & Arora (2008)**; King et al. 2009 → **2004**; Anderson 1972 → **1980**; earlier claimants added: **Hestness et al. (2017)**, **Oh & Jung (2004)**, **Hernandez & Brown (2020)**, **Nye et al. (2021)**, **Vanhoucke, Senior & Mao (2011)**, **Chandy & Ramamoorthy (1972)**. *Wearable computing* (Thorp, 1998) becomes infrastructure: a 1998 memoir of a 1961 device broke the Literature arc (coherence M4). *Model generation*'s Moto-oka (1982) becomes a Handbook note.

**Definitions** (R3-accuracy §1–§2; coherence §2.2): *Deep learning* "Many layers of features, learned one layer at a time."; *Process node* "Components per chip double at a steady rate." (no Rock's law); *Formal verification* gains King (1969); *Embodied agents* "Legs coordinated by local reflexes, not a central plan."; *Data parallelism* "Many machines …"; *Expert iteration*, *Integrated circuit*, *Switching circuits*, *Learning curve*, *Expected utility*, *Information theory*, *Cybernetics*, *Watermarking*, *Isotope separation* as R3-accuracy proposes; *Prior art* "Known before the charter."; *Research productivity* "Output per researcher."; *Mobile automata* "A machine that plans its own movements."

**Mechanics:** *Time-sharing* unlocks the Terminal and requires *Packet switching* (DECISIONS §23d); every System-card-only technology takes 60 s per unit (§23c); *Model generation* carries `multiplier_from` (impl J14); *Nanofabrication* applies to the base Accelerator only (§30); *Microfluidic cooling* doubles the Dry cooler and Water exchanger, not the cooling tower (R3-accuracy §2.3); *Packet switching* loses its exchange-taps effect, which had no meaning (impl J22); *Explosive yield 1* gains land mines +25% (impl N21); *Rocketry* requires *Explosives* and *Game theory*, not *Information theory* (coherence m19); *Energy per operation* gets its own effect type `compute-energy-floor`; *Scaling laws* also unlocks the empty launch; *Interpretability* lists its effects so that its note follows "Checkpoint quality is shown."

### 8.3 Round 5: R5-gate's decisions (DECISIONS §40)

**Added (1, hidden):** *Loop closed* (`loop-closed`, T08): a trigger technology that completes on the first *Research run* (a craft-recipe trigger, count 1), which is the closure event of DECISIONS §16. It is never shown, unlocks nothing and counts in no readout (R5-gate D9).

**Prerequisites changed:** *Model generation*, *Wafer-scale integration*, *Fusion power*, *Research scheduling*, *Two-phase cooling*, *Fleet scheduling* and *Sparse inference* require *Loop closed* in place of *Automated research*, which *Loop closed* requires. Every technology paid in System cards alone therefore waits for closure, the Constructor included (04 §2.5): a player who stocks frontier-run cards can no longer research the takeoff before building a hall.

**Data:** `meta.endgame.takeoff_order` is a list, the order *Research scheduling* follows (D10); `meta.world_settings.returns_to_research`'s default r is ln 2 / ln 1.5, shown as 1.71 (D12b), which moves the System-card totals of §6 slightly.
"""

OBJECTIONS = [  # (documents, text): rendered into 02 and/or 05; one source, no duplicate blocks (impl N27)
    (("02", "05"), "**Proceedings after blue.** D's recipe (adversarial sets and benchmarks) puts the black pack behind *Paraphrase generation*, so *Game theory*, priced in Memos and Reports, waits for a blue technology. Nothing needs the black pack before deployments (purple), and Branch M is optional, so this stays. A pacing model should treat *Game theory* as blue-gated."),
    (("05",), "**Yellow requires the purple gateway** (*Expected utility* ← *Deep learning*), because Model cards take Ratings. Factorio players expect yellow and purple to be parallel."),
    (("02",), "**Invented numbers to check against data:** the Arc turret's draw (3 MW, an estimate of the Tesla turret), the Interceptor bay's 200 kW, the fusion power cell's recipe (2 Steel + 1 U-238 + 200 Water: the continent has no lithium), the Verifier's recipe and the Comparators' values (2.0 quality mod), the Terminal's 30 kW and recipe (fun's proposal), and the rocks' sizes (ISO from memory; 2.0's yields)."),
    (("05",), "**Research productivity costs ×2 per level** (E, G, H) against Space Age's ×1.2: a BEND that A flags. Kept, as G's rule for post-takeoff research; the cost table carries Rock's law and Bloom et al. silently."),
    (("05",), "**Takeoff order.** Prerequisites cannot name a level of *Model generation*, so after *Loop closed* a player may research the hardware in any order by hand; *Research scheduling* follows `meta.endgame.takeoff_order`, R2-W's order, which the φ costs assume (R5-gate D10)."),
    (("05",), "**Mining productivity keeps E's name** rather than H's \"Archive yield\": it applies to every drill, archives included."),
    (("02", "05"), "**Text budget, read literally.** DECISIONS §34 asks for about one description in five items and buildings, and 08 §5.1 #11 for text on at most one technology in three. Items: {n_item} of {n_items} carry a description (building items show their building's); buildings {n_ent} of {n_ents}; technologies {n_tech} of {n_techs} carry a definition or a note. The Researcher's {n_res}-character line exceeds 08's 60-character item budget; it is on the 34-line keep-list, so `meta.checks.long_item_desc_ok` names it."),
    (("02",), "**Solar panel: no description** rather than R3-accuracy §2.4's \"60 kW in full sun.\". The error accuracy found was the claim; the replacement restates the stat line (coherence M2, M5), so the line is cut. Flagged under DECISIONS §36."),
    (("05",), "**Bucilă, not Buciluǎ.** R3-accuracy §4 called the data's U+01CE spelling correct. The KDD'06 camera-ready byline reads \"Cristian Bucilă\" (U+0103, the Romanian letter); the ACM and Crossref spelling comes from a mangled LaTeX accent. The data follows the paper's byline. Flagged under DECISIONS §36."),
    (("05",), "**Hollerith (1889) is in issue 3, not 16.** R3-accuracy gave *The Quarterly* 10(16). The scan's masthead reads \"Vol. X. April, 1889. No. 3\"; \"16\" is the printer's signature mark at the foot of p. 241. The data cites 10(3). Flagged under DECISIONS §36."),
    (("05",), "**Beyond technologies that exist today.** *Wafer-scale integration*, *Photonic interconnect*, *Two-phase cooling*, *Fleet scheduling*, *Sparse inference* and *Weight transplant* describe engineering that exists now. They are `beyond` by E's regime and 01 §12.1's rule (uncited takeoff technologies read 2025), because in the game they are the takeoff's own work. Making them `infrastructure` would barely move the readouts, since *Model generation* sets \"years ahead\" during the takeoff."),
    (("05",), "**Expert iteration** (5,000 × RGBP · 15 s) is Factorio 2.0 quality's *recycling* technology, ISO (fun FUN-14 asked)."),
    (("02",), "**Proceedings stays light** (balance m8: 15 machines and 2.5 MW per pack/s against Factorio's 35 and 6.1). It is optional under Contained; if parity is wanted, add 1 Evaluation set per craft."),
    (("05",), "**Every System-card-only technology takes 60 s**, *Energy per operation* included, although DECISIONS §23c names the takeoff: one rule for one cost class. *Energy per operation* comes after victory, so no takeoff number moves."),
]


def render_objections(doc, ctx):
    d = ctx.d
    counts = dict(n_item=sum(1 for i in d["items"] if i.get("desc")), n_items=len(d["items"]),
                  n_ent=sum(1 for e in d["entities"] if e.get("desc")), n_ents=len(d["entities"]),
                  n_tech=sum(1 for t in d["technologies"] if t.get("desc") or t.get("note")),
                  n_techs=sum(1 for t in d["technologies"] if not t.get("hidden")),
                  n_res=len(d["items_by"]["researcher"]["desc"]))
    items = [text.format(**counts) if "{n_" in text else text for docs, text in OBJECTIONS if doc in docs]
    body = "\n".join(f"{i}. {t}" for i, t in enumerate(items, 1))
    other = "05-research.md" if doc == "02" else "02-economy.md"
    return (f"\n## Objections and open issues (hand-written)\n\nRound 2's objections on the experiment loop, the "
            f"unarmed vehicle, the hall's leak tier, the assembler technologies' names, the quality module's name and "
            f"Rosenthal's citation are resolved (DECISIONS §22, §38, §28; coherence M9; R3-accuracy §4). The rest, and "
            f"round 4's own, follow; {other} lists the ones that concern it.\n\n{body}\n")


def main():
    """Write 02 and 05. With --check, write nothing: compare the rendering with the files on disk and exit 1
    if either is stale (someone edited the data without re-rendering, or edited the generated file by hand)."""
    ctx = Ctx(load())
    out = {SPEC / "02-economy.md": render_economy(ctx), SPEC / "05-research.md": render_research(ctx)}
    if "--check" in sys.argv:
        stale = [p.name for p, text in out.items() if not p.exists() or p.read_text() != text]
        if stale:
            print(f"STALE: {', '.join(stale)} differ from the data; run `gamedev-python tools/render_spec.py`")
            sys.exit(1)
        print("02-economy.md and 05-research.md match the data")
        return
    for p, text in out.items():
        p.write_text(text)
    print(f"wrote {SPEC / '02-economy.md'} and {SPEC / '05-research.md'}")


if __name__ == "__main__":
    main()
