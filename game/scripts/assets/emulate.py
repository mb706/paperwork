"""A numpy emulation of the renderer's frame (10 §6.2, §9.8, §9.9, §15.7), drawing from the encoded atlases.

The asset build's previews, contact sheets and the projection calibration use it, so they show what the GPU will
sample: every page is the KTX2 file transcoded back to BC7 (BC4 for shadows) by basisu -unpack, at the level the
zoom selects. It follows the spec's formulas; the renderer package owns the real thing (WebGL2), and the gallery
screenshots of 10 §9.5 #6 compare the two.

    E = Emulator(manifest)                       # pages decoded lazily, cached in .cache/assets/unpack/
    img = E.frame(scene, cam)                    # scene: terrain + sprites (manifest.py's draw programs)

Zooms whose source-texel scale is a power of two (k = 2^-L at level L) draw texel-exact; others resample the
nearest level bilinearly, premultiplied, as the GPU's sampler does.
"""

import math
import os
import subprocess

import numpy as np
from scipy import ndimage as ndi

import common as K
import manifest as MF

INK = K.hexc(K.INK_HEX)
PAPER = K.hexc(K.PAPER_HEX)
UNPACK = os.path.join(K.CACHE, 'unpack')
CODE = {'colour': 6, 'light': 6, 'icon': 6, 'shadow': 4}


def unpack_levels(ktx2, code):
    out = os.path.join(UNPACK, os.path.basename(ktx2) + f'.{code}')
    if not os.path.isdir(out) or not os.listdir(out):
        os.makedirs(out, exist_ok=True)
        subprocess.run(['basisu', '-unpack', '-format_only', str(code), '-no_ktx', ktx2, '-output_path', out],
                       check=True, capture_output=True)
    levels = {}
    for f in os.listdir(out):
        if '_rgba_' not in f and '_rgb_' not in f:
            continue
        lv = int(f.split('_level_')[1].split('_')[0]) if '_level_' in f else 0
        if '_rgba_' in f or lv not in levels:
            levels[lv] = os.path.join(out, f)
    return [K.read_png(levels[k]) for k in sorted(levels)]


