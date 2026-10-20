"""assembling-machine-2 (3x3): 'blue assembler with two module ports and a pipe stub' (items.yaml);
'Its recipe is held in a stored program.' (entities.yaml). The Report-tier skin: a late-1950s
stored-program cabinet: enamel blue body, a magnetic-tape unit with two reels, a console with
indicator lamps, two module ports on top, a pipe stub on the west side. Working (16 frames): the
reels turn, the lamps change."""

import math

META = dict(size=(3, 3), height=2.2, directions=['S'], frames=16, light=True)


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    working = state == 'working'
    t = (frame % 16) / 16.0
    o.append(P.box(2.88, 2.88, 0.12, 0, 0, 0.0, mat='steel_dark', bevel=0.03, name='plinth'))
    o.append(P.box(2.70, 2.30, 1.55, 0, 0.18, 0.12, mat='enamel_blue', bevel=0.04, name='cabinet'))
    o.append(P.box(2.74, 2.34, 0.10, 0, 0.18, 1.67, mat='steel_paint_alt', bevel=0.02, name='top'))
    # tape unit: two reels behind a window, left half of the front
    o.append(P.box(1.20, 0.06, 0.95, -0.62, -0.99, 0.45, mat='steel_paint_alt', bevel=0.02, name='tape_panel'))
    for k, x in enumerate((-0.90, -0.34)):
        o.append(P.cyl(0.24, 0.04, x, -1.03, 1.05, mat='steel_bare', axis='Y', seg=32, name='reel'))
        o.append(P.cyl(0.08, 0.05, x, -1.04, 1.05, mat='steel_dark', axis='Y', seg=16, name='hub'))
        a = 2 * math.pi * t * (1 if k == 0 else -1)
        for s in range(3):
            b = a + s * 2 * math.pi / 3
            o.append(P.box(0.03, 0.01, 0.30, x, -1.055, 1.05, mat='steel_dark', rot=(0, b, 0), bevel=0.0))
    o.append(P.box(1.10, 0.04, 0.25, -0.62, -1.02, 0.52, mat='glass_dark', bevel=0.0, name='vacuum_column'))
    # console with lamps, right half
    o.append(P.box(1.20, 0.30, 0.70, 0.70, -1.10, 0.12, mat='enamel_cream', bevel=0.03, name='desk'))
    o.append(P.wedge(1.20, 0.30, 0.0, 0.12, 0.70, -1.10, 0.82, mat='enamel_cream', name='desk_slope'))
    for r in range(3):
        for c in range(6):
            on = working and ((r * 7 + c * 3 + int(t * 16)) % 5 < 2)
            o.append(P.cyl(0.022, 0.02, 0.38 + c * 0.13, -1.01, 1.15 + r * 0.12, mat='lamp' if on else 'glass_dark',
                           axis='Y', seg=8, bevel=0.0, name='lamp'))
    # module ports on top (two), pipe stub west
    for x in (-0.6, 0.6):
        o.append(P.box(0.50, 0.50, 0.10, x, 0.45, 1.77, mat='steel_dark', bevel=0.015, name='port'))
        o.append(P.box(0.40, 0.40, 0.04, x, 0.45, 1.87, mat='cast_iron', bevel=0.0))
    o.append(P.tube([(-1.35, 0.18, 0.55), (-1.55, 0.18, 0.55)], 0.13, 'cast_iron', seg=14, name='pipe_stub'))
    o.append(P.cyl(0.17, 0.05, -1.52, 0.18, 0.55, mat='steel_dark', axis='X', seg=16))
    # louvres on the cabinet top edge
    for k in range(8):
        o.append(P.box(2.2, 0.03, 0.03, 0, 1.25 - k * 0.05, 1.77, mat='steel_dark', bevel=0.0))
    return o
