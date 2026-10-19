#!/usr/bin/env gamedev-python
"""Validate the game's spec data (design/spec/data/*.yaml) — see SCHEMA.md there.

Checks, in order: per-kind schema, id uniqueness, references, the tech prerequisite DAG, recipe unlock
coverage, producibility of every item, a research playthrough that proves every technology is reachable
with what its prerequisites unlock, and a closure check that flags hidden prerequisites (a technology whose
recipes or packs need something no prerequisite unlocks). v2 (round 4) adds, each switched on by
meta.checks or by the presence of the data: tiles and world objects, the salvage, citation regimes and
long-form citations (08 §9), UI-text rules (08 §5, §10), placeholders, one expression grammar for
count_formula, field_year and amounts_by_j, productivity and quality flags, heat-emission vocabulary,
placement, effect lines, and the R4-ui text file. Round 5 (R5-apply) adds the craft-recipe trigger and hidden
technologies (R5-gate D9), the takeoff order (D10), damage categories (D13), the plasma's energy per unit (D12d)
and the numbers an achievement's text may state (D15). Then prints statistics useful for pacing.

Every v2 input is optional, so v0/v1 data (tools/testdata/spec-mini) still validates.

Usage: tools/validate_spec.py [DATA_DIR] [--quiet]
Exit status: 0 if no errors (warnings allowed), 1 otherwise.
"""
import ast
import math
import operator
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

KINDS = ["items", "resources", "recipes", "entities", "technologies"]
EXTRA_KINDS = ["tiles", "world"]          # v2 list kinds (optional)
ENTITY_TYPES = {
    "assembler", "furnace", "mining-drill", "offshore-pump", "pumpjack", "lab", "belt",
    "underground-belt", "splitter", "inserter", "chest", "pipe", "pipe-to-ground", "pump",
    "storage-tank", "boiler", "generator", "solar-panel", "accumulator", "reactor", "heat-pipe",
    "heat-exchanger", "electric-pole", "roboport", "logistic-chest", "rail", "train-stop",
    "rail-signal", "locomotive", "cargo-wagon", "fluid-wagon", "beacon", "radar", "wall", "gate",
    "turret", "rocket-silo", "combinator", "lamp", "cooler", "other",
}
CRAFTING_TYPES = {"assembler", "furnace", "rocket-silo"}
EXTRACTOR_FOR_KIND = {"solid": {"mining-drill"}, "fluid": {"pumpjack", "mining-drill"},
                      "offshore": {"offshore-pump"}}
TRIGGER_TYPES = {"start", "craft-item", "craft-recipe", "mine-entity", "build-entity", "research", "launch"}
USED_TAGS = {"module", "ammo", "final", "equipment", "armor", "installed", "staff"}
REQUIRED = {
    "items": ["id", "name", "type"],
    "resources": ["id", "name", "kind", "yields"],
    "recipes": ["id", "category", "time", "ingredients", "products"],
    "entities": ["id", "name", "type", "size", "item"],
    "technologies": ["id", "name", "prerequisites", "unlocks"],
    "tiles": ["id", "name", "kappa_per_s", "buildable", "walking_speed"],
    "world": ["id", "name", "kind", "size"],
}
REGIMES = {"cited", "infrastructure", "beyond"}
WORLD_KINDS = {"tree", "rock", "town-building", "campus", "landmark"}
EMISSIONS = {"twice-output", "none"}
MODULE_EFFECTS = {"speed", "productivity", "consumption", "quality"}
CITE_KINDS = {"article", "book", "chapter", "report", "thesis", "preprint", "patent"}
# 08 §10.2 never-list (UI text), whole words, case-insensitive unless noted
NEVER_WORDS = ["AGI", "ASI", "singularity", "alignment", "doom", "takeover", "sentient", "conscious", "Skynet",
               "slop", "hype", "vibes", "stonks", "foom", "GPU-poor", "disruptive", "synergy", "nexus", "smart",
               "intelligent", "advanced", "victory", "congratulations", "game over", "superintelligence", "rogue",
               "misaligned", "safety", "risk", "existential", "accelerationist", "decelerationist", "robot",
               "robots", "bot", "bots", "deployer", "Did you know", "In our history"]
FUTURE_WORDS = ["future", "next-generation", "novel", "revolutionary", "breakthrough", "someday", "eventually"]
UK_SPELLINGS = ["neighbour", "neighbours", "labelled", "colour", "armour", "armoured", "centre", "behaviour",
                "aluminium", "metre", "metres"]
CORPORATE = re.compile(r"\b(Inc|Corp|Corporation|Ltd|LLC|Team|Lab|Labs|OpenAI|DeepMind|Anthropic|Google|Meta|"
                       r"Microsoft|IBM)\b")
RUNTIME_PLACEHOLDERS = {"checkpoint", "tier", "t", "n", "building", "x", "y", "r", "quality", "o"}


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)


# ------------------------------------------------------------------ the one expression grammar (J18)
_BIN = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow}


