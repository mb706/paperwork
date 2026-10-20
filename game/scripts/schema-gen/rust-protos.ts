// The Rust `Protos` loader (10 §15.2): prototypes.bin's tables as Vec columns indexed by dense id, and a
// loader that refuses (ERR_PROTOS) anything malformed: the header and schema hash, the section framing,
// every column's name, type and placement, every value (enums, flags, bools, NaN, ids within their
// kind's rows, ExprRefs at program starts), every list, the bytecode of every expression, the META
// records with the contents check against the capability manifest, and the name tables.
import { canonicalJson } from '../lib/canonical.ts';
import {
  type Field,
  fixedSize,
  isFloat,
  type ProtoColumn,
  type ProtoTableDef,
  pascal,
  type RecordDecl,
  SCALAR_SIZE,
  type Scalar,
  type Schema,
  type StructDecl,
  scalarOf,
  TYPE_CODE,
  type Ty,
  upperSnake,
} from './model.ts';
import { enumVariant, type RsOut, rsFloat, rsIdent, rsStr, rsType } from './rust.ts';

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

/** The expanded columns of a table: a list column becomes `<name>_off` (u32) and `<name>_count` (u16). */
export function protoColumns(
  t: ProtoTableDef,
): { name: string; code: number; width: number; col: ProtoColumn; part?: 'off' | 'count' }[] {
  const out: { name: string; code: number; width: number; col: ProtoColumn; part?: 'off' | 'count' }[] = [];
  for (const c of t.columns) {
    if (c.ty.k === 'list') {
      out.push({ name: `${c.name}_off`, code: TYPE_CODE.u32, width: 4, col: c, part: 'off' });
      out.push({ name: `${c.name}_count`, code: TYPE_CODE.u16, width: 2, col: c, part: 'count' });
    } else {
      const s = scalarOf(c.ty) as Scalar;
      out.push({ name: c.name, code: TYPE_CODE[s], width: SCALAR_SIZE[s], col: c });
    }
  }
  return out;
}

export function protoTableType(t: ProtoTableDef): string {
  return `${pascal(t.kind)}Protos`;
}

/** Statements that validate a value `v` of type `t` read at `at` (id bounds, ExprRefs). */
function checks(
  o: RsOut,
  s: Schema,
  t: Ty,
  v: string,
  at: string,
  p: string,
  optional: boolean,
  sib: (n: string) => string,
  field: Field | ProtoColumn,
): string {
  const out: string[] = [];
  if (t.k === 'id' && ID_KIND[t.d.name]) {
    const kind = enumVariant(ID_KIND[t.d.name] as string);
    const pk = o.t(s.decls.get('ProtoKind') as never);
    out.push(
      `if ${optional ? `!${v}.is_none() && ` : ''}usize::from(${v}.0) >= cx.rows(${pk}::${kind}) { return Err(DecodeError { kind: ErrorKind::BadRef, field: ${p}, ${at === 'at' ? 'at' : `at: ${at}`} }); }`,
    );
  }
  if (t.k === 'id' && t.d.name === 'ExprRef') {
    const f = (field as { formula?: string }).formula;
    const vars = f ? (s.protos.formulas.find((x) => x.name === f)?.vars.length ?? 0) : 0;
    out.push(
      `if !cx.expr_ok(${v}, ${vars}) { return Err(DecodeError { kind: ErrorKind::BadRef, field: ${p}, ${at === 'at' ? 'at' : `at: ${at}`} }); }`,
    );
  }
  const rk = (field as { refKind?: string }).refKind;
  if (rk) {
    const pk = o.t(s.decls.get('ProtoKind') as never);
    const sk = o.t(s.decls.get('StackKind') as never);
    const kindExpr = sib(rk);
    const kf = sib(`__type:${rk}`);
    const map =
      kf === 'StackKind'
        ? `match ${kindExpr} { ${sk}::Item => ${pk}::Item, ${sk}::Fluid => ${pk}::Fluid }`
        : kindExpr;
    const isOpt = kf.startsWith('Option');
    if (isOpt)
      out.push(
        `match ${kindExpr} { None => if ${v} != 0xFFFF { return Err(DecodeError { kind: ErrorKind::BadRef, field: ${p}, ${at === 'at' ? 'at' : `at: ${at}`} }); }, Some(k) => if usize::from(${v}) >= cx.rows(${kf === 'Option<StackKind>' ? `match k { ${sk}::Item => ${pk}::Item, ${sk}::Fluid => ${pk}::Fluid }` : 'k'}) { return Err(DecodeError { kind: ErrorKind::BadRef, field: ${p}, ${at === 'at' ? 'at' : `at: ${at}`} }); } }`,
      );
    else
      out.push(
        `if usize::from(${v}) >= cx.rows(${map}) { return Err(DecodeError { kind: ErrorKind::BadRef, field: ${p}, ${at === 'at' ? 'at' : `at: ${at}`} }); }`,
      );
  }
  return out.join(' ');
}

