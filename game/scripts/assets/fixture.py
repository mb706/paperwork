"""The tiny compatible atlas (10 §15.7 "Fixtures and versions", §15.10): test/fixtures/sprites/.

    gamedev-python game/scripts/assets/fixture.py [--prototypes-hash HEX]

A version-2 sprite manifest with codec `rgba8` pages (uncompressed KTX2, ktx2.py), so the renderer can draw the
golden set's packets before any art, transcoder or asset pipeline exists, and `cases.json`: packet-shaped inputs
with the expected draws, which the renderer's Vitest suite and the asset build's checks (checks.py) both run.

Sets: one of every kind 10 §15.7 lists (the stone furnace with an idle image and a layer, a belt with masks, an
inserter with pivots, the character with its three clips, a rail signal with lights, a tree with shape x stage, a
resource with shape x band, a locomotive with 64 orientations, the radar with an animated shadow, an icon), under
the names M0's prototypes use where M0 has them (entity/iron-chest, greybox/iron-chest, resource/iron-ore-patch,
mover/character, item/iron-plate, item/iron-ore, item/iron-chest, fx/missing). Placeholders are flat blocks in a
colour per set, with a pale tick toward the frame's direction and a shade per frame index, at 8 px per tile.
The belt's mask table is transport_belt.py's (its bit semantics are a proposal to the sim; see that file).

The atlas follows the build's exact composition (10 §9.1, §9.2; codex C6-r1 finding 3):
  * an animated set is made from complete frames: F0 is frame 0 whole, packed as one cell; the base pieces are
    sub-rectangles of that cell (F0 minus every layer's rectangle R); each layer frame is a cell of R plus a gutter
    of that frame's own neighbouring pixels. The moving content stays 2 px inside R, so F0 and every frame agree on
    R's band and filtering across a cut reads the right texels at both levels;
  * the furnace has a 22 %-opaque glass band crossing R's left and right edges (B2's translucent case);
  * every cell sits on 2 px with a gutter of one texel at the array's lowest level (colour and icons: 2 px, two
    levels; shadows and light: 1 px, one level), so the level-1 box filter and bilinear reads stay in the cell;
  * the inserter's frame anchors are consistent with its pivots: pivot - anchor is `shoulder` for the arm and
    hands and `shadowShoulder` for their shadows (manifest.py's inserter rule);
  * the radar's shadow follows the dish (`animShadow`).
checks.py runs the cases and draws every animated set from the decoded pages (composite.py): the pieces plus the
layers must equal the whole frame, dE <= 0.5, at levels 0 and 1.

Every number in cases.json comes from manifest.py; the interpretations it records where 10 §15.7 is silent are
listed at the top of manifest.py.
"""

import argparse
import colorsys
import hashlib
import importlib.util
import math
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import ktx2  # noqa: E402
import manifest as MF  # noqa: E402

OUT = os.path.join(K.GAME, 'test', 'fixtures', 'sprites')
PX = {'colour': 8, 'shadow': 4, 'light': 2, 'icon': 16}
PAGE = {'colour': 512, 'shadow': 256, 'light': 64, 'icon': 64}
LEVELS = {'colour': 2, 'shadow': 1, 'light': 1, 'icon': 2}
ARRAY_ORDER = ('colour', 'shadow', 'light', 'icon')
GUTTER = {'colour': 2, 'shadow': 1, 'light': 1, 'icon': 2}     # one texel at the array's lowest level
ALIGN = 2                                                      # cells on 2 px: level 1 never mixes two cells


class Atlas:
    def __init__(self):
        # (array, image (h, w, c) float premultiplied, ax, ay, source image, the frame's top-left in it)
        self.frames = []

    def add(self, array, img, ax, ay, src=None, at=(0, 0)):
        """A frame; `src` (with the frame's top-left at `at`) holds the pixels around it that fill its gutter (by
        default none: the gutter is transparent, as around a trimmed sprite)."""
        self.frames.append((array, img.astype(np.float32), ax, ay, src, at))
        return len(self.frames) - 1


