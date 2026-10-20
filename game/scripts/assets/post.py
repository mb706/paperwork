"""Post-process one rendered sprite set (10 §9.1 steps 6-7, §9.2 steps 1-4): ink, glow, trim, pieces, shadows.

    gamedev-python game/scripts/assets/post.py <render dir> <out dir> --script <model script> [--group core]

Reads the render's record.json and writes into <out dir>:
  f<id>.png   each frame's image, premultiplied RGBA (colour, light) or one channel (shadow), with a margin of
              real neighbouring pixels around the frame (pad px; transparent around a whole sprite, the frame's
              own neighbourhood around a layer frame) from which the packer fills the cell's gutter;
  set.json    the frames (array, size, anchor, the pad, or the parent and sub-rectangle of a base piece) and the
              set's parts with their axes, maps and explicit tables in local frame ids (10 §15.7).
Rules (10 §9.2):
  * ink with fields in canvas coordinates (ink.py), F0 on its passes' bounding box plus 16 px, each layer
    frame on R plus 16 px with frame k's passes pasted into F0's;
  * trim on alpha with a 1-px border, rounded out to multiples of 8 px of the canvas; premultiply;
  * a working set's base is F0's rectangle minus every layer's R, cut into at most four rectangles per R
    (empty pieces dropped); the idle state draws its own complete image;
  * shadows: values below 0.03 clipped, kept at Normal resolution, trimmed;
  * glow: the light pass dilated 0.12 tile, blurred 0.22 tile, x 1.8, clipped, stored at 16 px per tile.
"""

import argparse
import importlib.util
import os
import sys

import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import ink as I  # noqa: E402
from lib import contract as C  # noqa: E402
from lib import style as S  # noqa: E402

RHO = S.INK['margin']
ALIGN = 8
PAD = {'colour': 40, 'shadow': 24, 'light': 16, 'icon': 24}
SHADOW_CLIP = 0.03


