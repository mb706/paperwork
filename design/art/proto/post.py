"""Post-processing of rendered sprite passes (numpy). Shared by the compositor and the asset tools.

    sprite = load_sprite(out_root, style, entity, stem)   # dict: rgba (straight, float32), shadow, ax, ay
    rgba = survey_ink(colour, normal2x, aux2x, style)       # ink lines, hatching, wash edges, paper grain
    small = downscale(rgba, 2)                              # premultiplied area filter (High -> Normal)

All images are float32 in [0, 1]; RGBA arrays are straight (non-premultiplied) unless a function
says otherwise. The survey ink pass is what turns a flat banded render into a pen-and-wash plate:
  * silhouette lines from alpha, crease lines from normals (> 32°), boundary lines where the
    material or object id changes; silhouettes are drawn heavier than inner lines;
  * hatching (45°) on faces whose N·L against the key is in the dark band;
  * watercolour edge darkening inside each wash region, and a faint pigment mottle;
  * a paper grain multiplied over everything.
"""

import json
import os
import re
import zlib

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
import sys  # noqa: E402
sys.path.insert(0, HERE)
from lib import style as S  # noqa: E402


# ------------------------------------------------------------------------------------------
# I/O
# ------------------------------------------------------------------------------------------

def read_png(path):
    im = Image.open(path)
    a = np.asarray(im)
    if a.dtype == np.uint16 or im.mode in ('I;16', 'I;16B', 'I'):
        a = a.astype(np.float32) / 65535.0
    else:
        a = a.astype(np.float32) / 255.0
    if a.ndim == 2:
        a = a[..., None]
    return a


def write_png(path, rgba):
    a = np.clip(rgba * 255.0 + 0.5, 0, 255).astype(np.uint8)
    if a.ndim == 3 and a.shape[2] == 1:
        a = a[..., 0]
    Image.fromarray(a).save(path)


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hexc(h):
    return np.array(S.hex_to_srgb(h), np.float32)


# ------------------------------------------------------------------------------------------
# Geometry helpers
# ------------------------------------------------------------------------------------------

