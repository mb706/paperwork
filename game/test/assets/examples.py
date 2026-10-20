"""Contract examples (codex C6-r1 findings 4, 5 and 11): small models that exercise the parts of the model contract
M0's art does not use, rendered and post-processed by the build's own steps, packed into an atlas by the build's
cell rules, and checked.

    gamedev-python game/test/assets/examples.py [--no-render]

  examples/object_shrub.py      the `object` kind: 2 shapes x 5 leaf stages, a shadow per shape; the authoring
                                example for trees, rocks, decoratives and town buildings
  examples/entity_animated.py   an entity in two directions with three layers whose rectangles intersect in one
                                direction only (one slot structure for both), an animated shadow and a moving
                                emitter (its light per frame)
Each renders with render.py (cached in .cache/assets/examples/ by the SHA-256 of the model, render.py, jobs.py,
lib/ and Blender's version), is post-processed by post.py, packed with the build's cells (32-px colour cells with
8-px gutters, four levels) and checked: manifest.validate (layer slots, animated channels, the object program),
quality.py's per-set checks, composite.py on the packed atlas, and each example's own expectations. Writes
.cache/assets/qc/examples.png (each example's pictures on the paper) and exits non-zero on a failure.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(GAME, 'scripts', 'assets'))
import assemble as A  # noqa: E402
import common as K  # noqa: E402
import composite as CP  # noqa: E402
import manifest as MF  # noqa: E402
import post as PO  # noqa: E402
import quality as Q  # noqa: E402

OUT = os.path.join(K.CACHE, 'examples')
QC = os.path.join(K.CACHE, 'qc')
BLENDER = os.environ.get('PAPERWORK_BLENDER', os.path.expanduser('~/.local/opt/blender-current/blender'))
EXAMPLES = (('object/example-shrub', 'object', 'object_shrub.py'),
            ('entity/example-animated', 'entity', 'entity_animated.py'))
# the build's arrays and cell rules (build-assets.ts ARRAYS)
ARRAYS = [dict(kind='colour', pxPerTile=64, pageSize=2048, levels=4, codec='rgba8', align=32, gutter=8),
          dict(kind='shadow', pxPerTile=32, pageSize=1024, levels=3, codec='rgba8', align=16, gutter=4),
          dict(kind='light', pxPerTile=16, pageSize=512, levels=2, codec='rgba8', align=8, gutter=2),
          dict(kind='icon', pxPerTile=64, pageSize=1024, levels=3, codec='rgba8', align=16, gutter=4)]
KIND_INDEX = {a['kind']: i for i, a in enumerate(ARRAYS)}


def key_of(script):
    h = hashlib.sha256()
    for p in [script, os.path.join(K.BLENDER_SRC, 'render.py'), os.path.join(K.BLENDER_SRC, 'jobs.py')] + sorted(
            os.path.join(K.BLENDER_SRC, 'lib', f) for f in os.listdir(os.path.join(K.BLENDER_SRC, 'lib'))
            if f.endswith('.py')):
        h.update(os.path.basename(p).encode())
        h.update(K.sha256_file(p).encode())
    v = os.path.join(K.CACHE, 'blender-version.txt')
    h.update(open(v).read().encode() if os.path.exists(v) else b'')
    return h.hexdigest()[:24]


def render(name, kind, script, out, no_render):
    if os.path.exists(os.path.join(out, 'record.json')):
        return
    if no_render:
        raise SystemExit(f'[examples] FAIL {name}: not rendered for this key and --no-render is set')
    os.makedirs(OUT, exist_ok=True)
    jobs = os.path.join(OUT, f'{name.replace("/", "-")}.jobs.json')
    with open(jobs, 'w') as f:
        json.dump([dict(set=name, kind=kind, script=script, sources=[os.path.relpath(script, GAME)], out=out,
                        style='survey')], f)
    r = subprocess.run(['taskset', '-c', '8-15,24-31', BLENDER, '-b', '--factory-startup', '-noaudio',
                        '--python-exit-code', '1', '--python', os.path.join(K.BLENDER_SRC, 'render.py'), '--',
                        '--jobs', jobs, '--threads', '16'], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(os.path.join(out, 'record.json')):
        raise SystemExit(f'[examples] FAIL {name}: render failed ({r.returncode}):\n{(r.stdout + r.stderr)[-3000:]}')


def pack(sd, post_dir):
    """The set's frames in the build's cells, one page per array: (manifest, page levels by array)."""
    by_array = {i: [] for i in range(len(ARRAYS))}
    for f in sd['frames']:
        if 'parent' not in f:
            by_array[KIND_INDEX[f['array']]].append(f)
    pos, pages = {}, {}
    for ai, arr in enumerate(ARRAYS):
        S, g, al = arr['pageSize'], arr['gutter'], arr['align']
        cells, x, y, row = [], 0, 0, 0
        for f in sorted(by_array[ai], key=lambda f: (-f['h'], f['id'])):
            cw, ch = -(-(f['w'] + 2 * g) // al) * al, -(-(f['h'] + 2 * g) // al) * al
            if x + cw > S:
                x, y, row = 0, y + row, 0
            if y + ch > S:
                raise SystemExit(f'[examples] FAIL {sd["set"]}: the {arr["kind"]} frames do not fit one page')
            cells.append(dict(set=sd['set'], local=f['id'], dir=post_dir, file=f['file'], pad=f['pad'], w=f['w'],
                              h=f['h'], cw=cw, ch=ch, x=x, y=y))
            pos[f['id']] = (ai, x + g, y + g)
            x += cw
            row = max(row, ch)
        img = A.compose(dict(cells=cells), arr)
        pages[ai] = [lv.astype(np.float32) / 255.0 for lv in A.levels_of(img, arr['levels'])]
    frames = []
    for f in sd['frames']:
        own = sd['frames'][f['parent']] if 'parent' in f else f
        ai, fx, fy = pos[own['id']]
        sx, sy = (f['sub'][0], f['sub'][1]) if 'sub' in f else (0, 0)
        frames.append([ai, 0, fx + sx, fy + sy, f['w'], f['h'], f['ax'], f['ay']])
    s = dict(kind=sd['kind'], group='core', parts=sd['parts'], **sd['extra'])
    if sd['kind'] in ('entity', 'inserter'):
        s['size'] = sd['size']
    man = dict(version=2, axesVersion=MF.AXES_VERSION, prototypesHash='0' * 64, style='example',
               arrays=[{k: a[k] for k in ('kind', 'pxPerTile', 'pageSize', 'levels', 'codec')} for a in ARRAYS],
               pages=[[dict(group='core', files=['-'], bytes=[1])] for _ in ARRAYS], frames=frames,
               sets={sd['set']: s})
    return man, pages


def expectations(name, man, rec):
    s = man['sets'][name]
    parts = s['parts']
    errs = []
    if name == 'object/example-shrub':
        b, sh = parts.get('base'), parts.get('shadow')
        if not b or b['axes'] != ['shape', 'stage'] or b['shape'] != [2, 5] or b['map'].get('stage') != [0, 1, 2, 3, 4]:
            errs.append(f'base is {b and (b["axes"], b["shape"], b.get("map"))}, not [shape 2, stage 5]')
        if not sh or sh['axes'] != ['shape'] or sh['shape'] != [2] or not all(sh['table']):
            errs.append('shadow is not [shape 2] with every entry drawn')
        if b and not all(b['table']):
            errs.append('an empty (shape, stage) picture')
    if name == 'entity/example-animated':
        if rec.get('slots') != [[0, 1], [2]]:
            errs.append(f'slots {rec.get("slots")}, not [[0, 1], [2]] (layers 0 and 1 meet facing north only)')
        if len(parts.get('layers') or []) != 2:
            errs.append(f'{len(parts.get("layers") or [])} layer parts, not 2')
        for flag, part in (('animShadow', 'shadow'), ('animLight', 'light')):
            p = parts.get(part)
            if not s.get(flag) or not p or 'frame' not in p['axes'] or p['shape'][-1] != 8:
                errs.append(f'{part} is not animated over 8 frames ({flag} {s.get(flag)})')
        if not s.get('animLight') or rec.get('lit_slots') != [0]:
            errs.append(f'the lamp\'s slot should carry the moving light (lit slots {rec.get("lit_slots")})')
    return errs


def moves(man, pages, part):
    """Whether frames 0 and 2 of an animated part (direction 0) differ in placement or pixels."""
    p = man['sets']['entity/example-animated']['parts'].get(part)
    if not p or 'frame' not in p['axes']:
        return False
    f0, f4 = (man['frames'][p['table'][k][0]] for k in (0, 2))
    if f0[4:8] != f4[4:8]:
        return True
    img = pages[f0[0]][0]
    a = img[f0[3]:f0[3] + f0[5], f0[2]:f0[2] + f0[4]]
    b = img[f4[3]:f4[3] + f4[5], f4[2]:f4[2] + f4[4]]
    return bool(np.abs(a - b).max() > 1 / 255)


def overview(name, man, pages):
    """Each picture of the set on the paper at 1x (entity: both directions at phases 0, 1/4, 1/2, 3/4)."""
    s = man['sets'][name]
    paper = K.hexc(K.PAPER_HEX)
    tiles = []

    def page_level(a, layer, lv):
        return pages[a][lv]

    def canvas_of(draws):
        c = np.zeros((256, 288, 4), np.float32)
        sh = np.zeros((256, 288, 4), np.float32)
        for d in draws:
            for fid, kind in zip(d['frames'], d['passes']):
                fr = man['frames'][fid]
                a, layer, x, y, w, h, ax, ay = fr
                k = 64 / ARRAYS[a]['pxPerTile']
                quad = ((-ax, -ay, -ax + w, -ay + h), (x, y))
                tex = page_level(a, 0, 0)
                if kind == 'shadow':
                    tex = np.concatenate([np.zeros(tex.shape[:2] + (3,), np.float32), tex[..., :1] * 0.35], -1)
                    CP.draw(sh, tex, (0, 0), quad, 0, k, 110, 180)
                elif kind == 'light':
                    pass
                else:
                    CP.draw(c, tex, (0, 0), quad, 0, k, 110, 180)
        out = paper * (1 - sh[..., 3:4])
        return c[..., :3] + (1 - c[..., 3:4]) * out

    if s['kind'] == 'object':
        b = s['parts']['base']
        for shape in range(b['shape'][0]):
            for stage in range(b['shape'][1]):
                draws = [MF.draws_for(man, 'base', MF.lookup(b, dict(shape=shape, stage=stage)), dict(
                    cx=0, cy=0, zoom=1, dpr=1), 0, 0),
                    MF.draws_for(man, 'shadow', MF.lookup(s['parts']['shadow'], dict(shape=shape)), dict(
                        cx=0, cy=0, zoom=1, dpr=1), 0, 0)]
                tiles.append(canvas_of(draws))
    else:
        for d in (0, 4):
            for phase in (0, 16384, 32768, 49152):
                view = dict(x2=0, y2=0, dir=d, variant=0, dyn=dict(state=1, phase=phase, light=255))
                tiles.append(canvas_of(MF.draw_entity(man, name, view, dict(cx=0, cy=0, zoom=1, dpr=1))))
    return np.concatenate(tiles, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-render', action='store_true')
    a = ap.parse_args()
    errs, strips = [], []
    for name, kind, fn in EXAMPLES:
        script = os.path.join(HERE, 'examples', fn)
        key = key_of(script)
        rdir = os.path.join(OUT, f'render-{name.replace("/", "-")}-{key}')
        pdir = os.path.join(OUT, f'post-{name.replace("/", "-")}-{key}')
        render(name, kind, script, rdir, a.no_render)
        rec = K.load_json(os.path.join(rdir, 'record.json'))
        try:
            PO.run(rdir, pdir, script)
        except Exception as e:  # noqa: BLE001
            errs.append(f'{name}: post failed: {e}')
            continue
        sd = K.load_json(os.path.join(pdir, 'set.json'))
        sd['render_path'] = rdir                   # the example's render is not in the build's render cache
        q_errs, q_res = Q.check_set(name, sd, pdir)
        errs += [f'{name}: {e}' for e in q_errs]
        man, pages = pack(sd, pdir)
        errs += [f'{name}: {e}' for e in MF.validate(man)]
        c_errs, c_res = CP.check(man, lambda ai, layer, lv, pg=pages: pg[ai][lv])
        errs += [f'{name}: {e}' for e in c_errs]
        errs += [f'{name}: {e}' for e in expectations(name, man, rec)]
        if name == 'entity/example-animated':
            errs += [f'{name}: {part} frames 0 and 2 are the same picture' for part in ('light', 'shadow')
                     if not moves(man, pages, part)]
        strips.append(overview(name, man, pages))
        print(f'[examples] {name}: {len(sd["frames"])} frames; composite {c_res}; '
              f'{sum(1 for k in q_res if "registration" in k)} registration checks', flush=True)
    if strips:
        W = max(s.shape[1] for s in strips)
        sheet = np.ones((sum(s.shape[0] for s in strips) + 8 * len(strips), W, 3), np.float32) * 0.1
        y = 0
        for s in strips:
            sheet[y:y + s.shape[0], :s.shape[1]] = s
            y += s.shape[0] + 8
        os.makedirs(QC, exist_ok=True)
        Image.fromarray(K.to8(sheet)).save(os.path.join(QC, 'examples.png'))
    for e in errs:
        print(f'[examples] FAIL {e}', flush=True)
    print(f'[examples] {len(errs)} failure(s)', flush=True)
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
