// The TypeScript emitter (10 §15.1): src/shared/gen/*.ts. Each declaration becomes a type `X` and, for
// everything with a codec, `XCodec` (read, write, dump, sizes and field offsets); enums and flags also get
// a const object of their values (`Direction.north`). Values: integers are numbers (u64/i64 are bigints),
// strings are strings, bytes are Uint8Arrays, lists are arrays; reserved fields and hidden counts are not
// part of a value. Every decoder validates exactly what the Rust decoder validates, and refuses with the
// same error kind and field path.
import { canonicalJson } from '../lib/canonical.ts';
import {
  type Decl,
  type EnumDecl,
  type Field,
  type FlagsDecl,
  fixedSize,
  type IdDecl,
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
  type TableDecl,
  type Ty,
  typeName,
  valueFields,
} from './model.ts';
import { type DeclMod, isU8 } from './rust.ts';

export type TsMod = DeclMod | 'schema' | 'samples';

/** One module's code and what it names from other modules. */
export class TsOut {
  readonly values = new Set<string>();
  readonly types = new Set<string>();
  readonly runtime = new Set<string>();
  readonly runtimeTypes = new Set<string>();
  readonly parts: string[] = [];
  readonly s: Schema;
  readonly mod: TsMod;
  constructor(s: Schema, mod: TsMod) {
    this.s = s;
    this.mod = mod;
  }
  /** Names a declaration's type. */
  t(d: Decl): string {
    this.types.add(d.name);
    return typeName(d);
  }
  /** Names a declaration's codec (or an enum's value object, with `values`). */
  c(d: Decl): string {
    this.values.add(`${d.name}#codec`);
    return `${typeName(d)}Codec`;
  }
  v(d: Decl): string {
    this.values.add(`${d.name}#values`);
    return typeName(d);
  }
  rt(...names: string[]): void {
    for (const n of names) this.runtime.add(n);
  }
  rtt(...names: string[]): void {
    for (const n of names) this.runtimeTypes.add(n);
  }
  push(code: string): void {
    this.parts.push(code);
  }
}

export function tsStr(s: string): string {
  return canonicalJson(s, 0);
}

/** An object key: bare when it is an identifier, quoted otherwise. */
export function tsKey(s: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? s : canonicalJson(s, 0);
}

export function tsDoc(doc: string | undefined, indent = ''): string {
  if (!doc) return '';
  return `${indent}/** ${doc.replace(/\*\//g, '*\\/')} */\n`;
}

// ------------------------------------------------------------------------------------------- type facts

/** The TypeScript type of a value. */
export function tsType(o: TsOut, t: Ty): string {
  switch (t.k) {
    case 'scalar':
      return t.s === 'bool' ? 'boolean' : isWide(t.s) ? 'bigint' : 'number';
    case 'id':
    case 'enum':
    case 'flags':
      return isWide(t.d.base) ? 'bigint' : 'number';
    case 'struct':
    case 'message':
    case 'record':
      return o.t(t.d);
    case 'array':
      return isU8(t.of) ? 'Uint8Array' : `${tsType(o, t.of)}[]`;
    case 'str':
      return 'string';
    case 'bytes':
      return 'Uint8Array';
    case 'list':
      return `${tsType(o, t.of)}[]`;
    case 'blob_or_bytes':
      o.rtt('BlobOrBytes');
      return 'BlobOrBytes';
    case 'counted':
    case 'rest':
      return isU8(t.of) ? 'Uint8Array' : `${tsType(o, t.of)}[]`;
  }
}

function readScalar(s: Scalar, p: string): string {
  return `r.${s}(${p})`;
}

