// The save container's section framing and encodings (10 §8.1), as prototypes.bin uses them (10 §15.2).
//
//   section: u32 id | u16 version | u8 codec (0 raw) | u8 flags | u32 rawLength | u32 storedLength
//            | bytes[storedLength] | zero padding to a multiple of 8
//   column table: u32 rows, u16 fields, u16 reserved; per field u8 nameLength, name, u8 type, u8 reserved,
//            u32 offset, u32 length; then the columns, each starting at a multiple of 8 (offsets count
//            from the start of the section's data)
//   records: u32 count; per record u16 recordType, u32 length, then (u16 fieldId, u32 length, value)
//            triples in ascending field id
import { ByteReader, ByteWriter } from '../../lib/bytes.ts';
import { sortedEntries } from '../../lib/canonical.ts';

export const TYPE_CODES = {
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
} as const;
export type ColType = keyof typeof TYPE_CODES;
export const TYPE_WIDTH: Record<ColType, number> = {
  u8: 1,
  u16: 2,
  u32: 4,
  u64: 8,
  i8: 1,
  i16: 2,
  i32: 4,
  i64: 8,
  f32: 4,
  f64: 8,
  bool: 1,
};
export const SECTION_HEADER_BYTES = 16;

export interface SectionData {
  id: number;
  version: number;
  flags: number;
  data: Uint8Array;
}

/** Appends one raw (codec 0) section and pads to a multiple of 8. The writer must start 8-aligned. */
export function writeSection(w: ByteWriter, s: SectionData): void {
  if (w.length % 8 !== 0) throw new Error('a section must start at a multiple of 8');
  w.u32(s.id).u16(s.version).u8(0).u8(s.flags).u32(s.data.length).u32(s.data.length).bytes(s.data).pad(8);
}

export function writeValue(w: ByteWriter, type: ColType, v: number | boolean): void {
  if (type === 'bool') {
    if (typeof v !== 'boolean') throw new TypeError(`bool column given ${v}`);
    w.bool(v);
    return;
  }
  if (typeof v !== 'number') throw new TypeError(`${type} column given ${v}`);
  switch (type) {
    case 'u8':
      w.u8(v);
      break;
    case 'u16':
      w.u16(v);
      break;
    case 'u32':
      w.u32(v);
      break;
    case 'u64':
      w.u64(BigInt(v));
      break;
    case 'i8':
      w.i8(v);
      break;
    case 'i16':
      w.i16(v);
      break;
    case 'i32':
      w.i32(v);
      break;
    case 'i64':
      w.i64(BigInt(v));
      break;
    case 'f32':
      w.f32(v);
      break;
    case 'f64':
      w.f64(v);
      break;
  }
}

export interface ColumnData {
  name: string;
  type: ColType;
  values: (number | boolean)[];
}

/** A column table (10 §8.1's encoding for pools): the directory, then each column 8-aligned. */
export function columnTable(rows: number, cols: readonly ColumnData[]): Uint8Array {
  const enc = new TextEncoder();
  let dirBytes = 8;
  for (const c of cols) dirBytes += 1 + enc.encode(c.name).length + 1 + 1 + 4 + 4;
  const offsets: number[] = [];
  let at = dirBytes;
  for (const c of cols) {
    at = Math.ceil(at / 8) * 8;
    offsets.push(at);
    at += rows * TYPE_WIDTH[c.type];
  }
  const w = new ByteWriter(at + 8);
  w.u32(rows).u16(cols.length).u16(0);
  cols.forEach((c, i) => {
    const n = enc.encode(c.name);
    if (n.length > 255) throw new Error(`column name too long: ${c.name}`);
    if (c.values.length !== rows)
      throw new Error(`column ${c.name} has ${c.values.length} values for ${rows} rows`);
    w.u8(n.length)
      .bytes(n)
      .u8(TYPE_CODES[c.type])
      .u8(0)
      .u32(offsets[i] as number)
      .u32(rows * TYPE_WIDTH[c.type]);
  });
  cols.forEach((c) => {
    w.pad(8);
    for (const v of c.values) writeValue(w, c.type, v);
  });
  return w.finish();
}

/** One field of a record: an id and its encoded value. */
export interface FieldBytes {
  id: number;
  value: Uint8Array;
}

/** A record's field triples, ascending by field id (10 §8.1). */
export function recordBody(fields: readonly FieldBytes[]): Uint8Array {
  const sorted = [...fields].sort((a, b) => a.id - b.id);
  const w = new ByteWriter();
  let last = -1;
  for (const f of sorted) {
    if (f.id === last) throw new Error(`duplicate field id ${f.id}`);
    last = f.id;
    w.u16(f.id).u32(f.value.length).bytes(f.value);
  }
  return w.finish();
}

