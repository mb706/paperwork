"""Terrain material textures (10 §9.9, §6.5; A3 §3.1, §11), ported from A3's design/art/proto/terrain.py.

    gamedev-python game/scripts/assets/terrain.py --out .cache/assets/terrain.json [--tiles grass,dirt]

One seamless 512 x 512 texture per tile type of the current build (public/data/prototypes.json), covering 8 x 8
tiles at High and sampled in world space by the terrain shader. Everything here is periodic on the 512-px torus
(noise lattices tile, filters wrap), so tiles never seam. An image model's flat, unlit wash written to
game/assets/textures/survey/<tile>.png replaces the procedural one (A3 §6). Encoded as XUBC7 quality 90 with three
box-filtered levels: public/atlases/terrain-<tile>.<hash8>.ktx2. The boundaries between types (the noise-warped
blend, the crisp types' kerbs, the water-lining and the shoreline) are the shader's (§9.9); preview.py draws
them with this file's numpy reference so the look can be judged before the renderer exists.

Survey palette (A3 §3.1): buff paper #ece3cb with a +-3.5 % grain; grass a 60-100 % wash of #e2e6c6 with sparse
ticks #7d8a62 at 32 %; dirt a #e9dcc0 wash, stippled #8a7458; sand #efe2bf, a finer, denser stipple #a08b62; water
#c4dbe2, deep water #aecbd8; streets #e8e2d2; town blocks and concrete the urban tint #ecd2c8. Out of map (new)
is the cartographic convention for land outside the survey: the paper cross-hatched in ink, so it reads as no
land by day and grades like every other ink line at night.
"""

import argparse
import os
import sys

import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import assemble as A  # noqa: E402
import common as K  # noqa: E402

N = 512
TILE_PX = 64
LEVELS = 3
SEED = 7
ORDER = ['grass', 'dirt', 'dry-dirt', 'sand', 'water', 'deep-water', 'town-street', 'town-block', 'concrete',
         'red-desert', 'snow', 'ice', 'rock-ground', 'landfill', 'hazard-concrete', 'refined-concrete',
         'refined-hazard-concrete', 'out-of-map']


def pnoise(cells, seed, octaves=1, persistence=0.5, lacunarity=2):
    """Periodic value noise on the N x N torus, `cells` lattice cells across at octave 0."""
    rng = np.random.default_rng(seed)
    out = np.zeros((N, N), np.float32)
    amp, tot, c = 1.0, 0.0, cells
    for _ in range(octaves):
        g = rng.random((c, c)).astype(np.float32)
        out += amp * ndi.zoom(g, N / c, order=3, mode='grid-wrap', grid_mode=True)
        tot += amp
        amp *= persistence
        c = int(c * lacunarity)
        if c > N:
            break
    return out / tot


def wrap_gauss(a, sigma):
    return ndi.gaussian_filter(a, sigma, mode='wrap')


def speckle(seed, density, radius=1.0):
    rng = np.random.default_rng(seed)
    m = (rng.random((N, N)) < density).astype(np.float32)
    if radius > 0:
        m = wrap_gauss(m, radius) * (2 * np.pi * radius * radius)
    return np.clip(m, 0, 1)


def grain(seed, strength=0.035):
    """Periodic paper grain: low-frequency mottle, fine tooth and fibres in two directions."""
    rng = np.random.default_rng(seed)
    mottle = pnoise(5, seed, 3) - 0.5
    tooth = wrap_gauss(rng.standard_normal((N, N)).astype(np.float32), 0.7)
    fib = wrap_gauss(rng.standard_normal((N, N)).astype(np.float32), (0.6, 5.0))
    fib2 = wrap_gauss(rng.standard_normal((N, N)).astype(np.float32), (4.0, 0.6))
    return (1.0 + strength * (0.9 * mottle + 0.35 * tooth + 0.25 * fib + 0.2 * fib2)).astype(np.float32)


def lerp(a, b, t):
    t = np.asarray(t, np.float32)
    return a + (b - a) * (t if t.ndim == 0 else t[..., None])


def stipple(seed, density, sigma, gain):
    return np.clip(wrap_gauss(speckle(seed, density, 0.0), sigma) * gain, 0, 1)


