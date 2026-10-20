// Sample values for the codec fixtures (10 §15.1 "Cross-language fixtures", D18 g). Every record type gets
// deterministic values in three variants: `zero` (minima, empty lists, the first enum value), `mixed`
// (pseudo-random values within every declared constraint, short lists, non-ASCII strings) and, for
// actions, `max` (every field at its limit: largest values, maximum counts and lengths). The generator
// writes the same values as Rust and TypeScript literals (samples-rust.ts, samples-ts.ts) and encodes them
// with the reference codec (refcodec.ts) into test/fixtures/codec/; each language's tests decode those
// bytes, compare with its own literals, and re-encode them byte for byte.
import {
  type Decl,
  type Field,
  fixedSize,
  intRange,
  isFloat,
  isWide,
  type MessageDecl,
  pow2,
  type RecordDecl,
  type Scalar,
  type Schema,
  type StructDecl,
  scalarOf,
  type Ty,
  valueFields,
} from './model.ts';

export type Variant = 'zero' | 'mixed' | 'max';

/** A sample value: numbers, bigints, booleans, strings, Uint8Arrays, arrays and plain objects. */
export type Value =
  | number
  | bigint
  | boolean
  | string
  | Uint8Array
  | Value[]
  | { [k: string]: Value }
  | undefined;

export interface Sample {
  /** The type's name (a declaration, or `action:<name>`). */
  type: string;
  variant: Variant;
  decl: StructDecl | MessageDecl | RecordDecl;
  value: { [k: string]: Value };
}

/** A small deterministic PRNG (xorshift32), seeded from a string. */
class Rng {
  private s: number;
  constructor(seed: string) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
    this.s = h || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }
  /** An integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    if (hi <= lo) return lo;
    const span = hi - lo + 1;
    if (span <= 0x100000000) return lo + (this.next() % span);
    return lo + Math.floor((this.next() / 0x100000000) * span);
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.next() % xs.length] as T;
  }
}

const TEXTS = [
  '',
  'a',
  'Iron plate',
  'é',
  'Ünïcode ✓',
  '漢字',
  'tab\there',
  'quote " and \\ backslash',
  '🙂 emoji',
];
const MIXED_LIST = 2;
const STRUCT_LIST = 3;

function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** A string of exactly `n` UTF-8 bytes, mostly two-byte characters. */
export function maxString(n: number): string {
  return 'é'.repeat(Math.floor(n / 2)) + (n % 2 ? 'a' : '');
}

interface Ctx {
  rng: Rng;
  variant: Variant;
  /** Lists at their maxima (actions' max variant). */
  limits: boolean;
}

function intValue(c: Ctx, s: Scalar, f: Field | null): number | bigint {
  const [lo, hi] = intRange(s as never);
  let a = lo;
  let b = hi;
  if (f?.range) {
    a = BigInt(f.range[0]);
    b = BigInt(f.range[1]);
  }
  if (f?.allowed) {
    const xs = f.allowed;
    const v =
      c.variant === 'zero' ? (xs[0] as number) : c.variant === 'max' ? Math.max(...xs) : c.rng.pick(xs);
    return isWide(s) ? BigInt(v) : v;
  }
  let v: bigint;
  if (c.variant === 'zero') v = a < 0n && b > 0n ? 0n : a;
  else if (c.variant === 'max') v = b;
  else {
    const span = b - a;
    const r = BigInt(c.rng.next()) * BigInt(c.rng.next());
    v = a + (span > 0n ? r % (span + 1n) : 0n);
  }
  return isWide(s) ? v : Number(v);
}

function floatValue(c: Ctx, s: Scalar): number {
  if (c.variant === 'zero') return 0;
  if (c.variant === 'max') return s === 'f32' ? 3.4028234663852886e38 : 1.7976931348623157e308;
  const v = (c.rng.int(-1_000_000, 1_000_000) / 64) * (c.rng.next() % 2 ? 1 : 1.0000001);
  return s === 'f32' ? Math.fround(v) : v;
}

function bytesOf(c: Ctx, n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = c.variant === 'max' ? 0xab : c.rng.next() & 0xff;
  return b;
}

function listLen(c: Ctx, max: number, item: Ty): number {
  if (c.variant === 'zero') return 0;
  if (c.variant === 'max')
    return c.limits ? max : Math.min(max, item.k === 'scalar' || item.k === 'id' ? STRUCT_LIST : 2);
  return Math.min(max, item.k === 'struct' || item.k === 'scalar' ? STRUCT_LIST : MIXED_LIST);
}

