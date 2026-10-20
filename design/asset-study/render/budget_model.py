"""B2 asset budget model (10 §9.6): render time on this host, atlas pixels and pages, download and GPU memory,
for the M1 slice and the full game, from per-unit costs measured on this host (render_layers.py, A3's sprites)
and the texture formats measured by design/asset-study/texfmt/.

Version 2 (codex B2-r1 findings 3, 7, 13) counts what is allocated, not only content: sprites packed in 32-px
block-isolated cells with an 8-px gutter (+31% cell area, measured by pack_alignment.py; +42% for layer frames,
whose rectangles are small), a MaxRects fill of 0.874 (measured), pages rounded up per atlas group, every array
allocated once with all its levels (immutable storage) for each resolution mode, the other GPU allocations
(terrain, shadow and light targets, LUTs, glyphs, quads, the chart's bounded cache; the browser's framebuffer
listed apart), per-group downloads for the stage budget of §9.7, and render time including per-frame shadows of full-frame
and animShadow sets, packing and encoding.

    gamedev-python -I design/asset-study/render/budget_model.py [--json out.json]

Every sprite set is (directions x variants x states) static bases plus animated-layer frames; sizes follow the
calibration on A3's Survey sprites: trimmed colour area = 0.75 (w + 0.2)(h + H + 0.2) 64^2 px at High; the render
canvas is the rig's own (lib/rig.py Canvas: footprint plus margin plus the shadow's reach, 1.43 H east and 0.39 H
south, rounded out to half tiles), which validate_model.py checks against a complete build. Costs (seconds, 16
threads on socket 1):
  base passes (colour 16 spp, normal and aux 2x 1 spp, light 4 spp)  0.10 + 2.6e-6 x canvas px
  shadow pass, 64 spp, rendered at Normal resolution                0.05 + 12.5e-6 x canvas px (50e-6 at High)
  one animated-layer frame (colour, normal, aux inside the rectangle) 0.10 + 3.0e-6 x rectangle px
  ink pass (numpy, 2x passes)                                         6.7e-6 x px inked (the alpha bounding box plus 16 px)
"""

import argparse
import json
import math

PAGE = 2048 * 2048
CELL = 1.31                      # 32-px cells with an 8-px gutter: +31% over the trimmed sprites (pack_alignment.py)
FILL = 0.874                     # MaxRects fill of a 2048^2 page by cells (make_pages.py: 0.857 at +2% cells)
OCC = 1 / CELL * FILL            # sprite pixels per page pixel: 0.67
BPP_DL = {'xubc7-q90': (2.33, 3.06), 'webp-q90': (1.20, 1.86)}   # bits per content px: High, Normal (measured)


def trimmed(w, h, H):
    return 0.75 * (w + 0.2) * (h + H + 0.2) * 4096


def canvas_px(w, h, H, margin=0.5):
    """The rig's render canvas at High (design/art/proto/lib/rig.py Canvas, shadow on)."""
    lo, hi = (lambda v: math.floor(v * 2) / 2), (lambda v: math.ceil(v * 2) / 2)
    xw = hi(w / 2 + margin + H * 0.80 / 0.56) - lo(-w / 2 - margin)
    yh = hi(h / 2 + H + margin) - lo(-h / 2 - margin - H * 0.22 / 0.56)
    return xw * yh * 4096


INK_SHARE = 0.27                 # the passes' bounding box plus 16 px, 8-px aligned, over the canvas: 0.27 (ink_locality_check.py --bbox)
CELL_LAYER = 1.42                # layer frames' cells over R: measured on the complete prototype build (R is small)


# (id, w, h, height, dirs, variants, states, frames, anim_share, light, milestone, count)
#  anim_share: animated rectangle / trimmed area; 1.0 = full-frame animation (belts, the character)
#  states: 2 when an idle variant differs (emitters dark); count: number of such sprite sets
E = []


def add(i, w, h, H, dirs=1, variants=1, states=1, frames=0, share=0.25, light=False, m='full', count=1, g=None,
        anim_shadow=False, margin=0.5):
    E.append(dict(id=i, w=w, h=h, H=H, dirs=dirs, variants=variants, states=states, frames=frames, share=share,
                  light=light, m=m, count=count, g=g, anim_shadow=anim_shadow, margin=margin))


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
add('steam-engine', 3, 5, 2.45, dirs=2, frames=16, share=0.40, m='m1', margin=0.6)
add('solar-panel', 3, 3, 0.5, m='m1')
add('small-electric-pole', 1, 1, 3.0, m='m1', margin=0.6)
add('medium-electric-pole', 1, 1, 4.5, m='m1', margin=0.6)
add('big-electric-pole', 2, 2, 7.0, m='m1', margin=0.6)
for t in ('transport-belt', 'fast-transport-belt'):
    add(t, 1, 1, 0.26, variants=20, frames=16, share=1.0, m='m1', margin=0.25)   # 4 straight, 8 curves, 8 caps
