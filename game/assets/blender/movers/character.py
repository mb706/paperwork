"""character: the Site's first researcher (00 §1), 1945. A figure in a white laboratory coat over a shirt and tie,
dark trousers and shoes, with spectacles; a clipboard in the left hand. Hand mining swings a field geologist's
rock hammer (the survey's own tool), which appears only while mining, when the clipboard is set aside.
1.75 m tall (A3 §2: 56 px at 1x).

Clips (10 §15.7): idle [orientation 8, frame 4] at 2 fps (a breath and a shift of weight), run [8, 16] advanced
by distance, one cycle per CYCLE_TILES, and mine [8, 16] at 16 fps (one swing per second). Each frame has its own
shadow. The rig is a hierarchy of empties at the joints (hips, knees, ankles, waist, neck, shoulders, elbows);
pose() sets their rotations only, so no geometry is rebuilt per frame. The model faces south at rest; the
renderer rotates the root for each orientation. The lab coat's skirt is split into two halves that follow the
thighs, so a running stride opens the coat instead of passing through it.
"""

import math

CYCLE_TILES = 2.3
META = dict(
    kind='mover',
    size=(1, 1),
    height=2.05,
    margin=0.55,
    orientations=8,
    ink='machine',
    clips={
        'idle': dict(frames=4, fps=2.0),
        'run': dict(frames=16, cycle_tiles=CYCLE_TILES),
        'mine': dict(frames=16, fps=16.0),
    },
)

HIP_Z = 0.90
KNEE_Z = 0.49
ANKLE_Z = 0.075
WAIST_Z = 1.02
SHOULDER_Z = 1.43
NECK_Z = 1.52
HIP_X = 0.088
SHOULDER_X = 0.232


def _joint(P, name, point, parent=None):
    import bpy
    e = bpy.data.objects.new(name, None)
    P._link(e)
    e.location = point
    if parent is not None:
        bpy.context.view_layer.update()
        e.parent = parent
        e.matrix_parent_inverse = parent.matrix_world.inverted()
    bpy.context.view_layer.update()
    return e


def _attach(objs, joint):
    import bpy
    bpy.context.view_layer.update()
    for o in objs:
        if o is None:
            continue
        mw = o.matrix_world.copy()
        o.parent = joint
        o.matrix_parent_inverse = joint.matrix_world.inverted()
        o.matrix_world = mw
    return objs


