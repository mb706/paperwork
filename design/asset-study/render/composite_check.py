"""B2 render study, step 2: check that a layered set reproduces the full frames (10 §9.5's composite check).

    gamedev-python -I design/asset-study/render/composite_check.py keypunch [frames=0,5,10,15]

Inputs: render_layers.py's outputs (design/art/out/layers/<entity>/: base passes, per-frame passes inside R,
timing.json with R) and A3's full per-frame renders of the same entity (design/art/out/layers/baseline/survey/
<entity>/, from design/art/proto/render.py --out design/art/out/layers/baseline). For each frame k:
  F_k = ink(base passes with R replaced by frame k's passes)        the layered pipeline's full frame
  B   = ink(base passes)                                             the static base
  A_k = F_k cropped to R                                             the animated layer
  compare B with A_k drawn over it against F_k, and F_k against ink(A3's full render of frame k).
Reports dE76 percentiles over the sprite's pixels, composited on the survey paper.
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

PAPER = np.array([0xec, 0xe3, 0xcb], np.float32) / 255.0


def lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883], np.float32)
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def over(top, bottom):
    """premultiplied-alpha composite of straight-alpha images"""
    ta, ba = top[..., 3:4], bottom[..., 3:4]
    a = ta + ba * (1 - ta)
    rgb = (top[..., :3] * ta + bottom[..., :3] * ba * (1 - ta)) / np.maximum(a, 1e-6)
    return np.concatenate([rgb, a], -1)


def on_paper(x):
    return x[..., :3] * x[..., 3:4] + PAPER * (1 - x[..., 3:4])


def de(a, b, mask):
    d = np.sqrt(((lab(np.clip(on_paper(a), 0, 1)) - lab(np.clip(on_paper(b), 0, 1))) ** 2).sum(-1))[mask]
    return dict(p50=round(float(np.percentile(d, 50)), 2), p99=round(float(np.percentile(d, 99)), 2),
                p999=round(float(np.percentile(d, 99.9)), 2), max=round(float(d.max()), 1),
                share_le3=round(float((d <= 3).mean()), 5))


def main():
    ent = sys.argv[1]
    frames = [int(f) for f in (sys.argv[2] if len(sys.argv) > 2 else '0,5,10,15').split(',')]
    d = os.path.join(ROOT, 'design', 'art', 'out', 'layers', ent)
    t = json.load(open(os.path.join(d, 'timing.json')))
    x0, y0, x1, y1 = t['rect']
    rd = lambda p: post.read_png(os.path.join(d, p))
    base = {ps: rd(f'base.{ps}.png') for ps in ('colour', 'normal', 'aux')}
    seed = zlib.crc32(re.sub(r'-f\d+', '', f'{ent}-S-f00').encode()) % 1000
    ink = lambda c, n, a: post.survey_ink(c, n, a, 'survey', seed=seed, line_alpha=post.INK_WEIGHT.get(ent, 1.0))
    B = ink(base['colour'], base['normal'], base['aux'])
    bd = os.path.join(ROOT, 'design', 'art', 'out', 'layers', 'baseline', 'survey', ent)
    out = {}
    for k in frames:
        full = {ps: base[ps].copy() for ps in base}
        for ps in ('colour', 'normal', 'aux'):
            reg = rd(f'anim-f{k:02d}.{ps}.png')
            s = 2 if ps != 'colour' else 1
            full[ps][y0 * s:y0 * s + reg.shape[0], x0 * s:x0 * s + reg.shape[1]] = reg
        F = ink(full['colour'], full['normal'], full['aux'])
        A = np.zeros_like(F)
        A[y0:y1, x0:x1] = F[y0:y1, x0:x1]
        comp = B.copy()
        comp[y0:y1, x0:x1] = over(F[y0:y1, x0:x1], B[y0:y1, x0:x1])
        mask = (F[..., 3] > 0.01) | (comp[..., 3] > 0.01)
        r = dict(base_plus_layer_vs_layered_full=de(comp, F, mask))
        stem = f'{ent}-S-f{k:02d}'
        if os.path.exists(os.path.join(bd, f'{stem}.colour.png')):
            c = post.read_png(os.path.join(bd, f'{stem}.colour.png'))
            n = post.read_png(os.path.join(bd, f'{stem}.normal.png'))
            a = post.read_png(os.path.join(bd, f'{stem}.aux.png'))
            G = ink(c, n, a)
            m2 = (G[..., 3] > 0.01) | (comp[..., 3] > 0.01)
            r['base_plus_layer_vs_a3_full_render'] = de(comp, G, m2)
        out[k] = r
        print(ent, 'frame', k, json.dumps(r), flush=True)
    json.dump(out, open(os.path.join(d, 'composite_check.json'), 'w'), indent=1)
    # a side-by-side picture: A3's full frame, base + layer, and the difference x8
    if os.path.exists(os.path.join(bd, f'{ent}-S-f{frames[-1]:02d}.colour.png')):
        from PIL import Image
        k = frames[-1]
        full = {ps: base[ps].copy() for ps in base}
        for ps in ('colour', 'normal', 'aux'):
            reg = rd(f'anim-f{k:02d}.{ps}.png')
            s = 2 if ps != 'colour' else 1
            full[ps][y0 * s:y0 * s + reg.shape[0], x0 * s:x0 * s + reg.shape[1]] = reg
        F = ink(full['colour'], full['normal'], full['aux'])
        comp = B.copy()
        comp[y0:y1, x0:x1] = over(F[y0:y1, x0:x1], B[y0:y1, x0:x1])
        stem = f'{ent}-S-f{k:02d}'
        G = ink(post.read_png(os.path.join(bd, f'{stem}.colour.png')), post.read_png(os.path.join(bd, f'{stem}.normal.png')),
                post.read_png(os.path.join(bd, f'{stem}.aux.png')))
        diff = np.clip(np.abs(on_paper(comp) - on_paper(G)) * 8, 0, 1)
        row = np.concatenate([on_paper(G), on_paper(comp), diff], 1)
        Image.fromarray((np.clip(row, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(d, 'composite_check.png'))


if __name__ == '__main__':
    main()
