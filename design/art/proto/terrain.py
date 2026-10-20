"""Terrain: per-tile-type material textures and the tile-map renderer (numpy).

This is the asset side of 10 §6.5. Each tile type has a seamless material texture of 512x512 px
covering 8x8 tiles at High (64 px/tile); the renderer samples it in world space, so neighbouring
tiles of one type are continuous. Boundaries between types are organic: the tile id is looked up
at a noise-warped position (the shader's noise mask). Water gets a depth gradient and, per style,
a shore treatment (foam band, or engraved water-lining on the survey plate).

    mats = materials('kodachrome', px=64)               # dict tile -> (512, 512, 3) float32
    rgb = render(tilemap, 'kodachrome', px=32, mats=mats, origin=(x0, y0))

A later image model can replace any material by writing a 512x512 seamless PNG to
design/art/textures/<style>/<tile>.png; materials() loads it instead of the procedural one.
"""

import os
import numpy as np
from scipy import ndimage as ndi

import post
from lib import style as S

HERE = os.path.dirname(os.path.abspath(__file__))
TEX_DIR = os.path.join(HERE, '..', 'textures')

TILES = ['grass', 'dirt', 'dry-dirt', 'sand', 'water', 'deep-water', 'town-street', 'town-block', 'concrete',
         'red-desert', 'snow', 'ice', 'rock-ground', 'landfill', 'hazard-concrete', 'refined-concrete',
         'refined-hazard-concrete', 'out-of-map']
TID = {t: i for i, t in enumerate(TILES)}


# ----------------------------------------------------------------------------------------------
# Periodic noise (seamless by construction)
# ----------------------------------------------------------------------------------------------

def pnoise(size, cells, seed, octaves=1, persistence=0.5, lacunarity=2):
    """Periodic value noise on a size x size torus; `cells` lattice cells across at octave 0."""
    rng = np.random.default_rng(seed)
    out = np.zeros((size, size), np.float32)
    amp, tot = 1.0, 0.0
    c = cells
    for _ in range(octaves):
        g = rng.random((c, c)).astype(np.float32)
        # bicubic-ish upsample on a torus via ndi.zoom with wrap
        z = ndi.zoom(g, size / c, order=3, mode='grid-wrap', grid_mode=True)
        out += amp * z
        tot += amp
        amp *= persistence
        c = int(c * lacunarity)
        if c > size:
            break
    return out / tot


def streaks(size, seed, sigma=(0.6, 3.0)):
    rng = np.random.default_rng(seed)
    n = rng.standard_normal((size, size)).astype(np.float32)
    return ndi.gaussian_filter(n, sigma, mode='wrap')


def speckle(size, seed, density, radius=1.0):
    rng = np.random.default_rng(seed)
    m = (rng.random((size, size)) < density).astype(np.float32)
    if radius > 0:
        m = ndi.gaussian_filter(m, radius, mode='wrap') * (2 * np.pi * radius * radius)
    return np.clip(m, 0, 1)


def lerp(a, b, t):
    t = np.asarray(t, np.float32)
    return a + (b - a) * (t if t.ndim == 0 else t[..., None])


def col(h):
    return np.array(S.hex_to_srgb(h), np.float32)


# ----------------------------------------------------------------------------------------------
# Material textures per style (512 x 512 = 8 x 8 tiles at 64 px/tile)
# ----------------------------------------------------------------------------------------------