def _half_skirt(P, side, r0, r1, z0, z1, mat, name, depth=0.78):
    """One half (side -1 left = west, +1 right = east, at rest facing south) of a flared coat skirt from z0 (hem,
    radius r0) up to z1 (waist, radius r1), open at the front between the halves."""
    import bmesh
    bm = bmesh.new()
    seg = 10
    # angles measured from +x (east) counter-clockwise; the front (south, -y) is at -90 degrees
    if side > 0:
        a0, a1 = math.radians(-80), math.radians(90)
    else:
        a0, a1 = math.radians(90), math.radians(260)
    rings = []
    for z, r in ((z0, r0), (z1, r1)):
        ring = []
        for i in range(seg + 1):
            a = a0 + (a1 - a0) * i / seg
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for i in range(seg):
        bm.faces.new((rings[0][i], rings[0][i + 1], rings[1][i + 1], rings[1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:                       # outward: away from the axis
        c = f.calc_center_median()
        if f.normal.x * c.x + f.normal.y * c.y < 0:
            f.normal_flip()
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.018)
    bmesh.ops.scale(bm, vec=(1.0, depth, 1.0), verts=bm.verts)
    return P._finish(name, bm, mat, 0.0, sharp_deg=60)


def build(P):
    o = {}
    root = _joint(P, 'root', (0, 0, 0))
    pelvis = _joint(P, 'pelvis', (0, 0, HIP_Z), root)
    spine = _joint(P, 'spine', (0, 0, WAIST_Z), pelvis)
    o['root'], o['pelvis'], o['spine'] = root, pelvis, spine
    # ---- legs: trousers, shoes ----
    for side, sx in (('L', -HIP_X), ('R', HIP_X)):
        hip = _joint(P, f'hip_{side}', (sx, 0, HIP_Z), pelvis)
        knee = _joint(P, f'knee_{side}', (sx, 0, KNEE_Z), hip)
        ankle = _joint(P, f'ankle_{side}', (sx, 0, ANKLE_Z), knee)
        _attach([P.cyl(0.068, HIP_Z - KNEE_Z + 0.02, sx, 0, KNEE_Z - 0.01, mat='cloth_dark', seg=12, r_top=0.082,
                       name=f'thigh_{side}'),
                 P.sphere(0.07, sx, 0, KNEE_Z, mat='cloth_dark', seg=10, name=f'kneecap_{side}')], hip)
        _attach([P.cyl(0.052, KNEE_Z - ANKLE_Z, sx, 0, ANKLE_Z, mat='cloth_dark', seg=12, r_top=0.066,
                       name=f'shin_{side}')], knee)
        _attach([P.box(0.095, 0.21, 0.07, sx, -0.045, 0.0, mat='leather', bevel=0.02, name=f'shoe_{side}')], ankle)
        o[f'hip_{side}'], o[f'knee_{side}'], o[f'ankle_{side}'] = hip, knee, ankle
    _attach([P.cyl(0.15, 0.14, 0, 0, HIP_Z - 0.06, mat='cloth_dark', seg=16, name='seat')], pelvis)
    # ---- the coat's skirt: two halves hinged at the hips ----
    for side, sgn in (('L', -1), ('R', 1)):
        flap = _joint(P, f'flap_{side}', (sgn * 0.06, 0, WAIST_Z), pelvis)
        _attach([_half_skirt(P, sgn, 0.235, 0.185, 0.50, WAIST_Z + 0.01, 'cloth_white', f'skirt_{side}')], flap)
        o[f'flap_{side}'] = flap
    # ---- upper body: coat (an elliptical frustum, 0.72 as deep as wide), shirt, tie, lapels, pockets ----
    coat = P.cyl(0.178, SHOULDER_Z - WAIST_Z + 0.02, 0, 0, WAIST_Z - 0.01, mat='cloth_white', seg=22, r_top=0.196,
                 name='coat_body')
    coat.scale = (1.0, 0.72, 1.0)
    body = [coat,
            P.sphere(0.205, 0, 0.0, SHOULDER_Z, mat='cloth_white', seg=20, scale=(1.30, 0.66, 0.40),
                     name='shoulders'),
            P.box(0.10, 0.02, 0.26, 0, -0.128, 1.18, mat='paper', bevel=0.004, name='shirt'),
            P.box(0.038, 0.02, 0.22, 0, -0.142, 1.19, mat='cloth_tie', bevel=0.004, name='tie'),
            P.box(0.07, 0.02, 0.05, 0.105, -0.13, 1.30, mat='paper', bevel=0.003, name='pocket_card'),
            P.box(0.012, 0.022, 0.07, 0.125, -0.128, 1.31, mat='steel_dark', bevel=0.0, name='pen')]
    for sx in (-1, 1):
        body.append(P.box(0.05, 0.022, 0.30, sx * 0.066, -0.135, 1.15, mat='cloth_white', bevel=0.004,
                          rot=(0, sx * 0.20, 0), name='lapel'))
    _attach(body, spine)
    for side, sx in (('L', -1), ('R', 1)):
        _attach([P.box(0.10, 0.02, 0.09, sx * 0.12, -0.165, 0.70, mat='cloth_white', bevel=0.006,
                       name=f'pocket_{side}')], o[f'flap_{side}'])
    # ---- neck and head ----
    neck = _joint(P, 'neck', (0, 0, NECK_Z), spine)
    _attach([P.cyl(0.048, 0.10, 0, 0.0, NECK_Z - 0.02, mat='skin', seg=10, name='neckskin'),
             P.sphere(0.103, 0, -0.012, 1.655, mat='skin', seg=18, scale=(0.92, 1.0, 1.12), name='head'),
             P.sphere(0.110, 0, 0.012, 1.70, mat='hair', seg=18, scale=(0.95, 1.0, 0.74), name='hair'),
             P.box(0.17, 0.02, 0.032, 0, -0.106, 1.672, mat='steel_dark', bevel=0.004, name='spectacles'),
             P.sphere(0.022, -0.098, -0.005, 1.65, mat='skin', seg=8, name='ear_L'),
             P.sphere(0.022, 0.098, -0.005, 1.65, mat='skin', seg=8, name='ear_R')], neck)
    o['neck'] = neck
    # ---- arms: coat sleeves, hands ----
    for side, sx in (('L', -SHOULDER_X), ('R', SHOULDER_X)):
        sh = _joint(P, f'shoulder_{side}', (sx, 0, SHOULDER_Z - 0.03), spine)
        el = _joint(P, f'elbow_{side}', (sx * 1.04, 0, 1.13), sh)
        wr = _joint(P, f'wrist_{side}', (sx * 1.02, 0, 0.88), el)
        _attach([P.cyl(0.058, 0.30, sx * 1.02, 0, 1.12, mat='cloth_white', seg=12, r_top=0.066, name=f'upper_{side}'),
                 P.sphere(0.06, sx * 1.04, 0, 1.13, mat='cloth_white', seg=10, name=f'elbowball_{side}')], sh)
        _attach([P.cyl(0.05, 0.25, sx * 1.03, 0, 0.88, mat='cloth_white', seg=12, r_top=0.057, name=f'fore_{side}'),
                 P.cyl(0.052, 0.035, sx * 1.02, 0, 0.885, mat='paper', seg=12, name=f'cuff_{side}')], el)
        _attach([P.sphere(0.047, sx * 1.02, -0.005, 0.85, mat='skin', seg=10, scale=(0.9, 1.0, 1.15),
                          name=f'hand_{side}')], wr)
        o[f'shoulder_{side}'], o[f'elbow_{side}'], o[f'wrist_{side}'] = sh, el, wr
    # ---- props: the clipboard in the left hand; the rock hammer in the right, its handle forward from the fist,
    #      the head upright with the hammer face up and the pick down ----
    lx = -SHOULDER_X * 1.02
    board = [P.box(0.23, 0.018, 0.31, lx + 0.02, -0.08, 0.80, mat='wood', bevel=0.004, rot=(0.25, 0, 0),
                   name='board'),
             P.box(0.19, 0.018, 0.25, lx + 0.02, -0.092, 0.80, mat='paper', bevel=0.0, rot=(0.25, 0, 0),
                   name='board_sheet'),
             P.box(0.08, 0.022, 0.03, lx + 0.02, -0.075, 0.95, mat='steel_bare', bevel=0.0, rot=(0.25, 0, 0),
                   name='board_clip')]
    _attach(board, o['wrist_L'])
    rx = SHOULDER_X * 1.02
    hz = 0.845
    hammer = [P.cyl(0.018, 0.34, rx, -0.15, hz, mat='leather', seg=8, axis='Y', name='hammer_handle'),
              P.box(0.036, 0.042, 0.11, rx, -0.33, hz - 0.01, mat='steel_bare', bevel=0.006, name='hammer_head'),
              P.cyl(0.003, 0.10, rx, -0.33, hz - 0.11, mat='steel_bare', seg=8, r_top=0.019, name='hammer_pick')]
    _attach(hammer, o['wrist_R'])
    o['board'], o['hammer'] = board, hammer
    return o


def _keys(table, q):
    """Cosine-eased interpolation of a periodic keyframe table [(phase, value), ...] at phase q in [0, 1)."""
    pts = list(table) + [(table[0][0] + 1.0, table[0][1])]
    for (q0, v0), (q1, v1) in zip(pts, pts[1:]):
        if q0 <= q < q1:
            t = (q - q0) / (q1 - q0)
            return v0 + (v1 - v0) * (0.5 - 0.5 * math.cos(math.pi * t))
    return table[0][1]


# the run's knee (degrees of flexion) over one cycle: contact at 0, toe-off at 0.4, peak tuck as the thigh passes
# vertical in the swing, reaching forward before the next contact
RUN_KNEE = ((0.0, 20), (0.2, 36), (0.4, 18), (0.55, 38), (0.72, 66), (0.88, 38))


def _rx(obj, deg):
    obj.rotation_euler.x = math.radians(deg)


def _rz(obj, deg):
    obj.rotation_euler.z = math.radians(deg)


def _ry(obj, deg):
    obj.rotation_euler.y = math.radians(deg)


def _show(objs, visible):
    for x in objs:
        x.hide_render = not visible


def _rest(parts):
    for k in ('pelvis', 'spine', 'neck', 'hip_L', 'hip_R', 'knee_L', 'knee_R', 'ankle_L', 'ankle_R', 'shoulder_L',
              'shoulder_R', 'elbow_L', 'elbow_R', 'wrist_L', 'wrist_R', 'flap_L', 'flap_R'):
        parts[k].rotation_euler = (0.0, 0.0, 0.0)
    parts['pelvis'].location.z = HIP_Z


def pose(parts, clip, frame):
    """One frame of a clip, by joint rotations (degrees below; forward swings are negative x rotations because
    the model faces -y). Every value is absolute, so poses never accumulate."""
    _rest(parts)
    P_ = parts
    tau = 2 * math.pi
    if clip == 'run':
        p = frame / 16.0
        P_['pelvis'].location.z = HIP_Z - 0.04 + 0.03 * abs(math.cos(tau * p))
        _rx(P_['spine'], 9)
        _rz(P_['spine'], 7 * math.sin(tau * p))
        _rz(P_['pelvis'], -5 * math.sin(tau * p))
        _rx(P_['neck'], -7)
        for side, ph in (('L', 0.0), ('R', 0.5)):
            q = (p + ph) % 1.0
            thigh = 29 * math.cos(tau * q)                       # + forward
            knee = _keys(RUN_KNEE, q)
            ankle = -12 * math.sin(tau * q)
            _rx(P_[f'hip_{side}'], -thigh)
            _rx(P_[f'knee_{side}'], knee)
            _rx(P_[f'ankle_{side}'], ankle - knee * 0.25 + thigh * 0.15)
            _rx(P_[f'flap_{side}'], -0.55 * max(thigh, -10) + 8)
            # arms swing against the same-side leg, elbows bent; the board arm swings less
            k = 0.45 if side == 'L' else 1.0
            _rx(P_[f'shoulder_{side}'], k * 28 * math.cos(tau * q))
            _rx(P_[f'elbow_{side}'], -(70 if side == 'R' else 80) - 12 * math.sin(tau * q))
            _ry(P_[f'shoulder_{side}'], (-1 if side == 'L' else 1) * -6)
        _rx(P_['wrist_L'], 10)
        _show(P_['board'], True)
        _show(P_['hammer'], False)
    elif clip == 'idle':
        p = frame / 4.0
        b = math.sin(tau * p)
        P_['pelvis'].location.z = HIP_Z - 0.004 * (1 - b)
        _rx(P_['spine'], 1.5 + 0.8 * b)
        _rz(P_['spine'], 1.2 * b)
        _rx(P_['neck'], -6 + 2 * math.sin(tau * p + 0.8))
        _rz(P_['neck'], 4 * math.sin(tau * p + 1.6))
        _rx(P_['hip_L'], -2)
        _rx(P_['hip_R'], 3)
        _rx(P_['knee_R'], 5)
        _rx(P_['shoulder_L'], -12 - 2 * b)
        _rx(P_['elbow_L'], -72)
        _ry(P_['shoulder_L'], 6)
        _rx(P_['wrist_L'], 18)
        _rx(P_['shoulder_R'], -4 + 1.5 * b)
        _rx(P_['elbow_R'], -18)
        _ry(P_['shoulder_R'], -4)
        _rx(P_['flap_L'], 2)
        _rx(P_['flap_R'], -1)
        _show(P_['board'], True)
        _show(P_['hammer'], False)
    elif clip == 'mine':
        p = frame / 16.0
        # raise (0 .. 0.45), strike (0.45 .. 0.6), recoil and settle (0.6 .. 1)
        if p < 0.45:
            t = p / 0.45
            lift = 0.5 - 0.5 * math.cos(math.pi * t)
        elif p < 0.6:
            t = (p - 0.45) / 0.15
            lift = 1.0 - t * t * 1.15
        else:
            t = (p - 0.6) / 0.4
            lift = -0.15 + 0.15 * (0.5 - 0.5 * math.cos(math.pi * t))
        crouch = 0.03 + 0.03 * (1 - lift)
        P_['pelvis'].location.z = HIP_Z - crouch
        _rx(P_['hip_L'], -18)
        _rx(P_['knee_L'], 26 + 10 * (1 - lift))
        _rx(P_['hip_R'], 8)
        _rx(P_['knee_R'], 18 + 8 * (1 - lift))
        _rx(P_['ankle_L'], -6)
        _rx(P_['spine'], 14 + 14 * (1 - lift) - 6 * lift)
        _rx(P_['neck'], 10 + 6 * (1 - lift))
        # the hammer arm: up and back over the shoulder, then down to the ground in front
        _rx(P_['shoulder_R'], -40 - 120 * lift)
        _rx(P_['elbow_R'], -30 - 70 * lift)
        _rx(P_['wrist_R'], -20 + 40 * lift)
        _ry(P_['shoulder_R'], -8)
        # the free arm braces forward
        _rx(P_['shoulder_L'], -30 + 6 * lift)
        _rx(P_['elbow_L'], -40)
        _ry(P_['shoulder_L'], 10)
        _rx(P_['flap_L'], 12)
        _rx(P_['flap_R'], -2)
        _show(P_['board'], False)
        _show(P_['hammer'], True)
    else:
        raise ValueError(clip)
