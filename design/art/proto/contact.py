"""Contact sheets (10 §9.5 #1): every sprite of a style at Normal resolution over its ground, with its
shadow, plus every icon at 64/32/16 px over a belt strip.

    gamedev-python design/art/proto/contact.py kodachrome [--out design/art/mocks/contact-kodachrome.png]
"""

import argparse
import glob
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import post  # noqa: E402
import scene  # noqa: E402
import terrain as T  # noqa: E402

SPR = os.path.join(HERE, '..', 'out', 'sprites')
FONT = os.path.join(HERE, '..', 'out', 'fonts', 'TitilliumWeb-SemiBold.ttf')

ORDER = ['transport-belt', 'inserter', 'burner-inserter', 'long-handed-inserter', 'stone-furnace', 'keypunch',
         'assembling-machine-1', 'seminar', 'electric-mining-drill', 'small-electric-pole', 'offshore-pump', 'pipe',
         'boiler', 'steam-engine', 'wooden-chest', 'iron-chest', 'character', 'tree', 'big-rock', 'decorative',
         'iron-ore', 'copper-ore', 'coal', 'quartz', 'archive', 'town-block', 'campus']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('style')
    ap.add_argument('--out', default=None)
    ap.add_argument('--width', type=int, default=2400)
    a = ap.parse_args()
    st = a.style
    out = a.out or os.path.join(HERE, '..', 'mocks', f'contact-{st}.png')
    px = 32
    grass = T.materials(st, px, tiles=['grass'])['grass']
    font = ImageFont.truetype(FONT, 15)
    cells = []
    for eid in ORDER:
        mp = os.path.join(SPR, st, eid, 'manifest.json')
        if not os.path.exists(mp):
            continue
        man = json.load(open(mp))
        stems = sorted(man)
        # one representative per (variant, direction, state) at frame 0 (or the lowest frame)
        seen = set()
        for stem in stems:
            m = man[stem]
            key = (m.get('variant'), m.get('dir'), m.get('state'))
            if key in seen:
                continue
            seen.add(key)
            spr = scene.sprite(st, eid, stem, px)
            rgba, sh = spr['rgba'], spr['shadow']
            h, w = rgba.shape[:2]
            pad = 6
            H, W = h + 2 * pad + 18, max(w + 2 * pad, 90)
            g = np.tile(grass, (H // grass.shape[0] + 1, W // grass.shape[1] + 1, 1))[:H, :W].copy()
            ox, oy = (W - w) // 2, pad
            if st == 'survey':
                hat = post.hatch(h, w, 2.5, 0.7, -45) * sh
                reg = g[oy:oy + h, ox:ox + w]
                reg[...] = reg * (1 - 0.55 * hat[..., None]) + post.hexc('#2b2723') * 0.55 * hat[..., None]
            else:
                shade = np.array(scene.SHADE[st])
                k = np.clip(sh, 0, 1)[..., None] * 0.95
                reg = g[oy:oy + h, ox:ox + w]
                reg[...] = reg * (1 - k + k * shade)
            scene.blit(g, rgba, ox, oy)
            im = Image.fromarray((np.clip(g, 0, 1) * 255).astype(np.uint8))
            d = ImageDraw.Draw(im)
            label = stem.replace('-f00', '').replace('-S', '')
            d.rectangle([0, H - 18, W, H], fill=(24, 24, 24))
            d.text((4, H - 18), label[:max(8, W // 7)], fill=(235, 230, 220), font=font)
            cells.append(np.asarray(im))
    # icons
    icons = sorted(glob.glob(os.path.join(SPR, st, 'icons', '*.colour.png')))
    belt_bg = post.hexc('#3a3a3a')
    icon_cells = []
    for f in icons:
        item = os.path.basename(f).split('.')[0]
        W, H = 64 + 32 + 16 + 4 * 6, 64 + 22
        g = np.ones((H, W, 3), np.float32) * belt_bg
        x = 6
        for sz in (64, 32, 16):
            ic = scene.icon(st, item, sz)
            scene.blit(g, ic, x, 6 + (64 - sz) // 2)
            x += sz + 6
        im = Image.fromarray((np.clip(g, 0, 1) * 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        d.text((4, H - 19), item, fill=(235, 230, 220), font=font)
        icon_cells.append(np.asarray(im))
    rows = _pack(cells, a.width) + _pack(icon_cells, a.width)
    sheet = np.concatenate([_pad_row(r, a.width) for r in rows], 0)
    Image.fromarray(sheet).save(out)
    print('[contact]', out, sheet.shape)


def _pack(cells, width, gap=4):
    rows, cur, cw = [], [], 0
    for c in cells:
        if cw + c.shape[1] + gap > width and cur:
            rows.append(cur)
            cur, cw = [], 0
        cur.append(c)
        cw += c.shape[1] + gap
    if cur:
        rows.append(cur)
    out = []
    for r in rows:
        H = max(c.shape[0] for c in r)
        row = np.full((H + gap, width, 3), 18, np.uint8)
        x = 0
        for c in r:
            row[:c.shape[0], x:x + c.shape[1]] = c
            x += c.shape[1] + gap
        out.append(row)
    return out


def _pad_row(r, width):
    return r


if __name__ == '__main__':
    main()
