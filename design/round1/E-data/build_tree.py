import json, sys, collections, re, importlib.util, math

BASE = "/tmp/claude-1002/R1-E/"
spec = importlib.util.spec_from_file_location("tree_data", BASE + "tree_data.py")
D = importlib.util.module_from_spec(spec); spec.loader.exec_module(D)

fact = json.load(open(BASE + "tech2077.json")) + json.load(open(BASE + "techq.json"))
fact = [t for t in fact if t.get("type") == "technology"]
FBY = {t["name"]: t for t in fact}
LET = {k: v[0] for k, v in D.PACKS.items()}

TRIGGER_TIER = {"steam-power": "R", "electronics": "R", "automation-science-pack": "R", "steel-axe": "R",
                "oil-processing": "G", "uranium-processing": "B", "space-science-pack": "W"}
GATEWAY = {"basic_research": "R", "linear_programming": "G", "game_theory": "G", "statistical_learning": "B",
           "deep_learning": "P", "expected_utility": "Y", "in_context_learning": "W"}
PACK_TECH = {"R": "basic_research", "G": "linear_programming", "M": "game_theory", "B": "statistical_learning",
             "P": "deep_learning", "Y": "expected_utility", "W": "in_context_learning"}

def pct(x):
    v = x * 100
    return f"{v:.0f}%" if abs(v - round(v)) < 1e-9 else f"{v:.1f}%"

def fmt_effects(effs):
    out = []; dropped = []
    dmg = collections.OrderedDict(); spd = collections.OrderedDict()
    for e in effs:
        t = e.get("type")
        if t == "unlock-recipe":
            r = e["recipe"]
            if r not in D.GLOSS:
                raise SystemExit(f"missing gloss for recipe {r}")
            if D.GLOSS[r] is None: dropped.append(r)
            else: out.append(D.GLOSS[r])
        elif t == "nothing": pass
        elif t == "laboratory-speed": out.append(f"Lab speed +{pct(e['modifier'])}")
        elif t == "mining-drill-productivity-bonus": out.append(f"Mining productivity +{pct(e['modifier'])}")
        elif t == "worker-robot-speed": out.append(f"Agent speed +{pct(e['modifier'])}")
        elif t == "worker-robot-storage": out.append(f"Agent cargo +{e['modifier']}")
        elif t == "bulk-inserter-capacity-bonus": out.append(f"Bulk inserter capacity +{e['modifier']}")
        elif t == "inserter-stack-size-bonus": out.append(f"Inserter capacity +{e['modifier']}")
        elif t == "train-braking-force-bonus": out.append(f"Braking force +{pct(e['modifier'])}")
        elif t == "character-mining-speed": out.append(f"Manual mining speed +{pct(e['modifier'])}")
        elif t == "character-inventory-slots-bonus": out.append(f"Inventory +{e['modifier']} slots")
        elif t == "ammo-damage":
            c = D.AMMO[e["ammo_category"]]
            if c: dmg[c] = dmg.get(c, 0) + e["modifier"]
        elif t == "turret-attack":
            c = D.TURRET[e["turret_id"]]
            dmg[c] = dmg.get(c, 0) + e["modifier"]
        elif t == "gun-speed":
            c = D.AMMO[e["ammo_category"]]
            if c: spd[c] = spd.get(c, 0) + e["modifier"]
        elif t == "maximum-following-robots-count": out.append(f"Escort cap +{e['modifier']}")
        elif t == "artillery-range": out.append(f"Artillery range +{pct(e['modifier'])}")
        elif t == "cliff-deconstruction-enabled": out.append("Cliff removal")
        elif t == "create-ghost-on-entity-death": out.append("Ghosts of destroyed entities")
        elif t == "unlock-logistic-network": pass
        elif t == "character-logistic-requests": out.append("Personal logistic requests")
        elif t == "character-logistic-trash-slots": out.append(f"{e['modifier']} trash slots")
        elif t == "vehicle-logistics": out.append("Vehicle logistics")
        elif t == "unlock-circuit-network": out.append("Circuit wires")
        elif t == "mining-with-fluid": out.append("Mining with fluid")
        elif t == "unlock-quality": out.append(f"Quality tier {D.QUALITY[e['quality']]}")
        elif t == "laboratory-productivity": out.append(f"Research productivity +{pct(e['modifier'])}")
        else: raise SystemExit(f"unknown effect {t}")
    if dmg: out.append("Damage: " + ", ".join(f"{k} +{pct(v)}" for k, v in dmg.items()))
    if spd: out.append("Fire rate: " + ", ".join(f"{k} +{pct(v)}" for k, v in spd.items()))
    return out, dropped

