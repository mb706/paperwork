"""Contact sheets and animation GIFs (10 §9.5 #1, #2), drawn from the encoded atlases through the manifest.

    gamedev-python game/scripts/assets/contact.py [--sets name,...]

Per set, .cache/assets/qc/contact/<set>.png: its pictures on a patch of grass, by day and as the night's cyanotype,
at 1x (32 px per tile) and 1/2x: an entity's base (pieces plus the layers at frame 0) with its hatched shadow and
the light's warm stain, its idle image, its layer as a strip of frames, its shadow mask and its glow alone; a
mover's clips per orientation; a resource's shapes by bands; an object's shapes by stages; an inserter's platforms
and its arm at eight angles; an icon at 64, 32 and 16 px on paper and on the belt deck. .cache/assets/qc/contact.png puts every set together at
1x, and gifs/<set>-<part>.gif (gifski) loops each animation at 2x.
"""

import argparse
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import emulate as E  # noqa: E402
import manifest as MF  # noqa: E402

QC = os.path.join(K.CACHE, 'qc')
FONT = os.path.join(K.FONT_SRC, 'LibreFranklin-SemiBold.ttf')
DECK = K.hexc('#6e6a64')


def grass(W, H, S):
    g = K.read_png(os.path.join(K.CACHE, 'terrain', 'grass.png'))[..., :3]
    f = int(round(64 / S))
    while f > 1:
        g = K.box_down(g, 2)
        f //= 2
    reps = (H // g.shape[0] + 1, W // g.shape[1] + 1, 1)
    return np.tile(g, reps)[:H, :W].copy()


class Stage:
    """A small scene of a few tiles: draws draw-lists in 10 §6.2's order, returns day and night pictures."""

    def __init__(self, em, tiles_w, tiles_h, zoom, cx=0.0, cy=0.0):
        self.em = em
        self.cam = dict(cx=cx, cy=cy, zoom=zoom, dpr=1)
        self.S = MF.scale(self.cam)
        self.W, self.H = int(round(tiles_w * self.S)), int(round(tiles_h * self.S))
        self.rgba = np.concatenate([grass(self.W, self.H, self.S), np.ones((self.H, self.W, 1), np.float32)], -1)
        self.shadow = np.zeros((self.H, self.W, 1), np.float32)
        self.light = np.zeros((self.H, self.W, 3), np.float32)
        self.objects = []

    def add(self, draws):
        self.objects.append(draws)

    def _blit(self, d, target, op):
        man = self.em.man
        for f, q in zip(d['frames'], d['quads']):
            self.em.blit(target, f, self.W / 2 + q[0], self.H / 2 + q[1], q[2] / man['frames'][f][4], op=op,
                         alpha=d.get('alpha', 1.0))

    def _rot(self, d, target, op):
        self.em.blit(target, d['frames'][0], 0, 0, d['scale'], op=op, rotate=d['rotation_turns'],
                     pivot=((d['pivot'][0], d['pivot'][1]), (self.W / 2 + d['at'][0], self.H / 2 + d['at'][1])))

    def render(self, ground=False):
        for ds in self.objects:
            for d in ds:
                if 'rotation_turns' in d:
                    if d['pass'] == 'shadow':
                        self._rot(d, self.shadow, 'max')
                elif 'quads' in d and d.get('passes', ['colour'])[0] == 'shadow':
                    self._blit(d, self.shadow, 'max')
        if ground:
            for ds in self.objects:
                for d in ds:
                    if 'quads' in d and d.get('passes', ['x'])[0] == 'colour':
                        self._blit(d, self.rgba, 'over')
        x0 = self.cam['cx'] - self.W / 2 / self.S
        y0 = self.cam['cy'] - self.H / 2 / self.S
        self.rgba[..., :3] = E.hatch_shadows(self.rgba[..., :3], self.shadow, self.cam, x0, y0)
        for ds in self.objects:
            for d in ds:
                if 'rotation_turns' in d:
                    if d['pass'] == 'colour':
                        self._rot(d, self.rgba, 'over')
                    continue
                if d.get('part') == 'held':
                    items = sorted(n for n in self.em.man['sets'] if n.startswith('item/'))
                    name = items[d['item'] % len(items)] if items else 'fx/missing'
                    at = (d['at'][0] / self.S + self.cam['cx'], d['at'][1] / self.S + self.cam['cy'])
                    for dd in MF.draw_icon(self.em.man, name, at, self.cam, d['size_tiles']):
                        self._blit(dd, self.rgba, 'over')
                    continue
                if 'quads' not in d:
                    continue
                p = d.get('passes', ['colour'])[0]
                if p in ('colour', 'icon') and not ground:
                    self._blit(d, self.rgba, 'over')
                elif p == 'light':
                    self._blit(d, self.light, 'add')
        day = np.clip(E.light_composite(self.rgba[..., :3], self.light, 0.0), 0, 1)
        night = np.clip(E.light_composite(self.rgba[..., :3], self.light, 1.0), 0, 1)
        return day, night


def label(img, text, font):
    im = Image.fromarray(K.to8(img)).convert('RGB')
    band = Image.new('RGB', (im.width, 16), (24, 24, 24))
    ImageDraw.Draw(band).text((3, 1), text[:max(6, im.width // 6)], fill=(235, 230, 220), font=font)
    out = Image.new('RGB', (im.width, im.height + 16))
    out.paste(im, (0, 0))
    out.paste(band, (0, im.height))
    return np.asarray(out).astype(np.float32) / 255


def hstack(imgs, gap=4, bg=0.07):
    H = max(i.shape[0] for i in imgs)
    W = sum(i.shape[1] for i in imgs) + gap * (len(imgs) - 1)
    out = np.full((H, W, 3), bg, np.float32)
    x = 0
    for i in imgs:
        out[:i.shape[0], x:x + i.shape[1]] = i[..., :3]
        x += i.shape[1] + gap
    return out


def vstack(imgs, gap=4, bg=0.07):
    W = max(i.shape[1] for i in imgs)
    H = sum(i.shape[0] for i in imgs) + gap * (len(imgs) - 1)
    out = np.full((H, W, 3), bg, np.float32)
    y = 0
    for i in imgs:
        out[y:y + i.shape[0], :i.shape[1]] = i[..., :3]
        y += i.shape[0] + gap
    return out


def size_tiles(s):
    w, h = s.get('size', [1, 1])
    return w, h


def entity_cells(em, name, s, zoom, font):
    """Per direction with art: base by day and night, idle, the shadow mask, the glow; and the layer strip."""
    man = em.man
    parts = s['parts']
    w, h = size_tiles(s)
    tw, th = w + 3.5, h + 3.2
    cells = []
    dmap = parts['base']['map'].get('dir', [0] * 16) if 'base' in parts else [0] * 16
    seen = set()
    masks = [0]
    if 'mask' in parts.get('base', {}).get('axes', []):
        masks = [9, 1 | 8, 2 | 8, 4 | 8, 0]
    for d in range(16):
        di = dmap[d]
        if di in seen:
            continue
        seen.add(di)
        for mask in masks:
            view = dict(x2=w, y2=h, dir=d, variant=mask, dyn=dict(state=1, phase=0, light=255))
            ds = MF.draw_entity(man, name, view, dict(cx=w / 2, cy=h / 2 - 0.6, zoom=zoom, dpr=1), tick=0, belt_speed=8)
            if not any(x['frames'] for x in ds):
                continue
            st = Stage(em, tw, th, zoom, cx=w / 2 + 0.9, cy=h / 2 - 0.6)
            st.add(MF.draw_entity(man, name, view, st.cam, tick=0, belt_speed=8))
            day, night = st.render(ground=name.endswith('belt'))
            tag = f'd{d}' + (f' m{mask}' if len(masks) > 1 else '')
            cells += [label(day, f'{name.split("/")[1]} {tag}', font), label(night, 'night', font)]
            if 'idle' in parts:
                st = Stage(em, tw, th, zoom, cx=w / 2 + 0.9, cy=h / 2 - 0.6)
                st.add(MF.draw_entity(man, name, dict(view, dyn=dict(state=0, phase=0, light=0)), st.cam))
                cells.append(label(st.render()[0], 'idle', font))
            if len(masks) > 1:
                break
    return cells


def layer_strip(em, name, s, zoom, font, frames=8):
    man = em.man
    parts = s['parts']
    if not parts.get('layers'):
        return []
    w, h = size_tiles(s)
    n = parts['layers'][0]['shape'][-1]
    out = []
    for k in range(0, n, max(1, n // frames)):
        st = Stage(em, w + 1.2, h + 2.2, zoom, cx=w / 2, cy=h / 2 - 0.7)
        view = dict(x2=w, y2=h, dir=8, variant=0, dyn=dict(state=1, phase=k * 65536 // n, light=255))
        st.add(MF.draw_entity(man, name, view, st.cam))
        out.append(label(st.render()[0], f'f{k}', font))
    return [hstack(out, 2)]


def mover_cells(em, name, s, zoom, font):
    man = em.man
    parts = s['parts']
    rows = []
    for clip in ('idle', 'run', 'mine'):
        if clip not in parts:
            continue
        n = parts[clip]['shape'][1]
        for o in range(parts[clip]['shape'][0]):
            row = []
            for f in range(0, n, max(1, n // 8)):
                st = Stage(em, 2.2, 3.0, zoom, cx=0.6, cy=-0.9)
                p = parts[clip]
                mv = dict(x=0, y=0, vx=1 if clip == 'run' else 0, vy=0, flags=1 if clip == 'mine' else 0,
                          orientation=o * 65536 // parts[clip]['shape'][0],
                          distance=(f + 0.5) / n * p.get('cycleTiles', 1), seconds=(f + 0.5) / p.get('fps', 1))
                st.add(MF.draw_mover(man, name, mv, st.cam))
                row.append(st.render()[0])
            rows.append(label(hstack(row, 2), f'{clip} o{o}', font))
    return [vstack(rows, 2)]


def resource_cells(em, name, s, zoom, font):
    man = em.man
    base = s['parts']['base']
    nshape, nband = base['shape']
    rows = []
    for sh in range(nshape):
        row = []
        for b in range(nband):
            st = Stage(em, 1.6, 1.8, zoom, cx=0.5, cy=0.35)
            # a tile whose position hash gives this shape
            tx = next(t for t in range(0, 10000) if MF.pos_hash(t, 0) % nshape == sh)
            ds = MF.draw_resource(man, name, dict(tx=tx, ty=0, band=b), dict(cx=tx + 0.5, cy=0.35, zoom=zoom, dpr=1))
            st.add(ds)
            row.append(st.render(ground=True)[0])
        rows.append(label(hstack(row, 2), f'shape {sh} bands 0-7', font))
    return [vstack(rows, 2)]


def object_cells(em, name, s, zoom, font):
    """Every shape (picked by the position hash) at every stage of an object set, with its shadow."""
    man = em.man
    base = s['parts']['base']
    nshape = base['shape'][0]
    nstage = base['shape'][1] if len(base['shape']) > 1 else 1
    rows = []
    for sh in range(nshape):
        # a position whose hash gives this shape (positions in 1/256 tile)
        x = next(t for t in range(0, 1 << 24, 256) if MF.pos_hash(t, 0) % nshape == sh)
        row = []
        for g in range(nstage):
            st = Stage(em, 2.2, 2.6, zoom, cx=x / 256 + 0.5, cy=-0.6)
            st.add(MF.draw_object(man, name, dict(x=x, y=0, variant=g), st.cam))
            row.append(st.render()[0])
        rows.append(label(hstack(row, 2), f'shape {sh}' + (f' stages 0-{nstage - 1}' if nstage > 1 else ''), font))
    return [vstack(rows, 2)]


def inserter_cells(em, name, s, zoom, font):
    man = em.man
    out = []
    for d in (0, 4, 8, 12):
        for th in (0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875):
            if (d, th) not in ((0, 0.0), (4, 0.25), (8, 0.5), (12, 0.75), (0, 0.125), (0, 0.375), (0, 0.625),
                               (0, 0.875)):
                continue
            st = Stage(em, 3.0, 3.0, zoom, cx=0.5, cy=0.3)
            hands = dict(x2=1, y2=1, dir=d, theta=int(th * 65536), ext=4096, held=1 if th in (0.25, 0.75) else 0xFFFF)
            st.add(MF.draw_inserter(man, name, hands, st.cam))
            out.append(label(st.render()[0], f'd{d} t{th}', font))
    return [hstack(out, 2)]


def icon_cells(em, name, s, font):
    man = em.man
    fid = s['parts']['icon']['table'][0][0]
    out = []
    for bg in (K.hexc(K.PAPER_HEX), DECK):
        canvas = np.ones((72, 64 + 32 + 16 + 24, 4), np.float32)
        canvas[..., :3] = bg
        x = 4
        for size in (64, 32, 16):
            em.blit(canvas, fid, x, 4 + (64 - size) / 2, size / 64.0)
            x += size + 8
        out.append(canvas[..., :3])
    return [label(hstack(out, 2), name.split('/')[1], font)]


def gif(frames, path):
    tmp = os.path.join(QC, 'gif-tmp')
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    files = []
    for i, f in enumerate(frames):
        p = os.path.join(tmp, f'{i:03d}.png')
        Image.fromarray(K.to8(f)).save(p)
        files.append(p)
    subprocess.run(['gifski', '--quiet', '--fps', '16', '--width', str(frames[0].shape[1]), '-o', path] + files,
                   check=True)
    shutil.rmtree(tmp, ignore_errors=True)


def gifs(em, man):
    out_dir = os.path.join(QC, 'gifs')
    os.makedirs(out_dir, exist_ok=True)
    for name, s in man['sets'].items():
        parts = s['parts']
        if s['kind'] == 'entity' and parts.get('layers') and not name.startswith('greybox/'):
            w, h = size_tiles(s)
            n = parts['layers'][0]['shape'][-1]
            frames = []
            for k in range(n):
                st = Stage(em, w + 2.0, h + 2.4, 2, cx=w / 2 + 0.3, cy=h / 2 - 0.7)
                st.add(MF.draw_entity(man, name, dict(x2=w, y2=h, dir=8, variant=0,
                                                      dyn=dict(state=1, phase=k * 65536 // n, light=255)), st.cam))
                frames.append(st.render()[0])
            gif(frames, os.path.join(out_dir, f'{name.replace("/", "-")}.gif'))
        elif 'framesPerTile' in s:
            n = parts['base']['shape'][-1]
            frames = []
            for k in range(n):
                st = Stage(em, 4.0, 2.0, 2, cx=0.0, cy=-0.1)
                for x in range(-2, 2):
                    # frame k exactly: tick k at the speed that advances one frame per tick
                    st.add(MF.draw_entity(man, name, dict(x2=2 * x + 1, y2=1, dir=4, variant=1 | 8, dyn=None),
                                          st.cam, tick=k, belt_speed=256 // s['framesPerTile']))
                frames.append(st.render(ground=True)[0])
            gif(frames, os.path.join(out_dir, f'{name.replace("/", "-")}.gif'))
        elif s['kind'] == 'mover' and 'run' in parts:
            for clip in ('run', 'mine', 'idle'):
                p = parts[clip]
                n = p['shape'][1]
                frames = []
                for k in range(n):
                    st = Stage(em, 2.4, 3.0, 2, cx=0.6, cy=-0.9)
                    mv = dict(x=0, y=0, vx=1 if clip == 'run' else 0, vy=0, flags=1 if clip == 'mine' else 0,
                              orientation=3 * 65536 // 8, distance=(k + 0.5) / n * p.get('cycleTiles', 1),
                              seconds=(k + 0.5) / p.get('fps', 1))
                    st.add(MF.draw_mover(man, name, mv, st.cam))
                    frames.append(st.render()[0])
                gif(frames, os.path.join(out_dir, f'{name.replace("/", "-")}-{clip}.gif'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sets', default=None)
    ap.add_argument('--no-gifs', action='store_true')
    a = ap.parse_args()
    man = K.load_json(os.path.join(K.PUBLIC, 'atlases', 'sprites.json'))
    em = E.Emulator(man)
    font = ImageFont.truetype(FONT, 11)
    want = set(a.sets.split(',')) if a.sets else None
    os.makedirs(os.path.join(QC, 'contact'), exist_ok=True)
    overview = []
    for name in sorted(man['sets']):
        if want and name not in want:
            continue
        s = man['sets'][name]
        kind = s['kind']
        sheets = []
        for zoom in (1, 0.5):
            if kind == 'entity':
                cells = entity_cells(em, name, s, zoom, font)
                strip = layer_strip(em, name, s, zoom, font) if zoom == 1 else []
                sheets.append(vstack([hstack(cells, 3)] + strip) if cells else None)
            elif kind == 'mover':
                sheets.append(mover_cells(em, name, s, zoom, font)[0] if zoom == 1 else None)
            elif kind == 'resource':
                sheets.append(resource_cells(em, name, s, zoom, font)[0])
            elif kind == 'inserter':
                sheets.append(inserter_cells(em, name, s, zoom, font)[0])
            elif kind == 'icon':
                sheets.append(icon_cells(em, name, s, font)[0] if zoom == 1 else None)
            elif kind == 'object':
                sheets.append(object_cells(em, name, s, zoom, font)[0])
        sheets = [x for x in sheets if x is not None]
        if not sheets:
            continue
        sheet = vstack(sheets, 6)
        Image.fromarray(K.to8(sheet)).save(os.path.join(QC, 'contact', f'{name.replace("/", "-")}.png'))
        if not name.startswith('greybox/') or name in ('greybox/iron-chest', 'greybox/assembling-machine-1'):
            overview.append(sheets[0])
    if overview:
        rows, cur, cw = [], [], 0
        for c in overview:
            if cw + c.shape[1] > 2400 and cur:
                rows.append(hstack(cur, 6))
                cur, cw = [], 0
            cur.append(c)
            cw += c.shape[1] + 6
        rows.append(hstack(cur, 6))
        Image.fromarray(K.to8(vstack(rows, 6))).save(os.path.join(QC, 'contact.png'))
    if not a.no_gifs:
        gifs(em, man)
    print(f'[contact] {len(overview)} sets in .cache/assets/qc/contact.png', flush=True)


if __name__ == '__main__':
    main()
