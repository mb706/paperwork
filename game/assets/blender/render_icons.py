"""Blender entry point: render item icons (10 §9.3; A3 §7), one set per job, in the world's camera.

    taskset -c 8-15,24-31 blender -b --factory-startup -noaudio --python-exit-code 1 \
        --python game/assets/blender/render_icons.py -- --jobs jobs.json [--threads 16]

Icons are the item's 3D model (items/<id>.py: build(P) -> objects), rendered in the world's projection with the
style's colour rig and no ground shadow, so an item on a belt is the same object as in the world. A building's
icon is its entity model in the default state. The model is auto-framed in a square with an 8 % margin and
rendered at 128 px (colour), with the normal and aux passes at 256 px for the ink; the post step inks it with
the icon line widths and sel-out outlines and derives 64 px (the GPU icon array's level 0; 32 and 16 are its
levels 1 and 2) and the DOM sheets. Jobs are atomic and their model imports checked (jobs.py).
"""

import argparse
import importlib.util
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import jobs as J  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import parts as P  # noqa: E402
from lib import rig as R  # noqa: E402
from lib import style as S  # noqa: E402

SIZE = 128
MARGIN = 0.08


def frame_objects(scene, cam, objs, size, margin=MARGIN):
    dg = bpy.context.evaluated_depsgraph_get()
    xs, us = [], []
    for o in objs:
        if o.type != 'MESH':
            continue
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
    ap.add_argument('--jobs', required=True)
    ap.add_argument('--threads', type=int, default=16)
    a = ap.parse_args(argv)
    with open(a.jobs) as f:
        jobs = json.load(f)
    for ji, job in enumerate(jobs):
        t0 = time.time()
        with J.job_dir(job) as out:
            style = job.get('style', S.PIPELINE_STYLE)
            scene = R.reset_scene()
            M.set_style(style)
            R.setup_render(scene, style, threads=a.threads, samples=max(32, S.STYLES[style]['samples']))
            cam = R.make_camera(scene)
            rig = R.Rig(scene, style)
            script = job['script'] if os.path.isabs(job['script']) else os.path.join(HERE, job['script'])
            spec = importlib.util.spec_from_file_location(f'paperwork_icon_{ji}', script)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            res = mod.build(P)
            objs = [o for o in (res.values() if isinstance(res, dict) else res) if o is not None]
            allo = []
            for o in objs:
                stack = [o]
                while stack:
                    x = stack.pop()
                    allo.append(x)
                    stack.extend(x.children)
            bpy.context.view_layer.update()
            span = frame_objects(scene, cam, allo, SIZE)
            files = {}
            for ps in ('colour', 'normal', 'aux'):
                fn = f'icon.{ps}.png'
                R.render_pass(scene, rig, ps, allo, os.path.join(out, fn))
                files[ps] = fn
            J.check_sources(job, script)
            rec = dict(set=job['set'], kind='icon', style=style, canvas=[SIZE, SIZE], span_m=round(span, 4),
                       blender=bpy.app.version_string, base=files, wall_s=round(time.time() - t0, 3))
            J.finish(job, out, rec)
        print(f'[icon] {job["set"]}: {time.time() - t0:.1f} s', flush=True)


main()
