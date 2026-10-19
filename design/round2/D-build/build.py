"""Build design/spec/data/*.yaml from D's round-1 data, E's tree and the round-2 additions.
One-off integration generator (R2-D). After it runs, the YAML files are the source of truth."""
import copy, os, re, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from text_items import SPRITE, DESC, RENAME
from new_content import NEW_ITEMS, NEW_RECIPES, RECIPE_EDITS
from new_entities import NEW_ENTITIES, COMPUTING, ENTITY_EDITS
from techs import build_techs
import meta_enemies as ME

D = "/home/mewse/browsergame/design/round1/D-data/out/data"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/mewse/browsergame/design/spec/data"


def load(kind):
    return yaml.safe_load(open(f"{D}/{kind}.yaml"))


def ordered(d, keys):
    out = {k: d[k] for k in keys if k in d and d[k] is not None}
    out.update({k: v for k, v in d.items() if k not in out and v is not None and not k.startswith("_")})
    return out


ITEM_KEYS = ["id", "name", "type", "stack", "tier", "mirrors", "sprite", "places", "fuel_value", "fuel_category",
             "module", "ammo", "armor", "equipment", "staff", "spoil", "default_temperature", "max_temperature", "tags",
             "desc"]
RECIPE_KEYS = ["id", "name", "category", "time", "ingredients", "products", "handcraft", "pseudo", "victory",
               "container", "shared_unlock", "amounts_by_j", "note", "mirrors"]
ENTITY_KEYS = ["id", "name", "type", "size", "item", "energy", "crafting_speed", "categories", "mining_speed",
               "module_slots", "staff_slots", "staff_demand", "consumes", "produces", "heat", "deploys", "extra",
               "mirrors", "desc"]
TECH_KEYS = ["id", "name", "code", "era", "prerequisites", "cost", "trigger", "count_formula", "first_level",
             "max_level", "unlocks", "essential", "upgrade", "branch", "mirrors", "citation", "year", "desc"]


# ---------------------------------------------------------------- items
def build_items(entity_desc):
    items = []
    for it in load("items"):
        it = dict(it)
        if it["id"] in RENAME:
            it["name"] = RENAME[it["id"]]
        it["sprite"] = SPRITE.get(it["id"], it.get("sprite"))
        if it["id"] in DESC:
            it["desc"] = DESC[it["id"]]
        if it.get("module"):
            it["module"] = {k: v for k, v in it["module"].items() if k != "pollution"}   # heat is energy (F)
        if it["id"] == "researcher":
            it["desc"] = "Staffs a seminar. Four accelerators and a frontier checkpoint; the checkpoint is returned."
            it["staff"] = dict(ME.STAFFING["researcher"])
            it["tags"] = ["staff", "final"]
            it["mirrors"] = "new (G's AI researcher; B L9)"
        items.append(it)
    for it in NEW_ITEMS:
        it = dict(it)
        if it.get("places") and "desc" not in it:
            it["desc"] = entity_desc[it["places"]]
        items.append(it)
    for it in items:
        if it.get("fuel_value"):
            it["fuel_value"] = it["fuel_value"] * 3          # DECISIONS §18: thermal plants conserve energy
    for it in items:
        s = it.get("sprite") or ""
        assert s and s not in ("ISO", "ISO icon"), f"sprite missing for {it['id']}"
        assert it.get("desc"), f"desc missing for {it['id']}"
    return items


# ---------------------------------------------------------------- recipes
SHARED = {"agent-hub", "passive-provider-chest", "storage-chest"}


def build_recipes():
    recipes = []
    for r in load("recipes"):
        r = dict(r)
        if r["id"] in RECIPE_EDITS:
            ed = RECIPE_EDITS[r["id"]]
            if ed is None:
                continue
            r.update(copy.deepcopy(ed))
        if r["id"] in SHARED:
            r["shared_unlock"] = True
        recipes.append(r)
    for r in recipes:
        m = re.match(r"(fill|empty)-.*-(barrel|drive)$", r["id"])
        if m:
            r["container"] = m.group(1)
    have = {r["id"] for r in recipes}
    for r in NEW_RECIPES:
        assert r["id"] not in have, r["id"]
        r = copy.deepcopy(r)
        m = re.match(r"(fill|empty)-.*-(barrel|drive)$", r["id"])
        if m:
            r["container"] = m.group(1)
        recipes.append(r)
    # the launch must come before the research hall's recipe: raw costs use the first recipe that makes an item
    return recipes


