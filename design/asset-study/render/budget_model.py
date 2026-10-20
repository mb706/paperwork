"""B2 asset budget model (10 §9.6): render time on this host, atlas pixels and pages, download and GPU memory,
for the M1 slice and the full game, from per-unit costs measured on this host (render_layers.py, A3's sprites)
and the texture formats measured by design/asset-study/texfmt/.

    gamedev-python -I design/asset-study/render/budget_model.py [--json out.json]

Every sprite set is (directions x variants x states) static bases plus animated-layer frames; sizes follow the
calibration on A3's Survey sprites: trimmed colour area = 0.75 (w + 0.2)(h + H + 0.2) 64^2 px at High, render
canvas = 4 x trimmed (margins and shadow reach). Costs (seconds, 16 threads on socket 1):
  base passes (colour 16 spp, normal and aux 2x 1 spp, light 4 spp)  0.10 + 2.6e-6 x canvas px
  shadow pass, 64 spp, rendered at Normal resolution                0.05 + 12.5e-6 x canvas px (50e-6 at High)
  one animated-layer frame (colour, normal, aux inside the rectangle) 0.10 + 3.0e-6 x rectangle px
  ink pass (numpy, 2x passes)                                         6.7e-6 x px inked
"""

import argparse
import json
import math

PAGE = 2048 * 2048
OCC = 0.86                       # measured MaxRects occupancy of a 2048^2 page (make_pages.py)
BPP_DL = {'xubc7-q90': (2.33, 3.06), 'webp-q90': (1.20, 1.86)}   # bits per content px: High, Normal (measured)


def trimmed(w, h, H):
    return 0.75 * (w + 0.2) * (h + H + 0.2) * 4096


# (id, w, h, height, dirs, variants, states, frames, anim_share, light, milestone, count)
#  anim_share: animated rectangle / trimmed area; 1.0 = full-frame animation (belts, the character)
#  states: 2 when an idle variant differs (emitters dark); count: number of such sprite sets
E = []


def add(i, w, h, H, dirs=1, variants=1, states=1, frames=0, share=0.25, light=False, m='full', count=1):
    E.append(dict(id=i, w=w, h=h, H=H, dirs=dirs, variants=variants, states=states, frames=frames, share=share,
                  light=light, m=m, count=count))


# --- the slice's 32 entities (09 §2.4) ---
add('burner-mining-drill', 2, 2, 1.6, dirs=4, states=2, frames=16, share=0.25, light=True, m='m1')
add('electric-mining-drill', 3, 3, 2.0, dirs=4, frames=16, share=0.30, m='m1')
add('offshore-pump', 1, 2, 1.2, dirs=4, frames=16, share=0.3, m='m1')
add('stone-furnace', 2, 2, 1.6, states=2, frames=16, share=0.10, light=True, m='m1')
add('steel-furnace', 2, 2, 1.7, states=2, frames=16, share=0.10, light=True, m='m1')
add('keypunch', 2, 2, 1.6, states=2, frames=16, share=0.25, light=True, m='m1')
add('assembling-machine-1', 3, 3, 2.0, states=2, frames=16, share=0.25, light=True, m='m1')
add('assembling-machine-2', 3, 3, 2.2, states=2, frames=16, share=0.25, light=True, m='m1')
add('seminar', 3, 3, 2.05, states=2, frames=16, share=0.25, light=True, m='m1')
add('boiler', 3, 2, 3.3, dirs=4, states=2, frames=16, share=0.10, light=True, m='m1')
add('steam-engine', 3, 5, 2.45, dirs=2, frames=16, share=0.40, m='m1')
add('solar-panel', 3, 3, 0.5, m='m1')
add('small-electric-pole', 1, 1, 3.0, m='m1')
add('medium-electric-pole', 1, 1, 4.5, m='m1')
add('big-electric-pole', 2, 2, 7.0, m='m1')
for t in ('transport-belt', 'fast-transport-belt'):
    add(t, 1, 1, 0.26, variants=20, frames=16, share=1.0, m='m1')        # 4 straight, 8 curves, 8 caps
for t in ('underground-belt', 'fast-underground-belt'):
    add(t, 1, 1, 0.6, dirs=4, variants=2, m='m1')
for t in ('splitter', 'fast-splitter'):
    add(t, 2, 1, 0.8, dirs=4, frames=16, share=0.6, m='m1')
for t in ('burner-inserter', 'inserter', 'long-handed-inserter', 'fast-inserter'):
    add(t, 1, 1, 0.6, variants=6, m='m1')                                # parts: base x4, arm, hand open/closed
for t in ('wooden-chest', 'iron-chest', 'steel-chest'):
    add(t, 1, 1, 0.85, m='m1')
