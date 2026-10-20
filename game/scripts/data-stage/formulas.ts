// Compiles and checks every formula field in the design data (10 §2.4 step 2, §15.2; B1-r1 18):
//   - a technology's count_formula at every level up to its level cap (a finite technology's max_level;
//     for an infinite one the last level whose cost is finite, at most 2^53 units, and whose exponents
//     stay within ±1,024), and its field_year at the same levels;
//   - a recipe's amounts_by_j and meta.world.model_collapse.speed_factor at 1,001 evenly spaced points per
//     bounded variable (j, σ, c ∈ [0, 1]), endpoints included.
// A non-integer exponent, a NaN, an infinity or a result outside the field's range is an error.
import type { DataPath, Diagnostics } from './diagnostics.ts';
import {
  type Compiled,
  compile,
  ExprError,
  FIELDS,
  type FormulaField,
  POWI_LIMIT,
  type PowerTrace,
  Program,
  unitCount,
} from './expr.ts';
import type { DesignData, FileKind } from './schema/index.ts';
import { at } from './sources.ts';

/** The highest level the stage searches for an infinite technology's cap. */
export const MAX_TECH_LEVEL = 65535;
/** Grid points per bounded variable: 1,001, endpoints included (k / 1000 for k = 0 … 1000). */
export const GRID_STEPS = 1000;

export type PointSpec = { kind: 'levels'; first: number; last: number } | { kind: 'grid'; steps: number };

export interface FormulaUse {
  field: FormulaField;
  /** e.g. `technology mining-productivity-7`. */
  owner: string;
  /** A stable name for fixtures, e.g. `count_formula/mining-productivity-7`. */
  name: string;
  file: FileKind;
  path: DataPath;
  compiled: Compiled;
  points: PointSpec;
}

export interface TechLevels {
  first: number;
  /** max_level, or the cap of an infinite technology. */
  last: number;
  infinite: boolean;
}

export interface Formulas {
  uses: FormulaUse[];
  levels: Map<string, TechLevels>;
}

/**
 * Calls `f` with each point's variables, in the fixture order (levels ascending; grids row-major, the
 * first variable outer). The array passed is reused between calls. Returning false stops the walk.
 */
export function forEachPoint(
  spec: PointSpec,
  varCount: number,
  f: (vars: Float64Array) => boolean | undefined,
): void {
  const v = new Float64Array(Math.max(1, varCount));
  if (spec.kind === 'levels') {
    for (let l = spec.first; l <= spec.last; l++) {
      v[0] = l;
      if (f(v) === false) return;
    }
    return;
  }
  const n = spec.steps;
  if (varCount === 1) {
    for (let k = 0; k <= n; k++) {
      v[0] = k / n;
      if (f(v) === false) return;
    }
  } else if (varCount === 2) {
    for (let a = 0; a <= n; a++) {
      for (let b = 0; b <= n; b++) {
        v[0] = a / n;
        v[1] = b / n;
        if (f(v) === false) return;
      }
    }
  } else throw new Error(`grids over ${varCount} variables are not supported`);
}

