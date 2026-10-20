"""electric-mining-drill (3x3): 'square drill head on a grey frame, cable inlet' (items.yaml). A
painted housing on a riveted frame, a gear turret with a ring gear on top (it turns while working),
a horizontal motor, a cable conduit to a junction box, and an output chute that reaches past the
footprint edge on the output side. Directions: output N/E/S/W. Frames: 16 (ring gear)."""

import math

META = dict(size=(3, 3), height=2.0, directions=['N', 'E', 'S', 'W'], frames=16, rotate_footprint=False,
            margin=0.7)

ANG = {'S': 0.0, 'N': math.pi, 'E': math.pi / 2, 'W': -math.pi / 2}


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    t = (frame % 16) / 16.0
    # frame: perimeter rails and feet
    for (sx, sy, x, y) in [(2.84, 0.22, 0, 1.31), (2.84, 0.22, 0, -1.31), (0.22, 2.40, 1.31, 0), (0.22, 2.40, -1.31, 0)]:
        o.append(P.box(sx, sy, 0.22, x, y, 0.0, mat='steel_dark', bevel=0.02, name='rail'))
    for x in (-1.31, 1.31):
        for y in (-1.31, 1.31):
            o.append(P.box(0.34, 0.34, 0.06, x, y, 0.0, mat='cast_iron', bevel=0.015, name='foot'))
            o.append(P.cyl(0.04, 0.03, x, y, 0.22, mat='steel_bare', seg=8, bevel=0.0, name='bolt'))
    # housing
    o.append(P.box(2.02, 2.02, 0.80, 0, 0, 0.14, mat='steel_paint', bevel=0.05, name='housing'))
    for x in (-0.6, 0.6):
        o.append(P.box(0.48, 0.03, 0.40, x, -1.02, 0.30, mat='steel_paint_alt', bevel=0.012, name='hatch'))
    # turret and ring gear
    o.append(P.taper_box(1.40, 1.40, 0.30, 0.85, 0.85, 0, 0, 0.94, mat='steel_paint_alt', bevel=0.03, name='turret'))
    gear = P.gear(0.62, 0.08, 24, 0, 0, 1.24, mat='steel_bare', name='ring', tooth_depth=0.10, hole=0.0)
    gear.rotation_euler = (0, 0, 2 * math.pi * t / 24 * 4)
    o.append(gear)
    o.append(P.cyl(0.30, 0.16, 0, 0, 1.32, mat='steel_dark', seg=20, name='hub'))
    # motor across the back
    o.append(P.cyl(0.28, 1.10, 0, 0.62, 1.30, mat='steel_paint_alt', axis='X', seg=24, name='motor'))
    for k in range(5):
        o.append(P.torus(0.285, 0.014, -0.40 + k * 0.2, 0.62, 1.30, mat='steel_dark', axis='X', seg=24, seg_minor=6))
    o.append(P.box(0.70, 0.40, 0.14, 0, 0.62, 0.94, mat='steel_dark', bevel=0.015, name='motor_seat'))
    # junction box and conduit
    o.append(P.box(0.32, 0.18, 0.36, 0.95, 0.95, 0.94, mat='steel_dark', bevel=0.02, name='jbox'))
    o.append(P.tube([(0.95, 0.95, 1.30), (0.95, 0.80, 1.45), (0.58, 0.62, 1.45)], 0.03, 'copper', seg=8, name='conduit'))
    # output chute (south in the local frame), reaching past the footprint edge
    o.append(P.box(0.62, 0.30, 0.34, 0, -1.06, 0.30, mat='steel_paint_alt', bevel=0.02, name='spout'))
    ch = P.wedge(0.50, 0.80, 0.30, 0.62, 0, -1.48, 0.0, mat='steel_dark', name='chute')
    o.append(ch)
    for sx in (-0.27, 0.27):
        o.append(P.wedge(0.04, 0.80, 0.40, 0.72, sx, -1.48, 0.0, mat='steel_paint_alt', name='chute_side'))
    P.rotate_all(o, ANG[direction])
    return o