for t in ('underground-belt', 'fast-underground-belt'):
    add(t, 1, 1, 0.6, dirs=4, variants=2, m='m1')
for t in ('splitter', 'fast-splitter'):
    add(t, 2, 1, 0.8, dirs=4, frames=16, share=0.6, m='m1')
for t in ('burner-inserter', 'inserter', 'long-handed-inserter', 'fast-inserter'):
    add(t, 1, 1, 0.75, variants=7, m='m1', margin=1.6 if t == 'long-handed-inserter' else 0.6)   # §15.7: platform x4, arm, hand open, hand closed
for t in ('wooden-chest', 'iron-chest', 'steel-chest'):
    add(t, 1, 1, 0.85, m='m1', margin=0.4)
add('pipe', 1, 1, 0.55, variants=16, m='m1', margin=0.3)
add('pipe-to-ground', 1, 1, 0.6, dirs=4, m='m1')
add('radar', 3, 3, 3.0, frames=64, share=0.5, m='m1', anim_shadow=True)
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
add('heat-pipe', 1, 1, 0.3, variants=16, light=True, margin=0.3)
add('heat-exchanger', 3, 2, 2.2, dirs=4, light=True)
add('substation', 2, 2, 5.0)
add('express-transport-belt', 1, 1, 0.26, variants=20, frames=16, share=1.0, margin=0.25)
add('express-underground-belt', 1, 1, 0.6, dirs=4, variants=2)
add('express-splitter', 2, 1, 0.8, dirs=4, frames=16, share=0.6)
add('bulk-inserter', 1, 1, 0.75, variants=7, margin=0.6)
for t in ('active-provider', 'passive-provider', 'storage', 'buffer', 'requester'):
    add(t + '-chest', 1, 1, 0.9, frames=7, share=0.5)
add('pump', 1, 2, 1.0, dirs=4, frames=32, share=0.3)
add('repeater', 1, 2, 1.0, dirs=4, frames=32, share=0.3)
add('storage-tank', 3, 3, 2.5, dirs=2)
add('data-lake', 3, 3, 2.5, dirs=2)
add('data-line', 1, 1, 0.4, variants=16, margin=0.3)
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
add('fence', 1, 1, 1.2, variants=16, margin=0.3)
add('gate', 1, 1, 1.2, dirs=2, frames=16, share=0.5)
add('land-mine', 1, 1, 0.2)
add('deployer', 1, 1, 1.0)
# --- world, characters, movers ---
add('tree', 1, 1, 4.6, variants=12, states=5, m='m1', g='core', margin=1.6)   # the start biome's 3 species x 4 shapes x 5 leaf states (4 left .. bare)
add('tree-other', 1, 1, 4.6, variants=28, states=5, m='m1', g='biomes', margin=1.6)   # the other 7 species
add('rock', 2, 2, 1.3, variants=12, m='m1', g='core', margin=0.4)
add('resource', 1, 1, 0.3, variants=48, m='m1', count=6, g='core', margin=0.25)  # 6 shapes x 8 depletion bands, 6 slice resources
add('resource-late', 1, 1, 0.3, variants=48, count=2, g='article', margin=0.25)
add('decorative', 1, 1, 0.5, variants=4, m='m1', count=15, g='core', margin=0.3)
add('campus', 8, 8, 6.5, variants=1, m='m1', g='core', margin=0.3)         # skin 1
add('campus-2', 8, 8, 6.5, variants=1, m='m1', g='town-2', margin=0.3)      # skin 2 (09 §9)
add('campus-late', 8, 8, 6.5, variants=3, g='town-3+', margin=0.3)
add('landmark', 3, 3, 3.0, variants=2, m='m1', count=3, g='core')    # exchange office, mine entrance, salvage
add('town-block', 6, 6, 6.0, variants=8, m='m1', g='core', margin=0.3)    # skin 1, 8 variants
add('town-block-2', 6, 6, 6.0, variants=8, m='m1', g='town-2', margin=0.3)  # skin 2 (09 §9)
add('town-block-late', 6, 6, 8.0, variants=8, count=3, g='town-3+', margin=0.3)
add('cliff', 4, 2, 2.0, variants=40, g='article')
add('character', 1, 1, 1.85, dirs=8, variants=1, frames=36, share=1.0, m='m1', g='core', anim_shadow=True)  # run 16, mine 16, idle 4
add('agent', 1, 1, 0.6, dirs=16, frames=2, share=1.0, count=2, g='preprint', anim_shadow=True)




