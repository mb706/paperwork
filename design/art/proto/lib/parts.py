"""Parametric geometry for entity scripts (Blender, bmesh-based, no operator context needed).

Conventions: metres = tiles; x east, y north, z up; an entity is modelled around its footprint
centre at the origin with the ground at z = 0. Every helper takes a semantic material key (see
style.py) and returns the new object. Bevels come from a Bevel modifier whose width is the style's
`bevel` unless overridden, because a lit bevel is what makes a 32 px edge read.

Helpers: box, cyl, cone, sphere, torus, tube (polyline pipe), gear, prism (gable roof), wedge,
plate_holes (card with punched holes as dark insets), lattice (pole/tower trusses), rock (noisy
lump), blob_tree (canopy of noisy spheres), join, dup, rotate_all, group_move.
"""

import math
import random
import bmesh
import bpy
from mathutils import Vector, Matrix, Euler, noise

from . import materials as M
from . import style as S

_COLL = None


def set_collection(coll):
    global _COLL
    _COLL = coll


def _link(obj):
    (_COLL or bpy.context.scene.collection).objects.link(obj)


def _finish(name, bm, mat, bevel=None, smooth=True, sharp_deg=35.0, segments=2):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    _link(obj)
    if mat:
        obj.data.materials.append(M.get(mat))
    st = S.STYLES[M.style_name()]
    w = (st['bevel'] if bevel is None else bevel) * st.get('bevel_scale', 1.0)
    if w and w > 0:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = w
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(40)
        mod.harden_normals = False
        mod.use_clamp_overlap = True
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
        try:
            me.set_sharp_from_angle(angle=math.radians(sharp_deg))
        except Exception:
            pass
    return obj


def _xform(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    if scale is not None:
        bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    if any(rot):
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Euler(rot, 'XYZ').to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)


def box(sx, sy, sz, x=0.0, y=0.0, z0=0.0, mat='steel_paint', bevel=None, rot=(0, 0, 0), name='box'):
    """Axis box sx*sy*sz whose bottom face sits at z0, centred on (x, y). rot about its centre."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((sx, sy, sz)), verts=bm.verts)
    if any(rot):
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Euler(rot, 'XYZ').to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, y, z0 + sz / 2)), verts=bm.verts)
    return _finish(name, bm, mat, bevel)


def taper_box(sx, sy, sz, top_sx, top_sy, x=0.0, y=0.0, z0=0.0, mat='steel_paint', bevel=None, name='taper',
              top_dy=0.0):
    """Box whose top face is (sx*top_sx) x (sy*top_sy), shifted north by top_dy: plinths, hoppers, crowns."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        if v.co.z > 0:
            v.co.x *= sx * top_sx
            v.co.y = v.co.y * sy * top_sy + top_dy
        else:
            v.co.x *= sx
            v.co.y *= sy
        v.co.z = (v.co.z + 0.5) * sz
    bmesh.ops.translate(bm, vec=Vector((x, y, z0)), verts=bm.verts)
    return _finish(name, bm, mat, bevel)


