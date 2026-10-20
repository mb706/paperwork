// The schema model (10 §15.1): game/schema/*.yaml parsed, validated and resolved into declarations with
// complete layouts. Everything the emitters, the listing (and so SCHEMA_HASH), the samples and the probes
// need comes from here; nothing downstream reads YAML.
//
// Kinds of declaration (one namespace across all files):
//   id       a newtype over an integer scalar (`none` is its "absent" value, when it has one)
//   enum     explicit values over an integer scalar; decoders refuse other values
//   flags    explicit bits over an integer scalar; decoders refuse unknown bits
//   struct   a fixed-size packed record (fields in order, no padding unless written out)
//   message  a packed record with variable-length parts, decoded in order
//   record   a field-id record (§8.1): u32 length, then (u16 id, u32 length, value) triples
//   table    a column table (§8.1): the entity table and the pools (state.yaml)
import { z } from 'zod';
import { compareCodeUnits, sortedEntries, sortedKeys } from '../lib/canonical.ts';
import { fail, type Path, type Source } from './yaml.ts';

export const SCALARS = ['u8', 'u16', 'u32', 'u64', 'i8', 'i16', 'i32', 'i64', 'f32', 'f64', 'bool'] as const;
export type Scalar = (typeof SCALARS)[number];
export const INT_SCALARS = ['u8', 'u16', 'u32', 'u64', 'i8', 'i16', 'i32', 'i64'] as const;
export type IntScalar = (typeof INT_SCALARS)[number];

export const SCALAR_SIZE: Record<Scalar, number> = {
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

/** §8.1's column type codes. */
export const TYPE_CODE: Record<Scalar, number> = {
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

/** 2^n, exactly (no `**` in deterministic code, D14). */
export function pow2(n: number): number {
  return Number(1n << BigInt(n));
}

export function isInt(s: Scalar): s is IntScalar {
  return (INT_SCALARS as readonly string[]).includes(s);
}
export function isSigned(s: Scalar): boolean {
  return s.startsWith('i');
}
export function isWide(s: Scalar): boolean {
  return s === 'u64' || s === 'i64';
}
export function isFloat(s: Scalar): boolean {
  return s === 'f32' || s === 'f64';
}

/** The range of an integer scalar, as bigints. */
export function intRange(s: IntScalar): [bigint, bigint] {
  const bits = BigInt(SCALAR_SIZE[s] * 8);
  return isSigned(s) ? [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n] : [0n, (1n << bits) - 1n];
}

// ------------------------------------------------------------------------------------------------ types

export type Ty =
  | { k: 'scalar'; s: Scalar }
  | { k: 'id'; d: IdDecl }
  | { k: 'enum'; d: EnumDecl }
  | { k: 'flags'; d: FlagsDecl }
  | { k: 'struct'; d: StructDecl }
  | { k: 'array'; of: Ty; n: number }
  | { k: 'message'; d: MessageDecl }
  | { k: 'record'; d: RecordDecl }
  | { k: 'str'; max: number }
  | { k: 'bytes'; max: number; lenWidth: 2 | 4 }
  | { k: 'list'; of: Ty; max: number; countWidth: 2 | 4 }
  | { k: 'blob_or_bytes'; max: number }
  | { k: 'counted'; of: Ty; count: string; minus: number }
  | { k: 'rest'; of: Ty };

export interface Field {
  name: string;
  ty: Ty;
  doc?: string;
  /** Record field id (§8.1). */
  id?: number;
  range?: [number, number];
  allowed?: number[];
  /** Fields named `reserved…`: always zero, not part of the decoded value. */
  reserved: boolean;
  /** Presence decided by a flag bit of an earlier field (messages). */
  when?: { field: string; bit: string };
  // state.yaml attributes (§15.1).
  saved?: boolean;
  derived?: string;
  presentation?: boolean;
  order?: 'serial' | 'key' | 'slot' | 'saved' | 'set' | 'none';
  default?: number | boolean;
  unit?: string;
  wraps?: boolean;
  since?: number;
  view?: boolean;
  digest?: 'tick';
  keep?: boolean;
  // protos.yaml attributes.
  optional?: boolean;
  from?: string;
  path?: (string | number)[];
  refKind?: string;
  /** The formula field an ExprRef evaluates (protos.yaml): its variables and range. */
  formula?: string;
  /** Byte offset in a struct, or in a message's fixed prefix. */
  offset?: number;
  /** A count field that a counted array names: not part of the decoded value. */
  hidden?: boolean;
}

interface DeclBase {
  name: string;
  doc?: string;
  file: string;
  /** Which crate holds the Rust: `schema` (shared), or `sim` (crates/sim/src/gen, state.yaml only). */
  home: 'schema' | 'sim';
}
export interface IdDecl extends DeclBase {
  kind: 'id';
  base: IntScalar;
  none?: number;
}
export interface EnumValue {
  name: string;
  value: number;
  doc?: string;
}
export interface EnumDecl extends DeclBase {
  kind: 'enum';
  base: IntScalar;
  values: EnumValue[];
  /** FailReason's developer reasons: no player-facing text. */
  developer: string[];
  /** The locale-key prefix of the values (`fail-reason` → `fail-reason.target-gone`), for prototypes.json. */
  locale?: string;
  /** Synthesized from a list (actions, sections …) rather than declared. */
  synthetic?: string;
}
export interface FlagsDecl extends DeclBase {
  kind: 'flags';
  base: IntScalar;
  bits: { name: string; bit: number }[];
}
export interface StructDecl extends DeclBase {
  kind: 'struct';
  fields: Field[];
  size: number;
  check?: 'entity_ref';
}
export interface MessageDecl extends DeclBase {
  kind: 'message';
  fields: Field[];
  padTo?: number;
  /** The size when every field is fixed, else null. */
  fixed: number | null;
  /** The offset of the first variable field (the whole size when fixed). */
  prefix: number;
  /** The largest encoding, or null when unbounded (rest arrays, counted arrays of unbounded counts). */
  maxSize: number | null;
  minSize: number;
}
export interface RecordDecl extends DeclBase {
  kind: 'record';
  fields: Field[];
}
export interface TableDecl extends DeclBase {
  kind: 'table';
  fields: Field[];
  section: string;
  live: string;
}
export type Decl = IdDecl | EnumDecl | FlagsDecl | StructDecl | MessageDecl | RecordDecl | TableDecl;

// ------------------------------------------------------------------------------------------- definitions

export interface ActionDef {
  name: string;
  id: number;
  held: boolean;
  system: boolean;
  doc?: string;
  /** The payload: input_gen first for held actions. */
  msg: MessageDecl;
}
export interface EventDef {
  name: string;
  id: number;
  doc?: string;
  msg: MessageDecl;
}
export interface PacketSectionDef {
  name: string;
  id: number;
  kind: 'snapshot' | 'event' | 'delta';
  /** A struct or message name, or `events` / `ui`. */
  record: string;
  recordVersion: number;
}
export interface KindDef {
  name: string;
  id: number;
  cadence: 'every' | 'slow';
  target: 'none' | 'entity' | 'player';
  params?: Record<string, string>;
  sources?: string[];
  record?: MessageDecl;
}
export interface QueryDef {
  name: string;
  id: number;
  dev: boolean;
  params?: StructDecl | MessageDecl;
  result?: StructDecl | MessageDecl;
}
export type ShardRule =
  | { k: 'serial' }
  | { k: 'chunk' }
  | { k: 'player' }
  | { k: 'key' }
  | { k: 'timer' }
  | { k: 'owner' }
  | { k: 'pieces'; base: number; step: number };
export interface SaveSectionDef {
  name: string;
  id: number;
  version: number;
  encoding: 'table' | 'record' | 'records' | 'raw';
  table?: TableDecl;
  record?: RecordDecl;
  key?: string[];
  hashed: boolean;
  shard?: ShardRule;
  headerShard?: number;
  format?: string;
  doc?: string;
}
export interface ExportDef {
  name: string;
  module: 'sim' | 'gen';
  kind: 'plain' | 'input' | 'status' | 'envelope' | 'error';
  params: { name: string; ty: Ty }[];
  returns?: Scalar;
  input?: string;
  output?: string;
  doc?: string;
}
export interface ImportDef {
  name: string;
  params: { name: string; ty: Ty }[];
  returns?: Scalar;
  doc?: string;
}
export interface ProtoColumn {
  name: string;
  ty: Ty;
  optional: boolean;
  from: string;
  path?: (string | number)[];
  refKind?: string;
  formula?: string;
}
export interface ProtoTableDef {
  name: string;
  section: string;
  sectionId: number;
  kind: string;
  columns: ProtoColumn[];
}
export interface JsonType {
  k:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'hex32'
    | 'named'
    | 'array'
    | 'nullable'
    | 'object'
    | 'map';
  name?: string;
  of?: JsonType;
  fields?: [string, JsonType][];
}
export interface RegistryDef {
  name: string;
  doc?: string;
  /** An enum (declared values, or a referenced enum such as TriggerType), or a list of strings. */
  enumDecl?: EnumDecl;
  strings?: string[];
}

export interface Schema {
  versions: { schema: number; action: number; packet: number; abi: number; genAbi: number; protocol: number };
  decls: Map<string, Decl>;
  /** Declaration names, sorted. */
  names: string[];
  actions: ActionDef[];
  actionLimits: Record<string, number>;
  events: EventDef[];
  eventLimits: Record<string, number>;
  packet: { magic: number; limits: Record<string, number>; sections: PacketSectionDef[] };
  projections: { limits: Record<string, number>; kinds: KindDef[]; queries: QueryDef[] };
  save: {
    magic: string;
    formatVersion: number;
    headerAlign: number;
    shards: number;
    sections: SaveSectionDef[];
    reserved: { name: string; id: number }[];
    closureLog: { magic: number; formatVersion: number };
    header: [string, { json: string; doc?: string }][];
  };
  abi: { exports: ExportDef[]; imports: ImportDef[] };
  protos: {
    magic: string;
    formatVersion: number;
    dataVersion: number;
    sectionVersion: number;
    sections: { name: string; id: number; kind?: string }[];
    tables: ProtoTableDef[];
    meta: { name: string; type: number; record: RecordDecl; block?: string }[];
    expr: { maxStack: number; powiLimit: number; ops: { name: string; code: number; operand?: Scalar }[] };
    formulas: { name: string; vars: string[]; range: [number, number]; doc?: string }[];
    json: { formatVersion: number; types: [string, JsonType][]; root: JsonType };
  };
  registries: RegistryDef[];
  wellKnown: { name: string; kind: string; doc?: string }[];
}

// ------------------------------------------------------------------------------------------- name helpers

export function pascal(snake: string): string {
  return snake
    .split(/[_-]/)
    .filter((p) => p.length > 0)
    .map((p) => (p[0] as string).toUpperCase() + p.slice(1))
    .join('');
}
export function upperSnake(s: string): string {
  return s.replace(/-/g, '_').toUpperCase();
}
/** The Rust/TypeScript type name of a declaration. */
export function typeName(d: Decl): string {
  if (d.kind === 'record') return pascal(d.name);
  if (d.kind === 'table') return d.name === 'entity_table' ? 'EntityTable' : `${pascal(d.name)}Pool`;
  return d.name;
}

// ------------------------------------------------------------------------------------------------ parsing

const FILES = [
  'types',
  'actions',
  'events',
  'packet',
  'projections',
  'state',
  'sections',
  'abi',
  'protos',
  'registries',
] as const;
export type SchemaFile = (typeof FILES)[number];
export const SCHEMA_FILES: readonly SchemaFile[] = FILES;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DECL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

const fieldAttrs = z.strictObject({
  type: z.string(),
  doc: z.string().optional(),
  max: z.int().nonnegative().optional(),
  item_max: z.int().nonnegative().optional(),
  range: z.tuple([z.number(), z.number()]).optional(),
  allowed: z.array(z.int()).optional(),
  id: z.int().min(1).max(65535).optional(),
  saved: z.boolean().optional(),
  derived: z.string().optional(),
  presentation: z.boolean().optional(),
  order: z.enum(['serial', 'key', 'slot', 'saved', 'set', 'none']).optional(),
  default: z.union([z.number(), z.boolean()]).optional(),
  unit: z.string().optional(),
  wraps: z.boolean().optional(),
  since: z.int().positive().optional(),
  view: z.boolean().optional(),
  digest: z.literal('tick').optional(),
  keep: z.boolean().optional(),
  when: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/)
    .optional(),
  count: z.enum(['u16', 'u32']).optional(),
  len: z.enum(['u16', 'u32']).optional(),
  optional: z.boolean().optional(),
  from: z.string().optional(),
  path: z.array(z.union([z.string(), z.int()])).optional(),
  ref_kind: z.string().optional(),
  formula: z.string().optional(),
});
type FieldAttrs = z.infer<typeof fieldAttrs>;

/** `- name: value` lists: each item a mapping with exactly one key. */
function singles(src: Source, path: Path, v: unknown): { name: string; value: unknown; at: Path }[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(src, path, 'expected a list of `- name: …` entries (order matters, §15.1)');
  return v.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      fail(src, [...path, i], 'expected a single-key mapping `- name: …`');
    const keys = sortedKeys(item);
    if (keys.length !== 1) fail(src, [...path, i], `expected one key, found ${keys.length}`);
    const name = keys[0] as string;
    return { name, value: (item as Record<string, unknown>)[name], at: [...path, i, name] };
  });
}

