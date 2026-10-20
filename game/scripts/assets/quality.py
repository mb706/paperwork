"""Per-set quality checks (10 §9.5 #2 animation, #3 geometry), on the post step's frames and the render's passes.

Animation (layered entity sets):
  composite     the base pieces plus layer frame k, drawn as the renderer draws them (premultiplied, bilinear,
                the level by scale, sub-pixel offsets), must equal frame k drawn whole: dE76 <= 0.5 on every
                pixel (B2 measured 0.00; its design/asset-study/render/pieces_check.py is the method).
  registration  inside R's outer band (8 px) every frame equals F0: nothing moving reaches R's edge.
  crop ink      frame k inked on R plus 16 px equals frame k inked whole inside R, within one 8-bit step.
  full render   frame k (k = frames / 2) made of F0 and its layer frame agrees with a full render of that frame
                (render.py's verify image) within dE76 <= 3 on 99.9 % of pixels.
  3 % rule      a machine's layers change at least 3 % of its sprite's pixels over a loop and one moving part spans
                at least 0.3 tile (A3 §9).
Geometry: a shadow's centroid lies east-south-east of its anchor (10 §9.5 #3; shadows fall as in Factorio).
check_all returns (errors, results); checks.py prints and records them.
"""

import os

import numpy as np

import common as K
import ink as I

DE_COMPOSITE = 0.5
DE_FULL, SHARE_FULL = 3.0, 0.999
# (k, sub-pixel x, y): device px per level-0 px and the quad's offset; k < 1 samples levels 1 and 2 (10 §9.5 #2:
# "at levels 0-2 and three sub-pixel offsets")
SCALES = ((1.0, 0.0, 0.0), (0.5, 0.25, 0.75), (0.73, 0.37, 0.11), (1.37, 0.5, 0.2), (2.3, 0.13, 0.61),
          (0.3, 0.4, 0.4), (0.2, 0.3, 0.6))


def lab_de(a, b):
    paper = K.hexc(K.PAPER_HEX)
    ca = a[..., :3] + (1 - a[..., 3:4]) * paper
    cb = b[..., :3] + (1 - b[..., 3:4]) * paper
    return np.sqrt(((K.lab(np.clip(ca, 0, 1)) - K.lab(np.clip(cb, 0, 1))) ** 2).sum(-1))


def level_of(img, level):
    for _ in range(level):
        img = K.box_down(img, 2)
    return img


def draw(canvas, tex, origin, rect, level, s, ox, oy):
    """Draw texture `tex` (level `level` of an image whose level-0 origin is `origin` in canvas px) for the canvas
    rectangle rect = (x0, y0, x1, y1), half-open, at scale s and offset (ox, oy): bilinear at texel centres,
    premultiplied source-over; each screen pixel whose centre lies in the rectangle is drawn once."""
    x0, y0, x1, y1 = rect
    H, W = canvas.shape[:2]
    i0, i1 = max(0, int(np.ceil(ox + x0 * s - 0.5))), min(W, int(np.ceil(ox + x1 * s - 0.5)))
    j0, j1 = max(0, int(np.ceil(oy + y0 * s - 0.5))), min(H, int(np.ceil(oy + y1 * s - 0.5)))
    if i1 <= i0 or j1 <= j0:
        return
    f = 2 ** level
    ii, jj = np.meshgrid(np.arange(i0, i1), np.arange(j0, j1))
    u = ((ii + 0.5 - ox) / s - origin[0]) / f - 0.5
    v = ((jj + 0.5 - oy) / s - origin[1]) / f - 0.5
    th, tw = tex.shape[:2]
    u = np.clip(u, 0, tw - 1.001)
    v = np.clip(v, 0, th - 1.001)
    a, b = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = (u - a)[..., None], (v - b)[..., None]
    a1, b1 = np.minimum(a + 1, tw - 1), np.minimum(b + 1, th - 1)
    c = (tex[b, a] * (1 - fu) * (1 - fv) + tex[b, a1] * fu * (1 - fv) + tex[b1, a] * (1 - fu) * fv
         + tex[b1, a1] * fu * fv)
    dst = canvas[j0:j1, i0:i1]
    dst[...] = c + dst * (1 - c[..., 3:4])


def frame_image(post_dir, f):
    """A frame's padded image (premultiplied) and the canvas position of its top-left pixel."""
    return K.read_png(os.path.join(post_dir, f['file'])), (f['rect'][0] - f['pad'], f['rect'][1] - f['pad'])


def paste(dst, tex, org, rect):
    x0, y0, x1, y1 = rect
    dst[y0:y1, x0:x1] = tex[y0 - org[1]:y1 - org[1], x0 - org[0]:x1 - org[0]]


