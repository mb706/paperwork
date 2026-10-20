// The reference codec: a generic interpreter of the resolved layouts (model.ts), independent of the
// emitted code. The generator uses it to encode the sample fixtures and to decide the expected verdict of
// every limit probe; the generated Rust and TypeScript decoders must reproduce each verdict exactly (error
// kind, field and byte offset). Its checks run in the same order as the generated decoders'.
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
  SCALAR_SIZE,
  type Scalar,
  type Schema,
  type StructDecl,
  scalarOf,
  type Ty,
  typeName,
  valueFields,
} from './model.ts';
import type { Value } from './samples.ts';

export class RefError extends Error {
  readonly kind: string;
  readonly field: string;
  readonly at: number;
  constructor(kind: string, field: string, at: number) {
    super(`${kind} ${field} @${at}`);
    this.kind = kind;
    this.field = field;
    this.at = at;
  }
}

// ------------------------------------------------------------------------------------------- writer

/** Raw overrides an unchecked encoding may carry: `__reserved` sets reserved fields, `__raw` replaces a field's bytes. */
export interface Overrides {
  __reserved?: Record<string, number>;
  __raw?: Record<string, Uint8Array>;
}

export class RefWriter {
  private buf = new Uint8Array(256);
  private n = 0;
  get pos(): number {
    return this.n;
  }
  private grow(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + k) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
  }
  push(x: number): void {
    this.grow(1);
    this.buf[this.n++] = x & 0xff;
  }
  bytes(b: Uint8Array | readonly number[]): void {
    this.grow(b.length);
    if (b instanceof Uint8Array) this.buf.set(b, this.n);
    else for (let i = 0; i < b.length; i++) this.buf[this.n + i] = (b[i] as number) & 0xff;
    this.n += b.length;
  }
  int(s: Scalar, v: number | bigint): void {
    const n = SCALAR_SIZE[s];
    let x = BigInt(v);
    if (x < 0n) x += 1n << BigInt(n * 8);
    for (let i = 0; i < n; i++) {
      this.push(Number(x & 0xffn));
      x >>= 8n;
    }
  }
  float(s: Scalar, v: number): void {
    const dv = new DataView(new ArrayBuffer(8));
    if (s === 'f32') {
      dv.setFloat32(0, v, true);
      this.bytes(new Uint8Array(dv.buffer, 0, 4));
    } else {
      dv.setFloat64(0, v, true);
      this.bytes(new Uint8Array(dv.buffer, 0, 8));
    }
  }
  scalar(s: Scalar, v: Value): void {
    if (s === 'bool') this.int('u8', typeof v === 'boolean' ? (v ? 1 : 0) : (v as number));
    else if (isFloat(s)) this.float(s, v as number);
    else this.int(s, v as number | bigint);
  }
  pad(start: number, align: number): void {
    while ((this.pos - start) % align !== 0) this.push(0);
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

/** A length or count with no data after it: an overflow probe's `max + 1` (decoders refuse the count first). */
export interface CountOnly {
  __count: number;
}
const countOnly = (v: Value): number | null =>
  typeof v === 'object' && v !== null && !(v instanceof Uint8Array) && !Array.isArray(v) && '__count' in v
    ? ((v as unknown as CountOnly).__count as number)
    : null;

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Encodes a value of type `t`. Unchecked: values are written as given (probes make invalid bytes this way). */
export function encodeTy(
  w: RefWriter,
  t: Ty,
  v: Value,
  fields: readonly Field[] = [],
  obj: { [k: string]: Value } = {},
): void {
  switch (t.k) {
    case 'scalar':
      w.scalar(t.s, v);
      return;
    case 'id':
    case 'enum':
    case 'flags':
      w.int(t.d.base, v as number | bigint);
      return;
    case 'struct':
      encodeFields(w, t.d.fields, v as { [k: string]: Value }, false);
      return;
    case 'array':
      if (v instanceof Uint8Array) {
        w.bytes(v);
        return;
      }
      for (const x of v as Value[]) encodeTy(w, t.of, x);
      return;
    case 'message':
      encodeMessage(w, t.d, v as { [k: string]: Value });
      return;
    case 'record':
      encodeRecord(w, t.d, v as { [k: string]: Value });
      return;
    case 'str': {
      const c = countOnly(v);
      if (c !== null) {
        w.int('u16', c);
        return;
      }
      const b = v instanceof Uint8Array ? v : utf8(v as string);
      w.int('u16', b.length);
      w.bytes(b);
      return;
    }
    case 'bytes': {
      const c = countOnly(v);
      if (c !== null) {
        w.int(t.lenWidth === 2 ? 'u16' : 'u32', c);
        return;
      }
      const b = v as Uint8Array;
      w.int(t.lenWidth === 2 ? 'u16' : 'u32', b.length);
      w.bytes(b);
      return;
    }
    case 'list': {
      const c = countOnly(v);
      if (c !== null) {
        w.int(t.countWidth === 2 ? 'u16' : 'u32', c);
        return;
      }
      const xs = v as Value[];
      w.int(t.countWidth === 2 ? 'u16' : 'u32', xs.length);
      for (const x of xs) encodeTy(w, t.of, x);
      return;
    }
    case 'blob_or_bytes': {
      const o = v as { bytes?: Uint8Array | CountOnly; blob?: Uint8Array; tag?: number };
      if (o.tag !== undefined) {
        w.int('u8', o.tag);
        return;
      }
      if (o.bytes && !(o.bytes instanceof Uint8Array)) {
        w.int('u8', 0);
        w.int('u16', o.bytes.__count);
        return;
      }
      if (o.blob) {
        w.int('u8', 1);
        w.bytes(o.blob);
        return;
      }
      w.int('u8', 0);
      w.int('u16', (o.bytes as Uint8Array).length);
      w.bytes(o.bytes as Uint8Array);
      return;
    }
    case 'counted':
    case 'rest':
      if (v instanceof Uint8Array) {
        w.bytes(v);
        return;
      }
      for (const x of v as Value[]) encodeTy(w, t.of, x);
      return;
  }
  void fields;
  void obj;
}

function encodeFields(
  w: RefWriter,
  fields: readonly Field[],
  v: { [k: string]: Value } & Overrides,
  message: boolean,
): void {
  const counts = new Map<string, number>();
  if (message)
    for (const f of fields)
      if (f.ty.k === 'counted') {
        const arr = v[f.name] as Value[] | Uint8Array;
        const n = arr.length + (arr.length === 0 ? 0 : f.ty.minus);
        if (!counts.has(f.ty.count)) counts.set(f.ty.count, n);
      }
  for (const f of fields) {
    const raw = v.__raw?.[f.name];
    if (raw) {
      w.bytes(raw);
      continue;
    }
    if (f.reserved) {
      const n = fixedSize(f.ty) as number;
      w.int(scalarOf(f.ty) as Scalar, v.__reserved?.[f.name] ?? 0);
      void n;
      continue;
    }
    if (f.hidden) {
      const over = v[f.name];
      w.int(scalarOf(f.ty) as Scalar, (over as number | undefined) ?? counts.get(f.name) ?? 0);
      continue;
    }
    if (f.when) {
      if (v[f.name] !== undefined) encodeTy(w, f.ty, v[f.name]);
      continue;
    }
    encodeTy(w, f.ty, v[f.name], fields, v);
  }
}

export function encodeMessage(w: RefWriter, d: MessageDecl, v: { [k: string]: Value } & Overrides): void {
  const start = w.pos;
  encodeFields(w, d.fields, v, true);
  if (d.padTo) {
    const pad = (v as { __pad?: number }).__pad;
    if (pad !== undefined) {
      w.pad(start, d.padTo);
      if ((w.pos - start) % d.padTo === 0 && w.pos > start) {
        // Overwrite the last padding byte with a nonzero value when the record had padding.
      }
    } else w.pad(start, d.padTo);
  }
}

/** Record mutations for probes: the triples to write, in order, as (id, bytes). */
export interface RecordMutation {
  /** Edits the list of triples before they are written. */
  edit?: (triples: [number, Uint8Array][]) => [number, Uint8Array][];
}

export function encodeRecord(
  w: RefWriter,
  d: RecordDecl,
  v: { [k: string]: Value },
  m?: RecordMutation,
): void {
  let triples: [number, Uint8Array][] = d.fields.map((f) => {
    const fw = new RefWriter();
    encodeTy(fw, f.ty, v[f.name]);
    return [f.id as number, fw.finish()];
  });
  if (m?.edit) triples = m.edit(triples);
  const body = new RefWriter();
  for (const [id, b] of triples) {
    body.int('u16', id);
    body.int('u32', b.length);
    body.bytes(b);
  }
  const bb = body.finish();
  w.int('u32', bb.length);
  w.bytes(bb);
}

export function encodeDecl(d: StructDecl | MessageDecl | RecordDecl, v: { [k: string]: Value }): Uint8Array {
  const w = new RefWriter();
  if (d.kind === 'struct') encodeFields(w, d.fields, v, false);
  else if (d.kind === 'message') encodeMessage(w, d, v);
  else encodeRecord(w, d, v);
  return w.finish();
}

// ------------------------------------------------------------------------------------------- reader

class RefReader {
  readonly b: Uint8Array;
  p = 0;
  readonly base: number;
  constructor(b: Uint8Array, base = 0) {
    this.b = b;
    this.base = base;
  }
  get pos(): number {
    return this.base + this.p;
  }
  get remaining(): number {
    return this.b.length - this.p;
  }
  take(n: number, field: string): Uint8Array {
    if (n > this.remaining) throw new RefError('truncated', field, this.pos);
    const x = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return x;
  }
  sub(n: number, field: string): RefReader {
    const base = this.pos;
    return new RefReader(this.take(n, field), base);
  }
  int(s: Scalar, field: string): bigint {
    const x = this.take(SCALAR_SIZE[s], field);
    let v = 0n;
    for (let i = x.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(x[i] as number);
    if (s.startsWith('i') && x.length > 0) {
      const bits = BigInt(x.length * 8);
      if (v >= 1n << (bits - 1n)) v -= 1n << bits;
    }
    return v;
  }
  num(s: Scalar, field: string): number | bigint {
    const v = this.int(s, field);
    return isWide(s) ? v : Number(v);
  }
  float(s: Scalar, field: string): number {
    const at = this.pos;
    const x = this.take(s === 'f32' ? 4 : 8, field);
    const dv = new DataView(x.buffer, x.byteOffset, x.byteLength);
    const v = s === 'f32' ? dv.getFloat32(0, true) : dv.getFloat64(0, true);
    if (Number.isNaN(v)) throw new RefError('not_a_number', field, at);
    return v;
  }
  zeros(n: number, field: string): void {
    const at = this.pos;
    if (this.take(n, field).some((x) => x !== 0)) throw new RefError('reserved', field, at);
  }
  count(width: number, field: string): number {
    return Number(this.int(width === 2 ? 'u16' : 'u32', field));
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Decodes a value of type `t` as the generated decoders do. `owned`: record context. */
function decodeTy(
  r: RefReader,
  t: Ty,
  p: string,
  fields: readonly Field[],
  locals: Map<string, Value>,
  strict: boolean,
): Value {
  switch (t.k) {
    case 'scalar':
      if (t.s === 'bool') {
        const at = r.pos;
        const v = Number(r.int('u8', p));
        if (v > 1) throw new RefError('bad_bool', p, at);
        return v === 1;
      }
      if (isFloat(t.s)) return r.float(t.s, p);
      return r.num(t.s, p);
    case 'id':
      return r.num(t.d.base, p);
    case 'enum': {
      const at = r.pos;
      const v = Number(r.int(t.d.base, p));
      if (!t.d.values.some((x) => x.value === v)) throw new RefError('bad_enum', p, at);
      return v;
    }
    case 'flags': {
      const at = r.pos;
      const v = Number(r.int(t.d.base, p));
      const all = t.d.bits.reduce((a, b) => a + pow2(b.bit), 0);
      if ((v & ~all) >>> 0 !== 0) throw new RefError('bad_flags', p, at);
      return v;
    }
    case 'struct':
      return decodeStruct(r, t.d);
    case 'array': {
      if (t.of.k === 'scalar' && t.of.s === 'u8') return r.take(t.n, p).slice();
      const out: Value[] = [];
      for (let i = 0; i < t.n; i++) out.push(decodeTy(r, t.of, p, fields, locals, strict));
      return out;
    }
    case 'message':
      return decodeMessage(r, t.d);
    case 'record':
      return decodeRecord(r, t.d, strict);
    case 'str': {
      const at = r.pos;
      const n = r.count(2, p);
      if (n > t.max) throw new RefError('too_long', p, at);
      const b = r.take(n, p);
      try {
        return UTF8.decode(b);
      } catch {
        throw new RefError('bad_utf8', p, at);
      }
    }
    case 'bytes': {
      const at = r.pos;
      const n = r.count(t.lenWidth, p);
      if (n > t.max) throw new RefError('too_long', p, at);
      return r.take(n, p).slice();
    }
    case 'list': {
      const at = r.pos;
      const n = r.count(t.countWidth, p);
      if (n > t.max) throw new RefError('too_long', p, at);
      const size =
        t.of.k === 'message' || t.of.k === 'record' || t.of.k === 'str' ? 0 : (fixedSize(t.of) ?? 0);
      if (size > 0 && n * size > r.remaining) throw new RefError('truncated', p, r.pos);
      const out: Value[] = [];
      for (let i = 0; i < n; i++)
        out.push(
          t.of.k === 'str'
            ? decodeTy(r, t.of, p, fields, locals, strict)
            : decodeTy(r, t.of, p, fields, locals, strict),
        );
      return out;
    }
    case 'blob_or_bytes': {
      const at = r.pos;
      const tag = Number(r.int('u8', p));
      if (tag === 0) {
        const a2 = r.pos;
        const n = r.count(2, p);
        if (n > t.max) throw new RefError('too_long', p, a2);
        return { bytes: r.take(n, p).slice() };
      }
      if (tag === 1) return { blob: r.take(32, p).slice() };
      throw new RefError('bad_enum', p, at);
    }
    case 'counted': {
      const base = Number(locals.get(t.count));
      const n = t.minus ? Math.max(0, base - t.minus) : base;
      if (t.of.k === 'scalar' && t.of.s === 'u8') return r.take(n, p).slice();
      const size = t.of.k === 'message' ? 0 : (fixedSize(t.of) ?? 0);
      if (size > 0 && n * size > r.remaining) throw new RefError('truncated', p, r.pos);
      const out: Value[] = [];
      for (let i = 0; i < n; i++) out.push(decodeTy(r, t.of, p, fields, locals, strict));
      return out;
    }
    case 'rest': {
      if (t.of.k === 'scalar' && t.of.s === 'u8') return r.take(r.remaining, p).slice();
      const size = fixedSize(t.of) as number;
      if (r.remaining % size !== 0) throw new RefError('bad_length', p, r.pos);
      const out: Value[] = [];
      const n = r.remaining / size;
      for (let i = 0; i < n; i++) out.push(decodeTy(r, t.of, p, fields, locals, strict));
      return out;
    }
  }
}

function rangeCheck(f: Field, v: Value, p: string, at: number): void {
  const x = typeof v === 'bigint' ? Number(v) : (v as number);
  if (f.range && (x < f.range[0] || x > f.range[1])) throw new RefError('range', p, at);
  if (f.allowed && !f.allowed.includes(x)) throw new RefError('range', p, at);
}

function decodeFields(r: RefReader, owner: string, fields: readonly Field[]): { [k: string]: Value } {
  const out: { [k: string]: Value } = {};
  const locals = new Map<string, Value>();
  for (const f of fields) {
    const p = `${owner}.${f.name}`;
    if (f.reserved) {
      r.zeros(fixedSize(f.ty) as number, p);
      continue;
    }
    const at = r.pos;
    let v: Value;
    if (f.when) {
      const flags = locals.get(f.when.field) as number;
      const fd = (fields.find((x) => x.name === f.when?.field) as Field).ty as {
        d: { bits: { name: string; bit: number }[] };
      };
      const bit = (fd.d.bits.find((b) => b.name === f.when?.bit) as { bit: number }).bit;
      v = (flags & pow2(bit)) !== 0 ? decodeTy(r, f.ty, p, fields, locals, true) : undefined;
    } else v = decodeTy(r, f.ty, p, fields, locals, true);
    if (f.range || f.allowed) rangeCheck(f, v, p, at);
    locals.set(f.name, v);
    if (!f.hidden && v !== undefined) out[f.name] = v;
  }
  return out;
}

export function decodeStruct(r: RefReader, d: StructDecl): { [k: string]: Value } {
  const start = r.pos;
  const v = decodeFields(r, d.name, d.fields);
  if (d.check === 'entity_ref') {
    const tag = v.tag as number;
    const a = v.a as number;
    const b = v.b as number;
    const ok = tag === 0 ? a === 0 && b === 0 : tag === 1 ? a !== 0 && b === 0 : true;
    if (!ok) throw new RefError('bad_ref', d.name, start);
  }
  return v;
}

export function decodeMessage(r: RefReader, d: MessageDecl): { [k: string]: Value } {
  const start = r.pos;
  const v = decodeFields(r, d.name, d.fields);
  if (d.padTo) {
    const used = r.pos - start;
    r.zeros((d.padTo - (used % d.padTo)) % d.padTo, `${d.name}.padding`);
  }
  return v;
}

/** Compares two values of type `t` as the generated code orders keyed lists (§8.1): fields in order. */
function cmpTyped(t: Ty, a: Value, b: Value): number {
  if (typeof a === 'string' && typeof b === 'string') {
    const x = utf8(a);
    const y = utf8(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++)
      if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
    return x.length - y.length;
  }
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
    return a.length - b.length;
  }
  if ((t.k === 'array' || t.k === 'list') && Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = cmpTyped(t.of, a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (t.k === 'struct' || t.k === 'record' || t.k === 'message') {
    const ao = a as { [k: string]: Value };
    const bo = b as { [k: string]: Value };
    const fields = t.k === 'record' ? t.d.fields : valueFields(t.d.fields);
    for (const f of fields) {
      const c = cmpTyped(f.ty, ao[f.name], bo[f.name]);
      if (c !== 0) return c;
    }
    return 0;
  }
  const x = typeof a === 'boolean' ? Number(a) : (a as number | bigint);
  const y = typeof b === 'boolean' ? Number(b) : (b as number | bigint);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function decodeRecord(outer: RefReader, d: RecordDecl, strict: boolean): { [k: string]: Value } {
  const n = outer.count(4, d.name);
  const body = outer.sub(n, d.name);
  const out: { [k: string]: Value } = {};
  let last = 0;
  const seen = new Set<number>();
  while (body.remaining > 0) {
    const at = body.pos;
    const id = body.count(2, d.name);
    if (id <= last) throw new RefError('field_order', d.name, at);
    last = id;
    const len = body.count(4, d.name);
    const r = body.sub(len, d.name);
    const fi = d.fields.findIndex((f) => f.id === id);
    const f = d.fields[fi];
    if (!f) {
      if (strict) throw new RefError('unknown_field', d.name, at);
      continue;
    }
    const p = `${d.name}.${f.name}`;
    const v = decodeTy(r, f.ty, p, d.fields, new Map(), strict);
    if (f.range || f.allowed) rangeCheck(f, v, p, at);
    if (f.order === 'key' && f.ty.k === 'list') {
      const xs = v as Value[];
      for (let i = 1; i < xs.length; i++)
        if (cmpTyped(f.ty.of, xs[i - 1], xs[i]) >= 0) throw new RefError('unsorted', p, at);
    }
    out[f.name] = v;
    seen.add(fi);
    if (r.remaining > 0) throw new RefError('bad_length', p, r.pos);
  }
  if (strict && seen.size !== d.fields.length) {
    const i = d.fields.findIndex((_, k) => !seen.has(k));
    throw new RefError('missing_field', `${d.name}.${(d.fields[i] as Field).name}`, body.pos);
  }
  return out;
}

/** The verdict of decoding `bytes` as a whole value of `d` (strict records): "ok" or "<kind> <field> @<at>". */
export function verdict(d: StructDecl | MessageDecl | RecordDecl, bytes: Uint8Array): string {
  const r = new RefReader(bytes);
  try {
    if (d.kind === 'struct') decodeStruct(r, d);
    else if (d.kind === 'message') decodeMessage(r, d);
    else decodeRecord(r, d, true);
    if (r.remaining > 0) throw new RefError('trailing', d.kind === 'record' ? d.name : d.name, r.pos);
    return 'ok';
  } catch (e) {
    if (e instanceof RefError) return `${e.kind} ${e.field} @${e.at}`;
    throw e;
  }
}

/** The verdict of decoding a framed action (u16 type, u16 len, payload), as Action::decode does. */
export function actionVerdict(s: Schema, bytes: Uint8Array): string {
  const type = (bytes[0] as number) | ((bytes[1] as number) << 8);
  const payload = bytes.subarray(4);
  const a = s.actions.find((x) => x.id === type);
  if (!a) return 'unknown_type Action @0';
  const r = new RefReader(payload);
  try {
    decodeMessage(r, a.msg);
    if (r.remaining > 0) throw new RefError('trailing', 'Action', r.pos);
    return 'ok';
  } catch (e) {
    if (e instanceof RefError) return `${e.kind} ${e.field} @${e.at}`;
    throw e;
  }
}

/** A framed action: u16 type, u16 len, payload. */
export function frameAction(type: number, payload: Uint8Array): Uint8Array {
  const w = new RefWriter();
  w.int('u16', type);
  w.int('u16', payload.length);
  w.bytes(payload);
  return w.finish();
}

// ------------------------------------------------------------------------------------------- dump

const DV = new DataView(new ArrayBuffer(8));

function hexOf(b: Uint8Array): string {
  let x = '';
  for (const v of b) x += v.toString(16).padStart(2, '0');
  return x;
}

const asBytes = (v: Value): Uint8Array => (v instanceof Uint8Array ? v : Uint8Array.from(v as number[]));
const asList = (v: Value): Value[] => (v instanceof Uint8Array ? [...v] : (v as Value[]));

/** A string as the codecs' dumps write it: JSON's escapes, other control characters as \u00xx. */
function dumpStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (c === 8) out += '\\b';
    else if (c === 12) out += '\\f';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function dumpTy(t: Ty, v: Value, path: string, out: string[]): void {
  switch (t.k) {
    case 'scalar':
      if (t.s === 'bool') out.push(`${path}=${v ? 'true' : 'false'}`);
      else if (t.s === 'f32') {
        DV.setFloat32(0, v as number, true);
        out.push(`${path}=f32:${DV.getUint32(0, true).toString(16).padStart(8, '0')}`);
      } else if (t.s === 'f64') {
        DV.setFloat64(0, v as number, true);
        out.push(`${path}=f64:${DV.getBigUint64(0, true).toString(16).padStart(16, '0')}`);
      } else out.push(`${path}=${String(v)}`);
      return;
    case 'id':
    case 'enum':
    case 'flags':
      out.push(`${path}=${String(v)}`);
      return;
    case 'struct':
    case 'message':
    case 'record':
      dumpFields(t.d, v as { [k: string]: Value }, `${path}.`, out);
      return;
    case 'array':
      if (t.of.k === 'scalar' && t.of.s === 'u8') out.push(`${path}=hex:${hexOf(asBytes(v))}`);
      else {
        const xs = asList(v);
        for (let i = 0; i < xs.length; i++) dumpTy(t.of, xs[i], `${path}[${i}]`, out);
      }
      return;
    case 'str':
      out.push(`${path}=${dumpStr(v as string)}`);
      return;
    case 'bytes':
      out.push(`${path}=hex:${hexOf(asBytes(v))}`);
      return;
    case 'blob_or_bytes': {
      const o = v as { bytes?: Uint8Array; blob?: Uint8Array };
      if (o.blob) out.push(`${path}.blob=hex:${hexOf(o.blob)}`);
      else out.push(`${path}.bytes=hex:${hexOf(o.bytes as Uint8Array)}`);
      return;
    }
    case 'list':
    case 'counted':
    case 'rest': {
      if (t.k !== 'list' && t.of.k === 'scalar' && t.of.s === 'u8') {
        out.push(`${path}=hex:${hexOf(asBytes(v))}`);
        return;
      }
      const xs = asList(v);
      out.push(`${path}.len=${xs.length}`);
      for (let i = 0; i < xs.length; i++) dumpTy(t.of, xs[i], `${path}[${i}]`, out);
      return;
    }
  }
}

function dumpFields(
  d: StructDecl | MessageDecl | RecordDecl,
  v: { [k: string]: Value },
  prefix: string,
  out: string[],
): void {
  for (const f of d.kind === 'record' ? d.fields : valueFields(d.fields)) {
    const x = v[f.name];
    if (f.when && x === undefined) continue;
    dumpTy(f.ty, x, `${prefix}${f.name}`, out);
  }
}

/**
 * The text dump of a value (the format of the generated codecs' `dump`, written independently of them):
 * one `path=value` line per leaf; integers, ids, enums and flags as decimal numbers; floats as their
 * IEEE bits in hexadecimal; strings JSON-escaped; bytes and u8 arrays as hex; lists with a `.len` line.
 */
export function refDump(d: StructDecl | MessageDecl | RecordDecl, v: { [k: string]: Value }): string {
  const out: string[] = [];
  dumpFields(d, v, '', out);
  return out.map((l) => `${l}\n`).join('');
}

/** The dump of an action: its type's name, then its payload's fields (Action::dump, dumpAction). */
export function refDumpAction(name: string, d: MessageDecl, v: { [k: string]: Value }): string {
  return `type=${name}\n${refDump(d, v)}`;
}

/** FNV-1a (32-bit) of a string's UTF-8 bytes: the fixtures carry each dump's hash, not the dump. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}

export type { Decl };
export { intRange, typeName, valueFields };
