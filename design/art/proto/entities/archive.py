"""archive resource tile: a library's undigitized records (01 §6; items.yaml records: 'bundle of
yellowed papers tied with a string cross; manila, soft edges'; 'Boxes of records. Finite.').
Read as an ore patch made of paper: bundles of manila files with white page edges, tied with
string, stacked on low pallets; the odd grey archival box. Information resources are light; ore is
dark (the matter/information split applied to resources). Variants 0-5 full; depletion removes
stacks (8 richness stages in the engine)."""

import math

META = dict(size=(1, 1), height=0.45, directions=['S'], frames=1, variants=6, margin=0.25)


def _bundle(P, o, x, y, z, a, w=0.30, d=0.22, h=0.075):
    o.append(P.box(w, d, h, x, y, z, mat='paper', bevel=0.012, rot=(0, 0, a), name='pages'))
    o.append(P.box(w + 0.012, d + 0.012, 0.012, x, y, z + h - 0.006, mat='paper_manila', bevel=0.004, rot=(0, 0, a),
                   name='cover'))
    o.append(P.box(w + 0.012, d + 0.012, 0.010, x, y, z, mat='paper_manila', bevel=0.003, rot=(0, 0, a)))
    o.append(P.box(w + 0.02, 0.014, h + 0.012, x, y, z - 0.002, mat='string', bevel=0.0, rot=(0, 0, a)))
    o.append(P.box(0.014, d + 0.02, h + 0.012, x, y, z - 0.002, mat='string', bevel=0.0, rot=(0, 0, a)))


def build(P, direction='S', frame=0, variant=0, state=''):
    o = []
    r = P.rng(700 + variant)
    spots = [(-0.21, 0.19), (0.21, 0.21), (-0.20, -0.19), (0.22, -0.18)]
    r.shuffle(spots)
    for i, (x, y) in enumerate(spots[:r.randint(3, 4)]):
        x += r.uniform(-0.04, 0.04)
        y += r.uniform(-0.04, 0.04)
        a = r.uniform(-0.25, 0.25)
        if r.random() < 0.35:
            o.append(P.box(0.40, 0.32, 0.05, x, y, 0.0, mat='wood_pole', bevel=0.01, rot=(0, 0, a), name='pallet'))
            z = 0.05
        else:
            z = 0.0
        if r.random() < 0.12:
            o.append(P.box(0.30, 0.22, 0.17, x, y, z, mat='archive_box', bevel=0.01, rot=(0, 0, a), name='abox'))
            o.append(P.box(0.09, 0.006, 0.05, x, y - 0.112, z + 0.07, mat='paper', bevel=0.0, rot=(0, 0, a)))
            continue
        for k in range(r.randint(1, 3)):
            _bundle(P, o, x + r.uniform(-0.015, 0.015), y + r.uniform(-0.015, 0.015), z,
                    a + r.uniform(-0.12, 0.12))
            z += 0.075
    for k in range(r.randint(2, 4)):
        o.append(P.box(0.15, 0.20, 0.004, r.uniform(-0.38, 0.38), r.uniform(-0.38, 0.38), 0.0, mat='paper',
                       bevel=0.0, rot=(0, 0, r.uniform(0, 3)), name='sheet'))
    return o