def eval_expr(expr, **variables):
    """Evaluate a data expression: numbers, + - * / ^, parentheses and the field's variables (L, j, or sigma
    and c for model collapse; unknown names are refused below). '^' is exponentiation and needs an integer
    right operand after substitution."""
    if isinstance(expr, (int, float)):
        return expr
    if not isinstance(expr, str) or not re.fullmatch(r"[0-9A-Za-z_+\-*/^().\s]+", expr):
        raise ValueError(f"bad expression {expr!r}")
    tree = ast.parse(expr.replace("^", "**"), mode="eval")

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.Name):
            if node.id not in variables:
                raise ValueError(f"unknown variable {node.id!r} in {expr!r}")
            return variables[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            v = ev(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            a, b = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Pow) and float(b) != int(b):
                raise ValueError(f"'^' needs an integer exponent in {expr!r}")
            return _BIN[type(node.op)](a, b)
        raise ValueError(f"unsupported syntax in {expr!r}")

    return ev(tree)


def eval_formula(formula, level):
    """Evaluate a count formula such as '2^(L-1)*1000' at level L."""
    return eval_expr(formula, L=level)


def unit_count(formula, level):
    """A multi-level technology's unit count at level L: the formula's value rounded half up (10 §5.12)."""
    return math.floor(eval_formula(formula, level) + 0.5)


def levels(t):
    """(first, last) levels of a multi-level tech; last is None when infinite."""
    first = t.get("first_level", 1)
    last = t.get("max_level", "infinite")
    return first, (None if last == "infinite" else last)


# ------------------------------------------------------------------ loading
def load(data_dir, rep):
    data_dir = Path(data_dir)
    data = {}
    for kind in KINDS:
        path = data_dir / f"{kind}.yaml"
        if not path.exists():
            rep.warn(f"{path.name}: missing (treated as empty)")
            data[kind] = []
            continue
        content = yaml.safe_load(path.read_text()) or []
        if not isinstance(content, list):
            rep.err(f"{path.name}: top level must be a list")
            content = []
        data[kind] = content
    for kind in EXTRA_KINDS:
        path = data_dir / f"{kind}.yaml"
        content = (yaml.safe_load(path.read_text()) or []) if path.exists() else []
        if not isinstance(content, list):
            rep.err(f"{path.name}: top level must be a list")
            content = []
        data[kind] = content
    meta_path = data_dir / "meta.yaml"
    data["meta"] = (yaml.safe_load(meta_path.read_text()) or {}) if meta_path.exists() else {}
    if not meta_path.exists():
        rep.warn("meta.yaml: missing")
    enemies_path = data_dir / "enemies.yaml"
    data["enemies"] = (yaml.safe_load(enemies_path.read_text()) or []) if enemies_path.exists() else []
    text_path = data_dir / "text.yaml"
    data["text"] = (yaml.safe_load(text_path.read_text()) or {}) if text_path.exists() else {}
    return data


def index(data, rep):
    idx = {}
    for kind in KINDS + EXTRA_KINDS:
        for obj in data.get(kind) or []:
            oid = obj.get("id") if isinstance(obj, dict) else None
            if oid is None:
                continue
            key = (kind, oid)
            if key in idx:
                rep.err(f"duplicate id {oid!r} in {kind}")
            idx[key] = obj
    seen = set()
    for en in data["enemies"]:
        if en.get("id") in seen:
            rep.err(f"duplicate id {en.get('id')!r} in enemies")
        seen.add(en.get("id"))
    return {kind: {o["id"]: o for o in data.get(kind) or [] if isinstance(o, dict) and "id" in o}
            for kind in KINDS + EXTRA_KINDS}


def checks_of(data):
    return data["meta"].get("checks") or {}


# ------------------------------------------------------------------ schema
def check_schema(data, rep):
    checks = checks_of(data)
    for kind in KINDS + EXTRA_KINDS:
        for i, obj in enumerate(data.get(kind) or []):
            if not isinstance(obj, dict):
                rep.err(f"{kind}[{i}]: not a mapping")
                continue
            for field in REQUIRED[kind]:
                if field not in obj:
                    rep.err(f"{kind}[{i}] ({obj.get('id', '?')}): missing '{field}'")
    for it in data["items"]:
        if it.get("type") not in ("item", "fluid"):
            rep.err(f"item {it.get('id')}: type must be item|fluid")
        if it.get("type") == "item" and not isinstance(it.get("stack"), int):
            rep.warn(f"item {it.get('id')}: no integer stack size")
        if checks.get("require_sprite") and not it.get("sprite"):
            rep.err(f"item {it.get('id')}: no sprite line")
        for k, v in (it.get("module") or {}).items():
            if k not in MODULE_EFFECTS:
                rep.err(f"item {it.get('id')}: unknown module effect {k!r}")
    for r in data["recipes"]:
        if not isinstance(r.get("time"), (int, float)) or r.get("time", 0) <= 0:
            rep.err(f"recipe {r.get('id')}: time must be a positive number")
        if "allow_productivity" in r and not isinstance(r["allow_productivity"], bool):
            rep.err(f"recipe {r.get('id')}: allow_productivity must be true or false")
        for side in ("ingredients", "products"):
            for e in r.get(side) or []:
                if not isinstance(e, dict) or "id" not in e or "amount" not in e:
                    rep.err(f"recipe {r.get('id')}: {side} entries need id and amount")
                elif side == "products":
                    if not 0 < e.get("probability", 1) <= 1:
                        rep.err(f"recipe {r.get('id')}: probability of {e['id']} must be in (0, 1]")
                    if e.get("catalyst") and e.get("affected_by_quality", True) is not False:
                        rep.err(f"recipe {r.get('id')}: catalyst product {e['id']} needs affected_by_quality: false (L5)")
        for prod, expr in (r.get("amounts_by_j") or {}).items():
            if prod not in {p["id"] for p in r.get("products") or []}:
                rep.err(f"recipe {r.get('id')}: amounts_by_j names {prod!r}, not a product")
            for j in (0.30, 0.45, 0.55):
                try:
                    if eval_expr(expr, j=j) < 0:
                        rep.err(f"recipe {r.get('id')}: amounts_by_j {prod} is negative at j = {j}")
                except Exception as ex:  # noqa: BLE001
                    rep.err(f"recipe {r.get('id')}: {ex}")
                    break
    for e in data["entities"]:
        if e.get("type") not in ENTITY_TYPES:
            rep.err(f"entity {e.get('id')}: unknown type {e.get('type')!r}")
        size = e.get("size")
        if not (isinstance(size, list) and len(size) == 2 and all(isinstance(s, int) and s > 0 for s in size)):
            rep.err(f"entity {e.get('id')}: size must be [w, h] positive ints")
        if e.get("type") in CRAFTING_TYPES | {"lab"} and not e.get("crafting_speed"):
            rep.err(f"entity {e.get('id')}: {e.get('type')} needs crafting_speed")
        heat = e.get("heat") or {}
        if "emission" in heat and heat["emission"] not in EMISSIONS:
            rep.err(f"entity {e.get('id')}: heat.emission {heat['emission']!r} not one of {sorted(EMISSIONS)}")
        for k in e.get("allowed_effects") or []:
            if k not in MODULE_EFFECTS:
                rep.err(f"entity {e.get('id')}: allowed_effects names {k!r}")
        for k, v in (e.get("effect_receiver") or {}).items():
            if k not in ("uses_module_effects", "uses_beacon_effects") or not isinstance(v, bool):
                rep.err(f"entity {e.get('id')}: effect_receiver {k}: {v!r}")
        if e.get("effect_receiver", {}).get("uses_module_effects") is False and e.get("module_slots"):
            rep.err(f"entity {e.get('id')}: takes no module effects but has module slots")
        mir = e.get("mirrors")
        if mir is not None and not re.match(r"[a-z0-9][a-z0-9-]*(\s|$|\()", str(mir)):
            rep.err(f"entity {e.get('id')}: mirrors must start with a Factorio id or 'new' (J23): {mir!r}")
    for t in data["technologies"]:
        if ("cost" in t) == ("trigger" in t):
            rep.err(f"tech {t.get('id')}: needs exactly one of cost | trigger")
        trig = t.get("trigger")
        if trig is not None and trig.get("type") not in TRIGGER_TYPES:
            rep.err(f"tech {t.get('id')}: unknown trigger type {trig.get('type')!r}")
        if trig is not None and trig.get("type") == "craft-recipe" and not (
                isinstance(trig.get("recipe"), str) and isinstance(trig.get("count"), int) and trig["count"] > 0):
            rep.err(f"tech {t.get('id')}: a craft-recipe trigger needs a recipe and a positive integer count")
        if "hidden" in t:   # R5-gate D9: Loop closed
            if not isinstance(t["hidden"], bool):
                rep.err(f"tech {t.get('id')}: hidden must be true or false")
            elif t["hidden"]:
                if "trigger" not in t:
                    rep.err(f"tech {t.get('id')}: a hidden technology must be a trigger technology (no one can queue it)")
                if (t.get("unlocks") or {}).get("recipes") or (t.get("unlocks") or {}).get("effects"):
                    rep.err(f"tech {t.get('id')}: a hidden technology unlocks nothing; it only gates its dependents")
        if "count_formula" in t:
            if (t.get("cost") or {}).get("count") is not None:
                rep.err(f"tech {t.get('id')}: count_formula and cost.count are exclusive")
            first, last = levels(t)
            if not isinstance(first, int) or first < 1 or (last is not None and (not isinstance(last, int) or last < first)):
                rep.err(f"tech {t.get('id')}: first_level/max_level must be ints with 1 <= first <= max (or max infinite)")
            else:
                try:
                    for lv in range(first, (last if last is not None else first + 20) + 1):
                        if eval_formula(t["count_formula"], lv) <= 0:
                            rep.err(f"tech {t.get('id')}: count_formula is not positive at level {lv}")
                            break
                except Exception as ex:  # noqa: BLE001 - report any malformed formula
                    rep.err(f"tech {t.get('id')}: {ex}")
        elif "cost" in t and not isinstance((t.get("cost") or {}).get("count"), (int, float)):
            rep.err(f"tech {t.get('id')}: cost needs a count (or a count_formula)")
    for tl in data.get("tiles") or []:
        k = tl.get("kappa_per_s")
        if k is not None and not (isinstance(k, (int, float)) and k > 0):
            rep.err(f"tile {tl.get('id')}: kappa_per_s must be positive or null")
        if k is None and tl.get("buildable"):
            rep.err(f"tile {tl.get('id')}: a tile without κ cannot be buildable")
        ws = tl.get("walking_speed")
        if ws is not None and not (isinstance(ws, (int, float)) and ws > 0):
            rep.err(f"tile {tl.get('id')}: walking_speed must be positive or null")
    for w in data.get("world") or []:
        if w.get("kind") not in WORLD_KINDS:
            rep.err(f"world object {w.get('id')}: kind must be one of {sorted(WORLD_KINDS)}")
        size = w.get("size")
        if not (isinstance(size, list) and len(size) == 2 and all(isinstance(s, int) and s > 0 for s in size)):
            rep.err(f"world object {w.get('id')}: size must be [w, h] positive ints")
        if w.get("yields") and not (isinstance(w.get("mining_time"), (int, float)) and w["mining_time"] > 0):
            rep.err(f"world object {w.get('id')}: yields need a positive mining_time")
        for i, a in (w.get("yields") or {}).items():
            ok = isinstance(a, (int, float)) and a > 0 or (isinstance(a, list) and len(a) == 2 and 0 < a[0] <= a[1])
            if not ok:
                rep.err(f"world object {w.get('id')}: yield of {i} must be n or [min, max]")


# ------------------------------------------------------------------ references
def check_references(data, ix, rep):
    meta = data["meta"]
    tiers = meta.get("tiers") or []
    cats = set(meta.get("crafting_categories") or [])
    fuel_cats = set(meta.get("fuel_categories") or [])
    heat_classes = set(((meta.get("heat") or {}).get("classes") or {}).keys())
    effect_types = set((meta.get("effects") or {}).keys())
    qualities = {q.get("id") for q in ((meta.get("quality") or {}).get("tiers") or [])}
    items, ents, recs, techs, ress = ix["items"], ix["entities"], ix["recipes"], ix["technologies"], ix["resources"]
    tiles, world = ix["tiles"], ix["world"]
    v2 = bool(checks_of(data).get("text_rules"))

    for it in items.values():
        if it.get("tier") is not None and tiers and it["tier"] not in tiers:
            rep.err(f"item {it['id']}: tier {it['tier']!r} not in meta.tiers")
        if it.get("places") and it["places"] not in ents:
            rep.err(f"item {it['id']}: places unknown entity {it['places']!r}")
        if it.get("places_tile"):
            tl = tiles.get(it["places_tile"])
            if tl is None:
                rep.err(f"item {it['id']}: places_tile {it['places_tile']!r} is not a tile")
            elif tl.get("placed_by") != it["id"]:
                rep.err(f"item {it['id']}: tile {tl['id']} is placed_by {tl.get('placed_by')!r}")
        if it.get("fuel_category") and it["fuel_category"] not in fuel_cats:
            rep.err(f"item {it['id']}: unknown fuel_category {it['fuel_category']!r}")
        if it.get("spoil") and (it["spoil"].get("into") not in items):
            rep.err(f"item {it['id']}: spoils into unknown item {it['spoil'].get('into')!r}")
        hc = (it.get("staff") or {}).get("heat_class")
        if hc and heat_classes and hc not in heat_classes:
            rep.err(f"item {it['id']}: staff.heat_class {hc!r} not in meta.heat.classes")
        for ef in (it.get("staff") or {}).get("energy_scaled_by") or []:
            if effect_types and ef not in effect_types:
                rep.err(f"item {it['id']}: staff.energy_scaled_by names unknown effect {ef!r}")
    for tl in tiles.values():
        if tl.get("placed_by") and (items.get(tl["placed_by"]) or {}).get("places_tile") != tl["id"]:
            rep.err(f"tile {tl['id']}: placed_by {tl['placed_by']!r} does not place it")
        for on in tl.get("placed_on") or []:
            if on not in tiles:
                rep.err(f"tile {tl['id']}: placed_on unknown tile {on!r}")
    for w in world.values():
        for i in w.get("yields") or {}:
            if i not in items:
                rep.err(f"world object {w['id']}: yields unknown item {i!r}")
    for t in tiers:
        if t not in items:
            rep.err(f"meta.tiers: {t!r} is not an item")
    for res in ress.values():
        if res.get("yields") not in items:
            rep.err(f"resource {res['id']}: yields unknown item {res.get('yields')!r}")
        if res.get("kind") not in EXTRACTOR_FOR_KIND:
            rep.err(f"resource {res['id']}: kind must be solid|fluid|offshore")
        if res.get("requires_fluid") and res["requires_fluid"] not in items:
            rep.err(f"resource {res['id']}: unknown requires_fluid {res['requires_fluid']!r}")
    for r in recs.values():
        if cats and r.get("category") not in cats:
            rep.err(f"recipe {r['id']}: category {r.get('category')!r} not in meta.crafting_categories")
        for side in ("ingredients", "products"):
            for e in r.get(side) or []:
                if e.get("id") not in items:
                    rep.err(f"recipe {r['id']}: unknown {side[:-1]} {e.get('id')!r}")
        if r.get("handcraft") and any(items.get(e.get("id"), {}).get("type") == "fluid"
                                      for e in r.get("ingredients") or []):
            rep.err(f"recipe {r['id']}: handcraftable recipe uses a fluid")
    for e in ents.values():
        item = items.get(e.get("item"))
        if item is None:
            rep.err(f"entity {e['id']}: placing item {e.get('item')!r} unknown")
        elif item.get("places") not in (None, e["id"]):
            rep.err(f"entity {e['id']}: item {item['id']} places {item.get('places')!r} instead")
        for c in e.get("categories") or []:
            if cats and c not in cats:
                rep.err(f"entity {e['id']}: unknown crafting category {c!r}")
        for f in (e.get("consumes") or []) + (e.get("produces") or []):
            if f not in items:
                rep.err(f"entity {e['id']}: consumes/produces unknown item {f!r}")
        energy = e.get("energy") or {}
        if energy and energy.get("source") not in ("electric", "burner", "heat", "none"):
            rep.err(f"entity {e['id']}: energy.source must be electric|burner|heat|none")
        for fc in energy.get("fuel_categories") or []:
            if fc not in fuel_cats:
                rep.err(f"entity {e['id']}: unknown fuel category {fc!r}")
        hc = (e.get("heat") or {}).get("class")
        if hc and heat_classes and hc not in heat_classes:
            rep.err(f"entity {e['id']}: heat.class {hc!r} not in meta.heat.classes")
        pl = e.get("placement") or {}
        if pl.get("must_be_on") and pl["must_be_on"] not in ress:
            rep.err(f"entity {e['id']}: placement.must_be_on {pl['must_be_on']!r} is not a resource")
        touch = pl.get("must_touch")
        for tid in ([touch] if isinstance(touch, str) else (touch or [])):   # a tile id or a list of them
            if tiles and tid not in tiles:
                rep.err(f"entity {e['id']}: placement.must_touch {tid!r} is not a tile")
    packs = set(tiers)
    for t in techs.values():
        for p in t.get("prerequisites") or []:
            if p not in techs:
                rep.err(f"tech {t['id']}: unknown prerequisite {p!r}")
        for p in (t.get("cost") or {}).get("packs", {}) or {}:
            if p not in items:
                rep.err(f"tech {t['id']}: unknown pack {p!r}")
            elif packs and p not in packs:
                rep.err(f"tech {t['id']}: {p!r} is not a science pack listed in meta.tiers")
        for r in (t.get("unlocks") or {}).get("recipes") or []:
            if r not in recs:
                rep.err(f"tech {t['id']}: unlocks unknown recipe {r!r}")
        for ef in (t.get("unlocks") or {}).get("effects") or []:
            ty = ef.get("type")
            if effect_types and ty not in effect_types:
                (rep.err if v2 else rep.warn)(f"tech {t['id']}: effect type {ty!r} not listed in meta.effects")
            for r in ef.get("recipes") or []:
                if r not in recs:
                    rep.err(f"tech {t['id']}: effect names unknown recipe {r!r}")
                elif ty == "recipe-productivity" and v2 and not recs[r].get("allow_productivity"):
                    rep.err(f"tech {t['id']}: recipe-productivity on {r}, which does not allow productivity (DECISIONS §30)")
            for en in ef.get("entities") or []:
                if en not in ents:
                    rep.err(f"tech {t['id']}: effect names unknown entity {en!r}")
            if ty == "unlock-quality" and qualities and ef.get("quality") not in qualities:
                rep.err(f"tech {t['id']}: unknown quality {ef.get('quality')!r}")
            if ty == "research-per-paper" and v2 and ("multiplier" in ef or not ef.get("multiplier_from")):
                rep.err(f"tech {t['id']}: research-per-paper takes multiplier_from (the world setting), never a literal (J14)")
        trig = t.get("trigger") or {}
        if trig.get("item") and trig["item"] not in items and trig["item"] not in ents:
            rep.err(f"tech {t['id']}: trigger references unknown item {trig['item']!r}")
        if trig.get("entity") and trig["entity"] not in ents and trig["entity"] not in ress and trig["entity"] not in items:
            rep.err(f"tech {t['id']}: trigger references unknown entity {trig['entity']!r}")
        if trig.get("recipe") and trig["recipe"] not in recs:
            rep.err(f"tech {t['id']}: trigger references unknown recipe {trig['recipe']!r}")
    start = meta.get("start") or {}
    for r in start.get("recipes") or []:
        if r not in recs:
            rep.err(f"meta.start.recipes: unknown recipe {r!r}")
    for i in (start.get("inventory") or {}):
        if i not in items:
            rep.err(f"meta.start.inventory: unknown item {i!r}")
    sal = start.get("salvage") or {}
    for part in ("contents", "per_piece", "crate"):
        for i in (sal.get(part) or {}):
            if i not in items:
                rep.err(f"meta.start.salvage.{part}: unknown item {i!r}")
    for i in ((start.get("guarantees") or {}).get("inside_starting_coverage") or []):
        if i not in ress:
            rep.err(f"meta.start.guarantees: unknown resource {i!r}")
    for en in data["enemies"]:
        for i in (en.get("loot") or {}):
            if i != "plus" and i not in items:
                rep.err(f"enemy {en.get('id')}: loot names unknown item {i!r}")
    check_meta_references(data, ix, rep)


def check_meta_references(data, ix, rep):
    meta = data["meta"]
    techs, recs, ents = ix["technologies"], ix["recipes"], ix["entities"]
    for q in ((meta.get("quality") or {}).get("tiers") or []):
        if q.get("unlocked_by") and q["unlocked_by"] not in techs:
            rep.err(f"meta.quality: tier {q.get('id')} unlocked by unknown tech {q['unlocked_by']!r}")
    for m in ((meta.get("quality") or {}).get("modules") or []):
        if m not in ix["items"]:
            rep.err(f"meta.quality.modules: unknown item {m!r}")
    run = meta.get("runaways") or {}
    for t in run.get("verification_techs") or []:
        if t not in techs:
            rep.err(f"meta.runaways.verification_techs: unknown tech {t!r}")
    for b in run.get("deploying_buildings") or []:
        if b not in ents:
            rep.err(f"meta.runaways.deploying_buildings: unknown entity {b!r}")
    mc = ((meta.get("world") or {}).get("model_collapse") or {})
    for key in ("applies_to", "crawl_recipes", "synthetic_recipes"):
        for r in mc.get(key) or []:
            if r not in recs:
                rep.err(f"meta.world.model_collapse.{key}: unknown recipe {r!r}")
    if "speed_factor" in mc:   # J18: the expression is evaluated like the others (variables sigma and c)
        try:
            for sg in (0.0, 0.45, 0.9):
                for c in (0.0, 0.5, 1.0):
                    v = eval_expr(mc["speed_factor"], sigma=sg, c=c)
                    if not 0 <= v <= 1:
                        rep.err(f"meta.world.model_collapse.speed_factor is {v} at sigma {sg}, c {c}; it must lie in [0, 1]")
        except ValueError as ex:
            rep.err(f"meta.world.model_collapse.speed_factor: {ex}")
    classes = set(meta.get("town_classes") or [])
    if classes:
        for path, d in (("staffing.t0", (meta.get("staffing") or {}).get("t0")),
                        ("world.exchange.f", ((meta.get("world") or {}).get("exchange") or {}).get("f")),
                        ("world.exchange.closed_to_crawlers_at_sigma",
                         ((meta.get("world") or {}).get("exchange") or {}).get("closed_to_crawlers_at_sigma")),
                        ("staffing.university_share", (meta.get("staffing") or {}).get("university_share")),
                        ("world.archives.library_totals",
                         ((meta.get("world") or {}).get("archives") or {}).get("library_totals"))):
            for k in (d or {}):
                if k not in classes:
                    rep.err(f"meta.{path}: {k!r} is not in meta.town_classes")
    effects = meta.get("effects") or {}
    used = {ef.get("type") for t in techs.values() for ef in (t.get("unlocks") or {}).get("effects") or []}
    if checks_of(data).get("text_rules"):
        for ty in sorted(used):
            spec = effects.get(ty)
            if isinstance(spec, dict) and not spec.get("line"):
                rep.err(f"meta.effects.{ty}: no tooltip line")
        for ty in sorted(set(effects) - used):
            rep.warn(f"meta.effects.{ty}: no technology uses it")


# ------------------------------------------------------------------ citations (08 §9.3) and regimes (DECISIONS §35)
def check_citations(data, ix, rep):
    rules = data["meta"].get("citation_rules")
    if not rules:
        return
    build_year = rules.get("build_year", 2026)
    max_year = build_year - rules.get("min_age_years", 2)
    era_end = rules.get("era_end") or {}
    future = re.compile(r"\b(" + "|".join(map(re.escape, FUTURE_WORDS)) + r")\b", re.I)
    for t in ix["technologies"].values():
        tid, reg = t["id"], t.get("regime")
        if reg not in REGIMES:
            rep.err(f"tech {tid}: regime must be one of {sorted(REGIMES)} (DECISIONS §35)")
            continue
        cites = t.get("citation")
        if reg == "cited":
            if not (isinstance(cites, list) and cites):
                rep.err(f"tech {tid}: a cited technology needs a citation list")
                continue
            for c in cites:
                if not isinstance(c, dict):
                    rep.err(f"tech {tid}: citation entries are mappings")
                    continue
                auth = c.get("authors")
                if not (isinstance(auth, list) and auth and all(isinstance(a, str) and "," in a for a in auth)):
                    rep.err(f"tech {tid}: citation authors must be a list of 'Surname, I.' strings")
                elif any(CORPORATE.search(a) for a in auth):
                    rep.err(f"tech {tid}: corporate author in {auth} (08 §9.3)")
                if len(auth or []) > 10:
                    rep.err(f"tech {tid}: list at most ten authors, then more_authors: true")
                y = c.get("year")
                if not isinstance(y, int):
                    rep.err(f"tech {tid}: citation year must be an int")
                    continue
                if y > max_year:
                    rep.err(f"tech {tid}: citation year {y} is later than {max_year} (H P3)")
                end = era_end.get(t.get("era"))
                if end is not None and y > end:
                    rep.err(f"tech {tid}: citation year {y} is later than its era's end {end} ({t.get('era')})")
                if not c.get("title"):
                    rep.err(f"tech {tid}: citation needs a title")
                if c.get("kind") and c["kind"] not in CITE_KINDS:
                    rep.err(f"tech {tid}: citation kind {c['kind']!r} unknown")
        else:
            if cites:
                rep.err(f"tech {tid}: {reg} technologies carry no citation (08 §9.3)")
        if reg == "beyond":
            fy = t.get("field_year")
            if fy is None:
                rep.err(f"tech {tid}: beyond technologies need a field_year (01 §12.1)")
            else:
                first, last = levels(t) if "count_formula" in t else (1, 1)
                try:
                    v = eval_expr(fy, L=first)
                    if v < max_year:
                        rep.err(f"tech {tid}: field_year {v} is not beyond the literature ({max_year})")
                except Exception as ex:  # noqa: BLE001
                    rep.err(f"tech {tid}: field_year: {ex}")
            for k in ("desc", "note"):
                if t.get(k) and future.search(t[k]):
                    rep.err(f"tech {tid}: future word in a beyond technology's {k} (08 §10.2)")
        elif "field_year" in t:
            rep.err(f"tech {tid}: only beyond technologies carry a field_year")


# ------------------------------------------------------------------ UI text (08 §5, §10) and placeholders
def resolve_path(data, ix, obj, path):
    """A placeholder path: object-relative (extra.x), or global with a kind prefix
    (meta.a.b, entity.<id>.<path>, item.<id>.<path>, recipe.<id>.<path>, tile.<id>.<path>)."""
    parts = path.split(".")
    roots = {"entity": "entities", "item": "items", "recipe": "recipes", "tile": "tiles", "tech": "technologies",
             "technology": "technologies", "world": "world"}
    if parts[0] == "meta":
        cur, parts = data["meta"], parts[1:]
    elif parts[0] in roots and len(parts) > 1:
        cur, parts = ix[roots[parts[0]]].get(parts[1]), parts[2:]
    else:
        cur = obj
    for p in parts:
        if isinstance(cur, dict) and p == "cost_ratio" and "count_formula" in cur:
            lv = cur.get("first_level", 1)
            try:
                cur = eval_formula(cur["count_formula"], lv + 1) / eval_formula(cur["count_formula"], lv)
            except Exception:  # noqa: BLE001
                return None
        elif isinstance(cur, dict) and p in cur:
            cur = cur[p]
        elif isinstance(cur, dict) and "extra" in cur and p in cur["extra"]:
            cur = cur["extra"][p]
        elif isinstance(cur, list) and p.isdigit():
            if int(p) >= len(cur):
                return None
            cur = cur[int(p)]
        elif isinstance(cur, list) and all(isinstance(x, dict) and "id" in x for x in cur):
            hit = [x for x in cur if x["id"] == p]
            if not hit:
                return None
            cur = hit[0].get("amount", hit[0])
        else:
            return None
    return cur


def placeholders(s):
    """Data paths named by {path}, {path:fmt} or a ratio {a / b} (R4-ui, 08 P17)."""
    out = []
    for body in re.findall(r"\{([^{}:]+)(?::[^{}]*)?\}", s):
        out += [p.strip() for p in body.split(" / ")]
    return out


def lint_text(data, ix, rep):
    checks = checks_of(data)
    if not checks.get("text_rules"):
        return
    never = re.compile(r"(?<![\w-])(" + "|".join(map(re.escape, NEVER_WORDS)) + r")(?![\w-])", re.I)
    uk = re.compile(r"\b(" + "|".join(UK_SPELLINGS) + r")\b", re.I)
    you = re.compile(r"\b(you|your)\b", re.I)
    exempt_names = set(checks.get("never_list_exempt_names") or [])
    long_ok = set(checks.get("long_item_desc_ok") or [])
    surfaces = [("item", ix["items"]), ("entity", ix["entities"]), ("recipe", ix["recipes"]),
                ("tech", ix["technologies"]), ("tile", ix["tiles"]), ("world", ix["world"])]
    for kind, objs in surfaces:
        for o in objs.values():
            for field in ("name", "desc", "note", "handbook_note"):
                s = o.get(field)
                if not isinstance(s, str):
                    continue
                where = f"{kind} {o['id']}.{field}"
                m = never.search(s) or re.search(r"\bAI\b", s)
                if m and not (field == "name" and s in exempt_names):
                    rep.err(f"{where}: never-list word {m.group(0)!r} (08 §10.2)")
                if uk.search(s):
                    rep.err(f"{where}: UK spelling {uk.search(s).group(0)!r} (08 §10.3)")
                if field != "name" and you.search(s):
                    rep.err(f"{where}: second person (P7)")
                if "!" in s or "..." in s or "…" in s:
                    rep.err(f"{where}: '!' or ellipsis (P14)")
                if "σ" in s:
                    rep.err(f"{where}: the symbol σ in UI text (DECISIONS §34)")
                for ph in placeholders(s):
                    if resolve_path(data, ix, o, ph) is None:
                        rep.err(f"{where}: placeholder {{{ph}}} does not resolve")
            d = o.get("desc")
            if kind == "item" and d and len(d) > 60 and o["id"] not in long_ok:
                rep.warn(f"item {o['id']}: desc longer than 60 characters (08 §5.1)")
            if kind == "tech" and d:
                if len(d.split()) > 10:
                    rep.err(f"tech {o['id']}: definition longer than ten words (08 §5.1 #11)")
                if re.search(r"Unlocks:|\(\D+, \d{4}\)", d):
                    rep.err(f"tech {o['id']}: desc restates unlocks or a citation (DECISIONS §34)")
    sal = (data["meta"].get("start") or {}).get("salvage") or {}
    for field in ("name", "desc", "handbook_note"):
        s = sal.get(field)
        if isinstance(s, str) and never.search(s):
            rep.err(f"meta.start.salvage.{field}: never-list word")
    for en in data["enemies"]:
        for ph in placeholders(en.get("desc") or ""):
            if ph not in RUNTIME_PLACEHOLDERS:
                rep.err(f"enemy {en.get('id')}: placeholder {{{ph}}} is not a runtime variable")
    # budgets (DECISIONS §34; 08 §5.1)
    items = [i for i in ix["items"].values()]
    n_item = sum(1 for i in items if i.get("desc"))
    n_ent = sum(1 for e in ix["entities"].values() if e.get("desc"))
    n_tech = sum(1 for t in ix["technologies"].values() if t.get("desc") or t.get("note"))
    if items and n_item > len(items) / 5 * 1.25:
        rep.warn(f"item descriptions: {n_item} of {len(items)}, above about one in five (DECISIONS §34)")
    if ix["entities"] and n_ent > len(ix["entities"]) / 5 * 1.25:
        rep.warn(f"entity descriptions: {n_ent} of {len(ix['entities'])}, above about one in five (DECISIONS §34)")
    if ix["technologies"] and n_tech > len(ix["technologies"]) / 3:
        rep.warn(f"technology text: {n_tech} of {len(ix['technologies'])}, above one in three (08 §5.1 #11)")


# ------------------------------------------------------------------ text.yaml (R4-ui), when present
CONDITION_TYPES = {   # 08 §6 condition registry (text.yaml may override with `condition_types`)
    "handcraft-count", "research", "research-regime", "research-all-finite", "chunk-above-ambient",
    "research-overrun", "build-distance", "universities-staffing", "vehicle-carry-distance", "train-carry-path",
    "resource-depleted", "exchange-closed", "mine-count-while", "craft-while", "recipe-set",
    "power-rise-after-install", "installed-count", "constructor-places", "agents-built-more",
    "switch-cuts-compromised", "hollow-papers", "throttled-at-once", "frontier-run", "install-before-compromise",
    "takeoff-time", "win", "spoil-count"}
CONDITION_ID_PARAMS = {"item": "items", "items": "items", "into": "items", "vehicle": "entities",
                       "entity": "entities", "technology": "technologies", "not_researched": "technologies",
                       "resource": "resources", "recipe": "recipes"}
MILESTONE_EVENTS = {"frontier-run-returned-cards", "loop-closed", "researcher-installed", "archive-depleted",
                    "exchange-closed"}
MILESTONE_KIND = {"produce": "items", "build": "entities", "research": "technologies"}
REQUIRES = {"heat", "staffing", "exchanges", "quality", "runaways", "agents", "hollow-work", "race", "scooped"}
_CMP = re.compile(r"\s*(==|!=|<=|>=|<|>)\s*")
_PATH = re.compile(r"(?<![\w.])([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)")


def eval_assert(data, ix, expr):
    """'lhs op rhs' over numbers and data paths; returns True/False, or None when a path does not resolve."""
    parts = _CMP.split(expr)
    if len(parts) != 3:
        return None
    lhs, op, rhs = parts
    lit = re.fullmatch(r"\s*(['\"])(.*)\1\s*", rhs)
    if lit:                                   # string equality against a data path
        v = resolve_path(data, ix, {}, lhs.strip())
        if v is None:
            v = resolve_path(data, ix, {}, "meta." + lhs.strip())
        if v is None or op not in ("==", "!="):
            return None
        return (str(v) == lit.group(2)) == (op == "==")
    values = {}

    def sub(m):
        path = m.group(1)
        v = resolve_path(data, ix, {}, path)
        if v is None:
            v = resolve_path(data, ix, {}, "meta." + path)
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise KeyError(path)
        key = f"v{len(values)}"
        values[key] = v
        return key

    try:
        a = eval_side(_PATH.sub(sub, lhs), values)
        b = eval_side(_PATH.sub(sub, rhs), values)
    except (KeyError, ValueError, SyntaxError):
        return None
    return {"==": abs(a - b) <= 1e-9 * max(1, abs(a), abs(b)), "!=": a != b, "<": a < b, ">": a > b,
            "<=": a <= b, ">=": a >= b}[op]


def eval_side(expr, values):
    tree = ast.parse(expr.replace("^", "**"), mode="eval")

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.Name) and node.id in values:
            return values[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -ev(node.operand)
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            return _BIN[type(node.op)](ev(node.left), ev(node.right))
        raise ValueError(expr)

    return ev(tree)


def check_text_file(data, ix, rep):
    text = data.get("text") or {}
    if not text:
        return
    ctypes = set(text.get("condition_types") or CONDITION_TYPES)

    def ids_exist(where, kind, ids):
        for v in ids if isinstance(ids, list) else [ids]:
            if v not in ix[kind]:
                rep.err(f"text.yaml {where}: {v!r} is not in {kind}")

    def strings(o, path):
        if isinstance(o, dict):
            for k, v in o.items():
                yield from strings(v, path + [str(k)])
        elif isinstance(o, list):
            for i, v in enumerate(o):
                yield from strings(v, path + [str(i)])
        elif isinstance(o, str):
            yield ".".join(path), o

    for where, s in strings({k: v for k, v in text.items() if k != "town_names"}, []):
        if "!" in s or "..." in s or "…" in s:
            rep.err(f"text.yaml {where}: '!' or ellipsis (P14)")
        if where.endswith((".why", ".mirrors")) or ".asserts." in where:
            continue
        for ph in placeholders(s):
            if resolve_path(data, ix, {}, ph) is None and resolve_path(data, ix, {}, "meta." + ph) is None:
                rep.err(f"text.yaml {where}: placeholder {{{ph}}} does not resolve to a data path")
    for group in ("tips", "tips_and_tricks", "achievements"):
        for e in text.get(group) or []:
            where = f"{group}.{e.get('id')}"
            for r in e.get("requires") or []:
                if r not in REQUIRES:
                    rep.err(f"text.yaml {where}: requires {r!r} is not one of {sorted(REQUIRES)}")
            for a in e.get("asserts") or []:
                res = eval_assert(data, ix, a)
                if res is None:
                    rep.warn(f"text.yaml {where}: cannot evaluate assert {a!r}")
                elif not res:
                    rep.err(f"text.yaml {where}: assert fails against the data: {a!r}")
    for e in text.get("tips_and_tricks") or []:
        if e.get("unlocked_by") is not None:
            ids_exist(f"tips_and_tricks.{e.get('id')}.unlocked_by", "technologies", e["unlocked_by"])
    for e in text.get("milestones") or []:
        where = f"milestones.{e.get('id')}"
        kind = e.get("kind")
        if kind == "event":
            if e.get("target") not in MILESTONE_EVENTS:
                rep.err(f"text.yaml {where}: event {e.get('target')!r} is not one of {sorted(MILESTONE_EVENTS)}")
        elif kind in MILESTONE_KIND:
            ids_exist(where, MILESTONE_KIND[kind], e.get("target"))
        else:
            rep.err(f"text.yaml {where}: kind must be produce|build|research|event")
    for e in text.get("achievements") or []:
        where = f"achievements.{e.get('id')}"
        if len(e.get("name") or "") > 30:
            rep.err(f"text.yaml {where}: name longer than 30 characters")
        if len(e.get("text") or "") > 100:
            rep.err(f"text.yaml {where}: condition text longer than 100 characters")
        if not e.get("why"):
            rep.err(f"text.yaml {where}: no Why (08 §6)")
        if e.get("arc") not in ("early", "mid", "late"):
            rep.err(f"text.yaml {where}: arc must be early|mid|late")
        cond = e.get("condition") or {}
        if cond.get("type") not in ctypes:
            rep.err(f"text.yaml {where}: condition type {cond.get('type')!r} is not in the registry (08 §6)")
        for k, kind in CONDITION_ID_PARAMS.items():
            if k in cond:
                ids_exist(f"{where}.condition.{k}", kind, cond[k])
        if "regime" in cond and cond["regime"] not in REGIMES:
            rep.err(f"text.yaml {where}: regime {cond['regime']!r} unknown")
    # DECISIONS §41 (R5-gate D15): an achievement's text may restate its own condition's numbers as digits (P17
    # exempts them); any other digits in it must be one of those values (as is, as a percent of a share, or a
    # duration in minutes or hours). Names that contain digits (Model generation 25) are not numbers.
    named = sorted({o["name"] for k in ("items", "entities", "technologies", "recipes") for o in ix[k].values()
                    if isinstance(o.get("name"), str) and re.search(r"\d", o["name"])}, key=len, reverse=True)
    for e in text.get("achievements") or []:
        own = [v for v in (e.get("condition") or {}).values() if isinstance(v, (int, float)) and not isinstance(v, bool)]
        allowed = [a for v in own for a in (v, v * 100, v / 60, v / 3600)]
        s = e.get("text") or ""
        for n in named:
            s = s.replace(n, "")
        for m in re.finditer(r"\d[\d,]*(?:\.\d+)?", s):
            x = float(m.group(0).replace(",", ""))
            if not any(abs(x - a) <= 1e-9 * max(1.0, abs(a)) for a in allowed):
                rep.err(f"text.yaml achievements.{e.get('id')}: {m.group(0)} in its text is none of its condition's "
                        f"values (P17 exempts only an achievement's own condition; DECISIONS §41)")


# ------------------------------------------------------------------ graph checks
def check_tech_dag(ix, rep):
    techs = ix["technologies"]
    state = {}

    def visit(tid, stack):
        if state.get(tid) == "done":
            return
        if state.get(tid) == "active":
            rep.err("tech prerequisite cycle: " + " -> ".join(stack + [tid]))
            return
        state[tid] = "active"
        for p in techs[tid].get("prerequisites") or []:
            if p in techs:
                visit(p, stack + [tid])
        state[tid] = "done"

    for tid in techs:
        visit(tid, [])


def loot_items(data):
    return {i for en in data["enemies"] for i in (en.get("loot") or {}) if i != "plus"}


def free_items(data):
    """Items obtainable without research or machines: Wild loot and hand-mined world objects (trees, rocks)."""
    out = loot_items(data)
    for w in data.get("world") or []:
        out |= set((w.get("yields") or {}).keys())
    return out


def check_coverage(data, ix, rep):
    items, recs, techs = ix["items"], ix["recipes"], ix["technologies"]
    start = set((data["meta"].get("start") or {}).get("recipes") or [])
    unlocked_by = defaultdict(list)
    for t in techs.values():
        for r in (t.get("unlocks") or {}).get("recipes") or []:
            unlocked_by[r].append(t["id"])
    for r in recs:
        if r not in start and not unlocked_by[r]:
            rep.err(f"recipe {r}: never unlocked (not in meta.start.recipes, no tech unlocks it)")
        elif len(unlocked_by[r]) + (r in start) > 1 and not recs[r].get("shared_unlock"):
            rep.warn(f"recipe {r}: unlocked more than once ({unlocked_by[r]}{' + start' if r in start else ''})")
    produced = {p["id"] for r in recs.values() for p in r.get("products") or []}
    produced |= {res.get("yields") for res in ix["resources"].values()}
    produced |= {f for e in ix["entities"].values() for f in e.get("produces") or []}
    produced |= free_items(data)
    produced |= {(it.get("spoil") or {}).get("into") for it in items.values() if it.get("spoil")}
    consumed = {i["id"] for r in recs.values() for i in r.get("ingredients") or []}
    consumed |= {f for e in ix["entities"].values() for f in e.get("consumes") or []}
    packs = set(data["meta"].get("tiers") or [])
    for it in items.values():
        if it["id"] not in produced:
            rep.err(f"item {it['id']}: nothing produces it (no recipe product, no resource, no world object)")
        used = (it["id"] in consumed or it["id"] in packs or it.get("places") or it.get("places_tile")
                or it.get("fuel_value") or set(it.get("tags") or []) & USED_TAGS)
        if not used:
            rep.warn(f"item {it['id']}: dead end (never consumed, placed, burned, or tagged final)")
    cats_with_entity = {c for e in ix["entities"].values() for c in e.get("categories") or []}
    for c in data["meta"].get("crafting_categories") or []:
        if c not in cats_with_entity and c != "crafting":
            rep.warn(f"crafting category {c!r}: no entity can craft it")


def producible(ix, unlocked, start_inv, extra=()):
    """Everything producible from the start inventory with the given recipes (fixpoint)."""
    items, recs, ents, resources = ix["items"], ix["recipes"], ix["entities"], ix["resources"]
    has_pumpjack = any(e.get("type") == "pumpjack" for e in ents.values())
    have = set(start_inv) | set(extra)
    while True:
        placeable = {e["id"]: e for e in ents.values() if e.get("item") in have}
        crafters = defaultdict(list)
        for e in placeable.values():
            for c in e.get("categories") or []:
                crafters[c].append(e)
        new = set()
        for e in placeable.values():  # e.g. a boiler turns water into steam
            if all(f in have for f in e.get("consumes") or []):
                new |= set(e.get("produces") or [])
        for iid in list(have):  # an item that spoils produces its spoil result (Space Age spoilage)
            into = ((items.get(iid) or {}).get("spoil") or {}).get("into")
            if into:
                new.add(into)
        for res in resources.values():
            kinds = EXTRACTOR_FOR_KIND.get(res.get("kind"), set())
            if res.get("kind") == "fluid" and has_pumpjack:  # data with pumpjacks: drills do not pump wells
                kinds = {"pumpjack"}
            hand = res.get("kind") == "solid"            # the character mines any solid by hand (ISO, impl U56)
            has_extractor = any(e.get("type") in kinds for e in placeable.values())
            fluid_ok = not res.get("requires_fluid") or res["requires_fluid"] in have
            if hand or (has_extractor and fluid_ok):
                new.add(res["yields"])
        for rid in unlocked:
            r = recs.get(rid)
            if not r:
                continue
            ins = [i["id"] for i in r.get("ingredients") or []]
            if not all(i in have for i in ins):
                continue
            hand = r.get("handcraft", r.get("category") == "crafting") and not any(
                items.get(i, {}).get("type") == "fluid" for i in ins)
            if hand or crafters.get(r.get("category")):
                new |= {p["id"] for p in r.get("products") or []}
        if new <= have:
            return have
        have |= new


def lab_exists(ix, have):
    return any(e.get("type") == "lab" and e.get("item") in have for e in ix["entities"].values())


def recipe_craftable(ix, rid, unlocked, have):
    """The recipe is unlocked, its ingredients are obtainable, and a machine of its category can be placed
    (or it is hand-craftable)."""
    r = ix["recipes"].get(rid)
    if r is None or (unlocked is not None and rid not in unlocked):
        return False
    ins = [i["id"] for i in r.get("ingredients") or []]
    if not all(i in have for i in ins):
        return False
    if r.get("handcraft", r.get("category") == "crafting") and not any(
            ix["items"].get(i, {}).get("type") == "fluid" for i in ins):
        return True
    return any(e.get("item") in have and r.get("category") in (e.get("categories") or [])
               for e in ix["entities"].values())


def trigger_ok(ix, trig, have, unlocked=None):
    if trig.get("type") == "start":
        return True
    if trig.get("type") == "craft-recipe":   # R5-gate D9: Loop closed fires on the first Research run
        return recipe_craftable(ix, trig.get("recipe"), unlocked, have)
    target = trig.get("item") or trig.get("entity")
    if target is None:
        return True
    res = ix["resources"].get(target)
    if res is not None:  # mine a resource: its yield must be extractable
        return res.get("yields") in have
    return target in have or ix["entities"].get(target, {}).get("item") in have


def playthrough(data, ix, rep):
    """Research every tech in waves; a tech is researchable when its prerequisites are done
    and every pack it needs (plus a lab) is producible with the recipes unlocked so far.
    Techs with a 'start' trigger are done before the first wave."""
    items, techs = ix["items"], ix["technologies"]
    meta = data["meta"]
    unlocked = set((meta.get("start") or {}).get("recipes") or [])
    start_inv = set(((meta.get("start") or {}).get("inventory") or {}).keys())
    free = free_items(data)
    done, wave_of, wave = set(), {}, 0
    for t in techs.values():
        if (t.get("trigger") or {}).get("type") == "start":
            done.add(t["id"])
            wave_of[t["id"]] = 0
            unlocked |= set((t.get("unlocks") or {}).get("recipes") or [])
    while True:
        have = producible(ix, unlocked, start_inv, free)
        ready = []
        for t in techs.values():
            if t["id"] in done or not all(p in done for p in t.get("prerequisites") or []):
                continue
            if "trigger" in t:
                ok = trigger_ok(ix, t["trigger"], have, unlocked)
            else:
                packs = (t.get("cost") or {}).get("packs") or {}
                ok = lab_exists(ix, have) and all(p in have for p in packs)
            if ok:
                ready.append(t["id"])
        if not ready:
            break
        wave += 1
        for tid in ready:
            done.add(tid)
            wave_of[tid] = wave
            unlocked |= set((techs[tid].get("unlocks") or {}).get("recipes") or [])
    have = producible(ix, unlocked, start_inv, free)
    stuck = [t for t in techs if t not in done]
    for tid in stuck:
        t = techs[tid]
        missing_pre = [p for p in t.get("prerequisites") or [] if p not in done]
        missing_packs = [p for p in ((t.get("cost") or {}).get("packs") or {}) if p not in have]
        why = []
        if missing_pre:
            why.append(f"prereqs not done: {missing_pre[:4]}")
        if missing_packs:
            why.append(f"packs not producible: {missing_packs}")
        if "cost" in t and not lab_exists(ix, have):
            why.append("no lab is producible")
        if "trigger" in t:
            why.append(f"trigger target not producible: {t['trigger']}")
        rep.err(f"tech {tid}: unreachable in playthrough ({'; '.join(why) or 'unknown'})")
    never = [i for i in items if i not in have]
    for i in never:
        rep.warn(f"item {i}: not producible even after all reachable research")
    return wave_of


def check_closures(data, ix, rep):
    """Hidden prerequisites: everything a tech unlocks, and every pack it costs, must be producible
    from the start recipes plus what its prerequisite closure unlocks (Factorio's gateway rule)."""
    techs = ix["technologies"]
    meta = data["meta"]
    start_recipes = set((meta.get("start") or {}).get("recipes") or [])
    start_inv = set(((meta.get("start") or {}).get("inventory") or {}).keys())
    free = free_items(data)
    always = {t["id"] for t in techs.values() if (t.get("trigger") or {}).get("type") == "start"}
    closure_memo = {}

    def closure(tid):
        if tid in closure_memo:
            return closure_memo[tid]
        out = set()
        for p in techs[tid].get("prerequisites") or []:
            if p in techs:
                out |= {p} | closure(p)
        closure_memo[tid] = out
        return out

    for t in techs.values():
        before = closure(t["id"]) | always
        rec = set(start_recipes)
        for c in before:
            rec |= set((techs[c].get("unlocks") or {}).get("recipes") or [])
        have = producible(ix, rec, start_inv, free)
        for p in (t.get("cost") or {}).get("packs") or {}:
            if p not in have:
                rep.warn(f"tech {t['id']}: pack {p} is not producible from its prerequisites (hidden prerequisite)")
        trig = t.get("trigger")
        if trig and not trigger_ok(ix, trig, have, rec):
            rep.warn(f"tech {t['id']}: trigger target is not producible from its prerequisites")
        own = set((t.get("unlocks") or {}).get("recipes") or [])
        have_after = producible(ix, rec | own, start_inv, free)
        for rid in own:
            r = ix["recipes"].get(rid) or {}
            if r.get("container"):  # barreling: needs no gating, like Factorio's fluid handling
                continue
            missing = [i["id"] for i in r.get("ingredients") or [] if i["id"] not in have_after]
            if missing:
                rep.warn(f"tech {t['id']}: unlocks {rid} but {missing} is not producible from its prerequisites "
                         f"(hidden prerequisite)")


# ------------------------------------------------------------------ statistics
def raw_costs(ix, rep, targets):
    """Approximate raw-resource cost per unit, using the first recipe that makes each item.
    Ingredients a recipe returns (catalysts, a returned carrier) count net of the return.
    Multi-output recipes divide by the target's amount and ignore byproducts (flagged ~)."""
    recs, resources = ix["recipes"], ix["resources"]
    raw = {res["yields"] for res in resources.values()}
    maker = {}
    for r in recs.values():
        for p in r.get("products") or []:
            maker.setdefault(p["id"], r)
    memo = {}

    def cost(item, stack=()):
        if item in raw:
            return Counter({item: 1.0}), False
        if item in memo:
            return memo[item]
        if item in stack or item not in maker:
            return Counter({f"?{item}": 1.0}), True
        r = maker[item]
        out = Counter()
        for p in r["products"]:
            out[p["id"]] += p["amount"] * p.get("probability", 1.0)
        ins = Counter()
        for i in r.get("ingredients") or []:
            ins[i["id"]] += i["amount"]
        n = out[item] - ins.get(item, 0)
        approx = len([p for p in out if out[p] > ins.get(p, 0)]) > 1
        total = Counter()
        for ing, amount in ins.items():
            net = amount - out.get(ing, 0)
            if ing == item or net <= 0:
                continue
            c, a = cost(ing, stack + (item,))
            approx |= a
            for k, v in c.items():
                total[k] += v * net / max(n, 1e-9)
        memo[item] = (total, approx)
        return memo[item]

    return {t: cost(t) for t in targets}


def pack_totals(techs):
    """Packs consumed by finite research, finite multi-level techs summed over their levels."""
    units, finite_multi, infinite = Counter(), 0, 0
    for t in techs.values():
        c = t.get("cost") or {}
        packs = c.get("packs") or {}
        if "count_formula" in t:
            first, last = levels(t)
            if last is None:
                infinite += 1
                continue
            finite_multi += 1
            try:
                count = sum(unit_count(t["count_formula"], lv) for lv in range(first, last + 1))
            except Exception:  # noqa: BLE001 - reported by check_schema
                continue
        else:
            count = c.get("count")
        if not count:
            continue
        for p, n in packs.items():
            units[p] += count * n
    return units, finite_multi, infinite


def citation_stats(ix):
    reg = Counter(t.get("regime") for t in ix["technologies"].values())
    works = {(c.get("title"), c.get("year")) for t in ix["technologies"].values() for c in t.get("citation") or []}
    entries = sum(len(t.get("citation") or []) for t in ix["technologies"].values())
    return reg, entries, len(works)


def check_copies(data, ix, rep):
    """Values the data holds twice must agree (R5-gate): the engine reads one copy (10 §2.4), the other documents."""
    meta, ents, techs, items = data["meta"], ix["entities"], ix["technologies"], ix["items"]
    enemies = {e.get("id"): e for e in (data.get("enemies") or [])}

    def same(label, a, b):
        if a is not None and b is not None and a != b:
            rep.err(f"duplicated value disagrees: {label}: {a!r} != {b!r}")
    def g(d, *keys):  # a nested lookup that returns None when any level is missing
        for k in keys:
            d = d.get(k) if isinstance(d, dict) else None
        return d
    same("meta.world.archives.starting_archive vs meta.start.guarantees.starting_archive_records",
         g(meta, "world", "archives", "starting_archive"), g(meta, "start", "guarantees", "starting_archive_records"))
    effects = [(t, ef) for t in techs.values() for ef in (t.get("unlocks") or {}).get("effects") or []]
    for t, ef in effects:
        if ef.get("type") == "deployment-sigma":
            same(f"meta.world.sigma.watermarking_factor vs {t['id']}'s deployment-sigma",
                 g(meta, "world", "sigma", "watermarking_factor"), ef.get("multiplier"))
        if ef.get("type") == "liquid-cooling":
            same(f"meta.heat.coolant.liquid_share.{t['id']} vs its liquid-cooling fraction",
                 g(meta, "heat", "coolant", "liquid_share", t["id"]), ef.get("fraction"))
    run = enemies.get("runaway") or {}
    same("meta.runaways.escape_timer_s vs enemies.runaway.escape_timer_s", g(meta, "runaways", "escape_timer_s"), run.get("escape_timer_s"))
    same("meta.runaways.spread.interval_s vs enemies.runaway.spread_interval_s", g(meta, "runaways", "spread", "interval_s"), run.get("spread_interval_s"))
    same("meta.runaways.presets vs meta.world_settings.runaways.options", g(meta, "runaways", "presets"), g(meta, "world_settings", "runaways", "options"))
    same("meta.runaways.default vs meta.world_settings.runaways.default", g(meta, "runaways", "default"), g(meta, "world_settings", "runaways", "default"))
    if g(meta, "runaways", "deploying_buildings") is not None:
        deploying = {e for e, x in ents.items() if x.get("deploys")}
        if any((i.get("staff") or {}).get("deploys") for i in items.values()):
            deploying.add("seminar")
        same("meta.runaways.deploying_buildings vs entities with deploys (+ the Seminar via a deploying staff item)",
             sorted(g(meta, "runaways", "deploying_buildings")), sorted(deploying))
    if g(meta, "heat", "interruptible_power") is not None:
        inter = {e for e, x in ents.items() if (x.get("energy") or {}).get("priority") == "interruptible"}
        inter |= {i for i, x in items.items() if (x.get("staff") or {}).get("interruptible")}
        same("meta.heat.interruptible_power vs interruptible entities and staff items",
             sorted(g(meta, "heat", "interruptible_power")), sorted(inter))
    hall = ents.get("research-hall") or {}
    tiers = (hall.get("extra") or {}).get("tiers") or []
    if tiers:
        same("research-hall energy.kw vs extra.tiers[0].kw", (hall.get("energy") or {}).get("kw"), tiers[0].get("kw"))
        same("research-hall crafting_speed vs extra.tiers[0].speed", hall.get("crafting_speed"), tiers[0].get("speed"))
    same("meta.quality.recycle_return vs verifier.extra.returns", g(meta, "quality", "recycle_return"),
         ((ents.get("verifier") or {}).get("extra") or {}).get("returns"))
    unlock = {ef.get("quality"): t["id"] for t, ef in effects if ef.get("type") == "unlock-quality"}
    for q in g(meta, "quality", "tiers") or []:
        if q.get("unlocked_by") or q.get("id") in unlock:
            same(f"meta.quality.tiers {q.get('id')} unlocked_by vs the unlock-quality effects", q.get("unlocked_by"), unlock.get(q.get("id")))


    fr, fg = (ents.get("fusion-reactor") or {}).get("extra") or {}, (ents.get("fusion-generator") or {}).get("extra") or {}
    if fr.get("plasma_mw") and fr.get("plasma_per_s") and fg.get("max_kw") and fg.get("plasma_per_s"):
        same("plasma MJ per unit: fusion-reactor plasma_mw / plasma_per_s vs fusion-generator max_kw / 1000 / plasma_per_s",
             fr["plasma_mw"] / fr["plasma_per_s"], fg["max_kw"] / 1000 / fg["plasma_per_s"])


# ------------------------------------------------------------------ round 5 (R5-gate §4, DECISIONS §40)
def takeoff_order_entries(order):
    """meta.endgame.takeoff_order: a technology id, or {id: level} for one level of a finite multi-level technology;
    an infinite technology's id stands for its next level (04 §5.1)."""
    out = []
    for e in order:
        if isinstance(e, str):
            out.append((e, None))
        elif isinstance(e, dict) and len(e) == 1:
            out.append(next(iter(e.items())))
        else:
            out.append((None, e))
    return out


def check_takeoff_order(data, ix, rep):
    """R5-gate D10: Research scheduling appends from meta.endgame.takeoff_order (04 §5.1). The list holds every level
    of every technology paid in System cards alone, once each, after every entry it requires."""
    order = (data["meta"].get("endgame") or {}).get("takeoff_order")
    if not isinstance(order, list):
        return
    techs = ix["technologies"]
    sc_only = {tid for tid, t in techs.items() if set(((t.get("cost") or {}).get("packs") or {})) == {"system-card"}}

    def label(key):
        return key[0] if key[1] in (None, "inf") else f"{key[0]} {key[1]}"

    def req_key(p):   # a prerequisite on a finite multi-level technology means its max_level (impl U19)
        pt = techs.get(p) or {}
        if "count_formula" in pt:
            return (p, "inf") if levels(pt)[1] is None else (p, levels(pt)[1])
        return (p, None)

    want = set()
    for tid in sc_only:
        t = techs[tid]
        if "count_formula" not in t:
            want.add((tid, None))
        elif levels(t)[1] is None:
            want.add((tid, "inf"))
        else:
            want |= {(tid, lv) for lv in range(levels(t)[0], levels(t)[1] + 1)}
    pos = {}
    for i, (tid, lv) in enumerate(takeoff_order_entries(order)):
        t = techs.get(tid)
        where = f"meta.endgame.takeoff_order[{i}]"
        if t is None:
            rep.err(f"{where}: {tid if tid is not None else lv!r} is not a technology")
            continue
        if tid not in sc_only:
            rep.err(f"{where}: {tid} is not paid in System cards alone (04 §5.1)")
        if "count_formula" in t and levels(t)[1] is None:
            key = (tid, "inf")
            if lv is not None:
                rep.err(f"{where}: {tid} is infinite; its entry names no level")
            if i != len(order) - 1:
                rep.err(f"{where}: an infinite technology ({tid}) never runs out, so it can only be the last entry")
        elif "count_formula" in t:
            first, last = levels(t)
            if not (isinstance(lv, int) and first <= lv <= last):
                rep.err(f"{where}: {tid} needs one level in {first}–{last}, as {{{tid}: L}}")
                continue
            key = (tid, lv)
        else:
            if lv is not None:
                rep.err(f"{where}: {tid} has one level; the entry is its id alone")
            key = (tid, None)
        if key in pos:
            rep.err(f"{where}: {label(key)} appears twice")
            continue
        pos[key] = i
    for key in sorted(want - set(pos), key=str):
        rep.err(f"meta.endgame.takeoff_order: {label(key)} is missing (every System-card-only technology level, 04 §5.1)")
    for key, i in pos.items():
        tid, lv = key
        first = levels(techs[tid])[0] if "count_formula" in techs[tid] else None
        reqs = [(tid, lv - 1)] if isinstance(lv, int) and lv > first else [req_key(p) for p in techs[tid].get("prerequisites") or []]
        for rk in reqs:
            if rk in pos and pos[rk] > i:
                rep.err(f"meta.endgame.takeoff_order: {label(key)} comes before {label(rk)}, which it requires")


def check_damage(data, ix, rep):
    """R5-gate D13: one registry of damage categories (meta.damage_categories). Bonuses name them; every damage dealer
    declares one (an entity's extra.ammo_category; an ammo item's category, or its damage_category where its slot
    category differs; an equipment's ammo_category); every category has a dealer."""
    cats = data["meta"].get("damage_categories")
    if cats is None:
        return
    cats, dealt = set(cats), set()
    for e in ix["entities"].values():
        c = (e.get("extra") or {}).get("ammo_category")
        if c is not None:
            if c not in cats:
                rep.err(f"entity {e['id']}: extra.ammo_category {c!r} is not in meta.damage_categories")
            dealt.add(c)
    for it in ix["items"].values():
        am = it.get("ammo") or {}
        for c in (am.get("damage_category"), (it.get("equipment") or {}).get("ammo_category")):
            if c is not None:
                if c not in cats:
                    rep.err(f"item {it['id']}: damage category {c!r} is not in meta.damage_categories")
                dealt.add(c)
        if am.get("category") in cats:
            dealt.add(am["category"])
    for t in ix["technologies"].values():
        for ef in (t.get("unlocks") or {}).get("effects") or []:
            if ef.get("type") in ("ammo-damage", "gun-speed") and ef.get("category") not in cats:
                rep.err(f"tech {t['id']}: {ef['type']} names {ef.get('category')!r}, which is not in meta.damage_categories")
            if ef.get("type") == "turret-attack" and (ix["entities"].get(ef.get("turret")) or {}).get("type") != "turret":
                rep.err(f"tech {t['id']}: turret-attack names {ef.get('turret')!r}, which is not a turret")
    for c in sorted(cats - dealt):
        rep.warn(f"meta.damage_categories: nothing deals {c!r} damage, so its bonuses apply to nothing")


# Fields where null has a meaning (SCHEMA "General rules"); a null anywhere else is almost always a YAML slip,
# such as an unquoted comma inside a flow mapping turning the rest of a value into a key with no value.
NULLABLE = {"walking_speed", "kappa_per_s", "unlocked_by", "grid"}


def check_nulls(data, rep):
    def walk(x, path):
        if isinstance(x, dict):
            for k, v in x.items():
                if v is None and k not in NULLABLE:
                    rep.warn(f"{path}.{k}: null outside the fields where null has a meaning (a YAML slip?)")
                walk(v, f"{path}.{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x):
                walk(v, f"{path}[{(v.get('id') if isinstance(v, dict) and v.get('id') else i)}]")
    for kind, d in data.items():
        if d:
            walk(d, kind)


def run_checks(data, rep):
    """Every check, in order; returns the index and the playthrough's waves (render_spec.py counts with it too)."""
    check_schema(data, rep)
    check_nulls(data, rep)
    ix = index(data, rep)
    check_references(data, ix, rep)
    check_citations(data, ix, rep)
    lint_text(data, ix, rep)
    check_text_file(data, ix, rep)
    check_tech_dag(ix, rep)
    check_copies(data, ix, rep)
    check_takeoff_order(data, ix, rep)
    check_damage(data, ix, rep)
    check_coverage(data, ix, rep)
    cyclic = any("cycle" in e for e in rep.errors)
    waves = playthrough(data, ix, rep) if not cyclic else {}
    if not cyclic:
        check_closures(data, ix, rep)
    return ix, waves


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    quiet = "--quiet" in sys.argv
    data_dir = Path(args[0] if args else "design/spec/data")
    rep = Report()
    data = load(data_dir, rep)
    ix, waves = run_checks(data, rep)

    tiers = data["meta"].get("tiers") or []
    print(f"== spec: {data_dir}")
    n_items = sum(1 for i in ix["items"].values() if i.get("type") == "item")
    n_fluids = sum(1 for i in ix["items"].values() if i.get("type") == "fluid")
    print(f"items {n_items}, fluids {n_fluids}, resources {len(ix['resources'])}, recipes {len(ix['recipes'])}, "
          f"entities {len(ix['entities'])}, technologies {len(ix['technologies'])}"
          + (f" ({sum(1 for t in ix['technologies'].values() if t.get('hidden'))} hidden)"
             if any(t.get("hidden") for t in ix["technologies"].values()) else "")
          + (f", enemies {len(data['enemies'])}" if data["enemies"] else "")
          + (f", tiles {len(ix['tiles'])}" if ix["tiles"] else "")
          + (f", world objects {len(ix['world'])}" if ix["world"] else ""))
    if waves:
        print(f"research playthrough: {len(waves)} techs reachable in {max(waves.values())} waves")
    if any(t.get("regime") for t in ix["technologies"].values()):
        reg, entries, works = citation_stats(ix)
        print("regimes: " + ", ".join(f"{k} {v}" for k, v in sorted(reg.items(), key=lambda kv: str(kv[0])))
              + f"; {entries} citation entries, {works} distinct works")
    if not quiet and tiers:
        per_tier = Counter(i.get("tier") for i in ix["items"].values())
        print("items per tier: " + ", ".join(f"{t}={per_tier.get(t, 0)}" for t in tiers))
        units, finite_multi, infinite = pack_totals(ix["technologies"])
        print("total packs consumed by finite research: " + ", ".join(f"{p}={units.get(p, 0):.0f}" for p in tiers)
              + (f" ({finite_multi} finite multi-level techs summed over levels; {infinite} infinite techs excluded)"
                 if finite_multi or infinite else ""))
        for pack, (c, approx) in raw_costs(ix, rep, [t for t in tiers if t in ix["items"]]).items():
            parts = ", ".join(f"{k} {v:.1f}" for k, v in sorted(c.items(), key=lambda kv: -kv[1]))
            print(f"raw cost of 1 {pack}{' (~)' if approx else ''}: {parts}")
    for w in rep.warnings:
        print("WARN ", w)
    for e in rep.errors:
        print("ERROR", e)
    print(f"== {len(rep.errors)} errors, {len(rep.warnings)} warnings")
    sys.exit(1 if rep.errors else 0)


if __name__ == "__main__":
    main()