def data_techs():
    """Entity id -> the technology whose recipe makes the item that places it."""
    import os
    import yaml
    D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'spec', 'data')
    items = yaml.safe_load(open(os.path.join(D, 'items.yaml')))
    techs = yaml.safe_load(open(os.path.join(D, 'technologies.yaml')))
    recipes = yaml.safe_load(open(os.path.join(D, 'recipes.yaml')))
    rec_tech = {}
    for t in techs:
        for r in t.get('unlocks', {}).get('recipes', []) or []:
            rec_tech.setdefault(r, t['id'])
    item_tech = {}
    for r in recipes:
        for p in r.get('products', []):
            if r['id'] in rec_tech:
                item_tech.setdefault(p['id'], rec_tech[r['id']])
    return {it['places']: item_tech.get(it['id'], 'prior-art') for it in items if it.get('places')}


def data_groups():
    """Entity id -> atlas group: 'core' for the start's buildings (recipes unlocked by Prior art), else the tier of
    the item that places the entity (items.yaml)."""
    import os
    import yaml
    D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'spec', 'data')
    items = {x['id']: x for x in yaml.safe_load(open(os.path.join(D, 'items.yaml')))}
    techs = yaml.safe_load(open(os.path.join(D, 'technologies.yaml')))
    recipes = yaml.safe_load(open(os.path.join(D, 'recipes.yaml')))
    start = set()
    for t in techs:
        if t['id'] == 'prior-art':
            start = set(t.get('unlocks', {}).get('recipes', []))
    start_items = {p['id'] for r in recipes if r['id'] in start for p in r.get('products', [])}
    out = {}
    for it in items.values():
        if it.get('places'):
            out[it['places']] = 'core' if it['id'] in start_items else it.get('tier', 'memo')
    return out


TIERS = ['core', 'memo', 'report', 'article', 'proceedings', 'preprint', 'model-card', 'system-card']


def model():
    groups = data_groups()
    rows = []
    for e in E:
        tr = trimmed(e['w'], e['h'], e['H'])
        canvas = canvas_px(e['w'], e['h'], e['H'], e['margin'])
        sets = e['dirs'] * e['variants'] * e['states'] * e['count']
        anim_sets = e['dirs'] * e['variants'] * e['count']
        rect = e['share'] * tr
        frames = e['frames']
        full_frame = e['share'] >= 1.0
        # render time (s): frame 0 in full per (dir, variant, state); layers inside R; shadows at Normal
        t_base = sets * (0.10 + 2.6e-6 * canvas)
        shadows = e['dirs'] * e['variants'] * e['count'] * (frames if (e['anim_shadow'] and frames) else 1)
        t_shadow = shadows * (0.05 + 12.5e-6 * canvas)
        t_anim = anim_sets * frames * (0.10 + (2.6e-6 * canvas if full_frame else 3.0e-6 * rect))
        if full_frame:
            t_base = e['dirs'] * e['variants'] * e['count'] * max(0, e['states'] - 1) * (0.10 + 2.6e-6 * canvas)
        # ink: the colour's alpha bounding box plus 16 px (INK_SHARE of the canvas), and R plus 16 px per layer frame
        t_ink = 6.7e-6 * (sets * canvas * INK_SHARE + anim_sets * frames * (canvas * INK_SHARE if full_frame else (math.sqrt(rect) + 32) ** 2))
        # atlas content at High
        if full_frame:
            colour = anim_sets * frames * tr + e['dirs'] * e['variants'] * e['count'] * max(0, e['states'] - 1) * tr
            cells = colour * CELL
        else:
            colour = sets * tr + anim_sets * frames * rect
            cells = sets * tr * CELL + anim_sets * frames * rect * CELL_LAYER
        shadow = shadows * tr * 1.2 / 4
        light = (sets * tr / 16) if e['light'] else 0
        full_px = sets * tr + (anim_sets * frames * tr if not full_frame else 0)
        g = e['g'] or groups.get(e['id'], 'memo')
        rows.append(dict(id=e['id'], m=e['m'], g=g, sets=sets, frames=anim_sets * frames, colour_px=colour, cell_px=cells,
                         full_px=full_px, shadow_px=shadow, light_px=light, shadows=shadows,
                         t=t_base + t_shadow + t_anim + t_ink, t_parts=(t_base, t_shadow, t_anim, t_ink)))
    return rows


