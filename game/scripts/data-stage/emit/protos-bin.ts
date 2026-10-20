// prototypes.bin (10 §15.2): the simulation's prototype tables, self-contained so Rust needs no JSON.
//
//   header (56 bytes): magic "PWPROTO\0", u32 formatVersion, u8 schemaHash[32], u32 dataVersion,
//                      u32 sectionCount, u32 reserved (0; pads the header to a multiple of 8)
//   sections in the save container's framing (10 §8.1), codec 0, ascending by id:
//     PROTO_ITEM … PROTO_SIGNAL (column tables indexed by dense id), LISTS, META (typed records),
//     EXPR (expression bytecode), NAMES (each kind's names in id order, in ProtoKind order)
import { ByteWriter } from '../../lib/bytes.ts';
import { sortedKeys } from '../../lib/canonical.ts';
import { type Model, PROTO_KINDS, type ProtoKind, type Ranked } from '../model.ts';
import {
  type ColType,
  type ColumnData,
  columnTable,
  recordList,
  scalar,
  typedRecords,
  writeSection,
} from './container.ts';
import { contentsRecord } from './contents.ts';
import { type Ctx, EmitError, ExprPool, ListPool, META_RECORDS, SECTION_IDS, TABLES } from './tables.ts';

export const MAGIC = new TextEncoder().encode('PWPROTO\0');
export const FORMAT_VERSION = 1;
/** The design data's schema version (design/spec/data/SCHEMA.md: v2). */
export const DATA_VERSION = 2;
export const HEADER_BYTES = 56;
/** The section version: the schema version at which its layout last changed (1 until C1b's schema). */
export const SECTION_VERSION = 1;

export interface TableSummary {
  section: string;
  rows: number;
  columns: string[];
}

/** A value the writer refused, with the prototype and the YAML field it comes from (C1a-r1 finding 1). */
export interface EmitProblem {
  kind: ProtoKind;
  id: string;
  /** The prototype's index in its YAML file. */
  filePos: number;
  path: readonly (string | number)[];
  message: string;
}

const INT_RANGE: Partial<Record<ColType, [number, number]>> = {
  u8: [0, 0xff],
  u16: [0, 0xffff],
  u32: [0, 0xffffffff],
  i8: [-0x80, 0x7f],
  i16: [-0x8000, 0x7fff],
  i32: [-0x80000000, 0x7fffffff],
  u64: [0, Number.MAX_SAFE_INTEGER],
  i64: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
};
const F32_MAX = 3.4028234663852886e38;

/** Why a value cannot be written to a column of this type, or null. Floats must be finite: no NaN or infinity. */
export function valueProblem(type: ColType, v: number | boolean): string | null {
  if (type === 'bool') return typeof v === 'boolean' ? null : `${v} is not a boolean`;
  if (typeof v !== 'number') return `${v} is not a number`;
  if (type === 'f64' || type === 'f32') {
    if (!Number.isFinite(v)) return `${v} is not a finite number`;
    if (type === 'f32' && Math.abs(v) > F32_MAX) return `${v} does not fit an f32`;
    return null;
  }
  const [lo, hi] = INT_RANGE[type] as [number, number];
  if (!Number.isInteger(v)) return `${v} is not an integer`;
  if (v < lo || v > hi) return `${v} does not fit a ${type}`;
  return null;
}

