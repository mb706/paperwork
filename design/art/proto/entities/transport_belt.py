"""transport-belt (1x1), yellow tier (07 §23: belts keep Factorio's tier colours).

Variants: 0 straight, 1 entering from the west (left turn), 2 entering from the east (right turn),
3 start cap, 4 end cap. Direction = output side (Factorio's belt direction). Built in a local frame
whose output is north, then rotated. The belt surface carries shallow chevron ridges pointing
downstream, so the direction reads in a still and at 0.5x, before any animation (16 frames: the
ridges advance 1/16 of their 0.25-tile pitch per frame; frame 0 here).
"""

import math

TIER_MAT = 'belt_yellow'
META = dict(size=(1, 1), height=0.26, directions=['N', 'E', 'S', 'W'], frames=16, variants=3, margin=0.25,
            rotate_footprint=False)

RAIL_IN = 0.36     # inner face of the side rails, from the belt centreline
RAIL_W = 0.08
RAIL_H = 0.22
DECK_Z = 0.15
PITCH = 0.25


def _rot_angle(direction):
    # local output is north; rotate clockwise for E etc. (Blender +angle = counter-clockwise)
    return {'N': 0.0, 'E': -math.pi / 2, 'S': math.pi, 'W': math.pi / 2}[direction]


def _straight(P, frame, mat):
    o = []
    for sx in (-1, 1):
        x = sx * (RAIL_IN + RAIL_W / 2)
        o.append(P.box(RAIL_W, 1.0, RAIL_H - 0.03, x, 0, 0.03, mat=mat, bevel=0.012, name='rail'))
        o.append(P.box(RAIL_W + 0.02, 1.0, 0.03, x, 0, 0.0, mat='steel_dark', bevel=0.0, name='foot'))
    o.append(P.box(2 * RAIL_IN, 1.0, 0.05, 0, 0, DECK_Z - 0.05, mat='rubber', bevel=0.0, name='deck'))
    off = (frame % 16) / 16 * PITCH
    n = int(1 / PITCH) + 1
    for i in range(-1, n + 1):
        y = -0.5 + i * PITCH + off
        for sx in (-1, 1):
            # chevron arm: from the edge (behind) to the centre (ahead)
            x0, y0 = sx * (RAIL_IN - 0.02), y - 0.07
            x1, y1 = 0.0, y + 0.03
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            L = math.hypot(x1 - x0, y1 - y0)
            ang = math.atan2(y1 - y0, x1 - x0)
            if cy - 0.03 < -0.5 or cy + 0.03 > 0.5:
                continue
            o.append(P.box(L, 0.045, 0.02, cx, cy, DECK_Z, mat='steel_bare', bevel=0.0, rot=(0, 0, ang),
                           name='ridge'))
    return o


def _curve(P, frame, mat, side):
    """Left turn (side=-1, enters from the west) or right turn (side=+1, enters from the east)."""
    import bmesh
    from mathutils import Vector
    o = []
    cx, cy = side * 0.5, 0.5          # centre of curvature at the north-west or north-east corner
    # angle range: from the entry edge to the exit edge, measured about the corner
    if side < 0:
        a0, a1 = -math.pi / 2, 0.0    # west corner: points go from (cx, cy-r) [south of corner] to (cx+r, cy)
    else:
        a0, a1 = 3 * math.pi / 2, math.pi   # east corner: entry (south of corner) -> exit (west of corner)
    def sector(r_in, r_out, z0, z1, matk, name, seg=16):
        bm = bmesh.new()
        rings = []
        for i in range(seg + 1):
            a = a0 + (a1 - a0) * i / seg
            ca, sa = math.cos(a), math.sin(a)
            ring = [bm.verts.new((cx + r * ca, cy + r * sa, z)) for (r, z) in
                    ((r_in, z0), (r_out, z0), (r_out, z1), (r_in, z1))]
            rings.append(ring)
        for i in range(seg):
            for k in range(4):
                bm.faces.new((rings[i][k], rings[i][(k + 1) % 4], rings[i + 1][(k + 1) % 4], rings[i + 1][k]))
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return P._finish(name, bm, matk, 0.0, sharp_deg=50)
    r_c = 0.5
    o.append(sector(r_c - RAIL_IN - RAIL_W, r_c - RAIL_IN, 0.03, RAIL_H, mat, 'rail_in'))
    o.append(sector(r_c + RAIL_IN, r_c + RAIL_IN + RAIL_W, 0.03, RAIL_H, mat, 'rail_out', seg=24))
    o.append(sector(max(0.005, r_c - RAIL_IN - RAIL_W - 0.01), r_c - RAIL_IN + 0.01, 0.0, 0.03, 'steel_dark', 'foot_in'))
    o.append(sector(r_c + RAIL_IN - 0.01, r_c + RAIL_IN + RAIL_W + 0.01, 0.0, 0.03, 'steel_dark', 'foot_out', seg=24))
    o.append(sector(r_c - RAIL_IN, r_c + RAIL_IN, DECK_Z - 0.05, DECK_Z, 'rubber', 'deck', seg=24))
    # chevrons along the arc (tangent direction = travel)
    arc = r_c * (math.pi / 2)
    off = (frame % 16) / 16 * PITCH
    n = int(arc / PITCH) + 2
    for i in range(-1, n):
        s_mid = i * PITCH + off + PITCH / 2
        if s_mid < 0.10 or s_mid > arc - 0.10:
            continue
        t = s_mid / arc
        a = a0 + (a1 - a0) * t
        # travel direction: from entry to exit
        tdir = (a1 - a0) / abs(a1 - a0)
        tx, ty = -math.sin(a) * tdir, math.cos(a) * tdir
        rx, ry = math.cos(a), math.sin(a)     # radial (outward)
        px, py = cx + r_c * rx, cy + r_c * ry
        for sgn in (-1, 1):
            reach = (RAIL_IN - 0.05) if sgn > 0 else (RAIL_IN - 0.14)
            x0, y0 = px + sgn * rx * reach - tx * 0.07, py + sgn * ry * reach - ty * 0.07
            x1, y1 = px + tx * 0.03, py + ty * 0.03
            L = math.hypot(x1 - x0, y1 - y0)
            ang = math.atan2(y1 - y0, x1 - x0)
            o.append(P.box(L, 0.045, 0.02, (x0 + x1) / 2, (y0 + y1) / 2, DECK_Z, mat='steel_bare', bevel=0.0,
                           rot=(0, 0, ang), name='ridge'))
    return o


def build(P, direction='N', frame=0, variant=0, state='working', mat=None):
    mat = mat or TIER_MAT
    if variant == 0:
        o = _straight(P, frame, mat)
    elif variant == 1:
        o = _curve(P, frame, mat, -1)
    else:
        o = _curve(P, frame, mat, +1)
    P.rotate_all(o, _rot_angle(direction))
    return o
