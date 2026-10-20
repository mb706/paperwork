// test/fixtures/expr/cases.txt: the expression cross-check (10 §15.2, §15.11). For every formula in the
// design data, the compiled bytecode, its field's range and points, and an FNV-1a 32 hash of the reference
// interpreter's result at every point (the f64 bits, little-endian, then the flags byte); plus the
// hand-written edge cases of edge-cases.yaml with their expected values. crates/det/tests/expr_cross.rs
// runs the Rust interpreter over the same programs and points and must reproduce every hash and value.
//
//   case <name> <field> <lo> <hi> <points> <code> <count> <fnv32> <samples>
//   edge <name> <lo> <hi> <vars> <code> <value> <flags>
// Floats are written as their IEEE bits in 16 hex digits; points are `L=a..b` (levels) or `grid=n`
// (k / n for k = 0 … n per variable, the first variable outer); samples are `index:bits` pairs.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { withHeader } from '../../lib/generated.ts';
import { toHex } from '../../lib/hash.ts';
import type { Diagnostics } from '../diagnostics.ts';
import { clamp, compile, evaluate, FLAG_CLAMPED, FLAG_EXPONENT, FLAG_NAN, Program } from '../expr.ts';
import { type Formulas, forEachPoint } from '../formulas.ts';
import { parseYaml } from '../sources.ts';

const edgeCase = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]+$/),
  expr: z.string(),
  names: z.array(z.string()),
  values: z.array(z.number()),
  range: z.tuple([z.number(), z.number()]),
  value: z.number(),
  flags: z.array(z.enum(['nan', 'clamped', 'exponent'])),
});
export type EdgeCase = z.infer<typeof edgeCase>;

export const FLAG_NAMES = { nan: FLAG_NAN, clamped: FLAG_CLAMPED, exponent: FLAG_EXPONENT } as const;

export function loadEdgeCases(path: string, file: string, diags: Diagnostics): EdgeCase[] {
  const src = parseYaml(file, readFileSync(path, 'utf8'), diags);
  if (!src) return [];
  const r = z.array(edgeCase).safeParse(src.value);
  if (!r.success) {
    for (const i of r.error.issues) diags.error(i.message, { file, path: i.path as (string | number)[] });
    return [];
  }
  return r.data;
}

const f64 = new DataView(new ArrayBuffer(8));
export function bits(v: number): string {
  f64.setFloat64(0, v, false);
  let s = '';
  for (let i = 0; i < 8; i++) s += f64.getUint8(i).toString(16).padStart(2, '0');
  return s;
}

/** FNV-1a 32 over the results: each value's f64 bits little-endian, then its flags byte. */
export class Fnv32 {
  h = 0x811c9dc5;
  private readonly view = new DataView(new ArrayBuffer(8));

  byte(b: number): void {
    this.h = Math.imul(this.h ^ b, 0x01000193) >>> 0;
  }

  result(value: number, flags: number): void {
    this.view.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) this.byte(this.view.getUint8(i));
    this.byte(flags);
  }

  hex(): string {
    return this.h.toString(16).padStart(8, '0');
  }
}

export function exprFixture(formulas: Formulas, edges: readonly EdgeCase[]): string {
  const lines: string[] = [
    '# The expression cross-check (10 §15.2): see scripts/data-stage/emit/expr-fixture.ts for the format.',
  ];
  for (const u of formulas.uses) {
    const program = new Program(u.compiled.code);
    const hash = new Fnv32();
    const values: string[] = [];
    let n = 0;
    forEachPoint(u.points, u.field.vars.length, (vars) => {
      const raw = program.exec(vars);
      const c = clamp(raw.value, u.field.range);
      const flags = raw.flags | c.flags;
      hash.result(c.value, flags);
      values.push(bits(c.value));
      n++;
      return true;
    });
    const samples = [...new Set([0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1])].map(
      (i) => `${i}:${values[i]}`,
    );
    const points =
      u.points.kind === 'levels' ? `L=${u.points.first}..${u.points.last}` : `grid=${u.points.steps}`;
    lines.push(
      [
        'case',
        u.name,
        u.field.name,
        bits(u.field.range.lo),
        bits(u.field.range.hi),
        points,
        toHex(u.compiled.code),
        String(n),
        hash.hex(),
        samples.join(','),
      ].join(' '),
    );
  }
  for (const e of edges) {
    const c = compile(e.expr, e.names);
    const flags = e.flags.reduce((f, x) => f | FLAG_NAMES[x], 0);
    const vars = e.values.length > 0 ? e.values.map(bits).join(',') : '-';
    lines.push(
      [
        'edge',
        e.name,
        bits(e.range[0]),
        bits(e.range[1]),
        vars,
        toHex(c.code),
        bits(e.value),
        String(flags),
      ].join(' '),
    );
  }
  return withHeader(
    { generator: 'scripts/data-stage.ts', source: 'design/spec/data', command: 'npm run data', comment: '#' },
    `${lines.join('\n')}\n`,
  );
}

/** The reference interpreter's result for an edge case (the Vitest check). */
export function evaluateEdge(e: EdgeCase): { value: number; flags: number } {
  const c = compile(e.expr, e.names);
  return evaluate(c.code, e.values, { lo: e.range[0], hi: e.range[1] });
}
