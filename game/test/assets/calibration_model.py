"""The projection calibration model (10 §9.1; test/assets/projection.py renders and measures it).

A unit cube on the tile at the origin, its top face, south face and side faces in flat calibration colours
(unbanded, so their edges are exact), and, one empty tile east of it, a 3 x 2 ground plate (2 mm thick) chequered
tile by tile on the tile grid (the model stands on its footprint centre, so tile lines are at half-integers), with
a 1 m post on each of its outer corners. Rendered in the sprite camera, the cube's top face must be 64 x 64 px and
its south face 64 px tall; placed by the renderer's formula (10 §15.7) at a tile, the chequer must land on the
tiles."""

META = dict(kind='entity', size=(1, 1), height=1.0, dirs=[8], states=['working'], margin=0.5, ink='machine',
            extra=(0.0, 4.5, 1.5, 1.0))
PLATE = (1.5, 4.5, -1.5, 0.5)          # x0, x1, y0, y1 of the chequered plate (tiles, y north)
POSTS = ((4.5, 0.5), (4.5, -1.5))


def build(P, dir=8, variant=0, state='working'):
    import bmesh
    from lib import materials as M
    o = {}
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.translate(bm, vec=(0.0, 0.0, 0.5), verts=bm.verts)
    for f in bm.faces:
        n = f.normal
        f.material_index = 0 if n.z > 0.5 else (1 if n.y < -0.5 else 2)
    me = __import__('bpy').data.meshes.new('cube')
    bm.to_mesh(me)
    bm.free()
    cube = __import__('bpy').data.objects.new('cube', me)
    P._link(cube)
    for k in ('calib_top', 'calib_south', 'calib_side'):
        me.materials.append(M.get(k))
    o['cube'] = cube
    x0, x1, y0, y1 = PLATE
    i = 0
    for tx in range(round(x1 - x0)):
        for ty in range(round(y1 - y0)):
            mat = 'paper' if (tx + ty) % 2 == 0 else 'steel_dark'
            o[f'plate{i:02d}'] = P.box(1.0, 1.0, 0.002, x0 + tx + 0.5, y0 + ty + 0.5, 0.0, mat=mat, bevel=0.0,
                                       name=f'plate{i}')
            i += 1
    for k, (x, y) in enumerate(POSTS):
        o[f'post{k}'] = P.box(0.06, 0.06, 1.0, x - 0.03, y - 0.03 if y > 0 else y + 0.03, 0.0, mat='calib_side',
                              bevel=0.0, name=f'post{k}')
    return o
