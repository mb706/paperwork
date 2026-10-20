"""The M0 preview scene: what the renderer will draw from this build, emulated (emulate.py) for review.

    gamedev-python game/scripts/assets/preview.py [--zoom 1] [--dpr 1] [--night 0] [--out file.png]

The scene uses only this build's sets through the manifest's drawing programs (manifest.py), in 10 §6.2's layer
order: terrain (with 10 §9.9's edges and water-lining), the ground layer (resource tiles, belts), the shadow pass
(MAX into one target, hatched, §9.8), objects sorted by their bottom edge, the high layer (inserter arms and held
items), then the lights (a warm stain by day; the cyanotype at night). Every page is decoded from its KTX2 file.
"""

import argparse
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import emulate as E  # noqa: E402
import manifest as MF  # noqa: E402

QC = os.path.join(K.CACHE, 'qc')
VIEW = (-15.0, -9.0, 30.0, 17.0)       # world rectangle x0, y0, w, h in tiles


def tilemap(names):
    x0, y0, w, h = VIEW
    tw, th = int(w) + 2, int(h) + 2
    idx = {n: i for i, n in enumerate(names)}
    t = np.full((th, tw), idx.get('grass', 0), np.int32)
    for j in range(th):
        for i in range(tw):
            x, y = x0 - 1 + i + 0.5, y0 - 1 + j + 0.5
            if (x + 9.5) ** 2 / 26 + (y - 3.5) ** 2 / 12 < 1:
                t[j, i] = idx['dirt']
            if (x + 11) ** 2 / 16 + (y + 5) ** 2 / 9 < 1:
                t[j, i] = idx['water']
            if (x + 11.5) ** 2 / 5 + (y + 5.5) ** 2 / 3 < 1:
                t[j, i] = idx['deep-water']
            if 'sand' in idx and (x + 11) ** 2 / 26 + (y + 5) ** 2 / 17 < 1 and t[j, i] == idx['grass']:
                t[j, i] = idx['sand']
            if x > 12.0:
                t[j, i] = idx['out-of-map']
    return t, x0 - 1, y0 - 1