def _kodachrome(tile, n=512, seed=0):
    s = seed
    if tile in ('grass',):
        # photographic grass: olive base, clumps, blade streaks in two directions, dry and lush patches,
        # bare soil showing through in specks
        big = pnoise(n, 4, s + 1, 3)
        mid = pnoise(n, 16, s + 2, 3)
        clump = pnoise(n, 48, s + 6, 2)
        fine = streaks(n, s + 3, (0.45, 1.4))
        fine2 = streaks(n, s + 4, (1.2, 0.45))
        c = lerp(col('#4a5b2c'), col('#66773a'), np.clip(big * 1.4 - 0.2, 0, 1))
        c = lerp(c, col('#7f7c45'), np.clip((mid - 0.60) * 3.0, 0, 1) * 0.6)       # dry patches
        c = lerp(c, col('#3a4a24'), np.clip((0.40 - mid) * 3.0, 0, 1) * 0.5)       # lush clumps
        c *= (1 + 0.16 * (clump - 0.5))[..., None]
        c *= (1 + 0.13 * fine + 0.08 * fine2)[..., None]
        c = lerp(c, col('#6b5a3c'), speckle(n, s + 7, 0.004, 0.7) * 0.55)          # soil specks
        c = lerp(c, col('#a49a5c'), speckle(n, s + 5, 0.0015, 0.6) * 0.55)         # seed heads
        return c
    if tile in ('dirt', 'landfill'):
        big = pnoise(n, 6, s + 11, 3)
        mid = pnoise(n, 24, s + 15, 2)
        fine = streaks(n, s + 12, (0.6, 0.6))
        c = lerp(col('#5f4e36'), col('#7d6a4b'), big)
        c *= (1 + 0.14 * (mid - 0.5) + 0.12 * fine)[..., None]
        peb = speckle(n, s + 13, 0.006, 0.9)
        c = lerp(c, col('#9a8c74'), peb * 0.7)
        c = lerp(c, col('#3f3426'), speckle(n, s + 14, 0.004, 1.1) * 0.6)
        # tufts of grass at the margins of the soil
        c = lerp(c, col('#55642f'), np.clip((pnoise(n, 10, s + 16, 2) - 0.62) * 4, 0, 1) * 0.7)
        return c
    if tile in ('dry-dirt', 'red-desert'):
        big = pnoise(n, 6, s + 21, 3)
        c = lerp(col('#8a6c45'), col('#a3845a'), big)
        c *= (1 + 0.08 * streaks(n, s + 22, (0.7, 0.7)))[..., None]
        return c
    if tile in ('sand',):
        big = pnoise(n, 5, s + 31, 3)
        rip = np.sin(np.linspace(0, 2 * np.pi * 24, n, endpoint=False)[None, :] +
                     pnoise(n, 6, s + 32, 2) * 6) * 0.5 + 0.5
        c = lerp(col('#b39b6c'), col('#cdb88a'), big)
        c *= (1 + 0.05 * (rip - 0.5) + 0.06 * streaks(n, s + 33, (0.6, 0.6)))[..., None]
        return c
    if tile in ('water',):
        big = pnoise(n, 4, s + 41, 3)
        rip = streaks(n, s + 42, (0.8, 6.0))
        c = lerp(col('#2f5a66'), col('#3b6a72'), big)
        c *= (1 + 0.10 * rip)[..., None]
        return c
    if tile in ('deep-water',):
        big = pnoise(n, 4, s + 51, 3)
        rip = streaks(n, s + 52, (0.8, 6.0))
        c = lerp(col('#1f3f4e'), col('#284b58'), big)
        c *= (1 + 0.08 * rip)[..., None]
        return c
    if tile in ('town-street',):
        c = np.ones((n, n, 3), np.float32) * col('#5b5852')
        c *= (1 + 0.10 * streaks(n, s + 61, (0.6, 0.6)) + 0.08 * (pnoise(n, 8, s + 62, 3) - 0.5))[..., None]
        return c
    if tile in ('town-block', 'concrete', 'refined-concrete'):
        c = np.ones((n, n, 3), np.float32) * col('#7d786e')
        c *= (1 + 0.06 * streaks(n, s + 71, (0.6, 0.6)) + 0.08 * (pnoise(n, 8, s + 72, 3) - 0.5))[..., None]
        return c
    return np.ones((n, n, 3), np.float32) * col('#777777')


