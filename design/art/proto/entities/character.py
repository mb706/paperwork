"""character: the Site's first researcher (00 §1; B L14), 1945. A figure in a white laboratory coat
over shirt and tie, dark trousers, carrying a clipboard. 1.75 m. Variant 0 faces south-east.
Factorio's character is drawn in 8 directions with run/mine/idle animations; this is the idle pose."""

import math

META = dict(size=(1, 1), height=1.85, directions=['S'], frames=1, margin=0.5, variants=1)


def build(P, direction='S', frame=0, variant=0, state='idle'):
    o = []
    # legs and shoes
    for sx in (-0.075, 0.075):
        o.append(P.cyl(0.07, 0.86, sx, 0.0, 0.05, mat='cloth_dark', seg=12, r_top=0.08, name='leg'))
        o.append(P.box(0.10, 0.20, 0.07, sx, -0.04, 0.0, mat='bakelite', bevel=0.02, name='shoe'))
    # trousers seat / hips
    o.append(P.cyl(0.155, 0.16, 0, 0, 0.84, mat='cloth_dark', seg=16, name='hips'))
    # lab coat: body (frustum, open at the front below the waist)
    o.append(P.cyl(0.215, 0.55, 0, 0.0, 0.52, mat='cloth_white', seg=20, r_top=0.19, name='coat_skirt'))
    o.append(P.cyl(0.19, 0.42, 0, 0.0, 1.07, mat='cloth_white', seg=20, r_top=0.20, name='coat_body'))
    o.append(P.sphere(0.205, 0, 0.0, 1.47, mat='cloth_white', seg=20, scale=(1.18, 0.82, 0.42), name='shoulders'))
    # shirt, tie and lapels at the front
    o.append(P.box(0.11, 0.02, 0.30, 0, -0.175, 1.20, mat='paper', bevel=0.005, name='shirt'))
    o.append(P.box(0.04, 0.02, 0.24, 0, -0.188, 1.22, mat='cloth_tie', bevel=0.004, name='tie'))
    for sx in (-1, 1):
        o.append(P.box(0.05, 0.02, 0.30, sx * 0.07, -0.185, 1.22, mat='cloth_white', bevel=0.004,
                       rot=(0, sx * 0.18, 0), name='lapel'))
    # arms
    o.append(P.tube([(-0.235, 0.0, 1.44), (-0.27, -0.03, 1.15), (-0.25, -0.10, 0.92)], 0.065, 'cloth_white', seg=10))
    o.append(P.sphere(0.055, -0.25, -0.12, 0.88, mat='skin', seg=10, name='hand_l'))
    o.append(P.tube([(0.235, 0.0, 1.44), (0.27, -0.06, 1.20), (0.16, -0.22, 1.08)], 0.065, 'cloth_white', seg=10))
    o.append(P.sphere(0.055, 0.13, -0.26, 1.07, mat='skin', seg=10, name='hand_r'))
    # clipboard held in the right hand, tilted up
    o.append(P.box(0.24, 0.02, 0.32, 0.05, -0.27, 1.02, mat='wood', bevel=0.004, rot=(0.55, 0, 0.15), name='board'))
    o.append(P.box(0.20, 0.02, 0.26, 0.05, -0.285, 1.02, mat='paper', bevel=0.0, rot=(0.55, 0, 0.15), name='sheet'))
    # neck, head, hair, ears
    o.append(P.cyl(0.05, 0.10, 0, 0.0, 1.50, mat='skin', seg=10, name='neck'))
    o.append(P.sphere(0.105, 0, -0.01, 1.66, mat='skin', seg=18, scale=(0.92, 1.0, 1.12), name='head'))
    o.append(P.sphere(0.112, 0, 0.015, 1.705, mat='hair', seg=18, scale=(0.95, 1.0, 0.75), name='hair'))
    o.append(P.box(0.18, 0.02, 0.035, 0, -0.105, 1.675, mat='steel_dark', bevel=0.004, name='spectacles'))
    P.rotate_all(o, math.radians(-25))
    return o