/** A value of type `t`. `field` carries the constraints of the field it fills. */
export function sampleValue(c: Ctx, t: Ty, field: Field | null): Value {
  switch (t.k) {
    case 'scalar':
      if (t.s === 'bool')
        return c.variant === 'max' ? true : c.variant === 'zero' ? false : c.rng.next() % 2 === 1;
      if (isFloat(t.s)) return floatValue(c, t.s);
      return intValue(c, t.s, field);
    case 'id':
      return intValue(c, t.d.base, field);
    case 'enum': {
      const vs = t.d.values.filter((v) => !field?.allowed || field.allowed.includes(v.value));
      const v =
        c.variant === 'zero'
          ? (vs[0] as { value: number })
          : c.variant === 'max'
            ? vs.reduce((m, x) => (x.value > m.value ? x : m))
            : c.rng.pick(vs);
      return isWide(t.d.base) ? BigInt(v.value) : v.value;
    }
    case 'flags': {
      if (c.variant === 'zero') return 0;
      const bits = t.d.bits.filter(() => c.variant === 'max' || c.rng.next() % 2 === 1);
      return bits.reduce((a, b) => a + pow2(b.bit), 0);
    }
    case 'struct':
      return structValue(c, t.d);
    case 'array': {
      // Long arrays repeat one value (their literals stay short); short ones vary per item.
      if (t.n > 64) {
        const one = sampleValue(c, t.of, null);
        if (t.of.k === 'scalar' && t.of.s === 'u8') return new Uint8Array(t.n).fill(one as number);
        return Array.from({ length: t.n }, () => one);
      }
      if (t.of.k === 'scalar' && t.of.s === 'u8') return bytesOf(c, t.n);
      return Array.from({ length: t.n }, () => sampleValue(c, t.of, null));
    }
    case 'message':
      return messageValue(c, t.d);
    case 'record':
      return recordValue(c, t.d);
    case 'str':
      if (c.variant === 'zero') return '';
      if (c.variant === 'max') return c.limits ? maxString(t.max) : maxString(Math.min(t.max, 9));
      return pickText(c, t.max);
    case 'bytes': {
      const n =
        c.variant === 'zero'
          ? 0
          : c.variant === 'max'
            ? c.limits
              ? t.max
              : Math.min(t.max, 5)
            : Math.min(t.max, 3);
      return bytesOf(c, n);
    }
    case 'list': {
      const n = listLen(c, t.max, t.of);
      if (t.of.k === 'str') {
        const xs = new Set<string>();
        let i = 0;
        while (xs.size < n && i < 100) {
          xs.add(`${pickText(c, t.of.max - 3)}${i}`);
          i++;
        }
        return [...xs].sort(byUtf8);
      }
      const items = Array.from({ length: n }, () => sampleValue(c, t.of, null));
      return field?.order === 'key' ? makeAscending(t.of, items) : items;
    }
    case 'blob_or_bytes':
      if (c.variant === 'mixed') return { blob: bytesOf(c, 32) };
      return { bytes: bytesOf(c, c.variant === 'max' ? (c.limits ? t.max : 4) : 0) };
    case 'counted':
    case 'rest':
      throw new Error('counted arrays are filled by their message');
  }
}

function pickText(c: Ctx, max: number): string {
  for (let i = 0; i < 20; i++) {
    const s = c.rng.pick(TEXTS);
    if (utf8Len(s) <= max) return s;
  }
  return '';
}

function byUtf8(a: string, b: string): number {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  return x.length - y.length;
}

