// The data stage must agree with the Python tools wherever they overlap (C1a brief; 10 §2.4):
//   - it reads every YAML file exactly as PyYAML does (validate_spec.py's parser);
//   - its expressions evaluate as validate_spec.eval_expr evaluates them: bit for bit where no power has a
//     fractional base, within 1e-12 elsewhere; and give the same unit counts (validate_spec.unit_count)
//     wherever the Python tools compute them (every level of a finite technology, the first 21 levels of
//     an infinite one). Beyond those, at costs above about 7 × 10^14 units, det::powi's left-to-right
//     multiplication and Python's libm pow can differ in the last bit, so a count may differ by a unit;
//     the engine's value is det::powi's, identical in every engine (10 §4.1);
//   - its milestone filters print the counts of design/round4/arch-data/manifests.py, line for line.
// Needs `gamedev-python` (CLAUDE.md).
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, SPEC } from '../../test/helpers/paths.ts';
import { canonicalJson } from '../lib/canonical.ts';
import { Diagnostics } from './diagnostics.ts';
import { compile, hasPower, Program, unitCount } from './expr.ts';
import { compileFormulas, forEachPoint, type PointSpec } from './formulas.ts';
import { closure, loadManifests, loadSlice, selectTechnologies, sliceFilter, summary } from './manifests.ts';
import { checkReferences, indexDesign } from './refs.ts';
import { FILE_KINDS, type FileKind, validateDesign } from './schema/index.ts';
import { loadYaml, type SourceFile } from './sources.ts';

const python = (code: string, input = ''): string =>
  execFileSync('gamedev-python', ['-c', code], { input, encoding: 'utf8', maxBuffer: 1 << 28, cwd: REPO });

function load() {
  const diags = new Diagnostics();
  const sources = {} as Record<FileKind, SourceFile>;
  for (const k of FILE_KINDS)
    sources[k] = loadYaml(join(SPEC, 'data', `${k}.yaml`), `design/spec/data/${k}.yaml`, diags) as SourceFile;
  const design = validateDesign(sources, diags);
  if (!design) throw new Error(diags.list.map((d) => d.message).join('\n'));
  return { design, diags };
}

describe('YAML parsing agrees with PyYAML', () => {
  it('reads every file of design/spec/data to the same value', () => {
    const files = readdirSync(join(SPEC, 'data'))
      .filter((f) => f.endsWith('.yaml'))
      .sort();
    const py = JSON.parse(
      python(
        `import yaml, json, sys\nfiles = json.load(sys.stdin)\nprint(json.dumps({f: yaml.safe_load(open('design/spec/data/' + f)) for f in files}))`,
        JSON.stringify(files),
      ),
    ) as Record<string, unknown>;
    for (const f of files) {
      const diags = new Diagnostics();
      const src = loadYaml(join(SPEC, 'data', f), f, diags);
      expect(diags.list, f).toEqual([]);
      expect(canonicalJson(src?.value), f).toBe(canonicalJson(py[f]));
    }
  });
});

