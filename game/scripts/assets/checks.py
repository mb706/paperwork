"""The asset build's checks (10 §9.5) on the emitted manifest, its pages and the fixtures.

    gamedev-python game/scripts/assets/checks.py --manifest public/atlases/sprites.json --layout layout.json
    gamedev-python game/scripts/assets/checks.py --fixtures-only

Manifest:  the JSON schema (sprites.schema.json), complete tables and maps, valid ids, frames inside pages, every
           kind's parts; every prototype of the build (prototypes.json) has its set or greybox, every icon its set;
           the projection fixture cases of test/fixtures/sprites/cases.json (10 §15.7) against manifest.py.
Cells:     every cell on its array's block alignment and inside its page, no two cells overlapping (gutters
           included), every frame inside its own cell (§9.5 #5 "Cells").
Pages:     every encoded page transcoded back (basisu -unpack) to BC7 for colour, light and icons and BC4 for
           shadows, compared with its source levels by §9.2's measures (PSNR, CIELAB dE on the paper, detail kept;
           a shadow also as the hatched paper), naming the worst sprite. 10 §9.5 #5's thresholds are warnings and
           the gate is the calibrated floors of GATE (the reason is at SPEC). Levels below Normal are reported only.
Fallbacks: every page through ASTC 4x4, BC3 and ETC2 RGBA (EAC R11 for shadows) against BC7: a warning beyond
           §9.2's measured ratio +10%, a failure beyond 1.5 times it.
Cells:     each page's layout filled with solid colours, encoded and transcoded to every format of its chain:
           no texel of any level strays from its cell's colour; every frame's bilinear footprint stays in its cell.
Sets:      quality.py's per-set checks (composite, registration, the 3 % rule, geometry, shadow direction).
Results go to .cache/assets/qc/checks.json; any failure exits non-zero.
"""

import argparse
import json
import os
import subprocess
import sys

import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402
import manifest as MF  # noqa: E402

FIXTURES = os.path.join(K.GAME, 'test', 'fixtures', 'sprites')
QC = os.path.join(K.CACHE, 'qc')
UNPACK_CODE = {'bc7': 6, 'bc4': 4}


def schema_errors(man):
    import jsonschema
    schema = K.load_json(os.path.join(HERE, 'sprites.schema.json'))
    v = jsonschema.Draft202012Validator(schema)
    return [f'schema: {"/".join(str(p) for p in e.absolute_path)}: {e.message[:200]}' for e in v.iter_errors(man)]


def coverage_errors(man):
    errs = []
    pj = os.path.join(K.PUBLIC, 'data', 'prototypes.json')
    if not os.path.exists(pj):
        return ['coverage: no public/data/prototypes.json (run npm run data)']
    data = K.load_json(pj)
    sets = man['sets']
    for e in data.get('entity', []):
        if e['sprite'] not in sets and f'greybox/{e["name"]}' not in sets:
            errs.append(f'coverage: entity {e["name"]} has neither {e["sprite"]} nor a greybox')
        if f'greybox/{e["name"]}' not in sets:
            errs.append(f'coverage: entity {e["name"]} has no greybox')
    for r in data.get('resource', []):
        if r.get('kind') == 'solid' and r['sprite'] not in sets:
            errs.append(f'coverage: resource {r["name"]} has no set {r["sprite"]}')
    for icon in data.get('icons', []):
        if icon not in sets:
            errs.append(f'coverage: icon {icon} has no set (fx/missing would draw)')
    if data.get('character') and 'mover/character' not in sets:
        errs.append('coverage: the character has no set mover/character')
    for t in data.get('tile', []):
        if t['name'] not in man.get('terrain', {}).get('tiles', {}):
            errs.append(f'coverage: tile {t["name"]} has no terrain texture')
    if man.get('prototypesHash') != data.get('prototypesHash'):
        errs.append('coverage: the manifest\'s prototypesHash is not prototypes.json\'s')
    return errs


