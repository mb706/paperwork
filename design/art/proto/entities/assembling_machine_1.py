"""assembling-machine-1 (3x3): 'grey assembler, one crafting arm, no module ports' (items.yaml),
'Set by plugboard.' (entities.yaml). A 1945 machine tool: a painted steel body on a cast plinth, a
plugboard with patch cords on the front, a work well on top under a gantry whose carriage and tool
are the crafting arm. Working animation (16 frames): the carriage traverses and the tool dips; the
pilot lamp is lit."""

import math

META = dict(size=(3, 3), height=2.0, directions=['S'], frames=16, light=True)


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    working = state == 'working'
    t = (frame % 16) / 16.0
    o.append(P.box(2.88, 2.88, 0.14, 0, 0, 0.0, mat='cast_iron', bevel=0.03, name='plinth'))
    o.append(P.box(2.66, 2.34, 0.96, 0, 0.12, 0.14, mat='steel_paint', bevel=0.04, name='body'))
    # front ledge and panel seams
    o.append(P.box(2.70, 0.30, 0.22, 0, -1.18, 0.14, mat='steel_paint_alt', bevel=0.03, name='ledge'))
    for x in (-1.0, 1.0):
        o.append(P.box(0.02, 0.02, 0.70, x, -1.06, 0.30, mat='steel_paint_alt', bevel=0.0, name='seam'))
    # plugboard
    pb_x = -0.30
    o.append(P.box(1.24, 0.05, 0.58, pb_x, -1.065, 0.38, mat='bakelite', bevel=0.012, name='plugboard'))
    o.append(P.box(1.32, 0.03, 0.66, pb_x, -1.045, 0.34, mat='steel_dark', bevel=0.01, name='pb_frame'))
    for r in range(4):
        for c in range(10):
            o.append(P.cyl(0.018, 0.02, pb_x - 0.50 + c * 0.11, -1.095, 0.47 + r * 0.12, mat='brass', axis='Y',
                           seg=8, bevel=0.0, name='jack'))
    cords = [('enamel_red', (0, 3), (4, 1)), ('arm_yellow', (2, 0), (7, 2)), ('bakelite', (5, 3), (9, 0)),
             ('enamel_red', (6, 1), (8, 3))]
    for mat, (c0, r0), (c1, r1) in cords:
        p0 = (pb_x - 0.50 + c0 * 0.11, -1.11, 0.47 + r0 * 0.12)
        p1 = (pb_x - 0.50 + c1 * 0.11, -1.11, 0.47 + r1 * 0.12)
        mid = ((p0[0] + p1[0]) / 2, -1.20, min(p0[2], p1[2]) - 0.10)
        o.append(P.tube([p0, (p0[0], -1.17, p0[2] - 0.04), mid, (p1[0], -1.17, p1[2] - 0.04), p1], 0.016, mat, seg=6))
    # control box with lever and pilot lamp
    o.append(P.box(0.50, 0.12, 0.52, 0.80, -1.07, 0.40, mat='steel_paint_alt', bevel=0.02, name='ctrl'))
    o.append(P.cyl(0.05, 0.05, 0.80, -1.14, 0.80, mat='lamp_green' if working else 'glass_dark', axis='Y', seg=14))
    o.append(P.box(0.04, 0.04, 0.20, 0.68, -1.15, 0.50, mat='steel_bare', rot=(0.5, 0, 0), bevel=0.0, name='lever'))
    o.append(P.sphere(0.04, 0.68, -1.20, 0.68, mat='bakelite', seg=10))
    # top: work well with rim
    zt = 1.10
    o.append(P.box(1.56, 1.16, 0.03, 0, 0.12, zt, mat='cast_iron', bevel=0.0, name='well'))
    for (sx, sy, x, y) in [(1.72, 0.08, 0, 0.74), (1.72, 0.08, 0, -0.50), (0.08, 1.24, -0.82, 0.12), (0.08, 1.24, 0.82, 0.12)]:
        o.append(P.box(sx, sy, 0.10, x, y, zt, mat='steel_paint_alt', bevel=0.015, name='rim'))
    o.append(P.box(0.70, 0.50, 0.12, 0, 0.12, zt + 0.03, mat='steel_bare', bevel=0.015, name='table'))
    o.append(P.gear(0.13, 0.04, 8, 0.05, 0.10, zt + 0.15, mat='steel_bare', name='workpiece'))
    # gantry
    for x in (-0.95, 0.95):
        o.append(P.box(0.12, 0.12, 0.70, x, 0.50, zt, mat='steel_dark', bevel=0.015, name='post'))
    o.append(P.box(2.06, 0.14, 0.12, 0, 0.50, zt + 0.70, mat='steel_dark', bevel=0.015, name='beam'))
    cx = -0.45 + 0.9 * (0.5 - 0.5 * math.cos(2 * math.pi * t))
    dip = 0.18 * max(0.0, math.sin(4 * math.pi * t))
    o.append(P.box(0.26, 0.24, 0.20, cx, 0.42, zt + 0.66, mat='steel_paint', bevel=0.02, name='carriage'))
    o.append(P.cyl(0.035, 0.42, cx, 0.36, zt + 0.32 - dip, mat='steel_bare', seg=10, name='tool'))
    o.append(P.box(0.12, 0.08, 0.06, cx, 0.36, zt + 0.28 - dip, mat='steel_dark', bevel=0.01, name='head'))
    # motor at the back-right
    o.append(P.cyl(0.21, 0.60, 0.80, 0.98, zt + 0.22, mat='steel_paint_alt', axis='X', seg=20, name='motor'))
    for k in range(4):
        o.append(P.torus(0.215, 0.012, 0.58 + k * 0.14, 0.98, zt + 0.22, mat='steel_dark', axis='X', seg=24, seg_minor=6))
    o.append(P.box(0.30, 0.30, 0.10, 0.80, 0.98, zt, mat='steel_dark', bevel=0.01, name='motor_base'))
    return o