describe('expressions agree with validate_spec.eval_expr', () => {
  it('evaluates every formula of the data at its checked points, with the same unit counts', () => {
    const { design, diags } = load();
    const formulas = compileFormulas(design, diags);
    expect(diags.errors).toEqual([]);
    expect(formulas.uses.length).toBeGreaterThan(20);
    // Python re-parses each call, so the 2-D grid is sampled at 21 × 21 points; the 1-D ones in full.
    const cases = formulas.uses.map((u) => {
      const points: number[][] = [];
      const spec: PointSpec =
        u.points.kind === 'grid' && u.field.vars.length === 2 ? { kind: 'grid', steps: 20 } : u.points;
      forEachPoint(spec, u.field.vars.length, (v) => {
        points.push([...v]);
        return true;
      });
      const tech = u.name.startsWith('count_formula/')
        ? formulas.levels.get(u.name.slice('count_formula/'.length))
        : undefined;
      // The levels where tools/validate_spec.py and render_spec.py compute unit counts.
      const pyLast = tech ? (tech.infinite ? tech.first + 20 : tech.last) : 0;
      return {
        name: u.name,
        src: u.compiled.source,
        vars: u.field.vars,
        points,
        count: u.field.name === 'count_formula',
        pyLast,
      };
    });
    const out = JSON.parse(
      python(
        `import sys, json\nsys.path.insert(0, 'tools')\nimport validate_spec as vs\ncases = json.load(sys.stdin)\nres = {}\nfor c in cases:\n    vals = []\n    for p in c['points']:\n        env = dict(zip(c['vars'], p))\n        if c['vars'] == ['L']:\n            env['L'] = int(p[0])\n        v = vs.eval_expr(c['src'], **env)\n        vals.append([float(v), vs.unit_count(c['src'], int(p[0])) if c['count'] else None])\n    res[c['name']] = vals\nprint(json.dumps(res))`,
        JSON.stringify(cases),
      ),
    ) as Record<string, [number, number | null][]>;
    const problems: string[] = [];
    let compared = 0;
    for (const c of cases) {
      const code = compile(c.src, c.vars).code;
      const program = new Program(code);
      const exact = !hasPower(code) || !/\d\.\d*\s*\^/.test(c.src);
      c.points.forEach((p, i) => {
        const [want, wantCount] = out[c.name]?.[i] ?? [Number.NaN, null];
        const have = program.exec(p).value;
        compared++;
        const ok = exact ? have === want : Math.abs(have - want) <= 1e-12 * Math.abs(want);
        if (!ok) problems.push(`${c.name} at ${p.join(',')}: TypeScript ${have}, Python ${want}`);
        const level = p[0] as number;
        if (wantCount !== null && level <= c.pyLast && unitCount(have) !== wantCount)
          problems.push(
            `${c.name} at L = ${level}: unit count TypeScript ${unitCount(have)}, Python ${wantCount}`,
          );
        if (wantCount !== null && Math.abs(unitCount(have) - wantCount) > 1e-12 * wantCount + 1)
          problems.push(
            `${c.name} at L = ${level}: unit count TypeScript ${unitCount(have)}, Python ${wantCount} (beyond the last bit)`,
          );
      });
    }
    expect(problems).toEqual([]);
    expect(compared).toBeGreaterThan(4000);
  }, 120_000);
});

describe('milestone filters agree with manifests.py', () => {
  it('prints the same closure summary for every manifest', () => {
    const want = python(
      `import runpy, sys\nsys.argv = ['manifests.py', 'design/spec']\nrunpy.run_path('design/round4/arch-data/manifests.py', run_name='__main__')`,
    )
      .split('\n')
      .filter((l) => /^m\d/.test(l) || l.startsWith('    inert'));
    const { design, diags } = load();
    const ix = indexDesign(design);
    checkReferences(design, ix, diags);
    const mf = loadManifests(
      loadYaml(join(REPO, 'game/data/engine/manifests.yaml'), 'manifests.yaml', diags) as SourceFile,
      diags,
    );
    const slice = loadSlice(SPEC, diags);
    if (!mf || !slice) throw new Error(diags.list.map((d) => d.message).join('\n'));
    const have: string[] = [];
    for (const [name, m] of Object.entries(mf.manifests)) {
      const f =
        'from' in m
          ? sliceFilter(slice.block, design, ix, diags, slice.src)
          : closure(name, selectTechnologies(m, mf.wild_roots, design, ix), design, ix);
      have.push(summary(f));
      if (f.inert.length > 0) have.push(`    inert until its setting exists: ${f.inert.join('; ')}`);
    }
    expect(diags.errors).toEqual([]);
    expect(have).toEqual(want);
    expect(have.length).toBeGreaterThanOrEqual(5);
  }, 60_000);
});