def f0_of(by_id, base_ids):
    b = by_id[base_ids[0]]
    return by_id[b['parent']] if 'parent' in b else b


def whole_frame(post_dir, f0, lf, W, H):
    tex0, org0 = frame_image(post_dir, f0)
    texk, orgk = frame_image(post_dir, lf)
    whole = np.zeros((H, W, 4), np.float32)
    paste(whole, tex0, org0, f0['rect'])
    paste(whole, texk, orgk, lf['rect'])
    return whole, (tex0, org0), (texk, orgk)


def composite_check(post_dir, by_id, base_ids, layer_id, W, H):
    """The worst dE76 between the pieces plus a layer frame and that frame drawn whole, over SCALES."""
    f0, lf = f0_of(by_id, base_ids), by_id[layer_id]
    whole, (tex0, org0), (texk, orgk) = whole_frame(post_dir, f0, lf, W, H)
    worst = 0.0
    for s, ox, oy in SCALES:
        level = min(2, max(0, int(np.floor(np.log2(1 / s) + 1e-9))) if s < 1 else 0)
        CW, CH = int(W * s) + 4, int(H * s) + 4
        ref = np.zeros((CH, CW, 4), np.float32)
        # frame k drawn whole: one quad over the frame's rectangle (F0's, which holds the pieces and R), as the
        # renderer would draw an unlayered frame; a quad over the whole canvas would also bleed past the frame
        draw(ref, level_of(whole, level), (0, 0), tuple(f0['rect']), level, s, ox, oy)
        new = np.zeros_like(ref)
        for bid in base_ids:
            draw(new, level_of(tex0, level), org0, by_id[bid]['rect'], level, s, ox, oy)
        draw(new, level_of(texk, level), orgk, lf['rect'], level, s, ox, oy)
        m = (new[..., 3] > 0.002) | (ref[..., 3] > 0.002)
        if m.any():
            worst = max(worst, float(lab_de(new, ref)[m].max()))
    return worst


