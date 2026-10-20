"""Item models for icons (and for the items drawn on belts), authored from items.yaml `sprite` lines.

Each function builds the item around the origin and returns its objects. The icon rig frames them
automatically. Families follow 07 §23: papers share one sheet silhouette (type = colour, tier = one
detail); information items are paper, card and manila; matter items are metal, ore and board.
"""

import math


def iron_ore(P):   # 'ISO: blue-grey rock chunks'
    r = P.rng(1)
    return [P.rock(s, x, y, 0, mat='ore_iron', seed=r.randint(0, 99), squash=0.75, rough=0.45, subdiv=1)
            for (s, x, y) in [(0.16, -0.10, 0.05), (0.13, 0.12, 0.09), (0.12, 0.02, -0.12), (0.09, 0.17, -0.08)]]


def copper_ore(P):  # 'ISO: orange rocks with green flecks'
    r = P.rng(2)
    o = [P.rock(s, x, y, 0, mat='ore_copper', seed=r.randint(0, 99), squash=0.75, rough=0.45, subdiv=1)
         for (s, x, y) in [(0.16, -0.10, 0.05), (0.13, 0.12, 0.09), (0.12, 0.02, -0.12), (0.09, 0.17, -0.08)]]
    o += [P.sphere(0.025, x, y, 0.12, mat='board_green', seg=6) for (x, y) in [(-0.08, 0.0), (0.12, 0.12), (0.02, -0.1)]]
    return o


def coal(P):        # 'ISO: heap of black lumps with a dull sheen'
    r = P.rng(3)
    return [P.rock(s, x, y, z, mat='coal', seed=r.randint(0, 99), squash=0.8, rough=0.4, subdiv=1)
            for (s, x, y, z) in [(0.15, -0.09, 0.04, 0), (0.14, 0.11, 0.08, 0), (0.13, 0.0, -0.11, 0), (0.11, 0.02, 0.0, 0.12)]]


def quartz(P):      # 'heap of milky-white faceted crystals, faint pink cast; the brightest raw item'
    r = P.rng(4)
    o = [P.rock(0.17, 0, 0, 0, mat='rock_quartz', seed=3, squash=0.55, rough=0.3, subdiv=1)]
    for k in range(9):
        a = k * 2.4
        x, y = 0.13 * math.cos(a) * (0.4 + 0.6 * r.random()), 0.11 * math.sin(a) * (0.4 + 0.6 * r.random())
        h = 0.14 + 0.16 * r.random()
        c = P.cyl(0.045 + 0.02 * r.random(), h, x, y, 0.02, mat='quartz_item', seg=6, r_top=0.008, bevel=0.0)
        c.rotation_euler = (r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), r.uniform(0, 3))
        o.append(c)
    return o


def iron_plate(P):  # 'ISO: two stacked blue-grey plates, bevelled'
    return [P.box(0.42, 0.30, 0.05, 0.02, -0.02, 0.0, mat='iron_plate', bevel=0.012),
            P.box(0.42, 0.30, 0.05, -0.02, 0.03, 0.05, mat='iron_plate', bevel=0.012, rot=(0, 0, 0.08))]


def copper_plate(P):
    return [P.box(0.42, 0.30, 0.05, 0.02, -0.02, 0.0, mat='copper_plate', bevel=0.012),
            P.box(0.42, 0.30, 0.05, -0.02, 0.03, 0.05, mat='copper_plate', bevel=0.012, rot=(0, 0, 0.08))]


def iron_gear_wheel(P):  # 'ISO: grey gear, eight teeth'
    g = P.gear(0.22, 0.07, 8, 0, 0, 0, mat='steel_bare', axis='Y', hole=0, tooth_depth=0.25)
    hole = P.cyl(0.06, 0.08, 0, 0.0, 0.0, mat='cast_iron', axis='Y', seg=16, bevel=0.0)
    return [g, hole]


def records(P):     # 'bundle of yellowed papers tied with a string cross; manila, soft edges'
    o = []
    for k in range(4):
        o.append(P.box(0.40, 0.30, 0.045, 0.01 * (k % 2), -0.008 * k, k * 0.045, mat='paper_manila', bevel=0.02,
                       rot=(0, 0, 0.03 * (k - 1.5))))
    o.append(P.box(0.41, 0.02, 0.19, 0, 0, 0.0, mat='string', bevel=0.0))
    o.append(P.box(0.02, 0.31, 0.19, 0.04, 0, 0.0, mat='string', bevel=0.0))
    o.append(P.box(0.06, 0.06, 0.02, 0.04, 0.0, 0.185, mat='string', bevel=0.0))
    return o