add('pipe', 1, 1, 0.55, variants=16, m='m1')
add('pipe-to-ground', 1, 1, 0.6, dirs=4, m='m1')
add('radar', 3, 3, 3.0, frames=64, share=0.5, m='m1')
add('small-lamp', 1, 1, 0.6, states=2, light=True, m='m1')
# --- the rest of the base game ---
add('electric-furnace', 3, 3, 2.0, states=2, frames=16, share=0.2, light=True)
add('tokenizer', 3, 3, 2.2, states=2, frames=16, share=0.25, light=True)
add('verifier', 2, 4, 2.0, dirs=4, frames=16, share=0.25)
add('assembling-machine-3', 3, 3, 2.4, states=2, frames=16, share=0.25, light=True)
for t in ('chemical-plant', 'data-plant', 'trainer', 'centrifuge', 'endpoint'):
    add(t, 3, 3, 2.4, dirs=4 if t == 'chemical-plant' else 1, states=2, frames=16, share=0.3, light=True)
add('data-refinery', 5, 5, 4.0, dirs=4, frames=16, share=0.2, light=True)
add('research-hall', 7, 7, 3.6, states=2, frames=16, share=0.35, light=True)
add('switch', 3, 3, 2.0, frames=16, share=0.3, light=True)
add('frontier-cluster', 9, 9, 6.0, states=2, frames=32, share=0.3, light=True)
add('crawler', 3, 3, 3.0, dirs=4, frames=32, share=0.4)
add('accumulator', 2, 2, 2.0, frames=8, share=0.2)
add('nuclear-reactor', 5, 5, 3.5, states=2, frames=16, share=0.15, light=True)
add('fusion-reactor', 6, 6, 4.0, states=2, frames=16, share=0.2, light=True)
add('steam-turbine', 3, 5, 2.6, dirs=2, frames=16, share=0.3)
add('fusion-generator', 3, 5, 2.6, dirs=2, frames=16, share=0.3, light=True)
add('heat-pipe', 1, 1, 0.3, variants=16, light=True)
add('heat-exchanger', 3, 2, 2.2, dirs=4, light=True)
add('substation', 2, 2, 5.0)
add('express-transport-belt', 1, 1, 0.26, variants=20, frames=16, share=1.0)
add('express-underground-belt', 1, 1, 0.6, dirs=4, variants=2)
add('express-splitter', 2, 1, 0.8, dirs=4, frames=16, share=0.6)
add('bulk-inserter', 1, 1, 0.6, variants=6)
for t in ('active-provider', 'passive-provider', 'storage', 'buffer', 'requester'):
    add(t + '-chest', 1, 1, 0.9, frames=7, share=0.5)
add('pump', 1, 2, 1.0, dirs=4, frames=32, share=0.3)
add('repeater', 1, 2, 1.0, dirs=4, frames=32, share=0.3)
add('storage-tank', 3, 3, 2.5, dirs=2)
add('data-lake', 3, 3, 2.5, dirs=2)
add('data-line', 1, 1, 0.4, variants=16)
add('underground-line', 1, 1, 0.5, dirs=4)
add('terminal', 2, 2, 1.8, frames=16, share=0.15, light=True)
add('rail', 4, 4, 0.3, variants=100)                    # 2.0 pieces x 16 directions (straight, diagonal, curves)
add('train-stop', 2, 2, 4.0, dirs=4, states=2, light=True)
add('rail-signal', 1, 1, 1.5, dirs=16, states=3, light=True)
add('rail-chain-signal', 1, 1, 1.5, dirs=16, states=4, light=True)
for t in ('locomotive', 'cargo-wagon', 'fluid-wagon', 'data-wagon', 'artillery-wagon'):
    add(t, 2, 6, 3.0, dirs=64)                          # orientations, whole renders
add('agent-hub', 4, 4, 2.5, frames=16, share=0.15, light=True)
add('car', 2, 3, 1.6, dirs=64)
add('half-track', 3, 4, 2.0, dirs=64)
add('legged-agent', 3, 3, 3.0, dirs=64)
for t in ('decider', 'arithmetic', 'selector'):
    add(t + '-combinator', 1, 2, 0.8, dirs=4, light=True)
add('constant-combinator', 1, 1, 0.8, dirs=4)
add('area-scanner', 1, 1, 0.8, dirs=4)
add('power-switch', 2, 2, 1.6, states=2, light=True)
add('programmable-speaker', 1, 1, 1.2)
add('display-panel', 1, 1, 0.6, dirs=4)
add('cooling-tower', 3, 3, 4.0, frames=16, share=0.2)
add('dry-cooler', 2, 2, 1.5, frames=16, share=0.3)
add('water-exchanger', 3, 3, 1.5, frames=16, share=0.2)
add('monitor', 2, 2, 2.0, dirs=64)
for t in ('gun', 'laser', 'interceptor-bay'):
    add(t + '-turret', 2, 2, 1.8, dirs=64)
