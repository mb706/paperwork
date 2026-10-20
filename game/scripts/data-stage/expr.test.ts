// The expression compiler and its reference interpreter (10 §15.2): grammar, bytecode layout, golden
// values, the hand-written edge cases, and refusal of malformed input.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME } from '../../test/helpers/paths.ts';
import { Diagnostics } from './diagnostics.ts';
import { evaluateEdge, FLAG_NAMES, loadEdgeCases } from './emit/expr-fixture.ts';
import {
  clamp,
  compile,
  ExprError,
  evaluate,
  FIELDS,
  FLAG_CLAMPED,
  FLAG_EXPONENT,
  FLAG_NAN,
  hasPower,
  OP_ADD,
  OP_CONST,
  OP_END,
  OP_MUL,
  OP_NEG,
  OP_POWI,
  OP_SUB,
  OP_VAR,
  Program,
  powi,
  run,
  unitCount,
} from './expr.ts';

const ALL = { lo: -Number.MAX_VALUE, hi: Number.MAX_VALUE };
const value = (src: string, vars: Record<string, number> = {}) =>
  run(compile(src, Object.keys(vars)).code, Object.values(vars)).value;

describe('grammar (Python precedence, as validate_spec.eval_expr reads it)', () => {
  it.each([
    ['1+2*3', 7],
    ['(1+2)*3', 9],
    ['2^3^2', 512],
    ['-2^2', -4],
    ['2^-1', 0.5],
    ['-(-3)', 3],
    ['+4', 4],
    ['10/4', 2.5],
    ['1 - 2 - 3', -4],
    ['2*3/4', 1.5],
    ['1e3', 1000],
    ['.5', 0.5],
    ['1.5e-1*10', 1.5],
  ])('%s = %d', (src, want) => {
    expect(value(src)).toBe(want);
  });

  it('reads the data formulas', () => {
    expect(value('2^(L-7)*1000', { L: 9 })).toBe(4000);
    expect(value('1000+3^(L-1)*1000', { L: 3 })).toBe(10000);
    expect(value('2025+0.5*(L-5)', { L: 9 })).toBe(2027);
    expect(value('45*(1-j)/0.70', { j: 0.3 })).toBe((45 * (1 - 0.3)) / 0.7);
    expect(value('1 - sigma*c', { sigma: 0.5, c: 0.5 })).toBe(0.75);
  });

  it.each([
    ['L+', 'unexpected end'],
    ['(L', 'missing )'],
    ['L)', 'unexpected )'],
    ['2 3', 'unexpected 3'],
    ['x*2', 'unknown variable x'],
    ['sin(1)', 'unknown variable sin'],
    ['2**3', 'unexpected *'],
    ['L % 2', 'bad expression'],
    ['2L', 'bad number'],
  ])('refuses %s', (src, msg) => {
    expect(() => compile(src, ['L'])).toThrow(ExprError);
    expect(() => compile(src, ['L'])).toThrow(msg);
  });
});

describe('bytecode (10 §15.2 layout)', () => {
  it('writes the header, the postfix ops and END', () => {
    const c = compile('2^(L-7)*1000', ['L']);
    const ops = [...c.code.subarray(4)];
    expect((c.code[0] as number) | ((c.code[1] as number) << 8)).toBe(ops.length);
    expect(c.code[2]).toBe(1);
    expect(c.code[3]).toBe(3);
    const kinds: number[] = [];
    for (let i = 0; i < ops.length; i++) {
      kinds.push(ops[i] as number);
      if (ops[i] === OP_CONST) i += 8;
      else if (ops[i] === OP_VAR) i += 1;
    }
    expect(kinds).toEqual([OP_CONST, OP_VAR, OP_CONST, OP_SUB, OP_POWI, OP_CONST, OP_MUL, OP_END]);
    expect(hasPower(c.code)).toBe(true);
    expect(hasPower(compile('L+1', ['L']).code)).toBe(false);
  });

  it('compiles unary minus to NEG and numbers to CONST', () => {
    const c = compile('-L', ['L']);
    expect([...c.code.subarray(4)]).toEqual([OP_VAR, 0, OP_NEG, OP_END]);
    const n = compile(2025, ['L']);
    expect(n.code.length).toBe(4 + 1 + 8 + 1);
    expect(run(n.code, [1]).value).toBe(2025);
  });

  it('counts the stack depth', () => {
    expect(compile('1+(2+(3+(4+5)))', []).maxStack).toBe(5);
    const deep = `${'('.repeat(16)}1${'+1)'.repeat(16)}`;
    expect(compile(deep, []).maxStack).toBe(2);
    const right = Array.from({ length: 17 }, (_, i) => `${i + 1}`).reduceRight((acc, x) => `${x}+(${acc})`);
    expect(() => compile(right, [])).toThrow('needs a stack of 17');
  });

  it('refuses malformed bytecode', () => {
    expect(() => new Program(new Uint8Array([1, 0, 0]))).toThrow('truncated');
    expect(() => new Program(new Uint8Array([2, 0, 0, 2, OP_ADD, OP_END]))).toThrow('underflow');
    expect(() => new Program(new Uint8Array([1, 0, 0, 2, 0x42]))).toThrow('bad opcode');
    expect(() => new Program(new Uint8Array([3, 0, 1, 2, OP_VAR, 1, OP_END]))).toThrow('bad variable');
    expect(() => new Program(new Uint8Array([1, 0, 0, 17, OP_END]))).toThrow('stack overflow');
    expect(() => new Program(new Uint8Array([3, 0, 1, 1, OP_VAR, 0, 0]))).toThrow('bad opcode 0x0');
    expect(() => new Program(new Uint8Array([4, 0, 1, 1, OP_VAR, 0, OP_END, OP_END]))).toThrow(
      'bytes after END',
    );
    expect(() => run(compile('L', ['L']).code, [])).toThrow('needs 1 variables');
  });
});