def capped_groups(rows, cap_mb=3.0):
    """Split each tier into groups of at most cap_mb of Normal-level download, by unlocking technology: technologies
    are merged greedily in data order; a technology above the cap is split by entity."""
    techs = data_techs()
    normal_mb = lambda px: px / 4 * 3.06 / 8 * (1 + 1 / 4 + 1 / 16) / 1e6 + px * 1.2 / 16 * 0.65 / 8 / 1e6
    out = []
    by_tier = {}
    for r in rows:
        by_tier.setdefault(r['g'], {}).setdefault(techs.get(r['id'], r['g']), []).append(r)
    for tier, tmap in by_tier.items():
        cur, cur_mb = [], 0.0
        for tech, rs in tmap.items():
            mb = sum(normal_mb(r['colour_px']) for r in rs)
            if mb > cap_mb:
                for r in rs:
                    out.append((tier, tech, [r['id']], normal_mb(r['colour_px'])))
                continue
            if cur_mb + mb > cap_mb and cur:
                out.append((tier, 'merged', cur, cur_mb))
                cur, cur_mb = [], 0.0
            cur += [r['id'] for r in rs]
            cur_mb += mb
        if cur:
            out.append((tier, 'merged', cur, cur_mb))
    return out


def pages(px, page_px):
    return math.ceil(px * CELL / (page_px * FILL)) if px > 0 else 0


def cell_pages(cell_px, page_px):
    return math.ceil(cell_px / (page_px * FILL)) if cell_px > 0 else 0


