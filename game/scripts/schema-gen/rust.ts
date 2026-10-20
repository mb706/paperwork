// The Rust emitter (10 §15.1): crates/schema/src/ (everything more than one crate uses) and
// crates/sim/src/gen/ (state.yaml: the pools, the state records and the save-section codecs). The text
// it returns is not formatted; schema-gen.ts runs rustfmt over it.
import { canonicalJson } from '../lib/canonical.ts';
import {
  type Decl,
  type EnumDecl,
  type Field,
  type FlagsDecl,
  fixedSize,
  type IdDecl,
  isFloat,
  isInt,
  type MessageDecl,
  pascal,
  type RecordDecl,
  SCALAR_SIZE,
  type Scalar,
  type Schema,
  type StructDecl,
  scalarOf,
  type TableDecl,
  type Ty,
  typeName,
  upperSnake,
  valueFields,
} from './model.ts';

export type RsMod =
  | 'types'
  | 'actions'
  | 'events'
  | 'packet'
  | 'projections'
  | 'container'
  | 'abi'
  | 'protos'
  | 'registries'
  | 'capabilities'
  | 'state'
  | 'pools'
  | 'sections'
  | 'fixtures';

export const SCHEMA_MODS: readonly RsMod[] = [
  'types',
  'actions',
  'events',
  'packet',
  'projections',
  'container',
  'abi',
  'protos',
  'registries',
  'capabilities',
];
/** The sim crate's generated modules (`fixtures` is the codec-fixture test's, outside the crate's src/). */
export const SIM_MODS: readonly RsMod[] = ['state', 'pools', 'sections'];
/** The file of a sim module (crates/sim/src/gen/<file>.rs). */
export function simFile(m: RsMod): string {
  return m;
}

const FILE_MOD: Record<string, DeclMod> = {
  'schema/types.yaml': 'types',
  'schema/actions.yaml': 'actions',
  'schema/events.yaml': 'events',
  'schema/packet.yaml': 'packet',
  'schema/projections.yaml': 'projections',
  'schema/sections.yaml': 'container',
  'schema/abi.yaml': 'abi',
  'schema/protos.yaml': 'protos',
  'schema/registries.yaml': 'registries',
  'schema/state.yaml': 'state',
};
const SYNTH_MOD: Record<string, DeclMod> = {
  actions: 'actions',
  events: 'events',
  'packet sections': 'packet',
  'projection kinds': 'projections',
  queries: 'projections',
  'save sections': 'container',
  'prototypes.bin sections': 'protos',
  'META records': 'protos',
};

/** A module that holds declarations (every module but the test-only `fixtures`). */
export type DeclMod = Exclude<RsMod, 'fixtures'>;

/** The module a declaration's Rust lives in. */
export function homeMod(d: Decl): DeclMod {
  if (d.kind === 'enum' && d.synthetic) return SYNTH_MOD[d.synthetic] ?? 'registries';
  if (d.kind === 'table') return 'pools';
  const m = FILE_MOD[d.file];
  if (!m) throw new Error(`no module for ${d.name} (${d.file})`);
  return m;
}

const RUST_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'box',
  'break',
  'const',
  'continue',
  'crate',
  'do',
  'dyn',
  'else',
  'enum',
  'extern',
  'false',
  'final',
  'fn',
  'for',
  'gen',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'macro',
  'match',
  'mod',
  'move',
  'mut',
  'override',
  'priv',
  'pub',
  'ref',
  'return',
  'self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'try',
  'type',
  'typeof',
  'unsafe',
  'unsized',
  'use',
  'virtual',
  'where',
  'while',
  'yield',
  'abstract',
  'become',
]);
export function rsIdent(name: string): string {
  return RUST_KEYWORDS.has(name) ? `r#${name}` : name;
}

/** A Rust string literal. */
export function rsStr(s: string): string {
  return canonicalJson(s, 0).replace(/\\u([0-9a-f]{4})/g, (_m, h: string) => `\\u{${h}}`);
}

export function rsDoc(doc: string | undefined, indent = ''): string {
  if (!doc) return '';
  return `${doc
    .split('\n')
    .map((l) => `${indent}/// ${l}`.trimEnd())
    .join('\n')}\n`;
}

/** One module's code and the declarations it names (for its `use` lines). */
export class RsOut {
  readonly uses = new Set<string>();
  readonly runtime = new Set<string>();
  readonly parts: string[] = [];
  readonly s: Schema;
  readonly mod: RsMod;
  constructor(s: Schema, mod: RsMod) {
    this.s = s;
    this.mod = mod;
  }
  /** Names a declaration's type, recording the use. */
  t(d: Decl): string {
    this.uses.add(d.name);
    return typeName(d);
  }
  rt(...names: string[]): void {
    for (const n of names) this.runtime.add(n);
  }
  push(code: string): void {
    this.parts.push(code);
  }
}

// ------------------------------------------------------------------------------------------- type facts

export function isU8(t: Ty): boolean {
  return t.k === 'scalar' && t.s === 'u8';
}

/** Whether a message's Rust type takes a lifetime (it borrows strings, bytes or lists). */
export function msgLifetime(d: MessageDecl): boolean {
  return d.fields.some((f) => tyBorrows(f.ty));
}
function tyBorrows(t: Ty): boolean {
  switch (t.k) {
    case 'str':
    case 'bytes':
    case 'list':
    case 'blob_or_bytes':
    case 'counted':
    case 'rest':
      return true;
    case 'message':
      return msgLifetime(t.d);
    default:
      return false;
  }
}

/** Whether the type is Copy in Rust (fixed values; borrowed views). */
function tyCopy(t: Ty, owned: boolean): boolean {
  switch (t.k) {
    case 'record':
      return false;
    case 'str':
    case 'bytes':
    case 'list':
      return !owned;
    case 'message':
      return t.d.fields.every((f) => tyCopy(f.ty, false));
    default:
      return true;
  }
}

/** Whether the Rust type implements Eq (no floats inside). */
function tyEq(t: Ty): boolean {
  switch (t.k) {
    case 'scalar':
      return !isFloat(t.s);
    case 'struct':
    case 'message':
    case 'record':
      return t.d.fields.every((f) => tyEq(f.ty));
    case 'array':
    case 'list':
    case 'counted':
    case 'rest':
      return tyEq(t.of);
    default:
      return true;
  }
}

/** The Rust type of a field: borrowed views in messages, owned values in records. */
export function rsType(o: RsOut, t: Ty, owned: boolean): string {
  switch (t.k) {
    case 'scalar':
      return t.s;
    case 'id':
    case 'enum':
    case 'flags':
    case 'struct':
    case 'record':
      return o.t(t.d);
    case 'array':
      return `[${rsType(o, t.of, owned)}; ${t.n}]`;
    case 'message':
      return `${o.t(t.d)}${msgLifetime(t.d) ? "<'a>" : ''}`;
    case 'str':
      return owned ? 'String' : "&'a str";
    case 'bytes':
      return owned ? 'Vec<u8>' : "&'a [u8]";
    case 'list':
      if (owned) return `Vec<${rsType(o, t.of, true)}>`;
      if (fixedSize(t.of) !== null && t.of.k !== 'message') {
        o.rt('List');
        return `List<'a, ${rsType(o, t.of, false)}>`;
      }
      o.rt('MsgList');
      return `MsgList<'a, ${rsType(o, t.of, false)}>`;
    case 'blob_or_bytes':
      o.rt('BlobOrBytes');
      return "BlobOrBytes<'a>";
    case 'counted':
    case 'rest':
      if (isU8(t.of)) return "&'a [u8]";
      if (fixedSize(t.of) !== null && t.of.k !== 'message') {
        o.rt('List');
        return `List<'a, ${rsType(o, t.of, false)}>`;
      }
      o.rt('MsgList');
      return `MsgList<'a, ${rsType(o, t.of, false)}>`;
  }
}

