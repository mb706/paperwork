"""The renderer's fixed fx/ sets (10 §15.7's namespace table, §9.8), drawn in numpy into the post step's format.

    gamedev-python game/scripts/assets/fx.py <set name> <out dir>

fx/smoke    four inked cloud puffs (A3 §8: a working burner's chimney puffs three of them, drifting east and
            fading over 2 s): a union of circles in a pale wash with a pen contour, drawn at the puff's largest
            size, 0.34 tile in radius; the renderer scales and fades them. Kind object, axes [shape].
fx/missing  the icon drawn for an icon set that does not exist: a blank index card struck through in red (no
            text in the world). Kind icon.
"""

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import ink as I  # noqa: E402
import post as PO  # noqa: E402
from lib import style as S  # noqa: E402

SS = 4                      # supersampling for anti-aliased edges
PUFFS = (
    ((0.0, 0.0, 1.0), (-0.55, 0.25, 0.7), (0.55, 0.2, 0.75), (0.1, -0.45, 0.65)),
    ((0.0, 0.0, 1.0), (-0.6, 0.1, 0.72), (0.45, 0.3, 0.7), (-0.15, -0.5, 0.6)),
    ((0.0, 0.05, 0.95), (0.6, 0.0, 0.7), (-0.45, 0.3, 0.75), (0.2, -0.48, 0.62)),
    ((0.0, 0.0, 1.0), (-0.5, -0.2, 0.68), (0.55, 0.25, 0.72), (0.05, 0.45, 0.6), (0.3, -0.4, 0.55)),
)


def puff(circles, r_px, seed):
    R = int(r_px * 2.0) + 4
    n = 2 * R * SS
    yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) / SS - R
    du = np.full(yy.shape, 1e9, np.float32)
    for ox, oy, rr in circles:
        du = np.minimum(du, np.hypot(xx - ox * r_px, yy - oy * r_px) - rr * r_px)
    lw = max(1.2, S.PX_HIGH / 40)
    fill = np.clip(0.5 - du, 0, 1)
    line = np.clip(1.0 - np.abs(du) / lw, 0, 1)
    fill = fill.reshape(2 * R, SS, 2 * R, SS).mean(axis=(1, 3))
    line = line.reshape(2 * R, SS, 2 * R, SS).mean(axis=(1, 3))
    wash = K.hexc('#e6e1d6')
    ink = K.hexc(K.INK_HEX)
    grain = I.paper_grain(2 * R, 2 * R, seed, 0.05)
    a_fill = fill * 0.85
    a_line = line * 0.55 * 0.9
    rgb = wash * grain[..., None]
    a = a_line + a_fill * (1 - a_line)
    col = (ink * a_line[..., None] + rgb * (a_fill * (1 - a_line))[..., None]) / np.maximum(a, 1e-6)[..., None]
    rgba = np.concatenate([np.clip(col, 0, 1), a[..., None]], -1)
    return K.premul(rgba), (R, R)


def smoke(out):
    store = PO.FrameStore(out)
    r_px = 0.34 * S.PX_HIGH
    ids = []
    for i, circles in enumerate(PUFFS):
        pm, anchor = puff(circles, r_px, 400 + i)
        rect = PO.trim_rect(pm[..., 3])
        ids.append([store.add('colour', pm, rect, anchor)])
    parts = {'base': dict(axes=['shape'], shape=[len(ids)], table=ids)}
    return store, parts, dict(radiusTiles=0.34)


def missing(out):
    store = PO.FrameStore(out)
    s = PO.ICON_PX
    n = s * SS
    yy, xx = (np.mgrid[0:n, 0:n].astype(np.float32) + 0.5) / SS
    x0, y0, x1, y1 = 9.0, 14.0, 55.0, 50.0
    inside = (xx > x0) & (xx < x1) & (yy > y0) & (yy < y1)
    border = inside & ~((xx > x0 + 2.2) & (xx < x1 - 2.2) & (yy > y0 + 2.2) & (yy < y1 - 2.2))
    d = np.abs((xx - x0) * (y1 - y0) - (yy - y0) * (x1 - x0)) / np.hypot(x1 - x0, y1 - y0)
    strike = inside & (d < 2.4)
    rule = inside & (np.abs(yy - (y0 + 9.0)) < 0.8) & ~border
    card = K.hexc('#f4ecd8')
    red = K.hexc('#b5352a')
    ink = K.hexc(K.INK_HEX)
    rgb = np.ones((n, n, 3), np.float32) * card
    rgb[rule] = K.hexc('#a9bfd0')
    rgb[strike] = red
    rgb[border] = ink
    a = inside.astype(np.float32)
    rgba = np.concatenate([rgb * a[..., None], a[..., None]], -1)
    pm = rgba.reshape(s, SS, s, SS, 4).mean(axis=(1, 3))
    fid = store.add('icon', pm, [0, 0, s, s], (s // 2, s // 2))
    return store, {'icon': dict(axes=[], shape=[], table=[[fid]])}, {}


def main():
    name, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    if name == 'fx/smoke':
        store, parts, extra = smoke(out)
        kind = 'object'
    elif name == 'fx/missing':
        store, parts, extra = missing(out)
        kind = 'icon'
    else:
        raise SystemExit(f'fx: unknown set {name}')
    K.dump_json(os.path.join(out, 'set.json'), dict(set=name, kind=kind, frames=store.frames, parts=parts,
                                                    extra=extra, size=[1, 1]))
    print(f'[fx] {name}: {len(store.frames)} frames', flush=True)


if __name__ == '__main__':
    main()
