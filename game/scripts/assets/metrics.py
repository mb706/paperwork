"""Legibility metrics (A3 §7, §3.2; 10 §9.5 #4), measured on the encoded icons and sprites, as the GPU sees them.

    gamedev-python game/scripts/assets/metrics.py

1. The belt line-up: every icon at 32 and 16 px on the belt deck (#6e6a64), qc/belt-lineup.png.
2. Confusability: each icon at 32 px on the deck, reduced to 8 x 8 CIELAB thumbnails; the mean Euclidean distance over
   the 64 cells for every pair, under normal vision, deuteranopia and protanopia (Machado, Oliveira & Fernandes
   2009, severity 1, in linear RGB). Pairs closer than 7 are flagged for review (07 §23 rule 6).
3. The lightness split (A3 §3.2): an information item's paper body at L* >= 84, a matter item's at <= 74 except
   quartz (07 §23 rule 5); same-hue pairs (hue angles within 30 degrees) of information and matter at least 20 L*
   apart. The body tone is the 70th percentile of L* over the icon's opaque pixels (ink lines and hatching fall
   below it).
4. Figure-ground: machines 25-60 % darker than the paper (Weber contrast of the sprite's mean L* to the paper's).
Writes qc/metrics.json; a failed rule is reported, not fatal (it is a review aid; checks.py gates the build).
"""

import itertools
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import emulate as E  # noqa: E402

QC = os.path.join(K.CACHE, 'qc')
DECK = K.hexc('#6e6a64')
INFO = {'records', 'token', 'memo', 'report'}
EXEMPT = {'quartz'}
CVD = {
    'deuteranopia': np.array([[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413],
                              [-0.011820, 0.042940, 0.968881]]),
    'protanopia': np.array([[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216],
                            [-0.003882, -0.048116, 1.051998]]),
}
MACHINES = ('entity/keypunch', 'entity/iron-chest', 'entity/inserter', 'entity/burner-inserter')


def simulate(rgb, kind):
    if kind == 'normal':
        return rgb
    return K.lin2srgb(K.srgb2lin(np.clip(rgb, 0, 1)) @ CVD[kind].T)


def icon_on(em, fid, size, bg):
    canvas = np.ones((size, size, 4), np.float32)
    canvas[..., :3] = bg
    em.blit(canvas, fid, 0, 0, size / 64.0)
    return canvas[..., :3]


