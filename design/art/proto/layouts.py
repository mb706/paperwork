"""Mock layouts: an hour-one Memo-tier Site next to the starting college town (01 §9).

slice_scene() returns one Layout covering the wide (0.3x) view; the 1x view is its centre.

The chain, east to west:
  library archive (records) -> 2 electric drills -> records belt (+ coal lane from a chest)
  -> 4 Keypunches -> tokens on the south lane of the bus
  iron ore patch -> 5 drills (+ 1 on coal) -> ore/coal belt -> 4 stone furnaces -> plates on the north lane
  bus -> gear assembler + Memo assembler (direct insertion) -> Memo belt -> 8 Seminars (chained)
  lake -> offshore pump -> boiler -> 2 steam engines -> small poles everywhere
"""

import math
import numpy as np

import terrain as T
from scene import Layout

VIEW_1X = (7.0, 0.0, 60.0, 33.75)
VIEW_03 = (37.0 - 100.0, 16.875 - 56.25, 200.0, 112.5)


def _noise2(seed, cell):
    rng = np.random.default_rng(seed)
    g = rng.random((64, 64))

    def f(x, y):
        u, v = x / cell + 20, y / cell + 20
        i, j = np.floor(u).astype(int) % 63, np.floor(v).astype(int) % 63
        fu, fv = u - np.floor(u), v - np.floor(v)
        fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
        a, b = g[j, i], g[j, i + 1]
        c, d = g[j + 1, i], g[j + 1, i + 1]
        return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv
    return f


def blob_tiles(cx, cy, r, seed, n_target=None):
    nz = _noise2(seed, 4.0)
    out = []
    R = int(r * 1.5) + 2
    for y in range(int(cy) - R, int(cy) + R + 1):
        for x in range(int(cx) - R, int(cx) + R + 1):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d < r * (0.75 + 0.5 * nz(np.array(x + 0.5), np.array(y + 0.5))):
                out.append((x, y))
    return out


