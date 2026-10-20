"""B2 render study, step 4 (codex B2-r1 finding 2, "preserve common ink coordinates"): inking only R plus a margin
equals inking the whole frame, inside R, once the ink's position-dependent fields use the canvas's coordinates.

    taskset -c 8-15,24-31 gamedev-python -I design/asset-study/render/ink_locality_check.py [entity/combo ...]
    taskset -c 8-15,24-31 gamedev-python -I design/asset-study/render/ink_locality_check.py --bbox

Inputs: the complete layered build (render_layers.py --all --full-base; design/art/out/layers/build/<entity>/<combo>/).
For each frame k: F_k's passes are F_0's with R replaced by frame k's. Whole = survey_ink(F_k) cropped to R.
Crop = survey_ink(F_k's passes cropped to R grown by RHO px) cropped to R, where the ink's noise fields (pen
pressure, mottle, paper grain) and hatching are evaluated over the whole canvas and cropped (what production does:
once per set). Reports the largest difference in any channel inside R, and the same with A3's unmodified ink
(fields generated per call at the crop's size) for comparison. With --bbox: F_0 inked only inside the 2x passes'
coverage bounding box plus RHO (8-px aligned) against the whole canvas, for every entity of the build.
"""

import json
import os
import re
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'design', 'art', 'proto'))
import post  # noqa: E402

RHO = 16
CROP = None            # (x0, y0, W, H) of the current crop at High, or None
_vn, _pg, _hatch = post.value_noise, post.paper_grain, post.hatch


def _crop(fn, h, w, *a, **k):
    global CROP
    x0, y0, W, H = CROP
    s = 2 if (h, w) != (CROP_HW[0], CROP_HW[1]) else 1
    saved, CROP = CROP, None
    try:
        full = fn(H * s, W * s, *a, **k)
    finally:
        CROP = saved
    return full[y0 * s:y0 * s + h, x0 * s:x0 * s + w]


def value_noise(h, w, *a, **k):
    return _vn(h, w, *a, **k) if CROP is None else _crop(_vn, h, w, *a, **k)


def paper_grain(h, w, *a, **k):
    return _pg(h, w, *a, **k) if CROP is None else _crop(_pg, h, w, *a, **k)


def hatch(h, w, *a, **k):
    return _hatch(h, w, *a, **k) if CROP is None else _crop(_hatch, h, w, *a, **k)