function parseWith<T>(src: Source, path: Path, schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  fail(src, [...path, ...((issue?.path ?? []) as (string | number)[])], issue?.message ?? 'invalid');
}

function asObject(src: Source, path: Path, v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(src, path, 'expected a mapping');
  return v as Record<string, unknown>;
}

function checkKeys(src: Source, path: Path, o: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of sortedKeys(o))
    if (!allowed.includes(k)) fail(src, [...path, k], `unknown key (allowed: ${allowed.join(', ')})`);
}

interface RawField {
  name: string;
  attrs: FieldAttrs;
  at: Path;
}

function rawFields(src: Source, path: Path, v: unknown): RawField[] {
  if (v !== undefined && v !== null && !Array.isArray(v))
    fail(src, path, 'fields must be a list of `- name: type` entries (order matters, §15.1)');
  return singles(src, path, v).map(({ name, value, at }) => {
    if (!NAME.test(name)) fail(src, at, `bad field name ${name}`);
    const attrs = typeof value === 'string' ? { type: value } : parseWith(src, at, fieldAttrs, value);
    return { name, attrs, at };
  });
}

interface Pending {
  src: Source;
  at: Path;
  home: 'schema' | 'sim';
}

/** Everything read from the files before types resolve. */
interface Raw {
  sources: Map<SchemaFile, Source>;
  decls: Map<string, { kind: Decl['kind']; spec: Record<string, unknown>; p: Pending }>;
  file: Record<SchemaFile, Record<string, unknown>>;
}

const DECL_BLOCKS = {
  ids: 'id',
  enums: 'enum',
  flags: 'flags',
  structs: 'struct',
  messages: 'message',
  records: 'record',
  tables: 'table',
} as const;

const FILE_KEYS: Record<SchemaFile, readonly string[]> = {
  types: ['schema_version', 'ids', 'enums', 'flags', 'structs'],
  actions: ['version', 'limits', 'batch', 'header', 'structs', 'flags', 'actions', 'system_actions'],
  events: ['limits', 'flags', 'header', 'record', 'structs', 'messages', 'events'],
  packet: ['version', 'magic', 'limits', 'flags', 'enums', 'structs', 'messages', 'sections'],
  projections: ['limits', 'flags', 'enums', 'structs', 'messages', 'kinds', 'queries'],
  state: ['tables', 'structs', 'enums', 'records'],
  sections: [
    'container',
    'enums',
    'flags',
    'messages',
    'shards',
    'sections',
    'reserved_sections',
    'closure_log',
    'structs',
    'save_header',
  ],
  abi: [
    'abi_version',
    'gen_abi_version',
    'protocol_version',
    'enums',
    'flags',
    'structs',
    'messages',
    'records',
    'sim_exports',
    'gen_exports',
    'imports',
  ],
  protos: [
    'magic',
    'format_version',
    'data_version',
    'section_version',
    'sections',
    'structs',
    'kind_tables',
    'meta',
    'records',
    'expr',
    'formulas',
    'json',
  ],
  registries: ['registries', 'well_known'],
};

function collect(sources: Map<SchemaFile, Source>): Raw {
  const raw: Raw = { sources, decls: new Map(), file: {} as Raw['file'] };
  for (const f of FILES) {
    const src = sources.get(f);
    if (!src) throw new Error(`schema/${f}.yaml is missing`);
    const top = asObject(src, [], src.value);
    checkKeys(src, [], top, FILE_KEYS[f]);
    raw.file[f] = top;
    for (const [block, kind] of sortedEntries(DECL_BLOCKS)) {
      if (!(block in top)) continue;
      for (const { name, value, at } of singles(src, [block], top[block])) {
        if (!DECL_NAME.test(name)) fail(src, at, `bad declaration name ${name}`);
        if (raw.decls.has(name)) fail(src, at, `${name} is declared twice`);
        raw.decls.set(name, {
          kind,
          spec: asObject(src, at, value),
          p: { src, at, home: f === 'state' ? 'sim' : 'schema' },
        });
      }
    }
  }
  return raw;
}

