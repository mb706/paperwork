"""pipe (1x1): 'grey iron pipe' (items.yaml). Variant = connection mask, bit 1 N, 2 E, 4 S, 8 W
(5 = straight N-S, 10 = straight E-W, 3/6/12/9 = corners). Flanged cast-iron pipe on low saddles."""

META = dict(size=(1, 1), height=0.55, directions=['S'], frames=1, variants=16, margin=0.3)
R = 0.15
Z = 0.30
DIRS = {1: (0, 1), 2: (1, 0), 4: (0, -1), 8: (-1, 0)}


def build(P, direction='S', frame=0, variant=5, state='working'):
    o = []
    mask = variant or 5
    arms = [d for b, d in DIRS.items() if mask & b]
    for dx, dy in arms:
        o.append(P.tube([(0, 0, Z), (dx * 0.5, dy * 0.5, Z)], R, 'cast_iron', seg=16, name='arm'))
        fx, fy = dx * 0.46, dy * 0.46
        axis = 'X' if dx else 'Y'
        o.append(P.cyl(R + 0.035, 0.06, fx, fy, Z, mat='steel_dark', axis=axis, seg=16, name='flange'))
    straight = mask in (5, 10)
    if not straight or len(arms) != 2:
        o.append(P.sphere(R + 0.02, 0, 0, Z, mat='cast_iron', seg=16, name='joint'))
    o.append(P.box(0.30, 0.22, Z - R + 0.02, 0, 0, 0.0, mat='concrete', bevel=0.01, name='saddle'))
    return o
