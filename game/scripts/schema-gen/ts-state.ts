// The saved state on the TypeScript side (10 §8.1, §4.8, §3.6): the save sections' codecs and the shard
// map (src/shared/gen/sections.ts), and each table's rows, column-table codec and read view
// (src/shared/gen/pools.ts), for the IO worker, tools, the golden set and the sim worker's views.
import {
  type Decl,
  type Field,
  pascal,
  type RecordDecl,
  SCALAR_SIZE,
  type Scalar,
  type Schema,
  scalarOf,
  type TableDecl,
  typeName,
} from './model.ts';
import { poolColumnId } from './rust.ts';
import { type TsOut, tsDefault, tsStr, tsType } from './ts.ts';

export function tsState(s: Schema, o: TsOut, pools: TsOut): void {
  o.rt('Reader', 'Writer', 'DecodeError', 'EncodeError', 'cmpScalar');
  const sv = s.save;
  const parts: string[] = [];
  parts.push(`/** Digest shards (§4.8). */
export const SHARDS = ${sv.shards};
/** The size of a piece of a \`pieces\` section (§4.8). */
export const SHARD_PIECE_BYTES = 4096;

/** A save section's digest shard rule (§4.8, sections.yaml). */
export type ShardRule =
  | { k: 'serial' | 'chunk' | 'player' | 'key' | 'timer' | 'owner' }
  | { k: 'pieces'; base: number; step: number };

/** Every section this build writes, in ascending id (saves and the state hash, §4.8). */
export const SECTIONS: readonly { id: number; name: string; version: number; encoding: string; hashed: boolean; shard: ShardRule | null; headerShard: number | null }[] = [
${sv.sections
  .map((x) => {
    const r = x.shard;
    const shard = !r
      ? 'null'
      : r.k === 'pieces'
        ? `{ k: 'pieces', base: ${r.base}, step: ${r.step} }`
        : `{ k: ${tsStr(r.k)} }`;
    return `  { id: ${x.id}, name: ${tsStr(x.name)}, version: ${x.version}, encoding: ${tsStr(x.encoding)}, hashed: ${x.hashed}, shard: ${shard}, headerShard: ${x.headerShard ?? 'null'} },`;
  })
  .join('\n')}
];
/** The ids of later milestones' sections (§8.1). */
export const RESERVED_SECTIONS: Readonly<Record<string, number>> = { ${sv.reserved.map((r) => `${r.name}: ${r.id}`).join(', ')} };

export const shardOfSerial = (serial: number): number => serial % SHARDS;
export const shardOfChunk = (key: number): number => key % SHARDS;
export const shardOfPlayer = (index: number): number => (1800 + 97 * index) % SHARDS;
export const shardOfKey = (key: number): number => key % SHARDS;
export const shardOfTimer = (serial: number, owner: number): number => (serial !== 0 ? serial : owner) % SHARDS;
/** The shard of piece \`i\` of a \`pieces\` section. */
export const shardOfPiece = (base: number, step: number, i: number): number => ((base + i * step) >>> 0) % SHARDS;
`);
  for (const x of sv.sections) {
    if (x.encoding !== 'records' && x.encoding !== 'record') continue;
    const rec = x.record as RecordDecl;
    const rt = o.t(rec);
    const rc = o.c(rec);
    const fn = pascal(x.name.toLowerCase());
    if (x.encoding === 'record') {
      parts.push(`/** Writes ${x.name} (§8.1): \`u32 count\` = 1, then the record. */
export function encode${fn}(v: ${rt}): Uint8Array {
  const w = new Writer();
  w.u32(1, ${tsStr(x.name)});
  ${rc}.write(w, v);
  return w.finish();
}
/** Reads ${x.name}: exactly one record (leniently, §8.3). */
export function decode${fn}(data: Uint8Array): ${rt} {
  const r = new Reader(data);
  if (r.u32(${tsStr(x.name)}) !== 1) throw new DecodeError('bad_count', ${tsStr(x.name)}, 0);
  const v = ${rc}.read(r, false);
  r.finish(${tsStr(x.name)});
  return v;
}
`);
      continue;
    }
    const keys = (x.key ?? []).map((k) => rec.fields.find((f) => f.name === k) as Field);
    const cmp = keys
      .map((k) => `{ const c = cmpScalar(a.${k.name}, b.${k.name}); if (c !== 0) return c; }`)
      .join(' ');
    parts.push(`/** ${x.name}'s canonical order (§8.1): strictly ascending by (${(x.key ?? []).join(', ')}). */
export function compare${fn}(a: ${rt}, b: ${rt}): number {
  ${cmp}
  return 0;
}
/** Writes ${x.name} (§8.1): \`u32 count\`, then the records, which must be strictly ascending by key. */
export function encode${fn}(records: readonly ${rt}[]): Uint8Array {
  for (let i = 1; i < records.length; i++)
    if (compare${fn}(records[i - 1] as ${rt}, records[i] as ${rt}) >= 0) throw new EncodeError('unsorted', ${tsStr(x.name)});
  const w = new Writer();
  w.u32(records.length, ${tsStr(x.name)});
  for (const v of records) ${rc}.write(w, v);
  return w.finish();
}
/** Reads ${x.name}: refuses records out of order or twice (§8.1); fields leniently (§8.3). */
export function decode${fn}(data: Uint8Array): ${rt}[] {
  const r = new Reader(data);
  const n = r.u32(${tsStr(x.name)});
  const out: ${rt}[] = [];
  for (let i = 0; i < n; i++) {
    const at = r.pos;
    const v = ${rc}.read(r, false);
    const prev = out[out.length - 1];
    if (prev && compare${fn}(prev, v) >= 0) throw new DecodeError('unsorted', ${tsStr(x.name)}, at);
    out.push(v);
  }
  r.finish(${tsStr(x.name)});
  return out;
}
`);
  }
  o.push(parts.join('\n'));
  void cmpArrayUnused;

  // Tables: rows, codecs and views (pools.ts).
  pools.rt('Reader', 'Writer', 'DecodeError', 'EncodeError');
  const tparts: string[] = [];
  const allViews: { id: number; table: TableDecl; f: Field }[] = [];
  for (const name of s.names) {
    const d = s.decls.get(name) as Decl;
    if (d.kind !== 'table') continue;
    for (const f of d.fields) if (f.view) allViews.push({ id: poolColumnId(s, d, f), table: d, f });
  }
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
  tparts.push(`/** The columns the read views see (§3.6): \`sim_pool_dir\` names them by these ids. */
export const POOL_COLUMNS: readonly { id: number; table: string; column: string; array: string }[] = [
${allViews.map((v) => `  { id: ${v.id}, table: ${tsStr(v.table.name)}, column: ${tsStr(v.f.name)}, array: ${tsStr(arr[scalarOf(v.f.ty) as Scalar])} },`).join('\n')}
];
`);
  for (const name of s.names) {
    const d = s.decls.get(name) as Decl;
    if (d.kind !== 'table') continue;
    const tn = typeName(d);
    const saved = d.fields.filter((f) => f.saved);
    const code: Record<Scalar, number> = {
      u8: 1,
      u16: 2,
      u32: 3,
      u64: 4,
      i8: 5,
      i16: 6,
      i32: 7,
      i64: 8,
      f32: 9,
      f64: 10,
      bool: 11,
    };
    const isHandle = (f: Field) => f.ty.k === 'id' && f.ty.d.name === 'EntityHandle';
    const rowT = `${tn}Row`;
    const views = d.fields.filter((f) => f.view);
    tparts.push(`/** A saved row of ${d.name} (§4.5)${saved.some(isHandle) ? "; handle columns hold the referenced entity's serial, as saves store them" : ''}. */
export interface ${rowT} {
${saved.map((f) => `  ${f.name}: ${tsType(pools, f.ty)};`).join('\n')}
}

/** The saved columns of ${d.name}, in declaration order: name, §8.1 type code, width. */
export const ${tn.toUpperCase()}_COLUMNS: readonly { name: string; code: number; width: number }[] = [
${saved.map((f) => `  { name: ${tsStr(f.name)}, code: ${code[scalarOf(f.ty) as Scalar]}, width: ${SCALAR_SIZE[scalarOf(f.ty) as Scalar]} },`).join('\n')}
];

/** ${d.name}'s row with every column at its default (a free slot, §4.5). */
export function default${rowT}(): ${rowT} {
  return { ${saved.map((f) => `${f.name}: ${tsDefault(pools, f, f.ty)}`).join(', ')} };
}

/**
 * Writes ${d.name}'s column table (§8.1): \`u32 rows, u16 fields, u16 reserved\`, the directory, then each saved
 * column at the next multiple of 8. A row is live when \`${d.live}\` is not zero; free rows must hold the
 * defaults${
   d.fields.some((f) => f.keep)
     ? ` (except ${d.fields
         .filter((f) => f.keep)
         .map((f) => f.name)
         .join(', ')}, which survive a free)`
     : ''
 }.
 */
export function encode${tn}(rows: readonly ${rowT}[]): Uint8Array {
  const w = new Writer();
  const cols = ${tn.toUpperCase()}_COLUMNS;
  w.u32(rows.length, ${tsStr(d.name)});
  w.u16(cols.length, ${tsStr(d.name)});
  w.u16(0, ${tsStr(`${d.name}.reserved`)});
  let at = 8;
  for (const c of cols) at += 1 + c.name.length + 1 + 1 + 4 + 4;
  for (const c of cols) {
    at = Math.ceil(at / 8) * 8;
    w.u8(c.name.length, ${tsStr(d.name)});
    w.bytes(new TextEncoder().encode(c.name));
    w.u8(c.code, ${tsStr(d.name)});
    w.u8(0, ${tsStr(`${d.name}.reserved`)});
    w.u32(at, ${tsStr(d.name)});
    w.u32(rows.length * c.width, ${tsStr(d.name)});
    at += rows.length * c.width;
  }
${saved.map((f) => `  w.pad(0, 8);\n  for (const row of rows) ${writeCol(pools, f, d)}`).join('\n')}
  return w.finish();
}

/** Reads ${d.name}'s column table: columns by name, defaults for missing ones, refusing type mismatches. */
export function decode${tn}(data: Uint8Array): ${rowT}[] {
  const r = new Reader(data);
  const n = r.u32(${tsStr(d.name)});
  const k = r.u16(${tsStr(d.name)});
  r.zeros(2, ${tsStr(`${d.name}.reserved`)});
  const dir = new Map<string, { code: number; off: number; bytes: number; at: number }>();
  for (let i = 0; i < k; i++) {
    const at = r.pos;
    const name = new TextDecoder().decode(r.take(r.u8(${tsStr(d.name)}), ${tsStr(d.name)}));
    const c = r.u8(${tsStr(d.name)});
    r.zeros(1, ${tsStr(`${d.name}.reserved`)});
    const off = r.u32(${tsStr(d.name)});
    const bytes = r.u32(${tsStr(d.name)});
    if (off % 8 !== 0 || off + bytes > data.length) throw new DecodeError('bad_length', ${tsStr(d.name)}, at);
    if (dir.has(name)) throw new DecodeError('field_order', ${tsStr(d.name)}, at);
    dir.set(name, { code: c, off, bytes, at });
  }
  const rows: ${rowT}[] = Array.from({ length: n }, () => default${rowT}());
  for (const c of ${tn.toUpperCase()}_COLUMNS) {
    const e = dir.get(c.name);
    if (!e) continue;
    if (e.code !== c.code || e.bytes !== n * c.width) throw new DecodeError('schema_mismatch', c.name, e.at);
    const cr = new Reader(data.subarray(e.off, e.off + e.bytes), e.off);
    switch (c.name) {
${saved.map((f) => `      case ${tsStr(f.name)}: for (const row of rows) row.${f.name} = ${readCol(pools, f, d)}; break;`).join('\n')}
    }
  }
  return rows;
}

/** ${d.name}'s read view (§3.6): typed arrays over the module's columns, in the sim worker only. */
export interface ${tn}View {
${views.map((f) => `  ${f.name}: ${arr[scalarOf(f.ty) as Scalar]};`).join('\n')}
}
`);
  }
  tparts.push(`/**
 * The read views over linear memory (§3.6), from \`sim_pool_dir\`'s (column, ptr, len) triples. Call it again
 * after every memory growth or epoch change: the arrays view \`buffer\` directly.
 */
export function poolViews(buffer: ArrayBuffer, dir: readonly { column: number; ptr: number; len: number }[]): Record<string, Record<string, ArrayBufferView>> {
  const out: Record<string, Record<string, ArrayBufferView>> = {};
  const ctor: Readonly<Record<string, new (b: ArrayBuffer, o: number, n: number) => ArrayBufferView>> = {
    Uint8Array, Uint16Array, Uint32Array, BigUint64Array, Int8Array, Int16Array, Int32Array, BigInt64Array, Float32Array, Float64Array,
  };
  for (const e of dir) {
    const c = POOL_COLUMNS.find((x) => x.id === e.column);
    if (!c) throw new Error(\`pool directory: unknown column \${e.column}\`);
    const C = ctor[c.array] as new (b: ArrayBuffer, o: number, n: number) => ArrayBufferView & { BYTES_PER_ELEMENT?: number };
    const size = (C as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    if (e.ptr % size !== 0 || e.len % size !== 0) throw new Error(\`pool directory: column \${c.table}.\${c.column} is misaligned\`);
    const t = out[c.table] ?? {};
    t[c.column] = new C(buffer, e.ptr, e.len / size);
    out[c.table] = t;
  }
  return out;
}
`);
  pools.push(tparts.join('\n'));
}

const cmpArrayUnused = 0;

function writeCol(o: TsOut, f: Field, d: TableDecl): string {
  const p = tsStr(`${d.name}.${f.name}`);
  if (f.ty.k === 'scalar') return `w.${f.ty.s}(row.${f.name} as never, ${p});`;
  return `${o.c((f.ty as { d: Decl }).d)}.write(w, row.${f.name} as never, ${p});`;
}

function readCol(o: TsOut, f: Field, d: TableDecl): string {
  const p = tsStr(`${d.name}.${f.name}`);
  if (f.ty.k === 'scalar') return `cr.${f.ty.s}(${p})`;
  return `${o.c((f.ty as { d: Decl }).d)}.read(cr, ${p})`;
}
