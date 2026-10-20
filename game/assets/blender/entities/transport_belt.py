"""transport-belt (1x1), the yellow tier (07 §23: belts keep Factorio's tier colours), ported from A3's prototype.

Pieces (10 §9.1: "20 pieces: 4 straight, 8 curves, 8 caps"): per direction a straight run, a curve fed from the
left, a curve fed from the right, and the start and end caps (a roller where the belt begins or ends, drawn past
the tile's edge as Factorio's belt endings are). Direction is the output side, as Factorio's. Every piece is built
facing north under a root empty that the direction turns. The deck carries chevron ridges pointing downstream, so
direction reads in a still and at 0.5x (A3 §9); the 16 frames advance them 1/16 of their 0.25-tile pitch each
(FRAMES_PER_TILE = 64, 10 §6.8's framesPerTile), and the whole deck moves, so belts are full-frame sets.

Seamless runs: each piece is modelled half a tile past its open edges (every rail, foot and deck one swept mesh),
so the ink sees a continuous belt and draws no line where tiles meet; the build then cuts the piece at its tile's
edges plus a 0.03-tile overlap (META cut, self_region(), the position pass). Chevrons sit on a lattice fixed to
the tile, so neighbours agree in the overlap. Shadows come from build_shadow(), the piece at its exact length.
pose() slides each chevron along its path (or turns it about a curve's centre) and hides it beyond the path's
span: transforms and visibility only (10 §9.1).

The connection mask (EntityView.variant; 10 §15.7's `mask` axis) is the sim's to define; this set reads it as
  bit 0  fed from behind      bit 1  fed from the left side      bit 2  fed from the right side
  bit 3  the output connects (the tile ahead takes the items)
and draws, as Factorio does: a curve when exactly one side feeds it and nothing feeds it from behind, else a
straight run; a start cap when nothing feeds it; an end cap when its output connects to nothing.
"""

import math

TIER_MAT = 'belt_yellow'
FRAMES = 16
FRAMES_PER_TILE = 64
VARIANTS = {'straight': 0, 'curve_left': 1, 'curve_right': 2, 'cap_start': 3, 'cap_end': 4}
META = dict(
    kind='entity',
    size=(1, 1),
    height=0.24,
    dirs=[0, 4, 8, 12],
    variants=VARIANTS,
    layers=[dict(parts=['*'], frames=FRAMES)],
    full_frame=True,
    cut=True,
    margin=0.25,
    extra=(0.5, 0.5, 0.5, 0.5),
    rotate_footprint=False,
    ink='machine',
)

RAIL_IN = 0.36          # the side rails' inner faces, from the centreline
RAIL_W = 0.08
RAIL_H = 0.22
DECK_Z = 0.15
PITCH = 0.25
R_C = 0.5               # a curve's centreline radius
EXT = 0.5               # how far a piece is modelled past its open edges
OVERLAP = 0.03          # the cut's overlap past the tile edge
CAP = 0.17              # the roller's distance past the tile edge


def mask_variants(mask):
    behind, left, right, out = mask & 1, (mask >> 1) & 1, (mask >> 2) & 1, (mask >> 3) & 1
    if not behind and left and not right:
        shape = VARIANTS['curve_left']
    elif not behind and right and not left:
        shape = VARIANTS['curve_right']
    else:
        shape = VARIANTS['straight']
    vl = [shape]
    if not (behind or left or right):
        vl.append(VARIANTS['cap_start'])
    if not out:
        vl.append(VARIANTS['cap_end'])
    return vl


def self_region(variant):
    """The piece's own region in its frame (output north), (x0, x1, y0, y1); None is unbounded."""
    e = 0.5 + OVERLAP
    if variant == VARIANTS['straight']:
        return (None, None, -e, e)
    if variant in (VARIANTS['curve_left'], VARIANTS['curve_right']):
        return (-e, e, -e, e)
    if variant == VARIANTS['cap_end']:
        return (None, None, 0.5 - OVERLAP, None)
    return (None, None, None, -0.5 + OVERLAP)


# ---------------------------------------------------------------------------------------------------------------
# Geometry: cross-sections swept along a path
# ---------------------------------------------------------------------------------------------------------------

def _path(variant, ext):
    """Centreline points and travel directions of a piece, in its frame (output north)."""
    if variant == VARIANTS['straight']:
        return [(0.0, -0.5 - ext), (0.0, 0.5 + ext)], [(0.0, 1.0), (0.0, 1.0)]
    side = -1 if variant == VARIANTS['curve_left'] else 1
    cx, cy = side * 0.5, 0.5
    pts, dirs = [], []
    if ext > 0:
        pts.append((side * (0.5 + ext), 0.0))
        dirs.append((-side, 0.0))
    seg = 24
    for i in range(seg + 1):
        t = i / seg
        a = -math.pi / 2 + t * (math.pi / 2) * (-side)       # left: -90 -> 0 (ccw); right: -90 -> -180 (cw)
        pts.append((cx + R_C * math.cos(a), cy + R_C * math.sin(a)))
        tx, ty = -math.sin(a) * (-side), math.cos(a) * (-side)
        dirs.append((tx, ty))
    if ext > 0:
        pts.append((0.0, 0.5 + ext))
        dirs.append((0.0, 1.0))
    return pts, dirs


