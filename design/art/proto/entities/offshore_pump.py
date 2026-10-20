"""offshore-pump (1x2): 'pump head on a short pier' (items.yaml). The pier reaches north into the
water; the output flange faces south (direction S). Frames: none (the pump is shown still)."""

import math

META = dict(size=(1, 2), height=1.2, directions=['N', 'E', 'S', 'W'], frames=1, rotate_footprint=False)
ANG = {'S': 0.0, 'N': math.pi, 'E': math.pi / 2, 'W': -math.pi / 2}


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    o.append(P.box(0.94, 1.90, 0.22, 0, 0.05, -0.05, mat='concrete', bevel=0.02, name='pier'))
    for x in (-0.38, 0.38):
        o.append(P.box(0.10, 0.10, 0.45, x, 0.92, -0.30, mat='concrete', bevel=0.01, name='pile'))
    o.append(P.cyl(0.25, 0.42, 0, -0.10, 0.17, mat='steel_paint', seg=20, name='volute'))
    o.append(P.cyl(0.28, 0.06, 0, -0.10, 0.59, mat='steel_dark', seg=20, name='lid'))
    o.append(P.cyl(0.20, 0.30, 0, -0.10, 0.65, mat='steel_paint_alt', seg=20, name='motor'))
    o.append(P.cyl(0.09, 0.12, 0, -0.10, 0.95, mat='steel_dark', seg=12, name='cap'))
    o.append(P.tube([(0, 0.10, 0.35), (0, 0.80, 0.35), (0, 0.80, -0.25)], 0.10, 'cast_iron', seg=12, name='suction'))
    o.append(P.tube([(0, -0.30, 0.35), (0, -0.92, 0.35)], 0.13, 'cast_iron', seg=14, name='out'))
    o.append(P.cyl(0.18, 0.06, 0, -0.95, 0.35, mat='cast_iron', axis='Y', seg=16, name='flange'))
    for x in (-0.40, 0.40):
        o.append(P.box(0.05, 1.70, 0.05, x, 0.10, 0.45, mat='steel_dark', bevel=0.0, name='rail'))
        for y in (-0.6, 0.2, 0.9):
            o.append(P.box(0.04, 0.04, 0.30, x, y, 0.17, mat='steel_dark', bevel=0.0, name='stanchion'))
    P.rotate_all(o, ANG[direction])
    return o
