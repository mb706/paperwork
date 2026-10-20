"""keypunch (2x2): items.yaml 'desk-sized keypunch, card hopper on top, cream and steel-blue'; entities.yaml
'Transcribes records into tokens, one card at a time. Burns fuel.' A cream keypunch on a steel-blue desk with a
card hopper (right) and a stacker (left); because it burns fuel, a small cast-iron stove-engine stands at the back
left and drives the machine by a belt from a spoked flywheel in front of it, its door glowing while it works
(A3 §6).

Animation (16 frames, seamless; A3 §9's 3 % rule: A3's prototype moved 0.5 %, so the moving parts are enlarged):
layer 0 is the stove-engine's spoked flywheel and crank (0.5 m across: the part of at least 0.3 tile); layer 1 is
the card bed: three cards in flight from the hopper to the stacker, the punch head stamping, and the keys typing.
The working state lights the stove door and the pilot lamp (the light pass) and smokes from the stovepipe (smoke,
a render-time effect); the idle state is dark and still (A3 §8)."""

import math

META = dict(
    kind='entity',
    size=(2, 2),
    height=1.66,
    dirs=[8],
    states=['working', 'idle'],
    layers=[dict(parts=['flywheel', 'crank'], frames=16),
            dict(parts=['card0', 'card1', 'card2', 'punch'] + [f'key{i:02d}' for i in range(27)], frames=16)],
    light=True,
    smoke=[(-0.72, 0.54, 1.64)],
    margin=0.5,
    ink='machine',
)

DX = 0.18                     # the desk sits east of centre, leaving the burner room at the back left
STOVE = (-0.66, 0.46)
FLY = (-0.70, 0.18, 0.86)     # the flywheel's axle (x, y, z): in front of the stove, facing south
FLY_R = 0.24
CARD_Y, CARD_Z = 0.10, 1.10
CARD_X0, CARD_X1 = DX + 0.50, DX - 0.44


