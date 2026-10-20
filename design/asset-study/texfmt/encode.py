"""B2 texture-format study, step 2: encode the atlas pages in every candidate format, decode them
back the way the GPU will see them, and measure size and quality.

    taskset -c 0-7 gamedev-python -I design/asset-study/texfmt/encode.py [--pages colour-high,...] [--only v1,v2]

Inputs: design/art/out/texfmt/pages/*.png (make_pages.py). Outputs (gitignored):
design/art/out/texfmt/enc/<page>/<variant>.<ext>, decoded PNGs, results.json, and crops/*.png.

Variants (level 0 only, no mipmaps, so sizes compare like for like; mip overhead is reported apart):
  png         oxipng -o 4, lossless (RGBA8 on the GPU)
  webp-ll     cwebp -lossless -z 9 -exact (RGBA8)
  webp-q{80,90,95}  cwebp -q N -alpha_q 100 -exact -m 6 (A3's budget setting is q90); RGBA8 on the GPU
  webp-q90s   as q90 plus -sharp_yuv
  etc1s-q{128,255}   KTX2 ETC1S (basisu -q), transcoded to BC7 for the comparison
  uastc       KTX2 UASTC LDR 4x4, level 2, Zstandard 6 (BC7 on the GPU)
  uastc-rdo{1,3}     UASTC with RDO lambda 1 / 3, Zstandard 18
  xubc7-{ll,q90,q75} KTX2 XUBC7 (basisu 2.5), lossless / quality 90 / 75 (BC7 directly)
  xuastc4-q{90,75}   KTX2 XUASTC LDR 4x4 with weight-grid DCT quality 90 / 75 (BC7 or ASTC 4x4)
Quality is measured on the decoded RGBA (BC7 for every Basis variant: the desktop GPU format),
composited over the survey paper (#ece3cb) as the ground will show it: PSNR, SSIM (luma), CIELAB
dE76 mean and p99, alpha PSNR, and the detail retention of ink lines and hatching (band-pass
energy kept inside the original's top-20 % detail pixels; 1.0 = kept, < 1 = mushed, > 1 = noise).
"""

import argparse
import gzip
import json
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PAGES = os.path.join(ROOT, 'design', 'art', 'out', 'texfmt', 'pages')
ENC = os.path.join(ROOT, 'design', 'art', 'out', 'texfmt', 'enc')
PAPER = np.array([0xec, 0xe3, 0xcb], np.float32) / 255.0

try:
    import brotli  # noqa: F401
except ImportError:
    brotli = None

VARIANTS = {
    'png': ('png', None),
    'webp-ll': ('webp', ['-lossless', '-z', '9', '-exact']),
    'webp-q80': ('webp', ['-q', '80', '-alpha_q', '100', '-exact', '-m', '6']),
    'webp-q90': ('webp', ['-q', '90', '-alpha_q', '100', '-exact', '-m', '6']),
    'webp-q95': ('webp', ['-q', '95', '-alpha_q', '100', '-exact', '-m', '6']),
    'webp-q90s': ('webp', ['-q', '90', '-alpha_q', '100', '-exact', '-m', '6', '-sharp_yuv']),
    'etc1s-q128': ('ktx2', ['-etc1s', '-q', '128']),
    'etc1s-q255': ('ktx2', ['-etc1s', '-q', '255']),
    'uastc': ('ktx2', ['-uastc', '-uastc_level', '2']),
    'uastc-rdo1': ('ktx2', ['-uastc', '-uastc_level', '2', '-uastc_rdo_l', '1', '-ktx2_zstandard_level', '18']),
    'uastc-rdo3': ('ktx2', ['-uastc', '-uastc_level', '2', '-uastc_rdo_l', '3', '-ktx2_zstandard_level', '18']),
    'xubc7-ll': ('ktx2', ['-xubc7', '-quality', '100']),
    'xubc7-q90': ('ktx2', ['-xubc7', '-quality', '90']),
    'xubc7-q75': ('ktx2', ['-xubc7', '-quality', '75']),
    'xuastc4-q90': ('ktx2', ['-ldr_4x4i', '-quality', '90']),
    'xuastc4-q75': ('ktx2', ['-ldr_4x4i', '-quality', '75']),
}


def read(path):
    im = Image.open(path)
    if im.mode in ('P', 'PA'):
        im = im.convert('RGBA')
    elif im.mode == 'LA':
        im = im.convert('RGBA')
    a = np.asarray(im).astype(np.float32) / 255.0
    if a.ndim == 2:
        a = a[..., None]
    return a


def to_rgba(a):
    if a.shape[2] == 1:       # R8 shadow pages: compare the single channel
        return a
    if a.shape[2] == 3:
        return np.concatenate([a, np.ones(a.shape[:2] + (1,), np.float32)], -1)
    return a


def srgb_lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883], np.float32)
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def ssim(x, y):
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    g = lambda z: ndi.gaussian_filter(z, 1.5)
    mx, my = g(x), g(y)
    sxx, syy, sxy = g(x * x) - mx * mx, g(y * y) - my * my, g(x * y) - mx * my
    return ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx * mx + my * my + c1) * (sxx + syy + c2))


