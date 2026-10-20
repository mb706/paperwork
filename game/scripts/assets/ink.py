"""The Survey ink pass (A3 §5; 10 §9.1 step 6, §9.2 step 1), ported from A3's design/art/proto/post.py.

    fields = ink_fields(h, w, seed)                       # once per (set, direction, variant): canvas-sized
    rgba = survey_ink(colour, normal2x, aux2x, fields, ox=x0, oy=y0, line_alpha=1.0)

The ink's position-dependent fields (pen pressure, pigment mottle, paper grain, hatching) are computed once per
set over the whole canvas, in the canvas's coordinates, and cropped at (ox, oy), the region's top-left corner in
High px. Its filters reach less than INK['margin'] = 16 px, so inking a region grown by that margin gives, inside
the region, exactly what inking the whole canvas gives (B2 verified it bit-exact: render/ink_locality_check.py).
The pen-pressure seed is a crc32 of the set, direction and variant, never of the frame or the state, so lines
neither shimmer in animation nor jump when a machine stops (A3 §5).

Lines come from the 2x passes: silhouettes from alpha, inner lines where the material or object id changes or the
normal creases by more than 32 degrees (organic materials only take silhouettes), hatching at 45 degrees where
N.L against the shading key falls in the dark band, then watercolour edge darkening, mottle and paper grain.
Arrays are float32 in [0, 1]; RGBA is straight (not premultiplied).
"""

import os
import sys
import zlib

import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'assets', 'blender'))
from lib import style as S  # noqa: E402


def hexc(h):
    return np.array(S.hex_to_srgb(h), np.float32)


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def ink_seed(set_name, d=0, variant=0):
    return zlib.crc32(f'{set_name}|{d}|{variant}'.encode()) % 1000


# ---------------------------------------------------------------------------------------------------------------
# Fields (A3's value noise, paper grain and hatching, unchanged)
# ---------------------------------------------------------------------------------------------------------------

def value_noise(h, w, cell, seed=0, octaves=4, persistence=0.5):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    c = float(cell)
    for _ in range(octaves):
        gh, gw = int(h / c) + 3, int(w / c) + 3
        g = rng.random((gh, gw)).astype(np.float32)
        z = ndi.zoom(g, c, order=3, mode='wrap')[:h, :w]
        if z.shape != (h, w):
            z = np.pad(z, ((0, h - z.shape[0]), (0, w - z.shape[1])), mode='edge')
        out += amp * z
        total += amp
        amp *= persistence
        c = max(1.0, c / 2)
    return out / total


def paper_grain(h, w, seed=3, strength=0.05):
    """Paper: low-frequency mottle plus fibres plus fine tooth; a multiplier near 1."""
    rng = np.random.default_rng(seed)
    mottle = value_noise(h, w, 96, seed, 3) - 0.5
    tooth = ndi.gaussian_filter(rng.standard_normal((h, w)).astype(np.float32), 0.7)
    fib = ndi.gaussian_filter(rng.standard_normal((h, w)).astype(np.float32), (0.6, 5.0))
    fib2 = ndi.gaussian_filter(rng.standard_normal((h, w)).astype(np.float32), (4.0, 0.6))
    g = 1.0 + strength * (0.9 * mottle + 0.35 * tooth + 0.25 * fib + 0.2 * fib2)
    return g.astype(np.float32)