export function compileFormulas(d: DesignData, diags: Diagnostics): Formulas {
  const uses: FormulaUse[] = [];
  const levels = new Map<string, TechLevels>();
  const fail = (file: FileKind, path: DataPath, msg: string): void =>
    diags.error(msg, at(d.sources[file], path));
  const tryCompile = (
    file: FileKind,
    path: DataPath,
    field: FormulaField,
    value: number | string,
  ): Compiled | null => {
    try {
      return compile(value, field.vars);
    } catch (e) {
      if (e instanceof ExprError) {
        fail(file, path, e.message);
        return null;
      }
      throw e;
    }
  };

  d.technologies.forEach((t, i) => {
    let lv: TechLevels = { first: 1, last: 1, infinite: false };
    if (t.count_formula !== undefined) {
      const path: DataPath = [i, 'count_formula'];
      const first = t.first_level ?? 1;
      const max = t.max_level ?? 'infinite';
      // Every checked range is nonempty and starts at a level the engine stores (C1a-r1 finding 6).
      if (first > MAX_TECH_LEVEL) {
        fail(
          'technologies',
          [i, 'first_level'],
          `first_level ${first} is above the highest level, ${MAX_TECH_LEVEL}`,
        );
        return;
      }
      if (max !== 'infinite' && max > MAX_TECH_LEVEL) {
        fail(
          'technologies',
          [i, 'max_level'],
          `max_level ${max} is above the highest level, ${MAX_TECH_LEVEL}`,
        );
        return;
      }
      if (max !== 'infinite' && max < first) {
        fail('technologies', [i, 'max_level'], `max_level ${max} is below first_level ${first}`);
        return;
      }
      const c = tryCompile('technologies', path, FIELDS.count_formula, t.count_formula);
      if (!c) return;
      const last = checkCost(c, first, max, (msg) => fail('technologies', path, msg));
      if (last === null) return;
      if (last < first) throw new Error(`technology ${t.id}: empty level range ${first}..${last}`);
      lv = { first, last, infinite: max === 'infinite' };
      uses.push({
        field: FIELDS.count_formula,
        owner: `technology ${t.id}`,
        name: `count_formula/${t.id}`,
        file: 'technologies',
        path,
        compiled: c,
        points: { kind: 'levels', first, last },
      });
    } else if (t.first_level !== undefined || t.max_level !== undefined) {
      fail('technologies', [i], 'first_level and max_level need a count_formula');
    }
    levels.set(t.id, lv);
    if (t.field_year !== undefined) {
      const path: DataPath = [i, 'field_year'];
      const c = tryCompile('technologies', path, FIELDS.field_year, t.field_year);
      if (!c) return;
      if (
        checkPoints(c, FIELDS.field_year, { kind: 'levels', first: lv.first, last: lv.last }, (msg) =>
          fail('technologies', path, msg),
        )
      )
        uses.push({
          field: FIELDS.field_year,
          owner: `technology ${t.id}`,
          name: `field_year/${t.id}`,
          file: 'technologies',
          path,
          compiled: c,
          points: { kind: 'levels', first: lv.first, last: lv.last },
        });
    }
  });

  d.recipes.forEach((r, i) => {
    for (const [product, value] of Object.entries(r.amounts_by_j ?? {})) {
      const path: DataPath = [i, 'amounts_by_j', product];
      const c = tryCompile('recipes', path, FIELDS.amounts_by_j, value);
      if (!c) continue;
      const points: PointSpec = { kind: 'grid', steps: GRID_STEPS };
      if (checkPoints(c, FIELDS.amounts_by_j, points, (msg) => fail('recipes', path, msg)))
        uses.push({
          field: FIELDS.amounts_by_j,
          owner: `recipe ${r.id}`,
          name: `amounts_by_j/${r.id}/${product}`,
          file: 'recipes',
          path,
          compiled: c,
          points,
        });
    }
  });

  const sf = d.meta.world.model_collapse.speed_factor;
  const sfPath: DataPath = ['world', 'model_collapse', 'speed_factor'];
  const c = tryCompile('meta', sfPath, FIELDS.speed_factor, sf);
  if (c) {
    const points: PointSpec = { kind: 'grid', steps: GRID_STEPS };
    if (checkPoints(c, FIELDS.speed_factor, points, (msg) => fail('meta', sfPath, msg)))
      uses.push({
        field: FIELDS.speed_factor,
        owner: 'meta.world.model_collapse',
        name: 'speed_factor/model-collapse',
        file: 'meta',
        path: sfPath,
        compiled: c,
        points,
      });
  }
  return { uses, levels };
}

function describe(vars: ArrayLike<number>, names: readonly string[]): string {
  return names.map((n, k) => `${n} = ${vars[k]}`).join(', ');
}

/** Checks a field at every point; reports the first failure. */
function checkPoints(
  c: Compiled,
  field: FormulaField,
  points: PointSpec,
  fail: (msg: string) => void,
): boolean {
  let bad: string | null = null;
  const program = new Program(c.code);
  const trace: PowerTrace = { nonInteger: false, maxAbs: 0 };
  const { lo, hi } = field.range;
  forEachPoint(points, field.vars.length, (vars) => {
    const v = program.exec(vars, trace).value;
    if (!trace.nonInteger && trace.maxAbs <= POWI_LIMIT && v >= lo && v <= hi) return true;
    const where = describe(vars, field.vars);
    if (trace.nonInteger) bad = `'^' needs an integer exponent (at ${where})`;
    else if (trace.maxAbs > POWI_LIMIT) bad = `an exponent exceeds ±${POWI_LIMIT} (at ${where})`;
    else if (!Number.isFinite(v)) bad = `is ${v} at ${where}`;
    else bad = `is ${v} at ${where}, outside its range [${lo}, ${hi}]`;
    return false;
  });
  if (bad) fail(`${field.name} ${JSON.stringify(c.source)}: ${bad}`);
  return bad === null;
}

/**
 * Checks a count formula from `first` up and returns the last level: max_level for a finite technology,
 * the level cap for an infinite one, or null after reporting an error.
 */
function checkCost(
  c: Compiled,
  first: number,
  max: number | 'infinite',
  fail: (msg: string) => void,
): number | null {
  const range = FIELDS.count_formula.range;
  const limit = max === 'infinite' ? MAX_TECH_LEVEL : max;
  const program = new Program(c.code);
  const vars = new Float64Array(1);
  for (let l = first; l <= limit; l++) {
    const trace: PowerTrace = { nonInteger: false, maxAbs: 0 };
    vars[0] = l;
    const v = program.exec(vars, trace).value;
    const src = JSON.stringify(c.source);
    if (trace.nonInteger) {
      fail(`count_formula ${src}: '^' needs an integer exponent (at L = ${l})`);
      return null;
    }
    if (!Number.isNaN(v) && v < range.lo) {
      fail(`count_formula ${src} is ${v} at L = ${l}: a cost is at least 1 unit`);
      return null;
    }
    const capped = trace.maxAbs > POWI_LIMIT || !Number.isFinite(v) || unitCount(v) > range.hi;
    if (capped) {
      if (max !== 'infinite' || l === first) {
        const why =
          trace.maxAbs > POWI_LIMIT
            ? `an exponent exceeds ±${POWI_LIMIT}`
            : `the cost ${v} exceeds 2^53 units`;
        fail(`count_formula ${src}: ${why} at L = ${l}`);
        return null;
      }
      return l - 1;
    }
  }
  return limit;
}
