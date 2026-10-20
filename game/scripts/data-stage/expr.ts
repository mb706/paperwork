// The expression compiler and its reference interpreter (10 §2.4 step 2, §15.2; J18).
//
// One grammar serves every formula field: numbers, + − * / ^, parentheses and the field's variables. The
// grammar is Python's (tools/validate_spec.py evaluates the same strings with Python's `ast` after
// replacing ^ by **), so both read every expression alike:
//
//   sum     := product (('+' | '-') product)*
//   product := unary (('*' | '/') unary)*
//   unary   := ('+' | '-') unary | power
//   power   := atom ('^' unary)?            right-associative; -2^2 = -(2^2); 2^-1 = 0.5
//   atom    := number | variable | '(' sum ')'
//
// Each expression compiles to a postfix program (layout in crates/det/src/expr.rs, which interprets the
// same bytecode in the simulation). `^` evaluates by repeated multiplication in a fixed order (det::powi),
// so results are exact in every engine. Results are clamped to the field's declared range.

export const OP_CONST = 0x01;
export const OP_VAR = 0x02;
export const OP_ADD = 0x10;
export const OP_SUB = 0x11;
export const OP_MUL = 0x12;
export const OP_DIV = 0x13;
export const OP_NEG = 0x14;
export const OP_POWI = 0x20;
export const OP_END = 0xff;

export const MAX_STACK = 16;
export const POWI_LIMIT = 1024;
export const HEADER_BYTES = 4;
/** `ExprRef` meaning "no expression" (10 §15.2). */
export const EXPR_NONE = 0xffffffff;

export const FLAG_NAN = 1;
export const FLAG_CLAMPED = 2;
export const FLAG_EXPONENT = 4;

export interface Range {
  lo: number;
  hi: number;
}

/** A formula field: its variables, in bytecode order, and its declared result range (10 §2.4). */
export interface FormulaField {
  name: 'count_formula' | 'field_year' | 'amounts_by_j' | 'speed_factor';
  vars: readonly string[];
  range: Range;
}

/**
 * The formula fields and their ranges. C1b moves these declarations into schema/protos.yaml (10 §2.4):
 * costs at least 1 unit and at most 2^53 (the largest level cap), amounts at least 0 and at most a u16
 * product amount, the collapse factor in [0, 1], a field year within four digits.
 */
export const FIELDS = {
  count_formula: { name: 'count_formula', vars: ['L'], range: { lo: 1, hi: 9_007_199_254_740_992 } }, // 2^53
  field_year: { name: 'field_year', vars: ['L'], range: { lo: 0, hi: 9999 } },
  amounts_by_j: { name: 'amounts_by_j', vars: ['j'], range: { lo: 0, hi: 65535 } },
  speed_factor: { name: 'speed_factor', vars: ['sigma', 'c'], range: { lo: 0, hi: 1 } },
} as const satisfies Record<string, FormulaField>;

export class ExprError extends Error {}

type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node };

type Token = { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'op'; v: string };

const CHARSET = /^[0-9A-Za-z_+\-*/^().\s]+$/;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(src: string): Token[] {
  if (!CHARSET.test(src))
    throw new ExprError(
      `bad expression ${JSON.stringify(src)}: only numbers, + - * / ^, parentheses and variables`,
    );
  const out: Token[] = [];
  let s = src;
  while (s.length > 0) {
    const ws = /^\s+/.exec(s);
    if (ws) {
      s = s.slice(ws[0].length);
      continue;
    }
    const n = NUMBER.exec(s);
    if (n) {
      out.push({ t: 'num', v: Number(n[0]) });
      s = s.slice(n[0].length);
      if (NAME.test(s)) throw new ExprError(`bad number in ${JSON.stringify(src)}`);
      continue;
    }
    const id = NAME.exec(s);
    if (id) {
      out.push({ t: 'name', v: id[0] });
      s = s.slice(id[0].length);
      continue;
    }
    const c = s[0] as string;
    if ('+-*/^()'.includes(c)) {
      out.push({ t: 'op', v: c });
      s = s.slice(1);
      continue;
    }
    throw new ExprError(`unexpected ${JSON.stringify(c)} in ${JSON.stringify(src)}`);
  }
  return out;
}

