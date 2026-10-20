"""Budgets of what the build made (10 §9.6, §6.13, §11), and the extrapolation to M1 through B2's model.

    gamedev-python game/scripts/assets/budget.py

Measured on this build:
  render time   each set's Blender wall time (record.json) and its parts (base passes, shadows, layer frames)
  disk          the render cache, the post cache, public/atlases (KTX2 files: the wire bytes), sheets and fonts
  GPU           10 §6.13's allocation for the manifest's page counts, every level of each mode: High (BC7: colour
                levels 0-3, shadows BC4 levels 0-2, light 0-1, icons 0-2, terrain 0-2), Normal (colour 1-3, shadows
                1-2), Low (RGBA8: colour 2-3, R8 shadows 1-2)
  unit costs    trimmed colour area against B2's formula 0.75 (w + 0.2)(h + H + 0.2) 64^2, cell overhead, page
                fill, KTX2 bits per content pixel at High and Normal, seconds per canvas pixel
Then design/asset-study/render/budget_model.py's M1 summary, and the same with its content and render-cost terms
scaled by the measured-to-modelled ratios. Writes .cache/assets/qc/budget.json.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402

QC = os.path.join(K.CACHE, 'qc')
MB = 2 ** 20


def du(path):
    tot = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            tot += os.path.getsize(os.path.join(root, f))
    return tot


def levels_bytes(side, bpp, first, last):
    return sum((side >> k) ** 2 * bpp for k in range(first, last + 1))


def gpu(man):
    n = [len(p) for p in man['pages']]
    arr = {a['kind']: a for a in man['arrays']}
    tiles = len(man.get('terrain', {}).get('tiles', {}))
    tsize = man.get('terrain', {}).get('size', 512)

    def mode(c0, s0, bpp_c, bpp_s):
        col = n[0] * levels_bytes(arr['colour']['pageSize'], bpp_c, c0, arr['colour']['levels'] - 1)
        sh = n[1] * levels_bytes(arr['shadow']['pageSize'], bpp_s, s0, arr['shadow']['levels'] - 1)
        li = n[2] * levels_bytes(arr['light']['pageSize'], bpp_c, 0, arr['light']['levels'] - 1)
        ic = n[3] * levels_bytes(arr['icon']['pageSize'], bpp_c, 0, arr['icon']['levels'] - 1)
        te = tiles * levels_bytes(tsize, bpp_c, 0 if c0 == 0 else 1, 2)
        return dict(colour=col / MB, shadow=sh / MB, light=li / MB, icon=ic / MB, terrain=te / MB,
                    total=(col + sh + li + ic + te) / MB)

    return dict(pages=dict(zip(('colour', 'shadow', 'light', 'icon'), n)),
                high_bc7=mode(0, 0, 1, 0.5), normal_bc7=mode(1, 1, 1, 0.5), low_rgba8=mode(2, 1, 4, 1))


def main():
    man = K.load_json(os.path.join(K.PUBLIC, 'atlases', 'sprites.json'))
    layout = K.load_json(os.path.join(K.CACHE, 'layout.json'))
    assembled = K.load_json(os.path.join(K.CACHE, 'assembled.json'))
    sets = {}
    for p in layout['pages']:
        for c in p['cells']:
            sets.setdefault(c['set'], c['dir'])
    render_t, parts_t, canvas_px = {}, {}, 0
    trimmed, modelled = 0.0, 0.0
    content, cells = 0, 0
    for name, post_dir in sorted(sets.items()):
        sd = K.load_json(os.path.join(post_dir, 'set.json'))
        rdir = sd.get('render_dir')
        if rdir and os.path.exists(os.path.join(rdir, 'record.json')):
            rec = K.load_json(os.path.join(rdir, 'record.json'))
            render_t[name] = rec.get('wall_s', 0.0)
            for k, v in rec.get('timing', {}).items():
                parts_t[k] = parts_t.get(k, 0.0) + v
            for c in rec.get('combos', []):
                canvas_px += c['canvas'][0] * c['canvas'][1]
            meta = rec.get('meta', {})
            if rec['kind'] == 'entity' and not name.startswith('greybox/'):
                w, h = meta.get('size', [1, 1])
                H = meta.get('height', 1)
                f0 = [f for f in sd['frames'] if f['array'] == 'colour' and 'parent' not in f]
                if f0:
                    trimmed += f0[0]['w'] * f0[0]['h']
                    modelled += 0.75 * (w + 0.2) * (h + H + 0.2) * 4096
    for p in layout['pages']:
        arr = layout['arrays'][p['array']]
        if arr['kind'] != 'colour':
            continue
        for c in p['cells']:
            content += c['w'] * c['h']
            cells += c['cw'] * c['ch']
    col_pages = [p for p in assembled['pages'] if p['array'] == 0]
    high_bytes = sum(p['bytes'][0] for p in col_pages)
    normal_bytes = sum(p['bytes'][1] for p in col_pages if len(p['bytes']) > 1)
    page_px = sum(1 for _ in col_pages) * 2048 * 2048
    out = dict(
        render=dict(seconds_total=round(sum(render_t.values()), 1), by_part={k: round(v, 1) for k, v in sorted(
            parts_t.items())}, slowest=sorted(((round(v, 1), k) for k, v in render_t.items()), reverse=True)[:8],
            canvas_mpx=round(canvas_px / 1e6, 2)),
        disk_mb=dict(render_cache=round(du(os.path.join(K.CACHE, 'render')) / MB, 1),
                     post_cache=round(du(os.path.join(K.CACHE, 'post')) / MB, 1),
                     atlases=round(du(os.path.join(K.PUBLIC, 'atlases')) / MB, 2),
                     sheets=round(du(os.path.join(K.PUBLIC, 'sheets')) / MB, 2),
                     fonts=round(du(os.path.join(K.PUBLIC, 'fonts')) / MB, 2)),
        gpu_mb=gpu(man),
        units=dict(trimmed_over_model=round(trimmed / modelled, 3) if modelled else None,
                   cell_overhead=round(cells / content - 1, 3) if content else None,
                   colour_page_fill=round(cells / page_px, 3) if page_px else None,
                   xubc7_bits_per_content_px_high=round(8 * high_bytes / content, 2) if content else None,
                   xubc7_bits_per_content_px_normal=round(8 * normal_bytes / (content / 4), 2) if content else None),
    )
    # B2's model of M1, and the same scaled by the measured ratios where they exist
    sys.path.insert(0, os.path.join(K.ROOT, 'design', 'asset-study', 'render'))
    try:
        import budget_model as BM
        rows = BM.model()
        base = BM.summary(rows, 'm1')
        out['m1_model'] = dict(render_hours=base['render_hours'], pages=base['pages'],
                               gpu_total_mb_dpr1_dpr2=base['gpu_total_mb_dpr1_dpr2']['high_bc7'],
                               colour_mpx_high=base['colour_mpx_high'])
        r = out['units']['trimmed_over_model'] or 1.0
        out['m1_scaled'] = dict(colour_mpx_high=round(base['colour_mpx_high'] * r, 1),
                                note='content scales by the measured trimmed-area ratio; render time is B2\'s '
                                     'unit costs (see render.by_part for this build\'s)')
    except Exception as e:  # noqa: BLE001
        out['m1_model'] = f'unavailable: {e}'
    os.makedirs(QC, exist_ok=True)
    K.dump_json(os.path.join(QC, 'budget.json'), out)
    print(json.dumps(out, indent=1)[:4000])


if __name__ == '__main__':
    main()
