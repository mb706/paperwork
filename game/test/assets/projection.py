"""The projection calibration test (10 §9.1, §15.7): a rendered calibration grid lands exactly on the tiles.

    gamedev-python game/test/assets/projection.py [--no-render]

1. Renders calibration_model.py with the build's own rig (Blender, pinned to socket 1): a unit cube in flat
   calibration colours and a chequered 3 x 2 ground plate east of it.
2. Measures the raw colour pass by coverage moments (sub-pixel; each pixel unmixed into the calibration colours):
   the cube's top face must be 64 x 64 px and its south face 64 px tall, within 1 px, and both must sit where the
   projection col = ax + 64 x, row = ay - 64 (y + z) puts them, within 1 px.
3. Runs the post step (ink, trim, anchor) and places the trimmed frame with the renderer's formula (10 §15.7:
   left = (ex - cx) S - ax k, k = S / P) at a tile, at (zoom, dpr) = (1, 1), (2, 1), (1, 2), (2, 2), (0.5, 1): the
   top face must cover the screen rectangle the world geometry projects to, and every edge of the chequered plate
   must fall on a tile line, within 1 device px.
Writes .cache/assets/qc/calibration.png (the placements over a drawn tile grid) and calibration.json; exits
non-zero on a failure.
"""

import argparse
import json
import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(GAME, 'scripts', 'assets'))
import common as K  # noqa: E402
import post as PO  # noqa: E402
from lib import style as S  # noqa: E402

OUT = os.path.join(K.CACHE, 'calibration')
QC = os.path.join(K.CACHE, 'qc')
BLENDER = os.environ.get('PAPERWORK_BLENDER', os.path.expanduser('~/.local/opt/blender-current/blender'))
TOL = 1.0
CAL = {k: K.hexc(S.SURVEY_MATS[k][0]) for k in ('calib_top', 'calib_south', 'calib_side')}


def render():
    os.makedirs(OUT, exist_ok=True)
    jobs = os.path.join(OUT, 'jobs.json')
    with open(jobs, 'w') as f:
        json.dump([dict(set='entity/calibration', kind='entity', script=os.path.join(HERE, 'calibration_model.py'),
                        out=os.path.join(OUT, 'render'), style='survey')], f)
    subprocess.run(['taskset', '-c', '8-15,24-31', BLENDER, '-b', '--factory-startup', '-noaudio', '--python',
                    os.path.join(K.BLENDER_SRC, 'render.py'), '--', '--jobs', jobs, '--threads', '16'],
                   check=True, capture_output=True)


def unmix(rgba):
    """Per-pixel coverage of the three calibration colours (premultiplied unmixing, least squares)."""
    pm = rgba[..., :3] * rgba[..., 3:4]
    M = np.stack([CAL['calib_top'], CAL['calib_south'], CAL['calib_side']], 1)       # 3 x 3
    cov = np.linalg.lstsq(M, pm.reshape(-1, 3).T, rcond=None)[0].T.reshape(rgba.shape[:2] + (3,))
    return np.clip(cov, 0, 1)


