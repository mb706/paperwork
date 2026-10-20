"""Compose, level and encode the atlas pages (10 §9.2 steps 5-7), and write the DOM icon sheets (§9.3).

    gamedev-python game/scripts/assets/assemble.py --layout .cache/assets/layout.json --out assembled.json

Input: the packer's layout (build-assets.ts): per page its array, group and cells; per cell the post step's
padded frame image and the cell's position. Each cell gets its frame at (gutter, gutter) and the frame image's
real neighbouring pixels around it (transparent around a whole sprite, the frame's own neighbourhood around a
layer frame), so filtering at every level reads only the cell's own pixels.

Levels are box-filtered halvings of the premultiplied page (level 1 is the Normal page); encode.py turns them
into KTX2 (XUBC7 quality 90 for colour, light and icons, ETC1S -q 255 for shadows; the upload contract's metadata
in ktx2.py):
  colour  level 0 in <name>.<hash8>.h.ktx2, levels 1-3 in <name>.<hash8>.n.ktx2 (§9.7 streams them apart)
  light   levels 0-1, one file      icon  levels 0-2, one file      shadow  levels 0-2, one file
Output names carry the first 8 hex digits of the file's own SHA-256. Writing is additive: a name is its content,
so the files of the published manifest are never touched, and build-assets.ts removes unreferenced files only
after the new manifest has passed its checks and been published (codex C6-r1 finding 7). The uncompressed levels
go to .cache/assets/pages/<stem>.L<n>.png, the truth the checks measure the encodes against.
"""

import argparse
import hashlib
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import encode as E  # noqa: E402

ATLASES = os.path.join(K.PUBLIC, 'atlases')
SHEETS = os.path.join(K.PUBLIC, 'sheets')
PAGES = os.path.join(K.CACHE, 'pages')
ICON_COLUMNS = 16


def compose(page, arr):
    S = arr['pageSize']
    C = 1 if arr['kind'] == 'shadow' else 4
    img = np.zeros((S, S, C), np.float32)
    g = arr['gutter']
    for c in page['cells']:
        src = K.read_png(os.path.join(c['dir'], c['file']))
        if src.shape[2] != C:
            src = src[..., :C]
        pad = c['pad']
        sx, sy = pad - g, pad - g                     # the cell's origin in the padded image
        w = min(c['cw'], src.shape[1] - sx)
        h = min(c['ch'], src.shape[0] - sy)
        if sx < 0 or sy < 0:
            raise ValueError(f'{c["set"]}: frame pad {pad} smaller than the gutter {g}')
        img[c['y']:c['y'] + h, c['x']:c['x'] + w] = src[sy:sy + h, sx:sx + w]
    return img


def levels_of(img, n):
    """Level 0 quantised to 8 bits, then each level the box filter of the previous level's 8-bit values."""
    out = [K.to8(img)]
    for _ in range(n - 1):
        prev = out[-1].astype(np.float32) / 255.0
        out.append(K.to8(K.box_down(prev, 2)))
    return out


def publish(data, stem, suffix):
    """Write `data` as atlases/<stem>.<sha8><suffix>.ktx2 unless it exists (same name, same bytes)."""
    sha = hashlib.sha256(data).hexdigest()
    name = f'{stem}.{sha[:8]}{suffix}.ktx2'
    path = os.path.join(ATLASES, name)
    if not os.path.exists(path) or K.sha256_file(path) != sha:
        with open(path + '.tmp', 'wb') as f:
            f.write(data)
        os.replace(path + '.tmp', path)
    return f'atlases/{name}', len(data), sha


def webp_lossless(rgba_straight, path_stem):
    os.makedirs(SHEETS, exist_ok=True)
    tmp = os.path.join(K.CACHE, f'sheet.{os.getpid()}.tmp.png')
    K.write_png(tmp, rgba_straight)
    out_tmp = os.path.join(SHEETS, f'{path_stem}.{os.getpid()}.tmp.webp')
    subprocess.run(['cwebp', '-quiet', '-lossless', '-z', '9', '-exact', '-metadata', 'none', tmp, '-o', out_tmp],
                   check=True)
    os.remove(tmp)
    with open(out_tmp, 'rb') as f:
        data = f.read()
    sha = hashlib.sha256(data).hexdigest()
    name = f'{path_stem}.{sha[:8]}.webp'
    os.replace(out_tmp, os.path.join(SHEETS, name))
    return f'sheets/{name}', len(data), sha