/** An expression that reads a value from reader `r`. */
export function tsRead(o: TsOut, t: Ty, p: string, record: boolean, fields: readonly Field[]): string {
  switch (t.k) {
    case 'scalar':
      return readScalar(t.s, p);
    case 'id':
    case 'enum':
    case 'flags':
    case 'struct':
      return `${o.c(t.d)}.read(r, ${p})`;
    case 'array':
      if (isU8(t.of)) return `r.take(${t.n}, ${p}).slice()`;
      return `Array.from({ length: ${t.n} }, () => ${tsRead(o, t.of, p, record, fields)})`;
    case 'message':
      return `${o.c(t.d)}.read(r)`;
    case 'record':
      return `${o.c(t.d)}.read(r, ${record ? 'strict' : 'true'})`;
    case 'str':
      return `r.str16(${t.max}, ${p})`;
    case 'bytes':
      return `r.bytesOf(${t.lenWidth}, ${t.max}, ${p}).slice()`;
    case 'list': {
      o.rt('readList');
      const item = t.of.k === 'str' ? `r.str16(${t.of.max}, ${p})` : tsRead(o, t.of, p, record, fields);
      const size = t.of.k === 'message' ? 0 : (fixedSize(t.of) ?? 0);
      return `readList(r, ${t.countWidth}, ${t.max}, ${p}, ${size}, () => ${item})`;
    }
    case 'blob_or_bytes':
      o.rt('readBlobOrBytes');
      return `readBlobOrBytes(r, ${t.max}, ${p})`;
    case 'counted': {
      const n = t.minus ? `Math.max(0, f_${t.count} - ${t.minus})` : `f_${t.count}`;
      if (isU8(t.of)) return `r.take(${n}, ${p}).slice()`;
      o.rt('readN');
      const size = t.of.k === 'message' ? 0 : (fixedSize(t.of) ?? 0);
      return `readN(r, ${n}, ${size}, ${p}, () => ${tsRead(o, t.of, p, record, fields)})`;
    }
    case 'rest': {
      if (isU8(t.of)) return 'r.rest().slice()';
      const size = fixedSize(t.of) as number;
      o.rt('readRest');
      return `readRest(r, ${size}, ${p}, () => ${tsRead(o, t.of, p, record, fields)})`;
    }
  }
}

/** Statements that write value expression `e`. */
export function tsWrite(o: TsOut, t: Ty, e: string, p: string): string {
  switch (t.k) {
    case 'scalar':
      return `w.${t.s}(${e}, ${p});`;
    case 'id':
    case 'enum':
    case 'flags':
    case 'struct':
      return `${o.c(t.d)}.write(w, ${e}, ${p});`;
    case 'array':
      if (isU8(t.of))
        return `if (${e}.length !== ${t.n}) throw new EncodeError('bad_length', ${p}); w.bytes(${e});`;
      o.rt('EncodeError');
      return `if (${e}.length !== ${t.n}) throw new EncodeError('bad_length', ${p}); for (const x of ${e}) { ${tsWrite(o, t.of, 'x', p)} }`;
    case 'message':
      return `${o.c(t.d)}.write(w, ${e});`;
    case 'record':
      return `${o.c(t.d)}.write(w, ${e});`;
    case 'str':
      return `w.str16(${e}, ${t.max}, ${p});`;
    case 'bytes':
      return `w.lenBytes(${e}, ${t.lenWidth}, ${t.max}, ${p});`;
    case 'list': {
      const item = t.of.k === 'str' ? `w.str16(x, ${t.of.max}, ${p});` : tsWrite(o, t.of, 'x', p);
      return `w.count(${e}.length, ${t.countWidth}, ${t.max}, ${p}); for (const x of ${e}) { ${item} }`;
    }
    case 'blob_or_bytes':
      o.rt('writeBlobOrBytes');
      return `writeBlobOrBytes(w, ${e}, ${t.max}, ${p});`;
    case 'counted':
    case 'rest':
      if (isU8(t.of)) return `w.bytes(${e});`;
      return `for (const x of ${e}) { ${tsWrite(o, t.of, 'x', p)} }`;
  }
}

