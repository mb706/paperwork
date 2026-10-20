"""Blender entry point: render sprite sets (10 §9.1, "render only what moves"). One process renders the sets of a
job list in sequence, each into its own output directory, which the build caches by content hash.

    taskset -c 8-15,24-31 blender -b --factory-startup -noaudio --python game/assets/blender/render.py -- \
        --jobs jobs.json [--threads 16]

jobs.json: [{"set": "entity/keypunch", "kind": "entity", "script": "entities/keypunch.py", "params": {...},
             "out": "/abs/dir", "style": "survey"}, ...]

Per set, by kind (lib/contract.py):
  entity    per (direction, variant, state): F0 in full with every layer at frame 0 (colour, normal, aux, and
            light when the set has emitters and the state works); one shadow per (direction, variant) at
            Normal resolution with the parts at frame 0; then each layer's rectangle R (the union over frames
            of its parts' projected bounds, plus 8 px, rounded out to multiples of 8 px; intersecting layers
            merge) and, per frame, colour, normal and aux rendered inside R only. Full-frame sets (belts)
            render every frame whole. Sets with anim_shadow get a shadow per frame.
  inserter  the platform per direction; the arm and the open and closed hands once, with their pivots; their
            shadows are rendered with the part lowered to the ground, so the renderer offsets them itself.
  resource  per shape, the pile built once and rendered per depletion band with pieces hidden.
  mover     the rig built once; per orientation, clip and frame a full render and its shadow.
Each output directory gets record.json last, written atomically: it lists every pass file with its canvas,
anchor and rectangles, and the timings.
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

from lib import contract as C  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import parts as P  # noqa: E402
from lib import rig as R  # noqa: E402
from lib import style as S  # noqa: E402

PX = S.PX_HIGH
LAYER_MARGIN = 8          # px at High around a layer's moving parts: the silhouette line and the filters' reach
ALIGN = 8                 # rectangles on multiples of 8 px of the canvas (10 §9.2 step 3)


def load_module(path, tag):
    spec = importlib.util.spec_from_file_location(f'paperwork_model_{tag}', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fresh(style, threads):
    scene = R.reset_scene()
    M.set_style(style)
    R.setup_render(scene, style, threads=threads)
    cam = R.make_camera(scene)
    rig = R.Rig(scene, style)
    P.set_collection(None)
    return scene, cam, rig


def as_parts(result):
    if isinstance(result, dict):
        return {k: v for k, v in result.items() if v is not None}
    return {f'part{i:03d}': o for i, o in enumerate(result) if o is not None}


def descendants(o):
    out = [o]
    for c in o.children:
        out.extend(descendants(c))
    return out


def collect(objs):
    """Every object of the given parts (objects or lists of objects) and their children, in a stable order,
    without duplicates."""
    seen, out = set(), []
    flat = []
    for o in objs:
        flat.extend(o if isinstance(o, (list, tuple)) else [o])
    for o in flat:
        for d in descendants(o):
            if d.name not in seen:
                seen.add(d.name)
                out.append(d)
    return out


def update():
    bpy.context.view_layer.update()


def round_rect(x0, y0, x1, y1, W, H, margin=LAYER_MARGIN):
    a = ALIGN
    return [max(0, int(math.floor(x0 - margin)) // a * a), max(0, int(math.floor(y0 - margin)) // a * a),
            min(W, -(-int(math.ceil(x1 + margin)) // a) * a), min(H, -(-int(math.ceil(y1 + margin)) // a) * a)]


def intersects(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def union(a, b):
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def json_safe(v):
    if isinstance(v, dict):
        return {str(k): json_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [json_safe(x) for x in v]
    if isinstance(v, (int, float, str, bool)) or v is None:
        return v
    return str(v)


class Timer:
    def __init__(self):
        self.t = {}

    def add(self, key, dt):
        self.t[key] = self.t.get(key, 0.0) + dt

    def run(self, key, fn, *a, **k):
        t0 = time.time()
        r = fn(*a, **k)
        self.add(key, time.time() - t0)
        return r


def write_record(out, rec):
    tmp = os.path.join(out, 'record.json.tmp')
    with open(tmp, 'w') as f:
        json.dump(rec, f, indent=1, sort_keys=True)
    os.replace(tmp, os.path.join(out, 'record.json'))


# --------------------------------------------------------------------------------------------------------------
# entity
# --------------------------------------------------------------------------------------------------------------

def render_entity(job, mod, meta, out, threads, T):
    style = job.get('style', S.PIPELINE_STYLE)
    if meta['anim_shadow'] and not meta['full_frame']:
        # a layered set with an animated shadow (the radar's dish, M1): shadows per layer frame are not built yet
        raise NotImplementedError(f'{job["set"]}: anim_shadow on a layered (not full-frame) set')
    combos = []
    for d in meta['dirs']:
        w, h = C.footprint(meta['size'], d, meta['rotate_footprint'])
        for vi, vname in C.variant_list(meta):
            shadow_file = None
            for state in meta['states']:
                scene, cam, rig = fresh(style, threads)
                parts = as_parts(T.run('build', mod.build, P, dir=d, variant=vi, state=state))
                objs = collect(parts.values())
                canvas = R.Canvas(w, h, meta['height'], margin=meta['margin'], shadow=True,
                                  extra=tuple(meta['extra']))
                W, H = R.aim_camera(scene, cam, canvas, PX)
                ax, ay = canvas.anchor_px(PX)
                working = state == 'working'
                layers = meta['layers'] if working else []
                for li in range(len(layers)):
                    mod.pose(parts, li, 0)
                update()
                stem = f'd{d:02d}-v{vi}-{state}'
                combo = dict(dir=d, variant=vi, variant_name=vname, state=state, canvas=[W, H], anchor=[ax, ay],
                             tiles=canvas.as_dict(), footprint=[w, h], base={}, layers=[])
                cut = bool(meta.get('cut'))
                passes = ('colour', 'normal', 'aux', 'pos') if cut else ('colour', 'normal', 'aux')
                if not meta['full_frame']:
                    for ps in passes:
                        fn = f'{stem}.{ps}.png'
                        T.run(f'base_{ps}', R.render_pass, scene, rig, ps, objs, os.path.join(out, fn),
                              pos_ref=parts.get('root'))
                        combo['base'][ps] = fn
                if meta['light'] and working:
                    fn = f'{stem}.light.png'
                    T.run('light', R.render_pass, scene, rig, 'light', objs, os.path.join(out, fn))
                    combo['base']['light'] = fn
                if layers:
                    combo['layers'] = render_layers(job, mod, meta, parts, objs, scene, cam, rig, W, H, stem, out,
                                                    T)
                if shadow_file is None and not meta['anim_shadow']:
                    shadow_file = f'd{d:02d}-v{vi}.shadow.png'
                    if hasattr(mod, 'build_shadow'):
                        # a set whose drawing geometry runs past its tile (a cut set) casts its own tile's shadow
                        scene, cam, rig = fresh(style, threads)
                        sparts = as_parts(mod.build_shadow(P, dir=d, variant=vi))
                        sobjs = collect(sparts.values())
                        R.aim_camera(scene, cam, canvas, PX)
                    else:
                        sobjs = objs
                    T.run('shadow', R.render_pass, scene, rig, 'shadow', sobjs, os.path.join(out, shadow_file),
                          shadow_samples=meta.get('shadow_samples', 64))
                combo['shadow'] = shadow_file
                combos.append(combo)
    return dict(combos=combos)


def render_layers(job, mod, meta, parts, objs, scene, cam, rig, W, H, stem, out, T):
    layers = meta['layers']
    if meta['full_frame']:
        L = layers[0]
        frames = []
        t0 = time.time()
        passes = ('colour', 'normal', 'aux', 'pos') if meta.get('cut') else ('colour', 'normal', 'aux')
        for f in range(L['frames']):
            mod.pose(parts, 0, f)
            update()
            img = {}
            for ps in passes:
                fn = f'{stem}-f{f:02d}.{ps}.png'
                R.render_pass(scene, rig, ps, objs, os.path.join(out, fn), pos_ref=parts.get('root'))
                img[ps] = fn
            if meta['anim_shadow']:
                fn = f'{stem}-f{f:02d}.shadow.png'
                R.render_pass(scene, rig, 'shadow', objs, os.path.join(out, fn))
                img['shadow'] = fn
            frames.append(img)
        mod.pose(parts, 0, 0)
        update()
        T.add('layer_frames', time.time() - t0)
        return [dict(parts=['*'], frames=L['frames'], rect=[0, 0, W, H], full_frame=True, layer_ids=[0],
                     images=frames)]
    # the rectangle R of each layer: the union over its frames of its parts' projected bounds
    t0 = time.time()
    rects = []
    for li, L in enumerate(layers):
        names = L['parts']
        missing = [n for n in names if n not in parts]
        if missing:
            raise KeyError(f'{job["set"]}: layer {li} names parts the model lacks: {missing}')
        lobjs = collect([parts[n] for n in names])
        box = [1e9, 1e9, -1e9, -1e9]
        for f in range(L['frames']):
            mod.pose(parts, li, f)
            update()
            b = R.bounds_px(scene, cam, lobjs, W, H)
            box = [min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])]
        mod.pose(parts, li, 0)
        update()
        rects.append(round_rect(*box, W, H))
    # merge layers whose rectangles intersect (their frame counts must agree): the set's layers are disjoint
    groups = [dict(ids=[li], rect=rects[li], frames=layers[li]['frames']) for li in range(len(layers))]
    merged = True
    while merged:
        merged = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                if intersects(groups[i]['rect'], groups[j]['rect']):
                    if groups[i]['frames'] != groups[j]['frames']:
                        raise ValueError(f'{job["set"]}: layers {groups[i]["ids"]} and {groups[j]["ids"]} '
                                         f'intersect but have {groups[i]["frames"]} and {groups[j]["frames"]} '
                                         f'frames')
                    groups[i] = dict(ids=groups[i]['ids'] + groups[j]['ids'],
                                     rect=union(groups[i]['rect'], groups[j]['rect']), frames=groups[i]['frames'])
                    del groups[j]
                    merged = True
                    break
            if merged:
                break
    T.add('layer_rects', time.time() - t0)
    out_layers = []
    for gi, g in enumerate(groups):
        t1 = time.time()
        images = []
        for f in range(g['frames']):
            for li in g['ids']:
                mod.pose(parts, li, f)
            update()
            img = {}
            for ps in ('colour', 'normal', 'aux'):
                fn = f'{stem}-L{gi}-f{f:02d}.{ps}.png'
                size = R.render_pass(scene, rig, ps, objs, os.path.join(out, fn), border=g['rect'])
                img[ps] = fn
                img[ps + '_size'] = list(size)
            images.append(img)
        # a full render of the middle frame, for the check that the layered frame matches it (10 §9.5 #2)
        k = g['frames'] // 2
        for li in g['ids']:
            mod.pose(parts, li, k)
        update()
        verify = dict(frame=k)
        for ps in ('colour', 'normal', 'aux'):
            fn = f'{stem}-L{gi}-verify.{ps}.png'
            R.render_pass(scene, rig, ps, objs, os.path.join(out, fn))
            verify[ps] = fn
        for li in g['ids']:
            mod.pose(parts, li, 0)
        update()
        T.add('layer_frames', time.time() - t1)
        out_layers.append(dict(layer_ids=g['ids'], parts=[n for li in g['ids'] for n in layers[li]['parts']],
                               frames=g['frames'], rect=g['rect'], images=images, full_frame=False, verify=verify))
    return out_layers


# --------------------------------------------------------------------------------------------------------------
# inserter
# --------------------------------------------------------------------------------------------------------------

def lower(objs, dz):
    for o in objs:
        if o.parent is None:
            o.location.z += dz
    update()


def render_inserter(job, mod, meta, out, threads, T):
    style = job.get('style', S.PIPELINE_STYLE)
    zs = meta['shoulder']
    rec = dict(platform=[], parts={})
    for d in meta['platform_dirs']:
        scene, cam, rig = fresh(style, threads)
        parts = as_parts(T.run('build', mod.build_platform, P, d))
        objs = collect(parts.values())
        canvas = R.Canvas(1, 1, meta['height'], margin=meta['margin'], shadow=True)
        W, H = R.aim_camera(scene, cam, canvas, PX)
        ax, ay = canvas.anchor_px(PX)
        stem = f'platform-d{d:02d}'
        img = dict(dir=d, canvas=[W, H], anchor=[ax, ay], tiles=canvas.as_dict())
        for ps in ('colour', 'normal', 'aux', 'shadow'):
            fn = f'{stem}.{ps}.png'
            T.run(f'base_{ps}' if ps != 'shadow' else 'shadow', R.render_pass, scene, rig, ps, objs,
                  os.path.join(out, fn))
            img[ps] = fn
        rec['platform'].append(img)
    reach = meta['arm_length'] + 0.35
    for name, builder in (('arm', lambda: mod.build_arm(P)), ('hand_open', lambda: mod.build_hand(P, False)),
                          ('hand_closed', lambda: mod.build_hand(P, True))):
        scene, cam, rig = fresh(style, threads)
        parts = as_parts(T.run('build', builder))
        objs = collect(parts.values())
        if name != 'arm':
            for o in objs:
                if o.parent is None:
                    o.location.z += zs
            update()
        ext = reach if name == 'arm' else 0.0
        canvas = R.Canvas(0.6, 0.6, zs + 0.25, margin=0.35, shadow=False, extra=(0, 0, 0, ext))
        W, H = R.aim_camera(scene, cam, canvas, PX)
        ax, ay = canvas.anchor_px(PX)
        px_pivot = R.project_px(scene, cam, (0.0, 0.0, zs), W, H)
        img = dict(canvas=[W, H], anchor=[ax, ay], tiles=canvas.as_dict(), pivot=[px_pivot[0], px_pivot[1]])
        if name == 'arm':
            tip = R.project_px(scene, cam, (0.0, meta['arm_length'], zs), W, H)
            img['length'] = math.hypot(tip[0] - px_pivot[0], tip[1] - px_pivot[1])
        for ps in ('colour', 'normal', 'aux'):
            fn = f'{name}.{ps}.png'
            T.run(f'base_{ps}', R.render_pass, scene, rig, ps, objs, os.path.join(out, fn))
            img[ps] = fn
        # the shadow: the part lowered to the ground, so the mask is its footprint; the renderer adds the
        # shadow's offset for the shoulder's height (the set's shadowShoulder, 10 §15.7's inserter program)
        sh_canvas = R.Canvas(0.6, 0.6, 0.3, margin=0.35, shadow=True, extra=(0, 0, 0, ext))
        lower(objs, -zs)
        SW, SH = R.aim_camera(scene, cam, sh_canvas, PX)
        sax, say = sh_canvas.anchor_px(PX)
        fn = f'{name}.shadow.png'
        T.run('shadow', R.render_pass, scene, rig, 'shadow', objs, os.path.join(out, fn))
        img['shadow'] = fn
        img['shadow_canvas'] = [SW, SH]
        img['shadow_anchor'] = [sax, say]
        img['shadow_pivot'] = [sax, say]          # the pivot's ground point is the shadow canvas's anchor
        rec['parts'][name] = img
    return rec


# --------------------------------------------------------------------------------------------------------------
# resource
# --------------------------------------------------------------------------------------------------------------

def render_resource(job, mod, meta, out, threads, T):
    style = job.get('style', S.PIPELINE_STYLE)
    shapes = []
    for s in range(meta['shapes']):
        scene, cam, rig = fresh(style, threads)
        pieces = [o for o in T.run('build', mod.build, P, s) if o is not None]
        objs = collect(pieces)
        canvas = R.Canvas(1, 1, meta['height'], margin=meta['margin'], shadow=True, extra=tuple(meta['extra']))
        W, H = R.aim_camera(scene, cam, canvas, PX)
        ax, ay = canvas.anchor_px(PX)
        bands = []
        for b in range(meta['bands']):
            keep = mod.pieces(b, len(pieces))
            for i, o in enumerate(pieces):
                for dsc in descendants(o):
                    dsc.hide_render = i >= keep
            update()
            vis = [o for o in objs if not o.hide_render]
            stem = f's{s}-b{b}'
            img = dict(band=b, pieces=keep)
            for ps in ('colour', 'normal', 'aux', 'shadow'):
                fn = f'{stem}.{ps}.png'
                T.run(f'base_{ps}' if ps != 'shadow' else 'shadow', R.render_pass, scene, rig, ps, vis,
                      os.path.join(out, fn))
                img[ps] = fn
            bands.append(img)
        shapes.append(dict(shape=s, canvas=[W, H], anchor=[ax, ay], tiles=canvas.as_dict(), bands=bands))
    return dict(shapes=shapes)


# --------------------------------------------------------------------------------------------------------------
# mover
# --------------------------------------------------------------------------------------------------------------

def render_mover(job, mod, meta, out, threads, T):
    style = job.get('style', S.PIPELINE_STYLE)
    scene, cam, rig = fresh(style, threads)
    parts = as_parts(T.run('build', mod.build, P))
    objs = collect(parts.values())
    root = parts['root']
    w, h = meta['size']
    canvas = R.Canvas(w, h, meta['height'], margin=meta['margin'], shadow=True, extra=tuple(meta['extra']))
    W, H = R.aim_camera(scene, cam, canvas, PX)
    ax, ay = canvas.anchor_px(PX)
    n = meta['orientations']
    preview = job.get('preview')          # {orientations: [...], frames: {clip: [...]}}: a quick look, no shadows
    clips = {}
    for cname, cm in meta['clips'].items():
        clips[cname] = dict(frames=cm['frames'], images=[[None] * cm['frames'] for _ in range(n)])
    for k in (preview['orientations'] if preview else range(n)):
        # orientation k faces 360 k / n degrees clockwise from north; the model faces south at rest
        root.rotation_euler = (0.0, 0.0, math.radians(180.0 - 360.0 * k / n))
        for cname, cm in meta['clips'].items():
            for f in (preview['frames'].get(cname, []) if preview else range(cm['frames'])):
                t0 = time.time()
                mod.pose(parts, cname, f)
                update()
                stem = f'{cname}-o{k:02d}-f{f:02d}'
                img = {}
                for ps in (('colour', 'normal', 'aux') if preview else ('colour', 'normal', 'aux', 'shadow')):
                    fn = f'{stem}.{ps}.png'
                    R.render_pass(scene, rig, ps, objs, os.path.join(out, fn))
                    img[ps] = fn
                clips[cname]['images'][k][f] = img
                T.add('mover_frames', time.time() - t0)
    return dict(canvas=[W, H], anchor=[ax, ay], tiles=canvas.as_dict(), clips=clips)


RENDERERS = dict(entity=render_entity, inserter=render_inserter, resource=render_resource, mover=render_mover)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', required=True)
    ap.add_argument('--threads', type=int, default=16)
    a = ap.parse_args(argv)
    jobs = json.load(open(a.jobs))
    for ji, job in enumerate(jobs):
        t0 = time.time()
        out = job['out']
        os.makedirs(out, exist_ok=True)
        rec_path = os.path.join(out, 'record.json')
        if os.path.exists(rec_path):
            os.remove(rec_path)
        mod = load_module(os.path.join(HERE, job['script']), f'{ji}')
        if job.get('params') is not None:
            mod.setup(job['params'])
        meta = C.normalize(mod.META, job['kind'])
        T = Timer()
        body = RENDERERS[job['kind']](job, mod, meta, out, a.threads, T)
        rec = dict(set=job['set'], kind=job['kind'], style=job.get('style', S.PIPELINE_STYLE), px=PX,
                   px_shadow=S.PX_NORMAL, meta=json_safe(meta), blender=bpy.app.version_string,
                   timing={k: round(v, 3) for k, v in T.t.items()}, wall_s=round(time.time() - t0, 3), **body)
        write_record(out, rec)
        print(f'[render] {job["set"]}: {time.time() - t0:.1f} s', flush=True)


main()