def _model(tile, n=512, seed=0):
    s = seed
    if tile == 'grass':
        big = pnoise(n, 3, s + 1, 2)
        c = lerp(col('#7aa652'), col('#8bb35e'), big)
        c *= (1 + 0.05 * streaks(n, s + 3, (0.6, 0.6)))[..., None]
        c = lerp(c, col('#9cc06c'), speckle(n, s + 4, 0.02, 0.5) * 0.5)
        c = lerp(c, col('#5f8a42'), speckle(n, s + 5, 0.02, 0.5) * 0.5)
        return c
    if tile in ('dirt', 'landfill'):
        big = pnoise(n, 4, s + 11, 2)
        c = lerp(col('#a8865c'), col('#b8966a'), big)
        c = lerp(c, col('#cdb48e'), speckle(n, s + 13, 0.01, 0.6) * 0.6)
        return c
    if tile == 'sand':
        big = pnoise(n, 4, s + 31, 2)
        c = lerp(col('#d9c494'), col('#e4d2a6'), big)
        c *= (1 + 0.03 * streaks(n, s + 33, (0.6, 0.6)))[..., None]
        return c
    if tile == 'water':
        big = pnoise(n, 3, s + 41, 2)
        return lerp(col('#4f97b8'), col('#5aa3c2'), big)
    if tile == 'deep-water':
        big = pnoise(n, 3, s + 51, 2)
        return lerp(col('#3a78a2'), col('#4282aa'), big)
    if tile == 'town-street':
        return np.ones((n, n, 3), np.float32) * col('#8c8a88') * (1 + 0.03 * streaks(n, s + 61, (0.6, 0.6)))[..., None]
    if tile in ('town-block', 'concrete'):
        return np.ones((n, n, 3), np.float32) * col('#c2bcae') * (1 + 0.03 * streaks(n, s + 71, (0.6, 0.6)))[..., None]
    return _kodachrome(tile, n, seed)


def _survey(tile, n=512, seed=0):
    s = seed
    paper = col(S.STYLES['survey']['paper'])
    grain = post.paper_grain(n, n, s + 99, 0.035)
    base = np.ones((n, n, 3), np.float32) * paper * grain[..., None]
    ink = col('#5a5148')
    if tile == 'grass':
        wash = lerp(base, base * col('#e2e6c6') / paper, 0.6 + 0.4 * pnoise(n, 3, s + 1, 2))
        # sparse grass ticks: short vertical strokes in small clusters
        rng = np.random.default_rng(s + 2)
        m = np.zeros((n, n), np.float32)
        for _ in range(int(n * n / 1400)):
            cx, cy = rng.integers(0, n, 2)
            for k in range(3):
                x = (cx + rng.integers(-4, 5)) % n
                y0 = (cy + rng.integers(-2, 3)) % n
                h = rng.integers(3, 6)
                for yy in range(h):
                    m[(y0 - yy) % n, x] = 1
        m = ndi.gaussian_filter(m, 0.45, mode='wrap') * 2.2
        return lerp(wash, col('#7d8a62'), np.clip(m, 0, 1) * 0.32)
    if tile in ('dirt', 'landfill', 'dry-dirt', 'red-desert'):
        wash = lerp(base, base * col('#e9dcc0') / paper, 0.8)
        st = speckle(n, s + 13, 0.006, 0.0)
        st = ndi.gaussian_filter(st, 0.5, mode='wrap') * 3
        return lerp(wash, col('#8a7458'), np.clip(st, 0, 1) * 0.6)
    if tile == 'sand':
        wash = lerp(base, base * col('#efe2bf') / paper, 0.9)
        st = ndi.gaussian_filter(speckle(n, s + 23, 0.02, 0.0), 0.45, mode='wrap') * 2.5
        return lerp(wash, col('#a08b62'), np.clip(st, 0, 1) * 0.45)
    if tile == 'water':
        return lerp(base, base * col('#c4dbe2') / paper, 1.0)
    if tile == 'deep-water':
        return lerp(base, base * col('#aecbd8') / paper, 1.0)
    if tile == 'town-street':
        return base * (col('#e8e2d2') / paper)
    if tile in ('town-block', 'concrete'):
        return lerp(base, base * col('#ecd2c8') / paper, 0.9)     # USGS urban tint
    return base


STYLE_MAT = {'kodachrome': _kodachrome, 'model': _model, 'survey': _survey}