def main():
    man = K.load_json(os.path.join(K.PUBLIC, 'atlases', 'sprites.json'))
    em = E.Emulator(man)
    icons = {n.split('/', 1)[1]: s['parts']['icon']['table'][0][0] for n, s in sorted(man['sets'].items())
             if n.startswith('item/')}
    out = dict(items=sorted(icons))
    # 1. the belt line-up
    rows = []
    for size in (32, 16):
        strip = np.ones((size + 8, len(icons) * (size + 4) + 4, 3), np.float32) * DECK
        for i, fid in enumerate(icons.values()):
            strip[4:4 + size, 4 + i * (size + 4):4 + i * (size + 4) + size] = icon_on(em, fid, size, DECK)
        rows.append(np.repeat(np.repeat(strip, 2, 0), 2, 1))
    W = max(r.shape[1] for r in rows)
    sheet = np.ones((sum(r.shape[0] for r in rows) + 8, W, 3), np.float32) * 0.1
    y = 0
    for r in rows:
        sheet[y:y + r.shape[0], :r.shape[1]] = r
        y += r.shape[0] + 8
    os.makedirs(QC, exist_ok=True)
    Image.fromarray(K.to8(sheet)).save(os.path.join(QC, 'belt-lineup.png'))
    # 2. confusability
    thumbs = {n: icon_on(em, f, 32, DECK) for n, f in icons.items()}
    out['confusability'] = {}
    flags = []
    for vision in ('normal', 'deuteranopia', 'protanopia'):
        lab = {n: K.lab(K.box_down(np.concatenate([simulate(t, vision), np.ones((32, 32, 1), np.float32)], -1), 4)
                        [..., :3]) for n, t in thumbs.items()}
        pairs = sorted((float(np.linalg.norm(lab[a] - lab[b], axis=-1).mean()), a, b)
                       for a, b in itertools.combinations(sorted(lab), 2))
        info = [n for n in lab if n in INFO]
        mat = [n for n in lab if n not in INFO]
        means = {n: lab[n].reshape(-1, 3).mean(0) for n in lab}
        entry = dict(closest=[(round(d, 1), a, b) for d, a, b in pairs[:6]])
        if info and mat:
            mi = np.mean([means[n] for n in info], 0)
            mm = np.mean([means[n] for n in mat], 0)
            cross = min((float(np.linalg.norm(lab[a] - lab[b], axis=-1).mean()), a, b) for a in info for b in mat)
            entry.update(group_L=dict(info=round(float(mi[0]), 1), matter=round(float(mm[0]), 1)),
                         closest_cross=(round(cross[0], 1), cross[1], cross[2]))
        out['confusability'][vision] = entry
        flags += [f'{vision}: {a} / {b} at {d:.1f}' for d, a, b in pairs if d < 7.0]
    out['flagged_pairs'] = flags
    # 3. the lightness split, on the 64 px icons over the paper's absence (opaque pixels only)
    bodies = {}
    for n, fid in icons.items():
        canvas = np.zeros((64, 64, 4), np.float32)
        em.blit(canvas, fid, 0, 0, 1.0)
        op = canvas[..., 3] > 0.95
        if not op.any():
            continue
        rgb = canvas[..., :3][op] / canvas[..., 3:4][op]
        L = K.lab(rgb)
        hue = float(np.degrees(np.arctan2(np.median(L[:, 2]), np.median(L[:, 1]))) % 360)
        bodies[n] = dict(L=round(float(np.percentile(L[:, 0], 70)), 1), hue=round(hue, 1),
                         chroma=round(float(np.hypot(np.median(L[:, 1]), np.median(L[:, 2]))), 1))
    out['bodies'] = bodies
    rules = []
    for n, b in bodies.items():
        if n in INFO and b['L'] < 84:
            rules.append(f'{n}: an information item\'s body at L* {b["L"]} < 84')
        if n not in INFO and n not in EXEMPT and b['L'] > 74:
            rules.append(f'{n}: a matter item\'s body at L* {b["L"]} > 74')
    for a in bodies:
        for b in bodies:
            if a in INFO and b not in INFO and b not in EXEMPT:
                dh = abs((bodies[a]['hue'] - bodies[b]['hue'] + 180) % 360 - 180)
                if dh < 30 and min(bodies[a]['chroma'], bodies[b]['chroma']) > 8 and abs(bodies[a]['L'] - bodies[b]['L']) < 20:
                    rules.append(f'{a} / {b}: same hue, only {abs(bodies[a]["L"] - bodies[b]["L"]):.1f} L* apart')
    out['lightness_rules'] = rules
    # 4. figure-ground: machines against the paper
    paper_L = float(K.lab(K.hexc(K.PAPER_HEX))[0])
    fg = {}
    for name in MACHINES:
        s = man['sets'].get(name)
        if not s:
            continue
        part = s['parts'].get('base') or s['parts'].get('platform')
        ids = [f for e in part['table'] for f in e][:4]
        Ls, ws = [], []
        for fid in ids:
            a, layer, x, y, w, h, ax, ay = man['frames'][fid]
            page = em.page(a, layer, 0)
            px = page[y:y + h, x:x + w]
            op = px[..., 3] > 0.9
            if op.any():
                Ls.append(K.lab(px[..., :3][op] / px[..., 3:4][op])[:, 0].mean())
                ws.append(op.sum())
        if Ls:
            L = float(np.average(Ls, weights=ws))
            fg[name] = round((L - paper_L) / paper_L, 3)
    out['figure_ground_weber'] = fg
    out['figure_ground_out_of_range'] = [n for n, v in fg.items() if not -0.60 <= v <= -0.25]
    K.dump_json(os.path.join(QC, 'metrics.json'), out)
    n = out['confusability']['normal']
    print(f'[metrics] closest pairs (normal): {n["closest"][:3]}; info/matter L* {n.get("group_L")}; '
          f'{len(flags)} pair(s) < 7; lightness rules broken: {len(rules)}; figure-ground {fg}', flush=True)
    _ = json


if __name__ == '__main__':
    main()
