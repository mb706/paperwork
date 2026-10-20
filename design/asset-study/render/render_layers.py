"""B2 render study (10 §9.1, "render only what moves"): time a static base plus per-frame animated layers
against A3's per-frame full rebuild, on A3's own entity scripts and rig.

    taskset -c 8-15,24-31 blender -b --factory-startup -noaudio --python design/asset-study/render/render_layers.py -- \
        --entity keypunch [--frames 16] [--threads 16]

Method (Survey style, A3's passes and sample counts):
  1. Build frame 0 and frame F/2; objects whose mesh or transform differ are the animated parts (a production
     entity script declares them and poses them by transform instead).
  2. Base: animated parts hidden; render colour, normal (2x), aux (2x) and light once. Shadow once, with the
     animated parts at their frame-0 pose.
  3. Animation rectangle R: the union over all frames of the animated parts' projected bounds, plus an 8 px
     margin at High (the ink pass's silhouette line and filter reach).
  4. Per frame: pose the animated parts (here: rebuild the frame and keep only them; timed apart), then render
     colour, normal and aux inside R only (Cycles border render, cropped).
Prints a JSON line with every timing; outputs go to design/art/out/layers/<entity>/ (gitignored).
"""

import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PROTO = os.path.join(ROOT, 'design', 'art', 'proto')
sys.path.insert(0, PROTO)

import bpy  # noqa: E402
from bpy_extras.object_utils import world_to_camera_view  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib import style as S  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import parts as P  # noqa: E402
from lib import rig as R  # noqa: E402
import importlib  # noqa: E402


def parse():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--entity', default='keypunch')
    ap.add_argument('--frames', type=int, default=16)
    ap.add_argument('--threads', type=int, default=16)
    ap.add_argument('--direction', default='S')
    ap.add_argument('--variant', type=int, default=0)
    ap.add_argument('--all', action='store_true', help='every direction and variant of META, in one process')
    ap.add_argument('--shadow-normal', action='store_true', help='render the shadow at Normal resolution (50%)')
    ap.add_argument('--full-base', action='store_true', help='v2 scheme: the base is frame 0 in full')
    return ap.parse_args(argv)


def signature(o):
    me = o.data
    vs = [o.matrix_world @ v.co for v in me.vertices] if me and hasattr(me, 'vertices') else [o.location.copy()]
    if not vs:
        return (o.name,)
    xs, ys, zs = [v.x for v in vs], [v.y for v in vs], [v.z for v in vs]
    return (len(vs), round(min(xs), 4), round(max(xs), 4), round(min(ys), 4), round(max(ys), 4),
            round(min(zs), 4), round(max(zs), 4), round(sum(xs), 3), round(sum(zs), 3))


def bounds_px(scene, cam, objs, W, H):
    x0, y0, x1, y1 = 1e9, 1e9, -1e9, -1e9
    for o in objs:
        for c in o.bound_box:
            p = world_to_camera_view(scene, cam, o.matrix_world @ Vector(c))
            x, y = p.x * W, (1 - p.y) * H
            x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
    return x0, y0, x1, y1


def main():
    a = parse()
    mod = importlib.import_module('entities.' + a.entity.replace('-', '_'))
    meta = mod.META
    combos = [(d, v) for d in meta.get('directions', ['S']) for v in range(meta.get('variants', 1))] if a.all else [(a.direction, a.variant)]
    if a.all:
        a.frames = meta.get('frames', 1)
    t0 = time.time()
    res = [one(a, mod, meta, d, v) for d, v in combos]
    tot = dict(entity=a.entity, combos=len(combos), frames=meta.get('frames', 1), total_s=round(time.time() - t0, 1),
               parts_s={k: round(sum(r[k] for r in res), 1) for k in ('base_passes_s', 'base_shadow_s', 'pose_all_frames_s', 'anim_frames_s')},
               canvas_px=sum(r['canvas'][0] * r['canvas'][1] for r in res), rect_px=sum(r['rect_px'] for r in res))
    print('[build] ' + json.dumps(tot), flush=True)


