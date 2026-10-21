"""iron-ore-patch resource tile (resources.yaml; items.yaml iron-ore 'ISO: blue-grey rock chunks'): blue-grey ore
rubble per tile at the ore's 70 % ink weight (A3 §5, §11; 10 §9.9). Six shapes (the position hash picks one, 10
§15.7) and eight depletion bands, CHUNK_RESOURCES.band 0-7 in Factorio's stage order (the golden model's rule 24:
band 0 is the richest tile, 15,000 or more; band 7 holds fewer than 150): band 0 is the full pile, and each higher
band removes pieces, down to a few stones at band 7 (resource tiles thin out as they deplete, as in Factorio).

The pile is A3's mock (design/art/proto/entities/iron_ore.py): small chunks spread evenly over the whole tile and a
little past its edges, never gathered at its centre, so a field of tiles reads as one deposit and not as a grid of
heaps (C8's smoke screenshot; C9). Eleven to thirteen chunks, as many as A3's eight to twelve and a little smaller,
are placed by dart throwing at least their radii apart; the first three are the larger ones. Depletion removes pieces in a size-weighted random order, so what is left of a tile
stays spread over it rather than shrinking to a heap at its centre."""

import math
import random

META = dict(kind='resource', size=(1, 1), height=0.32, shapes=6, bands=8, margin=0.3, ink='ore')
MATS = ('ore_iron', 'ore_iron', 'ore_iron_dark')
# the chunks' centres stay within this distance of the tile's centre on each axis (0.06 past the tile's edges)
SPAN = 0.56
# the share of the pile each band keeps: full through band 1 (9,500 or more), about four fifths at band 5 (the
# starting patches' 1,000 a tile), a third at band 7
KEEP = (1.0, 1.0, 0.95, 0.9, 0.85, 0.78, 0.6, 0.35)


def layout(shape):
    """The pile's chunks as (radius, x, y, material index, seed, squash), in removal order: the list's end goes
    first (no bpy, so the 2D tools can draw it)."""
    r = random.Random(7300 + 101 * shape)
    want = 11 + shape % 3
    kept = []
    tries = 0
    while len(kept) < want and tries < 4000:
        tries += 1
        rad = r.uniform(0.11, 0.145) if len(kept) < 3 else r.uniform(0.055, 0.13)
        x, y = r.uniform(-SPAN, SPAN), r.uniform(-SPAN, SPAN)
        if all(math.hypot(x - k[1], y - k[2]) > 1.0 * (rad + k[0]) for k in kept):
            kept.append((rad, x, y, r.randint(0, len(MATS) - 1), r.randint(0, 9999), r.uniform(0.5, 0.75)))
    return sorted(kept, key=lambda c: -(c[0] * r.uniform(0.5, 1.5)))


def build(P, shape):
    return [P.rock(rad, x, y, 0.0, mat=MATS[m], seed=seed, squash=squash, rough=0.42, subdiv=2, name=f'chunk{i:02d}')
            for i, (rad, x, y, m, seed, squash) in enumerate(layout(shape))]


def pieces(band, n):
    """How many of the n chunks band 0-7 keeps (band 0: all)."""
    return max(3, int(round(n * KEEP[band])))
