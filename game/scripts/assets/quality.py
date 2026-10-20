"""Per-set quality checks (10 §9.5 #2 animation, #3 geometry), on the post step's frames and the render's passes.

The composite check of §9.5 #2 (the pieces plus every layer drawn as the renderer draws them against the whole
frame) runs on the atlas itself, from the page levels the build encodes: composite.py, called by checks.py.

Animation (layered entity sets), in every combination that has layers (each direction and variant), every layer:
  registration  inside R's outer band (8 px) every frame equals F0: nothing moving reaches R's edge.
  3 % rule      a machine's layers change at least 3 % of its sprite's pixels over a loop and one moving part spans
                at least 0.3 tile (A3 §9), in every combination.
  crop ink      frame k inked on R plus 16 px equals frame k inked whole inside R, within one 8-bit step (the ink's
                locality: the first combination's first layer, render.py's verify frame).
  full render   that frame made of F0 and its layer frame agrees with a full render of it (render.py's verify
                image) within dE76 <= 3 on 99.9 % of pixels.
Geometry: every shadow frame's centroid lies east-south-east of its anchor (10 §9.5 #3; shadows fall as in
Factorio), animated shadows frame by frame; an inserter's moving parts are judged by their shadow's shoulder.
check_all returns (errors, results); checks.py prints and records them.
"""

import os

import numpy as np

import common as K
import ink as I

DE_FULL, SHARE_FULL = 3.0, 0.999
BAND = 8                    # R's outer band, px at High (render.py's LAYER_MARGIN)


def lab_de(a, b):
    paper = K.hexc(K.PAPER_HEX)
    ca = a[..., :3] + (1 - a[..., 3:4]) * paper
    cb = b[..., :3] + (1 - b[..., 3:4]) * paper
    return np.sqrt(((K.lab(np.clip(ca, 0, 1)) - K.lab(np.clip(cb, 0, 1))) ** 2).sum(-1))


def frame_image(post_dir, f):
    """A frame's padded image (premultiplied) and the canvas position of its top-left pixel."""
    return K.read_png(os.path.join(post_dir, f['file'])), (f['rect'][0] - f['pad'], f['rect'][1] - f['pad'])


def crop(tex, org, rect):
    x0, y0, x1, y1 = rect
    return tex[y0 - org[1]:y1 - org[1], x0 - org[0]:x1 - org[0]]


def f0_of(by_id, base_ids):
    b = by_id[base_ids[0]]
    return by_id[b['parent']] if 'parent' in b else b


def render_dir(sd):
    """The render this post output came from (a cache key: the cache moves between worktrees; the contract
    examples, rendered outside the cache, give their path)."""
    if sd.get('render_path'):
        return sd['render_path']
    key = sd.get('render_key')
    return os.path.join(K.CACHE, 'render', key) if key else None


def _colour_part_of(parts, pname):
    """The part whose object casts shadow part `pname`: `shadow` is base's, `X_shadow` is X's."""
    if pname == 'shadow':
        return parts.get('base') or parts.get('idle')
    return parts.get(pname[:-len('_shadow')])


def _decode(shape, flat):
    idx = []
    for n in reversed(shape):
        idx.append(flat % n)
        flat //= n
    return list(reversed(idx))


def _flat(shape, idx):
    i = 0
    for n, k in zip(shape, idx):
        i = i * n + k
    return i


def _centroid(fids, post_dir, by_id, cache):
    """The alpha-weighted centroid of frames drawn together, in High px from the anchor (a base piece counts as its
    whole F0; shadow frames are Normal resolution); None when they are empty."""
    tot = sx = sy = 0.0
    seen = set()
    for fid in fids:
        f = by_id[fid]
        f = by_id[f['parent']] if 'parent' in f else f
        if f['id'] in seen or 'file' not in f:
            continue
        seen.add(f['id'])
        if f['file'] not in cache:
            cache[f['file']] = K.read_png(os.path.join(post_dir, f['file']))
        im = cache[f['file']]
        a = im[..., 0] if f['array'] == 'shadow' else im[..., 3]
        pad = f['pad']
        sub = a[pad:pad + f['h'], pad:pad + f['w']]
        t = float(sub.sum())
        if t <= 0:
            continue
        k = 2.0 if f['array'] == 'shadow' else 1.0
        yy, xx = np.mgrid[0:f['h'], 0:f['w']]
        sx += k * float(((xx + 0.5 - f['ax']) * sub).sum())
        sy += k * float(((yy + 0.5 - f['ay']) * sub).sum())
        tot += t
    return (sx / tot, sy / tot) if tot > 0 else None


