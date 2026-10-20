"""Contract example: a layered entity that exercises what M0's art does not (test/assets/examples.py checks it).

A 2 x 2 bench in two directions (north and east) with three animated layers of 8 frames:
  layer 0  a spoked wheel, turning;
  layer 1  a lamp (an emitter material) that slides along the bench: its light moves, so the light is rendered
           per frame and the manifest marks the set animLight (10 §9.1 step 7; codex C6-r1 finding 4);
  layer 2  a flag at the far east end, waving.
Facing north the lamp runs next to the wheel, so layers 0 and 1 intersect and merge; facing east they are apart,
yet they must share the merged slot there too (one slot structure for every direction; finding 5), while the flag
keeps a slot of its own: two slots in both directions. The shadow follows the animation (anim_shadow)."""

import math

# two-way like the steam engine, and total: every other direction value draws the picture of the nearer axis
META = dict(kind='entity', size=(2, 2), height=1.3, dirs=[0, 4],
            dir_alias={v: (4 if v % 8 in (3, 4, 5) else 0) for v in range(16) if v not in (0, 4)},
            states=['working', 'idle'],
            layers=[dict(parts=['wheel'], frames=8), dict(parts=['lamp'], frames=8), dict(parts=['flag'], frames=8)],
            light=True, anim_shadow=True, margin=0.4, ink='machine', shadow_samples=16)
WHEEL_R = 0.24
# per direction: the wheel's axle x and the lamp's rest x (facing north the lamp runs beside the wheel)
LAYOUT = {0: (-0.40, -0.02), 4: (-0.55, 0.40)}


def build(P, dir=0, variant=0, state='working'):
    wx, lx = LAYOUT[dir]
    o = {}
    o['bench'] = P.box(1.80, 0.70, 0.55, 0.0, 0.0, 0.0, mat='enamel_blue', bevel=0.02, name='bench')
    o['rail'] = P.box(1.40, 0.06, 0.04, 0.0, -0.20, 0.55, mat='steel_bare', bevel=0.0, name='rail')
    rim = P.torus(WHEEL_R - 0.02, 0.022, wx, -0.38, 0.85, mat='steel_bare', seg=32, seg_minor=8, axis='Y',
                  name='rim')
    spokes = [P.box(2 * WHEEL_R - 0.04, 0.025, 0.03, wx, -0.38, 0.835, mat='steel_dark', bevel=0.0,
                    rot=(0, k * math.pi / 3, 0), name='spoke') for k in range(3)]
    wheel = P.join([rim] + spokes, 'wheel')
    P.pivot(wheel, (wx, -0.38, 0.85))
    o['wheel'] = wheel
    o['lamp'] = P.sphere(0.06, lx, -0.20, 0.65, mat='lamp' if state == 'working' else 'glass_dark', seg=12,
                         name='lamp')
    o['mast'] = P.cyl(0.02, 0.75, 0.80, 0.20, 0.55, mat='steel_dark', seg=8, bevel=0.0, name='mast')
    flag = P.box(0.22, 0.01, 0.14, 0.91, 0.20, 1.12, mat='brass', bevel=0.0, name='flag')
    P.pivot(flag, (0.80, 0.20, 1.19))
    o['flag'] = flag
    return o


def pose(parts, layer, frame):
    t = (frame % 8) / 8.0
    if layer == 0:
        parts['wheel'].rotation_euler = (0.0, -2 * math.pi * t / 3, 0.0)      # a third of a turn: 3 spokes repeat
    elif layer == 1:
        parts['lamp'].location = (0.12 * math.sin(2 * math.pi * t), 0.0, 0.0)
    elif layer == 2:
        parts['flag'].rotation_euler = (0.0, 0.0, 0.35 * math.sin(2 * math.pi * t))
    else:
        raise ValueError(layer)