/** Makes a keyed list strictly ascending (§8.1): sorts, then nudges the first field of duplicates up. */
function makeAscending(t: Ty, items: Value[]): Value[] {
  if (t.k !== 'struct' && t.k !== 'record') {
    const xs = [...new Set(items as (number | bigint)[])];
    return xs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
  const first = valueFields(t.d.fields)[0] as Field;
  const s = scalarOf(first.ty);
  // Give the leading field distinct, increasing values within its range.
  const lo = first.range ? first.range[0] : 0;
  return items.map((it, i) => {
    const o = { ...(it as { [k: string]: Value }) };
    if (s !== null && first.ty.k !== 'enum') o[first.name] = isWide(s) ? BigInt(lo + i) : lo + i;
    else if (first.ty.k === 'enum') {
      const vs = first.ty.d.values;
      o[first.name] = (vs[Math.min(i, vs.length - 1)] as { value: number }).value;
    }
    return o;
  });
}

function structValue(c: Ctx, d: StructDecl): { [k: string]: Value } {
  const v: { [k: string]: Value } = {};
  for (const f of valueFields(d.fields)) v[f.name] = sampleValue(c, f.ty, f);
  if (d.check === 'entity_ref') {
    // A well-formed EntityRef (§15.3) in each variant: none, a serial or a creation id.
    const tag = c.variant === 'zero' ? 0 : c.variant === 'max' ? 2 : 1 + (c.rng.next() % 2);
    v.tag = tag;
    if (tag === 0) {
      v.a = 0;
      v.b = 0;
    } else if (tag === 1) {
      v.a = c.variant === 'max' ? 0xffffffff : c.rng.int(1, 0xffffffff);
      v.b = 0;
    }
  }
  return v;
}

function messageValue(c: Ctx, d: MessageDecl): { [k: string]: Value } {
  const v: { [k: string]: Value } = {};
  const counts = new Map<string, number>();
  for (const f of d.fields) {
    if (f.reserved || f.hidden) continue;
    if (f.when) {
      const bit = (d.fields.find((x) => x.name === f.when?.field) as Field).ty as {
        d: { bits: { name: string; bit: number }[] };
      };
      const b = bit.d.bits.find((x) => x.name === f.when?.bit) as { bit: number };
      const flags = (v[f.when.field] as number) ?? 0;
      const on = c.variant !== 'zero';
      v[f.when.field] = on ? flags | pow2(b.bit) : flags & ~pow2(b.bit);
      if (on) v[f.name] = sampleValue(c, f.ty, f);
      continue;
    }
    if (f.ty.k === 'counted') {
      const cf = d.fields.find((x) => x.name === (f.ty as { count: string }).count) as Field;
      let n = counts.get(cf.name);
      if (n === undefined) {
        const s = scalarOf(cf.ty) as Scalar;
        const hi = cf.range ? cf.range[1] : Number(intRange(s as never)[1]);
        n =
          c.variant === 'zero'
            ? cf.range
              ? cf.range[0]
              : 0
            : Math.min(hi, c.variant === 'max' ? 4 : 2 + (c.rng.next() % 2));
        counts.set(cf.name, n);
      }
      const len = Math.max(0, n - f.ty.minus);
      if (f.ty.of.k === 'scalar' && f.ty.of.s === 'u8') v[f.name] = bytesOf(c, len);
      else v[f.name] = Array.from({ length: len }, () => sampleValue(c, (f.ty as { of: Ty }).of, null));
      continue;
    }
    if (f.ty.k === 'rest') {
      const n = c.variant === 'zero' ? 0 : 3;
      if (f.ty.of.k === 'scalar' && f.ty.of.s === 'u8') v[f.name] = bytesOf(c, n);
      else v[f.name] = Array.from({ length: n }, () => sampleValue(c, (f.ty as { of: Ty }).of, null));
      continue;
    }
    v[f.name] = sampleValue(c, f.ty, f);
  }
  return v;
}

function recordValue(c: Ctx, d: RecordDecl): { [k: string]: Value } {
  const v: { [k: string]: Value } = {};
  for (const f of d.fields) v[f.name] = sampleValue(c, f.ty, f);
  return v;
}

/** The sample values of every record type, in a fixed order (by name, then variant). */
export function samples(s: Schema): Sample[] {
  const out: Sample[] = [];
  const variants: Variant[] = ['zero', 'mixed'];
  for (const name of s.names) {
    const d = s.decls.get(name) as Decl;
    if (d.kind !== 'struct' && d.kind !== 'message' && d.kind !== 'record') continue;
    const isAction = s.actions.some((a) => a.msg === d);
    for (const variant of isAction ? [...variants, 'max' as Variant] : variants) {
      const c: Ctx = { rng: new Rng(`${name}/${variant}`), variant, limits: isAction && variant === 'max' };
      const value =
        d.kind === 'struct'
          ? structValue(c, d)
          : d.kind === 'message'
            ? messageValue(c, d)
            : recordValue(c, d);
      out.push({ type: name, variant, decl: d, value });
    }
  }
  return out;
}

/** The sample's encoded size bound, to keep fixtures small: types whose zero sample is unbounded are skipped. */
export function fixedOrNull(d: Decl): number | null {
  return d.kind === 'struct' ? d.size : d.kind === 'message' ? d.fixed : null;
}
void fixedSize;
