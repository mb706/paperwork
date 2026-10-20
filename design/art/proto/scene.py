"""Scene compositor for mocks: an emulation of the engine's frame (10 §6.2), in numpy.

    layout = layouts.slice_scene()                 # see layouts.py
    img = compose(layout, 'kodachrome', view=(x0, y0, w, h), px=64)

Layer order, as the engine draws them:
  1 terrain (terrain.py: tile materials, warped boundaries, water)
  2 ground: resource tiles, decoratives, belts (row order), then belt items
  3 shadows: every entity's shadow mask MAX-blended into one layer, applied once (so overlapping
    shadows never double-darken), falling on ground, belts and items but not on buildings
  4 objects, y-sorted by footprint bottom edge, then x
  5 high: inserter arms and held items, pole wires (with their ground shadows in layer 3)
  6 post: the style's grade (a LUT in the engine)
Coordinates are game coordinates: x east, y south, in tiles; an entity's anchor is its footprint
centre on the ground; a height z is drawn z tiles up the screen.
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import post  # noqa: E402
import terrain as T  # noqa: E402
from lib import style as S  # noqa: E402

OUT = os.path.join(HERE, '..', 'out')
SPRITES = os.path.join(OUT, 'sprites')

DIRV = {'N': (0, -1), 'E': (1, 0), 'S': (0, 1), 'W': (-1, 0)}
VDIR = {v: k for k, v in DIRV.items()}

# shadow colour: what the sky alone lights (multiply), per style
SHADE = {'kodachrome': (0.40, 0.45, 0.58), 'model': (0.58, 0.62, 0.72), 'survey': (1.0, 1.0, 1.0)}


# ----------------------------------------------------------------------------------------------
# Layout
# ----------------------------------------------------------------------------------------------

class Ent:
    __slots__ = ('eid', 'cx', 'cy', 'w', 'h', 'stem', 'layer', 'extra')

    def __init__(self, eid, cx, cy, w, h, stem, layer='object', extra=None):
        self.eid, self.cx, self.cy, self.w, self.h, self.stem, self.layer = eid, cx, cy, w, h, stem, layer
        self.extra = extra or {}


class Layout:
    def __init__(self, x0, y0, w, h):
        self.x0, self.y0, self.w, self.h = x0, y0, w, h
        self.tiles = np.full((h, w), T.TID['grass'], np.int32)
        self.occ = np.zeros((h, w), bool)
        self.ents = []
        self.items = []       # (item, x, y, z, size)
        self.wires = []       # list of 3D polylines (game coords, z up)
        self.poles = []

    # -- tiles --------------------------------------------------------------------------------
    def tile(self, x, y, t):
        i, j = int(x - self.x0), int(y - self.y0)
        if 0 <= i < self.w and 0 <= j < self.h:
            self.tiles[j, i] = T.TID[t]

    def fill(self, mask_fn, t, x0=None, y0=None, x1=None, y1=None):
        xs = np.arange(self.w) + self.x0
        ys = np.arange(self.h) + self.y0
        X, Y = np.meshgrid(xs, ys)
        m = mask_fn(X + 0.5, Y + 0.5)
        self.tiles[m] = T.TID[t]

    def free(self, x, y, w=1, h=1):
        i, j = int(x - self.x0), int(y - self.y0)
        if i < 0 or j < 0 or i + w > self.w or j + h > self.h:
            return True
        return not self.occ[j:j + h, i:i + w].any()

    def claim(self, x, y, w, h):
        i, j = int(x - self.x0), int(y - self.y0)
        i0, j0, i1, j1 = max(0, i), max(0, j), min(self.w, i + w), min(self.h, j + h)
        if i1 > i0 and j1 > j0:
            self.occ[j0:j1, i0:i1] = True

    # -- entities -----------------------------------------------------------------------------
    def add(self, eid, x, y, w, h, stem, layer='object', claim=True, **extra):
        """x, y: top-left tile of the footprint."""
        e = Ent(eid, x + w / 2, y + h / 2, w, h, stem, layer, extra)
        self.ents.append(e)
        if claim:
            self.claim(x, y, w, h)
        return e

    def machine(self, eid, x, y, w, h, d='S', frame=0, variant=None, state=None):
        v = f'-{variant}' if variant is not None else ''
        st = f'-{state}' if state else ''
        return self.add(eid, x, y, w, h, f'{eid}{v}-{d}-f{frame:02d}{st}')

    def inserter(self, x, y, pick, kind='inserter', item=None, pose=None):
        """Inserter at tile (x, y) picking from direction `pick` (N/E/S/W) and dropping opposite.
        pose: 'pick' (arm at the pickup, holding nothing), 'drop' (arm at the drop, holding item) or
        'mid' (arm swung east/west, holding item)."""
        pose = pose or ('drop' if item else 'pick')
        drop = {'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E'}[pick]
        side = {'pick': pick, 'drop': drop}.get(pose)
        if pose == 'mid':
            side = 'E' if pick in ('N', 'S') else 'N'
        var = {'N': 0, 'S': 1, 'E': 2, 'W': 3}[side]
        self.add(kind, x, y, 1, 1, f'{kind}-0-S-f00-base')
        reach = 1.92 if kind == 'long-handed-inserter' else 0.92
        e = self.add(kind, x, y, 1, 1, f'{kind}-{var}-S-f00-arm', layer='high', claim=False)
        if item and pose != 'pick':
            hx, hy = DIRV[side]
            self.items.append((item, x + 0.5 + hx * reach, y + 0.5 + hy * reach, 0.30, 0.5, 'high'))
        return e

    def pole(self, x, y):
        self.add('small-electric-pole', x, y, 1, 1, 'small-electric-pole-S-f00')
        self.poles.append((x + 0.5, y + 0.5))

    def belt_path(self, pts, d_in=None, d_out=None, lanes=None, tier='transport-belt', seed=0):
        """pts: consecutive tile coords. lanes: {'L': (item, density), 'R': (item, density)} relative to
        travel (left/right). Items 4 per lane per tile at full density."""
        rng = np.random.default_rng(seed)
        n = len(pts)
        for k, (x, y) in enumerate(pts):
            if k > 0:
                di = (x - pts[k - 1][0], y - pts[k - 1][1])
            else:
                di = DIRV[d_in] if d_in else (pts[1][0] - x, pts[1][1] - y)
            if k < n - 1:
                do = (pts[k + 1][0] - x, pts[k + 1][1] - y)
            else:
                do = DIRV[d_out] if d_out else di
            if di == do:
                var = 0
            elif do == (di[1], -di[0]):
                var = 1          # left turn
            else:
                var = 2          # right turn
            self.add(tier, x, y, 1, 1, f'{tier}-{var}-{VDIR[do]}-f00', layer='belt')
            if lanes:
                for side, (item, dens) in lanes.items():
                    if item is None:
                        continue
                    for s in (0.125, 0.375, 0.625, 0.875):
                        if rng.random() > dens:
                            continue
                        px, py = _lane_pos(x, y, di, do, var, side, s)
                        self.items.append((item, px, py, 0.17, 0.5, 'belt'))

    def wire(self, p0, p1):
        """Two wires between adjacent small poles (game coords of pole centres)."""
        from_pts = [(-0.36, 2.80), (0.36, 2.80)]
        d = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        for ox, z in from_pts:
            a = (p0[0] + ox, p0[1] - 0.0, z)
            b = (p1[0] + ox, p1[1] - 0.0, z)
            sag = 0.05 * d + 0.08
            pts = []
            for i in range(25):
                t = i / 24
                pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] - sag * 4 * t * (1 - t)))
            self.wires.append(pts)

    def wire_poles(self, max_d=7.5):
        """Connect each pole to its nearest earlier pole within reach (a spanning tree, as players do)."""
        P = self.poles
        for i in range(1, len(P)):
            best, bd = None, 1e9
            for j in range(i):
                d = math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1])
                if d < bd:
                    best, bd = j, d
            if best is not None and bd <= max_d:
                self.wire(P[best], P[i])


def _lane_pos(x, y, di, do, var, side, s):
    """Position of a lane point at fraction s along a belt tile (game coords)."""
    cx, cy = x + 0.5, y + 0.5
    off = 0.23
    if var == 0:
        lx, ly = do[1], -do[0]          # left normal of travel (screen coords, y down)
        sgn = 1 if side == 'L' else -1
        return cx + do[0] * (s - 0.5) + lx * off * sgn, cy + do[1] * (s - 0.5) + ly * off * sgn
    ex, ey = cx - di[0] * 0.5, cy - di[1] * 0.5           # entry midpoint
    ox_, oy_ = cx + do[0] * 0.5, cy + do[1] * 0.5           # exit midpoint
    ccx, ccy = ex + do[0] * 0.5, ey + do[1] * 0.5           # centre of curvature
    a0 = math.atan2(ey - ccy, ex - ccx)
    a1 = math.atan2(oy_ - ccy, ox_ - ccx)
    da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    a = a0 + da * s
    inner = (side == 'L') == (var == 1)
    r = 0.5 - off if inner else 0.5 + off
    return ccx + r * math.cos(a), ccy + r * math.sin(a)


# ----------------------------------------------------------------------------------------------
# Drawing primitives
# ----------------------------------------------------------------------------------------------

def blit(dst, src, x, y):
    """Alpha-over src (straight RGBA) onto dst RGB at integer top-left (x, y)."""
    H, W = dst.shape[:2]
    h, w = src.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]
    a = s[..., 3:4]
    d = dst[y0:y1, x0:x1]
    d[...] = d * (1 - a) + s[..., :3] * a


def blit_max(dst, src, x, y):
    H, W = dst.shape[:2]
    h, w = src.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    np.maximum(dst[y0:y1, x0:x1], src[y0 - y:y1 - y, x0 - x:x1 - x], out=dst[y0:y1, x0:x1])


_SCALED = {}


_MISSING = set()


def sprite(style, eid, stem, px):
    key = (style, eid, stem, px)
    if key in _SCALED:
        return _SCALED[key]
    try:
        spr = post.load_sprite(SPRITES, style, eid, stem)
    except (FileNotFoundError, KeyError):
        if (style, stem) not in _MISSING:
            _MISSING.add((style, stem))
            print(f'[compose] missing sprite {style}/{eid}/{stem}', flush=True)
        _SCALED[key] = None
        return None
    f = spr['px'] / px
    rgba, sh, glow = spr['rgba'], spr['shadow'], spr.get('glow')
    ax, ay = spr['ax'], spr['ay']
    if f != 1:
        # pad so the anchor stays on the integer grid after downscale
        fi = int(round(f))
        px0 = (-ax) % fi
        py0 = (-ay) % fi
        rgba = np.pad(rgba, ((py0, 0), (px0, 0), (0, 0)))
        sh = np.pad(sh, ((py0, 0), (px0, 0)))
        ax, ay = ax + px0, ay + py0
        rgba = post.downscale(rgba, fi)
        sh = post.downscale(sh[..., None], fi)[..., 0]
        if glow is not None:
            glow = post.downscale(np.pad(glow, ((py0, 0), (px0, 0), (0, 0))), fi)
        ax, ay = ax // fi, ay // fi
    out = dict(rgba=rgba, shadow=sh, ax=ax, ay=ay, glow=glow)
    _SCALED[key] = out
    return out


_ICONS = {}


def icon(style, item, size_px):
    key = (style, item, size_px)
    if key in _ICONS:
        return _ICONS[key]
    d = os.path.join(SPRITES, style, 'icons')
    c = post.read_png(os.path.join(d, f'{item}.colour.png'))
    if S.STYLES[style]['render'] == 'flat' and os.path.exists(os.path.join(d, f'{item}.normal.png')):
        n = post.read_png(os.path.join(d, f'{item}.normal.png'))
        a = post.read_png(os.path.join(d, f'{item}.aux.png'))
        c = post.survey_ink(c, n, a, style, line_sil=5.0, line_in=2.2, selout=0.6)
    else:
        c = outline(c, 0.35, 2.0)
    s = post.resize(c, size_px / c.shape[0])
    _ICONS[key] = s
    return s


def outline(rgba, strength=0.4, radius=2.0):
    """A soft dark rim outside the silhouette: separates an icon from a busy ground (Factorio's practice)."""
    a = rgba[..., 3]
    grown = ndi.grey_dilation(a, size=(int(radius * 2 + 1),) * 2)
    grown = ndi.gaussian_filter(grown, radius * 0.4)
    rim = np.clip(grown - a, 0, 1) * strength
    out = rgba.copy()
    out_a = a + rim * (1 - a)
    rgb = (rgba[..., :3] * a[..., None] + np.zeros(3) * rim[..., None] * (1 - a[..., None]))
    out[..., :3] = np.where(out_a[..., None] > 1e-5, rgb / np.maximum(out_a[..., None], 1e-5), 0)
    out[..., 3] = out_a
    return out


def polyline_mask(H, W, pts, width, ss=3):
    """Anti-aliased polyline coverage (pts in pixel coords)."""
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, y0 = int(max(0, min(xs) - width - 2)), int(max(0, min(ys) - width - 2))
    x1, y1 = int(min(W, max(xs) + width + 3)), int(min(H, max(ys) + width + 3))
    if x1 <= x0 or y1 <= y0:
        return None
    im = Image.new('L', ((x1 - x0) * ss, (y1 - y0) * ss), 0)
    dr = ImageDraw.Draw(im)
    dr.line([((p[0] - x0) * ss, (p[1] - y0) * ss) for p in pts], fill=255, width=max(1, int(round(width * ss))),
            joint='curve')
    m = np.asarray(im, np.float32) / 255.0
    m = m.reshape(y1 - y0, ss, x1 - x0, ss).mean(axis=(1, 3))
    return x0, y0, m


# ----------------------------------------------------------------------------------------------
# Grades (the engine's post LUT)
# ----------------------------------------------------------------------------------------------

def grade(img, style):
    """The post LUT (10 §6.2 step 9 carries a 3D LUT already, for colour-blind modes). Per style:
    kodachrome = deep shadows, warm highlights, cool shadow split, greens pulled toward olive and
    held back, reds and blues kept rich (the 1940s Kodachrome palette); model = a light lift."""
    if style == 'kodachrome':
        x = np.clip(img, 0, 1)
        lum = (x * np.array([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
        # hue-selective saturation: hold green-yellow back, keep red/blue
        r, g, b = x[..., 0:1], x[..., 1:2], x[..., 2:3]
        greenness = np.clip((g - np.maximum(r, b)) * 4.0, 0, 1)
        sat = 1.06 - 0.22 * greenness
        x = lum + (x - lum) * sat
        # pull greens slightly toward olive (add red)
        x = x + greenness * np.array([0.018, -0.004, -0.012])
        x = np.clip(x, 0, 1)
        # S-curve and a little black depth
        x = x + 0.12 * (x - 0.5) * (1 - np.abs(2 * x - 1))
        x = np.clip((x - 0.015) / 0.985, 0, 1)
        sh = np.clip(1 - lum * 2.2, 0, 1)
        hi = np.clip(lum * 1.6 - 0.6, 0, 1)
        x = x + sh * np.array([-0.010, 0.0, 0.018]) + hi * np.array([0.022, 0.010, -0.016])
        return np.clip(x, 0, 1)
    if style == 'model':
        x = np.clip(img, 0, 1)
        lum = (x * np.array([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
        x = lum + (x - lum) * 1.04
        return np.clip(x * 1.02 + 0.01, 0, 1)
    return img


# ----------------------------------------------------------------------------------------------
# Compose
# ----------------------------------------------------------------------------------------------

def compose(L, style, view, px, seed=3, verbose=True, grade_on=True, return_light=False):
    vx0, vy0, vw, vh = view
    W, H = int(round(vw * px)), int(round(vh * px))
    st = S.STYLES[style]

    def scr(x, y, z=0.0):
        return (x - vx0) * px, (y - vy0 - z) * px

    # 1 terrain: tile window covering the view
    tx0, ty0 = int(math.floor(vx0)), int(math.floor(vy0))
    tx1, ty1 = int(math.ceil(vx0 + vw)), int(math.ceil(vy0 + vh))
    sub = np.full((ty1 - ty0, tx1 - tx0), T.TID['grass'], np.int32)
    ix0, iy0 = max(tx0, L.x0), max(ty0, L.y0)
    ix1, iy1 = min(tx1, L.x0 + L.w), min(ty1, L.y0 + L.h)
    if ix1 > ix0 and iy1 > iy0:
        sub[iy0 - ty0:iy1 - ty0, ix0 - tx0:ix1 - tx0] = L.tiles[iy0 - L.y0:iy1 - L.y0, ix0 - L.x0:ix1 - L.x0]
    mats = T.materials(style, px)
    terr, ids = T.render(sub, style, px, mats, origin=(tx0, ty0), seed=seed)
    ox, oy = int(round((vx0 - tx0) * px)), int(round((vy0 - ty0) * px))
    img = terr[oy:oy + H, ox:ox + W].copy()
    if verbose:
        print('[compose] terrain', img.shape, flush=True)

    if style == 'survey':
        # woodland tint (topographic convention): a green wash under tree clusters
        wood = np.zeros((H, W), np.float32)
        for e in L.ents:
            if e.eid == 'tree':
                x, y = scr(e.cx, e.cy)
                xi, yi = int(x), int(y)
                if -px * 3 < xi < W + px * 3 and -px * 3 < yi < H + px * 3:
                    r = int(1.6 * px)
                    y0_, y1_, x0_, x1_ = max(0, yi - r), min(H, yi + r), max(0, xi - r), min(W, xi + r)
                    if y1_ > y0_ and x1_ > x0_:
                        wood[y0_:y1_, x0_:x1_] = 1.0
        wood = np.clip(ndi.gaussian_filter(wood, px * 0.6) * 1.6, 0, 1)
        img = img * (1 - 0.30 * wood[..., None]) + img * post.hexc('#c9dca8') / post.hexc('#ece3cb') * 0.30 * wood[..., None]

    shadow = np.zeros((H, W), np.float32)
    margin = 12

    def visible(e):
        return (vx0 - margin < e.cx < vx0 + vw + margin) and (vy0 - margin < e.cy < vy0 + vh + margin)

    ents = [e for e in L.ents if visible(e)]

    def draw_ent(e, shadow_only=False, colour=True):
        spr = sprite(style, e.eid, e.stem, px)
        if spr is None:
            return
        sx, sy = scr(e.cx, e.cy)
        x, y = int(round(sx - spr['ax'])), int(round(sy - spr['ay']))
        if not shadow_only and colour:
            blit(img, spr['rgba'], x, y)
        blit_max(shadow, spr['shadow'], x, y)

    # 2 ground layer: resources and decoratives, then belts, then belt items
    ground = sorted([e for e in ents if e.layer in ('resource', 'decor')], key=lambda e: (e.cy, e.cx))
    for e in ground:
        draw_ent(e)
    belts = sorted([e for e in ents if e.layer == 'belt'], key=lambda e: (e.cy, e.cx))
    for e in belts:
        draw_ent(e)
    isz = {}
    for (item, x, y, z, size, layer) in sorted([i for i in L.items if i[5] == 'belt'], key=lambda i: (i[2], i[1])):
        s = int(round(size * px))
        if s not in isz:
            isz[s] = True
        ic = icon(style, item, s)
        sx, sy = scr(x, y, z)
        blit(img, ic, int(round(sx - s / 2)), int(round(sy - s / 2)))
    if verbose:
        print('[compose] ground', len(ground), 'belts', len(belts), flush=True)

    # shadows of objects and high layers go into the shadow layer before objects are drawn
    objs = sorted([e for e in ents if e.layer in ('object',)], key=lambda e: (e.cy + e.h / 2, e.cx))
    highs = [e for e in ents if e.layer == 'high']
    for e in objs + highs:
        draw_ent(e, shadow_only=True)
    # wire shadows
    sd = S.SHADOW_DIR
    kx, ky = -sd[0] / sd[2], sd[1] / sd[2]      # ground offset per metre of height (east +, game south +)
    wire_w = max(1.0, 2.0 * px / 64)
    for pts in L.wires:
        gp = [scr(x + z * kx, y + z * ky, 0) for (x, y, z) in pts]
        r = polyline_mask(H, W, gp, wire_w * 1.3)
        if r:
            x0, y0, m = r
            np.maximum(shadow[y0:y0 + m.shape[0], x0:x0 + m.shape[1]], m * 0.55,
                       out=shadow[y0:y0 + m.shape[0], x0:x0 + m.shape[1]])

    # 3 apply shadows
    if style == 'survey':
        hat = post.hatch(H, W, period=7.0 * px / 64, width=1.7 * px / 64, angle=-45.0)
        m = np.clip(shadow * 1.4, 0, 1) * hat
        ink = post.hexc(st['ink'])
        img = img * (1 - 0.55 * m[..., None]) + ink * 0.55 * m[..., None]
        img *= (1 - 0.06 * np.clip(shadow, 0, 1))[..., None]
    else:
        shade = np.array(SHADE[style], np.float32)
        k = np.clip(shadow, 0, 1)[..., None] * st['shadow_opacity'] / 0.58
        img = img * (1 - k + k * shade)

    # 4 objects
    light = np.zeros((H, W, 3), np.float32)
    for e in objs:
        draw_ent(e, colour=True)
        spr = sprite(style, e.eid, e.stem, px)
        if spr is not None and spr.get('glow') is not None:
            sx, sy = scr(e.cx, e.cy)
            x, y = int(round(sx - spr['ax'])), int(round(sy - spr['ay']))
            g = spr['glow']
            x0, y0 = max(0, x), max(0, y)
            x1, y1 = min(W, x + g.shape[1]), min(H, y + g.shape[0])
            if x1 > x0 and y1 > y0:
                light[y0:y1, x0:x1] += g[y0 - y:y1 - y, x0 - x:x1 - x]
    if verbose:
        print('[compose] objects', len(objs), flush=True)
    # 4b the light layer by day: a faint warm wash around working fires and lamps (screen blend)
    if light.any():
        k = st.get('day_glow', 0.0)
        if st['render'] == 'flat':
            # on paper a light reads as a warm watercolour stain: multiply toward the lamp's colour
            amt = np.clip(light.max(-1, keepdims=True), 0, 1)
            hue = light / np.maximum(amt, 1e-4)
            img = img * (1 - k * amt * (1 - hue))
        else:
            img = 1 - (1 - img) * (1 - np.clip(light * k, 0, 1))
    # 4c smoke: render-time particles from working burners (never simulated; 10 §6.8)
    draw_smoke(img, L, style, scr, px, ents)
    # 5 high: arms and held items
    for e in highs:
        spr = sprite(style, e.eid, e.stem, px)
        if spr is None:
            continue
        sx, sy = scr(e.cx, e.cy)
        blit(img, spr['rgba'], int(round(sx - spr['ax'])), int(round(sy - spr['ay'])))
    for (item, x, y, z, size, layer) in [i for i in L.items if i[5] == 'high']:
        s = int(round(size * px))
        ic = icon(style, item, s)
        sx, sy = scr(x, y, z)
        blit(img, ic, int(round(sx - s / 2)), int(round(sy - s / 2)))
    # wires
    wcol = post.hexc('#2b2420') if style != 'model' else post.hexc('#3a3330')
    for pts in L.wires:
        sp = [scr(x, y, z) for (x, y, z) in pts]
        r = polyline_mask(H, W, sp, wire_w)
        if r:
            x0, y0, m = r
            reg = img[y0:y0 + m.shape[0], x0:x0 + m.shape[1]]
            reg[...] = reg * (1 - 0.9 * m[..., None]) + wcol * 0.9 * m[..., None]
    # 6 grade
    if grade_on:
        img = grade(img, style)
    if return_light:
        return np.clip(img, 0, 1), light
    return np.clip(img, 0, 1)


# chimney tops in entity-local metres (x east, y north, z up) for the default direction
CHIMNEYS = {
    'stone-furnace': [(0.18, 0.26, 1.50)],
    'keypunch': [(-0.72, 0.54, 1.62)],
    'boiler': [(-1.05, 0.55, 3.30)],
}
ROT = {'S': lambda x, y: (x, y), 'W': lambda x, y: (y, -x), 'N': lambda x, y: (-x, -y), 'E': lambda x, y: (-y, x)}


def draw_smoke(img, L, style, scr, px, ents):
    """Smoke from working burners: three puffs per chimney drifting east and rising. On the survey
    plate each puff is a cloud (a union of circles) with a light grey wash and an inked contour; in
    the rendered styles a soft plume."""
    H, W = img.shape[:2]
    rng = np.random.default_rng(5)
    ink = post.hexc(S.STYLES[style].get('ink', '#2b2723'))
    for e in ents:
        if e.eid not in CHIMNEYS or e.layer != 'object' or e.stem.endswith('idle'):
            continue
        d = e.stem.split('-')[-2] if e.eid == 'boiler' else 'S'
        for (lx, ly, lz) in CHIMNEYS[e.eid]:
            rx, ry = ROT.get(d, ROT['S'])(lx, ly)
            gx, gy = e.cx + rx, e.cy - ry
            phase = rng.random() * 0.8
            for k in range(3):
                t = k + phase + 0.4
                r = (0.13 + 0.07 * t) * px
                cx, cy = scr(gx, gy, lz)
                cx += (0.32 * t + 0.04 * t * t) * px
                cy -= (0.34 * t) * px
                a = max(0.0, 0.9 - 0.25 * t)
                R = int(r * 1.8) + 4
                x0, y0 = int(cx) - R, int(cy) - R
                if x0 < 0 or y0 < 0 or x0 + 2 * R >= W or y0 + 2 * R >= H:
                    continue
                yy, xx = np.mgrid[-R:R, -R:R].astype(np.float32)
                du = np.full(yy.shape, 1e9, np.float32)
                for (ox, oy, rr) in ((0, 0, 1.0), (-0.55, 0.25, 0.7), (0.55, 0.2, 0.75), (0.1, -0.45, 0.65)):
                    du = np.minimum(du, np.hypot(xx - ox * r, yy - oy * r) - rr * r)
                reg = img[y0:y0 + 2 * R, x0:x0 + 2 * R]
                if style == 'survey':
                    fill = np.clip(0.5 - du, 0, 1) * a
                    lw = max(0.9, px / 40)
                    line = np.clip(1.0 - np.abs(du) / lw, 0, 1) * a
                    wash = post.hexc('#e6e1d6')
                    reg[...] = reg * (1 - fill[..., None] * 0.85) + wash * fill[..., None] * 0.85
                    reg[...] = reg * (1 - line[..., None] * 0.55) + ink * line[..., None] * 0.55
                else:
                    fill = np.exp(-np.clip(du / max(1.0, r) + 1.0, 0, None) ** 2 * 2.0) * a * 0.5
                    c = np.array([0.80, 0.80, 0.79]) if style != 'model' else np.array([0.95, 0.95, 0.95])
                    reg[...] = reg * (1 - fill[..., None]) + c * fill[..., None]


def save(img, path):
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)
