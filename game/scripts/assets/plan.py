"""The asset build's plan (10 §9.1, §9.7): every sprite set, its kind, model script, source files and group.

    gamedev-python game/scripts/assets/plan.py --out .cache/assets/plan.json [--only id,...]

Sets come from the model scripts in game/assets/blender/ (no bpy needed: scripts keep bpy out of module scope):
  entities/<id>.py  -> entity/<id>     (META kind entity or inserter)
  world/<id>.py     -> resource/<id> or object/<id>   (by META kind)
  movers/<id>.py    -> mover/<id>
  items/<id>.py     -> item/<id>       (icons; render_icons.py)
plus a generated greybox set greybox/<id> for every entity of design/spec/data/entities.yaml (10 §9.2) and the
renderer's fixed fx/ sets (made in numpy by fx.py). A file name's underscores become hyphens; files starting
with an underscore are shared helpers, hashed into every set of their folder.

Groups (10 §9.7): `core` holds everything the first minutes of any game can show: the world, the character,
greyboxes, fx, and the entities and items of the technology that is researched at the start (Prior art). Every
other entity or item belongs to the technology that unlocks the recipe making it; the build then merges a tier's
technologies in data order into groups `<tier>/<n>` of at most 3 MB (pack step).
"""

import argparse
import glob
import importlib.util
import os
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
from lib import contract as C  # noqa: E402

import greybox_table as GT  # noqa: E402  (the greybox heights and families)

FOLDERS = (('entities', 'entity'), ('world', None), ('movers', 'mover'), ('items', 'item'))
START_TECH = 'prior-art'


def load_meta(path):
    spec = importlib.util.spec_from_file_location('paperwork_plan_model', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def data():
    def y(n):
        with open(os.path.join(K.DATA, n)) as f:
            return yaml.safe_load(f)
    return y('entities.yaml'), y('items.yaml'), y('recipes.yaml'), y('technologies.yaml')


def unlocking(items, recipes, techs):
    """item id -> (technology id, tier) of the first technology (data order) unlocking a recipe that makes it;
    items no recipe makes (raw resources, wood, records) and Prior art's are (prior-art, core)."""
    rec_tech = {}
    for t in techs:
        for r in (t.get('unlocks') or {}).get('recipes', []) or []:
            rec_tech.setdefault(r, t['id'])
    item_tech = {}
    for r in recipes:
        if r['id'] not in rec_tech:
            continue
        for p in r.get('products', []) or []:
            item_tech.setdefault(p['id'], rec_tech[r['id']])
    out = {}
    for it in items:
        t = item_tech.get(it['id'], START_TECH)
        out[it['id']] = (t, 'core' if t == START_TECH else it.get('tier', 'memo'))
    return out


def helpers(folder):
    return sorted(glob.glob(os.path.join(K.BLENDER_SRC, folder, '_*.py')))


def rel(p):
    return os.path.relpath(p, K.GAME)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default=None)
    a = ap.parse_args()
    entities, items, recipes, techs = data()
    unlock = unlocking(items, recipes, techs)
    placed_by = {it['places']: it['id'] for it in items if it.get('places')}
    sets = []
    for folder, ns in FOLDERS:
        for path in sorted(glob.glob(os.path.join(K.BLENDER_SRC, folder, '*.py'))):
            base = os.path.basename(path)[:-3]
            if base.startswith('_'):
                continue
            ident = base.replace('_', '-')
            mod = load_meta(path)
            meta = getattr(mod, 'META', {})
            kind = 'icon' if folder == 'items' else meta.get('kind', 'entity')
            if folder == 'world':
                ns_k = 'resource' if kind == 'resource' else 'object'
            else:
                ns_k = ns
            name = meta.get('set', f'{ns_k}/{ident}')
            if folder in ('entities',):
                item = placed_by.get(ident)
                tech, tier = unlock.get(item, (START_TECH, 'core')) if item else (START_TECH, 'core')
            elif folder == 'items':
                tech, tier = unlock.get(ident, (START_TECH, 'core'))
            else:
                tech, tier = (START_TECH, 'core')
            sets.append(dict(set=name, kind=kind, script=os.path.relpath(path, K.BLENDER_SRC),
                             sources=[rel(path)] + [rel(h) for h in helpers(folder)], tech=tech, tier=tier,
                             params=None, renderer='icons' if kind == 'icon' else 'sprites'))
    for e in entities:
        params = GT.params(e)
        sets.append(dict(set=f'greybox/{e["id"]}', kind='entity', script='greybox.py',
                         sources=[rel(os.path.join(K.BLENDER_SRC, 'greybox.py')), rel(GT.__file__)],
                         tech=START_TECH, tier='core', params=params, renderer='sprites'))
    for name in ('fx/smoke', 'fx/missing'):
        sets.append(dict(set=name, kind='object' if name == 'fx/smoke' else 'icon', script=None,
                         sources=[rel(os.path.join(HERE, 'fx.py'))], tech=START_TECH, tier='core', params=None,
                         renderer='fx'))
    if a.only:
        want = set(a.only.split(','))
        sets = [s for s in sets if s['set'] in want or s['set'].split('/', 1)[1] in want]
    names = [s['set'] for s in sets]
    dup = {n for n in names if names.count(n) > 1}
    if dup:
        raise SystemExit(f'plan: duplicate set names {sorted(dup)}')
    for s in sets:
        if s['kind'] not in C.KINDS:
            raise SystemExit(f'plan: {s["set"]}: unknown kind {s["kind"]}')
    K.dump_json(a.out, dict(sets=sets, tech_order=[t['id'] for t in techs]))
    print(f'[plan] {len(sets)} sets', flush=True)


if __name__ == '__main__':
    main()
