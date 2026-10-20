"""Authoring example of the `object` kind (lib/contract.py; 10 §15.7's `object` program): a shrub.

Trees, rocks, decoratives and town buildings are objects: no direction, `shape` pictures that the position hash
picks from, and for trees `stage`, the leaf stages left (ObjectView.variant: 4 full down to 0 bare). The build
renders every (shape, stage) and one shadow per shape, from META's shadow_stage (default the fullest), and the
manifest gets `base` [shape, stage] and `shadow` [shape]. A model:
  * stands on its position at the origin (the anchor), metres = tiles, x east, y north, z up;
  * builds each stage from scratch: build(P, shape, stage) -> {name: object} (or a list); seeds are fixed numbers,
    never hash() (randomised per process), so renders are reproducible;
  * keeps its parts' materials in the style table (lib/style.py) and its ink weight in META['ink'].
test/assets/examples.py renders this file with the build's steps on every QC build and checks the result; copy it
into game/assets/blender/world/ (as <id>.py) to make a real set."""

import math

META = dict(kind='object', size=(1, 1), height=0.9, shapes=2, stages=5, margin=0.35, ink='decorative',
            shadow_samples=16)


def build(P, shape, stage):
    r = P.rng(4100 + 31 * shape)
    o = {}
    o['stem'] = P.cyl(0.035, 0.42, 0.0, 0.0, 0.0, mat='bark', seg=8, bevel=0.0, name='stem')
    # leaf clumps around the crown; a stage keeps the first 2 * stage of them (stage 0: the bare stem and twigs)
    clumps = []
    for k in range(8):
        a = 2 * math.pi * (k / 8 + 0.07 * shape) + r.uniform(-0.2, 0.2)
        d = r.uniform(0.10, 0.22)
        clumps.append((d * math.cos(a), d * math.sin(a), r.uniform(0.40, 0.62), r.uniform(0.11, 0.16)))
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.5 * shape
        o[f'twig{k}'] = P.tube([(0.0, 0.0, 0.36), (0.16 * math.cos(a), 0.16 * math.sin(a), 0.55)], 0.012, 'bark',
                               seg=5, name=f'twig{k}')
    for k, (x, y, z, rad) in enumerate(clumps[:2 * stage]):
        o[f'leaf{k}'] = P.blob(rad, x, y, z, mat='leaf' if k % 2 else 'leaf_dark', seed=17 * shape + k,
                               rough=0.3, name=f'leaf{k}')
    return o
