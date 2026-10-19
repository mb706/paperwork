"""Build R1-D spec data (YAML for tools/validate_spec.py) and markdown tables for D-production.md."""
import sys
from collections import defaultdict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from d_items import ITEMS, TIERS
from d_recipes import RECIPES, Rc
from d_entities import ENTITIES
from d_techs import TECHS

OUT = Path(sys.argv[1])
(OUT / "data").mkdir(parents=True, exist_ok=True)
(OUT / "tables").mkdir(parents=True, exist_ok=True)

RESOURCES = [
    dict(id="iron-ore-patch", name="Iron ore", kind="solid", yields="iron-ore", mining_time=1, mirrors="iron-ore",
         autoplace="ISO: starting area yes; Factorio frequency, size and richness; richer with distance"),
    dict(id="copper-ore-patch", name="Copper ore", kind="solid", yields="copper-ore", mining_time=1, mirrors="copper-ore", autoplace="ISO"),
    dict(id="coal-patch", name="Coal", kind="solid", yields="coal", mining_time=1, mirrors="coal", autoplace="ISO"),
    dict(id="quartz-patch", name="Quartz", kind="solid", yields="quartz", mining_time=1, mirrors="stone",
         autoplace="ISO with stone; sand-coloured patches favour coasts and dry riverbeds"),
    dict(id="archive", name="Archive", kind="solid", yields="records", mining_time=1, mirrors="ore patch (B L3: a town library, or a records store in an old mine)",
         autoplace="at towns (B L3): library stacks on the town edge, 0-1 per town; plus records stores in old mines away from towns. "
                   "The starting college town has one small archive. Size and richness grow with distance (bigger towns, older collections); finite"),
    dict(id="uranium-ore-patch", name="Uranium ore", kind="solid", yields="uranium-ore", mining_time=2, requires_fluid="sulfuric-acid",
         mirrors="uranium-ore", autoplace="ISO: never in the starting area; 1 sulfuric acid per ore"),
    dict(id="exchange", name="Exchange", kind="fluid", yields="crawl", infinite=True, min_yield=0.2, mirrors="crude-oil",
         autoplace="at towns (B L3): a telegraph office in 1945, an internet exchange later; 1-4 taps per exchange, like an oil cluster. "
                   "Tappable after Information retrieval. ISO yield constants: 10/s per crawler at 100%, 300 cycles per 1% of yield, floor 20%. "
                   "The floor is the town's rate of new writing and may rise with W (B L8); F's (1 - s) multiplier removes the synthetic share at the well"),
    dict(id="water", name="Water", kind="offshore", yields="water", mirrors="water", autoplace="ISO lakes and coast"),
    dict(id="trees", name="Trees", kind="solid", yields="wood", mining_time=0.5, mirrors="tree", autoplace="ISO forests; hand-mined; no regrowth"),
]


def ent_item(e):
    return dict(id=e["id"], name=e["name"], type="item", stack=e["stack"], tier=None, mirrors=e["mirrors"].split(" ")[0],
                sprite=e.get("sprite", "ISO icon"), tags=["building"], places=e["id"], group="building")


def tier_of_tech(tid):
    packs = TECHS[tid][2] if tid in TECHS else [TIERS[0]]
    return max(packs, key=TIERS.index)


all_items = [dict(i) for i in ITEMS] + [ent_item(e) for e in ENTITIES]
recipes = [dict(r) for r in RECIPES]
# Factorio mechanics that are not recipes, written as pseudo-recipes so the validator can trace them.
recipes += [
    dict(Rc("boil-steam", "boiling", 1, {"water": 60}, {"steam": 60}, "boiler / heat exchanger output", "start", name="Steam (boiler)"), pseudo=True),
    dict(Rc("burn-fuel-cell", "fission", 200, {"uranium-fuel-cell": 1}, {"depleted-uranium-fuel-cell": 1}, "reactor burnt result", "nuclear-power", name="Fission (reactor)"), pseudo=True),
    dict(Rc("launch", "launch", 1, {"run-shard": 100, "post-training-payload": 1}, {"system-card": 1000}, "rocket launch with satellite", "frontier-run", name="Launch the run"), pseudo=True),
]
# catalyst recipes last, so 'first maker' heuristics (validator raw cost) pick the real producer
recipes.sort(key=lambda r: any(p.get("catalyst") and p["id"] != "uranium-235" for p in r["products"]))
for e in ENTITIES:
    recipes.append(Rc(e["id"], "crafting-with-fluid" if any(k in ("lubricant",) for k in e["ins"]) else "crafting",
                      e["time"], e["ins"], {e["id"]: e.get("produces", 1)}, e["mirrors"], e["unlock"]))