/** A list value whose items are records: u32 count, then per item u32 length and its triples. */
export function recordList(items: readonly (readonly FieldBytes[])[]): Uint8Array {
  const w = new ByteWriter();
  w.u32(items.length);
  for (const it of items) {
    const body = recordBody(it);
    w.u32(body.length).bytes(body);
  }
  return w.finish();
}

/** A typed records section: u32 count, then per record u16 recordType, u32 length and its triples. */
export function typedRecords(
  records: readonly { type: number; fields: readonly FieldBytes[] }[],
): Uint8Array {
  const w = new ByteWriter();
  w.u32(records.length);
  for (const r of [...records].sort((a, b) => a.type - b.type)) {
    const body = recordBody(r.fields);
    w.u16(r.type).u32(body.length).bytes(body);
  }
  return w.finish();
}

export function scalar(type: ColType, v: number | boolean): Uint8Array {
  const w = new ByteWriter(8);
  writeValue(w, type, v);
  return w.finish();
}

// ---------------------------------------------------------------- readers (tests and tools)

export interface ReadSection {
  id: number;
  version: number;
  codec: number;
  flags: number;
  offset: number;
  data: Uint8Array;
}

export function readSections(r: ByteReader, count: number): ReadSection[] {
  const out: ReadSection[] = [];
  for (let i = 0; i < count; i++) {
    if (r.pos % 8 !== 0) throw new Error(`section ${i} starts at ${r.pos}, not a multiple of 8`);
    const id = r.u32();
    const version = r.u16();
    const codec = r.u8();
    const flags = r.u8();
    const raw = r.u32();
    const stored = r.u32();
    if (codec !== 0 || raw !== stored)
      throw new Error(`section ${id}: codec ${codec}, raw ${raw}, stored ${stored}`);
    const offset = r.pos;
    const data = r.take(stored);
    const pad = (8 - (r.pos % 8)) % 8;
    const zeros = r.take(pad);
    if (zeros.some((b) => b !== 0)) throw new Error(`section ${id}: nonzero padding`);
    out.push({ id, version, codec, flags, offset, data });
  }
  return out;
}

export interface ReadColumn {
  name: string;
  type: ColType;
  offset: number;
  values: (number | boolean)[];
}

export function readColumnTable(data: Uint8Array): { rows: number; columns: ReadColumn[] } {
  const r = new ByteReader(data);
  const rows = r.u32();
  const n = r.u16();
  if (r.u16() !== 0) throw new Error('reserved field not zero');
  const dec = new TextDecoder();
  const byCode = new Map(sortedEntries(TYPE_CODES).map(([k, v]) => [v, k as ColType]));
  const dir: { name: string; type: ColType; offset: number; length: number }[] = [];
  for (let i = 0; i < n; i++) {
    const name = dec.decode(r.take(r.u8()));
    const code = r.u8() as (typeof TYPE_CODES)[ColType];
    const type = byCode.get(code);
    if (!type) throw new Error(`column ${name}: unknown type ${code}`);
    if (r.u8() !== 0) throw new Error('reserved byte not zero');
    const offset = r.u32();
    const length = r.u32();
    if (offset % 8 !== 0) throw new Error(`column ${name} at ${offset}, not 8-aligned`);
    if (length !== rows * TYPE_WIDTH[type])
      throw new Error(`column ${name}: length ${length} for ${rows} rows`);
    dir.push({ name, type, offset, length });
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const columns = dir.map((c) => {
    const values: (number | boolean)[] = [];
    for (let i = 0; i < rows; i++) {
      const at = c.offset + i * TYPE_WIDTH[c.type];
      switch (c.type) {
        case 'u8':
          values.push(view.getUint8(at));
          break;
        case 'u16':
          values.push(view.getUint16(at, true));
          break;
        case 'u32':
          values.push(view.getUint32(at, true));
          break;
        case 'i32':
          values.push(view.getInt32(at, true));
          break;
        case 'f32':
          values.push(view.getFloat32(at, true));
          break;
        case 'f64':
          values.push(view.getFloat64(at, true));
          break;
        case 'bool':
          values.push(view.getUint8(at) !== 0);
          break;
        default:
          values.push(Number(view.getBigInt64(at, true)));
      }
    }
    return { name: c.name, type: c.type, offset: c.offset, values };
  });
  return { rows, columns };
}
