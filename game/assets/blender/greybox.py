"""Greybox model (10 §9.2 "Placeholders"): an entity's footprint as a bevelled box in its family's colour, at its
modelled height, drawn by the full Survey pipeline so a missing model never breaks the picture.

One image per footprint orientation: a square footprint is drawn once for every direction, a non-square one twice
(north-south and east-west, 10 §15.7's two-way map), because greyboxes ship in `core` for every entity of the data
and four directions of the large ones would fill most of core's download (measured: 68 % of core's colour cells).
A rotation shows through the renderer's alt-mode arrows, not the placeholder. setup(params) configures the module
from greybox_table.params(entity) before rendering.

A greybox is total: every Direction value 0-15 has a picture (a two-way greybox maps the values nearer east-west to
its east-west image, the rest to its north-south one), because it is what the renderer draws for another set's
impossible combinations (10 §15.7) and has nothing to fall back to itself."""

# a placeholder's box shadow is hard-edged and hatched, so 16 samples do (real art keeps 64)
META = dict(kind='entity', size=(1, 1), height=1.0, dirs=[8], states=['working'], margin=0.4, ink='machine',
            shadow_samples=16)
PARAMS = {}


def setup(params):
    PARAMS.clear()
    PARAMS.update(params)
    w, h = params['size']
    two_way = params['rotatable'] and w != h
    # total: every other value to the image of the axis it is nearer (ties, the diagonals, to north-south)
    alias = {v: (4 if v % 8 in (3, 4, 5) else 0) for v in range(16) if v not in (0, 4)} if two_way else {}
    META.update(size=tuple(params['size']), height=params['height'],
                dirs=[0, 4] if two_way else [8], dir_alias=alias,
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