/** Reads one entry struct from `c`, validating ids by its sibling `kind` and ExprRefs. */
function entryReader(o: RsOut, s: Schema, d: StructDecl): string {
  const t = o.t(d);
  const lines: string[] = [];
  for (const f of d.fields) {
    if (
      f.reserved ||
      !(f.refKind || (f.ty.k === 'id' && (ID_KIND[f.ty.d.name] || f.ty.d.name === 'ExprRef')))
    )
      continue;
    const sib = (n: string) => {
      if (n.startsWith('__type:')) {
        const g = d.fields.find((x) => x.name === n.slice(7)) as Field;
        return g.ty.k === 'enum' ? g.ty.d.name : 'u16';
      }
      return `x.${rsIdent(n)}`;
    };
    lines.push(checks(o, s, f.ty, `x.${rsIdent(f.name)}`, 'at', rsStr(`${d.name}.${f.name}`), false, sib, f));
  }
  return `fn read_${d.name.replace(/[A-Z]/g, (c, i: number) => (i ? '_' : '') + c.toLowerCase())}(c: &mut Reader<'_>, cx: &ProtoCtx<'_>) -> DResult<${t}> {
    let at = c.pos();
    let x = ${t}::read(c, ${rsStr(d.name)})?;
    ${lines.join('\n    ') || 'let _ = (cx, at);'}
    Ok(x)
}`;
}