def slice_scene(wide=True):
    L = Layout(-74, -44, 208, 122)
    rng = np.random.default_rng(42)
    lake_n = _noise2(7, 6.0)
    dirt_n = _noise2(8, 9.0)
    forest_n = _noise2(9, 11.0)

    # ---------------- terrain ----------------
    def lake(X, Y):
        r1 = np.hypot(X - 8, Y - 34.5) < 8.6 + 2.2 * (lake_n(X, Y) - 0.5)
        r2 = np.hypot(X + 14, Y - 46) < 24 + 6 * (lake_n(X, Y) - 0.5)
        r3 = np.hypot(X + 40, Y - 24) < 13 + 4 * (lake_n(X, Y) - 0.5)
        return r1 | r2 | r3
    L.fill(lambda X, Y: dirt_n(X, Y) > 0.80, 'dirt')
    L.fill(lake, 'water')
    # deep water: far from shore
    from scipy import ndimage as ndi
    wmask = L.tiles == T.TID['water']
    d = ndi.distance_transform_edt(wmask)
    L.tiles[(d > 4.5)] = T.TID['deep-water']
    land_d = ndi.distance_transform_edt(~wmask)
    sand = (land_d > 0) & (land_d <= 1.8) & (dirt_n(np.arange(L.w)[None, :] + L.x0 + 0.5,
                                                     np.arange(L.h)[:, None] + L.y0 + 0.5) > 0.45)
    L.tiles[sand] = T.TID['sand']
    # the pump's shore: land at (6, 25), water at (6, 26)
    for (x, y, t) in [(9, 25, 'grass'), (9, 26, 'water'), (8, 25, 'grass'), (10, 25, 'grass'), (9, 24, 'grass'),
                      (8, 26, 'water'), (10, 26, 'water')]:
        L.tile(x, y, t)

    # ---------------- town (starting college, 24x24) ----------------
    xf, yf = 50, -6
    for y in range(yf, yf + 24):
        for x in range(xf, xf + 24):
            street = ((x - xf) % 8 < 2) or ((y - yf) % 8 < 2)
            L.tile(x, y, 'town-street' if street else 'town-block')
    L.claim(xf, yf, 24, 24)
    # campus: middle cell of the edge facing spawn (west)
    for y in range(yf + 8, yf + 16):
        for x in range(xf, xf + 8):
            L.tile(x, y, 'town-block')
    L.add('campus', xf, yf + 8, 8, 8, 'campus-S-f00', claim=False)
    variants = {(0, 0): 0, (1, 0): 4, (2, 0): 1, (1, 1): 1, (2, 1): 0, (0, 2): 3, (1, 2): 2, (2, 2): 1}
    for (i, j), v in variants.items():
        L.add('town-block', xf + 8 * i + 2, yf + 8 * j + 2, 6, 6, f'town-block-{v}-S-f00', claim=False)

    # ---------------- resources ----------------
    def resource(kind, tiles, var_n=6):
        for (x, y) in tiles:
            if not (L.x0 <= x < L.x0 + L.w and L.y0 <= y < L.y0 + L.h):
                continue
            t = L.tiles[y - L.y0, x - L.x0]
            if t in (T.TID['water'], T.TID['deep-water'], T.TID['town-street'], T.TID['town-block']):
                continue
            L.tile(x, y, 'dirt')
            v = (x * 7 + y * 13) % var_n
            L.add(kind, x, y, 1, 1, f'{kind}-{v}-S-f00', layer='resource', claim=False)
    # archive: the 53 tiles nearest a seed beside the footprint (01 §5.4)
    cand = []
    for y in range(18, 30):
        for x in range(46, 62):
            cand.append((math.hypot(x + 0.5 - 54.0, (y + 0.5 - 21.0) * 1.15), x, y))
    cand.sort()
    resource('archive', [(x, y) for _, x, y in cand[:53]])
    resource('iron-ore', blob_tiles(38, 37.5, 11.5, 21))
    resource('iron-ore', blob_tiles(49, 34, 3.5, 23)[:0])
    coal_tiles = blob_tiles(48.5, 33.5, 4.2, 22)
    resource('coal', coal_tiles)
    resource('quartz', blob_tiles(34, 6, 4.2, 24))
    if wide:
        resource('copper-ore', blob_tiles(-30, -10, 9.5, 25))
        resource('iron-ore', blob_tiles(96, 38, 10, 26))

    # ---------------- power ----------------
    L.machine('offshore-pump', 9, 25, 1, 2, d='N')
    L.add('pipe', 9, 24, 1, 1, 'pipe-5-S-f00')
    L.machine('boiler', 8, 21, 2, 3, d='W')
    L.add('steam-engine', 10, 21, 5, 3, 'steam-engine-0-S-f00')
    L.add('steam-engine', 15, 21, 5, 3, 'steam-engine-0-S-f00')

    # ---------------- seminars (two rows of four, chained) ----------------
    for x in (8, 12, 16, 20):
        L.machine('seminar', x, 14, 3, 3)
        L.machine('seminar', x, 10, 3, 3)
        L.inserter(x + 1, 13, 'S', item='memo', pose='mid' if x == 12 else 'drop')
        L.inserter(x + 1, 17, 'S', item='memo', pose='drop' if x in (8, 16) else 'pick')
    L.belt_path([(x, 18) for x in range(23, 8, -1)], lanes={'R': ('memo', 0.55)}, seed=1)
    L.add('wooden-chest', 7, 18, 1, 1, 'wooden-chest-S-f00')
    L.inserter(8, 18, 'E', item='memo')

    # ---------------- assemblers ----------------
    L.machine('assembling-machine-1', 22, 20, 3, 3)       # Memo
    L.machine('assembling-machine-1', 26, 20, 3, 3)       # gears
    L.inserter(23, 19, 'S', item='memo')
    L.inserter(25, 21, 'E', item='iron-gear-wheel', pose='mid')
    L.inserter(23, 23, 'S', item='token')
    L.inserter(27, 23, 'S', item='iron-plate', pose='pick')

    # ---------------- bus: tokens (south lane) and plates (north lane) ----------------
    L.belt_path([(x, 24) for x in range(47, 37, -1)], d_out='W', lanes={'L': ('token', 0.85)}, seed=2)
    L.belt_path([(x, 24) for x in range(37, 21, -1)], d_in='W', d_out='W',
                lanes={'L': ('token', 0.8), 'R': ('iron-plate', 0.8)}, seed=3)

    # ---------------- keypunches ----------------
    for i, x in enumerate((40, 42, 44, 46)):
        L.machine('keypunch', x, 21, 2, 2, frame=(i * 5) % 16)
        L.inserter(x, 20, 'N', kind='burner-inserter', item='records', pose='drop' if i % 2 else 'pick')
        L.inserter(x + 1, 23, 'N', item='token', pose='drop' if i != 2 else 'pick')
    # records belt from the archive drills, coal lane from a chest
    L.machine('electric-mining-drill', 51, 19, 3, 3, d='W')
    L.machine('electric-mining-drill', 51, 22, 3, 3, d='W')
    pts = [(50, y) for y in range(24, 18, -1)] + [(x, 19) for x in range(49, 39, -1)]
    L.belt_path(pts[:6], d_out='W', lanes={'R': ('records', 0.75)}, seed=4)
    L.belt_path(pts[6:9], d_in='W', d_out='W', lanes={'R': ('records', 0.75)}, seed=5)
    L.belt_path(pts[9:], d_in='W', lanes={'R': ('records', 0.7), 'L': ('coal', 0.8)}, seed=6)
    L.add('iron-chest', 47, 17, 1, 1, 'iron-chest-S-f00')
    L.inserter(47, 18, 'N', item='coal')

    # ---------------- furnaces and iron ----------------
    for i, x in enumerate((30, 32, 34, 36)):
        # the last furnace has run out of ore: idle (unlit mouth, no glow, no smoke) beside working ones
        L.machine('stone-furnace', x, 26, 2, 2, state='idle' if i == 3 else None)
        L.inserter(x + 1, 25, 'S', item='iron-plate', pose='drop' if i % 2 == 0 else 'pick')
        L.inserter(x, 28, 'S', kind='burner-inserter', item='iron-ore',
                   pose={1: 'mid', 3: 'pick'}.get(i, 'drop'))
    L.belt_path([(x, 29) for x in range(48, 28, -1)], lanes={'L': ('iron-ore', 0.85), 'R': ('coal', 0.6)}, seed=7)
    for x in (30, 33, 36, 39, 42):
        L.machine('electric-mining-drill', x, 30, 3, 3, d='N')
    L.machine('electric-mining-drill', 45, 30, 3, 3, d='N')

    # ---------------- poles: wired in tidy lines, as a player strings them ----------------
    net = [((20, 21), (21, 19)), ((21, 19), (19, 13)), ((19, 13), (15, 13)), ((15, 13), (11, 13)),
           ((11, 13), (11, 9)), ((19, 13), (19, 9)), ((21, 19), (25, 23)), ((25, 23), (29, 25)),
           ((29, 25), (34, 25)), ((34, 25), (39, 25)), ((39, 25), (44, 25)), ((44, 25), (48, 23)),
           ((48, 23), (49, 21)), ((48, 23), (50, 25)), ((29, 25), (33, 28)), ((33, 28), (38, 28)),
           ((38, 28), (43, 28))]
    placed = set()
    for a, b in net:
        for p in (a, b):
            if p not in placed and L.free(*p):
                L.pole(*p)
                placed.add(p)
        if a in placed and b in placed:
            L.wire((a[0] + 0.5, a[1] + 0.5), (b[0] + 0.5, b[1] + 0.5))
    L.poles = []          # the spanning-tree helper only wires poles added after this point

    # ---------------- the researcher, a big rock ----------------
    L.add('character', 19, 20, 1, 1, 'character-S-f00', claim=False)
    L.add('big-rock', 26, 4, 2, 2, 'big-rock-0-S-f00')
    L.add('big-rock', 41, 12, 2, 2, 'big-rock-1-S-f00')

    if wide:
        _wide_extras(L)
    L.wire_poles()

    # ---------------- trees and decoratives ----------------
    res_tiles = set((int(e.cx - 0.5), int(e.cy - 0.5)) for e in L.ents if e.layer == 'resource')
    tiles = L.tiles
    for y in range(L.y0, L.y0 + L.h):
        for x in range(L.x0, L.x0 + L.w):
            t = tiles[y - L.y0, x - L.x0]
            if t not in (T.TID['grass'], T.TID['dirt']):
                continue
            if not L.free(x - 1, y - 1, 3, 3):
                continue
            if (44 <= x <= 76 and -8 <= y <= 27) or (x, y) in res_tiles:
                continue
            f = forest_n(np.array(x + 0.5), np.array(y + 0.5))
            # keep the factory core clear
            core = (6 <= x <= 50) and (5 <= y <= 33)
            p_tree = max(0.0, (f - 0.55) * 1.6) * (0.08 if core else 1.0)
            if rng.random() < p_tree:
                v = int(rng.integers(0, 3)) if rng.random() < 0.8 else int(rng.integers(3, 5))
                L.add('tree', x, y, 1, 1, f'tree-{v}-S-f00', claim=True)
                continue
            if rng.random() < 0.075:
                v = int(rng.integers(0, 7))
                L.add('decorative', x, y, 1, 1, f'decorative-{v}-S-f00', layer='decor', claim=False)
    return L