def cyl(r, h, x=0.0, y=0.0, z0=0.0, mat='steel_paint', seg=24, r_top=None, axis='Z', bevel=None,
        name='cyl', cap=True):
    """Cylinder (or frustum with r_top). axis Z: bottom at z0. axis X/Y: centred at (x, y, z0)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg,
                          radius1=r, radius2=(r if r_top is None else r_top), depth=h)
    if axis == 'Z':
        bmesh.ops.translate(bm, vec=Vector((x, y, z0 + h / 2)), verts=bm.verts)
    else:
        rot = (0, math.pi / 2, 0) if axis == 'X' else (math.pi / 2, 0, 0)
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Euler(rot, 'XYZ').to_matrix(), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector((x, y, z0)), verts=bm.verts)
    return _finish(name, bm, mat, bevel)


def cone(r, h, x=0.0, y=0.0, z0=0.0, mat='steel_paint', seg=24, name='cone', bevel=0.0):
    return cyl(r, h, x, y, z0, mat, seg, r_top=0.0005, name=name, bevel=bevel)


def sphere(r, x=0.0, y=0.0, z=0.0, mat='steel_paint', seg=24, scale=(1, 1, 1), name='sphere', bevel=0.0,
           ico=False, subdiv=2):
    bm = bmesh.new()
    if ico:
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    else:
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, y, z)), verts=bm.verts)
    return _finish(name, bm, mat, bevel, sharp_deg=80)


def hemisphere(r, x=0.0, y=0.0, z0=0.0, mat='glass', seg=32, name='dome', scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    kill = [v for v in bm.verts if v.co.z < -1e-4]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, y, z0)), verts=bm.verts)
    return _finish(name, bm, mat, 0.0, sharp_deg=80)


def torus(R, r, x=0.0, y=0.0, z=0.0, mat='steel_dark', seg=32, seg_minor=10, axis='Z', name='torus'):
    bm = bmesh.new()
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for j in range(seg_minor):
            b = 2 * math.pi * j / seg_minor
            px = (R + r * math.cos(b)) * math.cos(a)
            py = (R + r * math.cos(b)) * math.sin(a)
            pz = r * math.sin(b)
            ring.append(bm.verts.new((px, py, pz)))
        verts.append(ring)
    for i in range(seg):
        for j in range(seg_minor):
            a = verts[i][j]
            b = verts[(i + 1) % seg][j]
            c = verts[(i + 1) % seg][(j + 1) % seg_minor]
            d = verts[i][(j + 1) % seg_minor]
            bm.faces.new((a, b, c, d))
    if axis == 'X':
        bmesh.ops.rotate(bm, cent=Vector(), matrix=Euler((0, math.pi / 2, 0)).to_matrix(), verts=bm.verts)
    elif axis == 'Y':
        bmesh.ops.rotate(bm, cent=Vector(), matrix=Euler((math.pi / 2, 0, 0)).to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, y, z)), verts=bm.verts)
    return _finish(name, bm, mat, 0.0, sharp_deg=80)


def tube(points, r, mat='steel_dark', seg=12, name='tube', cap=True):
    """Pipe along a polyline of 3D points (sharp joints get a mitre-ish sphere filler)."""
    objs = []
    for i in range(len(points) - 1):
        a = Vector(points[i])
        b = Vector(points[i + 1])
        d = b - a
        L = d.length
        if L < 1e-6:
            continue
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=L)
        q = d.to_track_quat('Z', 'Y')
        bmesh.ops.rotate(bm, cent=Vector(), matrix=q.to_matrix(), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
        objs.append(_finish(name, bm, mat, 0.0, sharp_deg=80))
    for p in points[1:-1]:
        objs.append(sphere(r, *p, mat=mat, seg=seg, name=name + '_j'))
    return join(objs, name)


def gear(r_outer, thickness, teeth=8, x=0.0, y=0.0, z0=0.0, mat='steel_bare', axis='Z', hole=0.35,
         name='gear', tooth_depth=0.22):
    """Spur gear: polygon with alternating radii, extruded; optional centre hole as a dark disc."""
    bm = bmesh.new()
    pts = []
    n = teeth * 4
    r_in = r_outer * (1 - tooth_depth)
    for i in range(n):
        a = 2 * math.pi * i / n
        k = i % 4
        rr = r_outer if k in (1, 2) else r_in
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    vb = [bm.verts.new((px, py, 0)) for px, py in pts]
    f = bm.faces.new(vb)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    vt = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, 0, thickness)), verts=vt)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if axis == 'X':
        bmesh.ops.rotate(bm, cent=Vector(), matrix=Euler((0, math.pi / 2, 0)).to_matrix(), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector((-thickness / 2, 0, 0)), verts=bm.verts)
    elif axis == 'Y':
        bmesh.ops.rotate(bm, cent=Vector(), matrix=Euler((math.pi / 2, 0, 0)).to_matrix(), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector((0, thickness / 2, 0)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, y, z0)), verts=bm.verts)
    g = _finish(name, bm, mat, None)
    objs = [g]
    if hole:
        if axis == 'Z':
            objs.append(cyl(r_outer * hole, thickness * 1.02, x, y, z0 - 0.001, mat='cast_iron', seg=16, bevel=0))
    return join(objs, name)


def prism(sx, sy, h, x=0.0, y=0.0, z0=0.0, mat='slate', ridge='X', name='roof', overhang=0.0):
    """Gable roof: base sx*sy at z0, ridge line along X or Y at height h."""
    bm = bmesh.new()
    hx, hy = sx / 2 + overhang, sy / 2 + overhang
    if ridge == 'X':
        v = [bm.verts.new(p) for p in [(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0),
                                       (-hx, 0, h), (hx, 0, h)]]
        faces = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]
    else:
        v = [bm.verts.new(p) for p in [(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0),
                                       (0, -hy, h), (0, hy, h)]]
        faces = [(0, 4, 5, 3), (1, 2, 5, 4), (0, 1, 4), (2, 3, 5), (0, 3, 2, 1)]
    for f in faces:
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=Vector((x, y, z0)), verts=bm.verts)
    return _finish(name, bm, mat, 0.0, smooth=False)


def hip_roof(sx, sy, h, x=0.0, y=0.0, z0=0.0, mat='slate', name='hip', overhang=0.0):
    bm = bmesh.new()
    hx, hy = sx / 2 + overhang, sy / 2 + overhang
    inset = min(hx, hy)
    if hx >= hy:
        top = [(-hx + inset, 0, h), (hx - inset, 0, h)]
    else:
        top = [(0, -hy + inset, h), (0, hy - inset, h)]
    v = [bm.verts.new(p) for p in [(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0)] + top]
    if hx >= hy:
        faces = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]
    else:
        faces = [(0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5), (0, 3, 2, 1)]
    for f in faces:
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=Vector((x, y, z0)), verts=bm.verts)
    return _finish(name, bm, mat, 0.0, smooth=False)


def wedge(sx, sy, h_front, h_back, x=0.0, y=0.0, z0=0.0, mat='steel_paint', name='wedge', bevel=None):
    """Box whose top slopes from h_front (south, -y) to h_back (north, +y)."""
    bm = bmesh.new()
    hx, hy = sx / 2, sy / 2
    v = [bm.verts.new(p) for p in [(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0),
                                   (-hx, -hy, h_front), (hx, -hy, h_front), (hx, hy, h_back), (-hx, hy, h_back)]]
    for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=Vector((x, y, z0)), verts=bm.verts)
    return _finish(name, bm, mat, bevel)


def rock(r, x=0.0, y=0.0, z=0.0, mat='rock', seed=0, squash=0.6, rough=0.35, subdiv=3, name='rock',
         scale=(1, 1, 1)):
    """Noisy icosphere lump, flattened, sitting on the ground."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    off = Vector((seed * 13.7, seed * 7.3, seed * 3.1))
    for v in bm.verts:
        n = noise.noise(v.co * (2.2 / max(r, 0.05)) + off)
        n2 = noise.noise(v.co * (5.0 / max(r, 0.05)) + off * 1.7)
        v.co *= 1.0 + rough * n + rough * 0.4 * n2
        v.co.z *= squash
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    zmin = min(v.co.z for v in bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, y, z - zmin * 0.75)), verts=bm.verts)
    return _finish(name, bm, mat, 0.0, sharp_deg=50)


