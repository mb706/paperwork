"""The composite check of 10 §9.5 #2 on an atlas as the renderer samples it (codex B2-r1 finding 2, C6-r1 3 and 5).

    errs, worst = check(man, page_level, sets=None)

`page_level(array, layer, level)` returns that level of a page as float RGBA, premultiplied (the build passes its
uncompressed page levels, .cache/assets/pages/, the exact texels it encodes; the fixture passes its rgba8 KTX2
levels). For every entity set with animated layers, every populated combination of its `base` part (each
direction, mask or other axis value with art), test phases 0, 1/2 and the last frame, and each level 0-2 the array
has, at three scales with sub-pixel offsets:
  * new  = the base pieces plus every layer's frame at that phase, each a quad over its own frame rectangle,
           sampled bilinearly from its own cell at the level (premultiplied, source-over; a screen pixel belongs to
           the quad whose half-open rectangle holds its centre), exactly as 10 §15.7 places them;
  * ref  = the whole frame drawn as one quad: F0's cell with every layer's rectangle replaced by that layer's
           frame (level 0 from the same page texels), its levels box-filtered on the page's own grid.
dE76 on the paper must stay <= 0.5 on every pixel (§9.5 #2; B2 measured 0.00). This catches transparent or wrong
gutters around layer frames, base pieces that overlap a layer's rectangle (pixels drawn twice), rectangles off the
mip grid and layers missing from the composition. Level 3 is exempt (§9.1: one texel there spans R's whole band).
"""

import numpy as np

import common as K
import manifest as MF

DE_LIMIT = 0.5
PHASES = (0, 32768, 65535)
# per level: (k = device px per level-0 px, x offset, y offset) of the screen grid
SCALES = {
    0: ((1.0, 0.0, 0.0), (1.37, 0.5, 0.2), (2.3, 0.13, 0.61)),
    1: ((0.5, 0.25, 0.75), (0.73, 0.37, 0.11), (0.61, 0.9, 0.45)),
    2: ((0.25, 0.4, 0.4), (0.3, 0.1, 0.9), (0.37, 0.66, 0.05)),
}
PAPER = K.hexc(K.PAPER_HEX)


def lab_de(a, b):
    ca = a[..., :3] + (1 - a[..., 3:4]) * PAPER
    cb = b[..., :3] + (1 - b[..., 3:4]) * PAPER
    return np.sqrt(((K.lab(np.clip(ca, 0, 1)) - K.lab(np.clip(cb, 0, 1))) ** 2).sum(-1))


def draw(canvas, tex, tex_org, quad, level, k, ox, oy):
    """Source-over `tex` (a level-`level` image whose texel (0, 0) starts at level-0 position `tex_org`) onto the
    canvas for the sprite-space quad (x0, y0, x1, y1) (level-0 px from the anchor; the anchor at screen (ox, oy)),
    whose top-left maps to level-0 texture position quad_tex = (tx, ty): pass quad as ((x0, y0, x1, y1), (tx, ty)).
    Bilinear between texel centres; screen pixels whose centres lie in the half-open quad are drawn."""
    (x0, y0, x1, y1), (tx, ty) = quad
    H, W = canvas.shape[:2]
    i0, i1 = max(0, int(np.ceil(ox + x0 * k - 0.5))), min(W, int(np.ceil(ox + x1 * k - 0.5)))
    j0, j1 = max(0, int(np.ceil(oy + y0 * k - 0.5))), min(H, int(np.ceil(oy + y1 * k - 0.5)))
    if i1 <= i0 or j1 <= j0:
        return
    f = 2 ** level
    ii, jj = np.meshgrid(np.arange(i0, i1), np.arange(j0, j1))
    sx = (ii + 0.5 - ox) / k                     # sprite-space level-0 px
    sy = (jj + 0.5 - oy) / k
    u = (tx + (sx - x0) - tex_org[0]) / f - 0.5  # texel index of this level, centres at integers
    v = (ty + (sy - y0) - tex_org[1]) / f - 0.5
    th, tw = tex.shape[:2]
    if u.min() < -0.5 or v.min() < -0.5 or u.max() > tw - 0.5 or v.max() > th - 0.5:
        raise ValueError('composite: a quad samples outside its texture window')
    u = np.clip(u, 0, tw - 1.001)
    v = np.clip(v, 0, th - 1.001)
    a, b = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = (u - a)[..., None], (v - b)[..., None]
    a1, b1 = np.minimum(a + 1, tw - 1), np.minimum(b + 1, th - 1)
    c = (tex[b, a] * (1 - fu) * (1 - fv) + tex[b, a1] * fu * (1 - fv) + tex[b1, a] * (1 - fu) * fv
         + tex[b1, a1] * fu * fv)
    dst = canvas[j0:j1, i0:i1]
    dst[...] = c + dst * (1 - c[..., 3:4])


def _decode(shape, flat):
    idx = []
    for n in reversed(shape):
        idx.append(flat % n)
        flat //= n
    return tuple(reversed(idx))


def _layer_entry(base, layer, base_idx, frame):
    idx = []
    for ax, n in zip(layer['axes'], layer['shape']):
        if ax == 'frame':
            idx.append(frame % n)
        elif ax in base['axes']:
            idx.append(base_idx[base['axes'].index(ax)])
        else:
            raise ValueError(f'composite: layer axis {ax} not in base axes {base["axes"]}')
    return list(layer['table'][MF.flatten(layer['shape'], idx)])


