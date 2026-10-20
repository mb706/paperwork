// prototypes.bin and prototypes.json on the TypeScript side (10 §15.2): the data stage's writer (typed rows
// in, bytes out), a reader that checks everything Rust's `Protos::load` checks, and prototypes.json's types
// and validator.
import { canonicalJson } from '../lib/canonical.ts';
import {
  type ProtoColumn,
  type ProtoTableDef,
  pascal,
  type Schema,
  type StructDecl,
  scalarOf,
  upperSnake,
} from './model.ts';
import { isU8 } from './rust.ts';
import { protoColumns } from './rust-protos.ts';
import { type TsOut, tsStr, tsType } from './ts.ts';
import { jsonHelpers, jsonValidator } from './ts-json.ts';

const ID_KIND: Record<string, string> = {
  ItemId: 'item',
  FluidId: 'fluid',
  RecipeId: 'recipe',
  EntityId: 'entity',
  TechId: 'technology',
  ResourceId: 'resource',
  TileId: 'tile',
  WorldObjectId: 'world_object',
  SignalId: 'signal',
};

export function tsProtos(s: Schema, o: TsOut): void {
  o.rt('Reader', 'Writer', 'DecodeError', 'EncodeError', 'sameBytes', 'utf8');
  const p = s.protos;
  const frame = s.decls.get('SectionFrame') as never;
  const header = s.decls.get('ProtosHeader') as never;
  const kinds = (s.decls.get('ProtoKind') as unknown as { values: { name: string; value: number }[] }).values;
  const secIndex = (name: string) => p.sections.findIndex((x) => x.name === name);
  const entryStructs = new Map<string, StructDecl>();
  for (const t of p.tables)
    for (const c of t.columns)
      if (c.ty.k === 'list' && c.ty.of.k === 'struct') entryStructs.set(c.ty.of.d.name, c.ty.of.d);
  const rowType = (t: ProtoTableDef) => `${pascal(t.kind)}Row`;
  const colTs = (c: ProtoColumn) => {
    if (c.ty.k === 'list') return `${tsType(o, c.ty.of)}[]`;
    if (c.optional && c.ty.k === 'enum') return 'number | null';
    return tsType(o, c.ty);
  };
  const parts: string[] = [];
  parts.push(`/** prototypes.bin's magic, versions and layout (§15.2). */
export const PROTOS_MAGIC = ${tsStr(p.magic)};
export const PROTOS_FORMAT_VERSION = ${p.formatVersion};
export const PROTOS_DATA_VERSION = ${p.dataVersion};
export const PROTOS_SECTION_VERSION = ${p.sectionVersion};
export const PROTOS_HEADER_SIZE = 56;
/** Section ids, in file order. */
export const PROTOS_SECTIONS = { ${p.sections.map((x) => `${x.name}: ${x.id}`).join(', ')} } as const;
const SECTION_ORDER = [${p.sections.map((x) => x.id).join(', ')}] as const;

/** The expression bytecode (§15.2). */
export const EXPR_MAX_STACK = ${p.expr.maxStack};
export const EXPR_POWI_LIMIT = ${p.expr.powiLimit};
export const EXPR_NONE = 0xffffffff;
export const OP = { ${p.expr.ops.map((x) => `${x.name}: 0x${x.code.toString(16).padStart(2, '0')}`).join(', ')} } as const;

/** A formula field (§2.4 step 2): its variables in bytecode order and its declared result range. */
export interface FormulaField {
  name: string;
  vars: readonly string[];
  range: { lo: number; hi: number };
}
export const FORMULAS = {
${p.formulas.map((f) => `  ${f.name}: { name: ${tsStr(f.name)}, vars: [${f.vars.map(tsStr).join(', ')}], range: { lo: ${f.range[0]}, hi: ${f.range[1]} } },`).join('\n')}
} as const satisfies Record<string, FormulaField>;

/**
 * Checks the EXPR section (§15.2), exactly as Rust's \`expr_programs\` does, and returns the offset of every
 * program. Throws DecodeError (kind bad_enum, the reason as its field) on a malformed program.
 */
export function exprPrograms(bytes: Uint8Array): number[] {
  const starts: number[] = [];
  const bad = (at: number, why: string): never => {
    throw new DecodeError('bad_enum', why, at);
  };
  let at = 0;
  while (at < bytes.length) {
    if (bytes.length - at < 4) bad(at, 'truncated expression header');
    const n = (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
    const vars = bytes[at + 2] as number;
    const max = bytes[at + 3] as number;
    if (max > EXPR_MAX_STACK) bad(at, 'max_stack above the limit');
    const end = at + 4 + n;
    if (end > bytes.length) bad(at, 'op stream runs past EXPR');
    let pc = at + 4;
    let depth = 0;
    let ended = false;
    while (pc < end) {
      const op = bytes[pc] as number;
      pc++;
      if (op === OP.CONST) {
        if (end - pc < 8) bad(pc, 'truncated CONST');
        if (!Number.isFinite(new DataView(bytes.buffer, bytes.byteOffset + pc, 8).getFloat64(0, true)))
          bad(pc, 'CONST not finite');
        pc += 8;
        depth++;
      } else if (op === OP.VAR) {
        if (pc >= end) bad(pc, 'truncated VAR');
        if ((bytes[pc] as number) >= vars) bad(pc, 'VAR index not below var_count');
        pc++;
        depth++;
      } else if (op === OP.ADD || op === OP.SUB || op === OP.MUL || op === OP.DIV || op === OP.POWI) {
        if (depth < 2) bad(pc - 1, 'stack underflow');
        depth--;
      } else if (op === OP.NEG) {
        if (depth < 1) bad(pc - 1, 'stack underflow');
      } else if (op === OP.END) {
        if (pc !== end || depth !== 1) bad(pc - 1, 'END is not last with one value');
        ended = true;
      } else bad(pc - 1, 'unknown opcode');
      if (depth > max) bad(pc - 1, 'stack passes max_stack');
    }
    if (!ended) bad(at, 'program without END');
    starts.push(at);
    at = end;
  }
  return starts;
}

/** A column of a kind table (§8.1 directory entry) and the source of its values. */
export interface ProtoColumnInfo {
  name: string;
  code: number;
  width: number;
  from: string;
  path?: readonly (string | number)[];
}

/** A value the writer cannot write, with the table, row and column it belongs to (data-stage diagnostics). */
export class ProtosWriteError extends Error {
  readonly table: string;
  readonly row: number;
  readonly column: string;
  constructor(table: string, row: number, column: string, message: string) {
    super(\`\${table}[\${row}].\${column}: \${message}\`);
    this.table = table;
    this.row = row;
    this.column = column;
  }
}
`);
  // Row types and column lists.
  for (const t of p.tables) {
    const exp = protoColumns(t);
    const rowDecl = t.columns.length
      ? `export interface ${rowType(t)} {\n${t.columns.map((c) => `  /** ${c.from}${c.optional ? ' (null or the none value when absent)' : ''} */\n  ${c.name}: ${colTs(c)};`).join('\n')}\n}`
      : `export type ${rowType(t)} = Record<never, never>;`;
    parts.push(`/** A row of ${t.section} (§15.2): one per ${t.kind.replace('_', ' ')} id. */
${rowDecl}
/**
 * ${t.section}'s columns in file order: name, §8.1 type code, width (a list column is _off and _count), and
 * where the value comes from: \`from\` describes it, \`path\` is its field in the prototype's YAML, if any.
 */
export const ${upperSnake(t.kind)}_COLUMNS: readonly ProtoColumnInfo[] = [
${exp.map((x) => `  { name: ${tsStr(x.name)}, code: ${x.code}, width: ${x.width}, from: ${tsStr(x.col.from)}${x.col.path ? `, path: ${canonicalJson(x.col.path, 0)}` : ''} },`).join('\n')}
];
`);
  }
  const metaParts = p.meta.map((m) => `${m.name}: ${o.t(m.record)}`).join('; ');
  parts.push(`/** Everything prototypes.bin holds, as the data stage computes it. */
export interface ProtosInput {
  schemaHash: Uint8Array;
${p.tables.map((t) => `  ${t.kind}: readonly ${rowType(t)}[];`).join('\n')}
  meta: { ${metaParts} };
  /** The EXPR section: packed programs; ExprRef values in the rows are offsets into it. */
  expr: Uint8Array;
  names: { ${kinds.map((k) => `${k.name}: readonly string[]`).join('; ')} };
}

/** Writes one column table (§8.1): rows, the directory, each column at the next multiple of 8. */
function columnTable(cols: readonly { name: string; code: number; width: number }[], rows: number, write: (w: Writer, col: number) => void): Uint8Array {
  const w = new Writer();
  w.u32(rows, 'rows');
  w.u16(cols.length, 'fields');
  w.u16(0, 'reserved');
  let dir = 8;
  for (const c of cols) dir += 1 + new TextEncoder().encode(c.name).length + 1 + 1 + 4 + 4;
  let at = dir;
  for (const c of cols) {
    at = Math.ceil(at / 8) * 8;
    const name = new TextEncoder().encode(c.name);
    w.u8(name.length, 'name');
    w.bytes(name);
    w.u8(c.code, 'type');
    w.u8(0, 'reserved');
    w.u32(at, 'offset');
    w.u32(rows * c.width, 'length');
    at += rows * c.width;
  }
  cols.forEach((_, i) => {
    w.pad(0, 8);
    write(w, i);
  });
  return w.finish();
}

/**
 * Writes prototypes.bin from the data stage's rows (§15.2). Lists are pooled into LISTS, each starting at a
 * multiple of 8 (an empty list is (0, 0)); floats must be finite; every value must fit its column. Throws
 * ProtosWriteError naming the table, row and column of a value it cannot write.
 */
export function writePrototypesBin(input: ProtosInput): Uint8Array {
  if (input.schemaHash.length !== 32) throw new Error('the schema hash is 32 bytes');
  const lists = new Writer();
  const sections = new Map<number, Uint8Array>();
  const guard = (table: string, row: number, column: string, f: () => void) => {
    try {
      f();
    } catch (e) {
      if (e instanceof EncodeError) throw new ProtosWriteError(table, row, column, e.message);
      throw e;
    }
  };
  const finite = (table: string, row: number, column: string, v: number) => {
    if (!Number.isFinite(v)) throw new ProtosWriteError(table, row, column, \`\${v} is not a finite number\`);
  };
${p.tables
  .map((t) => {
    const exp = protoColumns(t);
    const cases = exp
      .map((x, i) => {
        const c = x.col;
        const path = tsStr(`${t.kind}.${x.name}`);
        let body: string;
        if (x.part === 'off')
          body = `for (const [r] of rows.entries()) w.u32(${c.name}[r]?.off ?? 0, ${path});`;
        else if (x.part === 'count')
          body = `for (const [r] of rows.entries()) w.u16(${c.name}[r]?.count ?? 0, ${path});`;
        else {
          const sc = scalarOf(c.ty);
          const optEnum = c.optional && c.ty.k === 'enum';
          const none = sc === 'u8' ? '0xff' : '0xffff';
          const write = optEnum
            ? `{ const v = row.${c.name}; if (v === null) w.${sc}(${none}, ${path}); else ${o.c(c.ty.k === 'enum' ? c.ty.d : (undefined as never))}.write(w, v, ${path}); }`
            : c.ty.k === 'scalar'
              ? `w.${c.ty.s}(row.${c.name} as never, ${path});`
              : `${o.c((c.ty as unknown as { d: never }).d)}.write(w, row.${c.name} as never, ${path});`;
          const fin =
            sc === 'f64' || sc === 'f32'
              ? `finite(${tsStr(t.kind)}, r, ${tsStr(c.name)}, row.${c.name} as number); `
              : '';
          body = `for (const [r, row] of rows.entries()) guard(${tsStr(t.kind)}, r, ${tsStr(c.name)}, () => { ${fin}${write} });`;
        }
        return `      case ${i}: { ${body} break; }`;
      })
      .join('\n');
    const listCols = t.columns.filter((c) => c.ty.k === 'list');
    const pool = listCols
      .map((c) => {
        const of = (c.ty as unknown as { of: never }).of as { k: string; d?: { name: string } };
        const write =
          of.k === 'struct'
            ? `${o.c(of.d as never)}.write(lists, x)`
            : `${of.k === 'scalar' ? `lists.${(of as unknown as { s: string }).s}(x as never, ${tsStr(`${t.kind}.${c.name}`)})` : `${o.c(of.d as never)}.write(lists, x as never, ${tsStr(`${t.kind}.${c.name}`)})`}`;
        return `  const ${c.name} = rows.map((row, r) => { const xs = row.${c.name}; if (xs.length === 0) return { off: 0, count: 0 }; if (xs.length > 0xffff) throw new ProtosWriteError(${tsStr(t.kind)}, r, ${tsStr(c.name)}, 'more than 65,535 entries'); lists.pad(0, 8); const off = lists.pos; guard(${tsStr(t.kind)}, r, ${tsStr(c.name)}, () => { for (const x of xs) ${write}; }); return { off, count: xs.length }; });`;
      })
      .join('\n');
    return `  {
    const rows = input.${t.kind};
${pool}
    sections.set(${t.sectionId}, columnTable(${upperSnake(t.kind)}_COLUMNS, rows.length, ${
      exp.length
        ? `(w, col) => {
      switch (col) {
${cases}
      }
    }`
        : '() => {}'
    }));
  }`;
  })
  .join('\n')}
  lists.pad(0, 8);
  sections.set(PROTOS_SECTIONS.LISTS, lists.finish());
  const meta = new Writer();
  meta.u32(${p.meta.length}, 'META');
${p.meta.map((m) => `  meta.u16(${m.type}, 'META');\n  ${o.c(m.record)}.write(meta, input.meta.${m.name});`).join('\n')}
  sections.set(PROTOS_SECTIONS.META, meta.finish());
  exprPrograms(input.expr);
  sections.set(PROTOS_SECTIONS.EXPR, input.expr);
  const names = new Writer();
${kinds.map((k) => `  names.u16(input.names.${k.name}.length, 'NAMES');\n  for (const n of input.names.${k.name}) names.str16(n, 255, 'NAMES');`).join('\n')}
  sections.set(PROTOS_SECTIONS.NAMES, names.finish());
  const w = new Writer(1 << 16);
  w.bytes(new TextEncoder().encode(PROTOS_MAGIC));
  w.u32(PROTOS_FORMAT_VERSION, 'ProtosHeader.format_version');
  w.bytes(input.schemaHash);
  w.u32(PROTOS_DATA_VERSION, 'ProtosHeader.data_version');
  w.u32(SECTION_ORDER.length, 'ProtosHeader.section_count');
  w.u32(0, 'ProtosHeader.reserved');
  for (const id of SECTION_ORDER) {
    const data = sections.get(id) ?? new Uint8Array(0);
    ${o.c(frame)}.write(w, { id, version: PROTOS_SECTION_VERSION, codec: 0, flags: 0, raw_length: data.length, data });
  }
  return w.finish();
}

/** prototypes.bin, read back (tests and tools): every table's rows, the name tables, META and EXPR. */
export interface ProtosRead {
${p.tables.map((t) => `  ${t.kind}: ${rowType(t)}[];`).join('\n')}
  meta: { ${metaParts} };
  expr: Uint8Array;
  names: { ${kinds.map((k) => `${k.name}: string[]`).join('; ')} };
}

/**
 * Reads prototypes.bin and refuses what Rust's \`Protos::load\` refuses, with the same checks in the same
 * order: the schema hash when \`schemaHash\` is given, and a contents record that lacks a block of
 * \`required\` (the current capability manifest's REQUIRED_DATA unless given).
 */
export function readPrototypesBin(
  bytes: Uint8Array,
  schemaHash?: Uint8Array,
  required: readonly string[] = ${o.imp('capabilities', 'REQUIRED_DATA')},
): ProtosRead {
  const r = new Reader(bytes);
  const h = ${o.c(header)}.read(r, 'ProtosHeader');
  if (!sameBytes(h.magic, utf8(PROTOS_MAGIC))) throw new DecodeError('bad_magic', 'ProtosHeader.magic', 0);
  if (h.format_version !== PROTOS_FORMAT_VERSION) throw new DecodeError('bad_version', 'ProtosHeader.format_version', 8);
  if (schemaHash && !h.schema_hash.bytes.every((b, i) => b === schemaHash[i])) throw new DecodeError('schema_mismatch', 'ProtosHeader.schema_hash', 12);
  if (h.data_version !== PROTOS_DATA_VERSION) throw new DecodeError('bad_version', 'ProtosHeader.data_version', 44);
  if (h.section_count !== SECTION_ORDER.length) throw new DecodeError('bad_count', 'ProtosHeader.section_count', 48);
  const data: Uint8Array[] = [];
  const bases: number[] = [];
  for (const want of SECTION_ORDER) {
    const at = r.pos;
    const f = ${o.c(frame)}.read(r);
    if (f.id !== want) throw new DecodeError('unknown_type', 'SectionFrame.id', at);
    if (f.version !== PROTOS_SECTION_VERSION) throw new DecodeError('bad_version', 'SectionFrame.version', at + 4);
    if (f.codec !== 0 || f.flags !== 0 || f.raw_length !== f.data.length) throw new DecodeError('not_canonical', 'SectionFrame.codec', at + 6);
    data.push(f.data);
    bases.push(at + 16);
  }
  r.finish('prototypes.bin');
  const expr = data[${secIndex('EXPR')}] as Uint8Array;
  let starts: number[];
  try {
    starts = exprPrograms(expr);
  } catch (e) {
    if (e instanceof DecodeError) throw new DecodeError(e.kind, e.field, e.at + (bases[${secIndex('EXPR')}] as number));
    throw e;
  }
  const rows: number[] = [];
${p.tables.map((t) => `  rows[${kinds.find((k) => k.name === t.kind)?.value}] = new Reader(data[${secIndex(t.section)}] as Uint8Array).u32('rows');`).join('\n')}
  const lists = data[${secIndex('LISTS')}] as Uint8Array;
  const listsBase = bases[${secIndex('LISTS')}] as number;
  const exprOk = (e: number, vars: number): boolean => e === EXPR_NONE || (starts.includes(e) && (expr[e + 2] as number) <= vars);
  const KIND_INDEX: Readonly<Record<string, number>> = { ${kinds.map((k) => `${k.name}: ${k.value}`).join(', ')} };
  const rowsOf = (k: string): number => rows[KIND_INDEX[k] as number] ?? 0;
  const list = (off: number, count: number, size: number, field: string, at: number): Reader => {
    if (count === 0) {
      if (off !== 0) throw new DecodeError('not_canonical', field, at);
      return new Reader(new Uint8Array(0), listsBase);
    }
    if (off % 8 !== 0 || off + count * size > lists.length) throw new DecodeError('bad_length', field, at);
    return new Reader(lists.subarray(off, off + count * size), listsBase + off);
  };
  const columns = (tdata: Uint8Array, base: number, table: string, cols: readonly { name: string; code: number; width: number }[]): { rows: number; cols: Reader[] } => {
    const rd = new Reader(tdata, base);
    const n = rd.u32(table);
    const k = rd.u16(table);
    rd.zeros(2, table);
    if (k !== cols.length) throw rd.err('schema_mismatch', table);
    let dir = 8;
    for (const c of cols) dir += 1 + new TextEncoder().encode(c.name).length + 1 + 1 + 4 + 4;
    let at = dir;
    const out: Reader[] = [];
    for (const c of cols) {
      const len = rd.u8(c.name);
      if (!sameBytes(rd.take(len, c.name), utf8(c.name))) throw rd.err('schema_mismatch', c.name);
      if (rd.u8(c.name) !== c.code) throw rd.err('schema_mismatch', c.name);
      rd.zeros(1, c.name);
      const off = rd.u32(c.name);
      const byteLen = rd.u32(c.name);
      at = Math.ceil(at / 8) * 8;
      if (off !== at || byteLen !== n * c.width) throw rd.err('not_canonical', c.name);
      out.push(new Reader(tdata.subarray(off, off + byteLen), base + off));
      at += byteLen;
    }
    if (at !== tdata.length) throw new DecodeError('trailing', table, base + at);
    return { rows: n, cols: out };
  };
  const out = {} as ProtosRead;
${p.tables
  .map((t) => {
    const exp = protoColumns(t);
    const reads: string[] = [];
    exp.forEach((x, i) => {
      const c = x.col;
      const path = tsStr(`${t.kind}.${x.name}`);
      if (x.part === 'off') {
        reads.push(
          `    const ${c.name}_off: number[] = []; for (let k = 0; k < n; k++) ${c.name}_off.push(cols[${i}]!.u32(${path}));`,
        );
        return;
      }
      if (x.part === 'count') {
        const of = (c.ty as unknown as { of: never }).of as { k: string; d?: { name: string }; s?: string };
        const size =
          of.k === 'struct'
            ? (entryStructs.get(of.d?.name as string) as StructDecl).size
            : of.k === 'id'
              ? of.d?.name === 'TileId'
                ? 1
                : 2
              : 2;
        let item: string;
        if (of.k === 'struct') {
          const sd = entryStructs.get(of.d?.name as string) as StructDecl;
          const checks = sd.fields
            .filter((f) => !f.reserved)
            .map((f) => {
              const fp = tsStr(`${sd.name}.${f.name}`);
              if (f.refKind)
                return `{ const kk = x.${f.refKind} === 0 ? 'item' : 'fluid'; if (x.${f.name} >= rowsOf(kk)) throw new DecodeError('bad_ref', ${fp}, at2); }`;
              if (f.ty.k === 'id' && ID_KIND[f.ty.d.name])
                return `if (x.${f.name} >= rowsOf(${tsStr(ID_KIND[f.ty.d.name] as string)})) throw new DecodeError('bad_ref', ${fp}, at2);`;
              if (f.ty.k === 'id' && f.ty.d.name === 'ExprRef') {
                const vars = f.formula
                  ? (p.formulas.find((ff) => ff.name === f.formula)?.vars.length ?? 0)
                  : 0;
                return `if (!exprOk(x.${f.name}, ${vars})) throw new DecodeError('bad_ref', ${fp}, at2);`;
              }
              return '';
            })
            .join(' ');
          item = `const at2 = l.pos; const x = ${o.c(sd as never)}.read(l); ${checks}`;
        } else {
          const read = of.k === 'scalar' ? `l.${of.s}(${path})` : `${o.c(of.d as never)}.read(l, ${path})`;
          const chk =
            of.k === 'id' && ID_KIND[of.d?.name as string]
              ? `if (x >= rowsOf(${tsStr(ID_KIND[of.d?.name as string] as string)})) throw new DecodeError('bad_ref', ${path}, l.pos);`
              : '';
          item = `const x = ${read}; ${chk}`;
        }
        reads.push(
          `    const ${c.name}: ${tsType(o, (c.ty as unknown as { of: never }).of)}[][] = []; for (let k = 0; k < n; k++) { const at = cols[${i}]!.pos; const cnt = cols[${i}]!.u16(${path}); const l = list(${c.name}_off[k] ?? 0, cnt, ${size}, ${path}, at); const xs: ${tsType(o, (c.ty as unknown as { of: never }).of)}[] = []; for (let j = 0; j < cnt; j++) { ${item} xs.push(x); } ${c.name}.push(xs); }`,
        );
        return;
      }
      const sc = scalarOf(c.ty);
      let read: string;
      if (c.optional && c.ty.k === 'enum') {
        const none = sc === 'u8' ? 0xff : 0xffff;
        read = `(() => { const at = cols[${i}]!.pos; const raw = cols[${i}]!.${sc}(${path}); if (raw === ${none}) return null; if (!${o.c(c.ty.d)}.has(raw)) throw new DecodeError('bad_enum', ${path}, at); return raw; })()`;
      } else
        read =
          c.ty.k === 'scalar'
            ? `cols[${i}]!.${c.ty.s}(${path})`
            : `${o.c((c.ty as unknown as { d: never }).d)}.read(cols[${i}]!, ${path})`;
      const checks: string[] = [];
      if (c.ty.k === 'id' && ID_KIND[c.ty.d.name])
        checks.push(
          `if (${c.optional ? `v !== ${c.ty.d.none} && ` : ''}(v as number) >= rowsOf(${tsStr(ID_KIND[c.ty.d.name] as string)})) throw new DecodeError('bad_ref', ${path}, at);`,
        );
      if (c.ty.k === 'id' && c.ty.d.name === 'ExprRef') {
        const vars = c.formula ? (p.formulas.find((ff) => ff.name === c.formula)?.vars.length ?? 0) : 0;
        checks.push(`if (!exprOk(v as number, ${vars})) throw new DecodeError('bad_ref', ${path}, at);`);
      }
      reads.push(
        `    const ${c.name}: (${colTs(c)})[] = []; for (let k = 0; k < n; k++) { const at = cols[${i}]!.pos; const v = ${read}; ${checks.join(' ') || 'void at;'} ${c.name}.push(v); }`,
      );
    });
    const refChecks = t.columns
      .filter((c) => c.refKind)
      .map((c) => {
        const kc = t.columns.find((x) => x.name === c.refKind) as ProtoColumn;
        const isStack = kc.ty.k === 'enum' && kc.ty.d.name === 'StackKind';
        const kindName = isStack
          ? `(kk === 0 ? 'item' : 'fluid')`
          : `(${canonicalJson(
              kinds.map((k) => k.name),
              0,
            )}[kk] ?? '')`;
        return `    for (let k = 0; k < n; k++) { const kk = ${c.refKind}[k]; const v = ${c.name}[k] as number; if (kk === null || kk === undefined) { if (v !== 0xffff) throw new DecodeError('bad_ref', ${tsStr(`${t.kind}.${c.name}`)}, ${bases0(t)}); } else if (v >= rowsOf(${kindName})) throw new DecodeError('bad_ref', ${tsStr(`${t.kind}.${c.name}`)}, ${bases0(t)}); }`;
      })
      .join('\n');
    return `  {
    const { rows: n${exp.length ? ', cols' : ''} } = columns(data[${secIndex(t.section)}] as Uint8Array, bases[${secIndex(t.section)}] as number, ${tsStr(t.kind)}, ${upperSnake(t.kind)}_COLUMNS);
    if (n !== rowsOf(${tsStr(t.kind)})) throw new DecodeError('bad_count', ${tsStr(t.kind)}, bases[${secIndex(t.section)}] as number);
${reads.join('\n')}
${refChecks}
    out.${t.kind} = [];
    for (let k = 0; k < n; k++) out.${t.kind}.push({ ${t.columns.map((c) => `${c.name}: ${c.name}[k]!`).join(', ')} });
  }`;
  })
  .join('\n')}
  const m = new Reader(data[${secIndex('META')}] as Uint8Array, bases[${secIndex('META')}] as number);
  if (m.u32('META') !== ${p.meta.length}) throw m.err('bad_count', 'META');
  const meta = {} as ProtosRead['meta'];
${p.meta.map((x) => `  { const at = m.pos; if (m.u16('META') !== ${x.type}) throw m.errAt(at, 'unknown_type', 'META'); meta.${x.name} = ${o.c(x.record)}.read(m, true); }`).join('\n')}
  m.finish('META');
  for (const block of required)
    if (!meta.contents.meta.includes(block) || meta.contents.omitted.includes(block))
      throw new DecodeError('missing_field', block, bases[${secIndex('META')}] as number);
  out.meta = meta;
  const nr = new Reader(data[${secIndex('NAMES')}] as Uint8Array, bases[${secIndex('NAMES')}] as number);
  const names = {} as ProtosRead['names'];
${kinds
  .map(
    (k) => `  {
    const at = nr.pos;
    const n = nr.u16('NAMES');
    if (n !== rowsOf(${tsStr(k.name)})) throw nr.errAt(at, 'bad_count', 'NAMES');
    const list: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = nr.pos;
      const s = nr.str16(255, 'NAMES');
      if (s === '' || list.includes(s)) throw nr.errAt(a, 'not_canonical', 'NAMES');
      list.push(s);
    }
    names.${k.name} = list;
  }`,
  )
  .join('\n')}
  nr.finish('NAMES');
  out.names = names;
  out.expr = expr.slice();
  return out;
}
`);
  // prototypes.json.
  const validator = jsonValidator(p.json.types, p.json.root, {
    prefix: 'Json',
    rootName: 'PrototypesJson',
    rootDoc: 'prototypes.json (§15.2): what the UI and the renderer read.',
    validator: 'checkPrototypesJson',
    label: 'prototypes.json',
  });
  parts.push(`/** prototypes.json's format version (§15.2). */
export const PROTOTYPES_JSON_VERSION = ${p.json.formatVersion};

${jsonHelpers(validator)}
${validator}
/** Checks a parsed prototypes.json against its schema and its format version (§15.2). */
export function validatePrototypesJson(x: unknown): PrototypesJson {
  const v = checkPrototypesJson(x);
  if (v.formatVersion !== PROTOTYPES_JSON_VERSION)
    throw new Error(\`prototypes.json: $.formatVersion is not \${PROTOTYPES_JSON_VERSION}\`);
  return v;
}
`);
  o.push(parts.join('\n'));
  void isU8;
}

function bases0(t: ProtoTableDef): string {
  void t;
  return '0';
}