// ------------------------------------------------------------------------------------------- resolution

interface Ctx {
  raw: Raw;
  decls: Map<string, Decl>;
  resolving: Set<string>;
}

function intOf(src: Source, path: Path, v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(src, path, `${what} must be an integer`);
  return v;
}

function checkFits(src: Source, path: Path, base: IntScalar, v: number): void {
  const [lo, hi] = intRange(base);
  if (BigInt(v) < lo || BigInt(v) > hi) fail(src, path, `${v} does not fit ${base}`);
}

function resolveDecl(ctx: Ctx, name: string): Decl {
  const have = ctx.decls.get(name);
  if (have) return have;
  const r = ctx.raw.decls.get(name);
  if (!r) throw new Error(`unknown declaration ${name}`);
  if (ctx.resolving.has(name)) fail(r.p.src, r.p.at, `${name} contains itself`);
  ctx.resolving.add(name);
  const { src, at, home } = r.p;
  const s = r.spec;
  const base = { name, file: src.file, home, ...(typeof s.doc === 'string' ? { doc: s.doc } : {}) };
  let d: Decl;
  const intBase = (): IntScalar => {
    const b = s.base;
    if (typeof b !== 'string' || !(INT_SCALARS as readonly string[]).includes(b))
      fail(src, [...at, 'base'], 'base must be an integer scalar');
    return b as IntScalar;
  };
  switch (r.kind) {
    case 'id': {
      checkKeys(src, at, s, ['base', 'none', 'doc']);
      const b = intBase();
      const id: IdDecl = { ...base, kind: 'id', base: b };
      if (s.none !== undefined) {
        id.none = intOf(src, [...at, 'none'], s.none, 'none');
        checkFits(src, [...at, 'none'], b, id.none);
      }
      d = id;
      break;
    }
    case 'enum': {
      checkKeys(src, at, s, ['base', 'values', 'doc', 'developer', 'locale']);
      const b = intBase();
      const values: EnumValue[] = singles(src, [...at, 'values'], s.values).map(
        ({ name: vn, value, at: vat }) => {
          if (!/^[a-z0-9_]+$/.test(vn)) fail(src, vat, `enum value names are snake_case: ${vn}`);
          const v = intOf(src, vat, value, 'an enum value');
          checkFits(src, vat, b, v);
          return { name: vn, value: v };
        },
      );
      if (values.length === 0) fail(src, at, 'an enum needs values');
      const seenN = new Set<string>();
      const seenV = new Set<number>();
      for (const v of values) {
        if (seenN.has(v.name)) fail(src, at, `value ${v.name} twice`);
        if (seenV.has(v.value)) fail(src, at, `value ${v.value} used twice`);
        seenN.add(v.name);
        seenV.add(v.value);
      }
      const developer = (s.developer as string[] | undefined) ?? [];
      for (const dv of developer) if (!seenN.has(dv)) fail(src, [...at, 'developer'], `no value ${dv}`);
      const ed: EnumDecl = { ...base, kind: 'enum', base: b, values, developer };
      if (s.locale !== undefined) {
        if (typeof s.locale !== 'string' || !/^[a-z]+(-[a-z]+)*$/.test(s.locale))
          fail(src, [...at, 'locale'], 'a locale prefix is kebab-case, e.g. fail-reason');
        ed.locale = s.locale;
      } else if (developer.length > 0)
        fail(src, [...at, 'developer'], 'developer values need a `locale` prefix');
      d = ed;
      break;
    }
    case 'flags': {
      checkKeys(src, at, s, ['base', 'bits', 'doc']);
      const b = intBase();
      const width = SCALAR_SIZE[b] * 8;
      const bits = singles(src, [...at, 'bits'], s.bits).map(({ name: bn, value, at: bat }) => {
        if (!/^[a-z0-9_]+$/.test(bn)) fail(src, bat, `flag names are snake_case: ${bn}`);
        const bit = intOf(src, bat, value, 'a bit');
        if (bit < 0 || bit >= width) fail(src, bat, `bit ${bit} does not fit ${b}`);
        return { name: bn, bit };
      });
      if (new Set(bits.map((x) => x.bit)).size !== bits.length) fail(src, at, 'a bit is used twice');
      if (new Set(bits.map((x) => x.name)).size !== bits.length) fail(src, at, 'a flag name is used twice');
      d = { ...base, kind: 'flags', base: b, bits };
      break;
    }
    case 'struct': {
      checkKeys(src, at, s, ['fields', 'doc', 'check']);
      const fields = resolveFields(
        ctx,
        src,
        [...at, 'fields'],
        rawFields(src, [...at, 'fields'], s.fields),
        'struct',
      );
      let off = 0;
      for (const f of fields) {
        const n = fixedSize(f.ty);
        if (n === null) fail(src, [...at, 'fields'], `struct field ${f.name} is not fixed-size`);
        f.offset = off;
        off += n;
      }
      const st: StructDecl = { ...base, kind: 'struct', fields, size: off };
      if (s.check !== undefined) {
        if (s.check !== 'entity_ref') fail(src, [...at, 'check'], 'the only check is entity_ref');
        st.check = 'entity_ref';
      }
      d = st;
      break;
    }
    case 'message': {
      checkKeys(src, at, s, ['fields', 'doc', 'pad_to']);
      d = messageDecl(ctx, src, at, base, s.fields, s.pad_to);
      break;
    }
    case 'record': {
      checkKeys(src, at, s, ['fields', 'doc']);
      const fields = resolveFields(
        ctx,
        src,
        [...at, 'fields'],
        rawFields(src, [...at, 'fields'], s.fields),
        'record',
      );
      const ids = new Set<number>();
      fields.forEach((f, i) => {
        if (f.id === undefined) fail(src, [...at, 'fields', i], `record field ${f.name} needs an id (§15.1)`);
        if (ids.has(f.id)) fail(src, [...at, 'fields', i], `field id ${f.id} is used twice`);
        ids.add(f.id);
      });
      d = { ...base, kind: 'record', fields };
      break;
    }
    case 'table': {
      checkKeys(src, at, s, ['fields', 'doc', 'section', 'live']);
      const fields = resolveFields(
        ctx,
        src,
        [...at, 'fields'],
        rawFields(src, [...at, 'fields'], s.fields),
        'table',
      );
      for (const f of fields) {
        if (scalarOf(f.ty) === null)
          fail(src, [...at, 'fields'], `column ${f.name} must be a scalar, id, enum or flags`);
      }
      if (typeof s.section !== 'string') fail(src, [...at, 'section'], 'a table names its save section');
      if (typeof s.live !== 'string' || !fields.some((f) => f.name === s.live))
        fail(src, [...at, 'live'], 'live must name a column (a row is live when it is not zero)');
      d = { ...base, kind: 'table', fields, section: s.section, live: s.live };
      break;
    }
  }
  ctx.resolving.delete(name);
  ctx.decls.set(name, d);
  return d;
}

function messageDecl(
  ctx: Ctx,
  src: Source,
  at: Path,
  base: { name: string; file: string; home: 'schema' | 'sim'; doc?: string },
  fieldsV: unknown,
  padTo: unknown,
): MessageDecl {
  const fields = resolveFields(
    ctx,
    src,
    [...at, 'fields'],
    rawFields(src, [...at, 'fields'], fieldsV),
    'message',
  );
  const m: MessageDecl = { ...base, kind: 'message', fields, fixed: null, prefix: 0, maxSize: 0, minSize: 0 };
  if (padTo !== undefined) {
    if (padTo !== 4 && padTo !== 8) fail(src, [...at, 'pad_to'], 'pad_to is 4 or 8');
    m.padTo = padTo;
  }
  layoutMessage(src, at, m);
  return m;
}