function countTy(f: Field): Scalar {
  return scalarOf(f.ty) as Scalar;
}
function toUsize(expr: string, s: Scalar): string {
  return s === 'u8' || s === 'u16' ? `usize::from(${expr})` : `${expr} as usize`;
}

/** The expression that reads a field's value from reader `r` (path `p`, a string literal). */
function rsRead(o: RsOut, t: Ty, p: string, owned: boolean, fields: readonly Field[]): string {
  switch (t.k) {
    case 'scalar':
      return `r.${t.s}(${p})?`;
    case 'id':
    case 'enum':
    case 'flags':
    case 'struct':
      o.rt('Fixed');
      return `${o.t(t.d)}::read(r, ${p})?`;
    case 'array':
      if (isU8(t.of)) return `{ let mut a = [0u8; ${t.n}]; a.copy_from_slice(r.take(${t.n}, ${p})?); a }`;
      o.rt('Fixed');
      return `<${rsType(o, t, owned)}>::read(r, ${p})?`;
    case 'message':
      o.rt('Packed');
      return `${o.t(t.d)}::decode(r)?`;
    case 'record':
      return `${o.t(t.d)}::decode(r, ${owned ? 'strict' : 'true'})?`;
    case 'str':
      return owned ? `r.str16(${t.max}, ${p})?.to_owned()` : `r.str16(${t.max}, ${p})?`;
    case 'bytes':
      return owned
        ? `r.bytes(${t.lenWidth}, ${t.max}, ${p})?.to_vec()`
        : `r.bytes(${t.lenWidth}, ${t.max}, ${p})?`;
    case 'list': {
      if (owned) {
        if (t.of.k === 'str') {
          o.rt('ErrorKind');
          return `{ let at = r.pos(); let n = r.count(${t.countWidth}, ${p})?; if n > ${t.max} { return Err(r.err_at(at, ErrorKind::TooLong, ${p})); } let mut v = Vec::with_capacity(n.min(1024)); for _ in 0..n { v.push(r.str16(${t.of.max}, ${p})?.to_owned()); } v }`;
        }
        if (t.of.k === 'record') {
          o.rt('ErrorKind');
          return `{ let at = r.pos(); let n = r.count(${t.countWidth}, ${p})?; if n > ${t.max} { return Err(r.err_at(at, ErrorKind::TooLong, ${p})); } let mut v = Vec::with_capacity(n.min(1024)); for _ in 0..n { v.push(${o.t(t.of.d)}::decode(r, strict)?); } v }`;
        }
        o.rt('read_vec');
        return `read_vec::<${rsType(o, t.of, true)}>(r, ${t.countWidth}, ${t.max}, ${p})?`;
      }
      if (fixedSize(t.of) !== null && t.of.k !== 'message') {
        o.rt('List');
        return `List::read_counted(r, ${t.countWidth}, ${t.max}, ${p})?`;
      }
      o.rt('MsgList');
      return `MsgList::read_counted(r, ${t.countWidth}, ${t.max}, ${p})?`;
    }
    case 'blob_or_bytes':
      o.rt('BlobOrBytes');
      return `BlobOrBytes::read(r, ${t.max}, ${p})?`;
    case 'counted': {
      const cf = fields.find((f) => f.name === t.count) as Field;
      const base = toUsize(`f_${t.count}`, countTy(cf));
      const n = t.minus ? `(${base}).saturating_sub(${t.minus})` : base;
      if (isU8(t.of)) return `r.take(${n}, ${p})?`;
      if (fixedSize(t.of) !== null && t.of.k !== 'message') {
        o.rt('List');
        return `List::read(r, ${n}, ${p})?`;
      }
      o.rt('MsgList');
      return `MsgList::read(r, ${n})?`;
    }
    case 'rest':
      if (isU8(t.of)) return 'r.rest()';
      o.rt('List');
      return `List::read_rest(r, ${p})?`;
  }
}

/** Statements that write a field's value (`e`, an expression of the field's type) to writer `w`. */
function rsWrite(o: RsOut, t: Ty, e: string, p: string, owned: boolean): string {
  switch (t.k) {
    case 'scalar':
      if (isFloat(t.s)) return `w.${t.s}(${e}, ${p})?;`;
      return `w.${t.s}(${e});`;
    case 'id':
    case 'enum':
    case 'flags':
    case 'struct':
    case 'array':
      o.rt('Fixed');
      return `${e}.write(w, ${p})?;`;
    case 'message':
      o.rt('Packed');
      return `${e}.encode(w)?;`;
    case 'record':
      return `${e}.encode(w)?;`;
    case 'str':
      return `w.str16(${owned ? `&${e}` : e}, ${t.max}, ${p})?;`;
    case 'bytes':
      return `w.len_bytes(${owned ? `&${e}` : e}, ${t.lenWidth}, ${t.max}, ${p})?;`;
    case 'list':
      if (owned) {
        if (t.of.k === 'str')
          return `w.count(${e}.len(), ${t.countWidth}, ${t.max}, ${p})?; for x in &${e} { w.str16(x, ${t.of.max}, ${p})?; }`;
        if (t.of.k === 'record')
          return `w.count(${e}.len(), ${t.countWidth}, ${t.max}, ${p})?; for x in &${e} { x.encode(w)?; }`;
        o.rt('write_vec');
        return `write_vec(w, &${e}, ${t.countWidth}, ${t.max}, ${p})?;`;
      }
      if (fixedSize(t.of) !== null && t.of.k !== 'message')
        return `w.count(${e}.len(), ${t.countWidth}, ${t.max}, ${p})?; ${e}.write(w, ${p})?;`;
      return `w.count(${e}.len(), ${t.countWidth}, ${t.max}, ${p})?; ${e}.write(w)?;`;
    case 'blob_or_bytes':
      return `${e}.write(w, ${t.max}, ${p})?;`;
    case 'counted':
    case 'rest':
      if (isU8(t.of)) return `w.bytes(${e});`;
      if (fixedSize(t.of) !== null && t.of.k !== 'message') return `${e}.write(w, ${p})?;`;
      return `${e}.write(w)?;`;
  }
}

/** `e` as a method receiver: `*x` needs parentheses. */
function recv(e: string): string {
  return e.startsWith('*') ? `(${e})` : e;
}

