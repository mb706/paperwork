#!/usr/bin/env gamedev-python
"""Check and render the vertical slice (design/spec/09-vertical-slice.md) from the spec data.

The slice is a filter over design/spec/data (DECISIONS §15, §17). Its *source* is the manifest
block in 09 §2.7: the keys `technologies`, `resources`, `scenery` and `tiers`. Everything else is
derived from the data, never typed by hand:

    start_recipes   = Prior art's unlocks
    recipes         = every recipe unlocked by Prior art or a listed technology (pseudo recipes refused)
    items           = the closure of those recipes (ingredients and products), the fluids the placed
                      entities consume and produce, resource yields, the start inventory, the salvage,
                      trigger targets and the tiers' papers
    entities        = the entities those items place
    tiles           = every generated tile (no `placed_by`) plus the tiles the filtered items place
    world_objects   = world.yaml's objects (trees, rocks, campus, landmarks); their yields join the items

The filtered data set is then run through tools/validate_spec.py's own functions (index, DAG,
coverage, research playthrough, closures, pack totals, raw costs), plus the slice's own checks:
prerequisites stay inside, every listed id exists, scenery is a resource or entity, every Memo- or
Report-tier technology left out has a stated reason. Finally the script rewrites two generated
regions of 09: `verification` (§1) and `content` (§2.1–§2.7).

Run from the repository root after editing 09's manifest source keys or the data:

    gamedev-python tools/render_slice.py            # check, then rewrite 09's generated regions
    gamedev-python tools/render_slice.py --check    # check only; exit 1 on any error or a stale 09

Owner: R4-ui (DECISIONS, round-4 ownership additions).
"""
import copy
import re
import sys
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import validate_spec as vs  # noqa: E402  (same directory; reuse its load/producible/playthrough)

DATA = ROOT / "design/spec/data"
SLICE_MD = ROOT / "design/spec/09-vertical-slice.md"

REGION = re.compile(r"(<!-- render_slice:(?P<name>[a-z]+) -->\n)(?P<body>.*?)(<!-- /render_slice:(?P=name) -->)",
                    re.S)
MANIFEST = re.compile(r"```yaml\n(slice:.*?)```", re.S)