# ---------------------------------------------------------------- entities
def build_entities():
    ents = []
    for e in load("entities"):
        e = dict(e)
        e.pop("emissions_per_min", None)          # heat follows energy (L4); Factorio's pollution figure retired
        if e["id"] in COMPUTING:
            e["heat"] = {"class": COMPUTING[e["id"]], "liquid_cooling": True}
        for k, v in ENTITY_EDITS.get(e["id"], {}).items():
            if v is None:
                e.pop(k, None)
            else:
                e[k] = copy.deepcopy(v)
        e["desc"] = DESC.get(e["id"], e.get("desc"))
        if e["id"] in RENAME:
            e["name"] = RENAME[e["id"]]
        ents.append(e)
    for e in NEW_ENTITIES:
        ents.append(copy.deepcopy(e))
    for e in ents:
        en = e.get("energy") or {}
        if en.get("source") == "burner":                     # DECISIONS §18: burner draws ×3, item flows unchanged
            en["kw"] = round(en["kw"] * 3, 3)
    for e in ents:
        assert e.get("desc"), f"entity desc missing: {e['id']}"
    return ents


# ---------------------------------------------------------------- technologies
CAT_NAME = {"bullet": "magazines", "cannon-shell": "cannon shells", "rocket": "rockets", "landmine": "land mines",
            "laser": "lasers", "beam": "laser beams", "electric": "discharge", "arc": "arcs",
            "artillery-shell": "artillery shells", "gun-turret": "gun turret"}
QNAME = {q["id"]: q["name"] for q in ME.QUALITY["tiers"]}


def pc(v):
    s = f"{abs(v) * 100:.0f}"
    return ("+" if v >= 0 else "−") + s + "%"


def effects_text(effects, item_name):
    out, dmg, rate, quals = [], [], [], []
    for e in effects:
        t, v = e["type"], e.get("value")
        if t in ("ammo-damage", "turret-attack"):
            dmg.append(f"{CAT_NAME[e.get('category') or e.get('turret')]} {pc(v)}")
        elif t == "gun-speed":
            rate.append(f"{CAT_NAME[e['category']]} {pc(v)}")
        elif t == "unlock-quality":
            quals.append(QNAME[e["quality"]])
        else:
            out.append({
                "laboratory-speed": lambda: f"Lab speed {pc(v)}.",
                "research-productivity": lambda: f"Research productivity {pc(v)}.",
                "research-per-paper": lambda: "Research per paper ×2.",
                "mining-productivity": lambda: f"Mining productivity {pc(v)}.",
                "character-mining-speed": lambda: f"Hand mining speed {pc(v)}.",
                "character-crafting-speed": lambda: f"Hand-crafting speed {pc(v)}. Does not apply to machines.",
                "character-inventory-slots": lambda: f"Inventory +{v} slots.",
                "worker-robot-speed": lambda: f"Agent speed {pc(v)}.",
                "construction-agent-speed": lambda: f"Construction agent speed {pc(v)}.",
                "agent-hub-charging": lambda: f"Agent hub charging ×{e['multiplier']:g}.",
                "worker-robot-storage": lambda: f"Agent cargo +{v}.",
                "inserter-stack-size-bonus": lambda: f"Inserter capacity +{v}.",
                "bulk-inserter-capacity-bonus": lambda: f"Bulk inserter capacity +{v}.",
                "train-braking-force-bonus": lambda: f"Braking force {pc(v)}.",
                "interceptor-escort-cap": lambda: f"Interceptors aloft per bay +{v}.",
                "artillery-range": lambda: f"Artillery range {pc(v)}.",
                "monitor-rate": lambda: f"Monitor cleaning rate {pc(v)}.",
                "unlock-circuit-network": lambda: "Circuit wires.",
                "exchange-taps": lambda: "Exchanges can be tapped.",
                "radar-circuit-relay": lambda: "Radars relay circuit signals to one another.",
                "staffing-radius": lambda: f"Staffing radius ×{e['multiplier']:g}.",
                "liquid-cooling": lambda: ("Computing machines take coolant; 70% of their heat goes into it."
                                           if e["fraction"] < 0.8 else "Liquid-cooled share of heat 70% → 90%."),
                "computing-energy": lambda: f"Computing machines {pc(v)} energy.",
                "cooling-capacity": lambda: ((f"Cooler capacity {pc(v)}." if v is not None
                                              else f"Cooler capacity ×{e['multiplier']:g}.")
                                             if len(e["entities"]) == 3 else
                                             f"{' and '.join(item_name[x] for x in e['entities'])} capacity ×{e['multiplier']:g}."),
                "mining-with-fluid": lambda: "Drills can mine with a fluid.",
                "create-ghost-on-entity-death": lambda: "Destroyed entities leave ghosts.",
                "character-logistic-requests": lambda: "Personal logistic requests.",
                "character-logistic-trash-slots": lambda: f"{v} trash slots.",
                "vehicle-logistics": lambda: "Vehicle logistics.",
                "synthetic-detection": lambda: "Crawlers set machine-written text aside. Training stops losing quality to it.",
                "deployment-sigma": lambda: "Your Ratings add half as much to σ.",
                "show-model-quality": lambda: "Checkpoint quality is shown. It was always there.",
                "hollow-work-free": lambda: "Hollow work no longer consumes papers.",
                "rollback": lambda: "A checkpoint rolls a compromised machine back.",
                "system-cards-per-run": lambda: f"System cards per frontier run {pc(v)}.",
                "recipe-productivity": lambda: (f"{item_name[e['recipes'][0]]} productivity {pc(v)}"
                                                + (", all tiers." if len(e["recipes"]) > 1 else ".")),
                "hall-mode": lambda: "Research halls gain a mode: +50% output at +100% energy.",
                "research-queue-auto": lambda: "Researchers fill the research queue.",
                "weight-transplant": lambda: "A Research hall keeps its weights when its accelerators change.",
                "hall-energy": lambda: (f"Research hall energy {pc(e['multiplier'] - 1)}." if "floor" not in e
                                        else "Hall and Researcher energy ×0.9 per level, down to a floor set by the site's temperature."),
            }[t]())
    if dmg:
        out.insert(0, "Damage: " + ", ".join(dmg) + ".")
    if rate:
        out.insert(1 if dmg else 0, "Fire rate: " + ", ".join(rate) + ".")
    if quals:
        out.insert(0, ("Quality tier: " if len(quals) == 1 else "Quality tiers: ") + ", ".join(quals) + ".")
    return out


