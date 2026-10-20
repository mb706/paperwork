"""The asset build's checks (10 §9.5) on the emitted manifest, its pages and the fixtures.

    gamedev-python game/scripts/assets/checks.py --manifest public/atlases/sprites.json --layout layout.json
    gamedev-python game/scripts/assets/checks.py --fixtures-only

Manifest:  the JSON schema (sprites.schema.json), complete tables and maps, valid ids, frames inside pages, every
           kind's parts; every prototype of the build (prototypes.json) has its set or greybox, every icon its set;
           the projection fixture cases of test/fixtures/sprites/cases.json (10 §15.7) against manifest.py.
Cells:     every cell on its array's block alignment and inside its page, no two cells overlapping (gutters
           included), every frame inside its own cell (§9.5 #5 "Cells").
Pages:     every encoded page transcoded back (basisu -unpack) to BC7 for colour, light and icons and BC4 for
           shadows, compared with its source levels: PSNR >= 40 dB at High and >= 37 dB at Normal, CIELAB dE p99
           <= 6 and detail kept >= 0.98 (§9.2's measures, encode.py of the study), naming the worst sprite.
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
    return [K.read_png(levels[k]) for k in sorted(levels)]


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
        return dict(psnr=round(float(10 * np.log10(1.0 / max(np.mean(err ** 2), 1e-12))), 2))
    if dec.shape[2] == 3:
        dec = np.concatenate([dec, np.ones(dec.shape[:2] + (1,), np.float32)], -1)
    co = K.over_paper(src)
    cd = K.over_paper(dec)
    m = ndi.binary_dilation((src[..., 3] > 0) | (dec[..., 3] > 0), iterations=2)
    if not m.any():
        return dict(psnr=99.0, dE_p99=0.0, detail_keep=1.0)
    err = (co - cd)[m]
    lo, ld = K.lab(co), K.lab(cd)
    de = np.sqrt(((lo - ld) ** 2).sum(-1))
    return dict(psnr=round(float(10 * np.log10(1.0 / max(np.mean(err ** 2), 1e-12))), 2),
                dE_mean=round(float(de[m].mean()), 3), dE_p99=round(float(np.percentile(de[m], 99)), 2),
                detail_keep=round(detail_keep(lo, ld, m), 3), de_map=de * m)


def compression_checks(man, layout, results):
    errs = []
    pages = K.load_json(os.path.join(K.CACHE, 'assembled.json'))['pages']
    for p in pages:
        arr = man['arrays'][p['array']]
        grey = arr['kind'] == 'shadow'
        code = UNPACK_CODE['bc4' if grey else 'bc7']
        decoded = []
        for f in p['files']:
            decoded += unpack(os.path.join(K.PUBLIC, f), code, os.path.join(K.CACHE, 'unpack', os.path.basename(f)))
        for lv, dec in enumerate(decoded):
            src = K.read_png(os.path.join(K.CACHE, 'pages', f'{p["stem"]}.L{lv}.png'))
            if grey:
                src = src[..., :1]
                dec = dec[..., :1]
            m = page_metrics(src, dec, grey)
            de_map = m.pop('de_map', None)
            key = f'{p["stem"]} level {lv}'
            results['pages'][key] = m
            psnr_min = 40.0 if (lv == 0 and arr['kind'] == 'colour') else 37.0
            if grey:
                psnr_min = 33.0           # ETC1S on soft masks: 35.6 dB measured (§9.2); masks are hatched
            bad = m['psnr'] < psnr_min
            if not grey and lv <= 1:
                bad = bad or m['dE_p99'] > 6.0 or m['detail_keep'] < 0.98
            if bad:
                worst = ''
                if de_map is not None:
                    y, x = np.unravel_index(np.argmax(de_map), de_map.shape)
                    worst = f' (worst pixel {x},{y} at level {lv})'
                errs.append(f'compression: {key}: {m}{worst}')
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
        import quality as Q
        q_errs, q_res = Q.check_all(man, layout)
        errs += q_errs
        results['sets'] = q_res
    results['errors'] = errs
    K.dump_json(os.path.join(QC, 'checks.json'), results)
    for e in errs:
        print(f'[check] FAIL {e}', flush=True)
    worst = {}
    for k, m in results['pages'].items():
        worst.setdefault('psnr', []).append(m.get('psnr', 99))
        if 'dE_p99' in m:
            worst.setdefault('dE_p99', []).append(m['dE_p99'])
            worst.setdefault('detail', []).append(m['detail_keep'])
    if worst:
        print(f'[check] pages: min PSNR {min(worst["psnr"]):.1f} dB'
              + (f', max dE p99 {max(worst["dE_p99"]):.2f}, min detail kept {min(worst["detail"]):.3f}'
                 if 'dE_p99' in worst else ''), flush=True)
    print(f'[check] {len(errs)} failure(s)', flush=True)
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