def materials(style_name, px=64, seed=7, tiles=None):
    tiles = tiles or ['grass', 'dirt', 'sand', 'water', 'deep-water', 'town-street', 'town-block']
    out = {}
    for t in tiles:
        p = os.path.join(TEX_DIR, style_name, f'{t}.png')
        if os.path.exists(p):
            m = post.read_png(p)[..., :3]
        else:
            m = STYLE_MAT[style_name](t, 512, seed + TID.get(t, 0) * 101)
        m = np.clip(m, 0, 1).astype(np.float32)
        if px != 64:
            m = post.resize(m, px / 64.0)
        out[t] = m
    return out


def export_materials(style_name, outdir, seed=7):
    os.makedirs(outdir, exist_ok=True)
    for t, m in materials(style_name, 64, seed).items():
        post.write_png(os.path.join(outdir, f'{t}.png'), m)


# ----------------------------------------------------------------------------------------------
# Rendering a tile map
# ----------------------------------------------------------------------------------------------

def _warp_field(h, w, px, seed, amp_tiles=0.32, cell_tiles=1.6):
    """World-space warp offsets (in tiles) for organic boundaries."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rng = np.random.default_rng(seed)
    gx = rng.random((int(h / (px * cell_tiles)) + 4, int(w / (px * cell_tiles)) + 4)).astype(np.float32) - 0.5
    gy = rng.random(gx.shape).astype(np.float32) - 0.5
    zx = ndi.zoom(gx, px * cell_tiles, order=3)[:h, :w]
    zy = ndi.zoom(gy, px * cell_tiles, order=3)[:h, :w]
    gx2 = rng.random((int(h / (px * 0.5)) + 4, int(w / (px * 0.5)) + 4)).astype(np.float32) - 0.5
    gy2 = rng.random(gx2.shape).astype(np.float32) - 0.5
    zx += 0.4 * ndi.zoom(gx2, px * 0.5, order=1)[:h, :w]
    zy += 0.4 * ndi.zoom(gy2, px * 0.5, order=1)[:h, :w]
    return zx * 2 * amp_tiles, zy * 2 * amp_tiles


def render(tilemap, style_name, px, mats, origin=(0, 0), seed=3, crisp=('town-street', 'town-block', 'concrete')):
    """tilemap: (H, W) int array of TID over the view (tile rows y, columns x), origin = world tile of [0, 0].
    Returns ((H*px, W*px, 3) float32 sRGB, per-pixel tile ids).

    Boundaries: each soft tile type gets a field = its tile mask blurred at 0.55 tile and upsampled
    bilinearly, plus a world-anchored noise; each pixel takes the type with the largest field. That
    is the shader's noise-mask blend (10 §6.5): organic sub-tile shores, no staircase. Crisp types
    (town tiles, concrete) keep exact tile edges."""
    th, tw = tilemap.shape
    h, w = th * px, tw * px
    crisp_ids = [TID[c] for c in crisp]
    present = [int(t) for t in np.unique(tilemap)]
    # world-anchored boundary noise: two octaves, ~0.25 tile amplitude
    def wnoise(cell_tiles, amp, sd):
        g = np.random.default_rng(sd).random((int(th / cell_tiles) + 4, int(tw / cell_tiles) + 4)).astype(np.float32)
        z = ndi.zoom(g, px * cell_tiles, order=3)
        return (z[:h, :w] - 0.5) * amp
    nz = wnoise(1.2, 0.55, seed + 1) + wnoise(0.4, 0.25, seed + 2)
    best = np.full((h, w), -1e9, np.float32)
    ids = np.zeros((h, w), np.int32)
    for t in present:
        m = (tilemap == t).astype(np.float32)
        if t in crisp_ids:
            f = np.repeat(np.repeat(m, px, 0), px, 1) * 10.0           # crisp: exact tiles, always wins
        else:
            mb = ndi.gaussian_filter(m, 0.55, mode='nearest')
            f = ndi.zoom(mb, px, order=1, mode='nearest', grid_mode=True)[:h, :w]
            # each type gets its own noise phase so the boundary wanders
            f = f + nz * (0.6 if t in (TID['water'], TID['deep-water']) else 1.0) * (1 if t % 2 else -1)
        upd = f > best
        best[upd] = f[upd]
        ids[upd] = t
    out = np.zeros((h, w, 3), np.float32)
    ref = mats['grass'].shape[0]
    Y, X = np.mgrid[0:h, 0:w]
    mx = (X + origin[0] * px) % ref
    my = (Y + origin[1] * px) % ref
    for t, m in mats.items():
        sel = ids == TID[t]
        if sel.any():
            out[sel] = m[my[sel] % m.shape[0], mx[sel] % m.shape[1]]
    water = (ids == TID['water']) | (ids == TID['deep-water'])
    out = _water(out, water, ids, style_name, px, seed)
    if style_name == 'survey':
        # ink kerb lines where town blocks meet streets (crisp tile edges)
        blk = ids == TID['town-block']
        edge = blk & ~ndi.binary_erosion(blk, iterations=max(1, px // 32))
        out[edge] = out[edge] * 0.25 + col('#3b332b') * 0.75
    # soften soft boundaries by a pixel
    is_crisp = np.isin(ids, crisp_ids)
    soft = ndi.uniform_filter(out, (3, 3, 1))
    edge = (ndi.maximum_filter(ids, 3) != ndi.minimum_filter(ids, 3)) & ~is_crisp
    out[edge] = soft[edge]
    return out, ids


def _water(out, water, ids, style_name, px, seed):
    if not water.any():
        return out
    d_in = ndi.distance_transform_edt(water) / px          # tiles from shore, inside water
    d_out = ndi.distance_transform_edt(~water) / px        # tiles from water, on land
    if style_name == 'survey':
        ink = col('#56809a')
        t = np.clip(d_in / 3.0, 0, 1)
        out[water] = out[water] * (1 - 0.15 * t[water][..., None])
        # water-lining: lines parallel to the shore, spacing growing with distance
        lines = np.zeros_like(d_in)
        pos = [0.12, 0.30, 0.52, 0.80, 1.15, 1.60, 2.2, 3.0]
        lw = 0.9 / px * 1.2
        for p in pos:
            lines = np.maximum(lines, np.clip(1 - np.abs(d_in - p) / lw, 0, 1) * (1 - p / 4.0))
        lines *= water
        out = out * (1 - 0.75 * lines[..., None]) + ink * 0.75 * lines[..., None]
        # shoreline in ink
        shore = np.clip(1.6 - np.abs(d_out * px - 0.5), 0, 1) * (~water)
        out = out * (1 - 0.85 * shore[..., None]) + col('#3f5f74') * 0.85 * shore[..., None]
        return out
    # depth gradient
    t = np.clip(d_in / 4.0, 0, 1)
    if style_name == 'model':
        shallow, deep = col('#7fc0d6'), col('#3d7aa5')
        mixw = np.clip(1 - d_in / 1.2, 0, 1)
        out[water] = lerp(out[water], shallow[None, :] * np.ones_like(out[water]), mixw[water] * 0.7)
        foam = np.clip(1 - np.abs(d_in * px - 1.5) / 1.8, 0, 1) * water
        out = lerp(out, np.ones_like(out) * col('#e9f4f4'), foam * 0.85)
        # glossy highlight band
        return out
    # kodachrome: wet sand band on land, shallow tint, foam line
    shallow = col('#4a7c78')
    mixw = np.clip(1 - d_in / 1.5, 0, 1) * water
    out = lerp(out, np.ones_like(out) * shallow, mixw * 0.6)
    wet = np.clip(1 - d_out / 0.45, 0, 1) * (~water)
    out = out * (1 - 0.35 * wet[..., None])
    rng = np.random.default_rng(seed + 5)
    fn = ndi.gaussian_filter(rng.standard_normal(water.shape).astype(np.float32), 2.0)
    foam = np.clip(1 - np.abs(d_in * px - 1.2 - fn * 1.5) / 1.4, 0, 1) * water
    out = lerp(out, np.ones_like(out) * col('#cfd8d0'), foam * 0.55)
    return out