def metrics(orig, dec):
    o, d = to_rgba(orig), to_rgba(dec)
    out = {}
    if o.shape[2] == 1:
        mask = ndi.binary_dilation((o[..., 0] > 0) | (d[..., 0] > 0), iterations=2)
        err = (o[..., 0] - d[..., 0])[mask]
        out['psnr'] = round(float(10 * np.log10(1.0 / max(np.mean(err ** 2), 1e-12))), 2)
        return out
    co = o[..., :3] + (1 - o[..., 3:4]) * PAPER
    cd = d[..., :3] + (1 - d[..., 3:4]) * PAPER
    mask = ndi.binary_dilation((o[..., 3] > 0) | (d[..., 3] > 0), iterations=2)
    err = (co - cd)[mask]
    out['psnr'] = round(float(10 * np.log10(1.0 / max(np.mean(err ** 2), 1e-12))), 2)
    ea = (o[..., 3] - d[..., 3])[mask]
    out['psnr_alpha'] = round(float(10 * np.log10(1.0 / max(np.mean(ea ** 2), 1e-12))), 2)
    lo = srgb_lab(np.clip(co, 0, 1))
    ld = srgb_lab(np.clip(cd, 0, 1))
    de = np.sqrt(((lo - ld) ** 2).sum(-1))[mask]
    out['dE_mean'] = round(float(de.mean()), 3)
    out['dE_p99'] = round(float(np.percentile(de, 99)), 2)
    yo, yd = lo[..., 0] / 100, ld[..., 0] / 100
    out['ssim'] = round(float(ssim(yo, yd)[mask].mean()), 4)
    # detail retention: band-pass (DoG 0.7/2.0 px) energy inside the original's top-20 % detail pixels
    bo = ndi.gaussian_filter(yo, 0.7) - ndi.gaussian_filter(yo, 2.0)
    bd = ndi.gaussian_filter(yd, 0.7) - ndi.gaussian_filter(yd, 2.0)
    eo = ndi.gaussian_filter(bo * bo, 2.0)
    thr = np.percentile(eo[mask], 80)
    dm = mask & (eo >= thr)
    out['detail_keep'] = round(float(np.sqrt((bd[dm] ** 2).sum() / max((bo[dm] ** 2).sum(), 1e-12))), 3)
    out['detail_dE_mean'] = round(float(np.sqrt(((lo - ld) ** 2).sum(-1))[dm].mean()), 3)
    return out


def comp_sizes(path):
    raw = open(path, 'rb').read()
    s = dict(bytes=len(raw), gzip=len(gzip.compress(raw, 9)))
    if brotli is not None:
        s['brotli'] = len(brotli.compress(raw, quality=11))
    return s


def run(cmd):
    t = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(' '.join(cmd) + '\n' + r.stdout[-2000:] + r.stderr[-2000:])
    return time.time() - t


def encode(page, variant, src, outdir):
    kind, args = VARIANTS[variant]
    base = os.path.join(outdir, variant)
    if kind == 'png':
        dst = base + '.png'
        import shutil
        shutil.copy(src, dst)
        dt = run(['oxipng', '-q', '-o', '4', '--strip', 'safe', dst])
        dec = read(dst)
        orig = read(src)
        dec = dec[..., :orig.shape[2]] if dec.shape[2] >= orig.shape[2] else dec
    elif kind == 'webp':
        dst = base + '.webp'
        if read(src).shape[2] == 1:
            return None          # single-channel pages: WebP has no R8 mode; skip
        dt = run(['cwebp', '-quiet', '-mt'] + args + [src, '-o', dst])
        decp = base + '.dec.png'
        run(['dwebp', '-quiet', dst, '-o', decp])
        dec = read(decp)
    else:
        dst = base + '.ktx2'
        extra = ['-linear'] if page.startswith('shadow') else []
        dt = run(['basisu', '-ktx2', '-no_stats'] + args + extra + [src, '-output_file', dst])
        udir = base + '.unpack'
        os.makedirs(udir, exist_ok=True)
        run(['basisu', '-unpack', '-format_only', '6', '-no_ktx', dst, '-output_path', udir])
        lv0 = lambda f: 'level_0_' in f or 'level_' not in f
        cand = [f for f in os.listdir(udir) if '_rgba_' in f and lv0(f)] or \
               [f for f in os.listdir(udir) if '_rgb_' in f and lv0(f)]
        dec = read(os.path.join(udir, sorted(cand)[0]))
        orig = read(src)
        if orig.shape[2] == 1:
            dec = dec[..., :1]
        elif orig.shape[2] == 3:
            dec = dec[..., :3]
    return dst, dt, dec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pages', default='colour-high,colour-normal,icons,shadow-normal,terrain-grass,terrain-dirt')
    ap.add_argument('--only', default=None)
    a = ap.parse_args()
    resf = os.path.join(ENC, 'results.json')
    results = json.load(open(resf)) if os.path.exists(resf) else {}
    for page in a.pages.split(','):
        src = os.path.join(PAGES, f'{page}.png')
        orig = read(src)
        outdir = os.path.join(ENC, page)
        os.makedirs(outdir, exist_ok=True)
        info = json.load(open(os.path.join(PAGES, 'pages.json')))[page]
        h, w = orig.shape[:2]
        for v in (a.only.split(',') if a.only else VARIANTS):
            r = encode(page, v, src, outdir)
            if r is None:
                continue
            dst, dt, dec = r
            m = metrics(orig, dec)
            s = comp_sizes(dst)
            s['bpp_page'] = round(8 * s['bytes'] / (w * h), 3)
            s['bpp_content'] = round(8 * s['bytes'] / info['content_px'], 3)
            results.setdefault(page, {})[v] = dict(encode_s=round(dt, 2), **s, **m)
            print(page, v, results[page][v], flush=True)
            json.dump(results, open(resf, 'w'), indent=1)


if __name__ == '__main__':
    main()