describe('det::powi and the limits', () => {
  it('multiplies left to right', () => {
    expect(powi(0.1, 3)).toBe(0.1 * 0.1 * 0.1);
    expect(powi(0.1, 3)).not.toBe(0.001);
    expect(powi(2, -2)).toBe(0.25);
    expect(powi(Number.NaN, 0)).toBe(1);
    expect(powi(2, 1024)).toBe(Number.POSITIVE_INFINITY);
    expect(powi(2, -1024)).toBe(0);
  });

  it('clamps to the range', () => {
    expect(clamp(Number.NaN, { lo: 1, hi: 2 })).toEqual({ value: 1, flags: FLAG_NAN });
    expect(clamp(Number.POSITIVE_INFINITY, { lo: 1, hi: 2 })).toEqual({ value: 2, flags: FLAG_CLAMPED });
    expect(clamp(0, { lo: 1, hi: 2 })).toEqual({ value: 1, flags: FLAG_CLAMPED });
    expect(clamp(1.5, { lo: 1, hi: 2 })).toEqual({ value: 1.5, flags: 0 });
    expect(evaluate(compile('2^(L*0.5)', ['L']).code, [3], ALL)).toEqual({ value: 2, flags: FLAG_EXPONENT });
  });

  it('rounds unit counts half up (10 §5.12)', () => {
    expect(unitCount(27337.5)).toBe(27338);
    expect(unitCount(2.4999999)).toBe(2);
    expect(FIELDS.count_formula.range).toEqual({ lo: 1, hi: 2 ** 53 });
  });

  // C1a-r1 finding 7: the goldens det::unit_count shares (test/fixtures/expr/unit-counts.txt).
  const goldens = readFileSync(join(GAME, 'test/fixtures/expr/unit-counts.txt'), 'utf8')
    .split('\n')
    .map((l) => (l.split('#')[0] as string).trim())
    .filter((l) => l !== '')
    .map((l) => l.split(/\s+/).map(Number) as [number, number]);
  it.each(goldens)('unitCount(%d) = %d', (v, want) => {
    expect(unitCount(v)).toBe(want);
  });
  it('differs from floor(v + 0.5) where v + 0.5 rounds', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(14);
    expect(Math.floor(4503599627370497 + 0.5)).toBe(4503599627370498);
    expect(Math.floor(0.49999999999999994 + 0.5)).toBe(1);
  });
});

describe('the hand-written edge cases (test/fixtures/expr/edge-cases.yaml)', () => {
  const diags = new Diagnostics();
  const edges = loadEdgeCases(join(GAME, 'test/fixtures/expr/edge-cases.yaml'), 'edge-cases.yaml', diags);
  it('parse', () => {
    expect(diags.list).toEqual([]);
    expect(edges.length).toBeGreaterThanOrEqual(20);
  });
  it.each(edges.map((e) => [e.name, e] as const))('%s', (_name, e) => {
    const r = evaluateEdge(e);
    expect(Object.is(r.value, e.value) || r.value === e.value).toBe(true);
    expect(r.value).toBe(e.value);
    expect(r.flags).toBe(e.flags.reduce((f, x) => f | FLAG_NAMES[x], 0));
  });
});