def _sweep(P, pts, dirs, d0, d1, z0, z1, mat, name):
    """A rectangular cross-section [d0, d1] (offsets along the left normal of travel) x [z0, z1] swept along the
    path; one closed mesh."""
    import bmesh
    bm = bmesh.new()
    rings = []
    for (px, py), (tx, ty) in zip(pts, dirs):
        nx, ny = -ty, tx                                        # left of travel
        rings.append([bm.verts.new((px + nx * d, py + ny * d, z)) for (d, z) in ((d0, z0), (d1, z0), (d1, z1),
                                                                                  (d0, z1))])
    for i in range(len(rings) - 1):
        for k in range(4):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % 4], rings[i + 1][(k + 1) % 4], rings[i + 1][k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return P._finish(name, bm, mat, 0.0, sharp_deg=50)


def _body(P, variant, mat, ext):
    """The rails, feet and deck of a straight or curved piece, `ext` past each open edge."""
    pts, dirs = _path(variant, ext)
    o = []
    for sx in (-1, 1):
        a, b = sorted((sx * RAIL_IN, sx * (RAIL_IN + RAIL_W)))
        o.append(_sweep(P, pts, dirs, a, b, 0.03, RAIL_H, mat, 'rail'))
        fa, fb = sorted((sx * (RAIL_IN - 0.01), sx * (RAIL_IN + RAIL_W + 0.01)))
        o.append(_sweep(P, pts, dirs, fa, fb, 0.0, 0.03, 'steel_dark', 'foot'))
    o.append(_sweep(P, pts, dirs, -RAIL_IN, RAIL_IN, DECK_Z - 0.05, DECK_Z, 'rubber', 'deck'))
    return o


def _cap(P, end, mat, ext):
    """A roller past the tile's edge between rounded side plates, the deck running onto it from `ext` inside."""
    s = 1 if end else -1
    y_edge = 0.5 * s
    y_roll = y_edge + CAP * s
    y_in = y_edge - ext * s
    lo, hi = sorted((y_in, y_roll))
    o = []
    for sx in (-1, 1):
        x = sx * (RAIL_IN + RAIL_W / 2)
        o.append(P.box(RAIL_W, hi - lo, RAIL_H - 0.03, x, (lo + hi) / 2, 0.03, mat=mat, bevel=0.012, name='plate'))
        o.append(P.cyl((RAIL_H - 0.03) / 2, RAIL_W, x, y_roll, 0.03 + (RAIL_H - 0.03) / 2, mat=mat, axis='X',
                       seg=16, bevel=0.0, name='plate_end'))
        o.append(P.box(RAIL_W + 0.02, hi - lo, 0.03, x, (lo + hi) / 2, 0.0, mat='steel_dark', bevel=0.0, name='foot'))
    o.append(P.cyl(DECK_Z / 2 + 0.005, 2 * RAIL_IN, 0, y_roll, DECK_Z / 2, mat='rubber', axis='X', seg=20,
                   bevel=0.0, name='roller'))
    o.append(P.box(2 * RAIL_IN, hi - lo, 0.05, 0, (lo + hi) / 2, DECK_Z - 0.05, mat='rubber', bevel=0.0,
                   name='deck'))
    o.append(P.cyl(0.03, 2 * RAIL_IN + 2 * RAIL_W + 0.02, 0, y_roll, DECK_Z / 2, mat='steel_dark', axis='X', seg=10,
                   bevel=0.0, name='axle'))
    return o


# ---------------------------------------------------------------------------------------------------------------
# Chevrons: each carries its path in ID properties; pose() reads them
# ---------------------------------------------------------------------------------------------------------------

def _ridge(P, x0, y0, x1, y1, name='ridge'):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    L = math.hypot(x1 - x0, y1 - y0)
    ang = math.atan2(y1 - y0, x1 - x0)
    return P.box(L, 0.045, 0.02, cx, cy, DECK_Z, mat='steel_bare', bevel=0.0, rot=(0, 0, ang), name=name)


def _chevron(P, name):
    """Two ridge arms meeting ahead of the centreline, built at the origin pointing +y."""
    return P.join([_ridge(P, sx * (RAIL_IN - 0.02), -0.07, 0.0, 0.03) for sx in (-1, 1)], name)


def _line_chevrons(P, idx, origin, direction, lo, hi):
    """Chevrons on a straight path origin + s * direction, s in [lo, hi], on the tile-fixed lattice."""
    n = int((hi - lo) / PITCH) + 2
    out = []
    ang = math.atan2(direction[1], direction[0]) - math.pi / 2
    for i in range(n):
        c = _chevron(P, f'chevron{idx + i:02d}')
        c.rotation_euler = (0.0, 0.0, ang)
        c['pw_kind'] = 'line'
        c['pw_o'] = list(origin)
        c['pw_d'] = list(direction)
        c['pw_span'] = [lo, hi]
        c['pw_i'] = i
        c['pw_n'] = n
        out.append(c)
    return out


def _arc_chevrons(P, idx, side):
    import bpy
    cx, cy = side * 0.5, 0.5
    arc = R_C * math.pi / 2
    n = int(arc / PITCH) + 2
    base = -math.pi / 2 if side < 0 else math.pi / 2       # pointing along the travel at the arc's start
    out = []
    for i in range(n):
        c = _chevron(P, f'chevron{idx + i:02d}')
        c.rotation_euler = (0.0, 0.0, base)
        c.location = (cx, cy - R_C, 0.0)
        bpy.context.view_layer.update()
        P.pivot(c, (cx, cy, 0.0))
        c['pw_kind'] = 'arc'
        c['pw_base'] = base
        c['pw_sign'] = 1.0 if side < 0 else -1.0
        c['pw_span'] = [0.0, arc]
        c['pw_i'] = i
        c['pw_n'] = n
        out.append(c)
    return out


def _model(P, variant, mat, ext, chevrons=True):
    if variant in (VARIANTS['straight'], VARIANTS['curve_left'], VARIANTS['curve_right']):
        static = _body(P, variant, mat, ext)
    else:
        static = _cap(P, variant == VARIANTS['cap_end'], mat, ext)
    chev = []
    if chevrons:
        if variant == VARIANTS['straight']:
            chev = _line_chevrons(P, 0, (0.0, 0.0), (0.0, 1.0), -0.5 - ext, 0.5 + ext)
        elif variant in (VARIANTS['curve_left'], VARIANTS['curve_right']):
            side = -1 if variant == VARIANTS['curve_left'] else 1
            chev = _arc_chevrons(P, 0, side)
            # the straight runs past the entry (from the side) and the exit (north), on the neighbours' lattice
            chev += _line_chevrons(P, len(chev), (0.0, 0.0), (-side, 0.0), -0.5 - ext, -0.5)
            chev += _line_chevrons(P, len(chev), (0.0, 0.0), (0.0, 1.0), 0.5, 0.5 + ext)
        elif variant == VARIANTS['cap_end']:
            chev = _line_chevrons(P, 0, (0.0, 0.0), (0.0, 1.0), 0.5 - ext, 0.5 + 0.10)
        else:
            chev = _line_chevrons(P, 0, (0.0, 0.0), (0.0, 1.0), -0.5 - 0.10, -0.5 + ext)
    return static, chev


def _assemble(P, d, static, chev):
    root = P.group('root', static + chev)
    root.rotation_euler = (0.0, 0.0, -math.radians(d * 22.5))
    o = {'root': root}
    for i, x in enumerate(static):
        o[f's{i:03d}'] = x
    for c in chev:
        o[c.name] = c
    return o


def build(P, dir=0, variant=0, state='working', mat=None):
    static, chev = _model(P, variant, mat or TIER_MAT, EXT)
    return _assemble(P, dir, static, chev)


def build_shadow(P, dir=0, variant=0):
    static, chev = _model(P, variant, TIER_MAT, 0.0, chevrons=False)
    return _assemble(P, dir, static, chev)


def pose(parts, layer, frame):
    off = (frame % FRAMES) / FRAMES * PITCH
    for name, c in parts.items():
        if not name.startswith('chevron'):
            continue
        lo, hi = c['pw_span']
        n = c['pw_n']
        # positions on the lattice fixed to the tile, k * PITCH - PITCH / 2 + off, so neighbours agree; the pool
        # of n chevrons covers the span and wraps, which makes the 16-frame loop seamless
        s = math.floor(lo / PITCH + 1e-9) * PITCH - PITCH / 2 + ((c['pw_i'] * PITCH + off) % (n * PITCH))
        if c['pw_kind'] == 'line':
            ox, oy = c['pw_o']
            dx, dy = c['pw_d']
            c.location = (ox + dx * s, oy + dy * s, 0.0)
            visible = (s - 0.075 >= lo + 0.005) and (s + 0.04 <= hi - 0.005)
        else:
            c.rotation_euler = (0.0, 0.0, c['pw_base'] + (s / R_C) * c['pw_sign'])
            visible = (s - 0.09 >= lo) and (s + 0.09 <= hi)
        c.hide_render = not visible