def summary(rows, m):
    sel = [r for r in rows if m == 'full' or r['m'] == 'm1']
    items = 57 if m == 'm1' else 230
    techs = 23 if m == 'm1' else 251
    icon_px = items * 64 * 64                       # one 64 px frame per icon; 32 and 16 are its levels
    groups = {}
    for r in sel:
        G = groups.setdefault(r['g'], dict(colour=0.0, cells=0.0, shadow=0.0, light=0.0))
        G['colour'] += r['colour_px']
        G['cells'] += r['cell_px']
        G['shadow'] += r['shadow_px']
        G['light'] += r['light_px']
    colour_pages = sum(cell_pages(G['cells'], PAGE) for G in groups.values())
    shadow_pages = sum(pages(G['shadow'], 1024 * 1024) for G in groups.values())
    light_pages = max(1, sum(pages(G['light'], 512 * 512) for G in groups.values()))
    icon_pages = max(1, pages(icon_px, 1024 * 1024))
    slab = lambda n: n               # 10 §6.13: each array is allocated once, at load, with the manifest's page count
    MB = 2 ** 20
    lv = lambda side, bpp, first, last=3: sum((side >> k) ** 2 * bpp for k in range(first, last + 1))  # bytes, levels first..last
    terrain_n = 9 if m == 'm1' else 22
    # 10 §6.13's modes: what is allocated (immutable storage: every level of every layer of every slab)
    #   high:   colour levels 0-3, shadows (32 px per tile) levels 0-2, lights, icons, terrain
    #   normal: colour levels 1-3, shadows levels 1-2 (16 px per tile; the shadow target is half resolution)
    #   low:    the RGBA8 fallback: colour levels 2-3, shadows levels 1-2 as R8, lights and icons as RGBA8
    def atlas(mode, bpp_c, bpp_s):
        c0 = {'high': 0, 'normal': 1, 'low': 2}[mode]
        s0 = 0 if mode == 'high' else 1
        return (slab(colour_pages) * lv(2048, bpp_c, c0) + slab(shadow_pages) * lv(1024, bpp_s, s0, 2)
                + slab(light_pages) * lv(512, bpp_c, 0, 1) + slab(icon_pages) * lv(1024, bpp_c, 0, 2)
                + terrain_n * lv(512, bpp_c, 0 if mode == 'high' else 1)) / MB
    gpu = {'high_bc7': round(atlas('high', 1, 0.5)), 'normal_bc7': round(atlas('normal', 1, 0.5)),
           'low_rgba8': round(atlas('low', 4, 1)), 'normal_rgba8': round(atlas('normal', 4, 1)),
           'high_rgba8': round(atlas('high', 4, 1))}
    # other GPU allocations at a 1920x1080 CSS-px window, dpr 1 and dpr 2
    fb = 1920 * 1080
    other = {
        'light_target_rgba16f_half': (fb / 4 * 8 / MB, fb * 8 / MB),
        'shadow_target_r8_half': (fb / 4 / MB, fb / MB),
        'quads_2x100k_and_index': ((2 * 100000 * 4 * 20 + 65536 * 6 * 4) / MB,) * 2,
        'luts_glyphs_chunk_textures': (2.3 + 0.35 + 2.8, 2.3 + 0.35 + 2.8),
        'chart_cache_2_layers_rgba8_with_levels': (2 * lv(2048, 4, 0, 11) / MB,) * 2,
    }
    browser = {'default_framebuffer_x3': (fb * 4 * 3 / MB, fb * 4 * 4 * 3 / MB)}
    charted = 2000 if m == 'm1' else 30000
    chart = math.ceil(charted / 4096) * 2048 * 2048 * 4 / MB     # v1 of §6.10: every charted chunk on the GPU
    totals = {mode: [round(gpu[mode] + sum(v[i] for v in other.values())) for i in (0, 1)] for mode in gpu}
    # downloads per group: Normal levels (colour 3.06 bits per content px at Normal, 3 levels), shadows (ETC1S),
    # icons and DOM sheets by tier (approximated by the group's share of colour), terrain for core
    dl = {}
    tot_colour = sum(G['colour'] for G in groups.values())
    for g, G in groups.items():
        share = G['colour'] / tot_colour
        normal = G['colour'] / 4 * 3.06 / 8 * (1 + 1 / 4 + 1 / 16)
        high = G['colour'] * 2.33 / 8
        sh = G['shadow'] * 0.65 / 8
        icons = icon_px * share * 3.0 / 8 * (1 + 1 / 4 + 1 / 16) + items * share * (32 * 32 + 64 * 64) * 3.0 / 8
        terr = 9 * 85e3 if g == 'core' else 0
        dl[g] = dict(pages=cell_pages(G['cells'], PAGE), normal_mb=round((normal + sh + icons + terr) / 1e6, 2),
                     high_mb=round(high / 1e6, 2))
    cg = capped_groups(sel)
    capped = dict(count=len(cg), max_mb=round(max(x[3] for x in cg), 2),
                  over_cap=[(x[0], x[2]) for x in cg if x[3] > 3.0])
    t = sum(r['t'] for r in sel)
    parts = [sum(r['t_parts'][k] for r in sel) for k in range(4)]
    t_icons = items * 0.6 + techs * 1.2
    t_pack_encode = colour_pages * (2.0 + 3.1 + 1.0) + shadow_pages * (0.5 + 0.6) + icon_pages * 1.5
    return dict(milestone=m, sprite_sets=sum(r['sets'] for r in sel), anim_frames=sum(r['frames'] for r in sel),
                shadows=sum(r['shadows'] for r in sel), colour_mpx_high=round(tot_colour / 1e6, 1),
                colour_mpx_if_full_frames=round(sum(r['full_px'] for r in sel) / 1e6, 1),
                pages=dict(colour=colour_pages, shadow=shadow_pages, light=light_pages, icon=icon_pages),
                gpu_atlas_and_terrain_mb=gpu, gpu_other_mb={k: [round(v, 1) for v in vs] for k, vs in other.items()},
                gpu_total_mb_dpr1_dpr2=totals, browser_framebuffer_mb=[round(v, 1) for v in browser['default_framebuffer_x3']],
                gpu_chart_unbounded_mb=round(chart), capped_groups=capped, groups=dict(sorted(dl.items(), key=lambda kv: (TIERS + ['town-2', 'town-3+', 'biomes']).index(kv[0]) if kv[0] in TIERS + ['town-2', 'town-3+', 'biomes'] else 99)),
                render_hours=round((t + t_icons + t_pack_encode) / 3600, 2),
                render_parts_h={'base': round(parts[0] / 3600, 2), 'shadow': round(parts[1] / 3600, 2),
                                'layers': round(parts[2] / 3600, 2), 'ink': round(parts[3] / 3600, 2),
                                'icons': round(t_icons / 3600, 2), 'pack_encode': round(t_pack_encode / 3600, 2)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', default=None)
    a = ap.parse_args()
    rows = model()
    res = [summary(rows, 'm1'), summary(rows, 'full')]
    for r in res:
        print(json.dumps(r, indent=1))
    if a.json:
        json.dump(dict(summary=res, rows=rows), open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
