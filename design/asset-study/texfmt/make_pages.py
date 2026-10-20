"""B2 texture-format study, step 1: build real atlas pages from A3's Survey prototype sprites.

    gamedev-python -I design/asset-study/texfmt/make_pages.py

Reads the rendered passes in design/art/out/sprites/survey/ (A3's render_all.sh), applies the same
ink pass the mocks use (design/art/proto/post.py: survey_ink, crc32 seeds, ink weights), trims
each sprite on its colour alpha, premultiplies, and packs into pages (MaxRects, best short side,
2 px gutter) the way 10 §9.2 packs atlases. Writes to design/art/out/texfmt/pages/ (gitignored):

  colour-high.png     2048x2048 RGBA8 premultiplied, High (64 px/tile): entities, frames, resources
  colour-normal.png   1024x1024 RGBA8 premultiplied, the same sprites at Normal (32 px/tile)
  icons.png           512x512 RGBA8 premultiplied: every prototype icon at 64, 32 and 16 px
  shadow-normal.png   1024x1024 R8: shadow masks at Normal, values below 0.03 clipped (A3 §4.2)
  terrain-grass.png, terrain-dirt.png, terrain-sand.png   512x512 RGB material textures (8x8 tiles)
  pages.json          per page: sprite count, occupancy, content pixels

The ink pass is applied before packing (as the build will), so the pages carry the hatching,
lines, mottle and paper grain whose survival under compression is the point of the study.
"""

import json
import os
import re
import sys
import zlib

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PROTO = os.path.join(ROOT, 'design', 'art', 'proto')
sys.path.insert(0, PROTO)
import post  # noqa: E402
import terrain  # noqa: E402
from lib import style as S  # noqa: E402

SPR = os.path.join(ROOT, 'design', 'art', 'out', 'sprites', 'survey')
OUT = os.path.join(ROOT, 'design', 'art', 'out', 'texfmt', 'pages')
GUTTER = 2