/** Parses an expression into its tree. Unknown variables are refused against `vars`. */
export function parse(src: string, vars: readonly string[]): Node {
  const toks = tokenize(src);
  let i = 0;
  const peek = (): Token | undefined => toks[i];
  const isOp = (v: string): boolean => {
    const t = peek();
    return t?.t === 'op' && t.v === v;
  };
  const sum = (): Node => {
    let a = product();
    while (isOp('+') || isOp('-')) {
      const op = (toks[i++] as Token).v as '+' | '-';
      a = { k: 'bin', op, a, b: product() };
    }
    return a;
  };
  const product = (): Node => {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = (toks[i++] as Token).v as '*' | '/';
      a = { k: 'bin', op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      i++;
      return { k: 'neg', a: unary() };
    }
    if (isOp('+')) {
      i++;
      return unary();
    }
    return power();
  };
  const power = (): Node => {
    const a = atom();
    if (isOp('^')) {
      i++;
      return { k: 'bin', op: '^', a, b: unary() };
    }
    return a;
  };
  const atom = (): Node => {
    const t = toks[i++];
    if (!t) throw new ExprError(`unexpected end of ${JSON.stringify(src)}`);
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'name') {
      if (!vars.includes(t.v)) {
        throw new ExprError(
          `unknown variable ${t.v} in ${JSON.stringify(src)} (allowed: ${vars.join(', ') || 'none'})`,
        );
      }
      return { k: 'var', name: t.v };
    }
    if (t.v === '(') {
      const e = sum();
      if (!isOp(')')) throw new ExprError(`missing ) in ${JSON.stringify(src)}`);
      i++;
      return e;
    }
    throw new ExprError(`unexpected ${t.v} in ${JSON.stringify(src)}`);
  };
  const tree = sum();
  if (i !== toks.length) throw new ExprError(`unexpected ${(toks[i] as Token).v} in ${JSON.stringify(src)}`);
  return tree;
}

export interface Compiled {
  /** The expression's bytes: header and ops (10 §15.2). */
  code: Uint8Array;
  /** The source, normalised (a number becomes its decimal form). */
  source: string;
  varCount: number;
  maxStack: number;
}

/** Compiles a formula field's value (a number or an expression) for the field's variables. */
export function compile(value: number | string, vars: readonly string[]): Compiled {
  const source = typeof value === 'number' ? String(value) : value;
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new ExprError(`not a finite number: ${value}`);
  const tree = typeof value === 'number' ? ({ k: 'num', v: value } as Node) : parse(value, vars);
  const ops: number[] = [];
  let depth = 0;
  let max = 0;
  const push = (): void => {
    depth++;
    if (depth > max) max = depth;
  };
  const f64 = new DataView(new ArrayBuffer(8));
  const emit = (n: Node): void => {
    switch (n.k) {
      case 'num': {
        f64.setFloat64(0, n.v, true);
        ops.push(OP_CONST);
        for (let b = 0; b < 8; b++) ops.push(f64.getUint8(b));
        push();
        return;
      }
      case 'var':
        ops.push(OP_VAR, vars.indexOf(n.name));
        push();
        return;
      case 'neg':
        emit(n.a);
        ops.push(OP_NEG);
        return;
      case 'bin':
        emit(n.a);
        emit(n.b);
        ops.push({ '+': OP_ADD, '-': OP_SUB, '*': OP_MUL, '/': OP_DIV, '^': OP_POWI }[n.op]);
        depth--;
        return;
    }
  };
  emit(tree);
  ops.push(OP_END);
  if (max > MAX_STACK)
    throw new ExprError(`${JSON.stringify(source)} needs a stack of ${max} (at most ${MAX_STACK})`);
  if (ops.length > 0xffff)
    throw new ExprError(`${JSON.stringify(source)} compiles to more than 65,535 bytes`);
  const code = new Uint8Array(HEADER_BYTES + ops.length);
  code[0] = ops.length & 0xff;
  code[1] = ops.length >> 8;
  code[2] = vars.length;
  code[3] = max;
  code.set(ops, HEADER_BYTES);
  return { code, source, varCount: vars.length, maxStack: max };
}

/** det::powi: multiplies left to right |n| times, then takes the reciprocal for negative n. */
export function powi(x: number, n: number): number {
  const k = Math.max(-POWI_LIMIT, Math.min(POWI_LIMIT, n));
  let r = 1;
  for (let i = 0; i < Math.abs(k); i++) r *= x;
  return k < 0 ? 1 / r : r;
}

/** A power's exponent as det::expr reads it: truncated toward zero (NaN → 0), clamped to ±1,024. */
export function exponent(e: number): { n: number; clean: boolean } {
  let n = Number.isNaN(e) ? 0 : Math.trunc(e);
  if (n > POWI_LIMIT) n = POWI_LIMIT;
  if (n < -POWI_LIMIT) n = -POWI_LIMIT;
  if (Object.is(n, -0)) n = 0;
  return { n, clean: n === e };
}

export interface Evaluated {
  value: number;
  flags: number;
}

/** What `run` saw of the powers it evaluated, for the data stage's checks. */
export interface PowerTrace {
  /** A power had a non-integer exponent (a data-stage error, 10 §2.4). */
  nonInteger: boolean;
  /** The largest exponent magnitude before clamping. */
  maxAbs: number;
}

/** A decoded program: validated once, then run many times without allocating. */
export class Program {
  private readonly ops: Uint8Array;
  private readonly args: Float64Array;
  private readonly stack: Float64Array;
  readonly varCount: number;