/** Statements that dump a value `e` under the path expression `path` (a `&str`). */
function rsDump(o: RsOut, t: Ty, e: string, path: string, owned: boolean): string {
  switch (t.k) {
    case 'scalar':
      if (t.s === 'bool') return `d.bool(${path}, ${e});`;
      if (isFloat(t.s)) return `d.${t.s}(${path}, ${e});`;
      return `d.int(${path}, i128::from(${e}));`;
    case 'id':
      return `d.int(${path}, i128::from(${recv(e)}.0));`;
    case 'enum':
      return `d.int(${path}, i128::from(${recv(e)}.value()));`;
    case 'flags':
      return `d.int(${path}, i128::from(${recv(e)}.bits()));`;
    case 'struct':
    case 'message':
    case 'record':
      return `${recv(e)}.dump(d, &format!("{}.", ${path}));`;
    case 'array':
      if (isU8(t.of)) return `d.bytes(${path}, &${e});`;
      return `for (i, x) in ${recv(e)}.iter().enumerate() { ${rsDump(o, t.of, '*x', `&format!("{}[{i}]", ${path})`, owned)} }`;
    case 'str':
      return `d.str(${path}, ${e.startsWith('*') ? e.slice(1) : `&${e}`});`;
    case 'bytes':
      return `d.bytes(${path}, ${e.startsWith('*') ? e.slice(1) : `&${e}`});`;
    case 'blob_or_bytes':
      return `${recv(e)}.dump(d, ${path});`;
    case 'list':
    case 'counted':
    case 'rest': {
      if (t.k !== 'list' && isU8(t.of)) return `d.bytes(${path}, ${e});`;
      const len = `d.int(&format!("{}.len", ${path}), ${recv(e)}.len() as i128);`;
      const ip = `&format!("{}[{i}]", ${path})`;
      if (owned && t.k === 'list') {
        if (t.of.k === 'str')
          return `${len} for (i, x) in ${recv(e)}.iter().enumerate() { d.str(${ip}, x); }`;
        return `${len} for (i, x) in ${recv(e)}.iter().enumerate() { ${rsDump(o, t.of, '*x', ip, true)} }`;
      }
      if (fixedSize(t.of) !== null && t.of.k !== 'message')
        return `${len} for (i, x) in ${recv(e)}.iter().enumerate() { ${rsDump(o, t.of, 'x', ip, false)} }`;
      return `${len} let mut i = 0usize; ${recv(e)}.for_each(|x| { ${rsDump(o, t.of, '*x', ip, false)} i += 1; });`;
    }
  }
}

function rangeCheck(o: RsOut, f: Field, v: string, p: string, at: string): string {
  const t = f.ty;
  const raw = t.k === 'id' ? `${v}.0` : t.k === 'enum' ? `${v}.value()` : v;
  const out: string[] = [];
  if (f.range) {
    o.rt('ErrorKind');
    out.push(
      `if !(${f.range[0]}..=${f.range[1]}).contains(&${raw}) { return Err(r.err_at(${at}, ErrorKind::Range, ${p})); }`,
    );
  }
  if (f.allowed) {
    o.rt('ErrorKind');
    out.push(
      `if !matches!(${raw}, ${f.allowed.join(' | ')}) { return Err(r.err_at(${at}, ErrorKind::Range, ${p})); }`,
    );
  }
  return out.join('\n');
}
function rangeCheckEnc(o: RsOut, f: Field, v: string, p: string): string {
  const t = f.ty;
  const raw = t.k === 'id' ? `${v}.0` : t.k === 'enum' ? `${v}.value()` : v;
  const out: string[] = [];
  if (f.range) {
    o.rt('ErrorKind', 'enc_err');
    out.push(
      `if !(${f.range[0]}..=${f.range[1]}).contains(&${raw}) { return Err(enc_err(ErrorKind::Range, ${p})); }`,
    );
  }
  if (f.allowed) {
    o.rt('ErrorKind', 'enc_err');
    out.push(
      `if !matches!(${raw}, ${f.allowed.join(' | ')}) { return Err(enc_err(ErrorKind::Range, ${p})); }`,
    );
  }
  return out.join('\n');
}

function fieldPath(owner: string, f: Field): string {
  return rsStr(`${owner}.${f.name}`);
}

// ------------------------------------------------------------------------------------------- declarations

export function emitId(o: RsOut, d: IdDecl): void {
  o.rt('Fixed', 'Reader', 'Writer', 'DResult', 'EResult');
  const none =
    d.none !== undefined
      ? `/// The value that means "none".\npub const NONE: Self = Self(${d.none});\n/// Whether this is the "none" value.\npub const fn is_none(self) -> bool { self.0 == ${d.none} }\n`
      : '';
  o.push(`${rsDoc(d.doc)}#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(transparent)]
pub struct ${d.name}(pub ${d.base});

impl ${d.name} {
${none}}

impl Default for ${d.name} {
    fn default() -> Self { Self(0) }
}

impl Fixed for ${d.name} {
    const SIZE: usize = ${SCALAR_SIZE[d.base]};
    fn read(r: &mut Reader<'_>, field: &'static str) -> DResult<Self> { Ok(Self(r.${d.base}(field)?)) }
    fn write(&self, w: &mut Writer<'_>, _field: &'static str) -> EResult { w.${d.base}(self.0); Ok(()) }
}
`);
}

export function enumVariant(name: string): string {
  return pascal(name);
}

export function emitEnum(o: RsOut, d: EnumDecl): void {
  o.rt('Fixed', 'Reader', 'Writer', 'DResult', 'EResult', 'ErrorKind');
  const vs = d.values;
  const first = vs[0] as { name: string };
  o.push(`${rsDoc(d.doc)}#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(${d.base})]
pub enum ${d.name} {
${vs.map((v) => `    ${enumVariant(v.name)} = ${v.value},`).join('\n')}
}

impl Default for ${d.name} {
    fn default() -> Self { Self::${enumVariant(first.name)} }
}

impl ${d.name} {
    /// Every value, in declaration order.
    pub const ALL: [Self; ${vs.length}] = [${vs.map((v) => `Self::${enumVariant(v.name)}`).join(', ')}];

    /// The value on the wire.
    pub const fn value(self) -> ${d.base} { self as ${d.base} }

    /// The value with this number, if the schema declares one.
    pub const fn from_value(v: ${d.base}) -> Option<Self> {
        match v {
${vs.map((v) => `            ${v.value} => Some(Self::${enumVariant(v.name)}),`).join('\n')}
            _ => None,
        }
    }

    /// The schema's name of the value.
    pub const fn name(self) -> &'static str {
        match self {
${vs.map((v) => `            Self::${enumVariant(v.name)} => ${rsStr(v.name)},`).join('\n')}
        }
    }

    /// The value with this schema name.
    pub fn from_name(s: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|v| v.name() == s)
    }${
      d.developer.length
        ? `

    /// Whether this is a developer value: no player-facing text and no sound (§15.6).
    pub const fn is_developer(self) -> bool {
        matches!(self, ${d.developer.map((n) => `Self::${enumVariant(n)}`).join(' | ')})
    }`
        : ''
    }
}

impl TryFrom<${d.base}> for ${d.name} {
    type Error = ${d.base};
    fn try_from(v: ${d.base}) -> Result<Self, ${d.base}> { Self::from_value(v).ok_or(v) }
}

impl Fixed for ${d.name} {
    const SIZE: usize = ${SCALAR_SIZE[d.base]};
    fn read(r: &mut Reader<'_>, field: &'static str) -> DResult<Self> {
        let at = r.pos();
        let v = r.${d.base}(field)?;
        Self::from_value(v).ok_or_else(|| r.err_at(at, ErrorKind::BadEnum, field))
    }
    fn write(&self, w: &mut Writer<'_>, _field: &'static str) -> EResult { w.${d.base}(self.value()); Ok(()) }
}
`);
}

