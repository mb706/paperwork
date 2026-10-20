"""Greybox model (10 §9.2 "Placeholders"): an entity's footprint as a bevelled box in its family's colour, at its
modelled height, drawn by the full Survey pipeline so a missing model never breaks the picture. A rotatable
entity gets a dark stripe along the front edge of its top face (the edge its Direction points to) and four
directions. setup(params) configures the module from greybox_table.params(entity) before rendering."""

import math

META = dict(kind='entity', size=(1, 1), height=1.0, dirs=[8], states=['working'], margin=0.4, ink='machine')
PARAMS = {}


def setup(params):
    PARAMS.clear()
    PARAMS.update(params)
    w, h = params['size']
    META.update(size=tuple(params['size']), height=params['height'],
                dirs=[0, 4, 8, 12] if params['rotatable'] else [8],
                margin=0.4 if params['height'] < 2.5 else 0.5,
                rotate_footprint=w != h)


def build(P, dir=8, variant=0, state='working'):
    w, h = PARAMS['size']
    if dir % 8 == 4 and w != h:
        w, h = h, w
    H = PARAMS['height']
    inset = 0.06 if min(w, h) > 1 else 0.08
    o = {}
    o['body'] = P.box(w - 2 * inset, h - 2 * inset, H, 0, 0, 0.0, mat=PARAMS['family'], bevel=0.035,
                      name='body')
    o['plinth'] = P.box(w - 2 * inset + 0.04, h - 2 * inset + 0.04, min(0.06, H * 0.25), 0, 0, 0.0,
                        mat='cast_iron', bevel=0.01, name='plinth')
    if PARAMS['rotatable']:
        # the front stripe: along the top face's edge toward the facing direction
        t = min(0.14, 0.18 * min(w, h))
        bearing = dir * 22.5
        bx, by = math.sin(math.radians(bearing)), math.cos(math.radians(bearing))
        if abs(bx) > abs(by):
            sx, sy, cx, cy = t, h - 2 * inset - 0.04, bx * ((w - 2 * inset) / 2 - t / 2 - 0.02), 0.0
        else:
            sx, sy, cx, cy = w - 2 * inset - 0.04, t, 0.0, by * ((h - 2 * inset) / 2 - t / 2 - 0.02)
        o['front'] = P.box(sx, sy, 0.02, cx, cy, H, mat='cast_iron', bevel=0.0, name='front')
    return o