def build_scene(man):
    """Draw calls: (layer, sort y, x, kind, args)."""
    calls = []
    sets = man['sets']
    # the iron-ore patch: bands fall off from its centre
    if 'resource/iron-ore-patch' in sets:
        for ty in range(1, 7):
            for tx in range(-13, -5):
                d = math.hypot((tx + 9.5) / 3.6, (ty - 3.5) / 2.2)
                if d < 1.0:
                    band = int(max(0, min(7, round(7 * (1.15 - d)))))
                    calls.append(('ground', ty, tx, 'resource', dict(tx=tx, ty=ty, band=band)))
    # a belt loop: east along y = 0, up and back west along y = -2, fed and ending with caps
    belt = 'entity/transport-belt'
    if belt in sets:
        E_, N_, W_ = 4, 0, 12
        cells = []
        for x in range(-3, 3):
            cells.append((x, 0, E_, 1 | 8 if x > -3 else 8))              # east; the first one has no input
        cells.append((3, 0, N_, 2 | 8))                                    # fed from the left (west): a curve north
        cells.append((3, -1, N_, 1 | 8))
        cells.append((3, -2, W_, 4 | 8))                                   # fed from the right: curve west
        for x in range(2, -3, -1):
            cells.append((x, -2, W_, 1 | (8 if x > -2 else 0)))            # the last one ends in a cap
        for x, y, d, mask in cells:
            calls.append(('ground', y, x, 'entity', dict(set=belt, x2=2 * x + 1, y2=2 * y + 1, dir=d, variant=mask)))
    for name, (x, y) in (('entity/iron-chest', (-1, -4)), ('entity/iron-chest', (0, -4)),
                         ('greybox/iron-chest', (1, -4))):
        if name in sets:
            calls.append(('object', y, x, 'entity', dict(set=name, x2=2 * x + 1, y2=2 * y + 1, dir=0)))
    kp = 'entity/keypunch'
    if kp in sets:
        calls.append(('object', -5, 6, 'entity', dict(set=kp, x2=14, y2=-8, dir=8,
                                                      dyn=dict(state=1, phase=20000, light=255))))
        calls.append(('object', -5, 9, 'entity', dict(set=kp, x2=20, y2=-8, dir=8, dyn=dict(state=0, phase=0, light=0))))
    for name, (x, y, d, theta, ext, held) in (
            ('entity/inserter', (-1, -3, 0, 0.0, 1.0, 1)), ('entity/inserter', (1, -3, 0, 0.5, 1.0, 0xFFFF)),
            ('entity/burner-inserter', (5, -1, 4, 0.25, 0.9, 2)), ('entity/inserter', (7, -1, 8, 0.375, 1.1, 0xFFFF))):
        if name in sets:
            calls.append(('object', y, x, 'inserter', dict(set=name, x2=2 * x + 1, y2=2 * y + 1, dir=d,
                                                           theta=int(theta * 65536) % 65536, ext=int(ext * 4096),
                                                           held=held)))
    # greyboxes of a few entities in a row
    gx = -12
    for g in ('greybox/assembling-machine-1', 'greybox/stone-furnace', 'greybox/offshore-pump',
              'greybox/small-electric-pole', 'greybox/transport-belt', 'greybox/steam-engine'):
        if g in sets:
            w, h = sets[g]['size']
            calls.append(('object', 6 + h / 2, gx + w / 2, 'entity', dict(set=g, x2=2 * gx + w, y2=12 + h, dir=8)))
            gx += w + 1
    ch = 'mover/character'
    if ch in sets:
        for x, y, o, clip, fr in ((-3.5, -3.5, 4, 'idle', 0), (8.5, 2.5, 2, 'run', 5), (-6.5, 3.4, 6, 'mine', 7),
                                  (2.5, 3.5, 3, 'run', 9), (10.5, -1.5, 0, 'idle', 1)):
            calls.append(('object', y, x, 'mover', dict(x=int(x * 256), y=int(y * 256), o=o, clip=clip, f=fr)))
    return calls


def mover_draws(man, a, cam):
    clip = a['clip']
    vx = 0 if clip != 'run' else 1
    p = man['sets']['mover/character']['parts'][clip]
    n = p['shape'][1]
    seconds = a['f'] / p.get('fps', 16)
    distance = a['f'] / n * p.get('cycleTiles', 1)
    return MF.draw_mover(man, 'mover/character', dict(x=a['x'], y=a['y'], vx=vx, vy=0, flags=1 if clip == 'mine' else 0,
                                                      orientation=a['o'] * 65536 // 8, distance=distance,
                                                      seconds=seconds), cam)