/** Offsets of the fixed prefix, hidden count fields, and the size bounds. */
function layoutMessage(src: Source, at: Path, m: MessageDecl): void {
  let off: number | null = 0;
  let max: number | null = 0;
  let min = 0;
  m.fields.forEach((f, i) => {
    const fa = [...at, 'fields', i];
    if (f.ty.k === 'counted') {
      const cf = m.fields.slice(0, i).find((x) => x.name === (f.ty as { count: string }).count);
      if (!cf) fail(src, fa, `counted array ${f.name} names ${f.ty.count}, which is not an earlier field`);
      const cs = scalarOf(cf.ty);
      if (cs === null || !isInt(cs) || cf.ty.k === 'enum' || cf.ty.k === 'flags')
        fail(src, fa, `count field ${cf.name} must be an integer`);
      cf.hidden = true;
    }
    if (f.ty.k === 'rest' && i !== m.fields.length - 1) fail(src, fa, 'a `T[..]` field must be last');
    if (f.when) {
      const w = m.fields.slice(0, i).find((x) => x.name === f.when?.field);
      if (w?.ty.k !== 'flags' || !w.ty.d.bits.some((b) => b.bit !== undefined && b.name === f.when?.bit))
        fail(src, fa, `when: ${f.when.field}.${f.when.bit} must name a bit of an earlier flags field`);
    }
    const n = fixedSize(f.ty);
    if (off !== null) {
      if (n !== null && !f.when) {
        f.offset = off;
        off += n;
      } else {
        m.prefix = off;
        off = null;
      }
    }
    const mx = maxSize(f.ty, m.fields);
    max = max === null || mx === null ? null : max + mx;
    min += f.when ? 0 : minSize(f.ty);
  });
  if (off !== null) {
    m.fixed = off;
    m.prefix = off;
  }
  const pad = (x: number) => (m.padTo ? Math.ceil(x / m.padTo) * m.padTo : x);
  m.maxSize = max === null ? null : pad(max);
  m.minSize = pad(min);
  if (m.fixed !== null) m.fixed = pad(m.fixed);
}

function parseType(ctx: Ctx, src: Source, at: Path, t: string, a: FieldAttrs, ctxKind: string): Ty {
  t = t.trim();
  const packed = ctxKind !== 'record';
  let m = /^\[(.+);\s*(\d+)\]$/.exec(t);
  if (m) {
    const of = parseType(ctx, src, at, m[1] as string, { type: m[1] as string }, ctxKind);
    if (fixedSize(of) === null) fail(src, at, 'array items must be fixed-size');
    return { k: 'array', of, n: Number(m[2]) };
  }
  m = /^list<(.+)>$/.exec(t);
  if (m) {
    if (a.max === undefined) fail(src, at, '`list<T>` needs `max` (§15.1)');
    const inner = m[1] as string;
    const of =
      inner === 'str'
        ? ({ k: 'str', max: a.item_max ?? fail(src, at, '`list<str>` needs `item_max`') } as Ty)
        : parseType(ctx, src, at, inner, { type: inner }, ctxKind);
    const countWidth = (a.count ?? (packed ? 'u16' : 'u32')) === 'u16' ? 2 : 4;
    if (countWidth === 2 && a.max > 0xffff) fail(src, at, `max ${a.max} does not fit a u16 count`);
    return { k: 'list', of, max: a.max, countWidth };
  }
  m = /^(.+)\[([a-z_][a-z0-9_]*)(?:\s*-\s*(1))?\]$/.exec(t);
  if (m) {
    if (!packed) fail(src, at, 'counted arrays exist only in messages');
    const of = parseType(ctx, src, at, m[1] as string, { type: m[1] as string }, ctxKind);
    return { k: 'counted', of, count: m[2] as string, minus: m[3] ? 1 : 0 };
  }
  m = /^(.+)\[\.\.\]$/.exec(t);
  if (m) {
    if (!packed) fail(src, at, '`T[..]` exists only in messages');
    const of = parseType(ctx, src, at, m[1] as string, { type: m[1] as string }, ctxKind);
    if (fixedSize(of) === null) fail(src, at, '`T[..]` items must be fixed-size');
    return { k: 'rest', of };
  }
  if (t === 'str') {
    if (a.max === undefined) fail(src, at, '`str` needs `max` (UTF-8 bytes)');
    if (a.max > 0xffff) fail(src, at, 'a str is at most 65,535 bytes (u16 length)');
    return { k: 'str', max: a.max };
  }
  if (t === 'bytes') {
    if (a.max === undefined) fail(src, at, '`bytes` needs `max`');
    const lenWidth = (a.len ?? (packed ? 'u16' : 'u32')) === 'u16' ? 2 : 4;
    if (lenWidth === 2 && a.max > 0xffff) fail(src, at, 'max does not fit a u16 length');
    return { k: 'bytes', max: a.max, lenWidth };
  }
  if (t === 'blob_or_bytes') {
    if (!packed) fail(src, at, '`blob_or_bytes` exists only in actions');
    if (a.max === undefined || a.max > 0xffff) fail(src, at, '`blob_or_bytes` needs `max` ≤ 65,535');
    return { k: 'blob_or_bytes', max: a.max };
  }
  if (t === 'blob') return { k: 'struct', d: resolveDecl(ctx, 'Hash256') as StructDecl };
  if ((SCALARS as readonly string[]).includes(t)) return { k: 'scalar', s: t as Scalar };
  if (!ctx.raw.decls.has(t) && !ctx.decls.has(t)) fail(src, at, `unknown type ${t}`);
  const d = resolveDecl(ctx, t);
  switch (d.kind) {
    case 'id':
      return { k: 'id', d };
    case 'enum':
      return { k: 'enum', d };
    case 'flags':
      return { k: 'flags', d };
    case 'struct':
      return { k: 'struct', d };
    case 'message':
      if (!packed) fail(src, at, 'a record field cannot be a message');
      return { k: 'message', d };
    case 'record':
      return { k: 'record', d };
    case 'table':
      return fail(src, at, 'a table is not a field type');
  }
}

function resolveFields(ctx: Ctx, src: Source, path: Path, raws: RawField[], ctxKind: string): Field[] {
  const names = new Set<string>();
  return raws.map(({ name, attrs: a, at }) => {
    if (names.has(name)) fail(src, at, `field ${name} twice`);
    names.add(name);
    const ty = parseType(ctx, src, at, a.type, a, ctxKind);
    const f: Field = { name, ty, reserved: /^reserved\d*$/.test(name) };
    if (a.doc !== undefined) f.doc = a.doc;
    if (a.id !== undefined) {
      if (ctxKind !== 'record') fail(src, at, '`id` is for record fields');
      f.id = a.id;
    } else if (ctxKind === 'record') fail(src, at, `record field ${name} needs an id`);
    if (a.range) {
      if (scalarOf(ty) === null || !isInt(scalarOf(ty) as Scalar) || ty.k === 'enum' || ty.k === 'flags')
        fail(src, at, '`range` is for integer fields');
      f.range = a.range;
    }
    if (a.allowed) f.allowed = a.allowed;
    if (f.reserved) {
      const s = scalarOf(ty);
      if (s === null || !isInt(s) || ty.k !== 'scalar')
        fail(src, at, 'a reserved field is an unsigned integer scalar');
    }
    for (const k of [
      'saved',
      'derived',
      'presentation',
      'order',
      'default',
      'unit',
      'wraps',
      'since',
      'view',
      'digest',
      'keep',
      'optional',
      'from',
      'path',
    ] as const) {
      const v = a[k];
      if (v !== undefined) (f as unknown as Record<string, unknown>)[k] = v;
    }
    if (a.ref_kind !== undefined) f.refKind = a.ref_kind;
    if (a.formula !== undefined) f.formula = a.formula;
    if (a.when) {
      const [field, bit] = a.when.split('.') as [string, string];
      f.when = { field, bit };
    }
    void path;
    return f;
  });
}

// ------------------------------------------------------------------------------------------- type facts

/** The scalar a type is stored as, for scalars, ids, enums and flags; null otherwise. */
export function scalarOf(t: Ty): Scalar | null {
  switch (t.k) {
    case 'scalar':
      return t.s;
    case 'id':
    case 'enum':
    case 'flags':
      return t.d.base;
    default:
      return null;
  }
}

/** The encoded size of a fixed-size type, or null. Context-free: records are never fixed. */
export function fixedSize(t: Ty): number | null {
  switch (t.k) {
    case 'scalar':
      return SCALAR_SIZE[t.s];
    case 'id':
    case 'enum':
    case 'flags':
      return SCALAR_SIZE[t.d.base];
    case 'struct':
      return t.d.size;
    case 'array': {
      const n = fixedSize(t.of);
      return n === null ? null : n * t.n;
    }
    case 'message':
      return t.d.fixed;
    default:
      return null;
  }
}