/** Statements that dump value `e` at path expression `path`. */
export function tsDump(o: TsOut, t: Ty, e: string, path: string): string {
  switch (t.k) {
    case 'scalar':
      if (t.s === 'bool') return `d.bool(${path}, ${e});`;
      if (isFloat(t.s)) return `d.${t.s}(${path}, ${e});`;
      return `d.int(${path}, ${e});`;
    case 'id':
    case 'enum':
    case 'flags':
      return `d.int(${path}, ${e});`;
    case 'struct':
    case 'message':
    case 'record':
      return `${o.c(t.d)}.dump(d, ${e}, \`\${${path}}.\`);`;
    case 'array':
      if (isU8(t.of)) return `d.bytes(${path}, ${e});`;
      return `${e}.forEach((x, i) => { ${tsDump(o, t.of, 'x', `\`\${${path}}[\${i}]\``)} });`;
    case 'str':
      return `d.str(${path}, ${e});`;
    case 'bytes':
      return `d.bytes(${path}, ${e});`;
    case 'blob_or_bytes':
      o.rt('dumpBlobOrBytes');
      return `dumpBlobOrBytes(d, ${path}, ${e});`;
    case 'list':
    case 'counted':
    case 'rest': {
      if (t.k !== 'list' && isU8(t.of)) return `d.bytes(${path}, ${e});`;
      const item =
        t.of.k === 'str'
          ? `d.str(\`\${${path}}[\${i}]\`, x);`
          : tsDump(o, t.of, 'x', `\`\${${path}}[\${i}]\``);
      return `d.int(\`\${${path}}.len\`, ${e}.length); ${e}.forEach((x, i) => { ${item} });`;
    }
  }
}

function rangeChecks(o: TsOut, f: Field, v: string, p: string, at: string | null): string {
  const out: string[] = [];
  const err = (kind: string) =>
    at === null ? `throw new EncodeError('${kind}', ${p});` : `throw r.errAt(${at}, '${kind}', ${p});`;
  if (at === null) o.rt('EncodeError');
  if (f.range) out.push(`if (${v} < ${f.range[0]} || ${v} > ${f.range[1]}) ${err('range')}`);
  if (f.allowed) out.push(`if (![${f.allowed.join(', ')}].includes(${v})) ${err('range')}`);
  return out.join(' ');
}

function fieldPath(owner: string, f: Field): string {
  return tsStr(`${owner}.${f.name}`);
}

function interfaceBody(o: TsOut, fields: readonly Field[]): string {
  return valueFields(fields)
    .map((f) => `${tsDoc(f.doc, '  ')}  ${f.name}${f.when ? '?' : ''}: ${tsType(o, f.ty)};`)
    .join('\n');
}

function dumpBody(o: TsOut, fields: readonly Field[]): string {
  return valueFields(fields)
    .map((f) => {
      const e = `v.${f.name}`;
      const path = `\`\${prefix}${f.name}\``;
      if (f.when) return `if (${e} !== undefined) { ${tsDump(o, f.ty, e, path)} }`;
      return tsDump(o, f.ty, e, path);
    })
    .join('\n    ');
}

// ------------------------------------------------------------------------------------------- declarations

export function emitId(o: TsOut, d: IdDecl): void {
  o.rt('Reader', 'Writer');
  const wide = isWide(d.base);
  o.push(`${tsDoc(d.doc)}export type ${d.name} = ${wide ? 'bigint' : 'number'};
export const ${d.name}Codec = {
  SIZE: ${SCALAR_SIZE[d.base]},${d.none !== undefined ? `\n  /** The value that means "none". */\n  NONE: ${d.none},` : ''}
  read: (r: Reader, field: string): ${wide ? 'bigint' : 'number'} => r.${d.base}(field),
  write: (w: Writer, v: ${wide ? 'bigint' : 'number'}, field: string): void => w.${d.base}(v, field),
} as const;
`);
}

export function emitEnum(o: TsOut, d: EnumDecl): void {
  o.rt('Reader', 'Writer', 'EncodeError');
  o.push(`${tsDoc(d.doc)}export const ${d.name} = {
${d.values.map((v) => `  ${tsKey(v.name)}: ${v.value},`).join('\n')}
} as const;
export type ${d.name} = number;
const ${d.name}_NAMES: ReadonlyMap<number, string> = new Map([${d.values.map((v) => `[${v.value}, ${tsStr(v.name)}]`).join(', ')}]);
export const ${d.name}Codec = {
  SIZE: ${SCALAR_SIZE[d.base]},
  /** Every value, in declaration order. */
  ALL: [${d.values.map((v) => v.value).join(', ')}] as readonly number[],
  /** The schema's name of a value, or undefined. */
  name: (v: number): string | undefined => ${d.name}_NAMES.get(v),
  has: (v: number): boolean => ${d.name}_NAMES.has(v),
  read(r: Reader, field: string): number {
    const at = r.pos;
    const v = r.${d.base}(field);
    if (!${d.name}_NAMES.has(v)) throw r.errAt(at, 'bad_enum', field);
    return v;
  },
  write(w: Writer, v: number, field: string): void {
    if (!${d.name}_NAMES.has(v)) throw new EncodeError('bad_enum', field);
    w.${d.base}(v, field);
  },
} as const;
`);
}

