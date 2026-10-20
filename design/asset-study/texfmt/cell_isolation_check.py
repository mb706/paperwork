"""B2 texture-format study, step 7 (codex B2-r1 finding 10): no compression block of any level mixes two cells.

    taskset -c 0-7 gamedev-python -I design/asset-study/texfmt/cell_isolation_check.py

A synthetic worst case for 10 §9.2's packing: a 2048^2 page of cells on 32 px (sizes 64-256 px, multiples of 32),
each a solid colour that differs strongly from its neighbours, its 8-px gutter filled with its own colour (a cell's
real neighbourhood). Levels 1-3 are box-filtered halvings, as the build makes them. Each level is encoded as XUBC7
quality 90 (colour) and, as a grey page, ETC1S -q 255 (shadows), then transcoded to every format of the fallback
chains and decoded. Every decoded texel must be nearer its own cell's colour than any other cell's, and within a
tolerance of it. For contrast the same page is built with cells on 8 px and 2-px gutters (version 1's packing).
Writes design/art/out/texfmt/cell_isolation.json.
"""

import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from encode import ENC, read  # noqa: E402

OUT = os.path.join(ENC, '..', 'cells')
FORMATS = {'bc7': 6, 'astc4x4': 10, 'bc3': 3, 'etc2_rgba': 1}
GREY_FORMATS = {'bc4': 4, 'eac_r11': 20}
PAGE = 2048


def build(align, gutter, seed=7):
    rng = np.random.default_rng(seed)
    img = np.zeros((PAGE, PAGE, 4), np.float32)
    ids = -np.ones((PAGE, PAGE), np.int32)        # the cell each pixel belongs to (gutter included)
    cols = []
    y = 0
    while y < PAGE:
        x, row_h = 0, 0
        while True:
            w = int(rng.integers(64 // align, 256 // align + 1)) * align
            h = int(rng.integers(64 // align, 256 // align + 1)) * align
            cw, ch = -(-(w + 2 * gutter) // align) * align, -(-(h + 2 * gutter) // align) * align
            if x + cw > PAGE:
                break
            if y + ch > PAGE:
                x = PAGE
                break
            # a colour far from the previous ones: alternate dark and light, random hue
            c = rng.random(3) * 0.5 + (0.5 if len(cols) % 2 else 0.0)
            cols.append(c)
            img[y:y + ch, x:x + cw, :3] = c
            img[y:y + ch, x:x + cw, 3] = 1.0
            ids[y:y + ch, x:x + cw] = len(cols) - 1
            x += cw
            row_h = max(row_h, ch)
        if row_h == 0:
            break
        y += row_h
    return img, ids, np.array(cols, np.float32)


def levels(img):
    out = [img]
    for _ in range(3):
        a = out[-1]
        h, w = a.shape[:2]
        out.append(a.reshape(h // 2, 2, w // 2, 2, a.shape[2]).mean(axis=(1, 3)))
    return out


def save(a, path, grey=False):
    a8 = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
    if grey:
        Image.fromarray(a8[..., 0], 'L').save(path)
    else:
        Image.fromarray(a8, 'RGBA').save(path)


def encode_unpack(png, args, fmt_code, tag):
    ktx = png.replace('.png', f'.{tag}.ktx2')
    if not os.path.exists(ktx) or os.path.getmtime(ktx) < os.path.getmtime(png):
        subprocess.run(['basisu', '-ktx2', '-no_stats'] + args + [png, '-output_file', ktx], check=True, capture_output=True)
    udir = ktx + f'.{fmt_code}'
    os.makedirs(udir, exist_ok=True)
    subprocess.run(['basisu', '-unpack', '-format_only', str(fmt_code), '-no_ktx', ktx, '-output_path', udir],
                   check=True, capture_output=True)
    lv0 = lambda f: 'level_0_' in f or 'level_' not in f
    c = [f for f in os.listdir(udir) if '_rgba_' in f and lv0(f)] or [f for f in os.listdir(udir) if '_rgb_' in f and lv0(f)]
    return read(os.path.join(udir, sorted(c)[0]))


def check(dec, ids_l, cols, grey):
    """Fraction of texels nearer another cell's colour than their own, and the worst distance to their own."""
    m = ids_l >= 0
    if grey:
        # one channel: many cells share a grey, so "nearest" is ambiguous; a leak is a texel 0.1 off its own grey
        own = cols[:, 0][np.maximum(ids_l, 0)]
        d_own = np.abs(dec[..., 0] - own)
        return float((d_own[m] > 0.1).mean()), float(d_own[m].max())
    else:
        own = cols[np.maximum(ids_l, 0)]
        d_own = np.sqrt(((dec[..., :3] - own) ** 2).sum(-1))
        # nearest cell colour, in chunks of rows to bound memory
        nearest = np.empty(ids_l.shape, np.int32)
        for r0 in range(0, ids_l.shape[0], 64):
            d_all = ((dec[r0:r0 + 64, :, None, :3] - cols[None, None, :, :]) ** 2).sum(-1)
            nearest[r0:r0 + 64] = d_all.argmin(-1)
    return float((nearest[m] != ids_l[m]).mean()), float(d_own[m].max())


def main():
    os.makedirs(OUT, exist_ok=True)
    res = {}
    for name, align, gutter in (('cells-32px-gutter-8', 32, 8), ('v1-8px-gutter-2', 8, 2)):
        img, ids, cols = build(align, gutter)
        L = levels(img)
        for lvl, a in enumerate(L):
            s = 2 ** lvl
            # a texel belongs to a cell only if all its source pixels do (otherwise it is a mixed texel by definition)
            idl = ids[::s, ::s].copy()
            blk = ids.reshape(PAGE // s, s, PAGE // s, s)
            mixed = (blk.min(axis=(1, 3)) != blk.max(axis=(1, 3)))
            idl[mixed] = -1
            png = os.path.join(OUT, f'{name}-L{lvl}.png')
            save(a, png)
            gpng = os.path.join(OUT, f'{name}-L{lvl}-grey.png')
            save(a, gpng, grey=True)
            for fmt, code in FORMATS.items():
                dec = encode_unpack(png, ['-xubc7', '-quality', '90'], code, 'xubc7')
                wrong, worst = check(dec.astype(np.float32) / (255.0 if dec.dtype == np.uint8 else 1.0), idl, cols, False)
                res[f'{name} L{lvl} {fmt}'] = dict(texels_nearer_another_cell=round(wrong, 6), worst_own_distance=round(worst, 4))
                print(name, 'level', lvl, fmt, res[f'{name} L{lvl} {fmt}'], flush=True)
            for fmt, code in GREY_FORMATS.items():
                dec = encode_unpack(gpng, ['-etc1s', '-q', '255', '-linear'], code, 'etc1s')
                wrong, worst = check(dec.astype(np.float32) / (255.0 if dec.dtype == np.uint8 else 1.0), idl, cols, True)
                res[f'{name} L{lvl} {fmt}'] = dict(texels_nearer_another_cell=round(wrong, 6), worst_own_distance=round(worst, 4))
                print(name, 'level', lvl, fmt, res[f'{name} L{lvl} {fmt}'], flush=True)
    json.dump(res, open(os.path.join(ENC, '..', 'cell_isolation.json'), 'w'), indent=1)


main()