def blob(r, x=0.0, y=0.0, z=0.0, mat='leaf', seed=0, rough=0.25, subdiv=2, scale=(1, 1, 1), name='blob',
         freq=2.5):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    off = Vector((seed * 5.1, seed * 9.7, seed * 2.3))
    for v in bm.verts:
        n = noise.noise(v.co * (freq / max(r, 0.05)) + off)
        v.co *= 1.0 + rough * n
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, y, z)), verts=bm.verts)
    return _finish(name, bm, mat, 0.0, sharp_deg=70)


def lattice(x0, y0, z0, x1, y1, z1, w, mat='steel_dark', r=0.02, name='lattice'):
    """Square-section truss from (x0,y0,z0) to (x1,y1,z1) (mostly vertical), width w at both ends."""
    objs = []
    nseg = max(2, int(abs(z1 - z0) / (w * 1.2)))
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for cx, cy in corners:
        objs.append(tube([(x0 + cx * w / 2, y0 + cy * w / 2, z0), (x1 + cx * w / 2, y1 + cy * w / 2, z1)], r,
                         mat, seg=6))
    for i in range(nseg):
        t0 = i / nseg
        t1 = (i + 1) / nseg
        for k in range(4):
            ax, ay = corners[k]
            bx, by = corners[(k + 1) % 4]
            p0 = (x0 + (x1 - x0) * t0 + ax * w / 2, y0 + (y1 - y0) * t0 + ay * w / 2, z0 + (z1 - z0) * t0)
            p1 = (x0 + (x1 - x0) * t1 + bx * w / 2, y0 + (y1 - y0) * t1 + by * w / 2, z0 + (z1 - z0) * t1)
            objs.append(tube([p0, p1], r * 0.7, mat, seg=5, cap=False))
    return join(objs, name)


def join(objs, name='joined'):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    # apply modifiers so bevels survive the join
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    mats = []
    for o in objs:
        oe = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(oe)
        me.transform(o.matrix_world)
        # remap material indices
        local = [m for m in me.materials]
        idx_map = []
        for m in local:
            if m not in mats:
                mats.append(m)
            idx_map.append(mats.index(m))
        tmp = bmesh.new()
        tmp.from_mesh(me)
        for f in tmp.faces:
            if idx_map:
                f.material_index = idx_map[f.material_index] if f.material_index < len(idx_map) else 0
        me2 = bpy.data.meshes.new('tmp')
        tmp.to_mesh(me2)
        tmp.free()
        bm.from_mesh(me2)
        bpy.data.meshes.remove(me2)
        bpy.data.meshes.remove(me)
    for o in objs:
        bpy.data.objects.remove(o)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    _link(obj)
    for m in mats:
        obj.data.materials.append(m)
    return obj


def dup(obj, dx=0.0, dy=0.0, dz=0.0, rz=0.0, name=None):
    o = obj.copy()
    o.data = obj.data  # linked
    o.name = name or obj.name + '_dup'
    _link(o)
    o.location = (obj.location.x + dx, obj.location.y + dy, obj.location.z + dz)
    o.rotation_euler = (obj.rotation_euler.x, obj.rotation_euler.y, obj.rotation_euler.z + rz)
    return o


def rotate_all(objs, angle, origin=(0, 0, 0)):
    """Rotate a set of objects about the vertical axis through origin (for directions)."""
    R = Matrix.Rotation(angle, 4, 'Z')
    T = Matrix.Translation(Vector(origin))
    Ti = Matrix.Translation(-Vector(origin))
    for o in objs:
        o.matrix_world = T @ R @ Ti @ o.matrix_world


def point_light(x, y, z, power=30.0, color='#ffcf8a', radius=0.05, name='lamp'):
    """A small point lamp inside a model (working-state glow): colour and light passes only."""
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = power
    ld.color = S.hex_to_linear(color)
    ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld)
    _link(ob)
    ob.location = (x, y, z)
    return ob


def rng(seed):
    return random.Random(seed)
