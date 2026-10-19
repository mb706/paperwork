#!/usr/bin/env python3
"""R4-arch: milestone build filters (10 §12) derived from the spec data and checked for closure.

    gamedev-python design/round4/arch-data/manifests.py [SPEC_DIR]

The M2-M5 manifests are read from the YAML block in 10 §12 (the spec is the single source); M1 is
09 §2.7's explicit list. A manifest is a rule, not a list (10 §2.4): the technologies whose packs lie in `tiers`
(trigger technologies follow their prerequisites), minus `exclude_branch` and every technology
that depends on an `exclude_with_dependents` root. Everything else is derived: recipes (unlocked by
an included technology or by prior-art), items, entities, and the resources whose yields can be
obtained. The closure check is the data stage's (10 §2.4): prerequisites inside, every ingredient,
pack and trigger target obtainable inside the filter, every recipe category served by an included
machine (or by hand). M1 is 09 §2.7's explicit slice list and is checked by the same function.
"""
import re
import sys
from pathlib import Path

import yaml

SPEC = Path(sys.argv[1] if len(sys.argv) > 1 else '/home/mewse/browsergame/design/spec')
D = SPEC / 'data'
L = {k: yaml.safe_load((D / f'{k}.yaml').read_text())
     for k in ['items', 'recipes', 'entities', 'technologies', 'resources']}
meta = yaml.safe_load((D / 'meta.yaml').read_text())
T = {t['id']: t for t in L['technologies']}
R = {r['id']: r for r in L['recipes']}
E = {e['id']: e for e in L['entities']}
I = {i['id']: i for i in L['items']}
RES = {r['id']: r for r in L['resources']}
ENEMIES = yaml.safe_load((D / 'enemies.yaml').read_text())
TIERS = meta['tiers']


def load_manifests():
    """The M2-M5 filters are the YAML block in 10 §12 (the spec is the single source)."""
    t10 = (SPEC / '10-architecture.md').read_text()
    blk = next(b for b in re.findall(r'```yaml\n(.*?)```', t10, re.S) if 'manifests:' in b)
    doc = yaml.safe_load(blk)
    wild = doc.get('wild_roots', [])
    out = {}
    for name, m in doc['manifests'].items():
        if 'from' in m:
            continue
        tiers = TIERS if m.get('tiers') == 'all' else m['tiers']
        roots = list(m.get('exclude_with_dependents', [])) + (wild if m.get('exclude_wild') else [])
        out[name] = {'tiers': tiers, 'exclude_branch': m.get('exclude_branch', []),
                     'exclude_with_dependents': roots}
    unknown = sorted({r for m in out.values() for r in m['exclude_with_dependents'] if r not in T})
    return out, unknown


def tech_tier_ok(t, tiers):
    if 'cost' not in t:
        return True                                     # triggers follow their prerequisites
    return all(p in tiers for p in t['cost']['packs'])


def dependents(roots):
    out = set(roots)
    changed = True
    while changed:
        changed = False
        for t in T.values():
            if t['id'] not in out and any(p in out for p in t.get('prerequisites', [])):
                out.add(t['id'])
                changed = True
    return out


def select(m):
    excl = dependents(m.get('exclude_with_dependents', []))
    cand = {tid for tid, t in T.items() if tech_tier_ok(t, m['tiers']) and tid not in excl
            and t.get('branch') not in m.get('exclude_branch', [])}
    # drop technologies whose prerequisites fell out (fixpoint), so the set is prerequisite-closed
    changed = True
    while changed:
        changed = False
        for tid in sorted(cand):
            if any(p not in cand for p in T[tid].get('prerequisites', [])):
                cand.discard(tid)
                changed = True
    return cand


