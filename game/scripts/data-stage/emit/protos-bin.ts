// prototypes.bin (10 §15.2): the simulation's prototype tables, self-contained so Rust needs no JSON. Its
// layout is schema/protos.yaml's; the generated writer (src/shared/gen/protos.ts) writes it from the rows
// of emit/rows.ts, and the generated `Protos::load` reads it.
//
//   header (56 bytes): magic "PWPROTO\0", u32 formatVersion, u8 schemaHash[32], u32 dataVersion,
//                      u32 sectionCount, u32 reserved (0; pads the header to a multiple of 8)
//   sections in the save container's framing (10 §8.1), codec 0, ascending by id:
//     PROTO_ITEM … PROTO_SIGNAL (column tables indexed by dense id), LISTS, META (typed records),
//     EXPR (expression bytecode), NAMES (each kind's names in id order, in ProtoKind order)
import {
  ENTITY_COLUMNS,
  FLUID_COLUMNS,
  ITEM_COLUMNS,
  PROTOS_DATA_VERSION,
  PROTOS_FORMAT_VERSION,
  PROTOS_HEADER_SIZE,
  PROTOS_MAGIC,
  PROTOS_SECTION_VERSION,
  type ProtoColumnInfo,
  ProtoSection,
  ProtosWriteError,
  RECIPE_COLUMNS,
  RESOURCE_COLUMNS,
  SIGNAL_COLUMNS,
  TECHNOLOGY_COLUMNS,
  TILE_COLUMNS,
  WORLD_OBJECT_COLUMNS,
  writePrototypesBin as writeBin,
} from '../../../src/shared/gen/protos.ts';
import { CHARACTER, type Model, type ProtoKind } from '../model.ts';
import { type EmitProblem, protosInput, typeName } from './rows.ts';

export type { EmitProblem } from './rows.ts';

export const MAGIC = new TextEncoder().encode(PROTOS_MAGIC);
export const FORMAT_VERSION = PROTOS_FORMAT_VERSION;
/** The design data's schema version (design/spec/data/SCHEMA.md: v2). */
export const DATA_VERSION = PROTOS_DATA_VERSION;
export const HEADER_BYTES = PROTOS_HEADER_SIZE;
export const SECTION_VERSION = PROTOS_SECTION_VERSION;
/** The section ids by their schema names, in file order. */
export const SECTION_IDS = {
  PROTO_ITEM: ProtoSection.proto_item,
  PROTO_FLUID: ProtoSection.proto_fluid,
  PROTO_RECIPE: ProtoSection.proto_recipe,
  PROTO_ENTITY: ProtoSection.proto_entity,
  PROTO_TECH: ProtoSection.proto_tech,
  PROTO_RESOURCE: ProtoSection.proto_resource,
  PROTO_TILE: ProtoSection.proto_tile,
  PROTO_WORLD: ProtoSection.proto_world,
  PROTO_SIGNAL: ProtoSection.proto_signal,
  LISTS: ProtoSection.lists,
  META: ProtoSection.meta,
  EXPR: ProtoSection.expr,
  NAMES: ProtoSection.names,
} as const;

export interface TableSummary {
  section: string;
  rows: number;
  columns: string[];
}

/** Per kind table: the data stage's kind, the writer's table name, the section, the columns. */
const TABLES: readonly {
  kind: ProtoKind;
  table: string;
  section: keyof typeof SECTION_IDS;
  columns: readonly ProtoColumnInfo[];
}[] = [
  { kind: 'item', table: 'item', section: 'PROTO_ITEM', columns: ITEM_COLUMNS },
  { kind: 'fluid', table: 'fluid', section: 'PROTO_FLUID', columns: FLUID_COLUMNS },
  { kind: 'recipe', table: 'recipe', section: 'PROTO_RECIPE', columns: RECIPE_COLUMNS },
  { kind: 'entity', table: 'entity', section: 'PROTO_ENTITY', columns: ENTITY_COLUMNS },
  { kind: 'technology', table: 'technology', section: 'PROTO_TECH', columns: TECHNOLOGY_COLUMNS },
  { kind: 'resource', table: 'resource', section: 'PROTO_RESOURCE', columns: RESOURCE_COLUMNS },
  { kind: 'tile', table: 'tile', section: 'PROTO_TILE', columns: TILE_COLUMNS },
  { kind: 'world', table: 'world_object', section: 'PROTO_WORLD', columns: WORLD_OBJECT_COLUMNS },
  { kind: 'signal', table: 'signal', section: 'PROTO_SIGNAL', columns: SIGNAL_COLUMNS },
];

/** The records of a kind in id order (the entity table's character row has none). */
function records(m: Model, kind: ProtoKind): readonly { id: string; filePos: number }[] {
  switch (kind) {
    case 'item':
      return m.items;
    case 'fluid':
      return m.fluids;
    case 'recipe':
      return m.recipes;
    case 'entity':
      return m.entities;
    case 'technology':
      return m.technologies;
    case 'resource':
      return m.resources;
    case 'tile':
      return m.tiles;
    case 'world':
      return m.world;
    case 'signal':
      return m.signals;
  }
}

export function writePrototypesBin(
  model: Model,
  schemaHash: Uint8Array,
): { bytes: Uint8Array; tables: TableSummary[]; problems: EmitProblem[] } {
  if (schemaHash.length !== 32) throw new Error('the schema hash is 32 bytes');
  const { input, problems } = protosInput(model, schemaHash);
  if (problems.length > 0) return { bytes: new Uint8Array(0), tables: [], problems };
  let bytes: Uint8Array;
  try {
    bytes = writeBin(input);
  } catch (e) {
    if (!(e instanceof ProtosWriteError)) throw e;
    // A value inside a list entry (rows.ts checked every scalar column): name its prototype.
    const kind = TABLES.find((t) => t.table === e.table)?.kind ?? 'item';
    const rec = records(model, kind)[e.row] ?? {
      id: kind === 'entity' ? CHARACTER : `#${e.row}`,
      filePos: -1,
    };
    return {
      bytes: new Uint8Array(0),
      tables: [],
      problems: [{ kind, id: rec.id, filePos: rec.filePos, path: [], message: e.message }],
    };
  }
  const rows = input as unknown as Record<string, readonly unknown[]>;
  const tables = TABLES.map((t) => ({
    section: t.section,
    rows: rows[t.table]?.length ?? 0,
    columns: t.columns.map((c) => `${c.name}:${typeName(c.code)}`),
  }));
  return { bytes, tables, problems };
}
