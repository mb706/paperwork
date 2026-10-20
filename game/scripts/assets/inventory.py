"""The byte inventory (10 §9.7): every atlas group's files and exact bytes on the wire, and the build gate.

    gamedev-python game/scripts/assets/inventory.py --manifest <sprites.json> --out <inventory.json>
        [--gate-core 5000000] [--gate-group 3000000]

Reads a manifest (the build's staged one, before it is published) and writes the inventory. Per group: the
Normal levels (colour `.n` files, shadows, lights, icons), its DOM icon sheets and, for core, the terrain
textures, the UI skin and the fonts; High level 0 (`.h` files) is listed apart, because it streams on demand and
is not in a stage budget.
KTX2, WebP and WOFF2 are already compressed, so their bytes are the wire bytes; the JSON manifests are counted
brotli-compressed (quality 11), as the build serves them.

Gate: `core` plus the first frame's other files must stay within 5 MB. The asset build knows only its own files,
so the others are §9.7's estimate (code and data 0.6 MB, the transcoder 0.4 MB, the slice SFX 0.6 MB) unless
dist/build-manifest.json lists the real ones; any other group within 3 MB. A failure names the group's largest
sets and exits non-zero.
"""

import argparse
import os
import sys

import brotli

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402

FIRST_FRAME_OTHER_ESTIMATE = dict(code_and_data=600_000, transcoder=400_000, sfx=600_000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gate-core', type=int, default=5_000_000)
    ap.add_argument('--gate-group', type=int, default=3_000_000)
    ap.add_argument('--manifest', default=os.path.join(K.PUBLIC, 'atlases', 'sprites.json'))
    ap.add_argument('--out', default=os.path.join(K.PUBLIC, 'atlases', 'inventory.json'))
    a = ap.parse_args()
    man_path = a.manifest
    man = K.load_json(man_path)
    groups = {}

    def g(name):
        return groups.setdefault(name, dict(normal=[], high=[], dom=[], normal_bytes=0, high_bytes=0, sets=0))

    for ai, arr in enumerate(man['arrays']):
        for page in man['pages'][ai]:
            G = g(page['group'])
            for i, (f, b) in enumerate(zip(page['files'], page['bytes'])):
                if arr['kind'] == 'colour' and i == 0:
                    G['high'].append([f, b])
                    G['high_bytes'] += b
                else:
                    G['normal'].append([f, b])
                    G['normal_bytes'] += b
    for grp, files in man.get('dom', {}).get('icons', {}).items():
        G = g(grp)
        for f, b in zip(files, man['dom']['iconSheets'][grp]['bytes']):
            G['dom'].append([f, b])
            G['normal_bytes'] += b
    core = g('core')
    for t, rec in sorted(man.get('terrain', {}).get('tiles', {}).items()):
        core['normal'].append([rec['file'], rec['bytes']])
        core['normal_bytes'] += rec['bytes']
    for extra in ('ui.json', 'fonts.json'):
        p = os.path.join(K.CACHE, extra)
        if os.path.exists(p):
            for f in K.load_json(p).get('files', []):
                core['dom'].append([f['file'], f['bytes']])
                core['normal_bytes'] += f['bytes']
    with open(man_path, 'rb') as f:
        mb = len(brotli.compress(f.read(), quality=11))
    core['dom'].append(['atlases/sprites.json (brotli)', mb])
    core['normal_bytes'] += mb
    sizes = {}
    for name, s in man['sets'].items():
        g(s['group'])['sets'] += 1
        ids = set()
        parts = s['parts'].values()
        for p in parts:
            for q in (p if isinstance(p, list) else [p]):
                for e in q['table']:
                    ids.update(e)
        sizes[name] = sum(man['frames'][i][4] * man['frames'][i][5] for i in ids)
    other = FIRST_FRAME_OTHER_ESTIMATE
    dist = os.path.join(K.GAME, 'dist', 'build-manifest.json')
    other_source = 'estimate (10 §9.7)'
    if os.path.exists(dist):
        other_source = 'estimate (10 §9.7); dist/ exists but its first-frame list is not split yet'
    first_frame = core['normal_bytes'] + sum(other.values())
    fails = []
    if first_frame > a.gate_core:
        fails.append(f'core plus the first frame: {first_frame / 1e6:.2f} MB > {a.gate_core / 1e6:.2f} MB')
    for name, G in groups.items():
        if name != 'core' and G['normal_bytes'] > a.gate_group:
            fails.append(f'group {name}: {G["normal_bytes"] / 1e6:.2f} MB > {a.gate_group / 1e6:.2f} MB')
    for name, G in groups.items():
        G['largest_sets'] = [n for n, _ in sorted(((n, sizes[n]) for n, s in man['sets'].items()
                                                  if s['group'] == name), key=lambda kv: -kv[1])[:5]]
    inv = dict(groups=dict(sorted(groups.items())), first_frame=dict(core_bytes=core['normal_bytes'],
               other_bytes=other, other_source=other_source, total=first_frame, gate=a.gate_core),
               gate_group=a.gate_group, ok=not fails, failures=fails)
    K.dump_json(a.out, inv)
    for name, G in sorted(groups.items()):
        print(f'[budget] group {name}: Normal {G["normal_bytes"] / 1e3:.0f} kB, High level 0 '
              f'{G["high_bytes"] / 1e3:.0f} kB, {G["sets"]} sets', flush=True)
    print(f'[budget] first frame: core {core["normal_bytes"] / 1e6:.2f} MB + other {sum(other.values()) / 1e6:.2f} '
          f'MB = {first_frame / 1e6:.2f} MB (gate {a.gate_core / 1e6:.1f} MB)', flush=True)
    if fails:
        for f in fails:
            print(f'[budget] FAIL {f}', flush=True)
        for name, G in groups.items():
            print(f'[budget] {name}: largest sets {G["largest_sets"]}', flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
