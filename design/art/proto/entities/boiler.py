"""boiler (3x2): 'brick firebox under a steam drum' (items.yaml). Firebox door on the south face
glows while working; tall iron stack at the back-left; water connections east and west, steam out
north (Factorio's layout). Directions N/E/S/W by rotation (S = firebox to the south)."""

import math

META = dict(size=(3, 2), height=3.3, directions=['S'], frames=1, light=True)
ANG = {'S': 0.0, 'N': math.pi, 'E': math.pi / 2, 'W': -math.pi / 2}


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    working = state == 'working'
    o.append(P.box(2.90, 1.86, 0.10, 0, 0, 0.0, mat='concrete', bevel=0.02, name='pad'))
    o.append(P.box(2.70, 1.56, 0.95, 0, 0.04, 0.10, mat='brick', bevel=0.02, name='firebox'))
    o.append(P.box(2.78, 1.64, 0.08, 0, 0.04, 1.05, mat='quartz_stone', bevel=0.015, name='coping'))
    # fire door (south)
    o.append(P.box(0.66, 0.06, 0.50, -0.35, -0.76, 0.22, mat='cast_iron', bevel=0.015, name='door_frame'))
    o.append(P.box(0.50, 0.05, 0.34, -0.35, -0.79, 0.30, mat='fire' if working else 'steel_dark', bevel=0.0, name='door'))
    for k in range(4):
        o.append(P.box(0.50, 0.06, 0.03, -0.35, -0.80, 0.33 + k * 0.08, mat='steel_dark', bevel=0.0, name='grate'))
    o.append(P.box(0.44, 0.06, 0.18, 0.55, -0.77, 0.20, mat='cast_iron', bevel=0.012, name='ash_door'))
    # drum on saddles
    for x in (-0.9, 0.9):
        o.append(P.box(0.24, 0.90, 0.26, x, 0.04, 1.13, mat='cast_iron', bevel=0.02, name='saddle'))
    o.append(P.cyl(0.50, 2.50, 0, 0.04, 1.80, mat='steel_paint_alt', axis='X', seg=32, name='drum'))
    for x in (-1.25, 1.25):
        o.append(P.cyl(0.52, 0.06, x, 0.04, 1.80, mat='steel_dark', axis='X', seg=32, name='end'))
    for x in (-0.6, 0.0, 0.6):
        o.append(P.torus(0.505, 0.015, x, 0.04, 1.80, mat='brass', axis='X', seg=32, seg_minor=6))
    # fittings: safety valve, gauge, steam dome
    o.append(P.cyl(0.18, 0.22, 0.45, 0.04, 2.26, mat='steel_paint_alt', seg=16, name='dome'))
    o.append(P.cyl(0.05, 0.16, -0.10, 0.04, 2.28, mat='brass', seg=10, name='valve'))
    o.append(P.sphere(0.06, -0.10, 0.04, 2.47, mat='brass', seg=10))
    o.append(P.cyl(0.09, 0.03, 0.95, -0.42, 1.95, mat='brass', axis='Y', seg=16, name='gauge'))
    o.append(P.cyl(0.075, 0.032, 0.95, -0.44, 1.95, mat='paper', axis='Y', seg=16, bevel=0.0))
    # stack
    o.append(P.cyl(0.17, 2.25, -1.05, 0.55, 1.05, mat='steel_dark', seg=16, name='stack'))
    o.append(P.cyl(0.22, 0.10, -1.05, 0.55, 3.20, mat='cast_iron', seg=16, name='stack_cap'))
    # pipe connections: water W/E at drum level? (Factorio: water on the short sides), steam north
    for x in (-1.45, 1.45):
        o.append(P.cyl(0.16, 0.12, x, 0.5, 0.55, mat='cast_iron', axis='X', seg=16, name='water_in'))
    o.append(P.cyl(0.13, 0.30, 0.0, 0.85, 1.80, mat='cast_iron', axis='Y', seg=16, name='steam_out'))
    P.rotate_all(o, ANG[direction])
    return o