export function emitFlags(o: TsOut, d: FlagsDecl): void {
  o.rt('Reader', 'Writer', 'EncodeError');
  const all = d.bits.reduce((a, b) => a + pow2(b.bit), 0);
  o.push(`${tsDoc(d.doc)}export const ${d.name} = {
${d.bits.map((b) => `  ${b.name}: ${pow2(b.bit)},`).join('\n')}
} as const;
export type ${d.name} = number;
export const ${d.name}Codec = {
  SIZE: ${SCALAR_SIZE[d.base]},
  /** Every declared bit. */
  ALL: ${all},
  read(r: Reader, field: string): number {
    const at = r.pos;
    const v = r.${d.base}(field);
    if ((v & ~${all}) >>> 0 !== 0) throw r.errAt(at, 'bad_flags', field);
    return v;
  },
  write(w: Writer, v: number, field: string): void {
    if (!Number.isInteger(v) || v < 0 || (v & ~${all}) >>> 0 !== 0) throw new EncodeError('bad_flags', field);
    w.${d.base}(v, field);
  },
} as const;
`);
}

function readFields(o: TsOut, owner: string, fields: readonly Field[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const p = fieldPath(owner, f);
    if (f.reserved) {
      out.push(`r.zeros(${fixedSize(f.ty)}, ${p});`);
      continue;
    }
    const needAt = !!(f.range || f.allowed);
    if (needAt) out.push(`const at_${f.name} = r.pos;`);
    let read = tsRead(o, f.ty, p, false, fields);
    if (f.when) {
      const flags = fields.find((x) => x.name === f.when?.field) as Field;
      const fd = (flags.ty as { d: FlagsDecl }).d;
      read = `(f_${flags.name} & ${o.v(fd)}.${f.when.bit}) !== 0 ? ${read} : undefined`;
    }
    out.push(`const f_${f.name} = ${read};`);
    if (needAt) out.push(rangeChecks(o, f, `f_${f.name}`, p, `at_${f.name}`));
  }
  return out;
}

function writeFields(o: TsOut, owner: string, fields: readonly Field[]): string[] {
  const out: string[] = [];
  for (const cf of fields.filter((f) => f.hidden)) {
    const arrays = fields.filter((f) => f.ty.k === 'counted' && f.ty.count === cf.name);
    const first = arrays[0] as Field;
    const m = (first.ty as { minus: number }).minus;
    const len = m
      ? `(v.${first.name}.length === 0 ? 0 : v.${first.name}.length + ${m})`
      : `v.${first.name}.length`;
    out.push(`const f_${cf.name} = ${len};`);
    const s = scalarOf(cf.ty) as Scalar;
    const hi = cf.range ? cf.range[1] : s === 'u8' ? 0xff : s === 'u16' ? 0xffff : 0xffffffff;
    o.rt('EncodeError');
    out.push(
      `if (f_${cf.name} > ${hi}) throw new EncodeError('${cf.range ? 'range' : 'bad_count'}', ${fieldPath(owner, cf)});`,
    );
    if (cf.range && cf.range[0] > 0)
      out.push(`if (f_${cf.name} < ${cf.range[0]}) throw new EncodeError('range', ${fieldPath(owner, cf)});`);
    for (const a of arrays) {
      const am = (a.ty as { minus: number }).minus;
      if (a === first && !am) continue;
      const want = am ? `Math.max(0, f_${cf.name} - ${am})` : `f_${cf.name}`;
      out.push(
        `if (v.${a.name}.length !== ${want}) throw new EncodeError('bad_count', ${fieldPath(owner, a)});`,
      );
    }
  }
  for (const f of fields) {
    const p = fieldPath(owner, f);
    if (f.reserved) {
      out.push(`w.zeros(${fixedSize(f.ty)});`);
      continue;
    }
    if (f.hidden) {
      out.push(tsWrite(o, f.ty, `f_${f.name}`, p));
      continue;
    }
    const e = `v.${f.name}`;
    const pre = rangeChecks(o, f, e, p, null);
    if (pre) out.push(pre);
    if (f.when) {
      const flags = fields.find((x) => x.name === f.when?.field) as Field;
      const fd = (flags.ty as { d: FlagsDecl }).d;
      o.rt('EncodeError');
      out.push(
        `if (((v.${flags.name} & ${o.v(fd)}.${f.when.bit}) !== 0) !== (${e} !== undefined)) throw new EncodeError('inconsistent', ${p});`,
      );
      out.push(`if (${e} !== undefined) { ${tsWrite(o, f.ty, e, p)} }`);
      continue;
    }
    out.push(tsWrite(o, f.ty, e, p));
  }
  return out;
}