/** The largest packed encoding of a type, or null when unbounded. Counted arrays use their count field's range. */
export function maxSize(t: Ty, siblings: readonly Field[] = []): number | null {
  const fs = fixedSize(t);
  if (fs !== null) return fs;
  switch (t.k) {
    case 'str':
      return 2 + t.max;
    case 'bytes':
      return t.lenWidth + t.max;
    case 'list': {
      const n = maxSize(t.of);
      return n === null ? null : t.countWidth + n * t.max;
    }
    case 'blob_or_bytes':
      return 1 + Math.max(2 + t.max, 32);
    case 'message':
      return t.d.maxSize;
    case 'counted': {
      const cf = siblings.find((f) => f.name === t.count);
      if (!cf) return null;
      const s = scalarOf(cf.ty) as IntScalar;
      const hi = cf.range ? cf.range[1] : Number(intRange(s)[1]);
      const n = maxSize(t.of);
      return n === null ? null : n * Math.max(0, hi - t.minus);
    }
    case 'rest':
      return null;
    case 'record':
      return null;
    default:
      return null;
  }
}

export function minSize(t: Ty): number {
  const fs = fixedSize(t);
  if (fs !== null) return fs;
  switch (t.k) {
    case 'str':
      return 2;
    case 'bytes':
      return t.lenWidth;
    case 'list':
      return t.countWidth;
    case 'blob_or_bytes':
      return 3;
    case 'message':
      return t.d.minSize;
    case 'record':
      return 4;
    default:
      return 0;
  }
}

/** True when the type (or anything inside it) holds a float. */
export function hasFloat(t: Ty): boolean {
  switch (t.k) {
    case 'scalar':
      return isFloat(t.s);
    case 'struct':
    case 'message':
    case 'record':
      return t.d.fields.some((f) => hasFloat(f.ty));
    case 'array':
    case 'list':
    case 'counted':
    case 'rest':
      return hasFloat(t.of);
    default:
      return false;
  }
}

/** True when the type has a variable-length encoding. */
export function isVar(t: Ty): boolean {
  return fixedSize(t) === null;
}

/** Fields that are part of the decoded value (not reserved, not a hidden count). */
export function valueFields(fields: readonly Field[]): Field[] {
  return fields.filter((f) => !f.reserved && !f.hidden);
}

/** A value's locale key (`<prefix>.<name with dashes>`), or null for a developer value (no text). */
export function localeKey(d: EnumDecl, v: EnumValue): string | null {
  if (d.locale === undefined || d.developer.includes(v.name)) return null;
  return `${d.locale}.${v.name.replace(/_/g, '-')}`;
}

/** Every declaration a type refers to, transitively. */
export function refs(t: Ty, out = new Set<string>()): Set<string> {
  switch (t.k) {
    case 'id':
    case 'enum':
    case 'flags':
      out.add(t.d.name);
      break;
    case 'struct':
    case 'message':
    case 'record':
      if (!out.has(t.d.name)) {
        out.add(t.d.name);
        for (const f of t.d.fields) refs(f.ty, out);
      }
      break;
    case 'array':
    case 'list':
    case 'counted':
    case 'rest':
      refs(t.of, out);
      break;
    default:
      break;
  }
  return out;
}

// ------------------------------------------------------------------------------------------- assembly

function synthEnum(
  name: string,
  base: IntScalar,
  values: EnumValue[],
  synthetic: string,
  doc: string,
): EnumDecl {
  return { kind: 'enum', name, base, values, developer: [], file: 'schema/', home: 'schema', synthetic, doc };
}

function limitsOf(src: Source, path: Path, v: unknown): Record<string, number> {
  const o = v === undefined ? {} : asObject(src, path, v);
  const out: Record<string, number> = {};
  for (const [k, x] of sortedEntries(o)) out[k] = intOf(src, [...path, k], x, k);
  return out;
}

function str(src: Source, path: Path, v: unknown): string {
  if (typeof v !== 'string') fail(src, path, 'expected a string');
  return v;
}

