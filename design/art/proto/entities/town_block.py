"""Town block buildings (6x6 block between 2-tile streets; 01 §5.3), era skin 1 (W < 15).
Variants: 0 brick hall with hip roof, 1 two houses with gardens, 2 shop row with awnings,
3 the town library (portico and pediment), 4 church with steeple. Each sprite covers the whole block
(town-block tiles are unbuildable)."""

import math
from entities._building import hall, windows

META = dict(size=(6, 6), height=6.0, directions=['S'], frames=1, variants=5, margin=0.3)


def build(P, direction='S', frame=0, variant=0, state=''):
    o = []
    r = P.rng(900 + variant)
    # block pavement / yard
    o.append(P.box(5.9, 5.9, 0.05, 0, 0, 0.0, mat='concrete', bevel=0.01, name='pavement'))
    if variant == 0:
        o += hall(P, 5.0, 3.6, 3, 0, 0.6, roof='hip', storey_h=1.0)
        o.append(P.box(4.6, 1.4, 0.04, 0, -2.0, 0.05, mat='lawn', bevel=0.0))
    elif variant == 1:
        for (x, y, w, d) in [(-1.4, 0.9, 2.4, 2.6), (1.5, 1.1, 2.2, 2.4)]:
            o += hall(P, w, d, 2, x, y, roof='gable_x', wall='trim_white', roof_mat='roof_tile', storey_h=0.95,
                      win_cols=2)
        o.append(P.box(5.6, 2.2, 0.04, 0, -1.6, 0.05, mat='lawn', bevel=0.0))
        for x in (-2.2, 0.2, 2.3):
            o.append(P.blob(0.45, x, -1.9, 0.45, mat='leaf_dark', seed=r.randint(0, 99), rough=0.25))
        o.append(P.box(5.8, 0.06, 0.35, 0, -2.85, 0.05, mat='trim_white', bevel=0.0, name='fence'))
    elif variant == 2:
        for k, x in enumerate((-1.9, 0.0, 1.9)):
            o += hall(P, 1.85, 3.8, 2, x, 0.6, roof='flat', wall=('brick' if k != 1 else 'quartz_stone'),
                      storey_h=1.0, win_cols=2, door=False)
            awn = ['enamel_red', 'belt_yellow', 'steel_paint'][k]
            o.append(P.wedge(1.7, 0.6, 0.95, 1.15, x, -1.6, 0.0, mat=awn, name='awning'))
            o.append(P.box(1.5, 0.05, 0.85, x, -1.32, 0.25, mat='glass_dark', bevel=0.0, name='shopfront'))
    elif variant == 3:
        # the library: classical portico
        o += hall(P, 5.2, 3.4, 2, 0, 0.9, roof='hip', wall='quartz_stone', roof_mat='slate', storey_h=1.3,
                  win_cols=4, door=False)
        o.append(P.box(3.0, 0.9, 0.3, 0, -1.25, 0.0, mat='quartz_stone', bevel=0.02, name='steps'))
        for x in (-1.2, -0.4, 0.4, 1.2):
            o.append(P.cyl(0.16, 2.3, x, -1.2, 0.3, mat='trim_white', seg=16, name='column'))
        o.append(P.box(3.2, 0.8, 0.25, 0, -1.15, 2.6, mat='trim_white', bevel=0.02, name='entablature'))
        o.append(P.prism(3.2, 0.8, 0.6, 0, -1.15, 2.85, mat='trim_white', ridge='Y'))
        o.append(P.box(4.8, 1.0, 0.04, 0, -2.3, 0.05, mat='lawn', bevel=0.0))
    else:
        o += hall(P, 3.0, 4.6, 2, 0.6, 0.3, roof='gable_y', wall='brick', roof_mat='slate', storey_h=1.4,
                  win_cols=2)
        o.append(P.box(1.2, 1.2, 4.2, 0.6, -2.3, 0.05, mat='brick', bevel=0.02, name='tower'))
        o.append(P.box(1.3, 1.3, 0.12, 0.6, -2.3, 4.25, mat='trim_white', bevel=0.01))
        o.append(P.cone(0.85, 2.4, 0.6, -2.3, 4.37, mat='slate', seg=4))
        o.append(P.box(2.4, 5.0, 0.04, -1.9, 0.0, 0.05, mat='lawn', bevel=0.0))
    return o