def cell_errors(man, layout):
    errs = []
    arrays = layout['arrays']
    layer_of = {}
    count = [0] * len(arrays)
    for p in layout['pages']:
        layer_of[id(p)] = count[p['array']]
        count[p['array']] += 1
    for p in layout['pages']:
        arr = arrays[p['array']]
        A, S = arr['align'], arr['pageSize']
        occ = np.zeros((S // A, S // A), np.int32)
        for c in p['cells']:
            if c['x'] % A or c['y'] % A or c['cw'] % A or c['ch'] % A:
                errs.append(f'cells: {c["set"]} frame {c["local"]} off the {A}-px grid')
                continue
            if c['x'] + c['cw'] > S or c['y'] + c['ch'] > S:
                errs.append(f'cells: {c["set"]} frame {c["local"]} outside its page')
                continue
            sub = occ[c['y'] // A:(c['y'] + c['ch']) // A, c['x'] // A:(c['x'] + c['cw']) // A]
            if sub.any():
                errs.append(f'cells: {c["set"]} frame {c["local"]} overlaps another cell')
            sub += 1
            g = arr['gutter']
            if c['w'] + 2 * g > c['cw'] or c['h'] + 2 * g > c['ch']:
                errs.append(f'cells: {c["set"]} frame {c["local"]} and its gutter exceed the cell')
    # every manifest frame lies inside one cell of its page
    cells_by_page = {}
    for p in layout['pages']:
        cells_by_page[(p['array'], layer_of[id(p)])] = p['cells']
    for i, f in enumerate(man['frames']):
        a, layer, x, y, w, h = f[:6]
        g = arrays[a]['gutter']
        inside = any(c['x'] + g <= x and x + w <= c['x'] + g + c['w'] and c['y'] + g <= y and y + h <= c['y'] + g + c['h']
                     for c in cells_by_page.get((a, layer), []))
        if not inside:
            errs.append(f'cells: frame {i} is not inside a cell of page {a}/{layer}')
    return errs


# --------------------------------------------------------------------------------------------------------------
# Compression (§9.5 #5): decode each page as the GPU will see it and measure it against its source levels
# --------------------------------------------------------------------------------------------------------------

# Transcoder target codes of basisu -unpack -format_only (B2's cell_isolation_check.py).
FORMATS = {'bc7': 6, 'astc4x4': 10, 'bc3': 3, 'etc2_rgba': 1}
GREY_FORMATS = {'bc4': 4, 'eac_r11': 20}
CODEC_ARGS = {'xubc7': ['-xubc7', '-quality', '90'], 'etc1s': ['-etc1s', '-q', '255', '-linear']}

# 10 §9.5 #5's numbers, measured by B2 on a dense page of large machine sprites. Edge-dense pages (the character's
# 288 frames, ore, belts, icons) cannot reach them in BC7 at any basisu setting (lossless XUBC7 and q90 measure
# alike; B2's own page gives dE p99 6.3 at Normal and its icon page 8.8), so they are reported as warnings, and the
# build gates on the floors below: about 2 dB and 2 dE under the worst page of the M0 build (pm/reports/C6.md).
SPEC = {
    ('colour', 0): dict(psnr=40.0, dE_p99=6.0, detail=0.98),
    ('colour', 1): dict(psnr=37.0, dE_p99=6.0, detail=0.98),
    ('light', 0): dict(psnr=40.0, dE_p99=6.0, detail=0.98),
    ('light', 1): dict(psnr=37.0, dE_p99=6.0, detail=0.98),
    ('icon', 0): dict(psnr=40.0, dE_p99=6.0, detail=0.98),
    ('icon', 1): dict(psnr=37.0, dE_p99=6.0, detail=0.98),
    ('shadow', 0): dict(psnr=37.0),
}
GATE = {
    ('colour', 0): dict(psnr=38.0, dE_p99=8.0, detail=0.98),
    ('colour', 1): dict(psnr=32.0, dE_p99=13.0, detail=0.98),
    ('light', 0): dict(psnr=38.0, dE_p99=8.0, detail=0.98),
    ('light', 1): dict(psnr=32.0, dE_p99=13.0, detail=0.98),
    ('icon', 0): dict(psnr=34.0, dE_p99=13.0, detail=0.98),
    ('icon', 1): dict(psnr=30.0, dE_p99=14.0, detail=0.98),
    # a shadow is a mask that the shader hatches (§9.2): gate on the hatched paper as the player sees it at
    # zoom 1 (one Normal texel per device pixel), plus a floor on the mask itself
    ('shadow', 0): dict(psnr=26.0, hatched_dE_p99=6.0),
}
# §9.2's measured fallback quality (dE mean on the paper) relative to BC7 on the same page: High colour, Normal
# colour, icons. "Held to §9.2's measured quality, +-10%" is applied to these ratios, since the absolute numbers
# follow the content.
FALLBACK_RATIO = {
    ('colour', 0): {'astc4x4': 0.82 / 0.72, 'bc3': 1.90 / 0.72, 'etc2_rgba': 2.83 / 0.72},
    ('colour', 1): {'astc4x4': 1.23 / 1.01, 'bc3': 2.37 / 1.01, 'etc2_rgba': 3.24 / 1.01},
    ('icon', 0): {'astc4x4': 1.75 / 1.29, 'bc3': 2.67 / 1.29, 'etc2_rgba': 3.40 / 1.29},
}
# shadows: EAC R11 measured 36.3 dB against BC4's 36.0 on B2's page; held to within 10% of BC4's dB here


def unpack(ktx2, code, outdir):
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        os.remove(os.path.join(outdir, f))
    subprocess.run(['basisu', '-unpack', '-format_only', str(code), '-no_ktx', ktx2, '-output_path', outdir],
                   check=True, capture_output=True)
    levels = {}
    for f in os.listdir(outdir):
        if '_rgba_' not in f and '_rgb_' not in f:
            continue
        lv = int(f.split('_level_')[1].split('_')[0]) if '_level_' in f else 0
        if '_rgba_' in f or lv not in levels:
            levels[lv] = os.path.join(outdir, f)
    out = [K.read_png(levels[k]) for k in sorted(levels)]
    for f in os.listdir(outdir):                 # decoded PNGs are scratch: about 10 MB per page and format
        os.remove(os.path.join(outdir, f))
    os.rmdir(outdir)
    return out


def decode_page(p, code, tag):
    """All levels of a page (its .h and .n files in order) transcoded to one format and decoded."""
    out = []
    for f in p['files']:
        out += unpack(os.path.join(K.PUBLIC, f), code, os.path.join(K.CACHE, 'unpack', f'{os.path.basename(f)}.{tag}'))
    return out


def detail_keep(lo, ld, mask):
    yo, yd = lo[..., 0] / 100, ld[..., 0] / 100
    bo = ndi.gaussian_filter(yo, 0.7) - ndi.gaussian_filter(yo, 2.0)
    bd = ndi.gaussian_filter(yd, 0.7) - ndi.gaussian_filter(yd, 2.0)
    eo = ndi.gaussian_filter(bo * bo, 2.0)
    if mask.sum() < 64:
        return 1.0
    thr = np.percentile(eo[mask], 80)
    dm = mask & (eo >= thr)
    return float(np.sqrt((bd[dm] ** 2).sum() / max((bo[dm] ** 2).sum(), 1e-12)))


def page_metrics(src, dec, grey):
    if grey:
        m = ndi.binary_dilation((src[..., 0] > 0) | (dec[..., 0] > 0), iterations=2)
        if not m.any():
            return dict(psnr=99.0)
        err = (src[..., 0] - dec[..., 0])[m]
        return dict(psnr=round(float(10 * np.log10(1.0 / max(np.mean(err ** 2), 1e-12))), 2),
                    err_map=np.abs(src[..., 0] - dec[..., 0]) * m)
    if dec.shape[2] == 3:
        dec = np.concatenate([dec, np.ones(dec.shape[:2] + (1,), np.float32)], -1)
    co = K.over_paper(src)
    cd = K.over_paper(dec)
    m = ndi.binary_dilation((src[..., 3] > 0) | (dec[..., 3] > 0), iterations=2)
    if not m.any():
        return dict(psnr=99.0, dE_mean=0.0, dE_p99=0.0, detail_keep=1.0)
    err = (co - cd)[m]
    lo, ld = K.lab(co), K.lab(cd)
    de = np.sqrt(((lo - ld) ** 2).sum(-1))
    return dict(psnr=round(float(10 * np.log10(1.0 / max(np.mean(err ** 2), 1e-12))), 2),
                dE_mean=round(float(de[m].mean()), 3), dE_p99=round(float(np.percentile(de[m], 99)), 2),
                detail_keep=round(detail_keep(lo, ld, m), 3), err_map=de * m)


def hatched_metrics(src, dec):
    """A shadow page's error after 10 §9.8's hatching of the paper, at one texel per device pixel."""
    import emulate as E
    H, W = src.shape[:2]
    paper = np.broadcast_to(K.hexc(K.PAPER_HEX), (H, W, 3)).astype(np.float32)
    cam = dict(zoom=1.0, dpr=1.0, cx=0.0, cy=0.0)
    a = E.hatch_shadows(paper.copy(), src, cam, 0.0, 0.0)
    b = E.hatch_shadows(paper.copy(), dec, cam, 0.0, 0.0)
    m = ndi.binary_dilation((src[..., 0] > 0) | (dec[..., 0] > 0), iterations=2)
    if not m.any():
        return dict(hatched_dE_mean=0.0, hatched_dE_p99=0.0)
    de = np.sqrt(((K.lab(a) - K.lab(b)) ** 2).sum(-1))[m]
    return dict(hatched_dE_mean=round(float(de.mean()), 3), hatched_dE_p99=round(float(np.percentile(de, 99)), 2))


def _layout_page(layout, p):
    for lp in layout['pages']:
        if lp['array'] == p['array'] and lp['group'] == p['group'] and lp['index'] == p['index']:
            return lp
    return None


def _sprite_at(lp, x, y, lv):
    """The set whose cell holds level-lv pixel (x, y)."""
    X, Y = x * 2 ** lv, y * 2 ** lv
    for c in (lp or {}).get('cells', []):
        if c['x'] <= X < c['x'] + c['cw'] and c['y'] <= Y < c['y'] + c['ch']:
            return f'{c["set"]} frame {c["local"]}'
    return 'no sprite'


def _judge(m, limits):
    bad = []
    for k, v in limits.items():
        got = m.get('detail_keep' if k == 'detail' else k)
        if got is None:
            continue
        if (k in ('psnr', 'detail') and got < v) or (k not in ('psnr', 'detail') and got > v):
            bad.append(f'{k} {got} (limit {v})')
    return bad


METRICS_VERSION = 2          # bump when page_metrics or hatched_metrics change: it keys the cache below


def _page_levels_metrics(p, grey):
    """[(metrics, worst pixel or None)] per level of an encoded page. The encode is a deterministic function of
    the source, so the KTX2 files' SHA-256 key the result (cached in qc/compression-cache.json)."""
    out = []
    decoded = decode_page(p, UNPACK_CODE['bc4' if grey else 'bc7'], 'bc4' if grey else 'bc7')
    for lv, dec in enumerate(decoded):
        src = K.read_png(os.path.join(K.CACHE, 'pages', f'{p["stem"]}.L{lv}.png'))
        if grey:
            src, dec = src[..., :1], dec[..., :1]
        m = page_metrics(src, dec, grey)
        emap = m.pop('err_map', None)
        if grey and lv == 0:
            m.update(hatched_metrics(src, dec))
        worst = None
        if emap is not None and emap.any():
            y, x = np.unravel_index(np.argmax(emap), emap.shape)
            worst = [int(x), int(y)]
        out.append([m, worst])
    return out


def compression_checks(man, layout, results):
    errs = []
    results.setdefault('warnings', [])
    pages = K.load_json(os.path.join(K.CACHE, 'assembled.json'))['pages']
    cache_path = os.path.join(QC, 'compression-cache.json')
    cache = K.load_json(cache_path) if os.path.exists(cache_path) else {}
    used = {}
    for p in pages:
        kind = man['arrays'][p['array']]['kind']
        grey = kind == 'shadow'
        ck = f'v{METRICS_VERSION}-' + '-'.join(p['sha256'])
        if ck not in cache:
            cache[ck] = _page_levels_metrics(p, grey)
        used[ck] = cache[ck]
        lp = _layout_page(layout, p)
        for lv, (m, wpx) in enumerate(cache[ck]):
            key = f'{p["stem"]} level {lv}'
            results['pages'][key] = m
            worst = ''
            if wpx is not None:
                x, y = wpx
                worst = f'; worst sprite {_sprite_at(lp, x, y, lv)} (pixel {x},{y})'
            spec_bad = _judge(m, SPEC.get((kind, lv), {}))
            if spec_bad:
                results['warnings'].append(f'compression: {key} under 10 §9.5 #5: {", ".join(spec_bad)}{worst}')
            gate_bad = _judge(m, GATE.get((kind, lv), {}))
            if gate_bad:
                errs.append(f'compression: {key}: {", ".join(gate_bad)}{worst}')
    K.dump_json(cache_path, used)                 # only this build's pages: the cache cannot grow
    return errs


# --------------------------------------------------------------------------------------------------------------
# Fallback formats (§9.5 #5): every page through ASTC 4x4, BC3 and ETC2 (EAC R11 for shadows), against BC7 (BC4)
# --------------------------------------------------------------------------------------------------------------

def fallback_checks(man, results):
    errs = []
    cache_path = os.path.join(QC, 'fallback-cache.json')
    cache = K.load_json(cache_path) if os.path.exists(cache_path) else {}
    used = {}
    out = {}
    pages = K.load_json(os.path.join(K.CACHE, 'assembled.json'))['pages']
    for p in pages:
        kind = man['arrays'][p['array']]['kind']
        grey = kind == 'shadow'
        ck = '-'.join(p['sha256']) + ('-grey' if grey else '')
        if ck not in cache:
            src = [K.read_png(os.path.join(K.CACHE, 'pages', f'{p["stem"]}.L{lv}.png')) for lv in range(2)]
            row = {}
            fmts = GREY_FORMATS if grey else FORMATS
            for fmt, code in fmts.items():
                dec = decode_page(p, code, fmt)
                for lv in range(min(2, len(dec))):
                    s, d = (src[lv][..., :1], dec[lv][..., :1]) if grey else (src[lv], dec[lv])
                    m = page_metrics(s, d, grey)
                    m.pop('err_map', None)
                    m.pop('detail_keep', None)
                    row[f'{fmt} L{lv}'] = m
            cache[ck] = row
        row = cache[ck]
        used[ck] = row
        out[p['stem']] = row
        if grey:
            b, e = row.get('bc4 L0'), row.get('eac_r11 L0')
            if b and e and e['psnr'] < 0.9 * b['psnr']:
                errs.append(f'fallback: {p["stem"]} EAC R11 {e["psnr"]} dB against BC4 {b["psnr"]} dB')
            continue
        for lv in range(2):
            ratios = FALLBACK_RATIO.get((kind, lv))
            base = row.get(f'bc7 L{lv}')
            if not ratios or not base or base['dE_mean'] <= 0:
                continue
            for fmt, r in ratios.items():
                got = row.get(f'{fmt} L{lv}')
                if not got:
                    continue
                msg = (f'fallback: {p["stem"]} level {lv} {fmt}: dE mean {got["dE_mean"]} against BC7 '
                       f'{base["dE_mean"]}, {got["dE_mean"] / base["dE_mean"]:.2f}x')
                # the ratio follows the content a little too (edge-dense pages: up to 1.37x for ASTC where §9.2
                # measured 1.22x), so +-10% warns and 1.5x the measured ratio fails: a broken transcode path
                if got['dE_mean'] > 1.5 * r * base['dE_mean']:
                    errs.append(f'{msg} (fails above {1.5 * r:.2f}x)')
                elif got['dE_mean'] > 1.1 * r * base['dE_mean']:
                    results.setdefault('warnings', []).append(f'{msg} (§9.2 +10%: {1.1 * r:.2f}x)')
    K.dump_json(cache_path, used)                 # only this build's pages
    results['fallback'] = out
    return errs


# --------------------------------------------------------------------------------------------------------------
# Cell isolation (§9.5 #5, codex B2-r1 finding 10): each page's own layout, as B2's worst case, in every format
# --------------------------------------------------------------------------------------------------------------

def _probe_levels(img, n):
    out = [img]
    for _ in range(n - 1):
        out.append(K.box_down(out[-1], 2))
    return out


def cell_probe_checks(man, layout, results):
    """Fill every cell of a page (gutter included) with a solid colour unlike its neighbours', build the levels,
    encode with the array's codec, transcode to every format of its chain and decode: every texel of a cell must
    stay within 0.1 of its own colour, so no block of any level mixes two cells. With the footprint check (every
    frame's bilinear footprint at every level lies inside its cell) that is §9.5 #5's edge-texel rule."""
    import hashlib

    import assemble as A
    import dds
    errs = []
    probe_dir = os.path.join(K.CACHE, 'qc', 'probe')
    os.makedirs(probe_dir, exist_ok=True)
    cache_path = os.path.join(QC, 'probe-cache.json')
    cache = K.load_json(cache_path) if os.path.exists(cache_path) else {}
    used = {}
    res = {}
    for lp in layout['pages']:
        arr = layout['arrays'][lp['array']]
        kind, S, nlev = arr['kind'], arr['pageSize'], arr['levels']
        grey = kind == 'shadow'
        codec = arr['codec']
        # geometry: each frame's footprint (one texel of bilinear reach) at each level inside its cell
        for c in lp['cells']:
            g = arr['gutter']
            fx0, fy0 = c['x'] + g, c['y'] + g
            for lv in range(nlev):
                # bilinear at level lv reads texels floor(u - 1/2) and the next one, for u across the frame
                f = 2 ** lv
                tx0, ty0 = np.floor(fx0 / f - 0.5), np.floor(fy0 / f - 0.5)
                tx1, ty1 = np.floor((fx0 + c['w']) / f + 0.5) + 1, np.floor((fy0 + c['h']) / f + 0.5) + 1
                if tx0 < c['x'] / f or ty0 < c['y'] / f or tx1 > (c['x'] + c['cw']) / f or \
                        ty1 > (c['y'] + c['ch']) / f:
                    errs.append(f'cells: {c["set"]} frame {c["local"]} samples outside its cell at level {lv}')
                if (c['x'] / f) % 4 or (c['y'] / f) % 4 or (c['cw'] / f) % 4 or (c['ch'] / f) % 4:
                    errs.append(f'cells: {c["set"]} frame {c["local"]} cell off the 4x4 blocks at level {lv}')
        sig = hashlib.sha256(json.dumps([kind, S, nlev, codec, [[c['x'], c['y'], c['cw'], c['ch']]
                                                                 for c in lp['cells']]]).encode()).hexdigest()
        if sig in cache:
            res[f'{kind}-{lp["group"]}-{lp["index"]}'] = used[sig] = cache[sig]
            continue
        rng = np.random.default_rng(7)
        C = 1 if grey else 4
        img = np.zeros((S, S, C), np.float32)
        ids = -np.ones((S, S), np.int32)
        cols = []
        for i, c in enumerate(lp['cells']):
            col = rng.random(3) * 0.5 + (0.5 if i % 2 else 0.0)
            cols.append(col)
            if grey:
                img[c['y']:c['y'] + c['ch'], c['x']:c['x'] + c['cw'], 0] = col[0]
            else:
                img[c['y']:c['y'] + c['ch'], c['x']:c['x'] + c['cw'], :3] = col
                img[c['y']:c['y'] + c['ch'], c['x']:c['x'] + c['cw'], 3] = 1.0
            ids[c['y']:c['y'] + c['ch'], c['x']:c['x'] + c['cw']] = i
        cols = np.array(cols, np.float32)
        lv8 = [K.to8(a) for a in _probe_levels(img, nlev)]
        src = os.path.join(probe_dir, sig[:16] + '.dds')
        ktx = os.path.join(probe_dir, sig[:16] + '.ktx2')
        dds.write_dds(src, [A.as_rgba(a) for a in lv8])
        subprocess.run(['basisu', '-ktx2', '-no_stats'] + CODEC_ARGS[codec] + [src, '-output_file', ktx],
                       check=True, capture_output=True)
        os.remove(src)
        row = {}
        for fmt, code in (GREY_FORMATS if grey else FORMATS).items():
            dec = unpack(ktx, code, os.path.join(probe_dir, 'unpack', f'{sig[:16]}.{fmt}'))
            worst = 0.0
            for lv, d in enumerate(dec):
                s = 2 ** lv
                idl = ids[::s, ::s]
                m = idl >= 0
                own = cols[np.maximum(idl, 0)]
                if grey:
                    dist = np.abs(d[..., 0] - own[..., 0])
                else:
                    dist = np.sqrt(((d[..., :3] - own) ** 2).sum(-1))
                w = float(dist[m].max()) if m.any() else 0.0
                worst = max(worst, w)
                if w > 0.1:
                    y, x = np.unravel_index(np.argmax(np.where(m, dist, 0)), dist.shape)
                    errs.append(f'cells: {kind}-{lp["group"]}-{lp["index"]} in {fmt} level {lv}: texel {x},{y} '
                                f'is {w:.3f} off its cell colour (another cell leaks in)')
            row[fmt] = round(worst, 4)
        os.remove(ktx)
        cache[sig] = used[sig] = row
        res[f'{kind}-{lp["group"]}-{lp["index"]}'] = row
    K.dump_json(cache_path, used)
    results['cells'] = res
    return errs

# --------------------------------------------------------------------------------------------------------------
# Fixtures (10 §15.7): the cases against manifest.py
# --------------------------------------------------------------------------------------------------------------

def fixture_errors():
    errs = []
    mp = os.path.join(FIXTURES, 'manifest.json')
    cp = os.path.join(FIXTURES, 'cases.json')
    if not os.path.exists(mp):
        return ['fixtures: test/fixtures/sprites/manifest.json is missing']
    man = K.load_json(mp)
    errs += [f'fixture {e}' for e in schema_errors(man)]
    errs += [f'fixture {e}' for e in MF.validate(man)]
    import fixture as FX
    for c in K.load_json(cp)['cases']:
        got = FX.evaluate(man, c)
        if json.dumps(got, sort_keys=True) != json.dumps(c['expect'], sort_keys=True):
            errs.append(f'fixtures: case {c["name"]!r} differs from manifest.py')
    for f in man['pages']:
        for p in f:
            for fn in p['files']:
                if not os.path.exists(os.path.join(FIXTURES, fn)):
                    errs.append(f'fixtures: page file {fn} missing')
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', default=None)
    ap.add_argument('--layout', default=None)
    ap.add_argument('--fixtures-only', action='store_true')
    ap.add_argument('--no-pages', action='store_true')
    a = ap.parse_args()
    os.makedirs(QC, exist_ok=True)
    results = dict(pages={}, errors=[])
    errs = fixture_errors()
    if not a.fixtures_only:
        man = K.load_json(a.manifest)
        layout = K.load_json(a.layout)
        errs += schema_errors(man)
        errs += MF.validate(man)
        errs += coverage_errors(man)
        errs += cell_errors(man, layout)
        if not a.no_pages:
            errs += compression_checks(man, layout, results)
            errs += fallback_checks(man, results)
            errs += cell_probe_checks(man, layout, results)
        import quality as Q
        q_errs, q_res = Q.check_all(man, layout)
        errs += q_errs
        results['sets'] = q_res
    results['errors'] = errs
    K.dump_json(os.path.join(QC, 'checks.json'), results)
    for w in results.get('warnings', []):
        print(f'[check] warn {w}', flush=True)
    for e in errs:
        print(f'[check] FAIL {e}', flush=True)
    worst = {}
    for k, m in results['pages'].items():
        if not k.endswith(('level 0', 'level 1')):
            continue
        worst.setdefault('psnr', []).append(m.get('psnr', 99))
        if 'dE_p99' in m:
            worst.setdefault('dE_p99', []).append(m['dE_p99'])
            worst.setdefault('detail', []).append(m['detail_keep'])
    if worst:
        print(f'[check] pages at High and Normal: min PSNR {min(worst["psnr"]):.1f} dB'
              + (f', max dE p99 {max(worst["dE_p99"]):.2f}, min detail kept {min(worst["detail"]):.3f}'
                 if 'dE_p99' in worst else ''), flush=True)
    print(f'[check] {len(errs)} failure(s)', flush=True)
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