def moments(cov):
    """Area, centroid and the width and height of a rectangle with this coverage's second moments."""
    a = cov.sum()
    if a <= 0:
        return None
    yy, xx = np.mgrid[0:cov.shape[0], 0:cov.shape[1]].astype(np.float64)
    cx, cy = (xx * cov).sum() / a + 0.5, (yy * cov).sum() / a + 0.5
    vx = ((xx + 0.5 - cx) ** 2 * cov).sum() / a
    vy = ((yy + 0.5 - cy) ** 2 * cov).sum() / a
    return dict(area=a, cx=cx, cy=cy, w=math.sqrt(12 * vx), h=math.sqrt(12 * vy))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-render', action='store_true')
    a = ap.parse_args()
    if not a.no_render:
        render()
    rdir = os.path.join(OUT, 'render')
    rec = K.load_json(os.path.join(rdir, 'record.json'))
    combo = rec['combos'][0]
    ax, ay = combo['anchor']
    colour = K.read_png(os.path.join(rdir, combo['base']['colour']))
    cov = unmix(colour)
    # the cube alone: columns west of the plate (which starts at x = 1 tile; its paper and steel are not
    # calibration colours, and least squares would smear them into the faces)
    cov[:, int(ax + S.PX_HIGH):] = 0.0             # the cube spans ax +- 32 px, the plate starts at ax + 96
    res, fails = {}, []
    top = moments(cov[..., 0])
    south = moments(cov[..., 1])
    px = S.PX_HIGH
    expect = dict(top=dict(w=px, h=px, cx=ax, cy=ay - px), south=dict(w=px, h=px, cx=ax, cy=ay))
    for name, m in (('top', top), ('south', south)):
        e = expect[name]
        res[f'render {name}'] = {k: round(m[k], 3) for k in ('w', 'h', 'cx', 'cy')}
        for k in ('w', 'h', 'cx', 'cy'):
            if abs(m[k] - e[k]) > TOL:
                fails.append(f'render: the {name} face\'s {k} is {m[k]:.2f} px, expected {e[k]} +- {TOL}')
    # through the post step and the renderer's placement formula
    pdir = os.path.join(OUT, 'post')
    PO.run(rdir, pdir, os.path.join(HERE, 'calibration_model.py'))
    sd = K.load_json(os.path.join(pdir, 'set.json'))
    f0 = sd['frames'][sd['parts']['base']['table'][0][0]]
    img = K.read_png(os.path.join(pdir, f0['file']))
    pad = f0['pad']
    inked = img[pad:pad + f0['h'], pad:pad + f0['w']]
    # the placement is measured on the raw colour cut to the post step's frame (its trim and anchor), since the
    # ink's lines would blur the calibration colours' edges; the inked frame must keep the same silhouette
    x0, y0, x1, y1 = f0['rect']
    frame = K.premul(colour)[y0:y1, x0:x1]
    for name, im_ in (('raw', frame), ('inked', inked)):
        ys, xs = np.nonzero(im_[..., 3] > 0.5)
        res[f'{name} frame silhouette'] = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
    # the silhouette line is centred on the edge, so it reaches about half its width (2 px at High) outside the
    # render on every side, evenly: the sprite's visual centre stays where the geometry is
    r_, i_ = res['raw frame silhouette'], res['inked frame silhouette']
    ext = [r_[0] - i_[0], r_[1] - i_[1], i_[2] - r_[2], i_[3] - r_[3]]
    res['ink reach outside the render px (w, n, e, s)'] = ext
    if min(ext) < 0 or max(ext) > 3 or abs(ext[0] - ext[2]) > 1 or abs(ext[1] - ext[3]) > 1:
        fails.append(f'post: the inked silhouette {i_} is not the render\'s {r_} grown evenly by its line')
    tiles = []
    for zoom, dpr in ((1, 1), (2, 1), (1, 2), (2, 2), (0.5, 1)):
        Sx = 32 * zoom * dpr
        k = Sx / px
        cam = (2.0, 0.5)                                  # camera centre (tiles)
        ex, ey = 0.5, 0.5                                 # the cube's footprint centre: tile (0, 0)
        W, H = int(8 * Sx), int(8 * Sx)
        canvas = np.zeros((H, W, 4), np.float32)
        left = (ex - cam[0]) * Sx - f0['ax'] * k + W / 2
        top_ = (ey - cam[1]) * Sx - f0['ay'] * k + H / 2
        if abs(k - round(k)) < 1e-9 and k >= 1:
            src = np.repeat(np.repeat(frame, int(k), 0), int(k), 1)
        else:
            src = frame
            f = int(round(1 / k))
            for _ in range(int(round(math.log2(f)))):
                src = K.box_down(src, 2)
        l0, t0 = int(round(left)), int(round(top_))
        if abs(left - l0) > 1e-6 or abs(top_ - t0) > 1e-6:
            fails.append(f'placement zoom {zoom} dpr {dpr}: the quad lands off the pixel grid ({left}, {top_})')
        h, w = src.shape[:2]
        if t0 < 0 or l0 < 0 or t0 + h > H or l0 + w > W:
            fails.append(f'placement zoom {zoom} dpr {dpr}: the quad {l0},{t0} {w}x{h} leaves the {W}x{H} canvas')
        y0c, x0c, y1c, x1c = max(t0, 0), max(l0, 0), min(t0 + h, H), min(l0 + w, W)
        canvas[y0c:y1c, x0c:x1c] = src[y0c - t0:y1c - t0, x0c - l0:x1c - l0]
        c = unmix(K.unpremul(canvas))
        c[:, int((1.5 - cam[0]) * Sx + W / 2):] = 0.0             # the cube alone (world x 0..1), as above
        m = moments(c[..., 0] * (canvas[..., 3] > 0.5))
        # the top face's world rectangle (x 0..1, y 0..1 south-down, z = 1) on the screen
        ex0, ey0 = (0 - cam[0]) * Sx + W / 2, (0 - cam[1]) * Sx - 1 * Sx + H / 2
        want = dict(cx=ex0 + Sx / 2, cy=ey0 + Sx / 2, w=Sx, h=Sx)
        got = {kk: m[kk] for kk in ('w', 'h', 'cx', 'cy')}
        res[f'placed top face zoom {zoom} dpr {dpr}'] = dict(got={kk: round(v, 3) for kk, v in got.items()},
                                                            want=want)
        tol = max(TOL, 1.0 / k if k < 1 else TOL)
        for kk in ('w', 'h', 'cx', 'cy'):
            if abs(got[kk] - want[kk]) > tol + (1.5 if kk in ('w', 'h') else 0) * 0:
                fails.append(f'placement zoom {zoom} dpr {dpr}: top face {kk} {got[kk]:.2f}, want {want[kk]:.2f}')
        # the chequered plate: its paper/dark edges must lie on tile lines (columns at multiples of S from x = 0)
        gray = K.over_paper(canvas)[..., 1]
        x_tiles = [(tx - cam[0]) * Sx + W / 2 for tx in (2, 3, 4, 5)]    # the plate covers world x 2..5
        row = int((0.5 - cam[1]) * Sx + H / 2)           # a ground row through the plate's north tiles
        prof = gray[row]
        edges = np.nonzero(np.abs(np.diff(prof)) > 0.25)[0] + 1
        for xt in x_tiles:
            if len(edges) == 0 or np.min(np.abs(edges - xt)) > TOL:
                fails.append(f'placement zoom {zoom} dpr {dpr}: no chequer edge at the tile line x = {xt:.1f}')
        tiles.append((zoom, dpr, K.over_paper(canvas), Sx, cam, W, H))
    # the review image: each placement with its tile grid
    panels = []
    for zoom, dpr, rgb, Sx, cam, W, H in tiles:
        im = Image.fromarray(K.to8(rgb)).convert('RGB')
        d = ImageDraw.Draw(im)
        for tx in range(-4, 10):
            x = (tx - cam[0]) * Sx + W / 2
            d.line([(x, 0), (x, H)], fill=(80, 140, 220), width=1)
        for ty in range(-4, 10):
            y = (ty - cam[1]) * Sx + H / 2
            d.line([(0, y), (W, y)], fill=(80, 140, 220), width=1)
        d.text((4, 2), f'zoom {zoom} dpr {dpr}', fill=(180, 40, 40))
        panels.append(im)
    Wt = sum(p.width for p in panels) + 8 * len(panels)
    Ht = max(p.height for p in panels)
    sheet = Image.new('RGB', (Wt, Ht), (255, 255, 255))
    x = 0
    for p in panels:
        sheet.paste(p, (x, 0))
        x += p.width + 8
    os.makedirs(QC, exist_ok=True)
    sheet.save(os.path.join(QC, 'calibration.png'))
    res['failures'] = fails
    K.dump_json(os.path.join(QC, 'calibration.json'), res)
    for k, v in res.items():
        if k != 'failures':
            print(f'[calibration] {k}: {v}')
    print(f'[calibration] {len(fails)} failure(s)' + ''.join(f'\n  {f}' for f in fails))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