def token(P):       # 'short stack of cream punched cards, top-left corner cut, two rows of holes'
    import bmesh
    from mathutils import Vector
    o = []
    for k in range(5):
        bm = bmesh.new()
        w, h, t = 0.40, 0.19, 0.012
        pts = [(-w / 2 + 0.035, h / 2), (w / 2, h / 2), (w / 2, -h / 2), (-w / 2, -h / 2), (-w / 2, h / 2 - 0.035)]
        vb = [bm.verts.new((x, y, 0)) for x, y in pts]
        f = bm.faces.new(vb)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        vt = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=Vector((0, 0, t)), verts=vt)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.translate(bm, vec=Vector((0.006 * k, -0.004 * k, k * t)), verts=bm.verts)
        o.append(P._finish('card', bm, 'paper_cream', 0.0, smooth=False))
    z = 5 * 0.012 + 0.001
    for row, y in enumerate((0.03, -0.035)):
        for c in range(9):
            if (c * 3 + row * 5) % 4 == 0:
                continue
            o.append(P.box(0.016, 0.034, 0.002, -0.15 + c * 0.036 + 0.024, y - 0.02, z, mat='ink', bevel=0.0))
    return o


def _sheet(P, band_mat, carbon=True, lines=5):
    o = []
    if carbon:
        o.append(P.box(0.30, 0.40, 0.006, 0.025, -0.02, 0.0, mat='slate', bevel=0.0, rot=(0, 0, -0.06)))
    o.append(P.box(0.30, 0.40, 0.008, 0, 0, 0.006, mat='paper', bevel=0.0))
    o.append(P.box(0.30, 0.07, 0.009, 0, 0.165, 0.008, mat=band_mat, bevel=0.0))
    for k in range(lines):
        w = 0.22 if k % 3 != 2 else 0.14
        o.append(P.box(w, 0.012, 0.009, -0.03 + (0.22 - w) / -2 + 0.03, 0.08 - k * 0.045, 0.009, mat='ink', bevel=0.0))
    return o


def memo(P):        # 'typed sheet with a red header band and a carbon-copy edge'
    return _sheet(P, 'red_band')


def report(P):      # 'stapled report, green cover, number in the corner'
    o = []
    o.append(P.box(0.30, 0.40, 0.04, 0.012, -0.012, 0.0, mat='paper', bevel=0.004))
    o.append(P.box(0.30, 0.40, 0.012, 0, 0, 0.04, mat='green_cover', bevel=0.004))
    o.append(P.box(0.20, 0.06, 0.004, -0.02, 0.06, 0.052, mat='paper', bevel=0.0))
    o.append(P.box(0.05, 0.03, 0.004, 0.10, -0.165, 0.052, mat='paper', bevel=0.0))
    o.append(P.box(0.05, 0.008, 0.008, -0.11, 0.17, 0.052, mat='steel_bare', bevel=0.0))
    return o


def logic_board(P):  # 'small olive-green board carrying one glass vacuum tube (orange filament glow) and three copper traces'
    o = [P.box(0.40, 0.28, 0.03, 0, 0, 0.0, mat='board_green', bevel=0.006)]
    for k in range(3):
        o.append(P.box(0.30, 0.016, 0.006, 0.0, -0.09 + k * 0.05, 0.03, mat='copper', bevel=0.0))
    o.append(P.cyl(0.055, 0.03, -0.06, 0.06, 0.03, mat='bakelite', seg=12))
    o.append(P.cyl(0.048, 0.18, -0.06, 0.06, 0.06, mat='glass', seg=16))
    o.append(P.sphere(0.048, -0.06, 0.06, 0.24, mat='glass', seg=16))
    o.append(P.cyl(0.012, 0.10, -0.06, 0.06, 0.09, mat='filament', seg=6))
    return o


def copper_cable(P):  # 'ISO: loose coil of copper wire'
    o = []
    for k in range(3):
        o.append(P.torus(0.15 - 0.012 * k, 0.018, 0.012 * k, 0, 0.03 + 0.03 * k, mat='copper', seg=32, seg_minor=8))
    return o


def wood(P):        # 'ISO (Factorio icon): two crossed brown logs'
    a = P.cyl(0.07, 0.42, 0, 0, 0.07, mat='bark', axis='X', seg=12)
    a.rotation_euler = (0, 0, 0.5)
    b = P.cyl(0.07, 0.42, 0, 0, 0.16, mat='bark', axis='X', seg=12)
    b.rotation_euler = (0, 0, -0.5)
    return [a, b]


ITEMS = {
    'iron-ore': iron_ore, 'copper-ore': copper_ore, 'coal': coal, 'quartz': quartz, 'iron-plate': iron_plate,
    'copper-plate': copper_plate, 'iron-gear-wheel': iron_gear_wheel, 'records': records, 'token': token,
    'memo': memo, 'report': report, 'logic-board': logic_board, 'copper-cable': copper_cable, 'wood': wood,
}
