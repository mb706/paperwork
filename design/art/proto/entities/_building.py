"""Shared helpers for town buildings (era skin 1: W < 15, the 1940s)."""

import math


def windows(P, x0, x1, y, z0, z1, cols, rows, face='S', mat='glass_dark', trim='trim_white', w=0.34, h=0.5,
            depth=0.03):
    """A grid of windows on a wall plane. face S: wall at y (south face, normal -y); face E: wall at x=y."""
    o = []
    for r in range(rows):
        zc = z0 + (r + 0.5) * (z1 - z0) / rows
        for c in range(cols):
            xc = x0 + (c + 0.5) * (x1 - x0) / cols
            if face == 'S':
                o.append(P.box(w + 0.08, depth, h + 0.08, xc, y - depth / 2, zc - h / 2 - 0.04, mat=trim, bevel=0.0))
                o.append(P.box(w, depth, h, xc, y - depth, zc - h / 2, mat=mat, bevel=0.0))
                o.append(P.box(0.03, depth, h, xc, y - depth * 1.2, zc - h / 2, mat=trim, bevel=0.0))
            else:
                o.append(P.box(depth, w + 0.08, h + 0.08, y + depth / 2, xc, zc - h / 2 - 0.04, mat=trim, bevel=0.0))
                o.append(P.box(depth, w, h, y + depth, xc, zc - h / 2, mat=mat, bevel=0.0))
    return o


def hall(P, sx, sy, storeys, x=0.0, y=0.0, roof='hip', wall='brick', roof_mat='slate', storey_h=1.05,
         win_cols=None, cupola=False, door=True):
    o = []
    H = storeys * storey_h
    o.append(P.box(sx, sy, 0.25, x, y, 0.0, mat='quartz_stone', bevel=0.02, name='base'))
    o.append(P.box(sx - 0.1, sy - 0.1, H, x, y, 0.25, mat=wall, bevel=0.02, name='walls'))
    o.append(P.box(sx + 0.06, sy + 0.06, 0.12, x, y, 0.25 + H, mat='trim_white', bevel=0.015, name='cornice'))
    zt = 0.37 + H
    if roof == 'hip':
        o.append(P.hip_roof(sx, sy, min(sx, sy) * 0.32, x, y, zt, mat=roof_mat, overhang=0.12))
    elif roof == 'gable_x':
        o.append(P.prism(sx, sy, sy * 0.38, x, y, zt, mat=roof_mat, ridge='X', overhang=0.12))
    elif roof == 'gable_y':
        o.append(P.prism(sx, sy, sx * 0.38, x, y, zt, mat=roof_mat, ridge='Y', overhang=0.12))
    else:
        o.append(P.box(sx - 0.1, sy - 0.1, 0.08, x, y, zt, mat='slate', bevel=0.0))
    cols = win_cols or max(2, int(sx / 0.9))
    o += windows(P, x - sx / 2 + 0.3, x + sx / 2 - 0.3, y - sy / 2 + 0.05, 0.45, 0.25 + H - 0.1, cols, storeys)
    if door:
        o.append(P.box(0.55, 0.06, 0.95, x, y - sy / 2 - 0.02, 0.25, mat='wood', bevel=0.01, name='door'))
        o.append(P.box(0.85, 0.10, 0.12, x, y - sy / 2 - 0.04, 1.20, mat='trim_white', bevel=0.01, name='pediment'))
    if cupola:
        ch = min(sx, sy) * 0.32
        o.append(P.box(0.7, 0.7, 0.6, x, y, zt + ch - 0.25, mat='trim_white', bevel=0.02, name='cupola'))
        o.append(P.cone(0.55, 0.9, x, y, zt + ch + 0.35, mat='copper', seg=8))
    return o