def frame(man, zoom, dpr, night=0.0):
    x0, y0, w, h = VIEW
    cam = dict(cx=x0 + w / 2, cy=y0 + h / 2, zoom=zoom, dpr=dpr)
    S = MF.scale(cam)
    W, H = int(w * S), int(h * S)
    em = E.Emulator(man)
    pj = K.load_json(os.path.join(K.PUBLIC, 'data', 'prototypes.json'))
    names = [t['name'] for t in pj['tile']]
    tm, tx0, ty0 = tilemap(names)
    mats = {n: K.read_png(os.path.join(K.CACHE, 'terrain', f'{n}.png'))[..., :3] for n in names}
    colour = E.terrain(tm, names, mats, cam, tx0, ty0, W + 2 * int(S), H + 2 * int(S))[int(S):int(S) + H, int(S):int(S) + W]
    ox, oy = W / 2, H / 2
    calls = build_scene(man)
    draws = []                                            # (layer, sort key, draws)
    for layer, sy, sx, kind, a in calls:
        if kind == 'resource':
            ds = MF.draw_resource(man, 'resource/iron-ore-patch', a, cam)
        elif kind == 'entity':
            v = dict(x2=a['x2'], y2=a['y2'], dir=a['dir'], variant=a.get('variant', 0), dyn=a.get('dyn'))
            ds = MF.draw_entity(man, a['set'], v, cam, tick=7, belt_speed=8)
        elif kind == 'inserter':
            ds = MF.draw_inserter(man, a['set'], a, cam)
        else:
            ds = mover_draws(man, a, cam)
        draws.append((layer, sy, sx, ds))

    def blit_list(d, target, op):
        for f, q in zip(d['frames'], d['quads']):
            em.blit(target, f, ox + q[0], oy + q[1], q[2] / man['frames'][f][4], op=op, alpha=d.get('alpha', 1.0))

    def rot(d, target, op):
        f = d['frames'][0]
        k = d['scale']
        if d['part'].startswith('arm'):
            # the arm is stretched along its length: emulate by scaling k along the arm (approximately: uniform)
            pass
        em.blit(target, f, 0, 0, k, op=op, rotate=d['rotation_turns'],
                pivot=((d['pivot'][0], d['pivot'][1]), (ox + d['at'][0], oy + d['at'][1])))

    rgba = np.concatenate([colour, np.ones((H, W, 1), np.float32)], -1)
    shadow = np.zeros((H, W, 1), np.float32)
    light = np.zeros((H, W, 3), np.float32)
    # 2: ground layer (colour parts of ground draws)
    for layer, _, _, ds in sorted([d for d in draws if d[0] == 'ground'], key=lambda d: (d[1], d[2])):
        for d in ds:
            if d.get('passes', ['colour'])[0] == 'colour':
                blit_list(d, rgba, 'over')
    # 3: every shadow into one target (MAX), hatched over the ground
    for layer, _, _, ds in draws:
        for d in ds:
            if 'rotation_turns' in d:
                if d['pass'] == 'shadow':
                    rot(d, shadow, 'max')
            elif d.get('passes', ['colour'])[0] == 'shadow':
                blit_list(d, shadow, 'max')
    rgba[..., :3] = E.hatch_shadows(rgba[..., :3], shadow, cam, x0, y0)
    # 4: objects, sorted by their bottom edge
    for layer, _, _, ds in sorted([d for d in draws if d[0] == 'object'], key=lambda d: (d[1], d[2])):
        for d in ds:
            if 'rotation_turns' in d or d.get('part') == 'held':
                continue
            p = d.get('passes', ['colour'])[0]
            if p == 'colour':
                blit_list(d, rgba, 'over')
            elif p == 'light':
                blit_list(d, light, 'add')
    # 5: high: inserter arms, hands and held items
    for layer, _, _, ds in draws:
        for d in ds:
            if 'rotation_turns' in d and d['pass'] == 'colour':
                rot(d, rgba, 'over')
            elif d.get('part') == 'held':
                items = sorted(n for n in man['sets'] if n.startswith('item/'))
                name = items[d['item'] % len(items)] if items else 'fx/missing'
                for dd in MF.draw_icon(man, name, (d['at'][0] / MF.scale(cam) + cam['cx'],
                                                   d['at'][1] / MF.scale(cam) + cam['cy']), cam, d['size_tiles']):
                    for f, q in zip(dd['frames'], dd['quads']):
                        em.blit(rgba, f, ox + q[0], oy + q[1], q[2] / man['frames'][f][4], op='over')
    # 7: lights and the night grade
    out = E.light_composite(rgba[..., :3], light, night)
    return np.clip(out, 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zoom', type=float, default=1.0)
    ap.add_argument('--dpr', type=float, default=1.0)
    ap.add_argument('--night', type=float, default=0.0)
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    man = K.load_json(os.path.join(K.PUBLIC, 'atlases', 'sprites.json'))
    img = frame(man, a.zoom, a.dpr, a.night)
    os.makedirs(QC, exist_ok=True)
    out = a.out or os.path.join(QC, f'preview-z{a.zoom:g}-dpr{a.dpr:g}{"-night" if a.night else ""}.png')
    Image.fromarray(K.to8(img)).save(out)
    print(f'[qc] {out} {img.shape[1]}x{img.shape[0]}', flush=True)


if __name__ == '__main__':
    main()
