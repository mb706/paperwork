"""coal resource tile sprite (same rubble model as iron-ore, material coal). Variants 0-5 are full-richness rubble
piles; the engine picks a variant by tile hash and fades to fewer chunks as the tile depletes
(Factorio uses 8 richness stages; here stage 8 only)."""

import math

META = dict(size=(1, 1), height=0.3, directions=['S'], frames=1, variants=6, margin=0.25)
MAT = 'coal'


def build(P, direction='S', frame=0, variant=0, state=''):
    o = []
    r = P.rng(500 + variant + hash(MAT) % 97)
    n = r.randint(8, 12)
    for k in range(n):
        o.append(P.rock(r.uniform(0.07, 0.15), r.uniform(-0.38, 0.38), r.uniform(-0.38, 0.38), 0.0, mat=MAT,
                        seed=r.randint(0, 999), squash=r.uniform(0.5, 0.8), rough=0.5, subdiv=1, name='chunk'))
    return o