export function emitFlags(o: RsOut, d: FlagsDecl): void {
  o.rt('Fixed', 'Reader', 'Writer', 'DResult', 'EResult', 'ErrorKind');
  const all = d.bits.reduce((a, b) => a | (1n << BigInt(b.bit)), 0n);
  o.push(`${rsDoc(d.doc)}#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(transparent)]
pub struct ${d.name}(${d.base});

impl ${d.name} {
${d.bits.map((b) => `    pub const ${upperSnake(b.name)}: Self = Self(1 << ${b.bit});`).join('\n')}
    /// Every declared bit.
    pub const ALL: Self = Self(${all});
    /// No bits.
    pub const EMPTY: Self = Self(0);

    pub const fn bits(self) -> ${d.base} { self.0 }
    /// The flags with these bits, if every bit is declared.
    pub const fn from_bits(v: ${d.base}) -> Option<Self> { if v & !Self::ALL.0 == 0 { Some(Self(v)) } else { None } }
    /// The flags with these bits, declared or not (tests and fixtures; decoders refuse undeclared bits).
    pub const fn from_bits_retain(v: ${d.base}) -> Self { Self(v) }
    pub const fn contains(self, other: Self) -> bool { self.0 & other.0 == other.0 }
    pub const fn union(self, other: Self) -> Self { Self(self.0 | other.0) }
    pub const fn difference(self, other: Self) -> Self { Self(self.0 & !other.0) }
    /// These flags with \`other\` set or cleared.
    pub const fn with(self, other: Self, on: bool) -> Self { if on { self.union(other) } else { self.difference(other) } }
}

impl core::ops::BitOr for ${d.name} {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self { self.union(rhs) }
}

impl Fixed for ${d.name} {
    const SIZE: usize = ${SCALAR_SIZE[d.base]};
    fn read(r: &mut Reader<'_>, field: &'static str) -> DResult<Self> {
        let at = r.pos();
        let v = r.${d.base}(field)?;
        Self::from_bits(v).ok_or_else(|| r.err_at(at, ErrorKind::BadFlags, field))
    }
    fn write(&self, w: &mut Writer<'_>, _field: &'static str) -> EResult { w.${d.base}(self.0); Ok(()) }
}
`);
}

function derives(fields: readonly Field[], copy: boolean, owned: boolean): string {
  const eq = fields.every((f) => tyEq(f.ty));
  const ord = fields.every(
    (f) =>
      f.ty.k !== 'message' &&
      f.ty.k !== 'blob_or_bytes' &&
      !(f.ty.k === 'list' && !owned) &&
      f.ty.k !== 'counted' &&
      f.ty.k !== 'rest',
  );
  return `#[derive(Clone${copy ? ', Copy' : ''}, Debug, PartialEq${eq ? ', Eq' : ''}${ord ? ', PartialOrd' : ''})]`;
}

/** The default value expression of a field's type (its `default` attribute when it has one). */
function rsDefault(o: RsOut, f: Field | null, t: Ty, owned: boolean): string {
  const dv = f?.default;
  if (dv !== undefined) {
    if (typeof dv === 'boolean') return String(dv);
    switch (t.k) {
      case 'scalar':
        return isFloat(t.s) ? rsFloat(t.s, dv) : `${dv}`;
      case 'id':
        return `${o.t(t.d)}(${dv})`;
      case 'enum': {
        const v = t.d.values.find((x) => x.value === dv);
        if (!v) throw new Error(`${f?.name}: default ${dv} is not a ${t.d.name}`);
        return `${o.t(t.d)}::${enumVariant(v.name)}`;
      }
      default:
        throw new Error(`${f?.name}: default on ${t.k}`);
    }
  }
  switch (t.k) {
    case 'scalar':
      return t.s === 'bool' ? 'false' : isFloat(t.s) ? '0.0' : '0';
    case 'array':
      return `[${rsDefault(o, null, t.of, owned)}; ${t.n}]`;
    case 'str':
      return owned ? 'String::new()' : '""';
    case 'bytes':
      return owned ? 'Vec::new()' : '&[]';
    case 'list':
      return owned ? 'Vec::new()' : `${rsType(o, t, false).replace(/<.*$/, '')}::default()`;
    case 'counted':
    case 'rest':
      return isU8(t.of) ? '&[]' : `${rsType(o, t, false).replace(/<.*$/, '')}::default()`;
    case 'blob_or_bytes':
      return 'BlobOrBytes::default()';
    case 'message':
    case 'record':
    case 'id':
    case 'enum':
    case 'flags':
    case 'struct':
      return `${o.t(t.d)}::default()`;
  }
}

export function rsFloat(s: Scalar, v: number): string {
  const dv = new DataView(new ArrayBuffer(8));
  if (s === 'f32') {
    dv.setFloat32(0, v, true);
    return `f32::from_bits(0x${dv.getUint32(0, true).toString(16).padStart(8, '0')})`;
  }
  dv.setFloat64(0, v, true);
  return `f64::from_bits(0x${dv.getBigUint64(0, true).toString(16).padStart(16, '0')})`;
}

function structFieldsDecl(o: RsOut, fields: readonly Field[], owned: boolean): string {
  return valueFields(fields)
    .map((f) => {
      let ty = rsType(o, f.ty, owned);
      if (f.when) ty = `Option<${ty}>`;
      return `${rsDoc(f.doc, '    ')}    pub ${rsIdent(f.name)}: ${ty},`;
    })
    .join('\n');
}

function dumpBody(o: RsOut, fields: readonly Field[], owned: boolean): string {
  return valueFields(fields)
    .map((f) => {
      const path = `&format!("{prefix}${f.name}")`;
      const e = `self.${rsIdent(f.name)}`;
      if (f.when) return `if let Some(x) = &${e} { ${rsDump(o, f.ty, '*x', path, owned)} }`;
      return rsDump(o, f.ty, e, path, owned);
    })
    .join('\n');
}

export function emitStruct(o: RsOut, d: StructDecl): void {
  o.rt('Fixed', 'Reader', 'Writer', 'DResult', 'EResult', 'Dump');
  const name = d.name;
  const reads: string[] = [];
  const writes: string[] = [];
  for (const f of d.fields) {
    const p = fieldPath(name, f);
    if (f.reserved) {
      reads.push(`r.zeros(${fixedSize(f.ty)}, ${p})?;`);
      writes.push(`w.zeros(${fixedSize(f.ty)});`);
      continue;
    }
    const needAt = !!(f.range || f.allowed);
    if (needAt) reads.push(`let at_${f.name} = r.pos();`);
    reads.push(`let f_${f.name} = ${rsRead(o, f.ty, p, false, d.fields)};`);
    if (needAt) reads.push(rangeCheck(o, f, `f_${f.name}`, p, `at_${f.name}`));
    const pre = rangeCheckEnc(o, f, `self.${rsIdent(f.name)}`, p);
    if (pre) writes.push(pre);
    writes.push(rsWrite(o, f.ty, `self.${rsIdent(f.name)}`, p, false));
  }
  const init = valueFields(d.fields)
    .map((f) => `${rsIdent(f.name)}: f_${f.name}`)
    .join(', ');
  let check = '';
  let checkW = '';
  let impl = '';
  if (d.check === 'entity_ref') {
    o.rt('ErrorKind', 'enc_err');
    const tag = d.fields.find((f) => f.name === 'tag') as Field;
    const tagT = (tag.ty as { d: EnumDecl }).d.name;
    o.t(tag.ty.k === 'enum' ? tag.ty.d : (undefined as never));
    impl = `impl ${name} {
    /// Tag 0 has a and b zero; tag 1 names a serial (not 0) with b zero; tag 2 is a creation id (§15.3).
    pub const fn is_well_formed(&self) -> bool {
        match self.tag {
            ${tagT}::None => self.a == 0 && self.b == 0,
            ${tagT}::Serial => self.a != 0 && self.b == 0,
            ${tagT}::Creation => true,
        }
    }
}
`;
    check = `if !v.is_well_formed() { return Err(r.err_at(start, ErrorKind::BadRef, ${rsStr(name)})); }`;
    checkW = `if !self.is_well_formed() { return Err(enc_err(ErrorKind::BadRef, ${rsStr(name)})); }`;
  }
  const copy = true;
  const offsets = d.fields
    .filter((f) => !f.reserved)
    .map((f) => `    pub const OFFSET_${upperSnake(f.name)}: usize = ${f.offset};`)
    .join('\n');
  o.push(`${rsDoc(d.doc)}${derives(d.fields, copy, false)}
pub struct ${name} {
${structFieldsDecl(o, d.fields, false)}
}

impl ${name} {
    /// The encoded size in bytes.
    pub const SIZE: usize = ${d.size};
${offsets}

    /// Appends the text dump of the fields (test/fixtures/codec), each path prefixed by \`prefix\`.
    pub fn dump(&self, d: &mut Dump, prefix: &str) {
        ${dumpBody(o, d.fields, false) || 'let _ = (d, prefix);'}
    }
}

impl Default for ${name} {
    fn default() -> Self {
        Self { ${valueFields(d.fields)
          .map((f) => `${rsIdent(f.name)}: ${rsDefault(o, f, f.ty, false)}`)
          .join(', ')} }
    }
}
${impl}
impl Fixed for ${name} {
    const SIZE: usize = ${d.size};
    fn read(r: &mut Reader<'_>, _field: &'static str) -> DResult<Self> {
        ${check ? 'let start = r.pos();' : ''}
        ${reads.join('\n        ')}
        ${check ? `let v = Self { ${init} };\n        ${check}\n        Ok(v)` : `Ok(Self { ${init} })`}
    }
    fn write(&self, w: &mut Writer<'_>, _field: &'static str) -> EResult {
        ${checkW}
        ${writes.join('\n        ')}
        Ok(())
    }
}
`);
}