function objInit(fields: readonly Field[]): string {
  return valueFields(fields)
    .map((f) =>
      f.when ? `...(f_${f.name} !== undefined ? { ${f.name}: f_${f.name} } : {})` : `${f.name}: f_${f.name}`,
    )
    .join(', ');
}

/** Field accessors over a DataView, for hot decoding loops (renderer). */
function accessors(o: TsOut, fields: readonly Field[]): string {
  const out: string[] = [];
  for (const f of fields) {
    if (f.reserved || f.offset === undefined) continue;
    const t = f.ty;
    const s = scalarOf(t);
    if (s === null) continue;
    const getter: Record<Scalar, string> = {
      u8: 'getUint8',
      u16: 'getUint16',
      u32: 'getUint32',
      u64: 'getBigUint64',
      i8: 'getInt8',
      i16: 'getInt16',
      i32: 'getInt32',
      i64: 'getBigInt64',
      f32: 'getFloat32',
      f64: 'getFloat64',
      bool: 'getUint8',
    };
    const le = SCALAR_SIZE[s] > 1 ? ', true' : '';
    const ret = s === 'bool' ? 'boolean' : isWide(s) ? 'bigint' : 'number';
    const expr = `v.${getter[s]}(o + ${f.offset}${le})${s === 'bool' ? ' !== 0' : ''}`;
    out.push(`    ${f.name}: (v: DataView, o: number): ${ret} => ${expr},`);
  }
  void o;
  return out.length
    ? `  /** Field reads at byte offset \`o\` of a DataView (no validation: for records already validated). */\n  get: {\n${out.join('\n')}\n  },`
    : '';
}

export function emitStruct(o: TsOut, d: StructDecl): void {
  o.rt('Reader', 'Writer', 'Dump');
  const name = d.name;
  const reads = readFields(o, name, d.fields);
  const writes = writeFields(o, name, d.fields);
  let check = '';
  let checkW = '';
  if (d.check === 'entity_ref') {
    o.rt('EncodeError');
    const tag = (d.fields.find((f) => f.name === 'tag') as Field).ty as { d: EnumDecl };
    const e = o.v(tag.d);
    const wf = `(x: ${name}): boolean => x.tag === ${e}.none ? x.a === 0 && x.b === 0 : x.tag === ${e}.serial ? x.a !== 0 && x.b === 0 : true`;
    check = `if (!${name}Codec.isWellFormed(v)) throw r.errAt(start, 'bad_ref', ${tsStr(name)});`;
    checkW = `if (!${name}Codec.isWellFormed(v)) throw new EncodeError('bad_ref', ${tsStr(name)});`;
    o.push(`const ${name}_WELL_FORMED = ${wf};`);
  }
  const offsets = d.fields
    .filter((f) => !f.reserved)
    .map((f) => `${f.name}: ${f.offset}`)
    .join(', ');
  o.push(`${tsDoc(d.doc)}export interface ${name} {
${interfaceBody(o, d.fields)}
}
export const ${name}Codec = {
  /** The encoded size in bytes. */
  SIZE: ${d.size},
  /** Byte offsets of the fields. */
  OFFSET: { ${offsets} },
  /** A value with every field at its default. */
  defaults(): ${name} {
    return { ${valueFields(d.fields)
      .map((f) => `${f.name}: ${tsDefault(o, f, f.ty)}`)
      .join(', ')} };
  },
${accessors(o, d.fields)}${d.check === 'entity_ref' ? `\n  /** Tag 0 has a and b zero; tag 1 names a serial (not 0) with b zero; tag 2 is a creation id (§15.3). */\n  isWellFormed: ${name}_WELL_FORMED,` : ''}
  read(r: Reader, _field?: string): ${name} {
    ${check ? 'const start = r.pos;' : ''}
    ${reads.join('\n    ')}
    const v: ${name} = { ${objInit(d.fields)} };
    ${check}
    return v;
  },
  write(w: Writer, v: ${name}, _field?: string): void {
    ${checkW}
    ${writes.join('\n    ')}
  },
  ${compareFn(o, d.fields, name)}
  dump(d: Dump, v: ${name}, prefix = ''): void {
    ${dumpBody(o, d.fields)}
  },
};
`);
}

