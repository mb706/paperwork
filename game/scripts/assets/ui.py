"""The UI skin (10 §9.3; A3 §12): 9-slice parts, the paper fibre, the glyph sprite and the fonts' CSS.

    gamedev-python game/scripts/assets/ui.py --out .cache/assets/ui.json

Only the skin changes; the layout is Factorio's (10 §7.4). Sources are SVG in game/assets/svg/ui/ (each root
declares data-slice="top right bottom left" in px and data-repeat, CSS's border-image-repeat) and
game/assets/svg/glyphs/ (24 x 24, drawn in currentColor). Outputs in public/sheets/:
  ui-skin.<hash8>.css   custom properties --pw-<part> holding each part as an SVG data URI, classes .pw-<part>
                        that apply it as a border-image 9-slice (or a background for fixed parts), the palette as
                        --pw-c-<name>, and the @font-face rules of the fonts (fonts.json); one request, vector-
                        crisp at every device pixel ratio and UI scale
  paper-fibre.<hash8>.webp   a 256 x 256 periodic fibre overlay (RGBA, WebP q85) for frames and cards
  glyphs.<hash8>.svg    one <symbol id="g-<name>"> per glyph, for <svg><use href="…#g-name"/></svg>
A raster sheet of every part at 1x and 2x (resvg) goes to .cache/assets/qc/ for review.

Deviation from 10 §9.3's letter ("resvg renders them at 1x and 2x into one UI sheet (WebP lossless), which CSS
uses as border-image 9-slices"): CSS border-image slices a whole image and cannot address a sub-rectangle of a
sheet, so the parts ship as SVG inside the stylesheet; the rasters remain the QC record.
"""

import argparse
import glob
import hashlib
import os
import re
import subprocess
import sys
import urllib.parse

import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402

SHEETS = os.path.join(K.PUBLIC, 'sheets')
QC = os.path.join(K.CACHE, 'qc')
PALETTE = {
    'ink': '#2b2723', 'paper': '#ece3cb', 'manila': '#cdb27a', 'manila-hi': '#e6d3a2', 'manila-lo': '#6f5a36',
    'card': '#f4ecd8', 'rule': '#a9bfd0', 'slot': '#f8f2e1', 'slot-edge': '#8f7f62', 'red': '#b5352a',
    'green': '#4f7a3c', 'text': '#2b2723', 'text-dim': '#5d5345', 'title': '#2b2723', 'disabled': '#9a8c70',
}
FIXED = {'checkbox', 'checkbox-checked', 'radio', 'radio-checked'}
TILES = {'progress-fill', 'progress-fill-red', 'title-rule'}


def parse(path):
    s = open(path).read()
    m = re.search(r'width="([\d.]+)" height="([\d.]+)"', s)
    sl = re.search(r'data-slice="([\d. ]+)"', s)
    rp = re.search(r'data-repeat="(\w+)"', s)
    desc = re.search(r'<desc>(.*?)</desc>', s, re.S)
    return dict(name=os.path.basename(path)[:-4], svg=s, w=float(m.group(1)), h=float(m.group(2)),
                slice=[float(x) for x in sl.group(1).split()], repeat=rp.group(1),
                desc=desc.group(1).strip() if desc else '')


def minify(svg):
    svg = re.sub(r'<desc>.*?</desc>', '', svg, flags=re.S)
    svg = re.sub(r' data-(slice|repeat)="[^"]*"', '', svg)
    return re.sub(r'\s+', ' ', svg).replace('> <', '><').strip()


def data_uri(svg):
    return 'data:image/svg+xml,' + urllib.parse.quote(minify(svg), safe=' =:/,;.-')


def fmt(v):
    return str(int(v)) if float(v).is_integer() else str(v)


def fibre():
    """A periodic 256 x 256 overlay: fine paper tooth and long fibres in manila brown, alpha 0..~0.2."""
    n = 256
    rng = np.random.default_rng(12)
    g = lambda a, s: ndi.gaussian_filter(a, s, mode='wrap')  # noqa: E731
    tooth = g(rng.standard_normal((n, n)).astype(np.float32), 0.7)
    f1 = g(rng.standard_normal((n, n)).astype(np.float32), (0.6, 6.0))
    f2 = g(rng.standard_normal((n, n)).astype(np.float32), (5.0, 0.6))
    v = 0.5 * tooth / tooth.std() + 0.9 * f1 / f1.std() + 0.6 * f2 / f2.std()
    a = np.clip((v - 0.6) * 0.09, 0, 0.22)
    rgb = np.ones((n, n, 3), np.float32) * K.hexc('#6f5a36')
    return np.concatenate([rgb, a[..., None]], -1)


def publish(data, stem, ext):
    sha = hashlib.sha256(data).hexdigest()
    name = f'{stem}.{sha[:8]}.{ext}'
    with open(os.path.join(SHEETS, name), 'wb') as f:
        f.write(data)
    return f'sheets/{name}', len(data), sha