def hatch(h, w, period=5.0, width=1.5, angle=45.0, phase=0.0, ox=0, oy=0):
    """Anti-aliased hatch-line coverage in [0, 1]; (ox, oy) offsets the grid so crops stay registered."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xx += ox
    yy += oy
    t = np.deg2rad(angle)
    d = (xx * np.sin(t) + yy * np.cos(t) + phase) % period
    dist = np.minimum(d, period - d)
    return np.clip(width / 2 + 0.5 - dist, 0, 1)


def ink_fields(h, w, seed, grain=S.INK['grain']):
    """The canvas-sized fields of one set: pen pressure at 2x, mottle, paper grain and hatching at High."""
    pen0, pen1 = S.INK['pen']
    return dict(
        h=h, w=w, seed=seed,
        pen=pen0 + pen1 * value_noise(2 * h, 2 * w, 40, seed + 21, 2),
        mottle=value_noise(h, w, 18, seed + 5, 3) - 0.5,
        grain=paper_grain(h, w, seed + 11, grain),
        hatch=hatch(h, w, S.INK['hatch_period'], S.INK['hatch_width'], 45.0),
    )


# ---------------------------------------------------------------------------------------------------------------
# The ink
# ---------------------------------------------------------------------------------------------------------------

def survey_ink(colour, normal2x, aux2x, fields, ox=0, oy=0, line_alpha=1.0, selout=0.0, line_sil=None,
               line_in=None, style_name='survey'):
    """colour: (h, w, 4) straight RGBA at High, the region at (ox, oy) of the canvas; normal2x, aux2x:
    (2h, 2w, 4) at 2x of the same region. Returns the inked straight RGBA (h, w, 4)."""
    st = S.STYLES[style_name]
    line_sil = S.INK['line_sil'] if line_sil is None else line_sil
    line_in = S.INK['line_in'] if line_in is None else line_in
    ink = hexc(st['ink'])
    h, w = colour.shape[:2]
    H2, W2 = normal2x.shape[:2]
    A2 = normal2x[..., 3]
    solid = A2 > 0.5
    flatflag = normal2x[..., :3].max(-1) < 0.02
    n = srgb_to_lin(normal2x[..., :3]) * 2.0 - 1.0
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    aux = aux2x[..., :3]
    organic = aux[..., 2] > 0.75

    sil = np.zeros((H2, W2), bool)
    for dy, dx in ((0, 1), (1, 0)):
        a = solid[0:H2 - dy, 0:W2 - dx]
        b = solid[dy:H2, dx:W2]
        dd = a != b
        sil[:H2 - dy, :W2 - dx] |= dd
        sil[dy:, dx:] |= dd
    idd = np.zeros((H2, W2), bool)
    crease = np.zeros((H2, W2), bool)
    cos_t = np.cos(np.deg2rad(S.INK['crease_deg']))
    for dy, dx in ((0, 1), (1, 0), (1, 1)):
        sa = (slice(0, H2 - dy), slice(0, W2 - dx))
        sb = (slice(dy, H2), slice(dx, W2))
        both = solid[sa] & solid[sb]
        org2 = organic[sa] & organic[sb]
        dm = (np.abs(aux[sa][..., :2] - aux[sb][..., :2]) > 0.5 / 255).any(-1)
        do = np.abs(aux[sa][..., 2] - aux[sb][..., 2]) > 0.5 / 255
        di = dm | (do & ~org2)
        dn = ((n[sa] * n[sb]).sum(-1) < cos_t) & ~org2
        idd[sa] |= di & both
        crease[sa] |= dn & both
    dist_sil = ndi.distance_transform_edt(~sil)
    dist_in = ndi.distance_transform_edt(~(idd | crease))
    pen = fields['pen'][2 * oy:2 * oy + H2, 2 * ox:2 * ox + W2]
    sil_cov = np.clip(line_sil * pen / 2 + 0.5 - dist_sil, 0, 1)
    in_cov = np.clip(line_in * pen / 2 + 0.5 - dist_in, 0, 1)
    line2 = np.maximum(sil_cov, in_cov)
    L = np.array(S.KEY_DIR, np.float32)
    ndl = (n * L).sum(-1)
    b0, b1 = st['bands']
    dark2 = solid & (ndl < b1) & ~flatflag

    def ds(m):
        m = m.astype(np.float32)
        return m[:H2 // 2 * 2, :W2 // 2 * 2].reshape(H2 // 2, 2, W2 // 2, 2).mean(axis=(1, 3))[:h, :w]

    line = ds(line2) * line_alpha
    dark = ds(dark2)
    out_alpha = np.clip(np.maximum(colour[..., 3], line), 0, 1)
    rgb = colour[..., :3].copy()
    edge_dark = ndi.gaussian_filter(ds(((dist_in < 3.5) | (dist_sil < 3.5)).astype(np.float32)), 1.0)
    mottle = fields['mottle'][oy:oy + h, ox:ox + w]
    rgb *= (1.0 - S.INK['edge_dark'] * edge_dark)[..., None]
    rgb *= (1.0 + S.INK['mottle'] * mottle)[..., None]
    hat = fields['hatch'][oy:oy + h, ox:ox + w] * dark
    k = S.INK['hatch_ink']
    rgb = rgb * (1 - k * hat[..., None]) + ink * k * hat[..., None]
    rgb *= fields['grain'][oy:oy + h, ox:ox + w][..., None]
    if selout > 0:
        # sel-out: the outline is tinted toward the darkened local fill, so an icon keeps its hue at 16 px (A3 §7)
        local = ndi.uniform_filter(colour[..., :3] * colour[..., 3:4], (9, 9, 1)) / np.maximum(
            ndi.uniform_filter(colour[..., 3:4], (9, 9, 1)), 1e-3)
        ink_px = ink * (1 - selout) + local * 0.42 * selout
    else:
        ink_px = ink
    rgb = rgb * (1 - line[..., None]) + ink_px * line[..., None]
    only_line = colour[..., 3] < 0.02
    if selout > 0:
        rgb[only_line] = ink * (1 - selout) + ink_px[only_line] * selout
    else:
        rgb[only_line] = ink
    return np.concatenate([np.clip(rgb, 0, 1), out_alpha[..., None]], -1).astype(np.float32)


def passes_bbox(normal2x, rho, align, W, H):
    """The region the lines can reach: the 2x passes' coverage, in High px, grown by rho and aligned."""
    cov = normal2x[..., 3] > 0
    ys, xs = np.nonzero(cov)
    if len(xs) == 0:
        return None
    x0 = max(0, (int(xs.min()) // 2 - rho) // align * align)
    y0 = max(0, (int(ys.min()) // 2 - rho) // align * align)
    x1 = min(W, -(-(int(xs.max()) // 2 + 1 + rho) // align) * align)
    y1 = min(H, -(-(int(ys.max()) // 2 + 1 + rho) // align) * align)
    return x0, y0, x1, y1


def ink_canvas(colour, normal2x, aux2x, fields, line_alpha=1.0, region=None, rho=S.INK['margin'], **kw):
    """Ink a whole canvas, computing only the passes' bounding box plus rho (or `region`): the result is the
    canvas-sized inked image, transparent outside the region."""
    H, W = colour.shape[:2]
    if region is None:
        region = passes_bbox(normal2x, rho, 8, W, H)
    out = np.zeros((H, W, 4), np.float32)
    if region is None:
        return out
    x0, y0, x1, y1 = region
    out[y0:y1, x0:x1] = survey_ink(colour[y0:y1, x0:x1], normal2x[2 * y0:2 * y1, 2 * x0:2 * x1],
                                   aux2x[2 * y0:2 * y1, 2 * x0:2 * x1], fields, ox=x0, oy=y0,
                                   line_alpha=line_alpha, **kw)
    return out