export function emitMessage(o: TsOut, d: MessageDecl): void {
  o.rt('Reader', 'Writer', 'Dump');
  const name = d.name;
  const reads = readFields(o, name, d.fields);
  const writes = writeFields(o, name, d.fields);
  const offsets = d.fields
    .filter((f) => !f.reserved && f.offset !== undefined)
    .map((f) => `${f.name}: ${f.offset}`)
    .join(', ');
  const iface = valueFields(d.fields).length
    ? `export interface ${name} {\n${interfaceBody(o, d.fields)}\n}`
    : `export type ${name} = Record<never, never>;`;
  o.push(`${tsDoc(d.doc)}${iface}
export const ${name}Codec = {
  /** The bytes before the first variable-length field${d.fixed !== null ? ' (the whole record: it is fixed-size)' : ''}. */
  PREFIX: ${d.prefix},
  /** Byte offsets of the fields in the fixed prefix. */
  OFFSET: { ${offsets} },
  /** A value with every field at its default (optional fields absent). */
  defaults(): ${name} {
    return { ${valueFields(d.fields)
      .filter((f) => !f.when)
      .map((f) => `${f.name}: ${tsDefault(o, f, f.ty)}`)
      .join(', ')} };
  },
${accessors(o, d.fields)}
  read(${d.fields.length ? 'r' : '_r'}: Reader): ${name} {
    ${d.padTo ? 'const start = r.pos;' : ''}
    ${reads.join('\n    ')}
    ${d.padTo ? `r.pad(start, ${d.padTo}, ${tsStr(`${name}.padding`)});` : ''}
    return { ${objInit(d.fields)} };
  },
  write(${d.fields.length ? 'w' : '_w'}: Writer, ${valueFields(d.fields).length ? 'v' : '_v'}: ${name}): void {
    ${d.padTo ? 'const start = w.pos;' : ''}
    ${writes.join('\n    ')}
    ${d.padTo ? `w.pad(start, ${d.padTo});` : ''}
  },
  /** Decodes one value that fills \`bytes\` exactly. */
  decode(bytes: Uint8Array): ${name} {
    const r = new Reader(bytes);
    const v = ${name}Codec.read(r);
    r.finish(${tsStr(name)});
    return v;
  },
  /** Encodes one value. */
  encode(v: ${name}): Uint8Array {
    const w = new Writer();
    ${name}Codec.write(w, v);
    return w.finish();
  },
  ${valueFields(d.fields).length ? `dump(d: Dump, v: ${name}, prefix = ''): void {` : `dump(_d: Dump, _v: ${name}, _prefix = ''): void {`}
    ${dumpBody(o, d.fields)}
  },
};
`);
}

/** The comparison of two values of a type (canonical orders, §8.1). */
export function tsCompare(o: TsOut, t: Ty, a: string, b: string): string {
  switch (t.k) {
    case 'scalar':
    case 'id':
    case 'enum':
    case 'flags':
    case 'str':
      o.rt('cmpScalar');
      return `cmpScalar(${a}, ${b})`;
    case 'bytes':
      o.rt('cmpBytes');
      return `cmpBytes(${a}, ${b})`;
    case 'array':
    case 'list':
      if (t.k === 'array' && isU8(t.of)) {
        o.rt('cmpBytes');
        return `cmpBytes(${a}, ${b})`;
      }
      o.rt('cmpArray');
      return `cmpArray(${a}, ${b}, (x, y) => ${tsCompare(o, t.of, 'x', 'y')})`;
    case 'struct':
    case 'record':
      return `${o.c(t.d)}.compare(${a}, ${b})`;
    default:
      throw new Error(`no order on ${t.k}`);
  }
}

function compareFn(o: TsOut, fields: readonly Field[], name: string): string {
  const vf = valueFields(fields);
  return `compare(a: ${name}, b: ${name}): number {
    ${vf.map((f) => `{ const c = ${tsCompare(o, f.ty, `a.${f.name}`, `b.${f.name}`)}; if (c !== 0) return c; }`).join('\n    ')}
    return 0;
  },`;
}

export function emitRecord(o: TsOut, d: RecordDecl): void {
  o.rt('Reader', 'Writer', 'Dump', 'EncodeError');
  const name = typeName(d);
  const fields = d.fields;
  const cases: string[] = [];
  const writes: string[] = [];
  fields.forEach((f, i) => {
    const p = tsStr(`${d.name}.${f.name}`);
    const checks: string[] = [];
    if (f.range || f.allowed) checks.push(rangeChecks(o, f, 'x', p, 'at'));
    if (f.order === 'key' && f.ty.k === 'list') {
      o.rt('strictlyAscending');
      checks.push(
        `if (!strictlyAscending(x, (a, b) => ${tsCompare(o, f.ty.of, 'a', 'b')})) throw r.errAt(at, 'unsorted', ${p});`,
      );
    }
    cases.push(
      `case ${f.id}: { const x = ${tsRead(o, f.ty, p, true, fields)}; ${checks.join(' ').replaceAll('throw r.errAt', 'throw outer.errAt')} out.${f.name} = x; seen[${i}] = 1; field = ${p}; break; }`,
    );
    const se = `v.${f.name}`;
    const pre = rangeChecks(o, f, se, p, null);
    const sorted =
      f.order === 'key' && f.ty.k === 'list'
        ? `if (!strictlyAscending(${se}, (a, b) => ${tsCompare(o, f.ty.of, 'a', 'b')})) throw new EncodeError('unsorted', ${p});`
        : '';
    writes.push(
      `${pre} ${sorted} w.u16(${f.id}, ${p}); { const at = w.beginU32(); ${tsWrite(o, f.ty, se, p)} w.endU32(at, ${p}); }`,
    );
  });
  if (fields.length > 52) throw new Error(`record ${d.name}: more than 52 fields`);
  const ord = fields.every((f) => f.ty.k !== 'message' && f.ty.k !== 'blob_or_bytes');
  o.push(`${tsDoc(d.doc)}export interface ${name} {
${interfaceBody(o, fields)}
}
const ${name}_FIELDS = [${fields.map((f) => tsStr(`${d.name}.${f.name}`)).join(', ')}] as const;
export const ${name}Codec = {
  /** The field ids, ascending. */
  FIELD_IDS: [${fields.map((f) => f.id).join(', ')}] as const,
  /** A value with every field at its default. */
  defaults(): ${name} {
    return { ${fields.map((f) => `${f.name}: ${tsDefault(o, f, f.ty)}`).join(', ')} };
  },
  /**
   * Decodes one record: \`u32 length\`, then \`(u16 id, u32 length, value)\` triples in ascending id (§8.1).
   * Strict decoding (ABI inputs) refuses unknown and missing fields; lenient decoding (saves) skips unknown
   * ids and leaves missing fields at their defaults (§8.3).
   */
  read(outer: Reader, strict: boolean): ${name} {
    const n = outer.u32(${tsStr(d.name)});
    const body = outer.sub(n, ${tsStr(d.name)});
    const out = ${name}Codec.defaults();
    let last = 0;
    const seen = new Uint8Array(${fields.length});
    while (!body.isEmpty) {
      const at = body.pos;
      const id = body.u16(${tsStr(d.name)});
      if (id <= last) throw body.errAt(at, 'field_order', ${tsStr(d.name)});
      last = id;
      const len = body.u32(${tsStr(d.name)});
      const r = body.sub(len, ${tsStr(d.name)});
      let field: string;
      switch (id) {
        ${cases.join('\n        ')}
        default:
          if (strict) throw body.errAt(at, 'unknown_field', ${tsStr(d.name)});
          continue;
      }
      if (!r.isEmpty) throw r.err('bad_length', field);
    }
    if (strict) {
      const i = seen.indexOf(0);
      if (i >= 0) throw body.err('missing_field', ${name}_FIELDS[i] ?? ${tsStr(d.name)});
    }
    return out;
  },
  /** Encodes the record with every field present, in ascending id (§8.1). */
  write(w: Writer, v: ${name}): void {
    const start = w.beginU32();
    ${writes.join('\n    ')}
    w.endU32(start, ${tsStr(d.name)});
  },
  /** Decodes one record that fills \`bytes\` exactly. */
  decode(bytes: Uint8Array, strict: boolean): ${name} {
    const r = new Reader(bytes);
    const v = ${name}Codec.read(r, strict);
    r.finish(${tsStr(d.name)});
    return v;
  },
  encode(v: ${name}): Uint8Array {
    const w = new Writer();
    ${name}Codec.write(w, v);
    return w.finish();
  },
  ${ord ? compareFn(o, fields, name) : ''}
  dump(d: Dump, v: ${name}, prefix = ''): void {
    ${dumpBody(o, fields) || 'void d; void v; void prefix;'}
  },
};
`);
}

/** The default value expression of a field. */
export function tsDefault(o: TsOut, f: Field | null, t: Ty): string {
  const dv = f?.default;
  if (dv !== undefined) {
    if (typeof dv === 'boolean') return String(dv);
    const s = scalarOf(t);
    return s && isWide(s) ? `${dv}n` : `${dv}`;
  }
  switch (t.k) {
    case 'scalar':
      return t.s === 'bool' ? 'false' : isWide(t.s) ? '0n' : '0';
    case 'id':
    case 'enum':
    case 'flags':
      return isWide(t.d.base) ? '0n' : t.k === 'enum' ? `${(t.d.values[0] as { value: number }).value}` : '0';
    case 'array':
      if (isU8(t.of)) return `new Uint8Array(${t.n})`;
      return `Array.from({ length: ${t.n} }, () => ${tsDefault(o, null, t.of)})`;
    case 'str':
      return "''";
    case 'bytes':
      return 'new Uint8Array(0)';
    case 'list':
    case 'counted':
    case 'rest':
      return isU8(t.of) && t.k !== 'list' ? 'new Uint8Array(0)' : '[]';
    case 'blob_or_bytes':
      return '{ bytes: new Uint8Array(0) }';
    case 'struct':
      return `${o.c(t.d)}.defaults()`;
    case 'message':
      return `${o.c(t.d)}.defaults()`;
    case 'record':
      return `${o.c(t.d)}.defaults()`;
  }
}

export function emitDecl(o: TsOut, d: Decl): void {
  switch (d.kind) {
    case 'id':
      emitId(o, d);
      return;
    case 'enum':
      emitEnum(o, d);
      return;
    case 'flags':
      emitFlags(o, d);
      return;
    case 'struct':
      emitStruct(o, d);
      return;
    case 'message':
      emitMessage(o, d);
      return;
    case 'record':
      emitRecord(o, d);
      return;
    case 'table':
      emitTableView(o, d);
      return;
  }
}

// ------------------------------------------------------------------------------------------- tables

/** A pool's TypeScript read view (§3.6): typed arrays over the module's columns, sim worker only. */
export function emitTableView(o: TsOut, d: TableDecl): void {
  const name = typeName(d);
  const cols = d.fields.filter((f) => f.view);
  const arr: Record<Scalar, string> = {
    u8: 'Uint8Array',
    u16: 'Uint16Array',
    u32: 'Uint32Array',
    u64: 'BigUint64Array',
    i8: 'Int8Array',
    i16: 'Int16Array',
    i32: 'Int32Array',
    i64: 'BigInt64Array',
    f32: 'Float32Array',
    f64: 'Float64Array',
    bool: 'Uint8Array',
  };
  o.push(`${tsDoc(`${d.doc ?? name}: the read view's columns (typed arrays over linear memory; the sim worker only, §3.6)`)}export interface ${name}View {
${cols.map((f) => `  ${f.name}: ${arr[scalarOf(f.ty) as Scalar]};`).join('\n')}
}
`);
}