def qc_sheet(parts):
    """Every part rendered by resvg at 1x and 2x on the paper, for review."""
    os.makedirs(QC, exist_ok=True)
    from PIL import Image
    tiles = []
    for p in parts:
        for z in (1, 2):
            out = os.path.join(QC, f'ui-{p["name"]}@{z}x.png')
            subprocess.run(['resvg', '--zoom', str(z), os.path.join(K.SVG_SRC, 'ui', p['name'] + '.svg'), out],
                           check=True, capture_output=True)
            tiles.append((p['name'], z, K.read_png(out)))
    W = 1400
    x = y = row_h = 8
    canvas = np.ones((2000, W, 3), np.float32) * K.hexc(K.PAPER_HEX)
    for name, z, im in tiles:
        h, w = im.shape[:2]
        if x + w + 8 > W:
            x, y = 8, y + row_h + 8
            row_h = 0
        reg = canvas[y:y + h, x:x + w]
        reg[...] = im[..., :3] * im[..., 3:4] + reg * (1 - im[..., 3:4])
        x += w + 8
        row_h = max(row_h, h)
    canvas = canvas[:y + row_h + 8]
    Image.fromarray(K.to8(canvas)).save(os.path.join(QC, 'ui-sheet.png'))
    for f in glob.glob(os.path.join(QC, 'ui-*@*x.png')):
        os.remove(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    os.makedirs(SHEETS, exist_ok=True)
    for f in os.listdir(SHEETS):
        if f.startswith(('ui-skin.', 'paper-fibre.', 'glyphs.')):
            os.remove(os.path.join(SHEETS, f))
    parts = [parse(p) for p in sorted(glob.glob(os.path.join(K.SVG_SRC, 'ui', '*.svg')))]
    files = []
    # the fibre
    tmp = os.path.join(K.CACHE, 'fibre.png')
    K.write_png(tmp, fibre())
    subprocess.run(['cwebp', '-quiet', '-q', '85', '-alpha_q', '100', '-exact', '-metadata', 'none', tmp, '-o',
                    tmp + '.webp'], check=True)
    fib = publish(open(tmp + '.webp', 'rb').read(), 'paper-fibre', 'webp')
    files.append(dict(file=fib[0], bytes=fib[1]))
    # the glyph sprite
    syms = []
    for p in sorted(glob.glob(os.path.join(K.SVG_SRC, 'glyphs', '*.svg'))):
        body = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', open(p).read().strip())
        syms.append(f'<symbol id="g-{os.path.basename(p)[:-4]}" viewBox="0 0 24 24">{body}</symbol>')
    sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + ''.join(syms) + '</svg>\n'
    gl = publish(sprite.encode(), 'glyphs', 'svg')
    files.append(dict(file=gl[0], bytes=gl[1]))
    # the stylesheet
    css = ['/* Paperwork UI skin (generated by game/scripts/assets/ui.py from game/assets/svg/; do not edit). */',
           ':root {']
    css += [f'  --pw-c-{k}: {v};' for k, v in PALETTE.items()]
    css += [f'  --pw-fibre: url("{os.path.basename(fib[0])}");']
    css += [f'  --pw-{p["name"]}: url("{data_uri(p["svg"])}");' for p in parts]
    css += ['}']
    for p in parts:
        t, r, b, l = (fmt(v) for v in p['slice'])
        n = p['name']
        if n in FIXED:
            css.append(f'.pw-{n} {{ width: {fmt(p["w"])}px; height: {fmt(p["h"])}px; '
                       f'background: var(--pw-{n}) center / 100% 100% no-repeat; }}')
        elif n in TILES:
            css.append(f'.pw-{n} {{ background: var(--pw-{n}) 0 0 / {fmt(p["w"])}px {fmt(p["h"])}px repeat; }}')
        else:
            css.append(f'.pw-{n} {{ border-style: solid; border-width: {t}px {r}px {b}px {l}px; '
                       f'border-image: var(--pw-{n}) {t} {r} {b} {l} fill / {t}px {r}px {b}px {l}px {p["repeat"]}; }}')
    css.append('.pw-fibre { background-image: var(--pw-fibre); background-size: 256px 256px; }')
    fonts = os.path.join(K.PUBLIC, 'fonts', 'fonts.json')
    if os.path.exists(fonts):
        for f in K.load_json(fonts)['faces']:
            disp = 'block' if f['family'] == 'Libre Franklin' else 'swap'
            css.append(f"@font-face {{ font-family: '{f['family']}'; font-style: {f['style']}; font-weight: "
                       f"{f['weight']}; font-display: {disp}; src: url('../{f['file']}') format('woff2'); }}")
    skin = publish(('\n'.join(css) + '\n').encode(), 'ui-skin', 'css')
    files.append(dict(file=skin[0], bytes=skin[1]))
    qc_sheet(parts)
    out = dict(css=skin[0], fibre=fib[0], glyphs=gl[0], files=files,
               parts={p['name']: dict(size=[p['w'], p['h']], slice=p['slice'], repeat=p['repeat'], desc=p['desc'])
                      for p in parts})
    K.dump_json(a.out, out)
    print(f'[ui] {len(parts)} parts, {len(syms)} glyphs; css {skin[1] / 1e3:.1f} kB, fibre {fib[1] / 1e3:.1f} kB',
          flush=True)


if __name__ == '__main__':
    main()