/** Decode statements for a message's fields (reader `r`), binding `f_<name>` locals. */
function messageReads(o: RsOut, owner: string, fields: readonly Field[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const p = fieldPath(owner, f);
    if (f.reserved) {
      out.push(`r.zeros(${fixedSize(f.ty)}, ${p})?;`);
      continue;
    }
    const needAt = !!(f.range || f.allowed);
    if (needAt) out.push(`let at_${f.name} = r.pos();`);
    let read = rsRead(o, f.ty, p, false, fields);
    if (f.when) {
      const flags = fields.find((x) => x.name === f.when?.field) as Field;
      const fd = (flags.ty as { d: FlagsDecl }).d;
      read = `if f_${flags.name}.contains(${o.t(fd)}::${upperSnake(f.when.bit)}) { Some(${read}) } else { None }`;
    }
    out.push(`let f_${f.name} = ${read};`);
    if (needAt) out.push(rangeCheck(o, f, `f_${f.name}`, p, `at_${f.name}`));
  }
  return out;
}

/** Encode statements for a message's fields (writer `w`); count fields come from their arrays. */
function messageWrites(o: RsOut, owner: string, fields: readonly Field[]): string[] {
  const out: string[] = [];
  // Counts first: each hidden count field takes its value from the arrays that name it.
  for (const cf of fields.filter((f) => f.hidden)) {
    const arrays = fields.filter((f) => f.ty.k === 'counted' && f.ty.count === cf.name);
    const s = countTy(cf);
    const first = arrays[0] as Field;
    const ft = first.ty as { minus: number };
    o.rt('count_of');
    const max = cf.range ? `${cf.range[1]}` : `u64::from(${s}::MAX)`;
    const len = ft.minus
      ? `if self.${rsIdent(first.name)}.is_empty() { 0 } else { self.${rsIdent(first.name)}.len() + ${ft.minus} }`
      : `self.${rsIdent(first.name)}.len()`;
    out.push(`let f_${cf.name} = count_of(${len}, ${max}, ${fieldPath(owner, cf)})? as ${s};`);
    if (cf.range && cf.range[0] > 0) o.rt('ErrorKind', 'enc_err');
    if (cf.range && cf.range[0] > 0)
      out.push(
        `if f_${cf.name} < ${cf.range[0]} { return Err(enc_err(ErrorKind::Range, ${fieldPath(owner, cf)})); }`,
      );
    for (const a of arrays) {
      const m = (a.ty as { minus: number }).minus;
      const want = m ? `(${toUsize(`f_${cf.name}`, s)}).saturating_sub(${m})` : toUsize(`f_${cf.name}`, s);
      if (a === first && !m) continue;
      o.rt('ErrorKind', 'enc_err');
      out.push(
        `if self.${rsIdent(a.name)}.len() != ${want} { return Err(enc_err(ErrorKind::BadCount, ${fieldPath(owner, a)})); }`,
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
      out.push(rsWrite(o, f.ty, `f_${f.name}`, p, false));
      continue;
    }
    const e = `self.${rsIdent(f.name)}`;
    const pre = rangeCheckEnc(o, f, e, p);
    if (pre) out.push(pre);
    if (f.when) {
      const flags = fields.find((x) => x.name === f.when?.field) as Field;
      const fd = (flags.ty as { d: FlagsDecl }).d;
      o.rt('ErrorKind', 'enc_err');
      out.push(
        `if self.${rsIdent(flags.name)}.contains(${o.t(fd)}::${upperSnake(f.when.bit)}) != ${e}.is_some() { return Err(enc_err(ErrorKind::Inconsistent, ${p})); }`,
      );
      out.push(`if let Some(x) = ${e} { ${rsWrite(o, f.ty, 'x', p, false)} }`);
      continue;
    }
    out.push(rsWrite(o, f.ty, e, p, false));
  }
  return out;
}

export function emitMessage(o: RsOut, d: MessageDecl): void {
  o.rt('Packed', 'Reader', 'Writer', 'DResult', 'EResult', 'Dump');
  const lt = msgLifetime(d);
  const a = lt ? "<'a>" : '';
  const name = d.name;
  const reads = messageReads(o, name, d.fields);
  const writes = messageWrites(o, name, d.fields);
  const init = valueFields(d.fields)
    .map((f) => `${rsIdent(f.name)}: f_${f.name}`)
    .join(', ');
  const copy = d.fields.every((f) => tyCopy(f.ty, false));
  const pad = d.padTo ? `r.pad(start, ${d.padTo}, ${rsStr(`${name}.padding`)})?;` : '';
  const padW = d.padTo ? `w.pad(start, ${d.padTo});` : '';
  const offsets = d.fields
    .filter((f) => !f.reserved && f.offset !== undefined)
    .map((f) => `    pub const OFFSET_${upperSnake(f.name)}: usize = ${f.offset};`)
    .join('\n');
  o.push(
    `${rsDoc(d.doc)}${derives(d.fields, copy, false)}
pub struct ${name}${a} {
${structFieldsDecl(o, d.fields, false)}
}

impl${a} ${name}${a} {
    /// The bytes before the first variable-length field${d.fixed !== null ? ' (the whole record: it is fixed-size)' : ''}.
    pub const PREFIX: usize = ${d.prefix};
${offsets}

    /// Appends the text dump of the fields (test/fixtures/codec), each path prefixed by \`prefix\`.
    pub fn dump(&self, d: &mut Dump, prefix: &str) {
        ${dumpBody(o, d.fields, false) || 'let _ = (d, prefix);'}
    }

    /// Decodes one value that fills \`bytes\` exactly.
    pub fn decode_exact(bytes: &'a [u8]) -> DResult<Self> {
        let mut r = Reader::new(bytes);
        let v = Self::decode(&mut r)?;
        r.finish(${rsStr(name)})?;
        Ok(v)
    }
}

impl Default for ${name}${lt ? "<'_>" : ''} {
    fn default() -> Self {
        Self { ${valueFields(d.fields)
          .map((f) => `${rsIdent(f.name)}: ${f.when ? 'None' : rsDefault(o, f, f.ty, false)}`)
          .join(', ')} }
    }
}

impl<'a> Packed<'a> for ${name}${a} {
    fn decode(${d.fields.length ? 'r' : '_r'}: &mut Reader<'a>) -> DResult<Self> {
        ${d.padTo ? 'let start = r.pos();' : ''}
        ${reads.join('\n        ')}
        ${pad}
        Ok(Self { ${init} })
    }
    fn encode(&self, ${d.fields.length ? 'w' : '_w'}: &mut Writer<'_>) -> EResult {
        ${d.padTo ? 'let start = w.pos();' : ''}
        ${writes.join('\n        ')}
        ${padW}
        Ok(())
    }
}
`.replace(
      "pub fn decode_exact(bytes: &'a [u8])",
      lt ? "pub fn decode_exact(bytes: &'a [u8])" : 'pub fn decode_exact(bytes: &[u8])',
    ),
  );
}

/** Rust for a field-id record (§8.1): owned values; `strict` refuses unknown and missing fields. */
export function emitRecord(o: RsOut, d: RecordDecl): void {
  o.rt('Reader', 'Writer', 'DResult', 'EResult', 'ErrorKind', 'Dump');
  const name = typeName(d);
  const fields = d.fields;
  if (fields.length > 64) throw new Error(`record ${d.name} has more than 64 fields`);
  const arms: string[] = [];
  const writes: string[] = [];
  fields.forEach((f, i) => {
    const p = rsStr(`${d.name}.${f.name}`);
    const e = `out.${rsIdent(f.name)}`;
    const checks: string[] = [];
    if (f.range || f.allowed)
      checks.push(rangeCheck(o, f, `v_${i}`, p, 'at').replaceAll('r.err_at', 'v.err_at'));
    if (f.order === 'key' && f.ty.k === 'list') {
      o.rt('strictly_ascending');
      checks.push(`if !strictly_ascending(&v_${i}) { return Err(v.err_at(at, ErrorKind::Unsorted, ${p})); }`);
    }
    arms.push(
      `${f.id} => { let r = &mut v; let v_${i} = ${rsRead(o, f.ty, p, true, fields)}; ${checks.join(' ')} ${e} = v_${i}; seen |= 1 << ${i}; ${p} }`,
    );
    const se = `self.${rsIdent(f.name)}`;
    const pre = rangeCheckEnc(o, f, se, p);
    const sorted =
      f.order === 'key' && f.ty.k === 'list'
        ? `if !strictly_ascending(&${se}) { return Err(enc_err(ErrorKind::Unsorted, ${p})); }`
        : '';
    if (sorted) o.rt('enc_err');
    writes.push(
      `${pre} ${sorted} w.u16(${f.id}); let at = w.begin_u32(); ${rsWrite(o, f.ty, se, p, true)} w.end_u32(at, ${p})?;`,
    );
  });
  const all = fields.length === 64 ? 'u64::MAX' : `(1u64 << ${fields.length}) - 1`;
  const names = fields.map((f) => rsStr(`${d.name}.${f.name}`)).join(', ');
  o.push(`${rsDoc(d.doc)}${derives(fields, false, true)}
pub struct ${name} {
${structFieldsDecl(o, fields, true)}
}

impl Default for ${name} {
    fn default() -> Self {
        Self { ${fields.map((f) => `${rsIdent(f.name)}: ${rsDefault(o, f, f.ty, true)}`).join(', ')} }
    }
}

impl ${name} {
    /// The field ids, in ascending order.
    pub const FIELD_IDS: [u16; ${fields.length}] = [${fields.map((f) => f.id).join(', ')}];
    const FIELD_NAMES: [&'static str; ${fields.length}] = [${names}];

    /// Decodes one record: \`u32 length\`, then \`(u16 id, u32 length, value)\` triples in ascending id
    /// (§8.1). Strict decoding (ABI inputs) refuses unknown and missing fields; lenient decoding (saves)
    /// skips unknown ids and leaves missing fields at their defaults (§8.3).
    pub fn decode(r: &mut Reader<'_>, strict: bool) -> DResult<Self> {
        let n = r.u32(${rsStr(d.name)})? as usize;
        let mut body = r.sub(n, ${rsStr(d.name)})?;
        let mut out = Self::default();
        let mut last = 0u32;
        let mut seen = 0u64;
        while !body.is_empty() {
            let at = body.pos();
            let id = body.u16(${rsStr(d.name)})?;
            if u32::from(id) <= last {
                return Err(body.err_at(at, ErrorKind::FieldOrder, ${rsStr(d.name)}));
            }
            last = u32::from(id);
            let len = body.u32(${rsStr(d.name)})? as usize;
            let mut v = body.sub(len, ${rsStr(d.name)})?;
            let field: &'static str = match id {
                ${arms.join('\n                ')}
                _ => {
                    if strict {
                        return Err(body.err_at(at, ErrorKind::UnknownField, ${rsStr(d.name)}));
                    }
                    continue;
                }
            };
            v.finish_len(field)?;
        }
        if strict && seen != ${all} {
            let missing = (0..${fields.length}).find(|i| seen & (1 << i) == 0).unwrap_or(0);
            return Err(body.err(ErrorKind::MissingField, Self::FIELD_NAMES[missing]));
        }
        Ok(out)
    }

    /// Encodes the record with every field present, in ascending id (§8.1).
    pub fn encode(&self, w: &mut Writer<'_>) -> EResult {
        let start = w.begin_u32();
        ${writes.join('\n        ')}
        w.end_u32(start, ${rsStr(d.name)})
    }

    /// Decodes one record that fills \`bytes\` exactly.
    pub fn decode_exact(bytes: &[u8], strict: bool) -> DResult<Self> {
        let mut r = Reader::new(bytes);
        let v = Self::decode(&mut r, strict)?;
        r.finish(${rsStr(d.name)})?;
        Ok(v)
    }

    /// Appends the text dump of the fields (test/fixtures/codec), each path prefixed by \`prefix\`.
    pub fn dump(&self, d: &mut Dump, prefix: &str) {
        ${dumpBody(o, fields, true) || 'let _ = (d, prefix);'}
    }
}
`);
}

export function emitDecl(o: RsOut, d: Decl): void {
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
      emitTable(o, d);
      return;
  }
}

