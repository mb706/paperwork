"""Legibility metrics for a style (07 §23 rule 6, 10 §9.5 #3), so the critique is measured.

    gamedev-python design/art/proto/metrics.py kodachrome

1 confusability: every icon -> 8x8 thumbnail in CIELAB over a belt-grey ground; pairwise Euclidean
  distance (mean over the 64 cells); report the closest pairs. 07 §23 asks that pairs below a
  threshold be flagged; we report distances so a threshold can be set.
2 matter vs information: mean Lab colour of each item group as it sits on a belt (alpha-weighted
  over the belt deck), the distance between the group means, and the smallest cross-group pair
  distance, under normal vision and simulated deuteranopia and protanopia (Machado et al. 2009,
  severity 1).
3 figure-ground: mean luminance contrast (Weber) of machine sprites against the grass material.
"""

import glob
import itertools
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import post  # noqa: E402
import scene  # noqa: E402
import terrain as T  # noqa: E402

INFO = ['records', 'token', 'memo', 'report']
MATTER = ['iron-ore', 'copper-ore', 'coal', 'quartz', 'iron-plate', 'copper-plate', 'iron-gear-wheel', 'copper-cable',
          'logic-board', 'wood']

# Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB
CVD = {
    'deuteranopia': np.array([[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413],
                              [-0.011820, 0.042940, 0.968881]]),
    'protanopia': np.array([[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216],
                            [-0.003882, -0.048116, 1.051998]]),
}


def srgb2lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def to_lab(rgb):
    lin = srgb2lin(np.clip(rgb, 0, 1))
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)


def simulate(rgb, kind):
    if kind == 'normal':
        return rgb
    lin = srgb2lin(np.clip(rgb, 0, 1))
    return lin2srgb(lin @ CVD[kind].T)


def thumb(style, item, ground):
    ic = scene.icon(style, item, 32)
    g = np.ones((32, 32, 3), np.float32) * ground
    scene.blit(g, ic, 0, 0)
    return post.resize(g, 8 / 32)


def main():
    st = sys.argv[1]
    ground = post.hexc('#3a3734')
    items = sorted(os.path.basename(f).split('.')[0] for f in glob.glob(os.path.join(scene.SPRITES, st, 'icons',
                                                                                     '*.colour.png')))
    items = [i for i in items if i in INFO + MATTER]
    out = dict(style=st)
    for vision in ('normal', 'deuteranopia', 'protanopia'):
        th = {i: to_lab(simulate(thumb(st, i, ground), vision)) for i in items}
        pairs = []
        for a, b in itertools.combinations(items, 2):
            d = float(np.linalg.norm(th[a] - th[b], axis=-1).mean())
            pairs.append((d, a, b))
        pairs.sort()
        means = {i: th[i].reshape(-1, 3).mean(0) for i in items}
        info = [i for i in items if i in INFO]
        mat = [i for i in items if i in MATTER]
        mi = np.mean([means[i] for i in info], 0)
        mm = np.mean([means[i] for i in mat], 0)
        cross = min((float(np.linalg.norm(means[a] - means[b])), a, b) for a in info for b in mat)
        out[vision] = dict(closest_pairs=[(round(d, 1), a, b) for d, a, b in pairs[:5]],
                           group_mean_L=dict(info=round(float(mi[0]), 1), matter=round(float(mm[0]), 1)),
                           group_distance=round(float(np.linalg.norm(mi - mm)), 1),
                           closest_cross_group=(round(cross[0], 1), cross[1], cross[2]))
    # figure-ground: machines vs grass
    grass = T.materials(st, 32, tiles=['grass'])['grass'].reshape(-1, 3)
    gl = to_lab(grass.mean(0))[0]
    cons = {}
    for eid in ('assembling-machine-1', 'keypunch', 'seminar', 'stone-furnace', 'electric-mining-drill', 'transport-belt'):
        mp = os.path.join(scene.SPRITES, st, eid, 'manifest.json')
        if not os.path.exists(mp):
            continue
        stem = sorted(json.load(open(mp)))[0]
        spr = scene.sprite(st, eid, stem, 32)
        if spr is None:
            continue
        a = spr['rgba'][..., 3] > 0.5
        L = to_lab(spr['rgba'][..., :3][a].mean(0))[0]
        cons[eid] = round(float((L - gl) / max(gl, 1)), 2)
    out['figure_ground_weber'] = cons
    out['grass_L'] = round(float(gl), 1)
    print(json.dumps(out, indent=1))
    os.makedirs(os.path.join(HERE, '..', 'out', 'metrics'), exist_ok=True)
    json.dump(out, open(os.path.join(HERE, '..', 'out', 'metrics', f'{st}.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