export function writePrototypesBin(
  model: Model,
  schemaHash: Uint8Array,
): { bytes: Uint8Array; tables: TableSummary[]; problems: EmitProblem[] } {
  if (schemaHash.length !== 32) throw new Error('the schema hash is 32 bytes');
  const ctx: Ctx = { model, lists: new ListPool(), exprs: new ExprPool() };
  const sections: { id: number; data: Uint8Array }[] = [];
  const tables: TableSummary[] = [];
  const problems: EmitProblem[] = [];
  for (const t of TABLES) {
    const rows = t.rows(model);
    const cols: ColumnData[] = t.columns.map((c) => ({ name: c.name, type: c.type, values: [] }));
    const declared = new Set(cols.map((c) => c.name));
    for (const r of rows as readonly Ranked<unknown>[]) {
      const problem = (path: readonly (string | number)[], message: string) =>
        problems.push({ kind: t.kind, id: r.id, filePos: r.filePos, path, message });
      let v: Record<string, number | boolean>;
      try {
        v = t.row(r as never, ctx);
      } catch (e) {
        if (!(e instanceof Error)) throw e;
        problem(e instanceof EmitError ? e.path : [], e.message);
        continue;
      }
      for (const k of sortedKeys(v))
        if (!declared.has(k)) throw new Error(`${t.section}: undeclared column ${k}`);
      for (const c of t.columns) {
        const x = v[c.name];
        if (x === undefined) throw new Error(`${t.section}: no value for column ${c.name}`);
        const bad = valueProblem(c.type, x);
        if (bad) problem(c.path ?? [], `${c.name} (${c.from}): ${bad}`);
        (cols.find((k) => k.name === c.name) as ColumnData).values.push(x);
      }
    }
    if (problems.length > 0) continue;
    sections.push({ id: SECTION_IDS[t.section], data: columnTable(rows.length, cols) });
    tables.push({
      section: t.section,
      rows: rows.length,
      columns: t.columns.map((c) => `${c.name}:${c.type}`),
    });
  }
  // META: the start record. Field 1: the start inventory, a list of {1: u16 item, 2: u32 count} by item id.
  const inv = [...model.build.startInventory]
    .map(([name, count]) => ({ id: model.ids.item.get(name), count }))
    .filter((x): x is { id: number; count: number } => x.id !== undefined)
    .sort((a, b) => a.id - b.id);
  const strList = (xs: readonly string[]): Uint8Array => {
    const w = new ByteWriter();
    w.u32(xs.length);
    for (const x of xs) w.str16(x);
    return w.finish();
  };
  const contents = contentsRecord();
  const meta = typedRecords([
    {
      type: META_RECORDS.contents,
      fields: [
        { id: 1, value: strList(contents.meta) },
        { id: 2, value: strList(contents.omitted) },
      ],
    },
    {
      type: META_RECORDS.start,
      fields: [
        {
          id: 1,
          value: recordList(
            inv.map((x) => [
              { id: 1, value: scalar('u16', x.id) },
              { id: 2, value: scalar('u32', x.count) },
            ]),
          ),
        },
      ],
    },
  ]);
  const names = new ByteWriter();
  const lists: Record<ProtoKind, { id: string }[]> = {
    item: model.items,
    fluid: model.fluids,
    recipe: model.recipes,
    entity: model.entities,
    technology: model.technologies,
    resource: model.resources,
    tile: model.tiles,
    world: model.world,
    signal: model.signals,
  };
  for (const k of PROTO_KINDS) {
    names.u16(lists[k].length);
    for (const r of lists[k]) names.str16(r.id);
  }
  if (problems.length > 0) return { bytes: new Uint8Array(0), tables, problems };
  sections.push({ id: SECTION_IDS.LISTS, data: ctx.lists.finish() });
  sections.push({ id: SECTION_IDS.META, data: meta });
  sections.push({ id: SECTION_IDS.EXPR, data: ctx.exprs.finish() });
  sections.push({ id: SECTION_IDS.NAMES, data: names.finish() });
  sections.sort((a, b) => a.id - b.id);

  const w = new ByteWriter(1 << 16);
  w.bytes(MAGIC).u32(FORMAT_VERSION).bytes(schemaHash).u32(DATA_VERSION).u32(sections.length).u32(0);
  if (w.length !== HEADER_BYTES) throw new Error('header size');
  for (const s of sections) writeSection(w, { id: s.id, version: SECTION_VERSION, flags: 0, data: s.data });
  return { bytes: w.finish(), tables, problems };
}
