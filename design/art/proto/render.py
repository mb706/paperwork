"""Blender entrypoint: render entity sprites in one style.

    taskset -c 8-15,24-31 blender -b --factory-startup -noaudio --python design/art/proto/render.py -- \
        --style kodachrome --entities stone-furnace,keypunch --out design/art/out/sprites \
        [--frames 0] [--directions S,E] [--passes colour,shadow] [--threads 16] [--samples 48]

Each entity module in entities/ (file name = entity id with '-' -> '_') provides
    META = dict(size=(w, h), height=H, directions=['S'], frames=1, margin=0.5, variants=1)
    build(P, direction='S', frame=0, variant=0, state='working') -> list of objects
where P is lib.parts. Directions are compass letters for the facing (S = output to the south,
the default view). Output files:
    <out>/<style>/<entity>/<entity>[-<variant>]-<dir>-f<frame>.<pass>.png
    <out>/<style>/<entity>/manifest.json   (canvas size and anchor per sprite, in High px)
"""

import argparse
import importlib
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

from lib import style as S  # noqa: E402
from lib import materials as M  # noqa: E402
from lib import parts as P  # noqa: E402
from lib import rig as R  # noqa: E402

def parse():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--style', required=True)
    ap.add_argument('--entities', required=True)
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'out', 'sprites'))
    ap.add_argument('--frames', default=None, help='e.g. 0 or 0-15 or 0,4,8')
    ap.add_argument('--directions', default=None)
    ap.add_argument('--variants', default=None)
    ap.add_argument('--passes', default=None)
    ap.add_argument('--threads', type=int, default=16)
    ap.add_argument('--samples', type=int, default=None)
    ap.add_argument('--state', default='working')
    ap.add_argument('--px', type=int, default=S.PX_HIGH)
    return ap.parse_args(argv)


def frames_of(spec, n):
    if spec is None:
        return [0]
    if spec == 'all':
        return list(range(n))
    out = []
    for part in spec.split(','):
        if '-' in part:
            a, b = part.split('-')
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


def load_entity(eid):
    modname = 'entities.' + eid.replace('-', '_')
    return importlib.import_module(modname)


def main():
    a = parse()
    st = S.STYLES[a.style]
    flat = st['render'] == 'flat'
    passes = a.passes.split(',') if a.passes else (['colour', 'shadow', 'normal', 'aux', 'light'] if flat
                                                   else ['colour', 'shadow'])
    for eid in a.entities.split(','):
        t0 = time.time()
        mod = load_entity(eid)
        meta = mod.META
        dirs = a.directions.split(',') if a.directions else meta.get('directions', ['S'])
        frames = frames_of(a.frames, meta.get('frames', 1))
        variants = (list(range(meta.get('variants', 1))) if a.variants in (None, 'all')
                    else [int(v) for v in a.variants.split(',')])
        outdir = os.path.join(a.out, a.style, eid)
        os.makedirs(outdir, exist_ok=True)
        man_path = os.path.join(outdir, 'manifest.json')
        manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
        for var in variants:
            for d in dirs:
                for fr in frames:
                    scene = R.reset_scene()
                    M.set_style(a.style)
                    R.setup_render(scene, a.style, threads=a.threads, samples=a.samples)
                    cam = R.make_camera(scene)
                    rig = R.Rig(scene, a.style)
                    objs = mod.build(P, direction=d, frame=fr, variant=var, state=a.state)
                    objs = [o for o in objs if o is not None]
                    w, h = meta['size']
                    if d in ('E', 'W') and meta.get('rotate_footprint', True):
                        w, h = h, w
                    canvas = R.Canvas(w, h, meta['height'], margin=meta.get('margin', 0.5),
                                      shadow=meta.get('shadow', True), extra=tuple(meta.get('extra', (0, 0, 0, 0))))
                    W, H = R.aim_camera(scene, cam, canvas, a.px)
                    stem = eid + (f'-{var}' if meta.get('variants', 1) > 1 else '') + f'-{d}-f{fr:02d}' + \
                        ('' if a.state in ('working', None) else f'-{a.state}')
                    for ps in passes:
                        if ps == 'light' and not meta.get('light', False):
                            continue
                        rig.mode(ps, objs)
                        path = os.path.join(outdir, f'{stem}.{ps}.png')
                        if flat and ps == 'light':
                            M.set_output('light')
                            R.render_to(scene, path, samples=4, depth='8')
                            M.set_output('beauty')
                        elif flat and ps in ('normal', 'aux'):
                            M.set_output(ps)
                            R.render_to(scene, path, samples=1, depth='8', filter_width=0.01, scale=2)
                            M.set_output('beauty')
                        elif ps == 'shadow':
                            R.render_to(scene, path, samples=(64 if flat else max(16, st['samples'] // 2)))
                        else:
                            R.render_to(scene, path)
                    ax, ay = canvas.anchor_px(a.px)
                    manifest[stem] = dict(w=W, h=H, ax=ax, ay=ay, px=a.px, size=[w, h],
                                          height=meta['height'], dir=d, frame=fr, variant=var, state=a.state)
        json.dump(manifest, open(man_path, 'w'), indent=1, sort_keys=True)
        print(f'[render] {a.style} {eid}: {time.time() - t0:.1f} s', flush=True)


main()