class Emulator:
    def __init__(self, man, root=K.PUBLIC):
        self.man = man
        self.root = root
        self._pages = {}

    def page(self, a, layer, level):
        """The decoded page (premultiplied RGBA float, or (h, w, 1) for shadows) at a level."""
        key = (a, layer)
        if key not in self._pages:
            arr = self.man['arrays'][a]
            pg = self.man['pages'][a][layer]
            lv = []
            for f in pg['files']:
                path = os.path.join(self.root, f)
                if arr['codec'] == 'rgba8':
                    import ktx2
                    lv += ktx2.read_levels(path)
                else:
                    lv += unpack_levels(path, CODE[arr['kind']])
            for i, im in enumerate(lv):
                if arr['kind'] == 'shadow':
                    lv[i] = im[..., :1]
                elif im.shape[2] == 3:
                    lv[i] = np.concatenate([im, np.ones(im.shape[:2] + (1,), np.float32)], -1)
            self._pages[key] = lv
        lv = self._pages[key]
        return lv[min(level, len(lv) - 1)]

    # --------------------------------------------------------------------------------------------------------
    def blit(self, dst, fid, left, top, k, op='over', tint=None, alpha=1.0, rotate=None, pivot=None):
        """Draw frame fid with its top-left at (left, top) device px of dst (floats), k device px per source px.
        op: 'over' (premultiplied), 'max' (shadow masks), 'add' (light)."""
        a, layer, x, y, w, h, ax, ay = self.man['frames'][fid]
        lvl = 0
        while k * (2 ** (lvl + 1)) <= 1.0 + 1e-9 and lvl + 1 < self.man['arrays'][a]['levels']:
            lvl += 1
        page = self.page(a, layer, lvl)
        f = 2 ** lvl
        src = page[y // f:(y + h) // f, x // f:(x + w) // f]
        kk = k * f                                              # device px per texel of this level
        if rotate is not None:
            (px, py), at = pivot                                # the pivot is in level-0 px of the frame
            self._blit_rot(dst, src, left, top, kk, op, rotate, ((px / f, py / f), at), alpha)
            return
        H, W = dst.shape[:2]
        sh, sw = src.shape[:2]
        if abs(kk - round(kk)) < 1e-9 and abs(left - round(left)) < 1e-6 and abs(top - round(top)) < 1e-6:
            kr = int(round(kk))
            img = np.repeat(np.repeat(src, kr, 0), kr, 1) if kr > 1 else src
            l0, t0 = int(round(left)), int(round(top))
        else:
            # bilinear resample onto the device grid (pixel centres), premultiplied
            out_w, out_h = int(math.ceil(left + sw * kk)) - int(math.floor(left)), int(math.ceil(top + sh * kk)) - int(math.floor(top))
            l0, t0 = int(math.floor(left)), int(math.floor(top))
            jj, ii = np.mgrid[0:out_h, 0:out_w].astype(np.float32)
            u = (ii + 0.5 + l0 - left) / kk - 0.5
            v = (jj + 0.5 + t0 - top) / kk - 0.5
            inside = (u >= -0.5) & (u <= sw - 0.5) & (v >= -0.5) & (v <= sh - 0.5)
            img = bilinear(src, u, v) * inside[..., None]
        self._composite(dst, img, l0, t0, op, alpha)

    def _blit_rot(self, dst, src, left, top, kk, op, theta_turns, pivot, alpha):
        """Rotated draw: the frame's pivot (frame px) placed at device point `pivot`, rotated clockwise."""
        (px, py), (Px, Py) = pivot
        sh, sw = src.shape[:2]
        r = math.hypot(max(px, sw * 1 - px), max(py, sh - py)) * kk + 2
        x0, x1 = int(math.floor(Px - r)), int(math.ceil(Px + r))
        y0, y1 = int(math.floor(Py - r)), int(math.ceil(Py + r))
        jj, ii = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        dx, dy = ii + 0.5 - Px, jj + 0.5 - Py
        c, s = math.cos(2 * math.pi * theta_turns), math.sin(2 * math.pi * theta_turns)
        # inverse rotation (screen -> frame): rotate by -theta
        fx = (dx * c + dy * s) / kk + px
        fy = (-dx * s + dy * c) / kk + py
        u, v = fx - 0.5, fy - 0.5
        inside = (u >= -0.5) & (u <= sw - 0.5) & (v >= -0.5) & (v <= sh - 0.5)
        img = bilinear(src, u, v) * inside[..., None]
        self._composite(dst, img, x0, y0, op, alpha)

    @staticmethod
    def _composite(dst, img, l0, t0, op, alpha):
        H, W = dst.shape[:2]
        h, w = img.shape[:2]
        cx0, cy0 = max(0, l0), max(0, t0)
        cx1, cy1 = min(W, l0 + w), min(H, t0 + h)
        if cx1 <= cx0 or cy1 <= cy0:
            return
        s = img[cy0 - t0:cy1 - t0, cx0 - l0:cx1 - l0] * alpha
        d = dst[cy0:cy1, cx0:cx1]
        if op == 'over':
            d[...] = s + d * (1 - s[..., 3:4])
        elif op == 'max':
            d[...] = np.maximum(d, s[..., :1])
        elif op == 'add':
            d[...] = d + s[..., :3]


def bilinear(src, u, v):
    sh, sw = src.shape[:2]
    u = np.clip(u, 0, sw - 1.0001)
    v = np.clip(v, 0, sh - 1.0001)
    a, b = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = (u - a)[..., None], (v - b)[..., None]
    a1, b1 = np.minimum(a + 1, sw - 1), np.minimum(b + 1, sh - 1)
    return (src[b, a] * (1 - fu) * (1 - fv) + src[b, a1] * fu * (1 - fv) + src[b1, a] * (1 - fu) * fv
            + src[b1, a1] * fu * fv)


# ------------------------------------------------------------------------------------------------------------
# The Survey look (10 §9.8)
# ------------------------------------------------------------------------------------------------------------

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def hatch_shadows(colour, mask, cam, world_x0, world_y0):
    """10 §9.8's shadow composite: world-anchored hatching at -45 degrees through the (MAX-blended) mask."""
    S = MF.scale(cam)
    H, W = colour.shape[:2]
    jj, ii = np.mgrid[0:H, 0:W].astype(np.float32)
    tx = world_x0 + (ii + 0.5) / S
    ty = world_y0 + (jj + 0.5) / S
    period, width = 7 / 64, 1.7 / 64
    u = tx * 0.70710678 - ty * 0.70710678
    dist = (0.5 - np.abs(np.mod(u / period, 1.0) - 0.5)) * period
    aa = 0.75 / S
    line = 1.0 - smoothstep(0.5 * width - aa, 0.5 * width + aa, dist)
    t = smoothstep(2.0, 3.0, period * S)
    hat = (width / period) * (1 - t) + line * t
    m = np.clip(mask[..., 0] * 1.4, 0, 1)
    h = hat * m
    out = colour * (1 - 0.55 * h[..., None]) + INK * 0.55 * h[..., None]
    return out * (1 - 0.06 * m[..., None])


def cyanotype(day):
    lum = (day * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    deep, pale = K.hexc('#13304f'), K.hexc('#d6e4ec')
    cy = pale + (deep - pale) * np.clip((lum - 0.12) / 0.80, 0, 1)
    return cy * 0.82 + day * np.array([0.45, 0.55, 0.85], np.float32) * 0.18


def light_composite(colour, L, night):
    """10 §9.8: by day a warm stain, at night the cyanotype with the light's reveal; n = night strength."""
    a = np.clip(L.max(-1, keepdims=True), 0, 1)
    hue = L / np.maximum(a, 1e-4)
    day = colour * (1.0 - 0.6 * a * (1.0 - hue))
    if night <= 0:
        return day
    cy = cyanotype(np.clip(colour, 0, 1))
    reveal = np.clip(a * 1.6 * 1.4, 0, 1)
    nt = cy * (1 - reveal) + colour * reveal
    nt = 1.0 - (1.0 - nt) * (1.0 - np.clip(L * 0.9, 0, 1))
    return day * (1 - night) + nt * night


# ------------------------------------------------------------------------------------------------------------
# Terrain (10 §9.9's shader, as numpy): materials in world space, warped soft edges, crisp types, water-lining
# ------------------------------------------------------------------------------------------------------------

CRISP = {'town-street', 'town-block', 'concrete', 'refined-concrete', 'hazard-concrete', 'refined-hazard-concrete',
         'out-of-map'}


def value_grid(seed, shape):
    return np.random.default_rng(seed).random(shape).astype(np.float32)


def terrain(tilemap, names, mats, cam, x0, y0, W, H, seed=3):
    """tilemap: (th, tw) ids into `names` covering tiles [x0, x0 + tw) x [y0, y0 + th); returns (H, W, 3) for the
    device rectangle whose top-left is world (x0, y0) at the camera's scale."""
    S = MF.scale(cam)
    th, tw = tilemap.shape
    jj, ii = np.mgrid[0:H, 0:W].astype(np.float32)
    wx = x0 + (ii + 0.5) / S
    wy = y0 + (jj + 0.5) / S
    # world-anchored warp: 0.32 tile amplitude on 1.6-tile cells (a smooth value noise), blended over 0.55 tile
    g = value_grid(seed, (int(th / 1.6) + 4, int(tw / 1.6) + 4)) - 0.5
    g2 = value_grid(seed + 1, g.shape) - 0.5
    gx = ndi.map_coordinates(g, [(wy - y0) / 1.6 + 1, (wx - x0) / 1.6 + 1], order=3, mode='nearest')
    gy = ndi.map_coordinates(g2, [(wy - y0) / 1.6 + 1, (wx - x0) / 1.6 + 1], order=3, mode='nearest')
    best = np.full((H, W), -1e9, np.float32)
    ids = np.zeros((H, W), np.int32)
    present = sorted(set(int(t) for t in np.unique(tilemap)))
    for t in present:
        m = (tilemap == t).astype(np.float32)
        if names[t] in CRISP:
            f = ndi.map_coordinates(m, [wy - y0 - 0.5, wx - x0 - 0.5], order=0, mode='nearest') * 10.0
        else:
            mb = ndi.gaussian_filter(m, 0.55, mode='nearest')
            f = ndi.map_coordinates(mb, [wy - y0 - 0.5 + gy * 0.64, wx - x0 - 0.5 + gx * 0.64], order=1,
                                    mode='nearest')
        upd = f > best
        best[upd] = f[upd]
        ids[upd] = t
    out = np.zeros((H, W, 3), np.float32)
    for t in present:
        mat = mats[names[t]]
        n = mat.shape[0]
        sel = ids == t
        if not sel.any():
            continue
        px = (np.floor(wx * 64).astype(np.int64)) % n
        py = (np.floor(wy * 64).astype(np.int64)) % n
        if S < 64:
            lv = mat
            f = 64 / S
            lvl = int(round(math.log2(f))) if f >= 1 else 0
            if lvl > 0:
                for _ in range(lvl):
                    lv = K.box_down(lv, 2)
                n2 = lv.shape[0]
                px = (np.floor(wx * 64 / (2 ** lvl)).astype(np.int64)) % n2
                py = (np.floor(wy * 64 / (2 ** lvl)).astype(np.int64)) % n2
                mat = lv
        out[sel] = mat[py[sel], px[sel]]
    water = np.isin(ids, [i for i, n in enumerate(names) if n in ('water', 'deep-water')])
    if water.any():
        d_in = ndi.distance_transform_edt(water) / S
        d_out = ndi.distance_transform_edt(~water) / S
        ink = K.hexc('#56809a')
        lines = np.zeros_like(d_in)
        lw = 1.0 / S
        for p in (0.12, 0.30, 0.52, 0.80, 1.15, 1.60, 2.2, 3.0):
            lines = np.maximum(lines, np.clip(1 - np.abs(d_in - p) / lw, 0, 1) * (1 - p / 4.0))
        lines *= water * (0.0 if S < 16 else 1.0)
        out = out * (1 - 0.75 * lines[..., None]) + ink * 0.75 * lines[..., None]
        shore = np.clip(1.6 - np.abs(d_out * S - 0.5), 0, 1) * (~water)
        out = out * (1 - 0.85 * shore[..., None]) + K.hexc('#3f5f74') * 0.85 * shore[..., None]
    # crisp kerbs: an inked line where a crisp type meets another
    crisp_ids = [i for i, n in enumerate(names) if n in CRISP]
    if crisp_ids:
        c = np.isin(ids, crisp_ids)
        edge = c & ~ndi.binary_erosion(c, iterations=max(1, int(S // 32)))
        out[edge] = out[edge] * 0.25 + K.hexc('#3b332b') * 0.75
    return out