for t in ('arc', 'artillery'):
    add(t + '-turret', 3, 3, 2.5, dirs=64)
add('fence', 1, 1, 1.2, variants=16)
add('gate', 1, 1, 1.2, dirs=2, frames=16, share=0.5)
add('land-mine', 1, 1, 0.2)
add('deployer', 1, 1, 1.0)
# --- world, characters, movers ---
add('tree', 2, 2, 4.6, variants=40, states=4, m='m1')     # 10 species x 4 shapes x 4 leaf stages (canopy ~2 m)
add('rock', 2, 2, 1.3, variants=12, m='m1')
add('resource', 1, 1, 0.3, variants=48, m='m1', count=6)  # 6 shapes x 8 depletion bands, 6 slice resources
add('resource-late', 1, 1, 0.3, variants=48, count=2)
add('decorative', 1, 1, 0.5, variants=4, m='m1', count=15)
add('campus', 8, 8, 6.5, variants=2, m='m1')              # skins 1-2 (09 §9); 3 more later
add('campus-late', 8, 8, 6.5, variants=3)
add('landmark', 3, 3, 3.0, variants=2, m='m1', count=3)    # exchange office, mine entrance, salvage
add('town-block', 6, 6, 6.0, variants=8, m='m1', count=2)  # 2 skins x 8 variants (09 §9)
add('town-block-late', 6, 6, 8.0, variants=8, count=3)
add('cliff', 4, 2, 2.0, variants=40)
add('character', 1, 1, 1.85, dirs=8, variants=1, frames=36, share=1.0, m='m1')  # run 16, mine 16, idle 4
add('agent', 1, 1, 0.6, dirs=16, frames=2, share=1.0, count=2)


def model():
    rows = []
    for e in E:
        tr = trimmed(e['w'], e['h'], e['H'])
        canvas = 4 * tr
        sets = e['dirs'] * e['variants'] * e['states'] * e['count']
        anim_sets = e['dirs'] * e['variants'] * e['count']      # one animation per direction and variant
        rect = e['share'] * tr
        frames = e['frames']
        # render time (s)
        t_base = sets * (0.10 + 2.6e-6 * canvas)
        t_shadow = e['dirs'] * e['variants'] * e['count'] * (0.05 + 12.5e-6 * canvas)
        t_anim = anim_sets * frames * (0.10 + 3.0e-6 * rect)
        if e['share'] >= 1.0:          # full-frame animations have no separate base
            t_base = e['dirs'] * e['variants'] * e['count'] * (e['states'] - 1) * (0.10 + 2.6e-6 * canvas)
            t_anim = anim_sets * frames * (0.10 + 2.6e-6 * canvas)
        t_ink = 6.7e-6 * (sets * canvas + anim_sets * frames * (math.sqrt(rect) + 32) ** 2 * (0 if e['share'] >= 1 else 1)
                          + (anim_sets * frames * canvas if e['share'] >= 1 else 0))
        # atlas pixels at High (colour), shadows at Normal (R8), lights at quarter resolution
        if e['share'] >= 1.0:
            colour = anim_sets * frames * tr + e['dirs'] * e['variants'] * e['count'] * (e['states'] - 1) * tr
        else:
            colour = sets * tr + anim_sets * frames * rect
        shadow = e['dirs'] * e['variants'] * e['count'] * tr * 1.2 / 4
        light = (sets * tr / 16) if e['light'] else 0
        full_frames = sets * tr + (anim_sets * frames * tr if e['share'] < 1.0 else 0)
        rows.append(dict(id=e['id'], m=e['m'], sets=sets, frames=anim_sets * frames, colour_px=colour, full_px=full_frames,
                         shadow_px=shadow, light_px=light, t=t_base + t_shadow + t_anim + t_ink,
                         t_parts=(t_base, t_shadow, t_anim, t_ink)))
    return rows


def icons(m):
    items = 57 if m == 'm1' else 260
    techs = 23 if m == 'm1' else 245
    # items at 64, 32, 16 into the GPU icon array; technology icons (256 and 128) are DOM-only sheets
    t = items * 0.6 + techs * 1.2          # render_icons.py: about 0.6 s per item icon, 1.2 s at 256 px
    return dict(items=items, techs=techs, icon_px=items * (64 * 64 + 32 * 32 + 16 * 16),
                tech_px=techs * (256 * 256 + 128 * 128), t=t)


