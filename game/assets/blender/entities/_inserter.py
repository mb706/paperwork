"""Shared inserter model (10 §15.7's `inserter` program; 10 §6.8): the parts the renderer rotates in 2D.

  platform [dir]   the base plate, turntable and column; its motor housing (or the burner's firebox) sits on the
                   pickup side, behind the arm's drop direction, so the platform shows the inserter's facing
  arm              a straight boom from the shoulder pivot (0, 0, SHOULDER) to (0, ARM_LENGTH, SHOULDER), pointing
                   north; the renderer rotates it by theta about its pivot and stretches it to the hand point
  hand_open/closed the gripper at the wrist (the origin), fingers pointing north (outward along the arm)
Ground directions map to the screen 1:1 in this projection, so a part drawn pointing north and rotated in 2D is
the part pointing that way on the ground (10 §15.7). Heights: base plate 0.05, shoulder 0.47 m (A3 §2).
"""

import math

SHOULDER = 0.47
ARM_LENGTH = 1.0
FIREBOX = 'iron_chest'          # the burner's stove, its mouth glowing while it works
BURNER_IRON = 'steel_bare'      # the burner's turntable, column and hub


def meta(margin=0.6):
    return dict(kind='inserter', size=(1, 1), height=0.75, platform_dirs=[0, 4, 8, 12], shoulder=SHOULDER,
                arm_length=ARM_LENGTH, margin=margin, ink='machine')


def platform(P, d, arm_mat, burner=False):
    """Direction d is the drop direction (Factorio's inserter faces where it drops); the pickup side is behind."""
    o = {}
    # a mid-grey plate: a small machine is mostly outline, and a dark plate put it 63-67 % darker than the paper
    # (metrics.py's figure-ground; A3 asks for 25-60 %)
    o['plate'] = P.box(0.62, 0.62, 0.05, 0, 0, 0.0, mat='plate_steel', bevel=0.012, name='plate')
    bolts = [P.cyl(0.03, 0.02, x, y, 0.05, mat='steel_bare', seg=8, bevel=0.0, name='bolt')
             for x in (-0.24, 0.24) for y in (-0.24, 0.24)]
    o['bolts'] = P.join(bolts, 'bolts')
    # the housing on the pickup side (built at the south for a north-facing inserter, then turned with d)
    if burner:
        housing = [P.box(0.36, 0.18, 0.15, 0, -0.18, 0.05, mat=FIREBOX, bevel=0.02, name='firebox'),
                   P.box(0.14, 0.02, 0.08, 0, -0.275, 0.09, mat='fire', bevel=0.0, name='glow')]
    else:
        housing = [P.box(0.34, 0.16, 0.14, 0, -0.19, 0.05, mat='enamel_blue' if arm_mat != 'arm_blue' else 'steel_paint',
                         bevel=0.02, name='motor'),
                   P.box(0.10, 0.02, 0.05, 0, -0.272, 0.10, mat='brass', bevel=0.0, name='plate_label')]
    turned = housing
    P.rotate_all(turned, -math.radians(d * 22.5))
    for i, h in enumerate(turned):
        o[f'housing{i}'] = h
    # the burner's turntable, column and hub are bare steel and its firebox plain iron, its arm alone dark: with the
    # column in the dark arm colour and a cast-iron firebox the platform measured 64 % darker than the paper,
    # outside A3's 25-60 % (metrics.py --gate); now 59 %, like the inserter's
    iron = BURNER_IRON if burner else 'steel_dark'
    o['turntable'] = P.cyl(0.17, 0.12, 0, 0, 0.05, mat=iron, seg=24, name='turntable')
    o['column'] = P.cyl(0.12, 0.20, 0, 0, 0.17, mat=BURNER_IRON if burner else arm_mat, seg=24, name='column')
    o['hub'] = P.cyl(0.10, 0.07, 0, 0, 0.37, mat=iron, seg=20, name='hub')
    o['cap'] = P.cyl(0.05, 0.03, 0, 0, 0.44, mat='steel_bare', seg=16, bevel=0.0, name='cap')
    return o


def arm(P, arm_mat, length=ARM_LENGTH, fast=False):
    """The boom, pointing north from the shoulder pivot at (0, 0, SHOULDER)."""
    z = SHOULDER
    o = {}
    # the boom is wide enough (0.20 m, 13 px at High) for its colour to survive the 3-px silhouette line
    o['knuckle'] = P.cyl(0.10, 0.10, 0, 0, z - 0.05, mat='steel_dark', seg=20, name='knuckle')
    o['boom'] = P.taper_box(0.20, length - 0.10, 0.07, 0.72, 1.0, 0, (length - 0.10) / 2 + 0.05, z - 0.035,
                            mat=arm_mat, bevel=0.015, name='boom')
    o['wristpin'] = P.cyl(0.05, 0.09, 0, length, z - 0.045, mat='steel_dark', seg=14, name='wristpin')
    if fast:
        o['cable'] = P.tube([(0.05, 0.10, z + 0.04), (0.05, length - 0.12, z + 0.04)], 0.012, 'steel_bare', seg=6,
                            name='cable')
    return o


def hand(P, closed):
    """The gripper at the wrist (the origin), fingers outward (north)."""
    o = {}
    o['wrist'] = P.box(0.18, 0.11, 0.07, 0, 0.0, -0.035, mat='steel_dark', bevel=0.015, name='wrist')
    spread = 0.035 if closed else 0.085
    for k, sx in enumerate((-1, 1)):
        o[f'finger{k}'] = P.box(0.035, 0.15, 0.05, sx * spread, 0.11, -0.03, mat='steel_bare', bevel=0.008,
                                rot=(0, 0, sx * (0.0 if closed else -0.18)), name=f'finger{k}')
        o[f'tip{k}'] = P.box(0.05, 0.035, 0.05, sx * (spread - 0.008), 0.18, -0.03, mat='steel_bare', bevel=0.008,
                             name=f'tip{k}')
    return o