EXTRA_TEXT = {
    "in-context-learning": "Each completed frontier run returns 1,000 System cards.",
}


def tech_descs(techs, recipes, items):
    item_name = {i["id"]: i["name"] for i in items}
    rname = {}
    for r in recipes:
        rname[r["id"]] = r.get("name") or item_name[r["products"][0]["id"]]
    for t in techs:
        names, fills = [], set()
        for rid in t["unlocks"].get("recipes", []):
            r = next(x for x in recipes if x["id"] == rid)
            if r.get("pseudo"):
                continue
            m = re.match(r"(fill|empty)-.*-(drive|barrel)$", rid)
            if m:
                fills.add(m.group(2))
                continue
            names.append(rname[rid])
        for f in sorted(fills):
            names.append(f"filling and emptying {f}s")
        parts = [t["definition"].rstrip(".") + "."]
        if names:
            parts.append("Unlocks: " + ", ".join(names) + ".")
        parts += effects_text(t["unlocks"].get("effects", []), item_name)
        if t["id"] in EXTRA_TEXT:
            parts.append(EXTRA_TEXT[t["id"]])
        if t.get("citation"):
            parts.append(f"({t['citation']})")
        t["desc"] = " ".join(parts)


def tech_tiers(techs, tiers):
    idx = {p: i for i, p in enumerate(tiers)}
    by = {t["id"]: t for t in techs}
    memo = {}

    def tier(tid):
        if tid in memo:
            return memo[tid]
        t = by[tid]
        v = max([idx[p] for p in (t.get("cost") or {}).get("packs", {})] + [0])
        for p in t["prerequisites"]:
            v = max(v, tier(p))
        memo[tid] = v
        return v

    return {tid: tier(tid) for tid in by}


def fill_item_tiers(items, recipes, techs, tiers):
    tt = tech_tiers(techs, tiers)
    unlock = {}
    for t in techs:
        for r in t["unlocks"].get("recipes", []):
            unlock.setdefault(r, []).append(tt[t["id"]])
    best = {}
    for r in recipes:
        if r["id"] not in unlock:
            continue
        for p in r["products"]:
            best[p["id"]] = min(best.get(p["id"], 99), min(unlock[r["id"]]))
    for it in items:
        if it.get("tier") is None:
            if it["id"] in best:
                it["tier"] = tiers[best[it["id"]]]
            else:
                raise SystemExit(f"no tier for {it['id']}")


# ---------------------------------------------------------------- resources
ARCHIVE_PLACE = ("At towns (B L3): library stacks at the town edge; records stores in old mines beyond 512 tiles. "
                 "Totals by town class (R2-W): village 20–40k records (30% have one), college 40–80k (70%), "
                 "town 80–160k (85%), city 200–400k, metropolis 500k–1M; records stores 150–300k; all × (1 + d/2,000) "
                 "with d the distance from spawn in tiles. Amount per tile ≈ total/1,500 (16–400 tiles). The starting "
                 "college's archive holds 80,000. Finite; σ = 0 forever (low-background data).")