def trig_text(tr):
    t = tr["type"]
    if t == "craft-item":
        return f"Craft {tr.get('count', 1)} {D.GLOSS[tr['item']]}"
    if t == "mine-entity":
        ent = (tr.get("entities") or [tr.get("entity")])[0]
        return {"crude-oil": "Mine Crawl", "uranium-ore": "Mine uranium ore"}[ent]
    if t == "send-item-to-orbit":
        return "Complete a frontier run carrying a Post-training payload"
    raise SystemExit(t)

def fname(fid):
    s = fid.replace("-", " ")
    s = s[0].upper() + s[1:]
    s = re.sub(r"\bmk2\b", "MK2", s)
    return s

techs = collections.OrderedDict()
dropped_all = {}
dropped_techs = {}
for t in fact:
    fid = t["name"]
    if fid not in D.F: raise SystemExit("unmapped factorio tech " + fid)
    if D.F[fid].get("drop"): dropped_techs[fid] = D.F[fid]["reason"]
for t in fact:
    fid = t["name"]
    mp = D.F[fid]
    if mp.get("drop"): continue
    tid = mp["id"]
    if tid in techs: raise SystemExit("dup id " + tid)
    for p in t.get("prerequisites", []):
        if p in dropped_techs: raise SystemExit(f"{fid} depends on dropped {p}")
    pre = [D.F[p]["id"] for p in t.get("prerequisites", [])] + mp.get("add_pre", [])
    u = t.get("unit")
    if u:
        letters = "".join(sorted({LET[x[0]] for x in u["ingredients"]}, key=D.ORDER.index))
        if "count" in u: cost = (u["count"], letters, u["time"])
        else:
            f = u["count_formula"].replace("-", "−").replace("*", "×")
            cost = ("formula", f, letters, u["time"], "∞" if t.get("max_level") == "infinite" else str(t.get("max_level")))
        nonm = [c for c in letters if c != "M"]
        tier = max(nonm, key=D.ORDER.index)
    else:
        cost = ("trigger", trig_text(t["research_trigger"]))
        letters = ""
        tier = TRIGGER_TIER[fid]
    effs, dropped = fmt_effects(t.get("effects", []))
    if mp.get("series") == "monitor_throughput":
        mod = next(e["modifier"] for e in t["effects"] if e.get("ammo_category") == "flamethrower")
        effs = [f"Monitor cleaning rate +{pct(mod)}"]
    if dropped: dropped_all[tid] = dropped
    unl = mp.get("unlocks", effs)
    techs[tid] = dict(id=tid, name=mp["name"], mirrors=fname(fid), fid=fid, tag=mp["tag"], regime=mp["regime"],
                      tier=tier, pre=pre, cost=cost, unlocks=unl, defn=mp["defn"], cite=mp.get("cite"),
                      year=mp.get("year"), branch=mp.get("branch", "M" if "M" in letters else ""),
                      series=mp.get("series"), infinite=(t.get("max_level") == "infinite"), note=mp.get("note"),
                      essential=bool(t.get("essential")), upgrade=bool(t.get("upgrade")))
for b in D.BEND:
    tid = b["id"]
    if tid in techs: raise SystemExit("dup id " + tid)
    c = b["cost"]
    letters = c[1] if c[0] not in ("trigger", "start", "formula") else (c[2] if c[0] == "formula" else "")
    techs[tid] = dict(id=tid, name=b["name"], mirrors="—", fid=None, tag=b["tag"], regime=b["regime"], tier=b["tier"],
                      pre=b["pre"], cost=c, unlocks=b["unlocks"], defn=b["defn"], cite=b.get("cite"),
                      year=b.get("year"), branch=b.get("branch", "M" if "M" in letters else ""), series=b.get("series"),
                      infinite=b.get("infinite", False), note=b.get("note"),
                      essential=tid in ("automated_research",), upgrade=False)

# mark essential like Factorio (pack techs + silo) + automated research
# ---------------------------------------------------------------- validation
errs = []
ids = set(techs)
for t in techs.values():
    for p in t["pre"]:
        if p not in ids: errs.append(f"{t['id']}: missing prereq {p}")