// ------------------------------------------------------------------------------------------- tables

/** A pool or the entity table (§4.5): SoA columns, lowest-free-slot allocation, the column-table codec. */
export function emitTable(o: RsOut, d: TableDecl): void {
  o.rt('Reader', 'Writer', 'DResult', 'EResult', 'ErrorKind', 'Fixed', 'enc_err');
  const name = typeName(d);
  const live = d.fields.find((f) => f.name === d.live) as Field;
  const saved = d.fields.filter((f) => f.saved);
  const handles = saved.filter((f) => f.ty.k === 'id' && f.ty.d.name === 'EntityHandle');
  const serialT = handles.length > 0 ? o.t(o.s.decls.get('Serial') as Decl) : '';
  const handleT = handles.length > 0 ? o.t(o.s.decls.get('EntityHandle') as Decl) : '';
  const col = (f: Field) => rsIdent(f.name);
  const ty = (f: Field) => rsType(o, f.ty, true);
  const isZero = (f: Field, e: string) => {
    const s = scalarOf(f.ty) as Scalar;
    if (f.ty.k === 'id') return `${e}.0 == 0`;
    if (s === 'bool') return `!${e}`;
    if (f.ty.k === 'enum' || f.ty.k === 'flags') return `${e} == ${o.t(f.ty.d)}::default()`;
    return isFloat(s) ? `${e} == 0.0` : `${e} == 0`;
  };
  const cols = d.fields.map((f) => `${rsDoc(f.doc, '    ')}    pub ${col(f)}: Vec<${ty(f)}>,`).join('\n');
  const typeCode = (f: Field) => {
    const s = scalarOf(f.ty) as Scalar;
    return { u8: 1, u16: 2, u32: 3, u64: 4, i8: 5, i16: 6, i32: 7, i64: 8, f32: 9, f64: 10, bool: 11 }[s];
  };
  const width = (f: Field) => SCALAR_SIZE[scalarOf(f.ty) as Scalar];
  const savedDir = saved.map((f) => `(${rsStr(f.name)}, ${typeCode(f)}u8, ${width(f)}usize)`).join(', ');
  const writeCol = (f: Field) => {
    if (f.ty.k === 'id' && f.ty.d.name === 'EntityHandle')
      return `for x in &self.${col(f)} { w.u32(serial_of(*x).0); }`;
    return `for x in &self.${col(f)} { x.write(w, ${rsStr(`${d.name}.${f.name}`)})?; }`;
  };
  const readCol = (f: Field) => {
    const p = rsStr(`${d.name}.${f.name}`);
    if (f.ty.k === 'id' && f.ty.d.name === 'EntityHandle')
      return `for _ in 0..rows { let at = c.pos(); let s = ${serialT}(c.u32(${p})?); let h = if s.0 == 0 { ${handleT}(0) } else { handle_of(s).ok_or_else(|| c.err_at(at, ErrorKind::BadRef, ${p}))? }; t.${col(f)}.push(h); }`;
    return `for _ in 0..rows { t.${col(f)}.push(<${ty(f)}>::read(&mut c, ${p})?); }`;
  };
  const defaults = d.fields.map((f) => `self.${col(f)}.push(${rsDefault(o, f, f.ty, true)});`).join(' ');
  const resets = d.fields
    .filter((f) => !f.keep)
    .map((f) => `self.${col(f)}[i] = ${rsDefault(o, f, f.ty, true)};`)
    .join(' ');
  const fill = d.fields
    .filter((f) => !f.saved)
    .map((f) => `t.${col(f)} = vec![${rsDefault(o, f, f.ty, true)}; rows];`)
    .join(' ');
  const floats = d.fields.filter((f) => isFloat(scalarOf(f.ty) as Scalar));
  const nan = floats.length
    ? floats
        .map(
          (f) =>
            `if let Some(i) = self.${col(f)}.iter().position(|x| x.is_nan()) { return Some((${rsStr(`${d.name}.${f.name}`)}, i as u32)); }`,
        )
        .join('\n        ')
    : '';
  const freeCheck = saved
    .map((f, k) => ({ f, k }))
    .filter(({ f }) => !f.keep)
    .map(({ f, k }) => `if self.${col(f)}[i] != ${rsDefault(o, f, f.ty, true)} { return Some((${k}, i)); }`)
    .join(' ');
  const savedPaths = saved.map((f) => rsStr(`${d.name}.${f.name}`)).join(', ');
  const viewCols = d.fields.filter((f) => f.view);
  const handleParamS = handles.length ? `, serial_of: &dyn Fn(${handleT}) -> ${serialT}` : '';
  const handleParamL = handles.length ? `, handle_of: &mut dyn FnMut(${serialT}) -> Option<${handleT}>` : '';
  o.push(`${rsDoc(d.doc)}#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${name} {
${cols}
    /// Live slots, one bit each (derived: rebuilt on load from \`${d.live}\`).
    live: Vec<u32>,
    /// The lowest slot that may be free (derived: an allocation hint).
    first_free: u32,
}

impl ${name} {
    /// The saved columns, in declaration order: name, §8.1 type code, width in bytes.
    pub const SAVED_COLUMNS: [(&'static str, u8, usize); ${saved.length}] = [${savedDir}];
    /// The saved columns' paths in errors, in the same order.
    pub const SAVED_PATHS: [&'static str; ${saved.length}] = [${savedPaths}];
    /// The most rows the table may hold (state.yaml \`max_rows\`).
    pub const MAX_ROWS: usize = ${d.maxRows};

    pub fn new() -> Self {
        Self::default()
    }

    /// The high-water mark: the rows ever used, which saving writes (§4.5).
    pub fn rows(&self) -> u32 {
        self.${col(live)}.len() as u32
    }

    pub fn is_live(&self, slot: u32) -> bool {
        self.live.get(slot as usize / 32).is_some_and(|w| w & (1 << (slot % 32)) != 0)
    }

    /// Allocates the lowest free slot (canonical, so no free list is saved, D8) and returns it, or None when
    /// all MAX_ROWS are live; its columns hold their defaults. The caller sets \`${d.live}\` to make it live.
    pub fn alloc(&mut self) -> Option<u32> {
        let rows = self.rows();
        let mut slot = self.first_free;
        while slot < rows && self.is_live(slot) {
            slot += 1;
        }
        if slot == rows {
            if rows as usize >= Self::MAX_ROWS {
                return None;
            }
            ${defaults}
        }
        let word = slot as usize / 32;
        if self.live.len() <= word {
            self.live.resize(word + 1, 0);
        }
        self.live[word] |= 1 << (slot % 32);
        self.first_free = slot + 1;
        Some(slot)
    }

    /// Frees a slot: every column returns to its default${d.fields.some((f) => f.keep) ? ' except the kept ones' : ''} (§4.5).
    pub fn free(&mut self, slot: u32) {
        let i = slot as usize;
        if !self.is_live(slot) {
            return;
        }
        ${resets}
        self.live[i / 32] &= !(1 << (slot % 32));
        if slot < self.first_free {
            self.first_free = slot;
        }
    }

    /// The first float that is NaN, as (column, slot): D6's scan (builds with simcheck).
    pub fn nan_scan(&self) -> Option<(&'static str, u32)> {
        ${nan || 'None'}${nan ? '\n        None' : ''}
    }

    /// The first free row, in row order, with a saved column off its default${d.fields.some((f) => f.keep) ? ' (kept columns aside)' : ''}, as
    /// (index in SAVED_COLUMNS, row): such a table is not canonical, so it neither saves nor loads (§4.5).
    pub fn first_noncanonical(&self) -> Option<(usize, usize)> {
        for i in 0..self.${col(live)}.len() {
            if self.is_live(i as u32) {
                continue;
            }
            ${freeCheck}
        }
        None
    }

    /// Writes the column table (§8.1): rows, the directory, then each saved column 8-aligned.${handles.length ? ' Handles are written as serials (§4.5).' : ''}
    pub fn save(&self, w: &mut Writer<'_>${handleParamS}) -> EResult {
        if let Some((k, _)) = self.first_noncanonical() {
            return Err(enc_err(ErrorKind::NotCanonical, Self::SAVED_PATHS[k]));
        }
        let base = w.pos();
        let rows = self.${col(live)}.len();
        w.u32(rows as u32);
        w.u16(${saved.length});
        w.u16(0);
        let mut dir = 8usize;
        for (n, _, _) in Self::SAVED_COLUMNS {
            dir += 1 + n.len() + 1 + 1 + 4 + 4;
        }
        let mut at = dir;
        for (n, code, width) in Self::SAVED_COLUMNS {
            at = at.next_multiple_of(8);
            w.u8(n.len() as u8);
            w.bytes(n.as_bytes());
            w.u8(code);
            w.u8(0);
            w.u32(at as u32);
            w.u32((rows * width) as u32);
            at += rows * width;
        }
        ${saved.map((f) => `w.pad(base, 8);\n        ${writeCol(f)}`).join('\n        ')}
        Ok(())
    }

    /// Reads a column table: at most MAX_ROWS rows (else \`too_long\`); columns match by name; a column the
    /// save lacks takes its default (\`since\`, §8.3), except \`${d.live}\`, which a table with rows must carry
    /// (else \`missing_field\`); one the schema lacks is skipped; a type or length that differs is refused
    /// (\`schema_mismatch\`). Free rows must hold their defaults (else \`not_canonical\` at the first such
    /// value, in row order). Nothing is allocated for rows before the live column proves they exist.
    pub fn load(data: &[u8]${handleParamL}) -> DResult<Self> {
        let mut r = Reader::new(data);
        let rows = r.u32(${rsStr(d.name)})? as usize;
        let n = usize::from(r.u16(${rsStr(d.name)})?);
        r.zeros(2, ${rsStr(`${d.name}.reserved`)})?;
        if rows > Self::MAX_ROWS {
            return Err(r.err_at(0, ErrorKind::TooLong, ${rsStr(d.name)}));
        }
        let mut dir: Vec<(&[u8], u8, usize, usize, usize)> = Vec::with_capacity(n);
        for _ in 0..n {
            let at = r.pos();
            let len = usize::from(r.u8(${rsStr(d.name)})?);
            let name = r.take(len, ${rsStr(d.name)})?;
            let code = r.u8(${rsStr(d.name)})?;
            r.zeros(1, ${rsStr(`${d.name}.reserved`)})?;
            let off = r.u32(${rsStr(d.name)})? as usize;
            let bytes = r.u32(${rsStr(d.name)})? as usize;
            if !off.is_multiple_of(8) || off.checked_add(bytes).is_none_or(|e| e > data.len()) {
                return Err(r.err_at(at, ErrorKind::BadLength, ${rsStr(d.name)}));
            }
            if dir.iter().any(|x| x.0 == name) {
                return Err(r.err_at(at, ErrorKind::FieldOrder, ${rsStr(d.name)}));
            }
            dir.push((name, code, off, bytes, at));
        }
        if rows > 0 && !dir.iter().any(|x| x.0 == ${rsStr(d.live)}.as_bytes()) {
            return Err(r.err_at(0, ErrorKind::MissingField, ${rsStr(`${d.name}.${d.live}`)}));
        }
        // The directory first: every column the schema knows must have its type and rows × width bytes.
        let mut col_at: [Option<(usize, usize)>; ${saved.length}] = [None; ${saved.length}];
        for (k, (cname, code, width)) in Self::SAVED_COLUMNS.into_iter().enumerate() {
            let Some(&(_, have, off, bytes, at)) = dir.iter().find(|x| x.0 == cname.as_bytes()) else {
                continue;
            };
            if have != code || rows.checked_mul(width) != Some(bytes) {
                return Err(r.err_at(at, ErrorKind::SchemaMismatch, cname));
            }
            col_at[k] = Some((off, bytes));
        }
        let mut t = Self::default();
        for (k, (cname, _, _)) in Self::SAVED_COLUMNS.into_iter().enumerate() {
            let Some((off, bytes)) = col_at[k] else {
                continue;
            };
            let mut c = Reader::with_base(&data[off..off + bytes], off);
            match cname {
                ${saved.map((f) => `${rsStr(f.name)} => { ${readCol(f)} }`).join('\n                ')}
                _ => {}
            }
        }
        ${saved
          .map(
            (f) =>
              `if t.${col(f)}.len() != rows { t.${col(f)} = vec![${rsDefault(o, f, f.ty, true)}; rows]; }`,
          )
          .join('\n        ')}
        ${fill}
        t.live = vec![0; rows.div_ceil(32)];
        for i in 0..rows {
            if !(${isZero(live, `t.${col(live)}[i]`)}) {
                t.live[i / 32] |= 1 << (i % 32);
            }
        }
        t.first_free = 0;
        if let Some((k, i)) = t.first_noncanonical() {
            let at = col_at[k].map_or(0, |(off, _)| off) + i * Self::SAVED_COLUMNS[k].2;
            return Err(r.err_at(at, ErrorKind::NotCanonical, Self::SAVED_PATHS[k]));
        }
        Ok(t)
    }

    /// The columns the TypeScript read views see (§3.6): (column id, address, byte length) for
    /// \`sim_pool_dir\`; the ids are POOL_COLUMNS' (src/shared/gen/state.ts).
    pub fn view_columns(&self, out: &mut Vec<(u32, usize, usize)>) {
        ${viewCols.map((f) => `out.push((${poolColumnId(o.s, d, f)}, self.${col(f)}.as_ptr() as usize, self.${col(f)}.len() * ${width(f)}));`).join('\n        ') || 'let _ = out;'}
    }
}
`);
}

