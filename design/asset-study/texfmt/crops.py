"""B2 texture-format study, step 4: side-by-side crops of the decoded pages, magnified with nearest
neighbour and composited over the survey paper, for looking at ink lines and hatching.

    gamedev-python -I design/asset-study/texfmt/crops.py colour-high x y w h [scale=4] [variants]

Writes design/art/out/texfmt/crops/<page>-<x>-<y>.png: one column per variant, labelled.
"""

import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'design', 'art', 'out', 'texfmt')
PAPER = np.array([0xec, 0xe3, 0xcb], np.float32) / 255.0


def decoded(page, v):
    d = os.path.join(OUT, 'enc', page)
    if v == 'orig':
        p = os.path.join(OUT, 'pages', f'{page}.png')
    elif v == 'png':
        p = os.path.join(d, 'png.png')
    elif v.startswith('webp'):
        p = os.path.join(d, f'{v}.dec.png')
    else:
        u = os.path.join(d, f'{v}.unpack')
        f = sorted(x for x in os.listdir(u) if '_rgba_' in x and ('level_0_' in x or 'level_' not in x))[0]
        p = os.path.join(u, f)
    a = np.asarray(Image.open(p)).astype(np.float32) / 255.0
    if a.ndim == 2:
        a = np.repeat(a[..., None], 3, -1)
    if a.shape[2] == 4:
        a = a[..., :3] + (1 - a[..., 3:4]) * PAPER
    return a[..., :3]


def main():
    page, x, y, w, h = sys.argv[1], *map(int, sys.argv[2:6])
    s = int(sys.argv[6]) if len(sys.argv) > 6 else 4
    vs = sys.argv[7].split(',') if len(sys.argv) > 7 else ['orig', 'webp-q90', 'webp-q80', 'xubc7-q90', 'xubc7-q75',
                                                          'uastc-rdo1', 'xuastc4-q90', 'etc1s-q255']
    cols = []
    for v in vs:
        c = decoded(page, v)[y:y + h, x:x + w]
        c = np.repeat(np.repeat(c, s, 0), s, 1)
        im = Image.fromarray((np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8))
        lab = Image.new('RGB', (im.width, 22), (255, 255, 255))
        ImageDraw.Draw(lab).text((4, 4), v, fill=(0, 0, 0))
        col = Image.new('RGB', (im.width, im.height + 22), (255, 255, 255))
        col.paste(lab, (0, 0))
        col.paste(im, (0, 22))
        cols.append(col)
    W = sum(c.width for c in cols) + 6 * (len(cols) - 1)
    out = Image.new('RGB', (W, cols[0].height), (90, 90, 90))
    xx = 0
    for c in cols:
        out.paste(c, (xx, 0))
        xx += c.width + 6
    os.makedirs(os.path.join(OUT, 'crops'), exist_ok=True)
    p = os.path.join(OUT, 'crops', f'{page}-{x}-{y}.png')
    out.save(p)
    print(p, out.size)


if __name__ == '__main__':
    main()
