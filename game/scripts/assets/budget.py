"""Budgets of what the build made (10 §9.6, §6.13, §11), and the extrapolation to M1 through B2's model.

    gamedev-python game/scripts/assets/budget.py

Measured on this build:
  render time   each set's Blender wall time (record.json) and its parts (base passes, shadows, layer frames)
  disk          the render cache, the post cache, public/atlases (KTX2 files: the wire bytes), sheets and fonts
  GPU           10 §6.13's complete allocation (gpu_allocations; checks.py gates on it) at a 1920 x 1080 CSS-px
                window, device pixel ratios 1 and 2, in every selectable mode: High, Normal and Low, each with a
                1-byte-per-pixel format (BC7, ASTC 4x4, BC3, ETC2 RGBA; shadows BC4 or EAC R11 at 0.5) and with the
                uncompressed fallback (RGBA8, R8 shadows). A mode allocates the manifest's page counts with every
                level it samples: High colour levels 0-3 and shadows 0-2, Normal colour 1-3 and shadows 1-2, Low
                colour 2-3 and shadows 1-2; light, icons and terrain (High 0-2, else 1-2) in all. On top: the light
                target (RGBA16F) and shadow target (R8) at half resolution, the quad and index buffers, the LUTs,
                glyphs and chunk textures, and the chart's fixed cache (2 RGBA8 layers of 2048^2 with levels), as
                §6.13 and design/asset-study/render/budget_model.py count them. Budgets (§6.13): High 256 MB in
                the slice, Normal and Low 192 MB; the renderer picks the highest mode that fits.
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


WINDOW = (1920, 1080)          # CSS px (10 §6.13's table)
BUDGET_MB = {'high': 256, 'normal': 192, 'low': 192}          # §6.13, the slice


def other_allocations():
    """[dpr 1, dpr 2] MB of everything allocated besides atlases and terrain (§6.13; budget_model.py's terms)."""
    fb = WINDOW[0] * WINDOW[1]
    lv = levels_bytes
    return {
        'light_target_rgba16f_half': [fb / 4 * 8 / MB, fb * 8 / MB],
        'shadow_target_r8_half': [fb / 4 / MB, fb / MB],
        'quads_2x100k_and_index': [(2 * 100000 * 4 * 20 + 65536 * 6 * 4) / MB] * 2,
        'luts_glyphs_chunk_textures': [2.3 + 0.35 + 2.8] * 2,
        'chart_cache_2_layers_rgba8_with_levels': [2 * lv(2048, 4, 0, 11) / MB] * 2,
    }


def gpu_allocations(man):
    """10 §6.13's complete allocation of this manifest in every selectable mode, at dpr 1 and 2 (module docstring),
    and the mode the renderer's rule picks for each class of GPU format."""
    n = [len(p) for p in man['pages']]
    arr = {a['kind']: a for a in man['arrays']}
    terrain = man.get('terrain', {})
    tiles = len(terrain.get('tiles', {}))
    tsize, tlev = terrain.get('size', 512), terrain.get('levels', 3)

    def atlases(mode, bpp_c, bpp_s):
        c0 = {'high': 0, 'normal': 1, 'low': 2}[mode]
        s0 = 0 if mode == 'high' else 1
        col = n[0] * levels_bytes(arr['colour']['pageSize'], bpp_c, c0, arr['colour']['levels'] - 1)
        sh = n[1] * levels_bytes(arr['shadow']['pageSize'], bpp_s, s0, arr['shadow']['levels'] - 1)
        li = n[2] * levels_bytes(arr['light']['pageSize'], bpp_c, 0, arr['light']['levels'] - 1)
        ic = n[3] * levels_bytes(arr['icon']['pageSize'], bpp_c, 0, arr['icon']['levels'] - 1)
        te = tiles * levels_bytes(tsize, bpp_c, 0 if mode == 'high' else 1, tlev - 1)
        return dict(colour=col / MB, shadow=sh / MB, light=li / MB, icon=ic / MB, terrain=te / MB)

    other = other_allocations()
    modes, picked = {}, {}
    for cls, bpp_c, bpp_s in (('1bpp', 1, 0.5), ('rgba8', 4, 1)):
        for mode in ('high', 'normal', 'low'):
            a = atlases(mode, bpp_c, bpp_s)
            at = sum(a.values())
            modes[f'{mode}_{cls}'] = dict(
                atlases_terrain=round(at, 1), parts={k: round(v, 2) for k, v in a.items()},
                dpr1=round(at + sum(v[0] for v in other.values()), 1),
                dpr2=round(at + sum(v[1] for v in other.values()), 1), budget=BUDGET_MB[mode])
        for dpr in ('dpr1', 'dpr2'):
            picked[f'{cls} {dpr}'] = next((m for m in ('high', 'normal', 'low')
                                           if modes[f'{m}_{cls}'][dpr] <= BUDGET_MB[m]), 'none (pages share layers)')
    return dict(window_css_px=list(WINDOW), pages=dict(zip(('colour', 'shadow', 'light', 'icon'), n)),
                other_mb={k: [round(x, 1) for x in v] for k, v in other.items()}, modes=modes, picked=picked)


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
        rdir = os.path.join(K.CACHE, 'render', sd['render_key']) if sd.get('render_key') else None
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
        gpu_mb=gpu_allocations(man),
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
