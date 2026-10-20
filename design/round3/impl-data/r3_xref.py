#!/usr/bin/env python3
"""R3 implementability: cross-reference spec prose against spec data.

Read-only. Run from anywhere:
    gamedev-python design/round3/impl-data/r3_xref.py [SPEC_DIR]

Reports
  A. Backtick-quoted kebab-case ids in spec/*.md that are not an id of any YAML kind or a meta
     vocabulary entry (items, recipes, entities, technologies, resources, enemies, tiers, crafting
     categories, effect types, quality tiers). UI registry ids (07 overlays, control ids) and
     tooling words are listed separately as "non-data" so they can be ignored.
  B. Kebab-case tokens inside YAML string values (outside desc/sprite/mirrors/note/name/autoplace)
     that are not ids.
  C. The 09 slice manifest: missing ids, closure failures against the final data, the start-recipe
     list against Prior art, and every 09 §2.5 table row against technologies.yaml.
  D. Text placeholders in 08-text.md ({a.b.c}) that do not resolve to a data path.
  E. Chapter cross-references "NN §X.Y" whose section heading does not exist.
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

import yaml

SPEC = Path(sys.argv[1] if len(sys.argv) > 1 else '/home/mewse/browsergame/design/spec')
D = SPEC / 'data'
KINDS = ['items', 'recipes', 'entities', 'technologies', 'resources', 'enemies']
data = {k: yaml.safe_load((D / f'{k}.yaml').read_text()) for k in KINDS}
meta = yaml.safe_load((D / 'meta.yaml').read_text())
by = {k: {x['id']: x for x in v} for k, v in data.items()}

ids = defaultdict(set)
for k, lst in data.items():
    for x in lst:
        ids[x['id']].add(k)
for t in meta['tiers']:
    ids[t].add('tier')
for c in meta['crafting_categories']:
    ids[c].add('category')
for e in meta['effects']:
    ids[e].add('effect')
for q in meta['quality']['tiers']:
    ids[q['id']].add('quality')
# Round-4 data kinds (tiles, world objects), town classes and heat-emission vocabulary
for k in ('tiles', 'world'):
    p = D / f'{k}.yaml'
    for x in (yaml.safe_load(p.read_text()) or []) if p.exists() else []:
        ids[x['id']].add(k)
for c in meta.get('town_classes', []) or []:
    ids[c if isinstance(c, str) else c.get('id')].add('town-class')
for v in ('twice-output', 'none'):
    ids[v].add('vocab')

# Ids that are deliberately not data (UI registries, controls, tooling, benchmark names)
NON_DATA = set('''
open-factoriopedia electric-network recipe-icons monitor-ranges logistic-networks turret-ranges
age-builder train-stations rail-signals toggle-status-lights give-rate-calculator open-world
toggle-world-strip open-milestones open-university toggle-personal-roboport check-arch
gamedev-python data-updates data-final-fixes border-image maxrects-packer slice-3h mid-article
late-modelcard belts-300k inserters-50k agents-5k trains-100 circuits-2k takeoff-500
m0-walk m0-chests-10k m0-codec m0-load-30k worldgen-frontier
swiftshader-webgl
'''.split())

BT = re.compile(r'`([^`\n]+)`')
KEBAB = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)+')


def scan_md():
    dangling, nondata = [], []
    for md in sorted(SPEC.glob('*.md')):
        in_code = False
        for ln, line in enumerate(md.read_text().splitlines(), 1):
            if line.strip().startswith('```'):
                in_code = not in_code
                continue
            if in_code:
                continue
            for m in BT.finditer(line):
                for t in re.split(r'\s*(?:,|…|\.\.\.)\s*', m.group(1).strip()):
                    if KEBAB.fullmatch(t) and t not in ids:
                        (nondata if t in NON_DATA else dangling).append((md.name, ln, t))
    return dangling, nondata


def walk(o, path):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, path + [str(k)])
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, path + [str(i)])
    elif isinstance(o, str):
        yield path, o


def scan_yaml():
    skip = {'desc', 'sprite', 'mirrors', 'note', 'name', 'autoplace', 'citation', 'era', 'code',
            'rule', 'model', 'owner', 'type'}
    vocab = {'field-years', 'staff-equivalents', 'multi-level', 'hand-crafting', 'crash-site',
             'college-town', 'starting-college', 'craft-item', 'mine-entity', 'science-pack',
             'electric-pole', 'logistic-chest', 'mining-drill', 'rocket-silo', 'twice-output'}
    out = defaultdict(set)
    for f in ['meta'] + KINDS:
        doc = meta if f == 'meta' else data[f]
        for path, s in walk(doc, [f]):
            if any(p in skip for p in path) or 'amounts_by_j' in path:
                continue
            for t in re.findall(r'(?<![A-Za-z0-9-])[a-z0-9]+(?:-[a-z0-9]+)+(?![A-Za-z0-9-])', s):
                if t not in ids and t not in vocab and not re.fullmatch(r'[0-9-]+', t):
                    out[t].add('.'.join(path[:4]))
    return out


def manifest():
    t9 = (SPEC / '09-vertical-slice.md').read_text()
    m = re.search(r'```yaml\n(slice:.*?)```', t9, re.S)
    man = yaml.safe_load(m.group(1))['slice']
    rep = []
    for t in man['technologies']:
        if t not in by['technologies']:
            rep.append(f'missing technology id: {t}')
    for i in man['items']:
        if i not in by['items']:
            rep.append(f'missing item id: {i}')
    for r in man['start_recipes']:
        if r not in by['recipes']:
            rep.append(f'missing start recipe id: {r}')
    for r in man['resources']:
        if r not in by['resources']:
            rep.append(f'missing resource id: {r}')
    if 'boil-steam' in t9 and 'boil-steam' not in by['recipes']:  # only while 09 still names it
        rep.append('missing recipe id: boil-steam (09 §2.3 and the manifest "plus boil-steam"; '
                   '02 §9 #7 says it was removed)')
    items = set(man['items'])
    techs = set(man['technologies']) | {'prior-art'}
    for t in sorted(techs):
        x = by['technologies'].get(t)
        if not x:
            continue
        for r in x['unlocks'].get('recipes', []):
            rec = by['recipes'][r]
            outs = [p['id'] for p in rec['products'] if p['id'] not in items]
            ins = [i['id'] for i in rec['ingredients'] if i['id'] not in items]
            if outs or ins:
                rep.append(f'closure: {t} unlocks {r}; outside the filter: products {outs}, '
                           f'ingredients {ins}')
        for p in x.get('prerequisites', []):
            if p not in techs:
                rep.append(f'closure: {t} requires {p}, which is not in the slice')
    for res in man['resources']:
        r = by['resources'].get(res)
        if r and r['yields'] not in items:
            rep.append(f'closure: resource {res} yields {r["yields"]}, not in the filter '
                       f'(hand-mining or a drill would create an unknown item)')
    pa = set(by['technologies']['prior-art']['unlocks']['recipes'])
    sr = set(man['start_recipes'])
    if pa != sr:
        rep.append(f'Prior art unlocks differ: only in data {sorted(pa - sr)}, '
                   f'only in 09 {sorted(sr - pa)}')
    rows = re.findall(r'^\| `([a-z0-9-]+)`[^|]*\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| '
                      r'([^|]+) \| ([^|]+) \|$', t9, re.M)
    for tid, name, _mir, pre, cost, unl, _cit in rows:
        x = by['technologies'].get(tid)
        if not x:
            rep.append(f'09 §2.5 row `{tid}`: no such technology')
            continue
        want = set(re.findall(r'`([a-z0-9-]+)`', unl))
        have = set(x['unlocks'].get('recipes', []))
        if want and want != have:
            rep.append(f'09 §2.5 `{tid}` unlocks: 09 {sorted(want)} vs data {sorted(have)}')
        if name.strip() != x['name']:
            rep.append(f'09 §2.5 `{tid}` name: 09 {name.strip()!r} vs data {x["name"]!r}')
    return rep


def placeholders():
    t8 = (SPEC / '08-text.md').read_text()
    rep = []
    for ph in sorted(set(re.findall(r'\{([a-z][a-z0-9_.-]*\.[a-z0-9_.-]+)\}', t8))):
        parts = ph.split('.')
        ok = False
        if parts[0] == 'entity':
            parts = parts[1:]
        # entity/item field path
        for k in ('entities', 'items', 'recipes'):
            x = by[k].get(parts[0])
            if x is not None:
                cur = x
                for p in parts[1:]:
                    if isinstance(cur, dict) and p in cur:
                        cur = cur[p]
                    elif isinstance(cur, dict) and 'extra' in cur and p in cur['extra']:
                        cur = cur['extra'][p]
                    else:
                        cur = None
                        break
                ok = ok or cur is not None
        # meta path
        cur = meta
        for p in parts:
            cur = cur.get(p) if isinstance(cur, dict) else None
        ok = ok or cur is not None
        if not ok:
            rep.append(f'08 placeholder {{{ph}}} does not resolve to a data path')
    return rep


def secrefs():
    files = {p.name[:2]: p for p in SPEC.glob('[0-9][0-9]-*.md')}
    heads = {}
    for k, p in files.items():
        hs = set()
        for line in p.read_text().splitlines():
            m = re.match(r'^#{2,4}\s+([0-9]+(?:\.[0-9]+)*)\.?\s', line)
            if m:
                hs.add(m.group(1))
        heads[k] = hs
    ref = re.compile(r'(?<![\w.])(?:`?(\d\d)-[a-z-]+\.md`?|\b(\d\d))\s+§\s?([0-9]+(?:\.[0-9]+)*)')
    n, bad = 0, []
    for k, p in sorted(files.items()):
        for ln, line in enumerate(p.read_text().splitlines(), 1):
            for m in ref.finditer(line):
                ch, sec = m.group(1) or m.group(2), m.group(3)
                if ch not in heads:
                    continue
                n += 1
                if sec not in heads[ch]:
                    bad.append(f'{p.name}:{ln}: {ch} §{sec} has no heading')
    return n, bad


if __name__ == '__main__':
    dangling, nondata = scan_md()
    print('== A. Backtick ids in spec prose that are not data ids')
    for f, ln, t in dangling:
        print(f'  {f}:{ln}: `{t}`')
    print(f'  ({len(nondata)} further UI/tooling ids ignored as non-data)')
    print('\n== B. Unknown kebab tokens inside YAML values')
    yb = scan_yaml()
    for t, ps in sorted(yb.items()):
        print(f'  {t} <- {sorted(ps)[:3]}')
    if not yb:
        print('  none')
    print('\n== C. 09 slice manifest against the final data')
    for r in manifest():
        print('  ' + r)
    print('\n== D. 08 placeholders')
    for r in placeholders() or ['all resolve']:
        print('  ' + r)
    n, bad = secrefs()
    print(f'\n== E. Chapter section references: {n} checked, {len(bad)} dangling')
    for b in bad:
        print('  ' + b)
