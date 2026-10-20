"""Blender entrypoint: render item icons and building icons in one style, auto-framed.

    blender -b --factory-startup -noaudio --python design/art/proto/render_icons.py -- --style kodachrome \
        [--items memo,token] [--buildings stone-furnace,seminar] [--size 128]

Icons use the world's projection and the style's colour rig (no ground shadow), so an item on a
belt looks like the same object as in the world. Output: <out>/<style>/icons/<id>.png (RGBA, size
px; downscaled to 64/32/16 by the post step), plus normal/aux passes for flat styles.
"""

import argparse
import importlib
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib import style as S  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import parts as P  # noqa: E402
from lib import rig as R  # noqa: E402
from items import models as IM  # noqa: E402


def frame_objects(scene, cam, objs, size, margin=0.08):
    dg = bpy.context.evaluated_depsgraph_get()
    xs, us = [], []
    for o in objs:
        oe = o.evaluated_get(dg)
        for v in oe.bound_box:
            w = oe.matrix_world @ Vector(v)
            xs.append(w.x)
            us.append(w.y + w.z)
    x0, x1, u0, u1 = min(xs), max(xs), min(us), max(us)
    span = max(x1 - x0, u1 - u0) * (1 + 2 * margin)
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    cam.data.ortho_scale = span
    cx, cu = (x0 + x1) / 2, (u0 + u1) / 2
    view = Vector((0.0, math.cos(math.radians(S.PITCH_DEG)), -math.sin(math.radians(S.PITCH_DEG))))
    cam.location = Vector((cx, cu, 0.0)) - view * R.CAM_DIST
    return span


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--style', required=True)
    ap.add_argument('--items', default='all')
    ap.add_argument('--buildings', default='')
    ap.add_argument('--size', type=int, default=128)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'out', 'sprites'))
    ap.add_argument('--threads', type=int, default=16)
    a = ap.parse_args(argv)
    st = S.STYLES[a.style]
    flat = st['render'] == 'flat'
    outdir = os.path.join(a.out, a.style, 'icons')
    os.makedirs(outdir, exist_ok=True)
    jobs = []
    if a.items:
        ids = list(IM.ITEMS) if a.items == 'all' else a.items.split(',')
        jobs += [('item', i) for i in ids]
    if a.buildings:
        jobs += [('building', b) for b in a.buildings.split(',')]
    for kind, iid in jobs:
        scene = R.reset_scene()
        M.set_style(a.style)
        R.setup_render(scene, a.style, threads=a.threads, samples=max(32, st['samples']))
        cam = R.make_camera(scene)
        rig = R.Rig(scene, a.style)
        if kind == 'item':
            objs = IM.ITEMS[iid](P)
        else:
            mod = importlib.import_module('entities.' + iid.replace('-', '_'))
            kw = dict(direction=mod.META.get('directions', ['S'])[0], frame=0, variant=0, state='working')
            if iid == 'transport-belt':
                kw['direction'] = 'E'
            if iid in ('inserter', 'long-handed-inserter', 'burner-inserter'):
                kw['variant'] = 2
            objs = mod.build(P, **kw)
        objs = [o for o in objs if o is not None]
        frame_objects(scene, cam, objs, a.size)
        rig.mode('colour', objs)
        path = os.path.join(outdir, f'{iid}.colour.png')
        R.render_to(scene, path)
        if flat:
            for ps in ('normal', 'aux'):
                rig.mode(ps, objs)
                M.set_output(ps)
                R.render_to(scene, os.path.join(outdir, f'{iid}.{ps}.png'), samples=1, depth='8', filter_width=0.01,
                            scale=2)
                M.set_output('beauty')
        print(f'[icon] {a.style} {iid}', flush=True)


main()