def icon_sheets(layout):
    """Per group: the icons at 32 and 64 px (device pixel ratios 1 and 2) in a grid, WebP lossless, straight
    alpha (the DOM's convention); dom.iconSheets names the icons in grid order."""
    arr = next(a for a in layout['arrays'] if a['kind'] == 'icon')
    ai = layout['arrays'].index(arr)
    by_group = {}
    for p in layout['pages']:
        if p['array'] != ai:
            continue
        for c in p['cells']:
            by_group.setdefault(p['group'], []).append(c)
    dom_icons, index = {}, {}
    for g in sorted(by_group):
        cells = sorted(by_group[g], key=lambda c: c['set'])
        n = len(cells)
        cols = min(ICON_COLUMNS, n)
        rows = -(-n // cols)
        files = []
        for size in (32, 64):
            sheet = np.zeros((rows * size, cols * size, 4), np.float32)
            for i, c in enumerate(cells):
                src = K.read_png(os.path.join(c['dir'], c['file']))
                pad = c['pad']
                ic = src[pad:pad + c['h'], pad:pad + c['w']]
                if size != ic.shape[0]:
                    ic = K.box_down(ic, ic.shape[0] // size)
                r, q = divmod(i, cols)
                sheet[r * size:(r + 1) * size, q * size:(q + 1) * size] = ic
            fn, nbytes, sha = webp_lossless(K.unpremul(sheet), f'icons-{g.replace("/", "-")}-{size}')
            files.append(dict(file=fn, bytes=nbytes, sha256=sha, size=size))
        dom_icons[g] = [f['file'] for f in files]
        index[g] = dict(columns=cols, names=[c['set'] for c in cells], bytes=[f['bytes'] for f in files])
    return dom_icons, index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--layout', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    layout = K.load_json(a.layout)
    os.makedirs(ATLASES, exist_ok=True)
    os.makedirs(SHEETS, exist_ok=True)
    # the uncompressed levels of this build's pages only (a stem of an older, larger build must not linger)
    os.makedirs(PAGES, exist_ok=True)
    for f in os.listdir(PAGES):
        os.remove(os.path.join(PAGES, f))
    pages_out = []
    for page in layout['pages']:
        arr = layout['arrays'][page['array']]
        img = compose(page, arr)
        lv = levels_of(img, arr['levels'])
        stem = f'{arr["kind"]}-{page["group"].replace("/", "-")}-{page["index"]}'
        files, nbytes, shas = [], [], []
        if arr['kind'] == 'colour':
            for part, levels, suffix in (('h', lv[:1], '.h'), ('n', lv[1:], '.n')):
                data = E.encode(levels, arr['codec'], arr['kind'], f'{stem}.{part}')
                fn, nb, sha = publish(data, stem, suffix)
                files.append(fn)
                nbytes.append(nb)
                shas.append(sha)
        else:
            data = E.encode(lv, arr['codec'], arr['kind'], stem)
            fn, nb, sha = publish(data, stem, '')
            files.append(fn)
            nbytes.append(nb)
            shas.append(sha)
        # the uncompressed source levels, for the checks (the truth the encode is measured against)
        for i, level in enumerate(lv):
            K.write_png(os.path.join(PAGES, f'{stem}.L{i}.png'), level.astype(np.float32) / 255.0)
        pages_out.append(dict(array=page['array'], group=page['group'], index=page['index'], files=files,
                              bytes=nbytes, sha256=shas, stem=stem))
        print(f'[assemble] {stem}: {len(page["cells"])} cells, {sum(nbytes) / 1e3:.0f} kB', flush=True)
    dom_icons, index = icon_sheets(layout)
    K.dump_json(a.out, dict(pages=pages_out, dom=dict(icons=dom_icons, iconSheets=index)))


if __name__ == '__main__':
    main()