/** The generated id of a view column: tables in name order, then their view columns in order, from 1. */
export function poolColumnId(s: Schema, t: TableDecl, f: Field): number {
  let id = 1;
  for (const name of s.names) {
    const d = s.decls.get(name) as Decl;
    if (d.kind !== 'table') continue;
    for (const c of d.fields) {
      if (!c.view) continue;
      if (d === t && c === f) return id;
      id++;
    }
  }
  throw new Error(`${t.name}.${f.name} is not a view column`);
}

// ------------------------------------------------------------------------------------------- modules

/** The `use` lines a module needs: declarations from other modules, and the codec runtime. */
export function rsUses(o: RsOut, crate: 'schema' | 'sim' | 'test', body = ''): string {
  const byMod = new Map<string, Set<string>>();
  for (const name of o.uses) {
    const d = o.s.decls.get(name);
    if (!d) continue;
    const m = homeMod(d);
    if (m === o.mod) continue;
    const isSim = SIM_MODS.includes(m);
    const path =
      crate === 'schema'
        ? `crate::${m}`
        : !isSim
          ? 'schema'
          : crate === 'sim'
            ? `super::${simFile(m)}`
            : 'sim::r#gen';
    const set = byMod.get(path) ?? new Set<string>();
    set.add(typeName(d));
    byMod.set(path, set);
  }
  const lines: string[] = [];
  // Runtime items the body names (a trait counts when its methods are called on a value).
  const names = [...o.runtime]
    .filter((n) => body === '' || n === 'Fixed' || n === 'Packed' || new RegExp(`\\b${n}\\b`).test(body))
    .sort();
  if (names.length > 0) {
    const path = crate === 'schema' ? 'crate::codec' : 'schema::codec';
    lines.push(`use ${path}::{${names.join(', ')}};`);
  }
  for (const [path, names] of [...byMod.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
    lines.push(`use ${path}::{${[...names].sort().join(', ')}};`);
  return lines.join('\n');
}

export function isIntTy(t: Ty): boolean {
  const s = scalarOf(t);
  return s !== null && isInt(s) && t.k !== 'enum' && t.k !== 'flags';
}
