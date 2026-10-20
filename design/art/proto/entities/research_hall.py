"""research-hall (7x7): 'The first System card written here closes the loop.' (entities.yaml).
Takeoff-era skin (a modern accelerator hall): a windowless pale hall on a concrete apron, rows of
cooling units on the roof, coolant manifolds, a loading dock to the south and status strips.
Working: the roof fans turn and the status strip is lit."""

import math

META = dict(size=(7, 7), height=3.6, directions=['S'], frames=8, light=True)


def build(P, direction='S', frame=0, variant=0, state='working'):
    o = []
    working = state == 'working'
    t = (frame % 8) / 8.0
    o.append(P.box(6.92, 6.92, 0.12, 0, 0, 0.0, mat='concrete', bevel=0.02, name='apron'))
    o.append(P.box(6.40, 5.60, 2.30, 0, 0.45, 0.12, mat='trim_white', bevel=0.03, name='hall'))
    o.append(P.box(6.48, 5.68, 0.10, 0, 0.45, 2.42, mat='steel_paint_alt', bevel=0.02, name='parapet'))
    # roof cooling units: 3 x 4 fans
    for i in range(4):
        for j in range(3):
            x, y = -2.25 + i * 1.5, -1.25 + j * 1.6 + 0.45
            o.append(P.box(1.30, 1.40, 0.40, x, y, 2.52, mat='steel_bare', bevel=0.02, name='cooler'))
            for k in (-0.33, 0.33):
                o.append(P.cyl(0.28, 0.04, x, y + k, 2.92, mat='cast_iron', seg=20, bevel=0.0, name='fan'))
                for b in range(4):
                    a = b * math.pi / 2 + 2 * math.pi * t
                    o.append(P.box(0.50, 0.06, 0.02, x, y + k, 2.95, mat='steel_dark', rot=(0, 0, a), bevel=0.0))
    # coolant manifolds along the east side
    for z in (0.5, 0.9):
        o.append(P.tube([(3.25, 2.9, z), (3.25, -2.2, z)], 0.10, 'water_steel', seg=12, name='manifold'))
    # loading dock and doors
    o.append(P.box(2.4, 0.9, 0.55, -1.2, -2.85, 0.12, mat='concrete', bevel=0.02, name='dock'))
    for x in (-1.8, -0.6):
        o.append(P.box(0.9, 0.06, 1.2, x, -2.37, 0.67, mat='steel_paint', bevel=0.01, name='door'))
    # status strip
    o.append(P.box(2.0, 0.04, 0.08, 1.6, -2.37, 1.9, mat='lamp_green' if working else 'glass_dark', bevel=0.0))
    o.append(P.box(0.9, 0.04, 0.5, 1.6, -2.37, 1.2, mat='glass_dark', bevel=0.0, name='panel'))
    return o
