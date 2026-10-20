"""Decoratives (no collision, drawn in the ground layer): 0-2 grass tufts, 3-4 pebbles, 5 bush,
6 flowering weeds."""

import math

META = dict(size=(1, 1), height=0.6, directions=['S'], frames=1, variants=7, margin=0.3)


def build(P, direction='S', frame=0, variant=0, state=''):
    o = []
    r = P.rng(300 + variant)
    if variant <= 2:
        for k in range(14):
            a = r.uniform(0, 2 * math.pi)
            d = r.uniform(0, 0.16)
            x, y = d * math.cos(a), d * math.sin(a)
            hgt = r.uniform(0.18, 0.34)
            tip = (x + r.uniform(-0.08, 0.08), y + r.uniform(-0.05, 0.05), hgt)
            o.append(P.tube([(x, y, 0.0), tip], 0.012, 'leaf' if k % 3 else 'leaf_dark', seg=4, name='blade'))
    elif variant <= 4:
        for k in range(4):
            o.append(P.rock(r.uniform(0.05, 0.11), r.uniform(-0.25, 0.25), r.uniform(-0.2, 0.2), 0.0, mat='rock',
                            seed=r.randint(0, 999), squash=0.6, rough=0.3, subdiv=2, name='pebble'))
    elif variant == 5:
        for k in range(5):
            o.append(P.blob(r.uniform(0.16, 0.24), r.uniform(-0.18, 0.18), r.uniform(-0.15, 0.15), r.uniform(0.12, 0.22),
                            mat='leaf_dark' if k % 2 else 'leaf', seed=r.randint(0, 999), rough=0.3, subdiv=2, freq=3.5))
    else:
        for k in range(9):
            x, y = r.uniform(-0.2, 0.2), r.uniform(-0.18, 0.18)
            hgt = r.uniform(0.15, 0.28)
            o.append(P.tube([(x, y, 0), (x, y, hgt)], 0.008, 'leaf', seg=4))
            o.append(P.sphere(0.03, x, y, hgt, mat='paper' if k % 3 else 'belt_yellow', seg=8))
    return o