class MaxRects:
    """MaxRects bin packer, best-short-side-fit (Jylanki 2010), as maxrects-packer does."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.free = [(0, 0, w, h)]

    def insert(self, w, h):
        best, bs, bl = None, 1 << 30, 1 << 30
        for (x, y, fw, fh) in self.free:
            if w <= fw and h <= fh:
                ss, ls = min(fw - w, fh - h), max(fw - w, fh - h)
                if ss < bs or (ss == bs and ls < bl):
                    best, bs, bl = (x, y), ss, ls
        if best is None:
            return None
        x, y = best
        used = (x, y, w, h)
        nf = []
        for fr in self.free:
            nf.extend(self._split(fr, used))
        # prune contained rectangles
        pr = []
        for i, a in enumerate(nf):
            if not any(i != j and self._contains(b, a) for j, b in enumerate(nf)):
                pr.append(a)
        self.free = list(dict.fromkeys(pr))
        return x, y

    @staticmethod
    def _contains(b, a):
        return a[0] >= b[0] and a[1] >= b[1] and a[0] + a[2] <= b[0] + b[2] and a[1] + a[3] <= b[1] + b[3]

    @staticmethod
    def _split(fr, u):
        fx, fy, fw, fh = fr
        ux, uy, uw, uh = u
        if ux >= fx + fw or ux + uw <= fx or uy >= fy + fh or uy + uh <= fy:
            return [fr]
        out = []
        if ux > fx:
            out.append((fx, fy, ux - fx, fh))
        if ux + uw < fx + fw:
            out.append((ux + uw, fy, fx + fw - ux - uw, fh))
        if uy > fy:
            out.append((fx, fy, fw, uy - fy))
        if uy + uh < fy + fh:
            out.append((fx, uy + uh, fw, fy + fh - uy - uh))
        return out


def premul(rgba):
    out = rgba.copy()
    out[..., :3] *= out[..., 3:4]
    return out


def trim(rgba, alpha=None):
    a = rgba[..., 3] if alpha is None else alpha
    x0, y0, x1, y1 = post.trim_box(a, pad=1)
    return rgba[y0:y1, x0:x1], (x0, y0)


def inked(entity, stem):
    d = os.path.join(SPR, entity)
    c = post.read_png(os.path.join(d, f'{stem}.colour.png'))
    n = post.read_png(os.path.join(d, f'{stem}.normal.png'))
    a = post.read_png(os.path.join(d, f'{stem}.aux.png'))
    seed = zlib.crc32(re.sub(r'-f\d+', '', stem).encode()) % 1000
    return post.survey_ink(c, n, a, 'survey', seed=seed, line_alpha=post.INK_WEIGHT.get(entity, 1.0))


def pack(images, size, channels):
    """images: list of (name, array HxWxC float). Largest first. Returns page, placements, rejected."""
    page = np.zeros((size, size, channels), np.float32)
    mr = MaxRects(size, size)
    placed, rejected = [], []
    for name, im in sorted(images, key=lambda t: -(t[1].shape[0] * t[1].shape[1])):
        h, w = im.shape[:2]
        pos = mr.insert(w + GUTTER, h + GUTTER)
        if pos is None:
            rejected.append(name)
            continue
        x, y = pos
        page[y:y + h, x:x + w] = im
        placed.append(dict(name=name, x=x, y=y, w=w, h=h))
    return page, placed, rejected


def save(path, arr):
    a = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    if a.ndim == 3 and a.shape[2] == 1:
        a = a[..., 0]
    Image.fromarray(a).save(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    high, normal, shadows = [], [], []
    for entity in sorted(os.listdir(SPR)):
        if entity == 'icons':
            continue
        man = json.load(open(os.path.join(SPR, entity, 'manifest.json')))
        for stem in sorted(man):
            if not os.path.exists(os.path.join(SPR, entity, f'{stem}.normal.png')):
                continue
            rgba = inked(entity, stem)
            ax, ay = man[stem]['ax'], man[stem]['ay']
            # pad so the anchor stays on the even grid, then the Normal downscale (premultiplied box)
            px0, py0 = (-ax) % 2, (-ay) % 2
            full = np.pad(rgba, ((py0, 0), (px0, 0), (0, 0)))
            nrm = post.downscale(full, 2)
            t, _ = trim(premul(rgba))
            high.append((stem, t))
            t2, _ = trim(premul(nrm))
            normal.append((stem, t2))
            sp = os.path.join(SPR, entity, f'{stem}.shadow.png')
            if os.path.exists(sp):
                s = post.read_png(sp)[..., 3]
                s = np.where(s < 0.03, 0.0, s)
                s = np.pad(s, ((py0, 0), (px0, 0)))
                s = post.downscale(s[..., None], 2)
                x0, y0, x1, y1 = post.trim_box(s[..., 0], pad=1)
                shadows.append((stem, s[y0:y1, x0:x1]))
    info = {}
    for name, imgs, size, ch in (('colour-high', high, 2048, 4), ('colour-normal', normal, 1024, 4),
                                 ('shadow-normal', shadows, 1024, 1)):
        page, placed, rej = pack(imgs, size, ch)
        save(os.path.join(OUT, f'{name}.png'), page)
        content = int(sum(p['w'] * p['h'] for p in placed))
        info[name] = dict(size=size, sprites=len(placed), rejected=len(rej), content_px=content,
                          occupancy=round(content / size / size, 3))
        print(name, info[name], flush=True)
    # icons: every icon at 64, 32 and 16 (the sizes 10 §9.3 ships), through the icon ink (sel-out)
    import scene  # noqa: E402  (A3's compositor; its icon() applies the icon ink)
    icons = []
    for f in sorted(os.listdir(os.path.join(SPR, 'icons'))):
        if f.endswith('.colour.png'):
            item = f[:-len('.colour.png')]
            for s in (64, 32, 16):
                icons.append((f'{item}@{s}', premul(scene.icon('survey', item, s))))
    page, placed, rej = pack(icons, 512, 4)
    save(os.path.join(OUT, 'icons.png'), page)
    content = int(sum(p['w'] * p['h'] for p in placed))
    info['icons'] = dict(size=512, sprites=len(placed), rejected=len(rej), content_px=content,
                         occupancy=round(content / 512 / 512, 3))
    print('icons', info['icons'], flush=True)
    mats = terrain.materials('survey', 64, tiles=['grass', 'dirt', 'sand'])
    for t, m in mats.items():
        save(os.path.join(OUT, f'terrain-{t}.png'), m)
        info[f'terrain-{t}'] = dict(size=m.shape[0], content_px=m.shape[0] * m.shape[1], occupancy=1.0)
    json.dump(info, open(os.path.join(OUT, 'pages.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