def material(tile, seed):
    paper = K.hexc(K.PAPER_HEX)
    base = np.ones((N, N, 3), np.float32) * paper * grain(seed + 99)[..., None]
    tint = lambda hexs, t: lerp(base, base * K.hexc(hexs) / paper, t)  # noqa: E731
    if tile == 'grass':
        wash = tint('#e2e6c6', 0.6 + 0.4 * pnoise(3, seed + 1, 2))
        rng = np.random.default_rng(seed + 2)
        m = np.zeros((N, N), np.float32)
        for _ in range(int(N * N / 1400)):
            cx, cy = rng.integers(0, N, 2)
            for _k in range(3):
                x = (cx + rng.integers(-4, 5)) % N
                y0 = (cy + rng.integers(-2, 3)) % N
                for yy in range(int(rng.integers(3, 6))):
                    m[(y0 - yy) % N, x] = 1
        m = wrap_gauss(m, 0.45) * 2.2
        return lerp(wash, K.hexc('#7d8a62'), np.clip(m, 0, 1) * 0.32)
    if tile in ('dirt', 'landfill'):
        return lerp(tint('#e9dcc0', 0.8), K.hexc('#8a7458'), stipple(seed + 13, 0.006, 0.5, 3) * 0.6)
    if tile in ('dry-dirt', 'red-desert'):
        w = tint('#e6d2ad' if tile == 'dry-dirt' else '#e8c9b0', 0.85)
        return lerp(w, K.hexc('#8f6f4c'), stipple(seed + 15, 0.007, 0.5, 3) * 0.6)
    if tile == 'sand':
        return lerp(tint('#efe2bf', 0.9), K.hexc('#a08b62'), stipple(seed + 23, 0.02, 0.45, 2.5) * 0.45)
    if tile == 'water':
        return tint('#c4dbe2', 1.0)
    if tile == 'deep-water':
        return tint('#aecbd8', 1.0)
    if tile == 'town-street':
        return base * (K.hexc('#e8e2d2') / paper)
    if tile in ('town-block', 'concrete', 'refined-concrete', 'hazard-concrete', 'refined-hazard-concrete'):
        return tint('#ecd2c8', 0.9)
    if tile in ('snow', 'ice'):
        return tint('#eef1f2' if tile == 'snow' else '#d8e6ec', 1.0)
    if tile == 'rock-ground':
        return lerp(tint('#dcd6cb', 0.9), K.hexc('#6f6a62'), stipple(seed + 31, 0.004, 0.6, 3) * 0.5)
    if tile == 'out-of-map':
        yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
        period = N / 64.0                               # 8 lines per tile, both diagonals, on the torus
        hat = np.zeros((N, N), np.float32)
        for u in (xx + yy, xx - yy):
            d = np.mod(u, period)
            dist = np.minimum(d, period - d)
            hat = np.maximum(hat, np.clip(1.15 - dist, 0, 1))
        return lerp(base * 0.97, K.hexc(K.INK_HEX), hat * 0.62)
    return base


def materials(tiles, seed=SEED):
    out = {}
    for t in tiles:
        p = os.path.join(K.TEXTURE_SRC, 'survey', f'{t}.png')
        if os.path.exists(p):
            m = K.read_png(p)[..., :3]
        else:
            m = material(t, seed + (ORDER.index(t) if t in ORDER else 50) * 101)
        out[t] = np.clip(m, 0, 1).astype(np.float32)
    return out


def tiles_of_build():
    pj = os.path.join(K.PUBLIC, 'data', 'prototypes.json')
    data = K.load_json(pj)
    return [t['name'] for t in data['tile']]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--tiles', default=None)
    a = ap.parse_args()
    tiles = a.tiles.split(',') if a.tiles else tiles_of_build()
    mats = materials(tiles)
    os.makedirs(A.ATLASES, exist_ok=True)
    out = dict(pxPerTile=TILE_PX, size=N, levels=LEVELS, codec='xubc7', tiles={})
    keep = set()
    for t in sorted(mats):
        rgba = np.concatenate([mats[t], np.ones((N, N, 1), np.float32)], -1)
        lv = A.levels_of(rgba, LEVELS)
        data = A.encode(lv, 'xubc7', f'terrain-{t}')
        fn, nbytes, sha = A.publish(data, f'terrain-{t}', '')
        keep.add(os.path.basename(fn))
        src_dir = os.path.join(K.CACHE, 'terrain')
        os.makedirs(src_dir, exist_ok=True)
        K.write_png(os.path.join(src_dir, f'{t}.png'), mats[t])
        out['tiles'][t] = dict(file=fn, bytes=nbytes, sha256=sha, group='core')
        print(f'[terrain] {t}: {nbytes / 1e3:.0f} kB', flush=True)
    for f in os.listdir(A.ATLASES):
        if f.startswith('terrain-') and f not in keep:
            os.remove(os.path.join(A.ATLASES, f))
    K.dump_json(a.out, out)


if __name__ == '__main__':
    main()
