"""Runtime budget estimate for a style (10 §6.13, §9.6): atlas pages, GPU memory, download size.

    gamedev-python design/art/proto/budget.py kodachrome

Method: every rendered colour sprite is trimmed (alpha > 1/255, shadow included in its own
single-channel atlas), packed with a shelf packer into 2048x2048 pages at High (64 px/tile) and at
Normal (32 px/tile). GPU bytes = pages x 2048^2 x 4 (RGBA8) x 4/3 (mips) for colour, x 1 for R8
shadows. Download = cwebp (lossy q90, lossless alpha) of the packed colour pages + lossless shadows.
The full-game figure scales the measured mean area per frame by the frame counts of 10 §9.1
(about 6,000 entity frames, 220 icons), which is how the spec sized its own budget.
"""

import glob
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import post  # noqa: E402

SPR = os.path.join(HERE, '..', 'out', 'sprites')
PAGE = 2048


def shelf_pack(sizes, page=PAGE):
    """Return the number of pages and the placements (page, x, y) for a list of (w, h)."""
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    pages = []      # each: list of shelves [y, h, x]
    place = [None] * len(sizes)
    for i in order:
        w, h = sizes[i]
        w, h = min(w, page), min(h, page)
        done = False
        for pi, shelves in enumerate(pages):
            for sh in shelves:
                if h <= sh[1] and sh[2] + w <= page:
                    place[i] = (pi, sh[2], sh[0])
                    sh[2] += w + 2
                    done = True
                    break
            if done:
                break
            top = (shelves[-1][0] + shelves[-1][1] + 2) if shelves else 0
            if top + h <= page:
                shelves.append([top, h, w + 2])
                place[i] = (pi, 0, top)
                done = True
                break
        if not done:
            pages.append([[0, h, w + 2]])
            place[i] = (len(pages) - 1, 0, 0)
    return len(pages), place


def main():
    st = sys.argv[1]
    files = sorted(glob.glob(os.path.join(SPR, st, '*', '*.colour.png')))
    files = [f for f in files if '/icons/' not in f]
    sprites = []
    for f in files:
        c = post.read_png(f)
        sp = f.replace('.colour.png', '.shadow.png')
        s = post.read_png(sp)[..., 3] if os.path.exists(sp) else np.zeros(c.shape[:2], np.float32)
        x0, y0, x1, y1 = post.trim_box(c[..., 3])
        s = np.where(s < 0.03, 0.0, s)                       # clip the faint sky-occlusion tail
        sx0, sy0, sx1, sy1 = post.trim_box(s)
        sprites.append((f, c[y0:y1, x0:x1], s[sy0:sy1, sx0:sx1]))
    n = len(sprites)
    area_c = np.mean([c.shape[0] * c.shape[1] for _, c, _ in sprites])
    area_s = np.mean([s.shape[0] * s.shape[1] for _, _, s in sprites])
    res = {}
    for name, f in (('high', 1), ('normal', 2)):
        sizes = [((c.shape[1] + f - 1) // f, (c.shape[0] + f - 1) // f) for _, c, _ in sprites]
        ssz = [((s.shape[1] + f - 1) // f, (s.shape[0] + f - 1) // f) for _, _, s in sprites]
        pc, place = shelf_pack(sizes)
        ps, _ = shelf_pack(ssz)
        res[name] = dict(colour_pages=pc, shadow_pages=ps)
        if name == 'high':
            # build the colour pages and measure WebP size
            pages = [np.zeros((PAGE, PAGE, 4), np.uint8) for _ in range(pc)]
            for (fp, c, _), (pi, x, y) in zip(sprites, place):
                h, w = min(c.shape[0], PAGE - y), min(c.shape[1], PAGE - x)
                pages[pi][y:y + h, x:x + w] = (np.clip(c[:h, :w], 0, 1) * 255).astype(np.uint8)
            tot = 0
            with tempfile.TemporaryDirectory() as td:
                for k, pg in enumerate(pages):
                    p = os.path.join(td, f'p{k}.png')
                    Image.fromarray(pg).save(p)
                    q = os.path.join(td, f'p{k}.webp')
                    subprocess.run(['cwebp', '-quiet', '-q', '90', '-alpha_q', '100', '-exact', p, '-o', q], check=True)
                    tot += os.path.getsize(q)
            res[name]['webp_bytes'] = tot
    # extrapolation to the full game (10 §9.1: ~6,000 frames; slice ~1,500)
    px_area_frame = area_c
    out = dict(style=st, sprites=n, mean_trimmed_area_px=int(area_c), mean_shadow_area_px=int(area_s), **res)
    hi = res['high']
    bytes_per_px_webp = hi['webp_bytes'] / max(1, n * area_c)
    for label, frames in (('slice', 1500), ('full', 6000)):
        pages_c = frames * area_c / (PAGE * PAGE * 0.80)
        pages_s = frames * area_s / (PAGE * PAGE * 0.80)
        gpu = pages_c * PAGE * PAGE * 4 * 4 / 3 + pages_s * PAGE * PAGE * 1 * 4 / 3
        dl = frames * area_c * bytes_per_px_webp
        out[label] = dict(frames=frames, colour_pages_high=round(pages_c, 1), shadow_pages_high=round(pages_s, 1),
                          gpu_mb_high=round(gpu / 2 ** 20), gpu_mb_normal=round(gpu / 4 / 2 ** 20),
                          download_mb_colour_high=round(dl / 2 ** 20, 1))
    print(json.dumps(out, indent=1))
    os.makedirs(os.path.join(HERE, '..', 'out', 'budget'), exist_ok=True)
    json.dump(out, open(os.path.join(HERE, '..', 'out', 'budget', f'{st}.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