for it in all_items:
    if it["tier"] is None:
        u = next(e["unlock"] for e in ENTITIES if e["id"] == it["id"])
        it["tier"] = TIERS[0] if u == "start" else tier_of_tech(u)

# --- YAML ---
def clean_item(i):
    d = {k: v for k, v in i.items() if k not in ("group",) and v is not None}
    return d

unlocks = defaultdict(list)
start = []
for r in recipes:
    (start.append(r["id"]) if r["unlock"] == "start" else unlocks[r["unlock"]].append(r["id"]))
techs = []
for tid, (name, pre, packs, count, era) in TECHS.items():
    techs.append(dict(id=tid, name=name, era=era, prerequisites=pre,
                      cost=dict(count=count, time=30 if len(packs) > 2 else 15 if len(packs) == 2 else 10,
                                packs={p: 1 for p in packs}),
                      unlocks=dict(recipes=unlocks.get(tid, [])), mirrors="see R1-E"))
missing = set(unlocks) - set(TECHS)
assert not missing, missing

entities = []
for e in ENTITIES:
    d = dict(id=e["id"], name=e["name"], type=e["type"], size=e["size"], item=e["id"], energy=e["energy"], mirrors=e["mirrors"])
    for k in ("crafting_speed", "categories", "mining_speed", "module_slots", "emissions_per_min", "extra", "desc"):
        if k in e:
            d[k] = e[k]
    entities.append(d)

cats = sorted({r["category"] for r in recipes})
meta = dict(tiers=TIERS, crafting_categories=cats, fuel_categories=["chemical", "nuclear"],
            start=dict(inventory={"burner-mining-drill": 1, "stone-furnace": 1, "iron-plate": 8}, recipes=start))
yrec = []
for r in recipes:
    d = {k: v for k, v in r.items() if k in ("id", "name", "category", "time", "ingredients", "products", "mirrors", "pseudo")}
    if r["category"] not in ("crafting",):
        d["handcraft"] = False
    yrec.append(d)
for kind, data in (("items", [clean_item(i) for i in all_items]), ("resources", RESOURCES), ("recipes", yrec),
                   ("entities", entities), ("technologies", techs)):
    (OUT / "data" / f"{kind}.yaml").write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=200))
(OUT / "data" / "meta.yaml").write_text(yaml.safe_dump(meta, sort_keys=False))

# --- markdown tables ---
NAME = {i["id"]: i["name"] for i in all_items}
RNAME = {r["id"]: (r.get("name") or NAME.get(r["id"], r["id"])) for r in recipes}
CRAFTERS = defaultdict(list)
for e in ENTITIES:
    for c in e.get("categories", []):
        CRAFTERS[c].append(e["name"])
CRAFTERS["crafting"] = ["hand", "Assembling machine 1–3"]
CRAFTERS["training"] = ["Trainer"]
CRAFTERS["crafting-with-fluid"] = ["Assembling machine 2–3"]


def fmt(lst):
    parts = []
    for x in lst:
        a = x["amount"]
        a = int(a) if float(a).is_integer() else a
        s = f"{a} {NAME.get(x['id'], x['id'])}"
        if x.get("probability"):
            s = f"{x['probability']*100:g}% → 1 {NAME.get(x['id'], x['id'])}"
        if x.get("catalyst"):
            s += " (returned)" if x["catalyst"] == x["amount"] else f" ({x['catalyst']} returned)"
        parts.append(s)
    return " + ".join(parts)


def tier_short(t):
    return {TIERS[0]: "red", TIERS[1]: "green", TIERS[2]: "blue", TIERS[3]: "gray", TIERS[4]: "purple",
            TIERS[5]: "yellow", TIERS[6]: "white"}.get(t, t)


def write(name, text):
    (OUT / "tables" / name).write_text(text)


# resources
t = ["| Resource (map) | Kind | Yields | Mining time | Finite? | Spawn rule | Mirrors |", "|---|---|---|---|---|---|---|"]
for r in RESOURCES:
    fin = "decays to 20% floor" if r.get("infinite") else ("infinite" if r["kind"] == "offshore" else "finite")
    t.append(f"| {r['name']} | {r['kind']} | {NAME[r['yields']]} | {r.get('mining_time', '–')}"
             f"{' + 1 acid/ore' if r.get('requires_fluid') else ''} | {fin} | {r['autoplace']} | {r['mirrors']} |")
write("resources.md", "\n".join(t) + "\n")

# items by group
GROUPS = [("raw", "Raw resources"), ("fluid", "Fluids"), ("plate", "Plates"), ("component", "Components"),
          ("data", "Data products"), ("module", "Modules: where compute lives"), ("frontier", "Frontier run"),
          ("paper", "Papers (science packs)"), ("agent", "Agents"), ("nuclear", "Nuclear (ISO)"), ("terrain", "Terrain (ISO)"),
          ("container", "Containers"), ("other", "Other")]