/** Parses, validates and resolves the schema files. Throws SchemaError on the first problem. */
export function buildSchema(sources: Map<SchemaFile, Source>): Schema {
  const raw = collect(sources);
  const ctx: Ctx = { raw, decls: new Map(), resolving: new Set() };
  const S = (f: SchemaFile) => raw.sources.get(f) as Source;
  const F = raw.file;

  // Synthesized enums first, so declarations can name them (SectionEntry.type: PacketSection …).
  const idList = (f: SchemaFile, key: string, base: IntScalar) =>
    singles(S(f), [key], F[f][key]).map(({ name, value, at }) => {
      const o = asObject(S(f), at, value);
      const id = intOf(S(f), [...at, 'id'], o.id, 'id');
      checkFits(S(f), [...at, 'id'], base, id);
      return { name, value: id, o, at };
    });
  const unique = (f: SchemaFile, key: string, xs: { name: string; value: number; at: Path }[]) => {
    const seen = new Map<number, string>();
    for (const x of xs) {
      const prev = seen.get(x.value);
      if (prev) fail(S(f), x.at, `id ${x.value} is also ${prev}: ids are never reused`);
      seen.set(x.value, x.name);
    }
    void key;
  };
  const actionsRaw = [...idList('actions', 'actions', 'u16'), ...idList('actions', 'system_actions', 'u16')];
  unique('actions', 'actions', actionsRaw);
  const eventsRaw = idList('events', 'events', 'u16');
  unique('events', 'events', eventsRaw);
  const packetRaw = idList('packet', 'sections', 'u16');
  unique('packet', 'sections', packetRaw);
  const kindsRaw = idList('projections', 'kinds', 'u16');
  unique('projections', 'kinds', kindsRaw);
  const queriesRaw = idList('projections', 'queries', 'u16');
  unique('projections', 'queries', queriesRaw);
  const saveRaw = idList('sections', 'sections', 'u32');
  const reservedSections = singles(S('sections'), ['reserved_sections'], F.sections.reserved_sections).map(
    ({ name, value, at }) => ({ name, value: intOf(S('sections'), at, value, 'id'), at }),
  );
  unique('sections', 'sections', [...saveRaw, ...reservedSections]);
  const protoSecRaw = idList('protos', 'sections', 'u32');
  unique('protos', 'sections', protoSecRaw);
  const metaRaw = singles(S('protos'), ['meta'], F.protos.meta).map(({ name, value, at }) => {
    const o = asObject(S('protos'), at, value);
    return { name, value: intOf(S('protos'), [...at, 'type'], o.type, 'type'), o, at };
  });
  unique('protos', 'meta', metaRaw);
  const synth: EnumDecl[] = [
    synthEnum(
      'ActionType',
      'u16',
      actionsRaw.map((a) => ({ name: a.name, value: a.value })),
      'actions',
      'Action type ids (actions.yaml)',
    ),
    synthEnum(
      'EventType',
      'u16',
      eventsRaw.map((a) => ({ name: a.name, value: a.value })),
      'events',
      'Event type ids (events.yaml)',
    ),
    synthEnum(
      'PacketSection',
      'u16',
      packetRaw.map((a) => ({ name: a.name.toLowerCase(), value: a.value })),
      'packet sections',
      'Packet section types (packet.yaml)',
    ),
    synthEnum(
      'ProjectionKind',
      'u16',
      kindsRaw.map((a) => ({ name: a.name.toLowerCase(), value: a.value })),
      'projection kinds',
      'Subscription kinds (projections.yaml)',
    ),
    synthEnum(
      'QueryKind',
      'u16',
      queriesRaw.map((a) => ({ name: a.name, value: a.value })),
      'queries',
      'Query kinds (projections.yaml)',
    ),
    synthEnum(
      'SaveSection',
      'u32',
      [...saveRaw, ...reservedSections]
        .map((a) => ({ name: a.name.toLowerCase(), value: a.value }))
        .sort((a, b) => a.value - b.value),
      'save sections',
      'Save section ids (sections.yaml), the reserved ones included',
    ),
    synthEnum(
      'ProtoSection',
      'u32',
      protoSecRaw.map((a) => ({ name: a.name.toLowerCase(), value: a.value })),
      'prototypes.bin sections',
      'prototypes.bin section ids (protos.yaml)',
    ),
    synthEnum(
      'MetaRecord',
      'u16',
      metaRaw.map((a) => ({ name: a.name, value: a.value })),
      'META records',
      'prototypes.bin META record types',
    ),
  ];
  for (const e of synth) {
    if (raw.decls.has(e.name)) throw new Error(`${e.name} is synthesized and may not be declared`);
    ctx.decls.set(e.name, e);
  }
  // Registries that declare their values are enums too.
  const registries: RegistryDef[] = [];
  for (const { name, value, at } of singles(S('registries'), ['registries'], F.registries.registries)) {
    const o = asObject(S('registries'), at, value);
    checkKeys(S('registries'), at, o, ['doc', 'base', 'values', 'enum', 'strings']);
    const def: RegistryDef = { name, ...(typeof o.doc === 'string' ? { doc: o.doc } : {}) };
    if (o.values !== undefined) {
      const ename = `${pascal(name).replace(/s$/, '')}`;
      const values = singles(S('registries'), [...at, 'values'], o.values).map(
        ({ name: vn, value: vv, at: vat }) => ({
          name: vn,
          value: intOf(S('registries'), vat, vv, 'a value'),
        }),
      );
      const e = synthEnum(ename, (o.base as IntScalar) ?? 'u16', values, `registry ${name}`, def.doc ?? '');
      if (new Set(values.map((v) => v.value)).size !== values.length)
        fail(S('registries'), at, 'a value is used twice');
      ctx.decls.set(e.name, e);
      def.enumDecl = e;
    } else if (o.strings !== undefined) {
      def.strings = (o.strings as unknown[]).map((x, i) => str(S('registries'), [...at, 'strings', i], x));
    }
    registries.push(def);
  }

  for (const name of raw.decls.keys()) resolveDecl(ctx, name);
  for (const def of registries) {
    const o = singles(S('registries'), ['registries'], F.registries.registries).find(
      (x) => x.name === def.name,
    );
    const en = (o?.value as Record<string, unknown> | undefined)?.enum;
    if (typeof en === 'string') {
      const d = ctx.decls.get(en);
      if (d?.kind !== 'enum') fail(S('registries'), o?.at ?? [], `${en} is not an enum`);
      def.enumDecl = d;
    }
  }

  // Actions: the payload of a held action starts with u16 input_gen (D22).
  const actionFile = S('actions');
  const actions: ActionDef[] = actionsRaw.map(({ name, value: id, o, at }) => {
    checkKeys(actionFile, at, o, ['id', 'held', 'system', 'doc', 'fields']);
    const system = at[0] === 'system_actions';
    const held = o.held === true;
    if (system && held) fail(actionFile, at, 'a system action is never held');
    if (system !== id >= 0xff00)
      fail(actionFile, [...at, 'id'], 'system actions, and only they, take ids from 0xFF00');
    const fieldsV = [
      ...(held
        ? [{ input_gen: { type: 'u16', doc: 'the input generation (D22), written by the sequencer' } }]
        : []),
      ...((o.fields as unknown[]) ?? []),
    ];
    const msg = messageDecl(
      ctx,
      actionFile,
      at,
      {
        name: `${pascal(name)}Action`,
        file: actionFile.file,
        home: 'schema',
        ...(typeof o.doc === 'string' ? { doc: o.doc } : {}),
      },
      fieldsV,
      undefined,
    );
    msg.fields.forEach((f, i) => {
      if (hasFloat(f.ty)) fail(actionFile, [...at, 'fields', i], 'no action carries a float (§15.3)');
      if (isVar(f.ty) && i !== msg.fields.length - 1)
        fail(
          actionFile,
          [...at, 'fields', i],
          'an action has at most one variable-length field, and it is last (§15.3)',
        );
      if (f.ty.k === 'counted' || f.ty.k === 'rest')
        fail(actionFile, [...at, 'fields', i], 'actions use list<T>, str, bytes or blob_or_bytes');
    });
    if (ctx.decls.has(msg.name) || raw.decls.has(msg.name))
      fail(actionFile, at, `${msg.name} is also declared`);
    ctx.decls.set(msg.name, msg);
    return { name, id, held, system, ...(typeof o.doc === 'string' ? { doc: o.doc } : {}), msg };
  });
  const actionLimits = limitsOf(actionFile, ['limits'], F.actions.limits);
  for (const a of actions) {
    const mx = a.msg.maxSize;
    if (mx === null || mx > (actionLimits.payload_max ?? 65531))
      fail(
        actionFile,
        [a.system ? 'system_actions' : 'actions'],
        `${a.name}'s largest payload is ${mx} bytes, above payload_max`,
      );
  }

  // Events.
  const eventFile = S('events');
  const events: EventDef[] = eventsRaw.map(({ name, value: id, o, at }) => {
    checkKeys(eventFile, at, o, ['id', 'doc', 'fields']);
    const msg = messageDecl(
      ctx,
      eventFile,
      at,
      {
        name: `${pascal(name)}Event`,
        file: eventFile.file,
        home: 'schema',
        ...(typeof o.doc === 'string' ? { doc: o.doc } : {}),
      },
      o.fields,
      undefined,
    );
    if (msg.fixed === null) fail(eventFile, at, 'event payloads are fixed-size');
    if (ctx.decls.has(msg.name) || raw.decls.has(msg.name))
      fail(eventFile, at, `${msg.name} is also declared`);
    ctx.decls.set(msg.name, msg);
    return { name, id, ...(typeof o.doc === 'string' ? { doc: o.doc } : {}), msg };
  });

  // Packet sections.
  const packetFile = S('packet');
  const packetSections: PacketSectionDef[] = packetRaw.map(({ name, value: id, o, at }) => {
    checkKeys(packetFile, at, o, ['id', 'kind', 'record', 'record_version']);
    const kind = o.kind as PacketSectionDef['kind'];
    if (!['snapshot', 'event', 'delta'].includes(kind))
      fail(packetFile, [...at, 'kind'], 'snapshot, event or delta');
    const record = str(packetFile, [...at, 'record'], o.record);
    if (record !== 'events' && record !== 'ui') {
      const d = ctx.decls.get(record);
      if (!d || (d.kind !== 'struct' && d.kind !== 'message'))
        fail(packetFile, [...at, 'record'], `${record} is not a struct or message`);
      checkAlign4(packetFile, [...at, 'record'], d);
    }
    return { name, id, kind, record, recordVersion: (o.record_version as number | undefined) ?? 1 };
  });

  // Projections and queries.
  const projFile = S('projections');
  const projLimits = limitsOf(projFile, ['limits'], F.projections.limits);
  const kinds: KindDef[] = kindsRaw.map(({ name, value: id, o, at }) => {
    checkKeys(projFile, at, o, ['id', 'cadence', 'target', 'params', 'sources', 'record']);
    const k: KindDef = {
      name,
      id,
      cadence: o.cadence as KindDef['cadence'],
      target: o.target as KindDef['target'],
    };
    if (!['every', 'slow'].includes(k.cadence)) fail(projFile, [...at, 'cadence'], 'every or slow');
    if (!['none', 'entity', 'player'].includes(k.target))
      fail(projFile, [...at, 'target'], 'none, entity or player');
    if (o.params !== undefined) k.params = o.params as Record<string, string>;
    if (o.sources !== undefined) k.sources = o.sources as string[];
    if (o.record !== undefined) {
      const d = ctx.decls.get(str(projFile, [...at, 'record'], o.record));
      if (d?.kind !== 'message') fail(projFile, [...at, 'record'], 'a projection record is a message');
      const mx = d.maxSize;
      if (mx === null || mx > (projLimits.record_max ?? 65536))
        fail(
          projFile,
          [...at, 'record'],
          `${d.name}'s largest record is ${mx} bytes, above record_max (§15.5)`,
        );
      k.record = d;
    }
    return k;
  });
  const queries: QueryDef[] = queriesRaw.map(({ name, value: id, o, at }) => {
    checkKeys(projFile, at, o, ['id', 'dev', 'params', 'result']);
    const q: QueryDef = { name, id, dev: o.dev === true };
    for (const key of ['params', 'result'] as const) {
      if (o[key] === undefined) continue;
      const d = ctx.decls.get(str(projFile, [...at, key], o[key]));
      if (!d || (d.kind !== 'struct' && d.kind !== 'message'))
        fail(projFile, [...at, key], 'a struct or message');
      q[key] = d;
    }
    return q;
  });

  // Save sections.
  const secFile = S('sections');
  const shardRule = (at: Path, v: unknown): ShardRule => {
    if (typeof v === 'string') {
      if (!['serial', 'chunk', 'player', 'key', 'timer', 'owner'].includes(v))
        fail(secFile, at, `unknown shard rule ${v}`);
      return { k: v } as ShardRule;
    }
    const o = asObject(secFile, at, v);
    const p = asObject(secFile, [...at, 'pieces'], o.pieces);
    return {
      k: 'pieces',
      base: intOf(secFile, [...at, 'pieces', 'base'], p.base, 'base'),
      step: intOf(secFile, [...at, 'pieces', 'step'], p.step, 'step'),
    };
  };
  const saveSections: SaveSectionDef[] = saveRaw.map(({ name, value: id, o, at }) => {
    checkKeys(secFile, at, o, [
      'id',
      'version',
      'encoding',
      'table',
      'record',
      'key',
      'hashed',
      'shard',
      'header_shard',
      'format',
      'doc',
    ]);
    const s: SaveSectionDef = {
      name,
      id,
      version: intOf(secFile, [...at, 'version'], o.version, 'version'),
      encoding: o.encoding as SaveSectionDef['encoding'],
      hashed: o.hashed === true,
    };
    if (typeof o.doc === 'string') s.doc = o.doc;
    if (o.table !== undefined) {
      const d = ctx.decls.get(str(secFile, [...at, 'table'], o.table));
      if (d?.kind !== 'table') fail(secFile, [...at, 'table'], 'not a table');
      if (d.section !== name) fail(secFile, [...at, 'table'], `${d.name}.section is ${d.section}`);
      s.table = d;
    }
    if (o.record !== undefined) {
      const d = ctx.decls.get(str(secFile, [...at, 'record'], o.record));
      if (d?.kind !== 'record') fail(secFile, [...at, 'record'], 'not a record');
      s.record = d;
    }
    if (s.encoding === 'table' && !s.table) fail(secFile, at, 'a table section names its table');
    if ((s.encoding === 'record' || s.encoding === 'records') && !s.record)
      fail(secFile, at, 'a record section names its record');
    if (s.encoding === 'records') {
      const key = o.key as string[] | undefined;
      if (!key || key.length === 0)
        fail(secFile, [...at, 'key'], 'a records section names its sort key (§8.1)');
      for (const k of key)
        if (!s.record?.fields.some((f) => f.name === k))
          fail(secFile, [...at, 'key'], `${k} is not a field of ${s.record?.name}`);
      s.key = key;
    }
    if (o.shard !== undefined) s.shard = shardRule([...at, 'shard'], o.shard);
    if (s.hashed && !s.shard) fail(secFile, at, 'a hashed section needs a shard rule (§4.8)');
    if (o.header_shard !== undefined)
      s.headerShard = intOf(secFile, [...at, 'header_shard'], o.header_shard, 'header_shard');
    if (s.encoding === 'table' && s.hashed && s.headerShard === undefined)
      fail(secFile, at, 'a table section needs header_shard (§4.8)');
    if (o.format !== undefined) s.format = str(secFile, [...at, 'format'], o.format);
    return s;
  });
  for (const t of [...ctx.decls.values()].filter((d): d is TableDecl => d.kind === 'table'))
    if (!saveSections.some((s) => s.table === t)) throw new Error(`table ${t.name} has no save section`);
  const cont = asObject(secFile, ['container'], F.sections.container);
  const clog = asObject(secFile, ['closure_log'], F.sections.closure_log);
  const header = sortedEntries(asObject(secFile, ['save_header'], F.sections.save_header)).map(
    ([k, v]) => [k, v as { json: string; doc?: string }] as [string, { json: string; doc?: string }],
  );

  // ABI.
  const abiFile = S('abi');
  const exportsOf = (key: 'sim_exports' | 'gen_exports', module: 'sim' | 'gen'): ExportDef[] =>
    singles(abiFile, [key], F.abi[key]).map(({ name, value, at }) => {
      const o = asObject(abiFile, at, value);
      checkKeys(abiFile, at, o, ['kind', 'params', 'returns', 'in', 'out', 'doc']);
      const e: ExportDef = { name, module, kind: o.kind as ExportDef['kind'], params: [] };
      if (!['plain', 'input', 'status', 'envelope', 'error'].includes(e.kind))
        fail(abiFile, [...at, 'kind'], 'unknown kind');
      e.params = singles(abiFile, [...at, 'params'], o.params).map(({ name: pn, value: pv, at: pat }) => ({
        name: pn,
        ty: parseType(ctx, abiFile, pat, str(abiFile, pat, pv), { type: pv as string }, 'message'),
      }));
      if (o.returns !== undefined) e.returns = o.returns as Scalar;
      if (o.in !== undefined) e.input = str(abiFile, [...at, 'in'], o.in);
      if (o.out !== undefined) e.output = str(abiFile, [...at, 'out'], o.out);
      if (typeof o.doc === 'string') e.doc = o.doc;
      for (const x of [e.input, e.output])
        if (x !== undefined && !['closure', 'packet'].includes(x) && !ctx.decls.has(x))
          fail(abiFile, at, `unknown record ${x}`);
      return e;
    });
  const imports: ImportDef[] = singles(abiFile, ['imports'], F.abi.imports).map(({ name, value, at }) => {
    const o = asObject(abiFile, at, value);
    const im: ImportDef = {
      name,
      params: singles(abiFile, [...at, 'params'], o.params).map(({ name: pn, value: pv, at: pat }) => ({
        name: pn,
        ty: parseType(ctx, abiFile, pat, str(abiFile, pat, pv), { type: pv as string }, 'message'),
      })),
    };
    if (o.returns !== undefined) im.returns = o.returns as Scalar;
    if (typeof o.doc === 'string') im.doc = o.doc;
    return im;
  });

  // Prototypes.
  const protoFile = S('protos');
  const protoTables: ProtoTableDef[] = singles(protoFile, ['kind_tables'], F.protos.kind_tables).map(
    ({ name, value, at }) => {
      const o = asObject(protoFile, at, value);
      checkKeys(protoFile, at, o, ['section', 'columns']);
      const section = str(protoFile, [...at, 'section'], o.section);
      const sec = protoSecRaw.find((x) => x.name === section);
      if (!sec) fail(protoFile, [...at, 'section'], `unknown section ${section}`);
      const columns = rawFields(protoFile, [...at, 'columns'], o.columns).map((rf): ProtoColumn => {
        // A list column is (u32 offset, u16 count): at most 65,535 entries.
        const ty = parseType(ctx, protoFile, rf.at, rf.attrs.type, { max: 65535, ...rf.attrs }, 'message');
        const okList = ty.k === 'list' && fixedSize(ty.of) !== null;
        if (scalarOf(ty) === null && !okList)
          fail(protoFile, rf.at, 'a column is a scalar, id, enum, flags, or list<fixed entry>');
        if (rf.attrs.from === undefined) fail(protoFile, rf.at, 'every column names its source (`from`)');
        const c: ProtoColumn = {
          name: rf.name,
          ty,
          optional: rf.attrs.optional === true,
          from: rf.attrs.from,
        };
        if (rf.attrs.path) c.path = rf.attrs.path;
        if (rf.attrs.ref_kind) c.refKind = rf.attrs.ref_kind;
        if (rf.attrs.formula) c.formula = rf.attrs.formula;
        if (c.optional && ty.k !== 'enum' && ty.k !== 'id')
          fail(protoFile, rf.at, '`optional` is for enum and id columns');
        if (c.optional && ty.k === 'id' && ty.d.none === undefined)
          fail(protoFile, rf.at, `${ty.d.name} has no none value`);
        return c;
      });
      return {
        name,
        section,
        sectionId: sec.value,
        kind: (sec.o.kind as string | undefined) ?? name,
        columns,
      };
    },
  );
  const meta = metaRaw.map(({ name, value: type, o, at }) => {
    const r = ctx.decls.get(str(protoFile, [...at, 'record'], o.record));
    if (r?.kind !== 'record') fail(protoFile, [...at, 'record'], 'not a record');
    return { name, type, record: r, ...(typeof o.block === 'string' ? { block: o.block } : {}) };
  });
  const exprO = asObject(protoFile, ['expr'], F.protos.expr);
  const expr = {
    maxStack: intOf(protoFile, ['expr', 'max_stack'], exprO.max_stack, 'max_stack'),
    powiLimit: intOf(protoFile, ['expr', 'powi_limit'], exprO.powi_limit, 'powi_limit'),
    ops: singles(protoFile, ['expr', 'ops'], exprO.ops).map(({ name, value, at }) => {
      const o = asObject(protoFile, at, value);
      return {
        name,
        code: intOf(protoFile, [...at, 'code'], o.code, 'code'),
        ...(o.operand ? { operand: o.operand as Scalar } : {}),
      };
    }),
  };
  const formulas = singles(protoFile, ['formulas'], F.protos.formulas).map(({ name, value, at }) => {
    const o = asObject(protoFile, at, value);
    return {
      name,
      vars: o.vars as string[],
      range: o.range as [number, number],
      ...(typeof o.doc === 'string' ? { doc: o.doc } : {}),
    };
  });
  const jsonO = asObject(protoFile, ['json'], F.protos.json);
  const jsonTypes = sortedEntries(asObject(protoFile, ['json', 'types'], jsonO.types)).map(
    ([k, v]) => [k, jsonType(protoFile, ['json', 'types', k], v)] as [string, JsonType],
  );
  const jsonRoot = jsonType(protoFile, ['json', 'root'], jsonO.root);
  const known = new Set(jsonTypes.map(([k]) => k));
  const checkJson = (t: JsonType, path: Path): void => {
    if (t.k === 'named' && !known.has(t.name as string)) fail(protoFile, path, `unknown JSON type ${t.name}`);
    if (t.of) checkJson(t.of, path);
    for (const [, f] of t.fields ?? []) checkJson(f, path);
  };
  checkJson(jsonRoot, ['json', 'root']);
  for (const [k, t] of jsonTypes) checkJson(t, ['json', 'types', k]);

  const wellKnown = singles(S('registries'), ['well_known'], F.registries.well_known).map(
    ({ name, value, at }) => {
      const o = asObject(S('registries'), at, value);
      return {
        name,
        kind: str(S('registries'), [...at, 'kind'], o.kind),
        ...(typeof o.doc === 'string' ? { doc: o.doc } : {}),
      };
    },
  );

  const decls = ctx.decls;
  const typeNames = new Map<string, string>();
  for (const d of decls.values()) {
    const tn = typeName(d);
    const prev = typeNames.get(tn);
    if (prev) throw new Error(`${d.name} and ${prev} both become the type ${tn}: rename one`);
    typeNames.set(tn, d.name);
  }
  // Rust homes: a schema-crate declaration may not refer to a sim-only (state.yaml) one.
  for (const d of decls.values()) {
    if (d.home !== 'schema' || !('fields' in d)) continue;
    for (const f of d.fields)
      for (const r of refs(f.ty))
        if (decls.get(r)?.home === 'sim')
          throw new Error(
            `${d.name} (crate schema) refers to ${r}, which state.yaml declares (crate sim): move ${r} out of state.yaml`,
          );
  }
  checkState(sources.get('state') as Source, decls);

  const versions = {
    schema: intOf(S('types'), ['schema_version'], F.types.schema_version, 'schema_version'),
    action: intOf(actionFile, ['version'], F.actions.version, 'version'),
    packet: intOf(packetFile, ['version'], F.packet.version, 'version'),
    abi: intOf(abiFile, ['abi_version'], F.abi.abi_version, 'abi_version'),
    genAbi: intOf(abiFile, ['gen_abi_version'], F.abi.gen_abi_version, 'gen_abi_version'),
    protocol: intOf(abiFile, ['protocol_version'], F.abi.protocol_version, 'protocol_version'),
  };
  checkFits(S('types'), ['schema_version'], 'u16', versions.schema);
  checkFits(actionFile, ['version'], 'u8', versions.action);
  checkFits(packetFile, ['version'], 'u16', versions.packet);
  return {
    versions,
    decls,
    names: [...decls.keys()].sort(compareCodeUnits),
    actions,
    actionLimits,
    events,
    eventLimits: limitsOf(eventFile, ['limits'], F.events.limits),
    packet: {
      magic: intOf(packetFile, ['magic'], F.packet.magic, 'magic'),
      limits: limitsOf(packetFile, ['limits'], F.packet.limits),
      sections: packetSections,
    },
    projections: { limits: projLimits, kinds, queries },
    save: {
      magic: str(secFile, ['container', 'magic'], cont.magic),
      formatVersion: intOf(secFile, ['container', 'format_version'], cont.format_version, 'format_version'),
      headerAlign: intOf(secFile, ['container', 'header_align'], cont.header_align, 'header_align'),
      shards: intOf(secFile, ['shards'], F.sections.shards, 'shards'),
      sections: saveSections,
      reserved: reservedSections.map((r) => ({ name: r.name, id: r.value })),
      closureLog: {
        magic: intOf(secFile, ['closure_log', 'magic'], clog.magic, 'magic'),
        formatVersion: intOf(
          secFile,
          ['closure_log', 'format_version'],
          clog.format_version,
          'format_version',
        ),
      },
      header,
    },
    abi: { exports: [...exportsOf('sim_exports', 'sim'), ...exportsOf('gen_exports', 'gen')], imports },
    protos: {
      magic: str(protoFile, ['magic'], F.protos.magic),
      formatVersion: intOf(protoFile, ['format_version'], F.protos.format_version, 'format_version'),
      dataVersion: intOf(protoFile, ['data_version'], F.protos.data_version, 'data_version'),
      sectionVersion: intOf(protoFile, ['section_version'], F.protos.section_version, 'section_version'),
      sections: protoSecRaw.map((x) => ({
        name: x.name,
        id: x.value,
        ...(typeof x.o.kind === 'string' ? { kind: x.o.kind } : {}),
      })),
      tables: protoTables,
      meta,
      expr,
      formulas,
      json: {
        formatVersion: intOf(protoFile, ['json', 'format_version'], jsonO.format_version, 'format_version'),
        types: jsonTypes,
        root: jsonRoot,
      },
    },
    registries,
    wellKnown,
  };
}