def _sprite_rect(fr):
    """A frame's rectangle in sprite space (level-0 px from the anchor) and its level-0 page position."""
    a, layer, x, y, w, h, ax, ay = fr
    return (-ax, -ay, -ax + w, -ay + h), (x, y)


def _window(x0, y0, x1, y1, align, pad, size):
    """A texture window around (x0, y0, x1, y1) in level-0 page px: `pad` px wider on each side (clipped to the
    page) and aligned to `align`, so its levels are the page's levels."""
    wx0 = max(0, (int(np.floor(x0)) - pad) // align * align)
    wy0 = max(0, (int(np.floor(y0)) - pad) // align * align)
    wx1 = min(size, -(-(int(np.ceil(x1)) + pad) // align) * align)
    wy1 = min(size, -(-(int(np.ceil(y1)) + pad) // align) * align)
    return wx0, wy0, wx1, wy1


def check(man, page_level, sets=None):
    """(errors, results): the worst dE76 per set and combination; an error per combination over DE_LIMIT."""
    errs, res = [], {}
    for name in sorted(man['sets']):
        s = man['sets'][name]
        parts = s['parts']
        if sets is not None and name not in sets:
            continue
        if s['kind'] != 'entity' or not parts.get('layers') or 'base' not in parts:
            continue
        base = parts['base']
        layers = parts['layers']
        for flat, pieces in enumerate(base['table']):
            if not pieces:
                continue
            bidx = _decode(base['shape'], flat)
            frames0 = [man['frames'][f] for f in pieces]
            arr_i, page_layer = frames0[0][0], frames0[0][1]
            arr = man['arrays'][arr_i]
            levels = min(3, arr['levels'])
            align = 2 ** (arr['levels'] - 1)
            # F0's offset from sprite space to its page position (all pieces share F0's cell)
            r, (px, py) = _sprite_rect(frames0[0])
            off = (px - r[0], py - r[1])
            for fr in frames0:
                rr, (qx, qy) = _sprite_rect(fr)
                if (qx - rr[0], qy - rr[1]) != off or fr[1] != page_layer or fr[0] != arr_i:
                    raise ValueError(f'composite: {name} base pieces of combination {bidx} are not one cell')
            worst = 0.0
            for phase in PHASES:
                lframes = []
                for L in layers:
                    n = L['shape'][L['axes'].index('frame')]
                    lframes.append(_layer_entry(base, L, bidx, int(np.floor(phase * n / 65536))))
                if any(not e for e in lframes):
                    errs.append(f'composite: {name} combination {bidx}: a layer has no frame at phase {phase}')
                    continue
                lfr = [man['frames'][e[0]] for e in lframes]
                # the whole-frame reference in F0's page coordinates
                xs = [_sprite_rect(f)[0] for f in frames0 + lfr]
                bx0, by0 = min(q[0] for q in xs), min(q[1] for q in xs)
                bx1, by1 = max(q[2] for q in xs), max(q[3] for q in xs)
                win = _window(bx0 + off[0], by0 + off[1], bx1 + off[0], by1 + off[1], align * 4, align * 2,
                              arr['pageSize'])
                p0 = page_level(arr_i, page_layer, 0)
                whole = p0[win[1]:win[3], win[0]:win[2]].copy()
                for f in lfr:
                    (lx0, ly0, lx1, ly1), (lpx, lpy) = _sprite_rect(f)
                    src = page_level(f[0], f[1], 0)[lpy:lpy + f[5], lpx:lpx + f[4]]
                    dx, dy = int(lx0 + off[0] - win[0]), int(ly0 + off[1] - win[1])
                    whole[dy:dy + f[5], dx:dx + f[4]] = src
                # levels as the build makes them: each the box filter of the previous level's 8-bit values
                ref_levels = [whole]
                for _ in range(levels - 1):
                    ref_levels.append(K.to8(K.box_down(ref_levels[-1], 2)).astype(np.float32) / 255.0)
                for lv in range(levels):
                    pg = page_level(arr_i, page_layer, lv)
                    for k, ox, oy in SCALES[lv]:
                        cw = int(np.ceil((bx1 - bx0) * k)) + 8
                        ch = int(np.ceil((by1 - by0) * k)) + 8
                        sox, soy = -bx0 * k + 4 + ox, -by0 * k + 4 + oy
                        ref = np.zeros((ch, cw, 4), np.float32)
                        draw(ref, ref_levels[lv], (win[0], win[1]),
                             ((bx0, by0, bx1, by1), (bx0 + off[0], by0 + off[1])), lv, k, sox, soy)
                        new = np.zeros_like(ref)
                        for fr in frames0:
                            rr, (qx, qy) = _sprite_rect(fr)
                            draw(new, pg, (0, 0), (rr, (qx, qy)), lv, k, sox, soy)
                        for fr in lfr:
                            rr, (qx, qy) = _sprite_rect(fr)
                            draw(new, page_level(fr[0], fr[1], lv), (0, 0), (rr, (qx, qy)), lv, k, sox, soy)
                        m = (new[..., 3] > 0.002) | (ref[..., 3] > 0.002)
                        if m.any():
                            worst = max(worst, float(lab_de(new, ref)[m].max()))
            key = f'{name} {dict(zip(base["axes"], bidx))}'
            res[key] = round(worst, 3)
            if worst > DE_LIMIT:
                errs.append(f'composite: {key}: the pieces plus layers differ from the whole frame by dE '
                            f'{worst:.2f} > {DE_LIMIT}')
    return errs, res
