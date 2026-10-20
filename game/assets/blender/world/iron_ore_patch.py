"""iron-ore-patch resource tile (resources.yaml; items.yaml iron-ore 'ISO: blue-grey rock chunks'): blue-grey ore
rubble per tile at the ore's 70 % ink weight (A3 §5, §11; 10 §9.9). Six shapes (the position hash picks one, 10
§15.7) and eight depletion bands, CHUNK_RESOURCES.band 0-7: band 7 is the full pile and each lower band removes
pieces, the smallest first, down to a couple of stones at band 0 (resource tiles shrink as they deplete, as in
Factorio). The chunks spill a little past the tile so a field reads as one patch, not a grid."""

import math

META = dict(kind='resource', size=(1, 1), height=0.32, shapes=6, bands=8, margin=0.3, ink='ore')
MATS = ('ore_iron', 'ore_iron', 'ore_iron_dark')


def build(P, shape):
    r = P.rng(5100 + 37 * shape)
    chunks = []
    # a few large chunks near the middle, then smaller ones spread out to the tile's edges and a little past
    n_big, n_small = 3 + (shape % 2), 10 + (shape % 3)
    for k in range(n_big + n_small):
        big = k < n_big
        rad = r.uniform(0.11, 0.16) if big else r.uniform(0.055, 0.105)
        d = r.uniform(0.0, 0.22) if big else r.uniform(0.12, 0.50)
        a = r.uniform(0, 2 * math.pi)
        x, y = d * math.cos(a), d * math.sin(a) * 0.9
        chunks.append((rad, x, y, MATS[r.randint(0, len(MATS) - 1)], r.randint(0, 9999), r.uniform(0.5, 0.75)))
    # keep apart: drop a chunk whose centre falls inside a bigger one
    kept = []
    for c in sorted(chunks, key=lambda c: -c[0]):
        if all(math.hypot(c[1] - k[1], c[2] - k[2]) > 0.55 * (c[0] + k[0]) for k in kept):
            kept.append(c)
    out = []
    for i, (rad, x, y, mat, seed, squash) in enumerate(kept):
        out.append(P.rock(rad, x, y, 0.0, mat=mat, seed=seed, squash=squash, rough=0.42, subdiv=2,
                          name=f'chunk{i:02d}'))
    return out                                   # biggest first: the last to be mined away


def pieces(band, n):
    """How many of the n chunks band 0-7 keeps (band 7: all)."""
    return max(2, int(round(n * (0.16 + 0.84 * band / 7.0))))
