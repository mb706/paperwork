"""B2 render study, step 3 (codex B2-r1 finding 2): verify the piece-based composition of animated sets.

    gamedev-python -I design/asset-study/render/pieces_check.py keypunch [frames] [--translucent]

The scheme of 10 §9.1: frame 0 is rendered in full; each animated layer is re-rendered inside its rectangle R.
A working set is drawn as the base *pieces* (frame 0 minus every R, cut into at most 4 rectangles per R) plus the
layer frame inside R. Every piece is packed with a gutter filled with its source's real neighbouring pixels, so
bilinear filtering is correct across the cuts. Each screen pixel is drawn by exactly one quad (pixel centres in
half-open rectangles), so nothing is drawn twice.

The check composites the pieces exactly as the renderer would (premultiplied alpha, bilinear sampling, the mip
level chosen by scale) at several scales and sub-pixel offsets, and compares the result with drawing the full
frame F_k as one sprite the same way. It also runs the replaced v1 scheme (the layer patch drawn source-over a
complete base) for comparison, and with --translucent it makes a band of static pixels crossing R's edge 22%
opaque, the case codex raised (glass): the v1 scheme double-draws it, the piece scheme cannot.
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
G = 8          # gutter at level 0 (High), filled with the source's real pixels


def lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883], np.float32)
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def premul(x):
    y = x.copy()
    y[..., :3] *= y[..., 3:4]
    return y


def down(img):
    h, w = img.shape[:2]
    return img[:h // 2 * 2, :w // 2 * 2].reshape(h // 2, 2, w // 2, 2, 4).mean(axis=(1, 3))


def piece_texture(src_pm, rect, level):
    """The piece's padded texture at a level: the source's pixels in rect grown by the gutter (zeros outside)."""
    x0, y0, x1, y1 = rect
    H, W = src_pm.shape[:2]
    pad = np.zeros((y1 - y0 + 2 * G, x1 - x0 + 2 * G, 4), np.float32)
    sx0, sy0, sx1, sy1 = max(0, x0 - G), max(0, y0 - G), min(W, x1 + G), min(H, y1 + G)
    pad[sy0 - (y0 - G):sy1 - (y0 - G), sx0 - (x0 - G):sx1 - (x0 - G)] = src_pm[sy0:sy1, sx0:sx1]
    for _ in range(level):
        pad = down(pad)
    return pad


def draw(canvas, tex, rect, level, s, ox, oy):
    """Draw one piece: screen pixels whose centres fall in the rect's half-open screen rectangle sample the
    padded texture bilinearly (texel centres at +0.5) and composite premultiplied source-over."""
    x0, y0, x1, y1 = rect
    H, W = canvas.shape[:2]
    sx0, sx1 = ox + x0 * s, ox + x1 * s
    sy0, sy1 = oy + y0 * s, oy + y1 * s
    i0, i1 = max(0, int(np.ceil(sx0 - 0.5))), min(W, int(np.ceil(sx1 - 0.5)))
    j0, j1 = max(0, int(np.ceil(sy0 - 0.5))), min(H, int(np.ceil(sy1 - 0.5)))
    if i1 <= i0 or j1 <= j0:
        return
    f = 2 ** level
    ii, jj = np.meshgrid(np.arange(i0, i1), np.arange(j0, j1))
    u = ((ii + 0.5 - ox) / s - (x0 - G)) / f - 0.5          # texel coordinates in the padded level texture
    v = ((jj + 0.5 - oy) / s - (y0 - G)) / f - 0.5
    th, tw = tex.shape[:2]
    u = np.clip(u, 0, tw - 1.001)
    v = np.clip(v, 0, th - 1.001)
    a, b = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = (u - a)[..., None], (v - b)[..., None]
    c = (tex[b, a] * (1 - fu) * (1 - fv) + tex[b, np.minimum(a + 1, tw - 1)] * fu * (1 - fv)
         + tex[np.minimum(b + 1, th - 1), a] * (1 - fu) * fv + tex[np.minimum(b + 1, th - 1), np.minimum(a + 1, tw - 1)] * fu * fv)
    dst = canvas[j0:j1, i0:i1]
    dst[...] = c + dst * (1 - c[..., 3:4])


def pieces_of(H, W, R):
    """The base minus R, as at most 4 rectangles (top, bottom, left, right), half-open, in source pixels."""
    x0, y0, x1, y1 = R
    out = [(0, 0, W, y0), (0, y1, W, H), (0, y0, x0, y1), (x1, y0, W, y1)]
    return [r for r in out if r[2] > r[0] and r[3] > r[1]]


def compare(a, b):
    ca = a[..., :3] + (1 - a[..., 3:4]) * PAPER
    cb = b[..., :3] + (1 - b[..., 3:4]) * PAPER
    d = np.sqrt(((lab(np.clip(ca, 0, 1)) - lab(np.clip(cb, 0, 1))) ** 2).sum(-1))
    m = (a[..., 3] > 0.002) | (b[..., 3] > 0.002)
    d = d[m]
    return dict(max=round(float(d.max()), 2), p999=round(float(np.percentile(d, 99.9)), 3),
                share_le1=round(float((d <= 1).mean()), 5))


def main():
    ent = sys.argv[1]
    frames = [int(f) for f in (sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('-') else '0,1').split(',')]
    translucent = '--translucent' in sys.argv
    d = os.path.join(ROOT, 'design', 'art', 'out', 'layers', ent)
    t = json.load(open(os.path.join(d, 'timing.json')))
    # R grown outward to multiples of 8 px (the alignment rule of 10 §9.2), so every level's box filter lines up
    r0 = t['rect']
    R = (r0[0] // 8 * 8, r0[1] // 8 * 8, -(-r0[2] // 8) * 8, -(-r0[3] // 8) * 8)
    rd = lambda p: post.read_png(os.path.join(d, p))
    base = {ps: rd(f'base.{ps}.png') for ps in ('colour', 'normal', 'aux')}
    seed = zlib.crc32(re.sub(r'-f\d+', '', f'{ent}-S-f00').encode()) % 1000
    ink = lambda c, n, a: post.survey_ink(c, n, a, 'survey', seed=seed, line_alpha=post.INK_WEIGHT.get(ent, 1.0))

    def full(k):
        p = {ps: base[ps].copy() for ps in base}
        x0, y0 = r0[0], r0[1]
        for ps in ('colour', 'normal', 'aux'):
            reg = rd(f'anim-f{k:02d}.{ps}.png')
            s = 2 if ps != 'colour' else 1
            p[ps][y0 * s:y0 * s + reg.shape[0], x0 * s:x0 * s + reg.shape[1]] = reg
        return ink(p['colour'], p['normal'], p['aux'])

    F = {k: full(k) for k in sorted(set(frames) | {0})}
    B_hidden = ink(base['colour'], base['normal'], base['aux'])       # v1's base: animated parts hidden
    if translucent:
        # a band of static pixels 24 px wide crossing R's top edge becomes 22% opaque in every frame and the base
        band = (slice(max(0, R[1] - 12), R[1] + 12), slice(R[0], R[2]))
        for img in list(F.values()) + [B_hidden]:
            sub = img[band]
            sub[..., 3] = np.where(sub[..., 3] > 0.5, 0.22, sub[..., 3])
    H, W = F[0].shape[:2]
    res = {}
    # the layered pipeline's full frames against A3's full per-frame renders, where those exist
    bd = os.path.join(ROOT, 'design', 'art', 'out', 'layers', 'baseline', 'survey', ent)
    for k in frames:
        stem = f'{ent}-S-f{k:02d}'
        if not translucent and os.path.exists(os.path.join(bd, f'{stem}.colour.png')):
            G3 = ink(post.read_png(os.path.join(bd, f'{stem}.colour.png')), post.read_png(os.path.join(bd, f'{stem}.normal.png')),
                     post.read_png(os.path.join(bd, f'{stem}.aux.png')))
            res[f'f{k} layered vs A3 full render'] = compare(premul(F[k]), premul(G3))
            print(ent, f'frame {k} layered full frame vs A3 full render', json.dumps(res[f'f{k} layered vs A3 full render']), flush=True)
    for k in frames:
        Fk = premul(F[k])
        F0 = premul(F[0])
        Bh = premul(B_hidden)
        for (s, ox, oy) in ((1.0, 0.0, 0.0), (0.5, 0.25, 0.75), (0.73, 0.37, 0.11), (1.37, 0.5, 0.2), (2.3, 0.13, 0.61), (0.3, 0.4, 0.4)):
            level = max(0, int(np.floor(np.log2(1 / s) + 1e-9))) if s < 1 else 0
            CW, CH = int(W * s) + 4, int(H * s) + 4
            ref = np.zeros((CH, CW, 4), np.float32)
            draw(ref, piece_texture(Fk, (0, 0, W, H), level), (0, 0, W, H), level, s, ox, oy)
            new = np.zeros_like(ref)
            for r in pieces_of(H, W, R):
                draw(new, piece_texture(F0, r, level), r, level, s, ox, oy)
            draw(new, piece_texture(Fk, R, level), R, level, s, ox, oy)
            old = np.zeros_like(ref)
            draw(old, piece_texture(Bh, (0, 0, W, H), level), (0, 0, W, H), level, s, ox, oy)
            draw(old, piece_texture(Fk, R, level), R, level, s, ox, oy)
            res[f'f{k} s{s}'] = dict(pieces=compare(new, ref), v1_patch_over_base=compare(old, ref))
            print(ent, f'frame {k} scale {s} level {level}', json.dumps(res[f'f{k} s{s}']), flush=True)
    tag = '-translucent' if translucent else ''
    json.dump(res, open(os.path.join(d, f'pieces_check{tag}.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