def build(P, dir=8, variant=0, state='working'):
    working = state == 'working'
    o = {}
    o['floor'] = P.box(1.90, 1.86, 0.03, 0, 0, 0.0, mat='concrete', bevel=0.01, name='floor')
    feet = []
    for x in (-0.56 + DX, 0.70 + DX):
        for y in (-0.36, 0.62):
            feet.append(P.box(0.08, 0.08, 0.06, x, y, 0.04, mat='cast_iron', bevel=0.01, name='foot'))
    o['feet'] = P.join(feet, 'feet')
    o['cabinet'] = P.box(1.40, 1.10, 0.64, DX + 0.07, 0.13, 0.10, mat='enamel_blue', bevel=0.03, name='cabinet')
    o['kick'] = P.box(0.52, 0.02, 0.40, DX - 0.20, -0.43, 0.20, mat='steel_dark', bevel=0.0, name='kick')
    o['drawer'] = P.box(0.40, 0.02, 0.10, DX + 0.42, -0.43, 0.56, mat='enamel_blue', bevel=0.01, name='drawer')
    o['pull'] = P.box(0.10, 0.02, 0.025, DX + 0.42, -0.445, 0.60, mat='brass', bevel=0.0, name='pull')
    o['top'] = P.box(1.52, 1.24, 0.05, DX + 0.07, 0.12, 0.74, mat='enamel_cream', bevel=0.015, name='top')
    o['body'] = P.wedge(1.36, 0.56, 0.30, 0.48, DX + 0.07, 0.40, 0.79, mat='enamel_cream', name='body')
    o['bed'] = P.box(1.30, 0.13, 0.05, DX + 0.07, CARD_Y, 1.04, mat='cast_iron', bevel=0.0, name='bed')
    o['plate'] = P.box(0.18, 0.02, 0.05, DX + 0.07, 0.03, 0.86, mat='brass', bevel=0.0, name='plate')
    # the punch station: a bridge over the bed, its head stamping each card as it passes
    o['bridge'] = P.box(0.08, 0.20, 0.16, DX + 0.02, CARD_Y, 1.06, mat='steel_dark', bevel=0.01, name='bridge')
    o['punch'] = P.box(0.10, 0.12, 0.05, DX + 0.02, CARD_Y - 0.01, 1.19, mat='steel_bare', bevel=0.008,
                       name='punch')
    # keyboard: sloped base and keys (each its own object: the keys type)
    kb_x, kb_y = DX + 0.18, -0.26
    o['kbbase'] = P.wedge(0.70, 0.30, 0.04, 0.10, kb_x, kb_y, 0.79, mat='enamel_cream', name='kbbase')
    i = 0
    for r in range(3):
        y = kb_y - 0.10 + r * 0.09
        z = 0.79 + 0.04 + (0.06 * (r + 0.5) / 3) + 0.005
        for c in range(9):
            x = kb_x - 0.29 + c * 0.072 + (0.03 if r == 1 else 0)
            o[f'key{i:02d}'] = P.box(0.052, 0.052, 0.03, x, y, z, mat='bakelite', bevel=0.006, name=f'key{i:02d}')
            i += 1
    # hopper with cream cards (right), stacker (left)
    o['hopper'] = P.taper_box(0.40, 0.34, 0.26, 1.12, 1.1, DX + 0.52, 0.42, 1.10, mat='enamel_blue', bevel=0.02,
                              name='hopper')
    o['cards_in'] = P.box(0.26, 0.13, 0.10, DX + 0.52, 0.42, 1.30, mat='paper_cream', bevel=0.004, name='cards_in')
    o['stacker'] = P.box(0.40, 0.30, 0.10, DX - 0.42, 0.40, 1.10, mat='enamel_blue', bevel=0.02, name='stacker')
    o['cards_out'] = P.box(0.26, 0.13, 0.06, DX - 0.42, 0.40, 1.20, mat='paper_cream', bevel=0.004,
                           name='cards_out')
    for k in range(3):
        o[f'card{k}'] = P.box(0.22, 0.10, 0.008, CARD_X0, CARD_Y, CARD_Z, mat='paper_cream', bevel=0.0,
                              name=f'card{k}')
    o['lamp'] = P.sphere(0.04, DX + 0.70, 0.13, 1.14, mat='lamp' if working else 'glass_dark', seg=12, name='lamp')
    # the burner: a stove-engine with a stovepipe, a spoked flywheel on its east side and a drive belt
    sx, sy = STOVE
    o['stove'] = P.cyl(0.22, 0.58, sx, sy, 0.04, mat='cast_iron', seg=20, name='stove')
    o['stove_top'] = P.cyl(0.25, 0.05, sx, sy, 0.60, mat='steel_dark', seg=20, name='stove_top')
    # the firebox mouth: large enough to read by day at 1x while it burns (A3 §8: lit emitters show work)
    o['door'] = P.box(0.30, 0.06, 0.26, sx, sy - 0.20, 0.10, mat='steel_dark', bevel=0.01, name='door')
    o['glow'] = P.box(0.22, 0.03, 0.16, sx, sy - 0.235, 0.14, mat='fire' if working else 'cast_iron', bevel=0.0,
                      name='glow')
    o['embers'] = P.box(0.16, 0.03, 0.05, sx, sy - 0.24, 0.12, mat='fire_dim' if working else 'cast_iron', bevel=0.0,
                        name='embers')
    o['stovepipe'] = P.cyl(0.055, 0.95, sx - 0.06, sy + 0.08, 0.65, mat='steel_dark', seg=12, name='stovepipe')
    o['pipecap'] = P.cyl(0.078, 0.06, sx - 0.06, sy + 0.08, 1.58, mat='steel_dark', seg=12, name='pipecap')
    fx, fy, fz = FLY
    # the axle's pedestal stands on the stove's top, behind the wheel, clear of the fire door
    o['bearing'] = P.box(0.08, 0.10, 0.25, fx, fy + 0.08, 0.62, mat='cast_iron', bevel=0.01, name='bearing')
    rim = P.torus(FLY_R - 0.025, 0.028, fx, fy, fz, mat='steel_bare', seg=36, seg_minor=8, axis='Y', name='rim')
    spokes = []
    for k in range(4):
        a = k * math.pi / 4
        spokes.append(P.box(2 * FLY_R - 0.05, 0.03, 0.035, fx, fy, fz - 0.0175, mat='steel_dark', bevel=0.0,
                            rot=(0, a, 0), name='spoke'))
    hub = P.cyl(0.05, 0.08, fx, fy, fz, mat='brass', axis='Y', seg=16, bevel=0.0, name='hub')
    fly = P.join([rim] + spokes + [hub], 'flywheel')
    P.pivot(fly, (fx, fy, fz))
    o['flywheel'] = fly
    crank = P.box(0.05, 0.03, FLY_R * 0.9, fx, fy - 0.07, fz, mat='brass', bevel=0.0, name='crank')
    P.pivot(crank, (fx, fy - 0.07, fz))
    o['crank'] = crank
    o['drive'] = P.tube([(fx + 0.02, fy - 0.02, fz + FLY_R * 0.55), (DX - 0.52, 0.40, 0.98)], 0.016, 'rubber', seg=6,
                        name='drive')
    return o


def pose(parts, layer, frame):
    t = (frame % 16) / 16.0
    if layer == 0:
        a = -2 * math.pi * t / 2           # half a turn per loop: the 4 spokes repeat every quarter turn
        parts['flywheel'].rotation_euler = (0.0, a, 0.0)
        parts['crank'].rotation_euler = (0.0, 2 * a, 0.0)
    elif layer == 1:
        # three cards in flight, a third of the bed apart; each slows under the punch
        for k in range(3):
            u = (t + k / 3.0) % 1.0
            x = CARD_X0 + (CARD_X1 - CARD_X0) * (u - 0.06 * math.sin(2 * math.pi * u))
            parts[f'card{k}'].location = (x - CARD_X0, 0.0, 0.0)
        # the punch stamps six times a loop
        parts['punch'].location = (0.0, 0.0, -0.035 * (0.5 + 0.5 * math.cos(2 * math.pi * 6 * t)))
        # typing: a few keys down each frame, a fixed pseudo-random sequence
        for i in range(27):
            down = ((i * 7 + frame * 5) % 27) < 3
            parts[f'key{i:02d}'].location = (0.0, 0.0, -0.012 if down else 0.0)
    else:
        raise ValueError(layer)
