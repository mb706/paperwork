"""Greybox model (10 §9.2 "Placeholders"): an entity's footprint as a bevelled box in its family's colour, at its
modelled height, drawn by the full Survey pipeline so a missing model never breaks the picture.

One image per footprint orientation: a square footprint is drawn once for every direction, a non-square one twice
(north-south and east-west, 10 §15.7's two-way map), because greyboxes ship in `core` for every entity of the data
and four directions of the large ones would fill most of core's download (measured: 68 % of core's colour cells).
A rotation shows through the renderer's alt-mode arrows, not the placeholder. setup(params) configures the module
from greybox_table.params(entity) before rendering."""

# a placeholder's box shadow is hard-edged and hatched, so 16 samples do (real art keeps 64)
META = dict(kind='entity', size=(1, 1), height=1.0, dirs=[8], states=['working'], margin=0.4, ink='machine',
            shadow_samples=16)
PARAMS = {}


def setup(params):
    PARAMS.clear()
    PARAMS.update(params)
    w, h = params['size']
    two_way = params['rotatable'] and w != h
    META.update(size=tuple(params['size']), height=params['height'],
                dirs=[0, 4] if two_way else [8], dir_alias={8: 0, 12: 4} if two_way else {},
                margin=0.4 if params['height'] < 2.5 else 0.5, rotate_footprint=w != h)


def build(P, dir=8, variant=0, state='working'):
    w, h = PARAMS['size']
    if dir % 8 == 4 and w != h:
        w, h = h, w
    H = PARAMS['height']
    inset = 0.06 if min(w, h) > 1 else 0.08
    o = {}
    o['body'] = P.box(w - 2 * inset, h - 2 * inset, H, 0, 0, 0.0, mat=PARAMS['family'], bevel=0.035, name='body')
    o['plinth'] = P.box(w - 2 * inset + 0.04, h - 2 * inset + 0.04, min(0.06, H * 0.25), 0, 0, 0.0,
                        mat='cast_iron', bevel=0.01, name='plinth')
    return o