def load_script(path):
    spec = importlib.util.spec_from_file_location('paperwork_post_model', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def trim_rect(alpha, thr=0.004, pad=1, align=ALIGN):
    """Trim box (x0, y0, x1, y1) of alpha > thr plus a pad, rounded out to multiples of `align`."""
    ys, xs = np.nonzero(alpha > thr)
    H, W = alpha.shape[:2]
    if len(xs) == 0:
        return None
    x0 = max(0, (int(xs.min()) - pad) // align * align)
    y0 = max(0, (int(ys.min()) - pad) // align * align)
    x1 = min(-(-W // align) * align, -(-(int(xs.max()) + 1 + pad) // align) * align)
    y1 = min(-(-H // align) * align, -(-(int(ys.max()) + 1 + pad) // align) * align)
    return [x0, y0, x1, y1]


def rect_union(a, b):
    if a is None:
        return list(b)
    if b is None:
        return list(a)
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def cut(rect, holes):
    """rect minus the holes (disjoint rectangles inside it), as rectangles: at most four per hole."""
    pieces = [list(rect)]
    for h in holes:
        nxt = []
        for p in pieces:
            if not (p[0] < h[2] and h[0] < p[2] and p[1] < h[3] and h[1] < p[3]):
                nxt.append(p)
                continue
            x0, y0, x1, y1 = max(p[0], h[0]), max(p[1], h[1]), min(p[2], h[2]), min(p[3], h[3])
            for q in ((p[0], p[1], p[2], y0), (p[0], y1, p[2], p[3]), (p[0], y0, x0, y1), (x1, y0, p[2], y1)):
                if q[2] > q[0] and q[3] > q[1]:
                    nxt.append(list(q))
        pieces = nxt
    return pieces


class FrameStore:
    """The set's frames, each written with a margin of real pixels for the packer's gutter."""

    def __init__(self, out):
        self.out = out
        self.frames = []

    def add(self, array, src, rect, anchor, gutter_src=None):
        """src: canvas-sized image of the array's resolution (premultiplied); rect: the frame in canvas px;
        anchor: the anchor in canvas px; gutter_src: the rectangle whose pixels may fill the gutter (default:
        the frame alone, so the gutter is transparent)."""
        pad = PAD[array]
        H, W = src.shape[:2]
        c = src.shape[2]
        x0, y0, x1, y1 = rect
        gx0, gy0, gx1, gy1 = gutter_src or rect
        img = np.zeros((y1 - y0 + 2 * pad, x1 - x0 + 2 * pad, c), np.float32)
        sx0, sy0 = max(0, x0 - pad, gx0), max(0, y0 - pad, gy0)
        sx1, sy1 = min(W, x1 + pad, gx1), min(H, y1 + pad, gy1)
        if sx1 > sx0 and sy1 > sy0:
            img[sy0 - (y0 - pad):sy1 - (y0 - pad), sx0 - (x0 - pad):sx1 - (x0 - pad)] = src[sy0:sy1, sx0:sx1]
        fid = len(self.frames)
        fn = f'f{fid:04d}.png'
        K.write_png(os.path.join(self.out, fn), img)
        self.frames.append(dict(id=fid, array=array, file=fn, w=x1 - x0, h=y1 - y0, pad=pad,
                                ax=anchor[0] - x0, ay=anchor[1] - y0, rect=[x0, y0, x1, y1]))
        return fid

    def add_piece(self, parent, sub):
        p = self.frames[parent]
        sx, sy = sub[0] - p['rect'][0], sub[1] - p['rect'][1]
        sw, sh = sub[2] - sub[0], sub[3] - sub[1]
        fid = len(self.frames)
        self.frames.append(dict(id=fid, array=p['array'], parent=parent, sub=[sx, sy, sw, sh], w=sw, h=sh,
                                ax=p['ax'] - sx, ay=p['ay'] - sy, rect=list(sub)))
        return fid


def read_passes(rdir, files):
    return [K.read_png(os.path.join(rdir, files[p])) for p in ('colour', 'normal', 'aux')]


def shadow_frame(store, rdir, fn, anchor_high):
    s = K.read_png(os.path.join(rdir, fn))[..., 3]
    s = np.where(s < SHADOW_CLIP, 0.0, s).astype(np.float32)
    rect = trim_rect(s, thr=0.0, pad=1, align=4)
    if rect is None:
        return None
    return store.add('shadow', s[..., None], rect, (anchor_high[0] // 2, anchor_high[1] // 2))


def glow_frame(store, rdir, fn, anchor_high):
    li = K.read_png(os.path.join(rdir, fn))[..., :3]
    px = S.PX_HIGH
    dil = int(0.12 * px) * 2 + 1
    grown = np.stack([ndi.grey_dilation(li[..., c], size=(dil, dil)) for c in range(3)], -1)
    g = np.stack([ndi.gaussian_filter(grown[..., c], 0.22 * px) for c in range(3)], -1) * 1.8
    g = np.clip(g, 0, 1)
    f = S.PX_HIGH // S.PX_LIGHT
    g = K.box_down(g, f)
    rgba = np.concatenate([g, g.max(-1, keepdims=True)], -1)
    rect = trim_rect(rgba[..., 3], thr=1.5 / 255, pad=1, align=4)
    if rect is None:
        return None
    return store.add('light', rgba, rect, (anchor_high[0] // f, anchor_high[1] // f))


# --------------------------------------------------------------------------------------------------------------
# Tables
# --------------------------------------------------------------------------------------------------------------

def flatten(shape, idx):
    """Row-major index over the axes (the last axis varies fastest): 10 §15.7's one flatten function."""
    i = 0
    for n, k in zip(shape, idx):
        if not 0 <= k < n:
            raise IndexError(f'index {idx} outside shape {shape}')
        i = i * n + k
    return i


def make_table(shape, fn):
    """The full table: fn(index tuple) -> list of frame ids ([] for an impossible combination)."""
    total = 1
    for n in shape:
        total *= n
    table = [None] * total
    for flat in range(total):
        idx = []
        r = flat
        for n in reversed(shape):
            idx.append(r % n)
            r //= n
        table[flat] = list(fn(tuple(reversed(idx))))
    return table


class EntityTables:
    """Per-part dictionaries keyed by (direction index, variant index[, frame]) -> frame ids, turned into the
    manifest's parts with the dir axis (and the mask axis for connection-mask sets)."""

    def __init__(self, meta, mod):
        self.meta = meta
        self.dmap, self.dsize = C.dir_map(meta['dirs'], meta.get('dir_alias') or {})
        self.ndirs = len(meta['dirs'])
        self.masked = hasattr(mod, 'mask_variants')
        if self.masked:
            combos, mmap = [], []
            for mask in range(256):
                vl = mod.mask_variants(mask)
                key = tuple(vl) if vl is not None else None
                if key not in combos:
                    combos.append(key)
                mmap.append(combos.index(key))
            self.mask_combos, self.mask_map = combos, mmap
        elif len(C.variant_list(meta)) > 1:
            raise ValueError('an entity set with several variants needs mask_variants(mask)')

    def axes(self, frame=0):
        ax, sh = ['dir'], [self.dsize]
        mp = {'dir': self.dmap}
        if self.masked:
            ax.append('mask')
            sh.append(len(self.mask_combos))
            mp['mask'] = self.mask_map
        if frame:
            ax.append('frame')
            sh.append(frame)
        return ax, sh, mp

    def part(self, t, frame=0):
        ax, sh, mp = self.axes(frame)

        def entry(idx):
            di = idx[0]
            if di >= self.ndirs:
                return []
            f = idx[-1] if frame else None
            vlist = [0]
            if self.masked:
                combo = self.mask_combos[idx[1]]
                if combo is None:
                    return []
                vlist = combo
            out = []
            for v in vlist:
                key = (di, v) if f is None else (di, v, f)
                if key not in t:
                    return []
                out.extend(t[key])
            return out

        return dict(axes=ax, shape=sh, map=mp, table=make_table(sh, entry))


# --------------------------------------------------------------------------------------------------------------
# Kinds
# --------------------------------------------------------------------------------------------------------------

def post_entity(rec, rdir, store, mod):
    meta = rec['meta']
    name = rec['set']
    lw = S.INK_WEIGHT[meta['ink']]
    tabs = EntityTables(meta, mod)
    base_t, idle_t, shadow_t, light_t = {}, {}, {}, {}
    layer_ts = []
    fields_cache = {}
    for combo in rec['combos']:
        di = meta['dirs'].index(combo['dir'])
        vi = combo['variant']
        W, H = combo['canvas']
        anchor = combo['anchor']
        key = (combo['dir'], vi, W, H)
        if key not in fields_cache:
            fields_cache[key] = I.ink_fields(H, W, I.ink_seed(name, combo['dir'], vi))
        fields = fields_cache[key]
        if meta['full_frame']:
            L = combo['layers'][0]
            for fi, img in enumerate(L['images']):
                c, n, a = read_passes(rdir, img)
                pm = K.premul(I.ink_canvas(c, n, a, fields, lw))
                rect = trim_rect(pm[..., 3])
                base_t[(di, vi, fi)] = [store.add('colour', pm, rect, anchor)]
        else:
            c0, n0, a0 = read_passes(rdir, combo['base'])
            pm0 = K.premul(I.ink_canvas(c0, n0, a0, fields, lw))
            working = combo['state'] == 'working'
            if working and combo['layers']:
                rects = [L['rect'] for L in combo['layers']]
                rect0 = trim_rect(pm0[..., 3])
                for r in rects:
                    rect0 = rect_union(rect0, r)
                f0 = store.add('colour', pm0, rect0, anchor)
                pieces = []
                for p in cut(rect0, rects):
                    if pm0[p[1]:p[3], p[0]:p[2], 3].max() > 0:
                        pieces.append(store.add_piece(f0, p))
                base_t[(di, vi)] = pieces
                while len(layer_ts) < len(combo['layers']):
                    layer_ts.append({})
                for gi, L in enumerate(combo['layers']):
                    x0, y0, x1, y1 = L['rect']
                    cx0, cy0 = max(0, x0 - RHO), max(0, y0 - RHO)
                    cx1, cy1 = min(W, x1 + RHO), min(H, y1 + RHO)
                    for fi, img in enumerate(L['images']):
                        c, n, a = c0.copy(), n0.copy(), a0.copy()
                        c[y0:y1, x0:x1] = K.read_png(os.path.join(rdir, img['colour']))
                        n[2 * y0:2 * y1, 2 * x0:2 * x1] = K.read_png(os.path.join(rdir, img['normal']))
                        a[2 * y0:2 * y1, 2 * x0:2 * x1] = K.read_png(os.path.join(rdir, img['aux']))
                        crop = I.survey_ink(c[cy0:cy1, cx0:cx1], n[2 * cy0:2 * cy1, 2 * cx0:2 * cx1],
                                            a[2 * cy0:2 * cy1, 2 * cx0:2 * cx1], fields, ox=cx0, oy=cy0,
                                            line_alpha=lw)
                        comp = pm0.copy()
                        comp[y0:y1, x0:x1] = K.premul(crop[y0 - cy0:y1 - cy0, x0 - cx0:x1 - cx0])
                        fid = store.add('colour', comp, L['rect'], anchor, gutter_src=rect0)
                        layer_ts[gi][(di, vi, fi)] = [fid]
            else:
                rect0 = trim_rect(pm0[..., 3])
                fid = store.add('colour', pm0, rect0, anchor)
                (base_t if working else idle_t)[(di, vi)] = [fid]
        if combo.get('shadow'):
            sid = shadow_frame(store, rdir, combo['shadow'], anchor)
            if sid is not None:
                shadow_t[(di, vi)] = [sid]
        if combo['base'].get('light'):
            lid = glow_frame(store, rdir, combo['base']['light'], anchor)
            if lid is not None:
                light_t[(di, vi)] = [lid]
    nframes = meta['layers'][0]['frames'] if meta['full_frame'] else 0
    parts = {'base': tabs.part(base_t, frame=nframes)}
    if layer_ts:
        lf = [rec['combos'][0]['layers'][gi]['frames'] for gi in range(len(layer_ts))]
        parts['layers'] = [tabs.part(t, frame=lf[gi]) for gi, t in enumerate(layer_ts)]
    if idle_t:
        parts['idle'] = tabs.part(idle_t)
    if shadow_t:
        parts['shadow'] = tabs.part(shadow_t)
    if light_t:
        parts['light'] = tabs.part(light_t)
    extra = {}
    if meta.get('smoke'):
        # chimney points (m, the model at direction south) -> level-0 px from the anchor, for the renderer's
        # smoke puffs (10 §9.8): x east, y down the screen
        extra['smoke'] = [[round(p[0] * S.PX_HIGH, 2), round(-(p[1] + p[2]) * S.PX_HIGH, 2)] for p in meta['smoke']]
    if hasattr(mod, 'FRAMES_PER_TILE'):
        extra['framesPerTile'] = mod.FRAMES_PER_TILE
    return parts, extra


def post_mover(rec, rdir, store, mod):
    meta = rec['meta']
    name = rec['set']
    lw = S.INK_WEIGHT[meta['ink']]
    W, H = rec['canvas']
    anchor = rec['anchor']
    n = meta['orientations']
    parts = {}
    fields = [I.ink_fields(H, W, I.ink_seed(name, k, 0)) for k in range(n)]
    for cname, clip in rec['clips'].items():
        frames = clip['frames']
        col, sh = {}, {}
        for k in range(n):
            for f in range(frames):
                img = clip['images'][k][f]
                c, nn, a = read_passes(rdir, img)
                pm = K.premul(I.ink_canvas(c, nn, a, fields[k], lw))
                col[(k, f)] = [store.add('colour', pm, trim_rect(pm[..., 3]), anchor)]
                sid = shadow_frame(store, rdir, img['shadow'], anchor)
                sh[(k, f)] = [sid] if sid is not None else []
        shape = [n, frames]
        cm = meta['clips'][cname]
        p = dict(axes=['orientation', 'frame'], shape=shape, table=make_table(shape, lambda i, t=col: t[i]))
        ps = dict(axes=['orientation', 'frame'], shape=shape, table=make_table(shape, lambda i, t=sh: t[i]))
        for k in ('fps', 'cycle_tiles'):
            if k in cm:
                p['cycleTiles' if k == 'cycle_tiles' else 'fps'] = cm[k]
                ps['cycleTiles' if k == 'cycle_tiles' else 'fps'] = cm[k]
        parts[cname] = p
        parts[cname + '_shadow'] = ps
    return parts, {}


def post_inserter(rec, rdir, store, mod):
    meta = rec['meta']
    name = rec['set']
    lw = S.INK_WEIGHT[meta['ink']]
    dirs = [p['dir'] for p in rec['platform']]
    dmap, dsize = C.dir_map(dirs)
    plat, plat_sh = {}, {}
    for i, img in enumerate(rec['platform']):
        W, H = img['canvas']
        fields = I.ink_fields(H, W, I.ink_seed(name, img['dir'], 0))
        c, n, a = read_passes(rdir, img)
        pm = K.premul(I.ink_canvas(c, n, a, fields, lw))
        plat[i] = [store.add('colour', pm, trim_rect(pm[..., 3]), img['anchor'])]
        sid = shadow_frame(store, rdir, img['shadow'], img['anchor'])
        plat_sh[i] = [sid] if sid is not None else []

    def dir_part(t):
        return dict(axes=['dir'], shape=[dsize], map={'dir': dmap},
                    table=make_table([dsize], lambda i: t.get(i[0], [])))

    parts = {'platform': dir_part(plat), 'platform_shadow': dir_part(plat_sh)}
    for pname, img in rec['parts'].items():
        W, H = img['canvas']
        fields = I.ink_fields(H, W, I.ink_seed(name, pname, 0))
        c, n, a = read_passes(rdir, img)
        pm = K.premul(I.ink_canvas(c, n, a, fields, lw))
        rect = trim_rect(pm[..., 3])
        fid = store.add('colour', pm, rect, img['anchor'])
        p = dict(axes=[], shape=[], table=[[fid]],
                 pivot=[round(img['pivot'][0] - rect[0], 3), round(img['pivot'][1] - rect[1], 3)])
        if 'length' in img:
            p['length'] = round(img['length'], 3)
        parts[pname] = p
        s = K.read_png(os.path.join(rdir, img['shadow']))[..., 3]
        s = np.where(s < SHADOW_CLIP, 0.0, s).astype(np.float32)
        srect = trim_rect(s, thr=0.0, pad=1, align=4)
        sax, say = img['shadow_anchor'][0] // 2, img['shadow_anchor'][1] // 2
        sid = store.add('shadow', s[..., None], srect, (sax, say))
        parts[pname + '_shadow'] = dict(axes=[], shape=[], table=[[sid]],
                                        pivot=[sax - srect[0], say - srect[1]])
    zs = meta['shoulder']
    sx, sy = S.SHADOW_REACH
    extra = dict(shoulder=[0.0, round(-zs * S.PX_HIGH, 3)],
                 shadowShoulder=[round(sx * zs * S.PX_NORMAL, 3), round(-sy * zs * S.PX_NORMAL, 3)])
    return parts, extra


def post_resource(rec, rdir, store, mod):
    meta = rec['meta']
    name = rec['set']
    lw = S.INK_WEIGHT[meta['ink']]
    col, sh = {}, {}
    for shp in rec['shapes']:
        W, H = shp['canvas']
        fields = I.ink_fields(H, W, I.ink_seed(name, 0, shp['shape']))
        for img in shp['bands']:
            c, n, a = read_passes(rdir, img)
            pm = K.premul(I.ink_canvas(c, n, a, fields, lw))
            rect = trim_rect(pm[..., 3])
            key = (shp['shape'], img['band'])
            col[key] = [store.add('colour', pm, rect, shp['anchor'])] if rect else []
            sid = shadow_frame(store, rdir, img['shadow'], shp['anchor'])
            sh[key] = [sid] if sid is not None else []
    shape = [meta['shapes'], meta['bands']]
    parts = {'base': dict(axes=['shape', 'band'], shape=shape, table=make_table(shape, lambda i: col[i])),
             'shadow': dict(axes=['shape', 'band'], shape=shape, table=make_table(shape, lambda i: sh[i]))}
    return parts, {}


ICON_PX = 64


def icon_image(rec, rdir, name):
    """The inked icon at 128 px (A3 §7: icon line widths, sel-out), premultiplied, and its 64 px level 0."""
    W, H = rec['canvas']
    c, n, a = read_passes(rdir, rec['base'])
    fields = I.ink_fields(H, W, I.ink_seed(name, 0, 0))
    inked = I.survey_ink(c, n, a, fields, line_sil=S.ICON_INK['line_sil'], line_in=S.ICON_INK['line_in'],
                         selout=S.ICON_INK['selout'])
    pm = K.premul(inked)
    return pm, K.box_down(pm, W // ICON_PX)


def post_icon(rec, rdir, store, mod):
    pm128, pm64 = icon_image(rec, rdir, rec['set'])
    K.write_png(os.path.join(store.out, 'icon128.png'), pm128)
    fid = store.add('icon', pm64, [0, 0, ICON_PX, ICON_PX], (ICON_PX // 2, ICON_PX // 2))
    return {'icon': dict(axes=[], shape=[], table=[[fid]])}, {}


POST = dict(entity=post_entity, mover=post_mover, inserter=post_inserter, resource=post_resource, icon=post_icon)


def run(render_dir, out_dir, script, params=None):
    rec = K.load_json(os.path.join(render_dir, 'record.json'))
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        os.remove(os.path.join(out_dir, f))
    mod = load_script(script) if script else None
    if params:
        mod.setup(params)
    store = FrameStore(out_dir)
    parts, extra = POST[rec['kind']](rec, render_dir, store, mod)
    meta = rec.get('meta', {})
    out = dict(set=rec['set'], kind=rec['kind'], frames=store.frames, parts=parts, extra=extra,
               size=list(meta.get('size', [1, 1])))
    K.dump_json(os.path.join(out_dir, 'set.json'), out)
    print(f'[post] {rec["set"]}: {len(store.frames)} frames', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('render_dir', nargs='?')
    ap.add_argument('out_dir', nargs='?')
    ap.add_argument('--script', default=None)
    ap.add_argument('--params', default=None, help='JSON params for scripts with setup()')
    ap.add_argument('--batch', default=None, help='a JSON list of {render_dir, out_dir, script, params}')
    a = ap.parse_args()
    import json
    if a.batch:
        for job in K.load_json(a.batch):
            run(job['render_dir'], job['out_dir'], job.get('script'), job.get('params'))
    else:
        run(a.render_dir, a.out_dir, a.script, json.loads(a.params) if a.params else None)


if __name__ == '__main__':
    main()