def downscale(rgba, f):
    """Area filter by integer factor f with premultiplied alpha; pads to a multiple of f."""
    h, w = rgba.shape[:2]
    H, W = (h + f - 1) // f * f, (w + f - 1) // f * f
    c = rgba.shape[2]
    pad = np.zeros((H, W, c), np.float32)
    pad[:h, :w] = rgba
    if c == 4:
        pm = pad.copy()
        pm[..., :3] *= pm[..., 3:4]
        pm = pm.reshape(H // f, f, W // f, f, c).mean(axis=(1, 3))
        a = pm[..., 3:4]
        rgb = np.where(a > 1e-6, pm[..., :3] / np.maximum(a, 1e-6), 0)
        return np.concatenate([rgb, a], -1)
    return pad.reshape(H // f, f, W // f, f, c).mean(axis=(1, 3))


def resize(rgba, scale):
    """Arbitrary rescale (PIL, premultiplied, BOX for down, LANCZOS for up)."""
    h, w = rgba.shape[:2]
    nh, nw = max(1, int(round(h * scale))), max(1, int(round(w * scale)))
    out = []
    pm = rgba.copy()
    if rgba.shape[2] == 4:
        pm[..., :3] *= pm[..., 3:4]
    flt = Image.BOX if scale < 1 else Image.LANCZOS
    for ch in range(pm.shape[2]):
        im = Image.fromarray(pm[..., ch].astype(np.float32), mode='F')
        out.append(np.asarray(im.resize((nw, nh), flt), np.float32))
    o = np.stack(out, -1)
    if rgba.shape[2] == 4:
        a = np.clip(o[..., 3:4], 0, 1)
        o[..., :3] = np.where(a > 1e-6, o[..., :3] / np.maximum(a, 1e-6), 0)
        o[..., 3:4] = a
    return np.clip(o, 0, 1)


def trim_box(*alphas, pad=1):
    m = np.zeros_like(alphas[0], bool)
    for a in alphas:
        m |= a > 0.004
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return 0, 0, 1, 1
    y0, y1 = max(0, ys.min() - pad), min(m.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(m.shape[1], xs.max() + 1 + pad)
    return x0, y0, x1, y1


# ------------------------------------------------------------------------------------------
# Noise
# ------------------------------------------------------------------------------------------

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
    """Paper: low-frequency mottle plus fibres plus fine tooth. Returns a multiplier ~1."""
    rng = np.random.default_rng(seed)
    mottle = value_noise(h, w, 96, seed, 3) - 0.5
    tooth = ndi.gaussian_filter(rng.standard_normal((h, w)).astype(np.float32), 0.7)
    fib = ndi.gaussian_filter(rng.standard_normal((h, w)).astype(np.float32), (0.6, 5.0))
    fib2 = ndi.gaussian_filter(rng.standard_normal((h, w)).astype(np.float32), (4.0, 0.6))
    g = 1.0 + strength * (0.9 * mottle + 0.35 * tooth + 0.25 * fib + 0.2 * fib2)
    return g.astype(np.float32)


def hatch(h, w, period=5.0, width=1.5, angle=45.0, phase=0.0):
    """Anti-aliased hatch line coverage in [0, 1]."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.deg2rad(angle)
    d = (xx * np.sin(t) + yy * np.cos(t) + phase) % period
    dist = np.minimum(d, period - d)
    return np.clip(width / 2 + 0.5 - dist, 0, 1)


# ------------------------------------------------------------------------------------------
# Survey ink
# ------------------------------------------------------------------------------------------

def survey_ink(colour, normal2x, aux2x, style_name='survey', line_sil=6.0, line_in=3.2,
               crease_deg=32.0, hatch_period=6.5, hatch_width=1.8, seed=0, line_alpha=1.0, selout=0.0):
    """colour: (h, w, 4) at High; normal2x, aux2x: (2h, 2w, 4) 16-bit decoded floats."""
    st = S.STYLES[style_name]
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

    def nb_diff(fn):
        d = np.zeros((H2, W2), bool)
        for dy, dx in ((0, 1), (1, 0)):
            a = fn(slice(0, H2 - dy), slice(0, W2 - dx))
            b = fn(slice(dy, H2), slice(dx, W2))
            dd = a != b if a.dtype == bool else a
            d[:H2 - dy, :W2 - dx] |= dd
            d[dy:, dx:] |= dd
        return d

    sil = nb_diff(lambda ys, xs: solid[ys, xs])
    # material / object boundaries (both sides solid)
    idd = np.zeros((H2, W2), bool)
    crease = np.zeros((H2, W2), bool)
    cosT = np.cos(np.deg2rad(crease_deg))
    for dy, dx in ((0, 1), (1, 0), (1, 1)):
        sa = (slice(0, H2 - dy), slice(0, W2 - dx))
        sb = (slice(dy, H2), slice(dx, W2))
        both = solid[sa] & solid[sb]
        org2 = organic[sa] & organic[sb]
        dm = (np.abs(aux[sa][..., :2] - aux[sb][..., :2]) > 0.5 / 255).any(-1)      # material changes
        do = np.abs(aux[sa][..., 2] - aux[sb][..., 2]) > 0.5 / 255                  # object changes
        di = dm | (do & ~org2)
        dn = ((n[sa] * n[sb]).sum(-1) < cosT) & ~org2
        idd[sa] |= di & both
        crease[sa] |= dn & both
    # distance-based thickening (in 2x px)
    dist_sil = ndi.distance_transform_edt(~sil)
    dist_in = ndi.distance_transform_edt(~(idd | crease))
    # pen pressure: line weight varies slowly along the drawing (0.75x .. 1.2x)
    pen = 0.75 + 0.45 * value_noise(H2, W2, 40, seed + 21, 2)
    sil_cov = np.clip(line_sil * pen / 2 + 0.5 - dist_sil, 0, 1)
    in_cov = np.clip(line_in * pen / 2 + 0.5 - dist_in, 0, 1)
    # silhouette lines should sit on the object side and just outside it
    line2 = np.maximum(sil_cov, in_cov)
    # tone band from N·L
    L = np.array(S.KEY_DIR, np.float32)
    ndl = (n * L).sum(-1)
    b0, b1 = st['bands']
    dark2 = solid & (ndl < b1) & ~flatflag
    # downsample masks to High
    def ds(m):
        m = m.astype(np.float32)
        return m[:H2 // 2 * 2, :W2 // 2 * 2].reshape(H2 // 2, 2, W2 // 2, 2).mean(axis=(1, 3))[:h, :w]
    line = ds(line2) * line_alpha
    dark = ds(dark2)
    # silhouette line may extend outside the object: widen alpha
    out_alpha = np.clip(np.maximum(colour[..., 3], line), 0, 1)
    rgb = colour[..., :3].copy()
    # watercolour: edge darkening + mottle
    edge_dark = ndi.gaussian_filter((ds(((dist_in < 3.5) | (dist_sil < 3.5)).astype(np.float32))), 1.0)
    mottle = value_noise(h, w, 18, seed + 5, 3) - 0.5
    rgb *= (1.0 - 0.10 * edge_dark)[..., None]
    rgb *= (1.0 + 0.07 * mottle)[..., None]
    # hatching on dark faces
    hat = hatch(h, w, hatch_period, hatch_width, 45.0) * dark
    rgb = rgb * (1 - 0.55 * hat[..., None]) + ink * 0.55 * hat[..., None]
    # paper grain
    rgb *= paper_grain(h, w, seed + 11, 0.05)[..., None]
    # ink lines over everything; selout > 0 tints the ink toward the darkened local fill so an icon
    # keeps its hue at 16-32 px (the pixel-art 'sel-out' outline)
    if selout > 0:
        local = ndi.uniform_filter(colour[..., :3] * colour[..., 3:4], (9, 9, 1)) / np.maximum(
            ndi.uniform_filter(colour[..., 3:4], (9, 9, 1)), 1e-3)
        ink_px = ink * (1 - selout) + local * 0.42 * selout
    else:
        ink_px = ink
    rgb = rgb * (1 - line[..., None]) + ink_px * line[..., None]
    # where alpha came only from the line, the colour is pure ink
    only_line = (colour[..., 3] < 0.02)
    rgb[only_line] = ink if selout == 0 else (ink * (1 - selout) + ink_px[only_line] * selout) if np.ndim(
        ink_px) > 1 else ink
    return np.concatenate([np.clip(rgb, 0, 1), out_alpha[..., None]], -1)


# ------------------------------------------------------------------------------------------
# Sprite loading
# ------------------------------------------------------------------------------------------

_SPRITE_CACHE = {}

# ink weight encodes importance: machines 100 %, resource tiles 70 %, decoratives 45 %
INK_WEIGHT = {'decorative': 0.45, 'iron-ore': 0.7, 'copper-ore': 0.7, 'coal': 0.7, 'quartz': 0.7, 'archive': 0.75}


def load_sprite(root, style_name, entity, stem, trim=True):
    key = (root, style_name, entity, stem)
    if key in _SPRITE_CACHE:
        return _SPRITE_CACHE[key]
    d = os.path.join(root, style_name, entity)
    man = json.load(open(os.path.join(d, 'manifest.json')))[stem]
    colour = read_png(os.path.join(d, f'{stem}.colour.png'))
    shp = os.path.join(d, f'{stem}.shadow.png')
    shadow = read_png(shp)[..., 3] if os.path.exists(shp) else np.zeros(colour.shape[:2], np.float32)
    if S.STYLES[style_name]['render'] == 'flat':
        nrm = read_png(os.path.join(d, f'{stem}.normal.png'))
        aux = read_png(os.path.join(d, f'{stem}.aux.png'))
        # one seed per entity, direction and variant (never per frame: lines must not shimmer in
        # animation), and stable across processes (crc32, not Python's randomised hash)
        seed = zlib.crc32(re.sub(r'-f\d+', '', stem).encode()) % 1000
        colour = survey_ink(colour, nrm, aux, style_name, seed=seed,
                            line_alpha=INK_WEIGHT.get(entity, 1.0))
    ax, ay = man['ax'], man['ay']
    x0, y0, x1, y1 = 0, 0, colour.shape[1], colour.shape[0]
    if trim:
        x0, y0, x1, y1 = trim_box(colour[..., 3], shadow, pad=int(0.6 * man['px']) if os.path.exists(
            os.path.join(d, f'{stem}.light.png')) else 1)
        colour = colour[y0:y1, x0:x1]
        shadow = shadow[y0:y1, x0:x1]
        ax, ay = ax - x0, ay - y0
    lp = os.path.join(d, f'{stem}.light.png')
    glow = None
    if os.path.exists(lp):
        li = read_png(lp)
        lrgb = li[..., :3]
        # the glow layer (engine: the light layer): every emitter gets a falloff of its own size class,
        # so a small bulb and a furnace mouth both read: dilate ~0.12 tile, then blur ~0.22 tile
        dil = int(0.12 * man['px']) * 2 + 1
        sig = 0.22 * man['px']
        grown = np.stack([ndi.grey_dilation(lrgb[..., c], size=(dil, dil)) for c in range(3)], -1)
        glow = np.stack([ndi.gaussian_filter(grown[..., c], sig) for c in range(3)], -1) * 1.8
        glow = np.clip(glow, 0, 1)
        if trim:
            glow = glow[y0:y1, x0:x1] if glow.shape[:2] == (man['h'], man['w']) else None
    spr = dict(rgba=colour, shadow=shadow, ax=ax, ay=ay, px=man['px'], meta=man, glow=glow)
    _SPRITE_CACHE[key] = spr
    return spr