def block(w, h, rgb, tick=None, shade=0.0, alpha=1.0):
    """A placeholder block: flat colour with a dark border; `tick` (turns from north, clockwise) draws a pale line
    from the centre toward that direction; `shade` (0..1) lightens it, so frames of one part differ."""
    img = np.zeros((h, w, 4), np.float32)
    c = np.array(rgb, np.float32) * (1 - 0.45 * shade) + 0.45 * shade
    img[..., :3] = c
    img[..., 3] = 1.0
    img[0, :, :3] = img[-1, :, :3] = img[:, 0, :3] = img[:, -1, :3] = c * 0.45
    if tick is not None:
        cx, cy = (w - 1) / 2, (h - 1) / 2
        ang = 2 * math.pi * tick
        for t in np.linspace(0, 1, 32):
            x = int(round(cx + math.sin(ang) * t * (w / 2 - 1)))
            y = int(round(cy - math.cos(ang) * t * (h / 2 - 1)))
            if 0 <= x < w and 0 <= y < h:
                img[y, x, :3] = 0.95
    img[..., :3] *= alpha
    img[..., 3] *= alpha
    return img


def mask_block(w, h, v=0.8):
    img = np.zeros((h, w, 1), np.float32)
    img[1:-1, 1:-1] = v
    return img


def colour_of(name):
    hsh = int(hashlib.sha256(name.encode()).hexdigest()[:6], 16)
    r, g, b = colorsys.hsv_to_rgb((hsh % 360) / 360.0, 0.55, 0.75)
    return (r, g, b)


def table(shape, fn):
    total = 1
    for n in shape:
        total *= n
    out = []
    for flat in range(total):
        idx, r = [], flat
        for n in reversed(shape):
            idx.append(r % n)
            r //= n
        out.append(list(fn(tuple(reversed(idx)))))
    return out