def shadow_geometry(name, sd, post_dir, by_id, errs, res):
    """Shadows fall east-south-east (10 §9.5 #3): each shadow's centroid lies east and not north of the centroid of
    the object casting it (the colour picture of the same direction, variant, shape or frame), so an off-centre piece
    (a belt's curve) is judged against itself, not against its tile's centre."""
    parts = sd['parts']
    cache = {}
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
        cp = _colour_part_of(parts, pname)
        if cp is None:
            errs.append(f'{name}.{pname}: no picture casts this shadow')
            continue
        least = None
        for flat, e in enumerate(p['table']):
            if not e:
                continue
            idx = _decode(p['shape'], flat)
            cidx = []
            for ax, n in zip(cp['axes'], cp['shape']):
                if ax in p['axes']:
                    cidx.append(idx[p['axes'].index(ax)])
                else:
                    cidx.append(n - 1 if ax == 'stage' else 0)       # a shared shadow: the fullest stage, frame 0
            ce = cp['table'][_flat(cp['shape'], cidx)]
            # pictures drawn together (a belt's piece and its cap) pair one by one with their shadows; a base cut
            # into pieces pairs as one picture
            pairs = list(zip(([f] for f in e), ([f] for f in ce))) if len(e) == len(ce) else [(e, ce)]
            for se, oe in pairs:
                s_c, o_c = _centroid(se, post_dir, by_id, cache), _centroid(oe, post_dir, by_id, cache)
                if s_c is None or o_c is None:
                    continue
                dx, dy = s_c[0] - o_c[0], s_c[1] - o_c[1]
                if least is None or dx < least[0]:
                    least = (dx, dy)
                if not (dx > 0 and dy > -2.0):
                    errs.append(f'{name}.{pname} {dict(zip(p["axes"], idx))}: the shadow\'s centroid lies '
                                f'({dx:.1f}, {dy:.1f}) px from its object\'s, not east-south-east')
        if least is not None:
            res[f'{name}.{pname} least eastward shadow offset px'] = [round(least[0], 1), round(least[1], 1)]


def combinations(parts):
    """(flat index, base frame ids, [per layer: its frame ids by frame]) for every combination base draws."""
    base = parts['base']
    layers = parts.get('layers') or []
    for flat, e in enumerate(base['table']):
        if not e:
            continue
        per = []
        for L in layers:
            n = L['shape'][-1]
            per.append([L['table'][flat * n + k][0] if L['table'][flat * n + k] else None for k in range(n)])
        yield flat, e, per


def layer_checks(name, sd, post_dir, by_id, errs, res):
    parts = sd['parts']
    if sd['kind'] != 'entity' or not parts.get('layers') or 'base' not in parts:
        return
    min_share, min_span = None, None
    for flat, base_ids, per in combinations(parts):
        f0 = f0_of(by_id, base_ids)
        t0, o0 = frame_image(post_dir, f0)
        changed_all = np.zeros((f0['h'], f0['w']), bool)
        spans = []
        for li, frames in enumerate(per):
            if any(fid is None for fid in frames):
                errs.append(f'{name}: combination {flat} layer {li} lacks frames')
                continue
            worst_band, changed = 0.0, None
            rect = by_id[frames[0]]['rect']
            for fid in frames:
                lf = by_id[fid]
                if lf['rect'] != rect:
                    errs.append(f'{name}: combination {flat} layer {li}: frames with different rectangles')
                tk, ok = frame_image(post_dir, lf)
                a = crop(tk, ok, lf['rect'])
                b = crop(t0, o0, lf['rect'])
                band = np.ones(a.shape[:2], bool)
                band[BAND:-BAND, BAND:-BAND] = False
                worst_band = max(worst_band, float(np.abs(a - b)[band].max()))
                d = np.abs(a - b).max(-1) > 2.0 / 255
                changed = d if changed is None else (changed | d)
            key = f'{name} combination {flat} layer {li}'
            res[f'{key} registration max steps'] = round(worst_band * 255, 2)
            if worst_band * 255 > 2.0:
                errs.append(f'{key}: frames differ from F0 in R\'s outer band by {worst_band * 255:.1f} steps (a '
                            f'moving part reaches R\'s edge)')
            x0, y0 = rect[0] - f0['rect'][0], rect[1] - f0['rect'][1]
            changed_all[y0:y0 + changed.shape[0], x0:x0 + changed.shape[1]] |= changed
            ys, xs = np.nonzero(changed)
            spans.append(max(xs.max() - xs.min(), ys.max() - ys.min()) / 64.0 if len(xs) else 0.0)
        share = float(changed_all.sum()) / max(1, f0['w'] * f0['h'])
        span = max(spans) if spans else 0.0
        res[f'{name} combination {flat} moving share'] = round(share, 4)
        res[f'{name} combination {flat} largest moving span tiles'] = round(span, 2)
        min_share = share if min_share is None else min(min_share, share)
        min_span = span if min_span is None else min(min_span, span)
    if name.startswith('entity/') and min_share is not None and (min_share < 0.03 or min_span < 0.3):
        errs.append(f'{name}: the 3 % rule: the layers change {100 * min_share:.1f} % of the sprite; the largest '
                    f'moving span is {min_span:.2f} tile (the weakest combination)')


def verify_checks(name, sd, errs, res):
    """Crop ink against whole ink, and the layered frame against a full render of the same frame."""
    vc = sd.get('verify')
    rd = render_dir(sd)
    if not vc or not rd:
        return
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
    crop_ink = I.survey_ink(c[cy0:cy1, cx0:cx1], n[2 * cy0:2 * cy1, 2 * cx0:2 * cx1],
                            a[2 * cy0:2 * cy1, 2 * cx0:2 * cx1], fields, ox=cx0, oy=cy0,
                            line_alpha=vc['lw'])[y0 - cy0:y1 - cy0, x0 - cx0:x1 - cx0]
    steps = float(np.abs(K.to8(crop_ink).astype(int) - K.to8(whole[y0:y1, x0:x1]).astype(int)).max())
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


def check_set(name, sd, post_dir):
    errs, res = [], {}
    by_id = {f['id']: f for f in sd['frames']}
    shadow_geometry(name, sd, post_dir, by_id, errs, res)
    layer_checks(name, sd, post_dir, by_id, errs, res)
    verify_checks(name, sd, errs, res)
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