EXCHANGE_PLACE = ("At towns (B L3): a telegraph office in 1945, an internet exchange later; 1–4 taps per exchange, like "
                  "an oil cluster. Tappable after Packet switching. Yield per crawler 10/s × max(A/300,000, floor); "
                  "3,000 amount per 1%; −10 per cycle above the floor (ISO). Floor = f × max(1, 2^((W − 40)/20)), "
                  "f = 10/15/20/30/40% for village/college/town/city/metropolis. Closed to crawlers once σ ≥ "
                  "0.8/0.7/0.6/0.45/0.3 in the same order; Endpoints on it keep working.")


def build_resources():
    res = load("resources")
    for r in res:
        if r["id"] == "archive":
            r["autoplace"] = ARCHIVE_PLACE
        if r["id"] == "exchange":
            r["autoplace"] = EXCHANGE_PLACE
            r["min_yield"] = 0.2
    return res


# ---------------------------------------------------------------- meta
def build_meta(recipes, entities, techs):
    m = load("meta")
    cats = sorted({r["category"] for r in recipes} | {c for e in entities for c in e.get("categories") or []})
    meta = {
        "tiers": m["tiers"],
        "crafting_categories": cats,
        "fuel_categories": ["chemical", "nuclear", "fusion"],
        "start": {"inventory": m["start"]["inventory"], "recipes": [],
                  "note": "Prior art (trigger: start) holds the start recipes; it is researched when the game begins.",
                  "salvage": ME.START_SALVAGE},
        "quality": ME.QUALITY,
        "heat": ME.HEAT,
        "staffing": ME.STAFFING,
        "runaways": ME.RUNAWAYS,
        "hollow_work": ME.HOLLOW_WORK,
        "world_text": ME.WORLD_TEXT,
        "world_settings": ME.WORLD_SETTINGS,
        "endgame": ME.ENDGAME,
        "effects": ME.EFFECTS,
        "checks": {"require_sprite": True, "require_desc": True},
    }
    return meta


# ---------------------------------------------------------------- dump
class Dumper(yaml.SafeDumper):
    pass


def _str(dumper, s):
    if "\n" in s:
        return dumper.represent_scalar("tag:yaml.org,2002:str", s, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", s)


Dumper.add_representer(str, _str)


class Block(dict):
    """A mapping always written in block style (top-level entries)."""


Dumper.add_representer(Block, lambda d, data: d.represent_mapping("tag:yaml.org,2002:map", data.items(), flow_style=False))

HEADERS = {
    "items": "# Items and fluids. Schema: SCHEMA.md. Built by R2-D from D's data plus DECISIONS/F/G/A additions.",
    "recipes": "# Recipes. Times at crafting speed 1. Pseudo-recipes make launch mechanics checkable.",
    "entities": "# Placeable entities. Heat: every machine emits its energy draw (L4); see meta.heat.",
    "technologies": "# Technologies: E's tree with D's ids (05-research.md lists every change).",
    "resources": "# Map resources.",
    "meta": "# Global settings: tiers, categories, start, quality, heat, staffing, runaways, world text, effects.",
    "enemies": "# Runaway prototypes (F §1.3). Read by the engine; the validator only counts loot as produced.",
}


def dump(kind, data):
    path = os.path.join(OUT, f"{kind}.yaml")
    if isinstance(data, list):
        data = [Block(x) for x in data]
    text = yaml.dump(data, Dumper=Dumper, sort_keys=False, allow_unicode=True, default_flow_style=None, width=4096)
    with open(path, "w") as f:
        f.write(HEADERS[kind] + "\n" + text)
    return path


def main():
    entities = build_entities()
    entity_desc = {e["id"]: e["desc"] for e in entities}
    items = build_items(entity_desc)
    recipes = build_recipes()
    techs = build_techs()
    tiers = load("meta")["tiers"]
    fill_item_tiers(items, recipes, techs, tiers)
    tech_descs(techs, recipes, items)
    for t in techs:
        t.pop("definition", None)
    resources = build_resources()
    meta = build_meta(recipes, entities, techs)
    os.makedirs(OUT, exist_ok=True)
    dump("items", [ordered(i, ITEM_KEYS) for i in items])
    dump("resources", resources)
    dump("recipes", [ordered(r, RECIPE_KEYS) for r in recipes])
    dump("entities", [ordered(e, ENTITY_KEYS) for e in entities])
    dump("technologies", [ordered(t, TECH_KEYS) for t in techs])
    dump("meta", meta)
    dump("enemies", ME.ENEMIES)
    print(f"items {len(items)}, recipes {len(recipes)}, entities {len(entities)}, techs {len(techs)}, "
          f"enemies {len(ME.ENEMIES)} -> {OUT}")


if __name__ == "__main__":
    main()