names = collections.Counter(t["name"] for t in techs.values())
for n, c in names.items():
    if c > 1: errs.append(f"duplicate name {n}")
# cycles + topo order
order = []; state = {}
def visit(x, stack):
    if state.get(x) == 1: errs.append("cycle via " + "->".join(stack + [x])); return
    if state.get(x) == 2: return
    state[x] = 1
    for p in techs[x]["pre"]:
        if p in techs: visit(p, stack + [x])
    state[x] = 2; order.append(x)
for x in techs: visit(x, [])
closure = {}
def clos(x):
    if x in closure: return closure[x]
    s = set()
    for p in techs[x]["pre"]:
        s.add(p); s |= clos(p)
    closure[x] = s; return s
for x in techs: clos(x)
# pack gating
for t in techs.values():
    c = t["cost"]
    letters = c[1] if isinstance(c[0], int) else (c[2] if c[0] == "formula" else "")
    for L in letters:
        pt = PACK_TECH[L]
        if pt != t["id"] and pt not in closure[t["id"]]:
            errs.append(f"{t['id']} uses {L} but {pt} not in prereq closure")
# year constraint
for t in techs.values():
    eff_tier = GATEWAY.get(t["id"], t["tier"])
    if t["regime"] == "H":
        if not t["year"] or not t["cite"]: errs.append(f"{t['id']}: historical without cite/year")
        elif t["year"] > D.TIER_END[eff_tier]:
            errs.append(f"{t['id']}: year {t['year']} > tier {eff_tier} end {D.TIER_END[eff_tier]}")
        # citation years: max year in cite string must equal 'year'
        ys = [int(y) for y in re.findall(r"\b(1[6-9]\d\d|20\d\d)\b", t["cite"] or "")]
        if ys and max(ys) != t["year"]: errs.append(f"{t['id']}: year {t['year']} != max cited {max(ys)}")
        if ys and max(ys) > 2024: errs.append(f"{t['id']}: citation younger than two years")
    else:
        if t["cite"] or t["year"]: errs.append(f"{t['id']}: non-historical with cite")
    if len(t["defn"].split()) > 10: errs.append(f"{t['id']}: definition > 10 words: {t['defn']}")
    if re.search(r"\b(Mk|MK|advanced|smart|intelligent|neural|quantum|singularity|AGI|alignment)\b", t["name"]):
        errs.append(f"{t['id']}: banned word in name")
# coverage
mirrored = [t for t in techs.values() if t["fid"]]
if len(mirrored) + len(dropped_techs) != len(fact): errs.append("coverage mismatch")
print("ERRORS:" if errs else "No validation errors.")
for e in errs: print("  ", e)

# ---------------------------------------------------------------- stats
def letters_of(t):
    c = t["cost"]
    return c[1] if isinstance(c[0], int) else (c[2] if c[0] == "formula" else "")
cnt = collections.Counter(); packs = collections.Counter(); labsec = collections.Counter()
for t in techs.values():
    key = ("Branch M " if t["branch"] == "M" else "") + D.TIER_NAME[t["tier"]] + (" ∞" if t["infinite"] else "")
    if t["cost"][0] == "trigger": key = "Trigger"
    cnt[key] += 1
    c = t["cost"]
    if isinstance(c[0], int):
        for L in c[1]: packs[L] += c[0]
        labsec[t["tier"] + ("M" if t["branch"] == "M" else "")] += c[0] * c[2]
print("counts:", dict(cnt), "total", len(techs))
print("finite pack totals:", {L: packs[L] for L in D.ORDER})
tot_inf = sum(1 for t in techs.values() if t["infinite"])
print("infinite:", tot_inf, "trigger:", sum(1 for t in techs.values() if t["cost"][0] == "trigger"))
json.dump({k: {kk: vv for kk, vv in v.items()} for k, v in techs.items()}, open(BASE + "tree.json", "w"),
          ensure_ascii=False, indent=1)
json.dump(dropped_all, open(BASE + "dropped.json", "w"), indent=1)
json.dump(dropped_techs, open(BASE + "dropped_techs.json", "w"), indent=1)
print("dropped factorio techs:", len(dropped_techs))
print("dropped recipes:", dropped_all)