def check_set(name, sd, post_dir):
    errs, res = [], {}
    by_id = {f['id']: f for f in sd['frames']}
    parts = sd['parts']
    # geometry: shadows fall east-south-east of the anchor
    for pname, p in parts.items():
        if not pname.endswith('shadow') or isinstance(p, list):
            continue
        if 'pivot' in p:
            # an inserter's arm and hands: their shadows are ground footprints that the renderer turns with the
            # part about the shadow's shoulder point, so the offset that must fall east-south-east is that point's
            ss = (sd.get('extra') or {}).get('shadowShoulder')
            if ss is not None and f'{name} shadowShoulder px' not in res:
                res[f'{name} shadowShoulder px'] = ss
                if not (ss[0] > 0 and ss[1] > -2.0):
                    errs.append(f'{name}: shadowShoulder {ss} px is not east-south-east of the shoulder')
            continue
        checked = False
        for e in p['table']:
            for fid in e:
                f = by_id[fid]
                if 'file' not in f or f['array'] != 'shadow' or checked:
                    continue
                im = K.read_png(os.path.join(post_dir, f['file']))[..., 0]
                pad = f['pad']
                sub = im[pad:pad + f['h'], pad:pad + f['w']]
                tot = float(sub.sum())
                if tot <= 0:
                    continue
                yy, xx = np.mgrid[0:f['h'], 0:f['w']]
                cx, cy = (xx * sub).sum() / tot - f['ax'], (yy * sub).sum() / tot - f['ay']
                res[f'{name}.{pname} shadow centroid px'] = [round(float(cx), 1), round(float(cy), 1)]
                if not (cx > 0 and cy > -2.0):
                    errs.append(f'{name}.{pname}: shadow centroid ({cx:.1f}, {cy:.1f}) px from the anchor is not '
                                f'east-south-east')
                checked = True
    layers = parts.get('layers') or []
    canvas = sd.get('canvas')
    if sd['kind'] == 'entity' and layers and 'base' in parts and canvas:
        W, H = canvas
        base_ids = parts['base']['table'][0]
        f0 = f0_of(by_id, base_ids)
        shares, spans = [], []
        for li, L in enumerate(layers):
            nf = L['shape'][-1]
            for k in sorted({0, nf // 2, nf - 1}):
                worst = composite_check(post_dir, by_id, base_ids, L['table'][k][0], W, H)
                res[f'{name} layer {li} frame {k} composite dE max'] = round(worst, 3)
                if worst > DE_COMPOSITE:
                    errs.append(f'{name}: layer {li} frame {k}: the pieces composite differs from the whole frame by '
                                f'dE {worst:.2f} > {DE_COMPOSITE}')
            t0, o0 = frame_image(post_dir, f0)
            worst_band, changed = 0.0, None
            for k in range(nf):
                lf = by_id[L['table'][k][0]]
                tk, ok = frame_image(post_dir, lf)
                x0, y0, x1, y1 = lf['rect']
                a = tk[y0 - ok[1]:y1 - ok[1], x0 - ok[0]:x1 - ok[0]]
                b = t0[y0 - o0[1]:y1 - o0[1], x0 - o0[0]:x1 - o0[0]]
                band = np.ones(a.shape[:2], bool)
                band[8:-8, 8:-8] = False
                worst_band = max(worst_band, float(np.abs(a - b)[band].max()))
                d = np.abs(a - b).max(-1) > 2.0 / 255
                changed = d if changed is None else (changed | d)
            res[f'{name} layer {li} registration max steps'] = round(worst_band * 255, 2)
            if worst_band * 255 > 2.0:
                errs.append(f'{name}: layer {li}: frames differ from F0 in R\'s outer band by {worst_band * 255:.1f} '
                            f'steps (a moving part reaches R\'s edge)')
            shares.append(float(changed.sum()) / max(1, f0['w'] * f0['h']))
            ys, xs = np.nonzero(changed)
            spans.append(max(xs.max() - xs.min(), ys.max() - ys.min()) / 64.0 if len(xs) else 0.0)
        res[f'{name} moving share'] = round(sum(shares), 4)
        res[f'{name} largest moving span tiles'] = round(max(spans), 2)
        if name.startswith('entity/') and (sum(shares) < 0.03 or max(spans) < 0.3):
            errs.append(f'{name}: the 3 % rule: the layers change {100 * sum(shares):.1f} % of the sprite; the '
                        f'largest moving span is {max(spans):.2f} tile')
    # crop ink against whole ink, and the layered frame against a full render of the same frame
    vc = sd.get('verify')
    if vc and sd.get('render_dir'):
        rd = sd['render_dir']
        read = lambda f: K.read_png(os.path.join(rd, f))  # noqa: E731
        c, n, a = (read(vc['base'][p]) for p in ('colour', 'normal', 'aux'))
        x0, y0, x1, y1 = vc['rect']
        c[y0:y1, x0:x1] = read(vc['frame']['colour'])
        n[2 * y0:2 * y1, 2 * x0:2 * x1] = read(vc['frame']['normal'])
        a[2 * y0:2 * y1, 2 * x0:2 * x1] = read(vc['frame']['aux'])
        H, W = c.shape[:2]
        fields = I.ink_fields(H, W, vc['seed'])
        whole = I.survey_ink(c, n, a, fields, line_alpha=vc['lw'])
        rho = 16
        cx0, cy0, cx1, cy1 = max(0, x0 - rho), max(0, y0 - rho), min(W, x1 + rho), min(H, y1 + rho)
        crop = I.survey_ink(c[cy0:cy1, cx0:cx1], n[2 * cy0:2 * cy1, 2 * cx0:2 * cx1],
                            a[2 * cy0:2 * cy1, 2 * cx0:2 * cx1], fields, ox=cx0, oy=cy0,
                            line_alpha=vc['lw'])[y0 - cy0:y1 - cy0, x0 - cx0:x1 - cx0]
        steps = float(np.abs(K.to8(crop).astype(int) - K.to8(whole[y0:y1, x0:x1]).astype(int)).max())
        res[f'{name} crop ink max steps'] = steps
        if steps > 1:
            errs.append(f'{name}: inking R plus 16 px differs from inking the whole frame by {steps:.0f} steps')
        if vc.get('full'):
            fc, fn_, fa = (read(vc['full'][p]) for p in ('colour', 'normal', 'aux'))
            full = I.survey_ink(fc, fn_, fa, fields, line_alpha=vc['lw'])
            de = lab_de(K.premul(whole), K.premul(full))
            m = (whole[..., 3] > 0.002) | (full[..., 3] > 0.002)
            share = float((de[m] <= DE_FULL).mean()) if m.any() else 1.0
            res[f'{name} layered vs full render share within dE {DE_FULL}'] = round(share, 5)
            if share < SHARE_FULL:
                errs.append(f'{name}: the layered frame agrees with a full render on {100 * share:.2f} % of pixels '
                            f'(dE <= {DE_FULL}), below {100 * SHARE_FULL:.1f} %')
    return errs, res


def check_all(man, layout):
    """Every post-processed set of the build (found through the layout's cells)."""
    dirs = {}
    for p in layout['pages']:
        for c in p['cells']:
            dirs.setdefault(c['set'], c['dir'])
    errs, res = [], {}
    for name, d in sorted(dirs.items()):
        e, r = check_set(name, K.load_json(os.path.join(d, 'set.json')), d)
        errs += e
        res.update(r)
    return errs, res
