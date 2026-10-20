"""Shared inserter model (inserter, long-handed, fast, burner).

10 §6.8: the engine draws inserter arms from (θ, r) as rotated 2D part sprites. For mocks we
render the posed arm in 3D, which is what those parts approximate. Variant = pose:
    0 N (pick from the north), 1 S (drop to the south), 2 E, 3 W, 4 NE, 5 SE
The hand position for a held item is returned by hand_pos(variant) (ground x, y and height z).
"""

import math

POSES = {0: 0.0, 1: 180.0, 2: 90.0, 3: 270.0, 4: 45.0, 5: 135.0}   # compass bearing of the arm


def hand_pos(variant, reach=0.92):
    b = math.radians(POSES[variant])
    return (reach * math.sin(b), reach * math.cos(b), 0.30)


def build_inserter(P, variant, arm_mat, reach=0.92, burner=False, fast=False, state='working'):
    """state 'base' -> base only, 'arm' -> arm only (the engine draws them in different layers)."""
    o = []
    # base plate and pedestal
    o.append(P.box(0.62, 0.62, 0.05, 0, 0, 0.0, mat='steel_dark', bevel=0.012, name='plate'))
    for x in (-0.24, 0.24):
        for y in (-0.24, 0.24):
            o.append(P.cyl(0.03, 0.02, x, y, 0.05, mat='steel_bare', seg=8, bevel=0.0, name='bolt'))
    if burner:
        o.append(P.box(0.40, 0.34, 0.18, 0, -0.08, 0.05, mat='cast_iron', bevel=0.02, name='firebox'))
        o.append(P.box(0.14, 0.02, 0.08, 0, -0.26, 0.09, mat='fire', bevel=0.0, name='glow'))
    o.append(P.cyl(0.17, 0.14, 0, 0, 0.05, mat='steel_dark', seg=20, name='turntable'))
    o.append(P.cyl(0.13, 0.20, 0, 0, 0.19, mat=arm_mat, seg=20, name='column'))
    o.append(P.cyl(0.10, 0.06, 0, 0, 0.39, mat='steel_dark', seg=16, name='hub'))
    # arm along +y in local frame, then rotate to the pose bearing
    arm = []
    z_sh = 0.47                      # shoulder height
    elbow = (0.0, reach * 0.45, 0.62)
    wrist = (0.0, reach, 0.46)
    arm.append(P.box(0.15, 0.16, 0.14, 0, 0.0, 0.40, mat=arm_mat, bevel=0.02, name='shoulder'))
    arm.append(P.box(0.13, reach * 0.48, 0.09, 0, reach * 0.22, z_sh + 0.05, mat=arm_mat, bevel=0.02,
                      rot=(math.atan2(elbow[2] - z_sh, elbow[1]), 0, 0), name='upper'))
    arm.append(P.box(0.10, reach * 0.58, 0.075, 0, (elbow[1] + wrist[1]) / 2, (elbow[2] + wrist[2]) / 2 - 0.035,
                      mat=arm_mat, bevel=0.018, rot=(math.atan2(wrist[2] - elbow[2], wrist[1] - elbow[1]), 0, 0), name='fore'))
    arm.append(P.cyl(0.075, 0.17, elbow[0], elbow[1], elbow[2], mat='steel_dark', axis='X', seg=14, name='elbow'))
    if fast:
        arm.append(P.tube([(0.035, 0.05, z_sh + 0.02), (0.035, elbow[1], elbow[2] + 0.02)], 0.015, 'steel_bare', seg=6))
    # hand: wrist block and two fingers
    arm.append(P.box(0.17, 0.11, 0.09, 0, reach, 0.39, mat='steel_dark', bevel=0.015, name='wrist'))
    for sx in (-0.045, 0.045):
        arm.append(P.box(0.035, 0.07, 0.13, sx * 1.4, reach, 0.27, mat='steel_bare', bevel=0.008, name='finger'))
    P.rotate_all(arm, -math.radians(POSES[variant]))
    if state == 'base':
        for a_ in arm:
            __import__('bpy').data.objects.remove(a_)
        return o
    if state == 'arm':
        for b_ in o:
            __import__('bpy').data.objects.remove(b_)
        return arm
    return o + arm