def closure(techs, label, scenery=()):
    techs = set(techs) | {'prior-art'}
    rep = []
    recipes = set()
    for tid in techs:
        recipes |= set(T[tid]['unlocks'].get('recipes', []))
    start = dict(meta['start'].get('inventory', {}))
    sal = meta['start'].get('salvage', {})
    for part in ('contents', 'crate', 'per_piece', 'pieces'):
        blk = sal.get(part, {})
        if isinstance(blk, dict):
            for k, v in (blk.get('yields', blk) or {}).items():
                if k in I:
                    start[k] = v
    placeables = {i['id'] for r in recipes for i in R[r]['products']}
    entities = {I[x]['places'] for x in placeables | set(start) if x in I and I[x].get('places') in E}
    # resources: solids are hand-minable (ISO, uranium included: U56); others need an extractor
    extract_types = {e['type'] for e in (E[x] for x in entities)}
    resources = set()
    for rid, r in RES.items():
        if rid in scenery:
            continue
        if r['kind'] == 'solid':
            resources.add(rid)
        elif r['kind'] == 'offshore' and 'offshore-pump' in extract_types:
            resources.add(rid)
        elif r['kind'] == 'fluid' and 'pumpjack' in extract_types:
            resources.add(rid)
        elif rid == 'trees':
            resources.add(rid)
    ok = set(start)
    cond = {}                                    # obtainable only under a setting: spoil results, Wild loot
    for en in ENEMIES:
        for k in (en.get('loot') or {}):
            if k in I:
                cond.setdefault(k, f'loot of {en["id"]} (Wild)')
    for rid in resources:
        y = RES[rid].get('yields')
        if y:
            ok.add(y)
    wpath = D / 'world.yaml'                      # trees and rocks are world objects (J9): hand-mined yields
    if wpath.exists():
        for wo in yaml.safe_load(wpath.read_text()) or []:
            for k in (wo.get('yields') or {}):
                ok.add(k)
    else:
        ok.add('wood')
    changed = True
    while changed:
        changed = False
        for eid in entities:
            e = E[eid]
            if all(c in ok for c in e.get('consumes', []) if c in I and e['type'] in ('boiler', 'heat-exchanger', 'reactor')) or e['type'] == 'offshore-pump':
                for p in e.get('produces', []):
                    if p not in ok:
                        ok.add(p); changed = True
        for rid in recipes:
            r = R[rid]
            if r.get('container'):
                continue
            if all(i['id'] in ok for i in r['ingredients']):
                for p in r['products']:
                    if p['id'] not in ok:
                        ok.add(p['id']); changed = True
        for iid in list(ok):                      # spoilage (Scooped): the spoil result is conditional
            sp = (I.get(iid) or {}).get('spoil')
            if sp and sp.get('into') not in ok and sp.get('into') not in cond:
                cond[sp['into']] = f'spoil of {iid} (setting {sp.get("setting")})'
                changed = True
    cats = set()
    for eid in entities:
        cats |= set(E[eid].get('categories', []))
    for tid in sorted(techs):
        t = T[tid]
        for p in t.get('prerequisites', []):
            if p not in techs:
                rep.append(f'{tid}: prerequisite {p} outside the filter')
        for p in (t.get('cost') or {}).get('packs', {}):
            if p not in ok:
                rep.append(f'{tid}: pack {p} not obtainable')
        tr = t.get('trigger')
        if tr and tr.get('type') == 'craft-item' and tr.get('item') not in ok:
            rep.append(f'{tid}: trigger item {tr.get("item")} not obtainable')
        if tr and tr.get('type') in ('build-entity', 'mine-entity'):
            tgt = tr.get('entity')
            if tgt not in entities and tgt not in resources:
                rep.append(f'{tid}: trigger target {tgt} not in the filter')
    inert = []
    for rid in sorted(recipes):
        r = R[rid]
        if r.get('container'):
            continue
        miss = [i['id'] for i in r['ingredients'] if i['id'] not in ok]
        if miss and all(x in cond for x in miss):
            inert.append(f'{rid} (needs {", ".join(cond[x] for x in miss)})')
        elif miss:
            rep.append(f'recipe {rid}: ingredients not obtainable {miss}')
        if not r.get('pseudo') and r['category'] not in cats and not (
                r.get('handcraft', r['category'] == 'crafting')):
            rep.append(f'recipe {rid}: no machine for category {r["category"]}')
    items = {x for x in ok if x in I}
    print(f'{label}: {len(techs) - 1} technologies (+ prior-art), {len(recipes)} recipes, '
          f'{len(items)} items and fluids, {len(entities)} entities, '
          f'{len(resources)} resources{" + scenery " + ",".join(scenery) if scenery else ""}; '
          f'closure {"OK" if not rep else "FAILS"}')
    for x in rep:
        print('   ', x)
    if inert:
        print('    inert until its setting exists:', '; '.join(inert))
    return techs, rep


if __name__ == '__main__':
    t9 = (SPEC / '09-vertical-slice.md').read_text()
    m = re.search(r'```yaml\n(slice:.*?)```', t9, re.S)
    man = yaml.safe_load(m.group(1))['slice']
    missing = [t for t in man['technologies'] if t not in T]
    if missing:
        print('m1: 09 §2.7 names unknown technologies', missing)
    closure([t for t in man['technologies'] if t in T], 'm1 (09 §2.7)',
            scenery=tuple(man.get('scenery', []) or ['exchange']))
    prev = set(man['technologies'])
    MANIFESTS, unknown = load_manifests()
    if unknown:
        print('10 §12 manifests name unknown technologies:', unknown)
    for name, mf in MANIFESTS.items():
        techs = select(mf)
        lost = sorted(prev - techs - {'prior-art'})
        techs, rep = closure(techs, name)
        if lost:
            print(f'    note: {len(lost)} earlier-milestone technologies missing: {lost}')
        prev = techs
    allt = set(T)
    m5 = select(MANIFESTS['m5'])  # noqa
    print('every technology is in m5:', m5 | {'prior-art'} == allt)