def _wide_extras(L):
    """Outposts beyond the 1x view: copper mine and smelting, a second iron mine, more seminars."""
    # copper: drills on the patch feeding a belt east to a furnace row
    for x in (-36, -33, -30, -27):
        L.machine('electric-mining-drill', x, -12, 3, 3, d='S')
    L.belt_path([(x, -9) for x in range(-37, -14)], lanes={'L': ('copper-ore', 0.85), 'R': ('coal', 0.5)}, seed=11)
    for i, x in enumerate(range(-24, -14, 2)):
        L.machine('stone-furnace', x, -7, 2, 2)
        L.inserter(x, -8, 'N', kind='burner-inserter', item='copper-ore')
        L.inserter(x + 1, -5, 'N', item='copper-plate')
    L.belt_path([(x, -4) for x in range(-24, -1)], lanes={'L': ('copper-plate', 0.7)}, seed=12)
    L.add('iron-chest', -1, -4, 1, 1, 'iron-chest-S-f00')
    for p in [(-38, -10), (-32, -8), (-26, -8), (-20, -5), (-14, -5), (-8, -3), (-3, -6)]:
        if L.free(*p):
            L.pole(*p)
    # a second iron mine to the east with a long belt west
    for x in (88, 91, 94, 97, 100):
        L.machine('electric-mining-drill', x, 30, 3, 3, d='N')
    L.belt_path([(x, 29) for x in range(103, 49, -1)], d_out='W', lanes={'L': ('iron-ore', 0.8)}, seed=13)
    for p in [(86, 28), (92, 28), (98, 28), (80, 27), (74, 27), (68, 27), (62, 27), (56, 27)]:
        if L.free(*p):
            L.pole(*p)
    # a third and fourth row of seminars to the north of the block (the ten-Seminar block grows)
    for x in (8, 12, 16, 20):
        L.machine('seminar', x, 6, 3, 3)
        L.inserter(x + 1, 9, 'S', item='memo', pose='drop')