# Hand-written notes carried by the generated tables (keyed by data id; a missing note is blank).
RESOURCE_NOTES = {
    "iron-ore-patch": "Starting patch (01 §4, §9); hand and drills",
    "copper-ore-patch": "Starting patch (01 §4, §9)",
    "coal-patch": "Starting patch (01 §4, §9)",
    "quartz-patch": "Starting patch (01 §4, §9); rocks also yield quartz",
    "archive": "Library stacks at colleges and towns; records stores beyond 512 tiles (01 §6). Mined like ore",
    "water": "Offshore pump",
    "trees": "Hand-mined for wood; no regrowth",
    "uranium-ore-patch": "Generated beyond 512 tiles; nothing in the slice uses the ore",
    "exchange": "Scenery: generated with towns, tooltip only; no Crawler or Endpoint exists",
}
ENTITY_NOTES = {
    "seminar": "Plus the staff slot (DECISIONS §7), drawn and dimmed; no Researcher exists in the slice",
    "keypunch": "A burner data smelter: records → tokens (01 §11)",
    "boiler": "1 water → 10 steam (10 §5.8); emits no heat itself (DECISIONS §24)",
    "steam-engine": "Emits 2 × its current output as heat (DECISIONS §24)",
    "solar-panel": "Output × sunlight s(y) × daylight (01 §3)",
    "radar": "One more comes in the salvage crate (§4)",
    "wooden-chest": "Displayed as File drawer",
}
# Memo- and Report-tier technologies left out of the slice, by reason (§2.6). Every such technology
# must be listed; the script fails otherwise. Ids absent from the data are ignored.
OUT_REASONS = OrderedDict([
    ("Repair packs have nothing to repair: no damage source exists in the slice",
     ["maintenance"]),
    ("No consumer in the slice; pumps and tanks need the engine",
     ["engine", "disk-storage", "fluid-handling"]),
    ("Trains and vehicles: I's M4 UI, 10 §12 M2",
     ["railway", "semaphores", "automobile", "fluid-wagon"]),
    ("The circuit network and data lines (I's M3 UI, 10 §12 M2); Time-sharing's Terminal needs data lines, so "
     "Time-sharing leaves with them. R stays 48 in the slice",
     ["cybernetics", "packet-switching", "time-sharing"]),
    ("The data chain (with the Trainer and checkpoints), coal chemistry and chips: the next milestone (10 §12 M2)",
     ["crawling", "text-categorization", "cross-validation", "sulfur-processing", "integrated-circuit",
      "information-theory", "explosives", "batteries", "accumulators", "batch-processing",
      "batch-size-1", "batch-size-2", "mining-productivity-1", "statistical-learning", "hypothesis-testing",
      "isotope-separation", "perceptron"]),
    ("Cliff explosives need *Terminal ballistics* (Branch M), so they come with M3 (10 §12)",
     ["cliff-explosives"]),
    ("Modules and quality: later milestones (10 §12 M2, M3)",
     ["pipelining", "backpropagation", "cmos", "rejection-sampling"]),
    ("Equipment: needs Branch M and integrated circuits",
     ["wearable-computing", "portable-solar", "night-vision", "belt-immunity", "personal-battery"]),
    ("Cooling: nothing throttles in the slice (§11 #1)",
     ["evaporative-cooling"]),
    ("Branch M: peaceful by construction, no weapons (DECISIONS §3)",
     ["ballistics", "protective-clothing", "fire-control", "fences", "gates", "penetration-testing",
      "terminal-ballistics", "game-theory", "projectile-damage-1", "projectile-damage-2", "rate-of-fire-1",
      "rate-of-fire-2", "explosive-yield-1"]),
])
ENTITY_GROUPS = OrderedDict([
    ("Extraction", ("mining-drill", "offshore-pump", "pumpjack")),
    ("Smelting and transcription", ("furnace",)),
    ("Assembly", ("assembler",)),
    ("Research", ("lab",)),
    ("Power", ("boiler", "generator", "solar-panel", "electric-pole", "accumulator")),
    ("Belts", ("belt", "underground-belt", "splitter")),
    ("Inserters", ("inserter",)),
    ("Storage", ("chest", "logistic-chest", "storage-tank")),
    ("Fluids", ("pipe", "pipe-to-ground", "pump")),
])
PAPER_LETTER = {"memo": "M", "report": "R"}


# ------------------------------------------------------------------ helpers
def num(x):
    if isinstance(x, float) and not x.is_integer():
        return f"{x:,.2f}".rstrip("0").rstrip(".")
    return f"{int(round(x)):,}"


def cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ")


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(cell(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def bt(ids):
    return ", ".join(f"`{i}`" for i in ids)


def world_objects(full):
    w = full.get("world") or []
    return w if isinstance(w, list) else w.get("objects", [])


def salvage_items(meta):
    s = (meta.get("start") or {}).get("salvage") or {}
    out = set(s.get("per_piece") or {}) | set(s.get("crate") or {}) | set(s.get("contents") or {})
    for part in ("pieces", "crate"):  # tolerate the nested shape
        if isinstance(s.get(part), dict) and isinstance(s[part].get("yields"), dict):
            out |= set(s[part]["yields"])
    return {i for i in out if isinstance(i, str)}


# ------------------------------------------------------------------ citations (08 §9.1)
def _surname(a):
    if isinstance(a, dict):
        return a.get("family") or a.get("surname") or a.get("name", "?")
    a = str(a).strip()
    return a.split(",")[0].strip() if "," in a else a.split()[-1]


def citations(t):
    """[(surnames, year)] from DECISIONS §35's `citation` (a list of {authors, year, …}, or one such
    mapping), an old `cite` list, or the round-2 string 'Name, 1938; Other, 1947'."""
    c = t.get("citation", t.get("cite"))
    if not c:
        return []
    if isinstance(c, dict):
        c = [c]
    out = []
    if isinstance(c, list):
        for x in c:
            authors = x.get("authors", x.get("author", []))
            if isinstance(authors, str):
                authors = [authors]
            out.append(([_surname(a) for a in authors], int(x["year"])))
    else:
        for part in str(c).split(";"):
            m = re.match(r"\s*(.*?),\s*(\d{4})\s*$", part)
            if m:
                out.append(([m.group(1)], int(m.group(2))))
    return sorted(out, key=lambda z: z[1])


def short_form(t):
    parts = []
    for names, year in citations(t):
        if len(names) == 1:
            who = names[0]
        elif len(names) <= 4:
            who = ", ".join(names[:-1]) + " & " + names[-1]
        else:
            who = names[0] + " et al."
        parts.append(f"{who}, {year}")
    return "; ".join(parts)


def regime(t):
    if "regime" in t:
        return t["regime"]
    return "cited" if citations(t) else "infrastructure"  # round-2 data had no regime field


def lit_year(t):
    ys = [y for _, y in citations(t)]
    return max(ys) if ys and regime(t) == "cited" else None


# ------------------------------------------------------------------ effect lines (meta.effects.<type>.line)
def _signed(v, pct=False):
    s = num(abs(v) * (100 if pct else 1))
    return ("−" if v < 0 else "+") + s + ("%" if pct else "")


def effect_line(full, e):
    spec = (full["meta"].get("effects") or {}).get(e.get("type"))
    line = spec.get("line") if isinstance(spec, dict) else None
    names = {k: {x["id"]: x.get("name", x["id"]) for x in full[k]} for k in ("recipes", "entities", "items")}
    fields = {k: v for k, v in e.items() if isinstance(v, (str, int, float))}
    v = e.get("value")
    if isinstance(v, (int, float)):
        fields["pct"] = _signed(v, pct=True)
        fields["n"] = _signed(v)
    if isinstance(e.get("multiplier"), (int, float)):
        fields["mult"] = "×" + num(e["multiplier"])
    if isinstance(e.get("fraction"), (int, float)):
        fields["fraction"] = num(e["fraction"] * 100) + "%"
    for k, kind in (("recipes", "recipes"), ("entities", "entities")):
        if e.get(k):
            fields[k] = ", ".join(names[kind].get(i, names["items"].get(i, i)) for i in e[k])
    if line is None:  # meta.effects without line templates (round-2 data): a plain fallback
        if isinstance(v, int) and abs(v) > 1:
            return f"{e.get('type', '?')} {fields['n']}"
        return f"{e.get('type', '?')} {fields.get('pct', fields.get('mult', ''))}".strip()
    try:
        return line.format(**fields)
    except (KeyError, IndexError, ValueError):
        return line


# ------------------------------------------------------------------ the filter
def read_source(text):
    m = MANIFEST.search(text)
    if not m:
        raise SystemExit("09 has no ```yaml slice: block")
    import yaml
    src = yaml.safe_load(m.group(1))["slice"]
    for k in ("technologies", "resources", "tiers"):
        if k not in src:
            raise SystemExit(f"09's manifest lacks the source key `{k}`")
    src.setdefault("scenery", [])
    return src


def derive(full, ix, src, errors):
    techs, recs, items_by, ents = ix["technologies"], ix["recipes"], ix["items"], ix["entities"]
    tlist = list(src["technologies"])
    for t in tlist:
        if t not in techs:
            errors.append(f"technology `{t}` is not in technologies.yaml")
    pa = techs.get("prior-art")
    if not pa:
        errors.append("technology `prior-art` is missing")
    start = list((pa or {}).get("unlocks", {}).get("recipes", []))
    unlocked = []
    for t in ["prior-art"] + [t for t in tlist if t in techs]:
        for r in techs[t]["unlocks"].get("recipes", []):
            if r not in recs:
                errors.append(f"`{t}` unlocks unknown recipe `{r}`")
            elif recs[r].get("pseudo"):
                errors.append(f"`{t}` unlocks pseudo recipe `{r}`; the slice must not contain one")
            elif r not in unlocked:
                unlocked.append(r)
        for p in techs[t].get("prerequisites", []):
            if p not in tlist and p != "prior-art":
                errors.append(f"`{t}` requires `{p}`, which is outside the slice")
    items = set()
    for r in unlocked:
        for x in recs[r]["ingredients"] + recs[r]["products"]:
            items.add(x["id"])
    for res in src["resources"]:
        r = ix["resources"].get(res)
        if not r:
            errors.append(f"resource `{res}` is not in resources.yaml")
        else:
            items.add(r["yields"])
            if r.get("requires_fluid"):
                pass  # hand-minable (ISO); the drill's fluid is outside the slice by design
    start_meta = full["meta"].get("start") or {}
    items |= set(start_meta.get("inventory") or {})
    items |= salvage_items(full["meta"])
    for t in tlist:
        trig = (techs.get(t) or {}).get("trigger") or {}
        if trig.get("item"):
            items.add(trig["item"])
    items |= set(src["tiers"])
    for w in world_objects(full):  # trees and rocks: hand-mined by the player (world.yaml)
        items |= set((w.get("yields") or {}))
    changed = True
    while changed:  # fluids the placed entities consume or produce (steam has no recipe)
        changed = False
        for i in list(items):
            e = ents.get((items_by.get(i) or {}).get("places", ""))
            for f in (e or {}).get("consumes", []) + (e or {}).get("produces", []):
                if f not in items:
                    items.add(f)
                    changed = True
    for i in sorted(items):
        if i not in items_by:
            errors.append(f"item `{i}` is not in items.yaml")
    entities = sorted({items_by[i]["places"] for i in items if i in items_by and items_by[i].get("places")})
    for e in entities:
        if e not in ents:
            errors.append(f"entity `{e}` (placed by an item) is not in entities.yaml")
    for s in src["scenery"]:
        if s not in ix["resources"] and s not in ents:
            errors.append(f"scenery `{s}` is neither a resource nor an entity")
    tiles = None
    tl = full.get("tiles")
    if tl:
        tl = tl if isinstance(tl, list) else tl.get("tiles", [])
        known = {t["id"] for t in tl}
        placed = {}
        for i in items:
            pt = (items_by.get(i) or {}).get("places_tile")
            if pt:
                placed[pt] = i
                if pt not in known:
                    errors.append(f"item `{i}` places unknown tile `{pt}`")
        tiles = sorted({t["id"] for t in tl if not t.get("placed_by")} | set(placed))
    return start, unlocked, items, entities, tiles


def filtered(full, ix, src, unlocked, items, entities):
    """The slice as a stand-alone data set, for validate_spec's functions."""
    meta = copy.deepcopy(full["meta"])
    meta["tiers"] = list(src["tiers"])
    meta.setdefault("start", {})["recipes"] = []
    cats = {ix["recipes"][r]["category"] for r in unlocked}
    cats |= {c for e in entities for c in ix["entities"][e].get("categories") or []}
    meta["crafting_categories"] = sorted(cats)
    return {
        "items": [ix["items"][i] for i in ix["items"] if i in items],
        "recipes": [ix["recipes"][r] for r in ix["recipes"] if r in unlocked],
        "entities": [ix["entities"][e] for e in ix["entities"] if e in entities],
        "technologies": [ix["technologies"][t] for t in ix["technologies"]
                         if t in set(src["technologies"]) | {"prior-art"}],
        "resources": [ix["resources"][r] for r in ix["resources"] if r in src["resources"]],
        # validate_spec counts enemy loot as producible; world objects (trees, rocks) are hand-mined
        # the same way, so their yields enter the playthrough through one pseudo-entry.
        "enemies": [{"id": "world-objects", "loot": {i: 1 for w in world_objects(full)
                                                     for i in (w.get("yields") or {})}}],
        "meta": meta,
    }


# ------------------------------------------------------------------ rendering
def tech_cost(x):
    trig = x.get("trigger")
    if trig:
        if trig.get("type") == "start":
            return "Researched at start"
        verb = {"craft-item": "craft", "mine-entity": "mine", "build-entity": "build"}.get(trig["type"], trig["type"])
        what = trig.get("item") or trig.get("entity")
        return f"Trigger: {verb} {num(trig.get('count', 1))} `{what}`"
    c = x["cost"]
    letters = "+".join(PAPER_LETTER.get(p, p) for p in c["packs"])
    return f"{num(c['count'])} × {letters} · {num(c['time'])} s"


def tech_unlocks(full, x):
    rec = x["unlocks"].get("recipes", [])
    eff = [effect_line(full, e) for e in x["unlocks"].get("effects", [])]
    parts = ([bt(rec)] if rec else []) + eff + ([x["note"].rstrip(".")] if x.get("note") else [])
    return "; ".join(parts) if parts else "No effect"


def tech_cite(x):
    r = regime(x)
    return short_form(x) if r == "cited" else f"— ({r})"


def out_of_slice(ix, src):
    T = ix["technologies"]
    in_slice = set(src["technologies"]) | {"prior-art"}
    tiers = set(src["tiers"])

    def in_tier(t, seen=()):
        x = T[t]
        packs = set((x.get("cost") or {}).get("packs", {}))
        if packs:
            return packs <= tiers
        trig = (x.get("trigger") or {}).get("type")
        if trig not in ("craft-item", "mine-entity", "build-entity"):
            return False
        return all(in_tier(p, seen + (t,)) for p in x.get("prerequisites", []) if p in T and p not in seen)

    return [t for t in T if t not in in_slice and in_tier(t)]


def render_content(full, ix, src, start, unlocked, items, entities, tiles, packs, sem_s):
    I, R, E, T = ix["items"], ix["recipes"], ix["entities"], ix["technologies"]
    order = {i: n for n, i in enumerate(I)}
    out = []
    # 2.1
    out.append("### 2.1 Resources, scenery, tiles and world objects\n")
    rows = [(f"`{r}`", ix["resources"][r]["name"], f"`{ix['resources'][r]['yields']}`", RESOURCE_NOTES.get(r, ""))
            for r in src["resources"] if r in ix["resources"]]
    rows += [(f"`{s}`", (ix["resources"].get(s) or E.get(s) or {}).get("name", s), "—",
              RESOURCE_NOTES.get(s, "Scenery")) for s in src["scenery"]]
    out.append(table(["Id", "Name", "Yields", "In the slice"], rows))
    out.append("")
    if tiles is not None:
        out.append(f"**Tiles ({len(tiles)}):** {', '.join(tiles)}. κ, buildability, walking speed and map colour are "
                   "`tiles.yaml`'s.\n")
    else:
        out.append("**Tiles:** every terrain tile of 01 §2, the town tiles of 01 §5.3 and the tiles the concrete and "
                   "landfill items place (`tiles.yaml`).\n")
    wl = world_objects(full)
    if wl:
        parts = []
        for w in wl:
            y = w.get("yields")
            parts.append(f"{w['id']} ({w.get('name', w['id'])}" + (", yields " + ", ".join(
                f"{k} {v if not isinstance(v, list) else str(v[0]) + '–' + str(v[1])}" for k, v in y.items())
                if y else "") + ")")
        out.append("**World objects** (`world.yaml`; generated by worldgen, never built): " + "; ".join(parts) +
                   ". The **Laboratory salvage** is `meta.start.salvage` (§4); town buildings are town-block tiles.\n")
    else:
        out.append("**World objects:** generated by worldgen (01 §2, §5.3, §9).\n")
    # 2.2
    groups = OrderedDict([("Raw", []), ("Fluids", []), ("Intermediates", []), ("Papers", []),
                          ("Tile items", []), ("Buildings", [])])
    for i in sorted(items, key=lambda z: order.get(z, 1e9)):
        x = I.get(i, {})
        tags = x.get("tags", [])
        if x.get("places"):
            groups["Buildings"].append(i)
        elif x.get("type") == "fluid":
            groups["Fluids"].append(i)
        elif "science-pack" in tags:
            groups["Papers"].append(i)
        elif x.get("places_tile") or i in ("concrete", "hazard-concrete", "refined-concrete",
                                           "refined-hazard-concrete", "landfill"):
            groups["Tile items"].append(i)
        elif "raw" in tags:
            groups["Raw"].append(i)
        else:
            groups["Intermediates"].append(i)
    out.append(f"### 2.2 Items and fluids ({len(items)})\n")
    for g, ids in groups.items():
        if g != "Buildings":
            out.append(f"- **{g} ({len(ids)}):** {bt(ids)}.")
    out.append(f"- **Buildings ({len(groups['Buildings'])}):** the items that place the entities of §2.4.\n")
    # 2.3
    out.append(f"### 2.3 Recipes ({len(unlocked)})\n")
    bycat = OrderedDict()
    for r in unlocked:
        bycat.setdefault(R[r]["category"], []).append(r)
    rows = [(cat, ", ".join(f"`{r}` {num(R[r]['time'])} s" for r in rs)) for cat, rs in bycat.items()]
    out.append(table(["Category", "Recipes (time at speed 1)"], rows))
    out.append("")
    out.append("The start set is Prior art's unlocks (§2.5). No pseudo recipe is in the slice: a boiler turns water "
               "into steam natively, 1 : 10 (10 §5.8).\n")
    # 2.4
    out.append(f"### 2.4 Entities ({len(entities)})\n")
    rows, placed = [], set()
    for g, types in list(ENTITY_GROUPS.items()) + [("Other", None)]:
        for e in entities:
            x = E[e]
            if e in placed or (types is not None and x["type"] not in types):
                continue
            placed.add(e)
            en = x.get("energy", {})
            if en.get("source") in (None, "none"):
                energy = "—"
            elif not en.get("kw") and en.get("per_movement_kj"):
                # Inserters without a rated draw (the burner inserter): Factorio states energy per swing.
                energy = f"{en['source']} {num(en['per_movement_kj'])} kJ per move"
            else:
                energy = f"{en['source']} {num(en.get('kw', 0))} kW"
            speed = x.get("crafting_speed", x.get("mining_speed"))
            rows.append((g, f"`{e}`", x["name"], "×".join(str(s) for s in x.get("size", [])), energy,
                         num(speed) if speed is not None else "—", x.get("module_slots", 0), ENTITY_NOTES.get(e, "")))
    out.append(table(["Group", "Id", "Name", "Size", "Energy", "Speed", "Modules", "Note"], rows))
    out.append("")
    # 2.5
    out.append(f"### 2.5 Technologies ({len(src['technologies'])}, plus the start node)\n")
    out.append("Costs are the data's, which are Factorio 2.0's for every mirrored technology. \"M\" = Memo, \"M+R\" = "
               "Memo and Report. Effect lines are `meta.effects`' templates (08 §5.4). The citation column is 08 "
               "§9.1's short form, or the regime of a technology that cites nothing.\n")
    rows = []
    for t in ["prior-art"] + list(src["technologies"]):
        x = T.get(t)
        if not x:
            continue
        star = " ★" if x.get("essential") else ""
        rows.append((f"`{t}`{star}", x["name"], (x.get("mirrors") or "—").split(" ")[0],
                     ", ".join(x.get("prerequisites", [])) or "—", tech_cost(x), tech_unlocks(full, x), tech_cite(x)))
    out.append(table(["Id", "Name", "Mirrors", "Prerequisites", "Cost", "Unlocks or effect", "Citation"], rows))
    out.append("")
    reg = {k: [t for t in src["technologies"] if t in T and regime(T[t]) == k]
           for k in ("cited", "infrastructure", "beyond")}
    lit = sorted((lit_year(T[t]), t) for t in reg["cited"] if lit_year(T[t]))
    out.append(f"**Totals.** {num(sem_s)} Seminar-seconds; " +
               "; ".join(f"{num(v)} {I[p]['name']}s" for p, v in packs.items() if v) +
               f". Regimes: {len(reg['cited'])} cited, {len(reg['infrastructure'])} infrastructure, "
               f"{len(reg['beyond'])} beyond the literature." +
               (f" The latest citation is {lit[-1][0]} ({T[lit[-1][1]]['name']}), the Literature at the end of the "
                f"slice." if lit else "") + "\n")
    # 2.6
    out.append("### 2.6 Out of the slice, and why\n")
    left = out_of_slice(ix, src)
    rows = []
    for reason, ts in OUT_REASONS.items():
        present = [t for t in ts if t in left]
        if present:
            rows.append((", ".join(f"*{T[t]['name']}*" for t in present), reason))
    out.append(table(["Memo- and Report-tier technologies", "Reason"], rows))
    out.append("")
    missing = [t for t in left if not any(t in ts for ts in OUT_REASONS.values())]
    # 2.7
    out.append("### 2.7 Slice manifest\n")
    out.append("The build filter of 10 §2.4. Source keys: `technologies`, `resources`, `scenery` and `tiers`. Every "
               "other key is derived by `tools/render_slice.py`; never edit it by hand.\n")
    man = ["```yaml", "slice:",
           "  technologies: [" + ", ".join(src["technologies"]) + "]",
           "  start_recipes: [" + ", ".join(start) + "]   # = prior-art's unlocks",
           f"  recipes: unlocked   # every recipe unlocked by prior-art or a listed technology ({len(unlocked)})",
           "  items: [" + ", ".join(sorted(items)) + "]",
           "  entities: [" + ", ".join(entities) + "]"]
    if tiles is not None:
        man.append("  tiles: [" + ", ".join(tiles) + "]")
    wobj = [w["id"] for w in world_objects(full)]
    if wobj:
        man.append("  world_objects: [" + ", ".join(wobj) + "]   # world.yaml; generated, hand-mined or clicked")
    man += ["  resources: [" + ", ".join(src["resources"]) + "]",
            "  scenery: [" + ", ".join(src["scenery"]) + "]   # generated with towns, tooltip only; exempt from closure",
            "  tiers: [" + ", ".join(src["tiers"]) + "]",
            "```"]
    out.append("\n".join(man))
    lit_end = lit[-1][0] if lit else None
    return "\n".join(out) + "\n", missing, lit_end, len(reg["beyond"])


def main():
    check_only = "--check" in sys.argv
    rep = vs.Report()
    full = vs.load(DATA, rep)
    for opt in ("tiles", "world", "text"):  # until validate_spec.load reads them
        p = DATA / f"{opt}.yaml"
        if opt not in full and p.exists():
            import yaml
            full[opt] = yaml.safe_load(p.read_text())
    ix = vs.index(full, rep)
    text = SLICE_MD.read_text()
    src = read_source(text)
    errors = []
    start, unlocked, items, entities, tiles = derive(full, ix, src, errors)
    sdata = filtered(full, ix, src, unlocked, items, entities)
    srep = vs.Report()
    six = vs.index(sdata, srep)
    vs.check_tech_dag(six, srep)
    vs.check_coverage(sdata, six, srep)
    waves = vs.playthrough(sdata, six, srep)
    vs.check_closures(sdata, six, srep)
    units, _, _ = vs.pack_totals(six["technologies"])
    packs = OrderedDict((p, units.get(p, 0)) for p in src["tiers"])
    sem_s = sum(t["cost"]["count"] * t["cost"]["time"] for t in six["technologies"].values() if t.get("cost"))
    raw = vs.raw_costs(six, srep, list(src["tiers"]))
    errors += srep.errors
    content, missing, lit_end, n_beyond = render_content(full, ix, src, start, unlocked, items, entities, tiles,
                                                         packs, sem_s)
    errors += [f"Memo/Report-tier technology `{t}` is out of the slice with no reason in §2.6" for t in missing]
    fluids = sum(1 for i in items if ix["items"].get(i, {}).get("type") == "fluid")
    n_waves = max(waves.values()) if waves else 0
    lines = ["```", "$ gamedev-python tools/render_slice.py",
             f"items {len(items) - fluids}, fluids {fluids}, resources {len(src['resources'])}, "
             f"scenery {len(src['scenery'])}, recipes {len(unlocked)}, entities {len(entities)}, "
             f"technologies {len(src['technologies'])}" + (f", tiles {len(tiles)}" if tiles is not None else ""),
             f"research playthrough (validate_spec): {len(src['technologies'])} techs reachable in {n_waves} waves",
             "papers consumed by research: " + ", ".join(f"{p}={num(v)}" for p, v in packs.items())
             + f"; Seminar-seconds {num(sem_s)}",
             f"Literature at the end of the slice: {lit_end}; technologies beyond the literature: {n_beyond}"]
    for p, (c, approx) in raw.items():
        lines.append(f"raw cost of 1 {p}{' (~)' if approx else ''}: "
                     + ", ".join(f"{k} {num(v)}" for k, v in sorted(c.items(), key=lambda kv: -kv[1])))
    lines += [f"WARN  {w}" for w in srep.warnings]
    lines += [f"ERROR {e}" for e in errors]
    lines += [f"{len(errors)} errors, {len(srep.warnings)} warnings", "```"]
    verification = "\n".join(lines) + "\n"
    print(verification)
    found = {m.group("name") for m in REGION.finditer(text)}
    for name in ("verification", "content"):
        if name not in found:
            raise SystemExit(f"09 lacks the region <!-- render_slice:{name} --> … <!-- /render_slice:{name} -->")
    new = REGION.sub(lambda m: m.group(1) + {"verification": verification, "content": content}[m.group("name")]
                     + m.group(4), text)
    if check_only:
        # Also fail when 09's generated regions are stale (data edited without re-rendering, or hand edits).
        if new != text:
            print(f"STALE: the generated regions of {SLICE_MD.relative_to(ROOT)} differ from the data; "
                  f"run `gamedev-python tools/render_slice.py`")
            sys.exit(1)
        sys.exit(1 if errors else 0)
    if new != text:
        SLICE_MD.write_text(new)
        print(f"rewrote {SLICE_MD.relative_to(ROOT)}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