def summary(rows, m):
    sel = [r for r in rows if m == 'full' or r['m'] == 'm1']
    ic = icons(m)
    col = sum(r['colour_px'] for r in sel)
    sh = sum(r['shadow_px'] for r in sel)
    li = sum(r['light_px'] for r in sel)
    t = sum(r['t'] for r in sel) + ic['t']
    parts = [sum(r['t_parts'][k] for r in sel) for k in range(4)]
    pages_high = col / (PAGE * OCC)
    full = sum(r['full_px'] for r in sel)
    pages_normal = col / 4 / (PAGE * OCC)
    out = dict(milestone=m, sprite_sets=sum(r['sets'] for r in sel), anim_frames=sum(r['frames'] for r in sel),
               colour_mpx_high=round(col / 1e6, 1), shadow_mpx_normal=round(sh / 1e6, 1), light_mpx=round(li / 1e6, 2),
               icon_mpx=round(ic['icon_px'] / 1e6, 2), tech_icon_mpx=round(ic['tech_px'] / 1e6, 1),
               colour_pages_high=round(pages_high, 1), colour_mpx_if_full_frames=round(full / 1e6, 1), colour_pages_normal_1024=round(col / 4 / (1024 * 1024 * OCC), 1),
               render_hours_16threads=round(t / 3600, 2),
               render_parts_h={'base': round(parts[0] / 3600, 2), 'shadow': round(parts[1] / 3600, 2),
                               'anim': round(parts[2] / 3600, 2), 'ink': round(parts[3] / 3600, 2),
                               'icons': round(ic['t'] / 3600, 2)})
    # GPU (MiB): colour BC7 1 B/px with the High+Normal chain (x 4/3); shadows R8 1 B/px; lights BC7; icons BC7
    gb = lambda px, bpp: px * bpp / 2 ** 20
    out['gpu_mib'] = {
        'bc7_high': round(gb(col, 1) * 4 / 3 + gb(sh, 1) * 4 / 3 + gb(li, 1) * 4 / 3 + gb(ic['icon_px'], 1) * 4 / 3),
        'bc7_normal_only': round(gb(col / 4, 1) * 4 / 3 + gb(sh, 1) * 4 / 3 + gb(li, 1) * 4 / 3 + gb(ic['icon_px'], 1) * 4 / 3),
        'rgba8_high': round(gb(col, 4) * 4 / 3 + gb(sh, 1) * 4 / 3 + gb(li, 4) * 4 / 3 + gb(ic['icon_px'], 4) * 4 / 3),
        'rgba8_normal_only': round(gb(col / 4, 4) * 4 / 3 + gb(sh, 1) * 4 / 3 + gb(li, 4) * 4 / 3 + gb(ic['icon_px'], 4) * 4 / 3),
    }
    # download (MB): High level 0 and Normal levels as separate files
    dl = {}
    for fmt, (bh, bn) in BPP_DL.items():
        hi = col * bh / 8 / 1e6
        no = col / 4 * bn / 8 / 1e6 * (1 + 1 / 4 + 1 / 16)      # Normal file carries its own 3 levels
        sh_dl = sh * 0.65 / 8 / 1e6                               # shadows: ETC1S q255 measured 0.62 bpp per page (95% full)
        icon_dl = ic['icon_px'] * 3.0 / 8 / 1e6
        tech_dl = ic['tech_px'] * 1.3 / 8 / 1e6                   # technology icons as WebP q90 sheets (DOM)
        dom_dl = ic['items'] * (32 * 32 + 64 * 64) * 3.0 / 8 / 1e6 # CSS icon sheets, WebP lossless (~3 bpp)
        terr = (9 if m == 'm1' else 22) * 0.085                    # terrain materials, XUBC7 q90, 85 kB each
        dl[fmt] = dict(high_mb=round(hi, 1), normal_mb=round(no, 1), shadow_mb=round(sh_dl, 2),
                       icons_mb=round(icon_dl, 2), dom_icons_mb=round(dom_dl, 2), tech_icons_mb=round(tech_dl, 2),
                       terrain_mb=round(terr, 2),
                       total_mb=round(hi + no + sh_dl + icon_dl + dom_dl + tech_dl + terr, 1),
                       without_high_mb=round(no + sh_dl + icon_dl + dom_dl + tech_dl + terr, 1))
    out['download'] = dl
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', default=None)
    a = ap.parse_args()
    rows = model()
    res = [summary(rows, 'm1'), summary(rows, 'full')]
    for r in res:
        print(json.dumps(r, indent=1))
    top = sorted(rows, key=lambda r: -r['t'])[:12]
    print('largest render costs (h):', ', '.join(f"{r['id']} {r['t'] / 3600:.2f}" for r in top))
    topa = sorted(rows, key=lambda r: -r['colour_px'])[:12]
    print('largest atlas areas (Mpx High):', ', '.join(f"{r['id']} {r['colour_px'] / 1e6:.1f}" for r in topa))
    if a.json:
        json.dump(dict(summary=res, rows=rows), open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
