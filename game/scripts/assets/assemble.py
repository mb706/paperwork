"""Compose, level and encode the atlas pages (10 §9.2 steps 5-7), and write the DOM icon sheets (§9.3).

    gamedev-python game/scripts/assets/assemble.py --layout .cache/assets/layout.json --out assembled.json

Input: the packer's layout (build-assets.ts): per page its array, group and cells; per cell the post step's
padded frame image and the cell's position. Each cell gets its frame at (gutter, gutter) and the frame image's
real neighbouring pixels around it (transparent around a whole sprite, the frame's own neighbourhood around a
layer frame), so filtering at every level reads only the cell's own pixels.

Levels are box-filtered halvings of the premultiplied page (level 1 is the Normal page). They are written as an
uncompressed mipmapped .DDS, which basisu 2.50 encodes keeping the supplied levels (verified), so the levels are
ours, not basisu's filter:
  colour  XUBC7 quality 90: level 0 in <name>.<hash8>.h.ktx2, levels 1-3 in <name>.<hash8>.n.ktx2 (§9.7 streams
          them apart)
  light   XUBC7 quality 90, levels 0-1, one file      icon  XUBC7 quality 90, levels 0-2, one file
  shadow  ETC1S -q 255, linear, one channel (grey), levels 0-2, one file
Encodes are cached by the SHA-256 of their source and settings in .cache/assets/ktx2/; output names carry the
first 8 hex digits of the file's own SHA-256. public/atlases/ is owned by the build: stale .ktx2 files go.
"""

import argparse
import hashlib
import os
import shutil
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import dds  # noqa: E402

ATLASES = os.path.join(K.PUBLIC, 'atlases')
SHEETS = os.path.join(K.PUBLIC, 'sheets')
KTX_CACHE = os.path.join(K.CACHE, 'ktx2')
ENCODE = {
    'xubc7': ['-xubc7', '-quality', '90'],
    'etc1s': ['-etc1s', '-q', '255', '-linear'],
}
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


def as_rgba(lv):
    if lv.ndim == 2 or lv.shape[2] == 1:
        g = lv.reshape(lv.shape[0], lv.shape[1])
        return np.stack([g, g, g, np.full_like(g, 255)], -1)
    return lv


def encode(levels, codec, tag):
    """basisu over a mipmapped DDS of `levels`; cached by content. Returns the KTX2 bytes."""
    os.makedirs(KTX_CACHE, exist_ok=True)
    h = hashlib.sha256()
    h.update(codec.encode())
    h.update(' '.join(ENCODE[codec]).encode())
    for lv in levels:
        h.update(str(lv.shape).encode())
        h.update(np.ascontiguousarray(lv).tobytes())
    key = h.hexdigest()
    out = os.path.join(KTX_CACHE, key + '.ktx2')
    if not os.path.exists(out):
        src = os.path.join(KTX_CACHE, key + '.dds')
        dds.write_dds(src, [as_rgba(lv) for lv in levels])
        r = subprocess.run(['basisu', '-ktx2', '-no_stats'] + ENCODE[codec] + [src, '-output_file', out + '.tmp.ktx2'],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f'basisu failed on {tag}:\n{r.stdout[-2000:]}{r.stderr[-2000:]}')
        os.replace(out + '.tmp.ktx2', out)
        os.remove(src)
    with open(out, 'rb') as f:
        return f.read()


def publish(data, stem, suffix):
    sha = hashlib.sha256(data).hexdigest()
    name = f'{stem}.{sha[:8]}{suffix}.ktx2'
    path = os.path.join(ATLASES, name)
    if not os.path.exists(path):
        with open(path + '.tmp', 'wb') as f:
            f.write(data)
        os.replace(path + '.tmp', path)
    return f'atlases/{name}', len(data), sha


def webp_lossless(rgba_straight, path_stem):
    os.makedirs(SHEETS, exist_ok=True)
    tmp = os.path.join(K.CACHE, 'sheet.tmp.png')
    K.write_png(tmp, rgba_straight)
    out_tmp = os.path.join(K.CACHE, 'sheet.tmp.webp')
    subprocess.run(['cwebp', '-quiet', '-lossless', '-z', '9', '-exact', '-metadata', 'none', tmp, '-o', out_tmp],
                   check=True)
    with open(out_tmp, 'rb') as f:
        data = f.read()
    sha = hashlib.sha256(data).hexdigest()
    name = f'{path_stem}.{sha[:8]}.webp'
    shutil.move(out_tmp, os.path.join(SHEETS, name))
    os.remove(tmp)
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
    pages_out = []
    keep = set()
    for page in layout['pages']:
        arr = layout['arrays'][page['array']]
        img = compose(page, arr)
        lv = levels_of(img, arr['levels'])
        stem = f'{arr["kind"]}-{page["group"].replace("/", "-")}-{page["index"]}'
        files, nbytes, shas = [], [], []
        if arr['kind'] == 'colour':
            for part, levels, suffix in (('h', lv[:1], '.h'), ('n', lv[1:], '.n')):
                data = encode(levels, arr['codec'], f'{stem}.{part}')
                fn, nb, sha = publish(data, stem, suffix)
                files.append(fn)
                nbytes.append(nb)
                shas.append(sha)
        else:
            data = encode(lv, arr['codec'], stem)
            fn, nb, sha = publish(data, stem, '')
            files.append(fn)
            nbytes.append(nb)
            shas.append(sha)
        keep.update(os.path.basename(f) for f in files)
        # the decoded source levels, for the checks (the uncompressed truth the encode is measured against)
        src_dir = os.path.join(K.CACHE, 'pages')
        os.makedirs(src_dir, exist_ok=True)
        for i, level in enumerate(lv):
            K.write_png(os.path.join(src_dir, f'{stem}.L{i}.png'), level.astype(np.float32) / 255.0)
        pages_out.append(dict(array=page['array'], group=page['group'], index=page['index'], files=files,
                              bytes=nbytes, sha256=shas, stem=stem))
        print(f'[assemble] {stem}: {len(page["cells"])} cells, {sum(nbytes) / 1e3:.0f} kB', flush=True)
    for f in os.listdir(ATLASES):
        if f.endswith('.ktx2') and f not in keep and not f.startswith('terrain-'):
            os.remove(os.path.join(ATLASES, f))
    for f in os.listdir(SHEETS):
        if f.startswith('icons-'):
            os.remove(os.path.join(SHEETS, f))
    dom_icons, index = icon_sheets(layout)
    K.dump_json(a.out, dict(pages=pages_out, dom=dict(icons=dom_icons, iconSheets=index)))


if __name__ == '__main__':
    main()