def load_belt():
    p = os.path.join(K.BLENDER_SRC, 'entities', 'transport_belt.py')
    spec = importlib.util.spec_from_file_location('fixture_belt', p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cut(rect, hole):
    """rect minus hole (inside it), as up to four rectangles (above, below, left, right; empty ones dropped)."""
    x0, y0, x1, y1 = rect
    hx0, hy0, hx1, hy1 = hole
    out = [(x0, y0, x1, hy0), (x0, hy1, x1, y1), (x0, hy0, hx0, hy1), (hx1, hy0, x1, hy1)]
    return [q for q in out if q[2] > q[0] and q[3] > q[1]]


def layered(A, frames, anchor, R):
    """An animated set from its complete frames (premultiplied, same size; `R` = the layer's rectangle in them):
    F0 packed whole, its pieces around R, and each frame's R with a gutter of that frame's own pixels."""
    H, W = frames[0].shape[:2]
    for k, fr in enumerate(frames):
        band = np.ones((H, W), bool)
        band[R[1] + 2:R[3] - 2, R[0] + 2:R[2] - 2] = False
        if np.abs(fr - frames[0])[band].max() > 0:
            raise ValueError(f'fixture: frame {k} differs from F0 outside R\'s inner area')
    f0 = A.add('colour', frames[0], anchor[0], anchor[1])
    pieces = [('piece', f0, q) for q in cut((0, 0, W, H), R)]
    layer = [A.add('colour', fr[R[1]:R[3], R[0]:R[2]], anchor[0] - R[0], anchor[1] - R[1], src=fr, at=(R[0], R[1]))
             for fr in frames]
    return pieces, layer


# ---------------------------------------------------------------------------------------------------------------
# The sets
# ---------------------------------------------------------------------------------------------------------------

def furnace_frame(col, k):
    """The stone furnace's complete frame k (16 x 24 px, 2 x 2 tiles): a block, a 22 %-opaque glass band across the
    sprite through R = (4, 8, 12, 16), and the fire, a 4 x 4 square 2 px inside R, lighter with each frame."""
    img = block(16, 24, col)
    glass = np.array([0.80, 0.88, 0.95], np.float32)
    img[10:12, 1:15, :3] = glass * 0.22
    img[10:12, 1:15, 3] = 0.22
    fire = np.array([0.95, 0.55, 0.20], np.float32) * (1 - 0.45 * k / 15) + 0.45 * k / 15
    img[10:14, 6:10, :3] = fire
    img[10:14, 6:10, 3] = 1.0
    return img


def radar_frame(rc, k):
    """The radar's complete frame k (24 x 24 px, 3 x 3 tiles): a block with the dish, an 8 x 8 block whose tick
    turns k / 64, 2 px inside R = (6, 0, 18, 12)."""
    img = block(24, 24, rc)
    img[2:10, 8:16] = block(8, 8, (0.6, 0.65, 0.7), tick=k / 64)
    return img


def build_sets(A):
    sets = {}
    four_way = [0, 4, 4, 4, 1, 4, 4, 4, 2, 4, 4, 4, 3, 4, 4, 4]          # 0, 4, 8, 12 and an empty slot
    one = [0] * 16

    # --- entity/stone-furnace: F0 cut into pieces around R, a 16-frame layer, an idle image, shadow and light
    col = colour_of('stone-furnace')
    pieces, layer = layered(A, [furnace_frame(col, k) for k in range(16)], (8, 20), (4, 8, 12, 16))
    idle = A.add('colour', block(16, 24, col, shade=0.6), 8, 20)
    sh = A.add('shadow', mask_block(10, 6), 2, 3)
    li = A.add('light', block(4, 4, (1.0, 0.6, 0.2)), 2, 3)
    sets['entity/stone-furnace'] = dict(kind='entity', group='core', size=[2, 2], parts=dict(
        base=dict(axes=['dir'], shape=[1], map=dict(dir=one), table=[pieces]),
        layers=[dict(axes=['dir', 'frame'], shape=[1, 16], map=dict(dir=one), table=[[i] for i in layer])],
        idle=dict(axes=['dir'], shape=[1], map=dict(dir=one), table=[[idle]]),
        shadow=dict(axes=['dir'], shape=[1], map=dict(dir=one), table=[[sh]]),
        light=dict(axes=['dir'], shape=[1], map=dict(dir=one), table=[[li]])))

    # --- entity/transport-belt: [dir, mask, frame] with the belt script's mask combinations; 2 frames
    belt = load_belt()
    combos, mmap = [], []
    for m in range(256):
        key = tuple(belt.mask_variants(m))
        if key not in combos:
            combos.append(key)
        mmap.append(combos.index(key))
    bcol = colour_of('transport-belt')
    bf = {}
    for di in range(4):
        for v in range(5):
            for f in range(2):
                bf[(di, v, f)] = A.add('colour', block(8, 8, bcol, tick=di / 4, shade=(v * 2 + f) / 10), 4, 4)
    bsh = {(di, v): A.add('shadow', mask_block(4, 4, 0.5), 2, 2) for di in range(4) for v in range(5)}

    def belt_entry(i):
        di, ci, f = i
        if di == 4:
            return []
        return [bf[(di, v, f)] for v in combos[ci]]

    def belt_shadow(i):
        di, ci = i
        if di == 4:
            return []
        return [bsh[(di, combos[ci][0])]]

    sets['entity/transport-belt'] = dict(kind='entity', group='core', size=[1, 1], framesPerTile=8, parts=dict(
        base=dict(axes=['dir', 'mask', 'frame'], shape=[5, len(combos), 2], map=dict(dir=four_way, mask=mmap),
                  table=table([5, len(combos), 2], belt_entry)),
        shadow=dict(axes=['dir', 'mask'], shape=[5, len(combos)], map=dict(dir=four_way, mask=mmap),
                    table=table([5, len(combos)], belt_shadow))))

    # --- entity/inserter: platform [dir], arm, hands, with pivots; shadows alike. Each frame's anchor is where
    # the part's ground point lies, so pivot - anchor is the shoulder (shadowShoulder for the shadows)
    icol = colour_of('inserter')
    shoulder, shadow_shoulder = [0, -3.76], [2.686, 0.739]

    def rot_part(array, img, pivot, offset):
        return A.add(array, img, round(pivot[0] - offset[0], 3), round(pivot[1] - offset[1], 3))

    plat = [A.add('colour', block(8, 8, icol, tick=d / 4), 4, 5) for d in range(4)]
    plat_sh = [A.add('shadow', mask_block(4, 4), 2, 2) for _ in range(4)]
    arm = rot_part('colour', block(4, 10, (0.9, 0.75, 0.25), tick=0.0), (2, 9), shoulder)
    arm_sh = rot_part('shadow', mask_block(2, 5), (1, 4), shadow_shoulder)
    ho = rot_part('colour', block(4, 4, (0.3, 0.3, 0.3), shade=0.5), (2, 3), shoulder)
    hc = rot_part('colour', block(4, 4, (0.3, 0.3, 0.3)), (2, 3), shoulder)
    ho_sh = rot_part('shadow', mask_block(2, 2), (1, 1), shadow_shoulder)
    hc_sh = rot_part('shadow', mask_block(2, 2), (1, 1), shadow_shoulder)
    sets['entity/inserter'] = dict(kind='inserter', group='core', size=[1, 1], shoulder=shoulder,
                                   shadowShoulder=shadow_shoulder, parts=dict(
        platform=dict(axes=['dir'], shape=[5], map=dict(dir=four_way), table=[[i] for i in plat] + [[]]),
        platform_shadow=dict(axes=['dir'], shape=[5], map=dict(dir=four_way), table=[[i] for i in plat_sh] + [[]]),
        arm=dict(axes=[], shape=[], table=[[arm]], pivot=[2, 9], length=8),
        arm_shadow=dict(axes=[], shape=[], table=[[arm_sh]], pivot=[1, 4]),
        hand_open=dict(axes=[], shape=[], table=[[ho]], pivot=[2, 3]),
        hand_closed=dict(axes=[], shape=[], table=[[hc]], pivot=[2, 3]),
        hand_open_shadow=dict(axes=[], shape=[], table=[[ho_sh]], pivot=[1, 1]),
        hand_closed_shadow=dict(axes=[], shape=[], table=[[hc_sh]], pivot=[1, 1])))

    # --- mover/character: idle [8, 4], run [8, 16], mine [8, 16], with shadows per frame
    ccol = colour_of('character')
    parts = {}
    for clip, n, extra in (('idle', 4, dict(fps=2.0)), ('run', 16, dict(cycleTiles=2.3)), ('mine', 16, dict(fps=16.0))):
        ids = {(o, f): A.add('colour', block(4, 8, ccol, tick=o / 8, shade=f / n), 2, 7) for o in range(8)
               for f in range(n)}
        sids = {(o, f): A.add('shadow', mask_block(4, 2, 0.4 + 0.02 * f), 1, 1) for o in range(8) for f in range(n)}
        parts[clip] = dict(axes=['orientation', 'frame'], shape=[8, n], table=table([8, n], lambda i, t=ids: [t[i]]),
                           **extra)
        parts[clip + '_shadow'] = dict(axes=['orientation', 'frame'], shape=[8, n],
                                       table=table([8, n], lambda i, t=sids: [t[i]]), **extra)
    sets['mover/character'] = dict(kind='mover', group='core', parts=parts)

    # --- entity/rail-signal: [dir 16 (rails use all 16), light: the status code], light glows alike
    scol = colour_of('rail-signal')
    lights = [(0.85, 0.2, 0.2), (0.9, 0.8, 0.2), (0.3, 0.8, 0.3)]
    lmap = [min(v, 3) for v in range(256)]                     # status 0 red, 1 yellow, 2 green, others: empty
    sb = {(d, s): A.add('colour', block(4, 8, scol, tick=d / 16, shade=s / 3), 2, 7)
          for d in range(16) for s in range(3)}
    sg = {(d, s): A.add('light', block(2, 2, lights[s]), 1, 3) for d in range(16) for s in range(3)}
    ssh = {d: A.add('shadow', mask_block(2, 4), 1, 3) for d in range(16)}
    ident = list(range(16))
    sets['entity/rail-signal'] = dict(kind='entity', group='core', size=[1, 1], lightFrom='status', parts=dict(
        base=dict(axes=['dir', 'light'], shape=[16, 4], map=dict(dir=ident, light=lmap),
                  table=table([16, 4], lambda i: [sb[i]] if i[1] < 3 else [])),
        light=dict(axes=['dir', 'light'], shape=[16, 4], map=dict(dir=ident, light=lmap),
                   table=table([16, 4], lambda i: [sg[i]] if i[1] < 3 else [])),
        shadow=dict(axes=['dir'], shape=[16], map=dict(dir=ident), table=[[ssh[d]] for d in range(16)])))

    # --- object/tree-oak: [shape 4, stage 5], shadows [shape 4]
    tcol = colour_of('tree')
    tb = {(s, g): A.add('colour', block(8, 16, tcol, shade=g / 5 + s / 20), 4, 15) for s in range(4) for g in range(5)}
    tsh = [A.add('shadow', mask_block(8, 4), 1, 2) for _ in range(4)]
    sets['object/tree-oak'] = dict(kind='object', group='core', parts=dict(
        base=dict(axes=['shape', 'stage'], shape=[4, 5], map=dict(stage=[0, 1, 2, 3, 4]),
                  table=table([4, 5], lambda i: [tb[i]])),
        shadow=dict(axes=['shape'], shape=[4], table=[[i] for i in tsh])))

    # --- resource/iron-ore-patch: [shape 6, band 8], shadows alike
    rcol = colour_of('iron-ore')
    rb = {(s, b): A.add('colour', block(8, 8, rcol, shade=(7 - b) / 8, alpha=0.5 + b / 16), 4, 5) for s in range(6)
          for b in range(8)}
    rsh = {(s, b): A.add('shadow', mask_block(4, 3, 0.3), 2, 2) for s in range(6) for b in range(8)}
    sets['resource/iron-ore-patch'] = dict(kind='resource', group='core', parts=dict(
        base=dict(axes=['shape', 'band'], shape=[6, 8], table=table([6, 8], lambda i: [rb[i]])),
        shadow=dict(axes=['shape', 'band'], shape=[6, 8], table=table([6, 8], lambda i: [rsh[i]]))))

    # --- mover/locomotive: [orientation 64], shadows alike
    lc = colour_of('locomotive')
    lo = [A.add('colour', block(8, 8, lc, tick=o / 64, shade=(o % 8) / 8), 4, 5) for o in range(64)]
    los = [A.add('shadow', mask_block(4, 4), 2, 2) for _ in range(64)]
    sets['mover/locomotive'] = dict(kind='mover', group='core', parts=dict(
        base=dict(axes=['orientation'], shape=[64], table=[[i] for i in lo]),
        shadow=dict(axes=['orientation'], shape=[64], table=[[i] for i in los])))

    # --- entity/radar: F0 cut around the dish's R, a 64-frame dish layer, and the animated shadow (animShadow)
    rc = colour_of('radar')
    rpieces, dish = layered(A, [radar_frame(rc, k) for k in range(64)], (12, 20), (6, 0, 18, 12))
    rsh2 = [A.add('shadow', mask_block(8, 6, 0.3 + 0.004 * k), 3, 3) for k in range(64)]
    sets['entity/radar'] = dict(kind='entity', group='core', size=[3, 3], animShadow=True, parts=dict(
        base=dict(axes=['dir'], shape=[1], map=dict(dir=one), table=[rpieces]),
        layers=[dict(axes=['dir', 'frame'], shape=[1, 64], map=dict(dir=one), table=[[i] for i in dish])],
        shadow=dict(axes=['dir', 'frame'], shape=[1, 64], map=dict(dir=one), table=[[i] for i in rsh2])))

    # --- M0's own: the iron chest and its greybox
    for name, shade in (('entity/iron-chest', 0.0), ('greybox/iron-chest', 0.5)):
        cid = A.add('colour', block(8, 12, colour_of('iron-chest'), shade=shade), 4, 8)
        csh = A.add('shadow', mask_block(4, 3), 1, 2)
        sets[name] = dict(kind='entity', group='core', size=[1, 1], parts=dict(
            base=dict(axes=['dir'], shape=[1], map=dict(dir=one), table=[[cid]]),
            shadow=dict(axes=['dir'], shape=[1], map=dict(dir=one), table=[[csh]])))

    # --- icons
    for name in ('item/iron-plate', 'item/iron-ore', 'item/iron-chest', 'fx/missing'):
        iid = A.add('icon', block(16, 16, colour_of(name), tick=0.125 if name == 'fx/missing' else None), 8, 8)
        sets[name] = dict(kind='icon', group='core', parts=dict(icon=dict(axes=[], shape=[], table=[[iid]])))
    return sets


# ---------------------------------------------------------------------------------------------------------------
# Packing (a shelf packer: cells of the frame plus its gutter, on 2 px)
# ---------------------------------------------------------------------------------------------------------------

def cell_image(fr, g, C):
    """The frame and its gutter of `g` px: the source's real pixels around the frame, transparent beyond it."""
    _, img, _, _, src, at = fr
    h, w = img.shape[:2]
    out = np.zeros((h + 2 * g, w + 2 * g, C), np.float32)
    if src is None:
        out[g:g + h, g:g + w] = img[..., :C]
        return out
    sh, sw = src.shape[:2]
    x0, y0 = at[0] - g, at[1] - g
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(sw, x0 + w + 2 * g), min(sh, y0 + h + 2 * g)
    out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = src[sy0:sy1, sx0:sx1, :C]
    if np.abs(out[g:g + h, g:g + w] - img[..., :C]).max() > 0:
        raise ValueError('fixture: a frame is not its source at its position')
    return out


def pack(A):
    placed = {}
    pages = {k: [] for k in ARRAY_ORDER}
    for array in ARRAY_ORDER:
        S = PAGE[array]
        g = GUTTER[array]
        ids = [i for i, f in enumerate(A.frames) if f[0] == array]
        ids.sort(key=lambda i: (-A.frames[i][1].shape[0], i))
        page_i, x, y, row = 0, 0, 0, 0
        C = 1 if array == 'shadow' else 4
        pages[array].append(np.zeros((S, S, C), np.float32))
        for i in ids:
            img = A.frames[i][1]
            h, w = img.shape[:2]
            cw = -(-(w + 2 * g) // ALIGN) * ALIGN
            ch = -(-(h + 2 * g) // ALIGN) * ALIGN
            if x + cw > S:
                x, y, row = 0, y + row, 0
            if y + ch > S:
                pages[array].append(np.zeros((S, S, C), np.float32))
                page_i, x, y, row = page_i + 1, 0, 0, 0
            cell = cell_image(A.frames[i], g, C)
            pages[array][page_i][y:y + h + 2 * g, x:x + w + 2 * g] = cell
            placed[i] = (ARRAY_ORDER.index(array), page_i, x + g, y + g, w, h)
            x += cw
            row = max(row, ch)
    return placed, pages


def write_pages(pages):
    out = []
    for array in ARRAY_ORDER:
        lst = []
        for i, pg in enumerate(pages[array]):
            lv = [K.to8(pg)]
            for _ in range(LEVELS[array] - 1):
                lv.append(K.to8(K.box_down(lv[-1].astype(np.float32) / 255.0, 2)))
            if array == 'shadow':
                lv = [x[..., 0] if x.ndim == 3 else x for x in lv]
            files, nbytes = [], []
            if array == 'colour' and LEVELS[array] > 1:
                for suffix, levels in (('h', lv[:1]), ('n', lv[1:])):
                    fn = f'{array}-core-{i}.{suffix}.ktx2'
                    nbytes.append(ktx2.write(os.path.join(OUT, fn), levels, array))
                    files.append(fn)
            else:
                fn = f'{array}-core-{i}.ktx2'
                nbytes.append(ktx2.write(os.path.join(OUT, fn), lv, array))
                files.append(fn)
            lst.append(dict(group='core', files=files, bytes=nbytes))
        out.append(lst)
    return out


def manifest(prototypes_hash):
    A = Atlas()
    sets = build_sets(A)
    placed, pages = pack(A)
    frames = []
    ids = {}

    def fid(ref):
        if isinstance(ref, tuple) and ref[0] == 'piece':
            _, parent, (sx0, sy0, sx1, sy1) = ref
            a, layer, x, y, w, h = placed[parent]
            ax, ay = A.frames[parent][2], A.frames[parent][3]
            key = ('piece', parent, sx0, sy0)
            if key not in ids:
                ids[key] = len(frames)
                frames.append([a, layer, x + sx0, y + sy0, sx1 - sx0, sy1 - sy0, ax - sx0, ay - sy0])
            return ids[key]
        if ref not in ids:
            a, layer, x, y, w, h = placed[ref]
            ids[ref] = len(frames)
            frames.append([a, layer, x, y, w, h, A.frames[ref][2], A.frames[ref][3]])
        return ids[ref]

    for name in sorted(sets):
        for pname, p in sets[name]['parts'].items():
            for q in (p if isinstance(p, list) else [p]):
                q['table'] = [[fid(r) for r in e] for e in q['table']]
    page_meta = write_pages(pages)
    return dict(version=2, axesVersion=MF.AXES_VERSION, prototypesHash=prototypes_hash, style='fixture',
                arrays=[dict(kind=k, pxPerTile=PX[k], pageSize=PAGE[k], levels=LEVELS[k], codec='rgba8')
                        for k in ARRAY_ORDER],
                pages=page_meta, frames=frames, sets=sets,
                dom=dict(note='the fixture has no DOM sheets'))


# ---------------------------------------------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------------------------------------------

def evaluate(man, case):
    cam, a = case['camera'], case['input']
    p = case['program']
    if p == 'entity':
        return MF.draw_entity(man, case['set'], a, cam, tick=a.get('tick', 0), belt_speed=a.get('beltSpeed', 0))
    if p == 'inserter':
        return MF.draw_inserter(man, case['set'], a, cam)
    if p == 'object':
        return MF.draw_object(man, case['set'], a, cam)
    if p == 'resource':
        return MF.draw_resource(man, case['set'], a, cam)
    if p == 'mover':
        if case['set'] == 'mover/character':
            return MF.draw_mover(man, case['set'], a, cam)
        s = man['sets'][case['set']]
        vals = dict(orientation=a['orientation'])
        ex, ey = a['x'] / 256, a['y'] / 256
        return [MF.draws_for(man, 'base', MF.lookup(s['parts']['base'], vals), cam, ex, ey),
                MF.draws_for(man, 'shadow', MF.lookup(s['parts']['shadow'], vals), cam, ex, ey)]
    if p == 'icon':
        return MF.draw_icon(man, case['set'], a['at'], cam, a.get('sizeTiles', MF.BELT_ITEM_SIZE))
    raise ValueError(p)


def cases(man):
    out = []
    cams = [dict(cx=0.0, cy=0.0, zoom=1.0, dpr=1.0), dict(cx=-3.25, cy=7.5, zoom=1.0, dpr=2.0),
            dict(cx=100.5, cy=-40.25, zoom=0.5, dpr=1.0), dict(cx=0.0, cy=0.0, zoom=3.0, dpr=1.0),
            dict(cx=-1000.0, cy=-1000.0, zoom=2.0, dpr=2.0)]

    def add(name, program, set_name, cam, inp):
        c = dict(name=name, program=program, set=set_name, camera=cam, input=inp)
        c['expect'] = evaluate(man, c)
        out.append(c)

    for ci, cam in enumerate(cams):
        add(f'furnace working, frame from phase, camera {ci}', 'entity', 'entity/stone-furnace', cam,
            dict(x2=2, y2=-4, dir=0, variant=0, dyn=dict(state=1, phase=20480, light=200)))
    add('furnace idle (state 0) draws idle, the light at 0', 'entity', 'entity/stone-furnace', cams[0],
        dict(x2=-6, y2=8, dir=4, variant=0, dyn=dict(state=0, phase=40000, light=0)))
    add('furnace without DYN: base and layer frame 0', 'entity', 'entity/stone-furnace', cams[1],
        dict(x2=-7, y2=-9, dir=8, variant=0, dyn=None))
    for d, mask, tick in ((0, 9, 0), (4, 1, 3), (8, 2 | 8, 5), (12, 4, 7), (2, 9, 1), (4, 0, 2), (0, 6, 9)):
        add(f'belt dir {d} mask {mask} tick {tick}', 'entity', 'entity/transport-belt', cams[0],
            dict(x2=2 * 3 + 1, y2=2 * -2 + 1, dir=d, variant=mask, dyn=None, tick=tick, beltSpeed=8))
    for th, ext, held, d in ((0.0, 1.0, 0xFFFF, 0), (0.25, 0.8, 7, 4), (0.5, 1.2, 0xFFFF, 8), (0.8125, 1.0, 3, 12)):
        for ci in (0, 1):
            add(f'inserter theta {th} ext {ext} held {held} camera {ci}', 'inserter', 'entity/inserter', cams[ci],
                dict(x2=5, y2=-3, dir=d, theta=int(th * 65536) % 65536, ext=int(ext * 4096), held=held))
    for clip, flags, vx, o, dist, sec in (('idle', 0, 0, 0, 0.0, 0.0), ('idle', 0, 0, 12000, 0.0, 1.3),
                                          ('run', 0, 5, 16384, 1.15, 0.0), ('run', 0, -3, 61440, 7.9, 0.0),
                                          ('mine', 1, 0, 32768, 0.0, 0.47), ('mine', 1, 4, 4000, 3.0, 2.06)):
        for ci in (0, 1, 3):
            add(f'character {clip} orientation {o} camera {ci}', 'mover', 'mover/character', cams[ci],
                dict(x=-1200, y=640, vx=vx, vy=0, flags=flags, orientation=o, distance=dist, seconds=sec))
    for status in (0, 1, 2, 9):
        add(f'rail signal status {status}', 'entity', 'entity/rail-signal', cams[0],
            dict(x2=11, y2=-5, dir=6, variant=0, dyn=dict(state=1, phase=0, light=255), status=status))
    for x, y, stage in ((256, 512, 4), (-3000, 70000, 0), (1234567, -7654321, 2)):
        add(f'tree at {x},{y} stage {stage}', 'object', 'object/tree-oak', cams[2], dict(x=x, y=y, variant=stage))
    for tx, ty, band in ((0, 0, 7), (-5, 3, 0), (40, -77, 4), (-1000, 2000, 6)):
        add(f'resource tile {tx},{ty} band {band}', 'resource', 'resource/iron-ore-patch', cams[0],
            dict(tx=tx, ty=ty, band=band))
    for o in (0, 511, 512, 1024, 32767, 65000, 65535):
        add(f'locomotive orientation {o}', 'mover', 'mover/locomotive', cams[1], dict(x=2560, y=-1280, orientation=o))
    for ph in (0, 1023, 1024, 65535):
        add(f'radar phase {ph}', 'entity', 'entity/radar', cams[3], dict(x2=0, y2=0, dir=0, variant=0,
                                                                         dyn=dict(state=1, phase=ph, light=0)))
    for name in ('item/iron-plate', 'item/no-such-item'):
        add(f'icon {name}', 'icon', name, cams[1], dict(at=[3.25, -1.5], sizeTiles=0.5))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prototypes-hash', default=None)
    a = ap.parse_args()
    h = a.prototypes_hash
    if h is None:
        bm = os.path.join(K.PUBLIC, 'data', 'build-manifest.json')
        h = K.load_json(bm)['prototypesHash'] if os.path.exists(bm) else '0' * 64
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.ktx2'):
            os.remove(os.path.join(OUT, f))
    man = manifest(h)
    errs = MF.validate(man)
    if errs:
        raise SystemExit('fixture: ' + '\n'.join(errs))
    K.dump_json(os.path.join(OUT, 'manifest.json'), man, indent=None)
    cs = cases(man)
    doc = dict(version=1, manifest='manifest.json', projection=dict(PX_PER_TILE=MF.PX_PER_TILE, HEIGHT_SCALE=1),
               notes=MF.__doc__.strip().splitlines(), cases=cs)
    K.dump_json(os.path.join(OUT, 'cases.json'), doc, indent=None)
    # committed files: in the repository's JSON style (Biome), so `npm run check` passes
    subprocess.run(['npx', 'biome', 'format', '--write', os.path.join(OUT, 'manifest.json'),
                    os.path.join(OUT, 'cases.json')], cwd=K.GAME, check=True, capture_output=True)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'[fixture] {len(man["sets"])} sets, {len(man["frames"])} frames, {len(cs)} cases, {total / 1e3:.0f} kB',
          flush=True)


if __name__ == '__main__':
    main()