export function rustProtos(s: Schema, o: RsOut): void {
  o.rt('Reader', 'DResult', 'DecodeError', 'ErrorKind', 'Fixed', 'Packed');
  const p = s.protos;
  const pk = o.t(s.decls.get('ProtoKind') as never);
  const er = o.t(s.decls.get('ExprRef') as never);
  const frame = o.t(s.decls.get('SectionFrame') as never);
  const codec = o.t(s.decls.get('SectionCodec') as never);
  const sflags = o.t(s.decls.get('SectionFlags') as never);
  const header = o.t(s.decls.get('ProtosHeader') as never);
  const kinds = (s.decls.get('ProtoKind') as { values: { name: string; value: number }[] }).values;
  const secIndex = (name: string) => p.sections.findIndex((x) => x.name === name);
  const entryStructs = new Map<string, StructDecl>();
  const parts: string[] = [];

  parts.push(`/// prototypes.bin's magic, versions and layout (§15.2).
pub const PROTOS_MAGIC: [u8; 8] = *b${canonicalJson(p.magic, 0).replace('\\u0000', '\\0')};
pub const PROTOS_FORMAT_VERSION: u32 = ${p.formatVersion};
pub const PROTOS_DATA_VERSION: u32 = ${p.dataVersion};
pub const PROTOS_SECTION_VERSION: u16 = ${p.sectionVersion};
pub const PROTOS_HEADER_SIZE: usize = 56;
/// The sections, in file order.
pub const PROTOS_SECTIONS: [u32; ${p.sections.length}] = [${p.sections.map((x) => x.id).join(', ')}];

/// The expression bytecode (§15.2): the stack limit, the exponent limit and the opcodes.
pub const EXPR_MAX_STACK: usize = ${p.expr.maxStack};
pub const EXPR_POWI_LIMIT: i32 = ${p.expr.powiLimit};
${p.expr.ops.map((x) => `pub const OP_${x.name}: u8 = 0x${x.code.toString(16).padStart(2, '0').toUpperCase()};`).join('\n')}

/// A formula field (§2.4 step 2): its variables, in bytecode order, and its declared result range.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FormulaField {
    pub name: &'static str,
    pub vars: &'static [&'static str],
    pub lo: f64,
    pub hi: f64,
}

${p.formulas.map((f) => `/// ${f.doc ?? f.name}\npub const FORMULA_${upperSnake(f.name)}: FormulaField = FormulaField { name: ${rsStr(f.name)}, vars: &[${f.vars.map(rsStr).join(', ')}], lo: ${rsFloat('f64', f.range[0])}, hi: ${rsFloat('f64', f.range[1])} };`).join('\n')}

/// Every formula field.
pub const FORMULAS: [FormulaField; ${p.formulas.length}] = [${p.formulas.map((f) => `FORMULA_${upperSnake(f.name)}`).join(', ')}];

/// Checks the EXPR section (§15.2) and returns the offset of every program: each is \`u16 byte_count\`,
/// \`u8 var_count\`, \`u8 max_stack\` (at most EXPR_MAX_STACK), then its ops; every opcode is known, every
/// operand is present, a VAR's index is below var_count, the stack never underflows or passes max_stack,
/// and END ends the op stream with one value. Programs are packed back to back.
pub fn expr_programs(bytes: &[u8]) -> Result<Vec<u32>, (usize, &'static str)> {
    let mut starts = Vec::new();
    let mut at = 0usize;
    while at < bytes.len() {
        if bytes.len() - at < 4 {
            return Err((at, "truncated expression header"));
        }
        let n = usize::from(u16::from_le_bytes([bytes[at], bytes[at + 1]]));
        let vars = bytes[at + 2];
        let max = usize::from(bytes[at + 3]);
        if max > EXPR_MAX_STACK {
            return Err((at, "max_stack above the limit"));
        }
        let end = at + 4 + n;
        if end > bytes.len() {
            return Err((at, "op stream runs past EXPR"));
        }
        let mut pc = at + 4;
        let mut depth = 0usize;
        let mut ended = false;
        while pc < end {
            let op = bytes[pc];
            pc += 1;
            match op {
                OP_CONST => {
                    if end - pc < 8 {
                        return Err((pc, "truncated CONST"));
                    }
                    pc += 8;
                    depth += 1;
                }
                OP_VAR => {
                    if pc >= end {
                        return Err((pc, "truncated VAR"));
                    }
                    if bytes[pc] >= vars {
                        return Err((pc, "VAR index not below var_count"));
                    }
                    pc += 1;
                    depth += 1;
                }
                OP_ADD | OP_SUB | OP_MUL | OP_DIV | OP_POWI => {
                    if depth < 2 {
                        return Err((pc - 1, "stack underflow"));
                    }
                    depth -= 1;
                }
                OP_NEG => {
                    if depth < 1 {
                        return Err((pc - 1, "stack underflow"));
                    }
                }
                OP_END => {
                    if pc != end || depth != 1 {
                        return Err((pc - 1, "END is not last with one value"));
                    }
                    ended = true;
                }
                _ => return Err((pc - 1, "unknown opcode")),
            }
            if depth > max {
                return Err((pc - 1, "stack passes max_stack"));
            }
        }
        if !ended {
            return Err((at, "program without END"));
        }
        starts.push(at as u32);
        at = end;
    }
    Ok(starts)
}

/// One list column of a prototype table: every row's entries, flat, with each row's range.
#[derive(Clone, Debug, PartialEq)]
pub struct ListColumn<T> {
    items: Vec<T>,
    ranges: Vec<(u32, u32)>,
}

impl<T> Default for ListColumn<T> {
    fn default() -> Self {
        Self { items: Vec::new(), ranges: Vec::new() }
    }
}

impl<T> ListColumn<T> {
    /// Row \`row\`'s entries (empty for an unknown row).
    pub fn get(&self, row: usize) -> &[T] {
        match self.ranges.get(row) {
            Some(&(a, b)) => &self.items[a as usize..b as usize],
            None => &[],
        }
    }
    pub fn rows(&self) -> usize {
        self.ranges.len()
    }
}

/// What a column check needs: each kind's rows, the lists, the expression program starts.
#[derive(Debug)]
pub struct ProtoCtx<'b> {
    rows: [usize; ${kinds.length}],
    lists: &'b [u8],
    lists_base: usize,
    expr: &'b [u8],
    starts: Vec<u32>,
}

impl ProtoCtx<'_> {
    /// The rows of a kind's table.
    pub const fn rows(&self, k: ${pk}) -> usize {
        self.rows[k.value() as usize]
    }
    /// Whether an ExprRef is none or a program start whose variables fit a formula with \`vars\` of them.
    pub fn expr_ok(&self, e: ${er}, vars: usize) -> bool {
        if e.is_none() {
            return true;
        }
        self.starts.binary_search(&e.0).is_ok() && usize::from(self.expr[e.0 as usize + 2]) <= vars
    }
    /// The bytes of a list: 8-aligned, inside LISTS, (0, 0) when empty.
    fn list(&self, off: u32, count: u16, size: usize, field: &'static str, at: usize) -> DResult<Reader<'_>> {
        let off = off as usize;
        let n = usize::from(count) * size;
        if count == 0 {
            if off != 0 {
                return Err(DecodeError { kind: ErrorKind::NotCanonical, field, at });
            }
            return Ok(Reader::with_base(&[], self.lists_base));
        }
        if !off.is_multiple_of(8) || off.checked_add(n).is_none_or(|e| e > self.lists.len()) {
            return Err(DecodeError { kind: ErrorKind::BadLength, field, at });
        }
        Ok(Reader::with_base(&self.lists[off..off + n], self.lists_base + off))
    }
}

/// The directory of a column table, checked against the declared columns: names, type codes, row
/// widths, and the canonical placement (each column at the next multiple of 8, the table ending with the
/// last one). Returns the rows and each column's byte range.
fn columns<const N: usize>(
    data: &[u8],
    base: usize,
    table: &'static str,
    cols: &[(&'static str, u8, usize); N],
) -> DResult<(usize, [(usize, usize); N])> {
    let mut r = Reader::with_base(data, base);
    let rows = r.u32(table)? as usize;
    let n = usize::from(r.u16(table)?);
    r.zeros(2, table)?;
    if n != N {
        return Err(r.err(ErrorKind::SchemaMismatch, table));
    }
    let mut dir_end = 8usize;
    for (name, _, _) in cols {
        dir_end += 1 + name.len() + 1 + 1 + 4 + 4;
    }
    let mut at = dir_end;
    let mut out = [(0usize, 0usize); N];
    for (i, (name, code, width)) in cols.iter().enumerate() {
        let len = usize::from(r.u8(name)?);
        if r.take(len, name)? != name.as_bytes() {
            return Err(r.err(ErrorKind::SchemaMismatch, name));
        }
        if r.u8(name)? != *code {
            return Err(r.err(ErrorKind::SchemaMismatch, name));
        }
        r.zeros(1, name)?;
        let off = r.u32(name)? as usize;
        let bytes = r.u32(name)? as usize;
        at = at.next_multiple_of(8);
        if off != at || bytes != rows * width {
            return Err(r.err(ErrorKind::NotCanonical, name));
        }
        out[i] = (off, bytes);
        at += bytes;
    }
    if at != data.len() {
        return Err(DecodeError { kind: ErrorKind::Trailing, field: table, at: base + at });
    }
    Ok((rows, out))
}
`);

  // Entry readers for the list entry structs.
  for (const t of p.tables)
    for (const c of t.columns)
      if (c.ty.k === 'list' && c.ty.of.k === 'struct') entryStructs.set(c.ty.of.d.name, c.ty.of.d);
  for (const d of entryStructs.values()) parts.push(entryReader(o, s, d));

  // The tables.
  for (const t of p.tables) {
    const tn = protoTableType(t);
    const exp = protoColumns(t);
    const fieldOf = (c: ProtoColumn): string => {
      if (c.ty.k === 'list') return `ListColumn<${rsType(o, c.ty.of, true)}>`;
      const ty = rsType(o, c.ty, true);
      return c.optional && c.ty.k === 'enum' ? `Option<${ty}>` : ty;
    };
    const decls = t.columns
      .map(
        (c) =>
          `    /// ${c.from}${c.optional ? ' (optional)' : ''}\n    pub ${rsIdent(c.name)}: Vec<${c.ty.k === 'list' ? '()' : fieldOf(c)}>,`,
      )
      .join('\n')
      .replace(/Vec<\(\)>/g, '');
    const fieldsDecl = t.columns
      .map(
        (c) =>
          `    /// ${c.from}${c.optional ? ' (optional)' : ''}\n    pub ${rsIdent(c.name)}: ${c.ty.k === 'list' ? fieldOf(c) : `Vec<${fieldOf(c)}>`},`,
      )
      .join('\n');
    void decls;
    const colTuples = exp.map((x) => `(${rsStr(x.name)}, ${x.code}u8, ${x.width}usize)`).join(', ');
    const reads: string[] = [];
    const tname = t.name;
    exp.forEach((x, i) => {
      const c = x.col;
      const p2 = rsStr(`${tname}.${x.name}`);
      const cr = `let mut c = Reader::with_base(&data[cols[${i}].0..cols[${i}].0 + cols[${i}].1], base + cols[${i}].0);`;
      if (x.part === 'off') {
        reads.push(
          `let mut ${c.name}_off = Vec::with_capacity(rows); { ${cr} for _ in 0..rows { ${c.name}_off.push(c.u32(${p2})?); } }`,
        );
        return;
      }
      if (x.part === 'count') {
        const of = (c.ty as { of: Ty }).of;
        const size = fixedSize(of) as number;
        const itemRead =
          of.k === 'struct'
            ? `read_${of.d.name.replace(/[A-Z]/g, (ch, k: number) => (k ? '_' : '') + ch.toLowerCase())}(&mut l, &cx)?`
            : `${rsType(o, of, true)}::read(&mut l, ${p2})?`;
        const idCheck =
          of.k === 'id' && ID_KIND[of.d.name]
            ? `if usize::from(v.0) >= cx.rows(${pk}::${enumVariant(ID_KIND[of.d.name] as string)}) { return Err(DecodeError { kind: ErrorKind::BadRef, field: ${p2}, at: l.pos() }); }`
            : '';
        reads.push(
          `{ ${cr} for row in 0..rows { let at = c.pos(); let n = c.u16(${p2})?; let mut l = cx.list(${c.name}_off[row], n, ${size}, ${p2}, at)?; let a = t.${rsIdent(c.name)}.items.len() as u32; for _ in 0..n { let v = ${itemRead}; ${idCheck} t.${rsIdent(c.name)}.items.push(v); } t.${rsIdent(c.name)}.ranges.push((a, t.${rsIdent(c.name)}.items.len() as u32)); } }`,
        );
        return;
      }
      const sib = (n: string) => {
        if (n.startsWith('__type:')) {
          const g = t.columns.find((y) => y.name === n.slice(7)) as ProtoColumn;
          const nm = g.ty.k === 'enum' ? g.ty.d.name : 'u16';
          return g.optional ? `Option<${nm}>` : nm;
        }
        return `t.${rsIdent(n)}[row]`;
      };
      let read: string;
      if (c.optional && c.ty.k === 'enum') {
        const base = c.ty.d.base;
        const none = base === 'u8' ? '0xFF' : '0xFFFF';
        read = `{ let at = c.pos(); let raw = c.${base}(${p2})?; if raw == ${none} { None } else { Some(${o.t(c.ty.d)}::from_value(raw).ok_or(DecodeError { kind: ErrorKind::BadEnum, field: ${p2}, at })?) } }`;
      } else read = `${fieldOf(c)}::read(&mut c, ${p2})?`;
      const chk = checks(o, s, c.ty, 'v', 'at', p2, c.optional, sib, c);
      reads.push(
        `{ ${cr} for row in 0..rows { let at = c.pos(); let v = ${read}; ${chk ? chk : 'let _ = at;'} t.${rsIdent(c.name)}.push(v); let _ = row; } }`,
      );
    });
    parts.push(`/// ${t.section}: one row per ${t.kind.replace('_', ' ')} id (§15.2).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${tn} {
${fieldsDecl}
}

impl ${tn} {
    /// The columns in file order (a list column is \`_off\` and \`_count\`): name, §8.1 type code, width.
    pub const COLUMNS: [(&'static str, u8, usize); ${exp.length}] = [${colTuples}];

    /// The number of rows (dense ids).
    pub fn len(&self) -> usize {
        ${t.columns.length > 0 ? `self.${rsIdent((t.columns[0] as ProtoColumn).name)}.${t.columns[0]?.ty.k === 'list' ? 'rows()' : 'len()'}` : '0'}
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn read(data: &[u8], base: usize, cx: &ProtoCtx<'_>) -> DResult<Self> {
        let (rows, cols) = columns(data, base, ${rsStr(tname)}, &Self::COLUMNS)?;
        if rows != cx.rows(${pk}::${enumVariant(t.kind)}) {
            return Err(DecodeError { kind: ErrorKind::BadCount, field: ${rsStr(tname)}, at: base });
        }
        let mut t = Self::default();
        ${reads.join('\n        ') || 'let _ = (cols, &mut t);'}
        Ok(t)
    }
}
`);
  }

  // Names, META, the Protos struct and load().
  const metaRecs = p.meta;
  const ms = metaRecs.map((m) => ({ ...m, ty: o.t(m.record as RecordDecl), field: rsIdent(m.name) }));
  const tableOf = (kind: string) => p.tables.find((t) => t.kind === kind) as ProtoTableDef;
  parts.push(`/// The name tables (NAMES, §15.2): each kind's names in id order, for saves (§8.3), well-known names
/// and debugging.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProtoNames {
${kinds.map((k) => `    pub ${rsIdent(k.name)}: Vec<String>,`).join('\n')}
}

impl ProtoNames {
    pub fn of(&self, k: ${pk}) -> &[String] {
        match k {
${kinds.map((k) => `            ${pk}::${enumVariant(k.name)} => &self.${rsIdent(k.name)},`).join('\n')}
        }
    }
    /// The id of a name.
    pub fn find(&self, k: ${pk}, name: &str) -> Option<u16> {
        self.of(k).iter().position(|n| n == name).map(|i| i as u16)
    }
}

/// The ids of the names the engine must know (registries.yaml \`well_known\`), when the build has them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WellKnownIds {
${s.wellKnown.map((w) => `    pub ${rsIdent(w.name)}: Option<u16>,`).join('\n')}
}

/// prototypes.bin, loaded (§15.2): the sim's tables, indexed by dense id.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Protos {
${p.tables.map((t) => `    pub ${rsIdent(t.kind)}: ${protoTableType(t)},`).join('\n')}
    /// The EXPR section: programs at the offsets ExprRefs hold.
    pub expr: Vec<u8>,
${ms.map((m) => `    pub ${m.field}: ${m.ty},`).join('\n')}
    pub names: ProtoNames,
    pub well_known: WellKnownIds,
}

impl Protos {
    /// Loads prototypes.bin and refuses a malformed file (ERR_PROTOS, §15.2): a wrong magic, version or
    /// schema hash; sections other than PROTOS_SECTIONS in order, or not raw; a column table whose
    /// directory differs from the schema; an enum, flag, bool or NaN that does not decode; an id outside its
    /// kind's rows; an ExprRef that is not a program start, or whose program uses more variables than its
    /// formula field has; a malformed program; a list outside LISTS; META records other than the schema's,
    /// or a contents record that omits a block this engine reads (capabilities.rs REQUIRED_DATA, C1a-r1
    /// finding 5); a name table that does not match its kind's rows.
    pub fn load(bytes: &[u8]) -> DResult<Self> {
        let mut r = Reader::new(bytes);
        let h = ${header}::read(&mut r, "ProtosHeader")?;
        if h.magic != PROTOS_MAGIC {
            return Err(r.err_at(0, ErrorKind::BadMagic, "ProtosHeader.magic"));
        }
        if h.format_version != PROTOS_FORMAT_VERSION {
            return Err(r.err_at(8, ErrorKind::BadVersion, "ProtosHeader.format_version"));
        }
        if h.schema_hash.bytes != crate::SCHEMA_HASH {
            return Err(r.err_at(12, ErrorKind::SchemaMismatch, "ProtosHeader.schema_hash"));
        }
        if h.data_version != PROTOS_DATA_VERSION {
            return Err(r.err_at(44, ErrorKind::BadVersion, "ProtosHeader.data_version"));
        }
        if h.section_count as usize != PROTOS_SECTIONS.len() {
            return Err(r.err_at(48, ErrorKind::BadCount, "ProtosHeader.section_count"));
        }
        let mut data: [&[u8]; ${p.sections.length}] = [&[]; ${p.sections.length}];
        let mut bases = [0usize; ${p.sections.length}];
        for (i, want) in PROTOS_SECTIONS.iter().enumerate() {
            let at = r.pos();
            let f = ${frame}::decode(&mut r)?;
            if f.id != *want {
                return Err(r.err_at(at, ErrorKind::UnknownType, "SectionFrame.id"));
            }
            if f.version != PROTOS_SECTION_VERSION {
                return Err(r.err_at(at + 4, ErrorKind::BadVersion, "SectionFrame.version"));
            }
            if f.codec != ${codec}::Raw || f.flags != ${sflags}::EMPTY || f.raw_length as usize != f.data.len() {
                return Err(r.err_at(at + 6, ErrorKind::NotCanonical, "SectionFrame.codec"));
            }
            data[i] = f.data;
            bases[i] = at + 16;
        }
        r.finish("prototypes.bin")?;
        let expr = data[${secIndex('EXPR')}];
        let starts = expr_programs(expr)
            .map_err(|(at, why)| DecodeError { kind: ErrorKind::BadEnum, field: why, at: bases[${secIndex('EXPR')}] + at })?;
        let mut rows = [0usize; ${kinds.length}];
${p.tables.map((t) => `        rows[${pk}::${enumVariant(t.kind)}.value() as usize] = table_rows(data[${secIndex(t.section)}], bases[${secIndex(t.section)}])?;`).join('\n')}
        let cx = ProtoCtx { rows, lists: data[${secIndex('LISTS')}], lists_base: bases[${secIndex('LISTS')}], expr, starts };
${p.tables.map((t) => `        let ${rsIdent(t.kind)} = ${protoTableType(t)}::read(data[${secIndex(t.section)}], bases[${secIndex(t.section)}], &cx)?;`).join('\n')}
        // META: u32 count, then per record u16 type and the record, ascending by type, each once.
        let mut m = Reader::with_base(data[${secIndex('META')}], bases[${secIndex('META')}]);
        let count = m.u32("META")?;
        if count as usize != ${ms.length} {
            return Err(m.err(ErrorKind::BadCount, "META"));
        }
${ms
  .map(
    (x) => `        let at = m.pos();
        if m.u16("META")? != ${x.type} {
            return Err(m.err_at(at, ErrorKind::UnknownType, "META"));
        }
        let ${x.field} = ${x.ty}::decode(&mut m, true)?;`,
  )
  .join('\n')}
        m.finish("META")?;
        let carried = &${rsIdent((ms.find((x) => x.name === 'contents') as { name: string }).name)};
        for block in crate::capabilities::REQUIRED_DATA {
            if !carried.meta.iter().any(|b| b == block) || carried.omitted.iter().any(|b| b == block) {
                return Err(DecodeError { kind: ErrorKind::MissingField, field: block, at: bases[${secIndex('META')}] });
            }
        }
        // NAMES: per kind in ProtoKind order, u16 count (the kind's rows), then each name.
        let mut nr = Reader::with_base(data[${secIndex('NAMES')}], bases[${secIndex('NAMES')}]);
        let mut names = ProtoNames::default();
        for k in ${pk}::ALL {
            let at = nr.pos();
            let n = usize::from(nr.u16("NAMES")?);
            if n != cx.rows(k) {
                return Err(nr.err_at(at, ErrorKind::BadCount, "NAMES"));
            }
            let mut list = Vec::with_capacity(n);
            for _ in 0..n {
                let at = nr.pos();
                let s = nr.str16(255, "NAMES")?;
                if s.is_empty() || list.iter().any(|x: &String| x == s) {
                    return Err(nr.err_at(at, ErrorKind::NotCanonical, "NAMES"));
                }
                list.push(s.to_owned());
            }
            match k {
${kinds.map((k) => `                ${pk}::${enumVariant(k.name)} => names.${rsIdent(k.name)} = list,`).join('\n')}
            }
        }
        nr.finish("NAMES")?;
        let well_known = WellKnownIds {
${s.wellKnown.map((w) => `            ${rsIdent(w.name)}: names.find(${pk}::${enumVariant(w.kind)}, ${rsStr(w.name)}),`).join('\n')}
        };
        Ok(Self {
${p.tables.map((t) => `            ${rsIdent(t.kind)},`).join('\n')}
            expr: expr.to_vec(),
${ms.map((x) => `            ${x.field},`).join('\n')}
            names,
            well_known,
        })
    }

    /// The program an ExprRef names (validated by load), or None.
    pub fn program(&self, e: ${er}) -> Option<&[u8]> {
        if e.is_none() {
            return None;
        }
        let at = e.0 as usize;
        let n = usize::from(u16::from_le_bytes([*self.expr.get(at)?, *self.expr.get(at + 1)?]));
        self.expr.get(at..at + 4 + n)
    }
}

/// A column table's row count (its first u32).
fn table_rows(data: &[u8], base: usize) -> DResult<usize> {
    Ok(Reader::with_base(data, base).u32("rows")? as usize)
}
`);
  o.push(parts.join('\n'));
  void tableOf;
  void isFloat;
}