def run(entity, combo, canvas_fields=True):
    global CROP, CROP_HW
    d = os.path.join(ROOT, 'design', 'art', 'out', 'layers', 'build', entity, combo)
    t = json.load(open(os.path.join(d, 'timing.json')))
    x0, y0, x1, y1 = t['rect']
    if x1 <= x0:
        return None
    W, H = t['canvas']
    rd = lambda p: post.read_png(os.path.join(d, p))
    base = {ps: rd(f'base.{ps}.png') for ps in ('colour', 'normal', 'aux')}
    seed = zlib.crc32(re.sub(r'-f\d+', '', f'{entity}-{combo}-f00').encode()) % 1000
    ink = lambda c, n, a: post.survey_ink(c, n, a, 'survey', seed=seed, line_alpha=post.INK_WEIGHT.get(entity, 1.0))
    post.value_noise, post.paper_grain, post.hatch = (value_noise, paper_grain, hatch) if canvas_fields else (_vn, _pg, _hatch)
    worst = 0.0
    frames = sorted(set([0, t['frames'] // 3, 2 * t['frames'] // 3, t['frames'] - 1]))
    for k in frames:
        full = {ps: base[ps].copy() for ps in base}
        for ps in ('colour', 'normal', 'aux'):
            reg = rd(f'anim-f{k:02d}.{ps}.png')
            s = 2 if ps != 'colour' else 1
            full[ps][y0 * s:y0 * s + reg.shape[0], x0 * s:x0 * s + reg.shape[1]] = reg
        CROP = None
        whole = ink(full['colour'], full['normal'], full['aux'])[y0:y1, x0:x1]
        cx0, cy0, cx1, cy1 = max(0, x0 - RHO), max(0, y0 - RHO), min(W, x1 + RHO), min(H, y1 + RHO)
        CROP, CROP_HW = (cx0, cy0, W, H), (cy1 - cy0, cx1 - cx0)
        part = ink(full['colour'][cy0:cy1, cx0:cx1], full['normal'][2 * cy0:2 * cy1, 2 * cx0:2 * cx1],
                   full['aux'][2 * cy0:2 * cy1, 2 * cx0:2 * cx1])
        CROP = None
        part = part[y0 - cy0:y1 - cy0, x0 - cx0:x1 - cx0]
        worst = max(worst, float(np.abs(part - whole).max()))
    post.value_noise, post.paper_grain, post.hatch = _vn, _pg, _hatch
    return dict(entity=entity, combo=combo, frames=frames, rect=t['rect'], max_abs_diff=round(worst, 6),
                in_8bit_steps=round(worst * 255, 3))


CROP_HW = (0, 0)


def run_bbox(entity, combo):
    """F_0: ink only the colour's alpha bounding box plus RHO; outside it the whole-canvas ink must be empty."""
    global CROP, CROP_HW
    d = os.path.join(ROOT, 'design', 'art', 'out', 'layers', 'build', entity, combo)
    t = json.load(open(os.path.join(d, 'timing.json')))
    W, H = t['canvas']
    rd = lambda p: post.read_png(os.path.join(d, p))
    base = {ps: rd(f'base.{ps}.png') for ps in ('colour', 'normal', 'aux')}
    seed = zlib.crc32(re.sub(r'-f\d+', '', f'{entity}-{combo}-f00').encode()) % 1000
    ink = lambda c, n, a: post.survey_ink(c, n, a, 'survey', seed=seed, line_alpha=post.INK_WEIGHT.get(entity, 1.0))
    post.value_noise, post.paper_grain, post.hatch = value_noise, paper_grain, hatch
    a2 = base['normal'][..., 3] > 0                       # the 2x passes' coverage, which the lines follow
    ys, xs = (v // 2 for v in a2.nonzero())
    x0, x1 = max(0, int(xs.min()) - RHO) // 8 * 8, min(W, -(-(int(xs.max()) + 1 + RHO) // 8) * 8)
    y0, y1 = max(0, int(ys.min()) - RHO) // 8 * 8, min(H, -(-(int(ys.max()) + 1 + RHO) // 8) * 8)
    CROP = None
    whole = ink(base['colour'], base['normal'], base['aux'])
    CROP, CROP_HW = (x0, y0, W, H), (y1 - y0, x1 - x0)
    part = ink(base['colour'][y0:y1, x0:x1], base['normal'][2 * y0:2 * y1, 2 * x0:2 * x1], base['aux'][2 * y0:2 * y1, 2 * x0:2 * x1])
    CROP = None
    post.value_noise, post.paper_grain, post.hatch = _vn, _pg, _hatch
    outside = whole[..., 3].copy()
    outside[y0:y1, x0:x1] = 0
    return dict(entity=entity, combo=combo, inked_share=round((x1 - x0) * (y1 - y0) / (W * H), 3),
                max_abs_diff=round(float(np.abs(part - whole[y0:y1, x0:x1]).max()), 6),
                alpha_outside=round(float(outside.max()), 6))


def main():
    if sys.argv[1:2] == ['--bbox']:
        out = []
        for d in sorted(os.listdir(os.path.join(ROOT, 'design', 'art', 'out', 'layers', 'build'))):
            for c in sorted(os.listdir(os.path.join(ROOT, 'design', 'art', 'out', 'layers', 'build', d)))[:2]:
                r = run_bbox(d, c)
                out.append(r)
                print(json.dumps(r), flush=True)
        print('worst diff', max(r['max_abs_diff'] for r in out), 'worst alpha outside', max(r['alpha_outside'] for r in out),
              'mean inked share', round(sum(r['inked_share'] for r in out) / len(out), 3))
        json.dump(out, open(os.path.join(ROOT, 'design', 'art', 'out', 'layers', 'ink_bbox.json'), 'w'), indent=1)
        return
    targets = sys.argv[1:] or ['keypunch/S0', 'assembling-machine-1/S0', 'electric-mining-drill/N0', 'steam-engine/S0',
                               'research-hall/S0', 'transport-belt/E1']
    out = []
    for tg in targets:
        e, c = tg.split('/')
        a = run(e, c, True)
        b = run(e, c, False)
        print(json.dumps(dict(canvas_fields=a, a3_fields_per_call=dict(max_abs_diff=b['max_abs_diff'], in_8bit_steps=b['in_8bit_steps']))), flush=True)
        out.append(dict(canvas_fields=a, a3=b))
    json.dump(out, open(os.path.join(ROOT, 'design', 'art', 'out', 'layers', 'ink_locality.json'), 'w'), indent=1)


main()