def one(a, mod, meta, direction, variant):
    a.direction, a.variant = direction, variant
    out = os.path.join(ROOT, 'design', 'art', 'out', 'layers', 'build' if a.all else '', a.entity, f'{direction}{variant}' if a.all else '')
    os.makedirs(out, exist_ok=True)
    T = {}
    t0 = time.time()
    scene = R.reset_scene()
    M.set_style('survey')
    R.setup_render(scene, 'survey', threads=a.threads)
    cam = R.make_camera(scene)
    rig = R.Rig(scene, 'survey')
    w, h = meta['size']
    canvas = R.Canvas(w, h, meta['height'], margin=meta.get('margin', 0.5), shadow=meta.get('shadow', True),
                      extra=tuple(meta.get('extra', (0, 0, 0, 0))))
    W, H = R.aim_camera(scene, cam, canvas, S.PX_HIGH)
    objs0 = [o for o in mod.build(P, direction=a.direction, frame=0, variant=a.variant, state='working') if o is not None]
    T['build_frame0_s'] = time.time() - t0
    # which objects move: compare frame 0 with frames 1, F/4 and F/2 - 1, object by object in creation order
    # (a rotation by half a turn can leave a part's bounds unchanged, so one probe frame is not enough)
    t = time.time()
    bpy.context.view_layer.update()
    sig0 = [signature(o) for o in objs0]
    moving_idx = set()
    for fk in sorted({1, max(1, a.frames // 4), max(1, a.frames // 2 - 1)}):
        if fk >= a.frames:
            continue
        coll = bpy.data.collections.new(f'probe{fk}')
        scene.collection.children.link(coll)
        P.set_collection(coll)
        objsh = [o for o in mod.build(P, direction=a.direction, frame=fk, variant=a.variant, state='working') if o is not None]
        P.set_collection(None)
        bpy.context.view_layer.update()
        moving_idx |= {i for i, q in enumerate(objsh) if i < len(sig0) and signature(q) != sig0[i]}
        if len(objsh) != len(sig0):          # a part that appears or vanishes (a belt's slats): it moves
            moving_idx |= set(range(min(len(objsh), len(sig0)), len(sig0)))
        for o in objsh:
            bpy.data.objects.remove(o, do_unlink=True)
    moving_idx = sorted(moving_idx)
    T['probe_s'] = time.time() - t
    if a.frames <= 1 or meta.get('frames', 1) <= 1:
        moving_idx = []
    moving = [objs0[i] for i in moving_idx]
    static = [o for i, o in enumerate(objs0) if i not in moving_idx]

    def render(ps, path, objs, border=None):
        rig.mode(ps, objs)
        r = scene.render
        if border:
            bx0, by0, bx1, by1 = border
            r.use_border, r.use_crop_to_border = True, True
            r.border_min_x, r.border_max_x = bx0 / W, bx1 / W
            r.border_min_y, r.border_max_y = 1 - by1 / H, 1 - by0 / H
        else:
            r.use_border = False
        if ps == 'light':
            M.set_output('light')
            R.render_to(scene, path, samples=4, depth='8')
            M.set_output('beauty')
        elif ps in ('normal', 'aux'):
            M.set_output(ps)
            R.render_to(scene, path, samples=1, depth='8', filter_width=0.01, scale=2)
            M.set_output('beauty')
        elif ps == 'shadow':
            R.render_to(scene, path, samples=64)
        else:
            R.render_to(scene, path)

    # the base: v1 hid the animated parts; v2 (--full-base) renders frame 0 in full
    t = time.time()
    if not a.full_base:
        for o in moving:
            o.hide_render = True
    for ps in ('colour', 'normal', 'aux') + (('light',) if meta.get('light') else ()):
        render(ps, os.path.join(out, f'base.{ps}.png'), static if not a.full_base else objs0)
    T['base_passes_s'] = time.time() - t
    t = time.time()
    for o in moving:
        o.hide_render = False
    if a.shadow_normal:
        scene.render.resolution_percentage = 50
    render('shadow', os.path.join(out, 'base.shadow.png'), objs0)
    scene.render.resolution_percentage = 100
    T['base_shadow_s'] = time.time() - t
    # the animation rectangle: union over frames (needs each frame's pose)
    t = time.time()
    rect = [1e9, 1e9, -1e9, -1e9]
    poses = []
    nframes = a.frames if moving_idx else 0
    for k in range(nframes):
        coll = bpy.data.collections.new(f'f{k}')
        scene.collection.children.link(coll)
        P.set_collection(coll)
        ok = [o for o in mod.build(P, direction=a.direction, frame=k, variant=a.variant, state='working') if o is not None]
        P.set_collection(None)
        keep = [ok[i] for i in moving_idx if i < len(ok)] + ok[len(objs0):]
        kept = set(id(o) for o in keep)
        for o in ok:
            if id(o) not in kept:
                bpy.data.objects.remove(o, do_unlink=True)
        for o in keep:
            o.hide_render = True
        bpy.context.view_layer.update()
        bx = bounds_px(scene, cam, keep, W, H)
        rect = [min(rect[0], bx[0]), min(rect[1], bx[1]), max(rect[2], bx[2]), max(rect[3], bx[3])]
        poses.append(keep)
    T['pose_all_frames_s'] = time.time() - t
    m = 8
    if nframes:
        # R: the moving parts' bounds plus 8 px, rounded out to multiples of 8 px (10 §9.2's alignment)
        rect = [max(0, (math.floor(rect[0]) - m) // 8 * 8), max(0, (math.floor(rect[1]) - m) // 8 * 8),
                min(W, -(-(math.ceil(rect[2]) + m) // 8) * 8), min(H, -(-(math.ceil(rect[3]) + m) // 8) * 8)]
    else:
        rect = [0, 0, 0, 0]
    for o in moving:
        o.hide_render = True
    t = time.time()
    per = []
    for k in range(nframes):
        tk = time.time()
        for o in poses[k]:
            o.hide_render = False
        objs = static + poses[k]
        for ps in ('colour', 'normal', 'aux'):
            render(ps, os.path.join(out, f'anim-f{k:02d}.{ps}.png'), objs, border=rect)
        for o in poses[k]:
            o.hide_render = True
        per.append(time.time() - tk)
    T['anim_frames_s'] = time.time() - t
    T['anim_per_frame_s'] = sum(per) / len(per) if per else 0
    T['total_s'] = time.time() - t0
    res = dict(entity=a.entity, canvas=[W, H], rect=rect, rect_px=(rect[2] - rect[0]) * (rect[3] - rect[1]),
               rect_share=round((rect[2] - rect[0]) * (rect[3] - rect[1]) / (W * H), 4),
               moving_objects=len(moving), objects=len(objs0), frames=a.frames,
               **{k: round(v, 2) for k, v in T.items()})
    print('[layers] ' + json.dumps(res), flush=True)
    json.dump(res, open(os.path.join(out, 'timing.json'), 'w'), indent=1)
    return res


main()