out = []
for g, title in GROUPS:
    rows = [i for i in all_items if i.get("group") == g]
    if not rows:
        continue
    out.append(f"#### {title} ({len(rows)})\n")
    out.append("| Item | Stack | Tier | Mirrors | Sprite (32 px) | Tooltip (proposal) |\n|---|---|---|---|---|---|")
    for i in rows:
        st = "fluid" if i["type"] == "fluid" else i["stack"]
        out.append(f"| **{i['name']}** `{i['id']}` | {st} | {tier_short(i['tier'])} | {i['mirrors']} | {i['sprite']} | {i.get('desc', '')} |")
    out.append("")
write("items.md", "\n".join(out))

# recipes by category (non-building)
CAT_TITLE = [("smelting", "Smelting (furnaces)"), ("transcription", "Transcription (data smelters)"),
             ("crafting", "Crafting (hand, assemblers)"), ("crafting-with-fluid", "Crafting with fluid (assembler 2–3)"),
             ("chemistry", "Chemistry (chemical plant)"), ("data-refining", "Data refining (data refinery)"),
             ("data-processing", "Data processing (data plant)"), ("training", "Training (trainer)"),
             ("centrifuging", "Centrifuging (centrifuge)"), ("frontier-run", "Frontier run (frontier cluster)")]
bld_ids = {e["id"] for e in ENTITIES}
out = []
for c, title in CAT_TITLE:
    rows = [r for r in recipes if r["category"] == c and r["id"] not in bld_ids and not r["id"].startswith(("fill-", "empty-"))]
    if not rows:
        continue
    out.append(f"#### {title} — {', '.join(CRAFTERS[c])}\n")
    out.append("| Recipe | Ingredients | Products | Time (s) | Mirrors | Unlock group |\n|---|---|---|---|---|---|")
    for r in rows:
        out.append(f"| {RNAME[r['id']]} | {fmt(r['ingredients'])} | {fmt(r['products'])} | {r['time']:g} | {r['mirrors']} | {r['unlock']} |")
    out.append("")
write("recipes.md", "\n".join(out))

# buildings
out = ["| Building | Type | Size | Speed | Power | Slots | Emis./min | Notes | Recipe (time) | Mirrors | Unlock |", "|---|---|---|---|---|---|---|---|---|---|---|"]
for e in ENTITIES:
    spd = e.get("crafting_speed", e.get("mining_speed", ""))
    en = e["energy"]
    pw = "–" if en["source"] == "none" else (f"{en['kw']:g} kW" if en["kw"] < 1000 else f"{en['kw']/1000:g} MW") + (" burner" if en["source"] == "burner" else "")
    ex = e.get("extra") or {}
    notes = ", ".join(f"{k}={v}" for k, v in ex.items())
    if e.get("categories") and e["type"] in ("assembler", "furnace", "rocket-silo"):
        notes = ("crafts: " + "/".join(e["categories"]) + ("; " + notes if notes else ""))
    rec = fmt([{"id": k, "amount": v} for k, v in e["ins"].items()]) + f" ({e['time']:g})" + (f" → {e['produces']}" if e.get("produces") else "")
    out.append(f"| **{e['name']}** | {e['type']} | {e['size'][0]}×{e['size'][1]} | {spd} | {pw} | {e.get('module_slots', '')} | "
               f"{e.get('emissions_per_min', '')} | {notes} | {rec} | {e['mirrors']} | {e['unlock']} |")
write("buildings.md", "\n".join(out) + "\n")
sp = ["| New or renamed building | Sprite (icon and entity) | Tooltip (proposal) |", "|---|---|---|"]
for e in ENTITIES:
    if e.get("sprite") or e.get("desc"):
        sp.append(f"| **{e['name']}** | {e.get('sprite', 'ISO')} | {e.get('desc', '')} |")
write("building_sprites.md", "\n".join(sp) + "\n")

# tech skeleton
out = ["| Unlock group | Packs | Prerequisites | Unlocks |", "|---|---|---|---|"]
for t_ in techs:
    out.append(f"| {t_['name']} `{t_['id']}` | {', '.join(tier_short(p) for p in t_['cost']['packs'])} | {', '.join(t_['prerequisites']) or '–'} | "
               f"{', '.join(RNAME.get(r, r) for r in t_['unlocks']['recipes'] if not r.startswith(('fill-', 'empty-')))} |")
write("techs.md", "\n".join(out) + "\n")

n_items = sum(1 for i in all_items if i["type"] == "item")
n_fluids = sum(1 for i in all_items if i["type"] == "fluid")
print(f"items {n_items} fluids {n_fluids} recipes {len(recipes)} entities {len(ENTITIES)} techs {len(techs)} start {len(start)}")
