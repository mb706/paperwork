"""R4-world: feasibility of the hour-one compactness guarantee (DECISIONS §32; 01 §9).

Rule tested (01 §9):
  - The campus (8 x 8) sits on the starting college footprint's spawn-facing edge, centred on it.
    Spawn lies on the campus's outward axis (a seeded cardinal direction), 16-32 tiles from the
    campus edge, with a lateral offset of at most 16 tiles. The 24 x 24 footprint extends away
    from spawn. The coverage square at R = 48 (104 x 104, Chebyshev, around the campus) contains
    spawn and the whole footprint.
  - Four starting patches (iron 600 k at 1,000/tile, copper 500 k at 1,000, coal 400 k at 800,
    quartz 300 k at 600; radius sqrt(tiles/pi), edge noise +-30% -> bounding radius 1.3 r) and the
    starting archive (80,000 records -> 53 tiles, radius 4.1) are placed by rejection sampling:
    each patch's bounding disc lies inside the coverage square, >= 2 tiles from the footprint,
    >= 6 tiles from every other patch's bounding disc and >= 3 tiles from spawn; the archive
    touches the footprint (adjacent, outside it) and lies inside the square.
  - An axis-aligned 40 x 40 buildable square (resources allowed, footprint not) fits inside the
    coverage square. (R3-impl U54 asked for 60 x 60; that cannot fit: the footprint lies inside the
    104-tile square and leaves at most 48 tiles on any side.) Water and cliffs are not modelled here;
    01 §9 adds a count rule (>= 7,500 buildable tiles of the square's 10,816).
Prints the success rate, attempts needed, and hour-one distances (spawn to each patch centre,
patch to patch), against round 2's rule (patches 30-140 tiles from spawn anywhere).
"""
import math
import random

R = 48
CAMPUS = 8
FOOT = 24
PATCHES = {'iron': (600_000, 1000), 'copper': (500_000, 1000), 'coal': (400_000, 800), 'quartz': (300_000, 600)}


def radius(total, per_tile):
    return math.sqrt(total / per_tile / math.pi)


def layout(rng):
    # campus at origin-centred coordinates: campus occupies [-4, 4) x [-4, 4); spawn to the north (-y)
    cx0, cy0 = -4.0, -4.0
    gap = rng.uniform(16, 32)          # spawn to the campus's north edge
    lat = rng.uniform(-16, 16)
    spawn = (lat, cy0 - gap)
    # footprint: 24 x 24 whose north edge is the campus's north edge, centred laterally on the campus
    fx0, fy0, fx1, fy1 = -12.0, -4.0, 12.0, 20.0
    sq = (cx0 - R, cy0 - R, cx0 + CAMPUS + R, cy0 + CAMPUS + R)   # coverage square
    placed = []
    for name, (total, per) in PATCHES.items():
        rb = 1.3 * radius(total, per)
        for attempt in range(400):
            x = rng.uniform(sq[0] + rb, sq[2] - rb)
            y = rng.uniform(sq[1] + rb, sq[3] - rb)
            # distance from disc to footprint rectangle
            dx = max(fx0 - x, 0, x - fx1); dy = max(fy0 - y, 0, y - fy1)
            if math.hypot(dx, dy) < rb + 2:
                continue
            if math.hypot(x - spawn[0], y - spawn[1]) < rb + 3:
                continue
            if any(math.hypot(x - px, y - py) < rb + pr + 6 for (_, px, py, pr) in placed):
                continue
            placed.append((name, x, y, rb))
            break
        else:
            return None
    # archive: adjacent to the footprint's east, west or south edge, inside the square
    ra = math.sqrt(53 / math.pi)          # 80,000 records / 1,500 per tile = 53 tiles (01 §5.4)
    for attempt in range(200):
        side = rng.choice(['e', 'w', 's'])
        if side == 'e':
            x, y = fx1 + ra + 0.5, rng.uniform(fy0 + ra, fy1 - ra)
        elif side == 'w':
            x, y = fx0 - ra - 0.5, rng.uniform(fy0 + ra, fy1 - ra)
        else:
            x, y = rng.uniform(fx0 + ra, fx1 - ra), fy1 + ra + 0.5
        if any(math.hypot(x - px, y - py) < ra + pr + 2 for (_, px, py, pr) in placed):
            continue
        break
    else:
        return None
    # 60 x 60 square avoiding the footprint, inside the coverage square: try a grid of positions
    ok60 = False
    for ox in range(int(sq[0]), int(sq[2]) - 40 + 1, 2):
        for oy in range(int(sq[1]), int(sq[3]) - 40 + 1, 2):
            if ox < fx1 and ox + 40 > fx0 and oy < fy1 and oy + 40 > fy0:
                continue
            ok60 = True
            break
        if ok60:
            break
    return dict(spawn=spawn, patches=placed, archive=(x, y), ok60=ok60, square=sq)


def main(n=5000, seed=7):
    rng = random.Random(seed)
    fails = 0
    tries_hist = []
    d_iron, d_far, spread = [], [], []
    for _ in range(n):
        for tries in range(1, 9):     # worldgen retries the whole layout up to 8 times
            lay = layout(rng)
            if lay and lay['ok60']:
                break
        else:
            fails += 1
            continue
        tries_hist.append(tries)
        sx, sy = lay['spawn']
        ds = {name: math.hypot(x - sx, y - sy) for (name, x, y, r) in lay['patches']}
        d_iron.append(ds['iron']); d_far.append(max(ds.values()))
        pts = [(x, y) for (_, x, y, _) in lay['patches']]
        spread.append(max(math.hypot(a[0] - b[0], a[1] - b[1]) for a in pts for b in pts))
    d_iron.sort(); d_far.sort(); spread.sort()
    q = lambda a, p: a[int(p * (len(a) - 1))]
    print(f'layouts: {n}, failures after 8 retries: {fails} ({fails / n:.3%}); mean tries {sum(tries_hist) / len(tries_hist):.2f}')
    print(f'spawn -> iron patch centre: median {q(d_iron, .5):.0f}, 90th pct {q(d_iron, .9):.0f}, max {d_iron[-1]:.0f} tiles')
    print(f'spawn -> farthest starting patch: median {q(d_far, .5):.0f}, 90th pct {q(d_far, .9):.0f}, max {d_far[-1]:.0f}')
    print(f'largest patch-to-patch centre distance: median {q(spread, .5):.0f}, 90th pct {q(spread, .9):.0f}')
    print('round 2 for comparison: patches 30-140 tiles from spawn in any direction; 41% of seeds had none inside coverage (R3-fun)')


if __name__ == '__main__':
    main()