  constructor(code: Uint8Array) {
    const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
    if (code.length < HEADER_BYTES) throw new ExprError('truncated expression');
    const len = view.getUint16(0, true);
    this.varCount = code[2] as number;
    const maxStack = code[3] as number;
    if (code.length < HEADER_BYTES + len) throw new ExprError('truncated expression');
    if (maxStack > MAX_STACK) throw new ExprError('stack overflow');
    const ops: number[] = [];
    const args: number[] = [];
    let pc = HEADER_BYTES;
    const end = HEADER_BYTES + len;
    let sp = 0;
    let ended = false;
    while (pc < end) {
      const op = code[pc++] as number;
      if (ended) throw new ExprError('bytes after END');
      switch (op) {
        case OP_CONST:
          if (pc + 8 > end) throw new ExprError('truncated constant');
          args.push(view.getFloat64(pc, true));
          pc += 8;
          sp++;
          break;
        case OP_VAR: {
          if (pc >= end) throw new ExprError('truncated variable');
          const k = code[pc++] as number;
          if (k >= this.varCount) throw new ExprError(`bad variable ${k}`);
          args.push(k);
          sp++;
          break;
        }
        case OP_ADD:
        case OP_SUB:
        case OP_MUL:
        case OP_DIV:
        case OP_POWI:
          if (sp < 2) throw new ExprError('stack underflow');
          sp--;
          args.push(0);
          break;
        case OP_NEG:
          if (sp < 1) throw new ExprError('stack underflow');
          args.push(0);
          break;
        case OP_END:
          if (sp !== 1) throw new ExprError('END must leave exactly one value');
          ended = true;
          args.push(0);
          break;
        default:
          throw new ExprError(`bad opcode 0x${op.toString(16)}`);
      }
      if (sp > maxStack) throw new ExprError('stack overflow');
      ops.push(op);
    }
    if (!ended) throw new ExprError('no END');
    this.ops = Uint8Array.from(ops);
    this.args = Float64Array.from(args);
    this.stack = new Float64Array(MAX_STACK);
  }

  /** Runs without clamping: the raw result and the exponent flag (det::expr::eval before its clamp). */
  exec(vars: ArrayLike<number>, trace?: PowerTrace): Evaluated {
    if (this.varCount > vars.length) throw new ExprError(`expression needs ${this.varCount} variables`);
    const { ops, args, stack } = this;
    let sp = 0;
    let flags = 0;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op === OP_CONST) stack[sp++] = args[i] as number;
      else if (op === OP_VAR) stack[sp++] = vars[args[i] as number] as number;
      else if (op === OP_NEG) stack[sp - 1] = -(stack[sp - 1] as number);
      else if (op === OP_END) break;
      else {
        const b = stack[--sp] as number;
        const a = stack[sp - 1] as number;
        if (op === OP_ADD) stack[sp - 1] = a + b;
        else if (op === OP_SUB) stack[sp - 1] = a - b;
        else if (op === OP_MUL) stack[sp - 1] = a * b;
        else if (op === OP_DIV) stack[sp - 1] = a / b;
        else {
          const e = exponent(b);
          if (!e.clean) flags |= FLAG_EXPONENT;
          if (trace) {
            if (!Number.isInteger(b)) trace.nonInteger = true;
            const m = Number.isNaN(b) ? Number.POSITIVE_INFINITY : Math.abs(b);
            if (m > trace.maxAbs) trace.maxAbs = m;
          }
          stack[sp - 1] = powi(a, e.n);
        }
      }
    }
    return { value: stack[0] as number, flags };
  }
}

/**
 * Runs the bytecode without clamping: the raw result and the exponent flag. Malformed bytecode throws;
 * the compiler never writes it.
 */
export function run(code: Uint8Array, vars: readonly number[], trace?: PowerTrace): Evaluated {
  return new Program(code).exec(vars, trace);
}

/** Clamps a result to a range: NaN → lo, below → lo, above → hi (10 §15.2). */
export function clamp(v: number, r: Range): Evaluated {
  if (Number.isNaN(v)) return { value: r.lo, flags: FLAG_NAN };
  if (v < r.lo) return { value: r.lo, flags: FLAG_CLAMPED };
  if (v > r.hi) return { value: r.hi, flags: FLAG_CLAMPED };
  return { value: v, flags: 0 };
}

/** The reference interpreter: what det::expr::eval returns, bit for bit. */
export function evaluate(code: Uint8Array, vars: readonly number[], range: Range): Evaluated {
  const raw = run(code, vars);
  const c = clamp(raw.value, range);
  return { value: c.value, flags: raw.flags | c.flags };
}

/**
 * A unit count: the value rounded half up (10 §5.12), from its fractional part (C1a-r1 finding 7).
 * `Math.floor(v + 0.5)` is wrong where v + 0.5 rounds: 2^52 + 1 gives 2^52 + 2, and 0.49999999999999994
 * gives 1. `v - floor(v)` is exact for every finite double, so this rounds every value correctly. Its Rust
 * twin is det::unit_count; both are pinned by test/fixtures/expr/unit-counts.yaml.
 */
export function unitCount(v: number): number {
  const f = Math.floor(v);
  return v - f >= 0.5 ? f + 1 : f;
}

/** Whether the compiled code contains a power (its results may differ from libm's pow in the last bits). */
export function hasPower(code: Uint8Array): boolean {
  let pc = HEADER_BYTES;
  while (pc < code.length) {
    const op = code[pc++];
    if (op === OP_CONST) pc += 8;
    else if (op === OP_VAR) pc += 1;
    else if (op === OP_POWI) return true;
  }
  return false;
}
