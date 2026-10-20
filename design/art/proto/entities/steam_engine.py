"""steam-engine (3x5): 'horizontal steam engine with a flywheel' (items.yaml). Variant 0 lies
east-west (5 wide), variant 1 north-south. A horizontal mill engine: cylinder with steam chest and a
flyball governor (Maxwell's 'On governors', 1868, is where control theory starts), crosshead guides,
connecting rod and crank, a spoked flywheel, and a dynamo on the shaft. Frames: 16 (flywheel,
crank, governor). Steam connections at both ends of the long axis."""

import math

META = dict(size=(5, 3), height=2.45, directions=['S'], frames=16, variants=2, rotate_footprint=False, margin=0.6)


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    t = (frame % 16) / 16.0
    ang = 2 * math.pi * t
    o.append(P.box(4.86, 2.70, 0.10, 0, 0, 0.0, mat='concrete', bevel=0.02, name='pad'))
    o.append(P.box(4.40, 1.30, 0.42, -0.05, 0.20, 0.10, mat='cast_iron', bevel=0.03, name='bed'))
    # cylinder (west)
    zc = 0.95
    o.append(P.cyl(0.46, 1.30, -1.55, 0.20, zc, mat='steel_paint', axis='X', seg=32, name='cylinder'))
    for x in (-2.22, -0.88):
        o.append(P.cyl(0.50, 0.08, x, 0.20, zc, mat='steel_dark', axis='X', seg=32, name='cover'))
    for x in (-1.9, -1.55, -1.2):
        o.append(P.torus(0.465, 0.014, x, 0.20, zc, mat='brass', axis='X', seg=32, seg_minor=6))
    o.append(P.box(1.00, 0.70, 0.36, -1.55, 0.20, zc + 0.36, mat='steel_paint_alt', bevel=0.03, name='chest'))
    o.append(P.box(0.62, 0.50, 0.40, -1.55, 0.20, 0.52, mat='cast_iron', bevel=0.02, name='cyl_foot'))
    # governor on the steam chest
    gx, gy, gz = -1.30, 0.20, zc + 0.72
    o.append(P.cyl(0.03, 0.55, gx, gy, gz, mat='brass', seg=8, name='spindle'))
    for k in (0, 1):
        a = ang * 2 + k * math.pi
        bx, by = gx + 0.20 * math.cos(a), gy + 0.20 * math.sin(a)
        o.append(P.tube([(gx, gy, gz + 0.50), (bx, by, gz + 0.30)], 0.012, 'brass', seg=6))
        o.append(P.sphere(0.075, bx, by, gz + 0.28, mat='brass', seg=14, name='flyball'))
    # guides, crosshead, rods
    for dz in (-0.12, 0.12):
        o.append(P.box(1.45, 0.10, 0.06, -0.10, 0.20, zc + dz - 0.03, mat='steel_bare', bevel=0.01, name='guide'))
    crank_x = 1.15
    cr = 0.32
    px_, pz_ = crank_x + cr * math.cos(ang), zc + cr * math.sin(ang)
    ch_x = px_ - 1.30
    o.append(P.box(0.24, 0.20, 0.20, ch_x, 0.20, zc - 0.10, mat='steel_dark', bevel=0.02, name='crosshead'))
    o.append(P.tube([(-0.88, 0.20, zc), (ch_x, 0.20, zc)], 0.035, 'steel_bare', seg=10, name='piston_rod'))
    o.append(P.tube([(ch_x, 0.06, zc), (px_, 0.06, pz_)], 0.055, 'steel_bare', seg=10, name='con_rod'))
    # crank disc and shaft (axis Y)
    o.append(P.cyl(0.40, 0.10, crank_x, 0.0, zc, mat='steel_dark', axis='Y', seg=24, name='crank'))
    o.append(P.cyl(0.07, 2.20, crank_x, 0.10, zc, mat='steel_bare', axis='Y', seg=12, name='shaft'))
    # pedestals
    for y in (-0.40, 0.65):
        o.append(P.box(0.40, 0.26, zc - 0.10, crank_x, y, 0.10, mat='cast_iron', bevel=0.02, name='pedestal'))
    # flywheel (in the x-z plane, south of the crank), spoked
    fx, fy, fr = crank_x, -0.62, 1.02
    o.append(P.torus(fr - 0.07, 0.085, fx, fy, zc, mat='steel_paint_alt', axis='Y', seg=48, seg_minor=10, name='rim'))
    o.append(P.cyl(0.16, 0.24, fx, fy, zc, mat='steel_dark', axis='Y', seg=16, name='hub'))
    for k in range(6):
        a = ang + k * math.pi / 3
        o.append(P.tube([(fx + 0.14 * math.cos(a), fy, zc + 0.14 * math.sin(a)),
                         (fx + (fr - 0.12) * math.cos(a), fy, zc + (fr - 0.12) * math.sin(a))], 0.035,
                        'steel_paint_alt', seg=8, name='spoke'))
    o.append(P.box(0.70, 0.40, 0.28, fx, fy, 0.0, mat='concrete', bevel=0.01, name='pit_edge'))
    # dynamo (north of the crank)
    dx, dy = crank_x + 0.10, 0.95
    o.append(P.cyl(0.50, 0.70, dx, dy, zc, mat='steel_paint', axis='Y', seg=32, name='dynamo'))
    o.append(P.cyl(0.52, 0.08, dx, dy - 0.36, zc, mat='steel_dark', axis='Y', seg=32))
    o.append(P.cyl(0.30, 0.10, dx, dy + 0.38, zc, mat='copper', axis='Y', seg=24, name='commutator'))
    o.append(P.box(0.80, 0.60, zc - 0.45, dx, dy, 0.10, mat='cast_iron', bevel=0.02, name='dyn_foot'))
    # steam pipe connections at both ends
    for x in (-2.38, 2.38):
        o.append(P.cyl(0.17, 0.14, x, 0.20, 0.55, mat='cast_iron', axis='X', seg=16, name='flange'))
    o.append(P.tube([(-2.38, 0.20, 0.55), (-2.30, 0.20, 0.55)], 0.13, 'cast_iron', seg=12))
    o.append(P.tube([(2.30, 0.20, 0.55), (1.75, 0.20, 0.55), (1.75, 0.20, 0.30)], 0.11, 'cast_iron', seg=12))
    if variant == 1:
        P.rotate_all(o, math.pi / 2)
    return o