/** Packet records and projection list items are multiples of 4 bytes (§15.1 "Layout rules"). */
function checkAlign4(src: Source, at: Path, d: Decl): void {
  if (d.kind === 'struct') {
    if (d.size % 4 !== 0)
      fail(
        src,
        at,
        `${d.name} is ${d.size} bytes: packet records are multiples of 4; add ${4 - (d.size % 4)} reserved byte(s)`,
      );
    return;
  }
  if (d.kind !== 'message' || d.padTo) return;
  if (d.fixed !== null) {
    if (d.fixed % 4 !== 0) fail(src, at, `${d.name} is ${d.fixed} bytes: packet records are multiples of 4`);
    return;
  }
  if (d.prefix % 4 !== 0) fail(src, at, `${d.name}'s fixed part is ${d.prefix} bytes, not a multiple of 4`);
  for (const f of d.fields) {
    if (f.offset !== undefined) continue;
    const item = f.ty.k === 'counted' ? fixedSize(f.ty.of) : fixedSize(f.ty);
    if (item === null || item % 4 !== 0)
      fail(
        src,
        at,
        `${d.name}.${f.name} can leave the record at other than a multiple of 4 bytes: add pad_to: 4`,
      );
  }
}

function jsonType(src: Source, at: Path, v: unknown): JsonType {
  if (typeof v === 'string') {
    let t = v.trim();
    if (t.endsWith('?')) return { k: 'nullable', of: jsonType(src, at, t.slice(0, -1)) };
    if (t.endsWith('[]')) return { k: 'array', of: jsonType(src, at, t.slice(0, -2)) };
    const m = /^\{(.+)\}$/.exec(t);
    if (m) return { k: 'map', of: jsonType(src, at, m[1] as string) };
    t = t.trim();
    if (['string', 'number', 'integer', 'boolean', 'hex32'].includes(t)) return { k: t as JsonType['k'] };
    if (!/^[A-Z][A-Za-z0-9]*$/.test(t)) fail(src, at, `bad JSON type ${t}`);
    return { k: 'named', name: t };
  }
  const o = asObject(src, at, v);
  return {
    k: 'object',
    fields: sortedEntries(o).map(([k, x]) => [k, jsonType(src, [...at, k], x)] as [string, JsonType]),
  };
}

/** state.yaml's attribute rules (§15.1 "Field attributes", D20). */
function checkState(src: Source, decls: Map<string, Decl>): void {
  for (const d of decls.values()) {
    if (d.home !== 'sim' || (d.kind !== 'record' && d.kind !== 'table')) continue;
    const where = d.kind === 'record' ? 'records' : 'tables';
    d.fields.forEach((f) => {
      const at: Path = [where];
      const p = `${d.name}.${f.name}`;
      if (f.saved === undefined) fail(src, at, `${p}: every state field states \`saved\` (D20)`);
      if (!f.saved && !f.derived && !f.presentation)
        fail(
          src,
          at,
          `${p}: an unsaved field states \`derived: <rebuild fn>\` or \`presentation: true\` (§15.1)`,
        );
      if (f.saved && (f.derived || f.presentation))
        fail(src, at, `${p}: a saved field is neither derived nor presentation`);
      const listy = f.ty.k === 'list';
      if (listy && f.order === undefined) fail(src, at, `${p}: a list field states its \`order\` (D3, D20)`);
      if (f.order === 'none' && f.saved) fail(src, at, `${p}: \`order: none\` only on unsaved fields (§8.1)`);
    });
  }
}
