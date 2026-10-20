// Module extras of the Rust output: the code each module needs beyond its declarations. Actions: the
// Action enum, its decoder and encoder, and the closure preflight (§15.3). Events: the payload enum and the
// EVENTS record writer (§15.6). Packet: the builder, the chunk keys and the held set (§15.4). Projections:
// the UI record writer and kind facts (§15.5). Container: closure logs (§8.5). ABI: the export table, the
// traits and the export macros (§15.8). Capabilities: the current manifest as code.
import { canonicalJson, sortedEntries } from '../lib/canonical.ts';
import type { Capabilities } from './capabilities.ts';
import {
  type Decl,
  type EnumDecl,
  type Field,
  fixedSize,
  type MessageDecl,
  pascal,
  type Schema,
  type StructDecl,
  typeName,
  upperSnake,
} from './model.ts';
import { enumVariant, msgLifetime, type RsMod, type RsOut, rsStr } from './rust.ts';
import { rustProtos } from './rust-protos.ts';
import { rustSections } from './rust-sections.ts';

export function rustExtras(s: Schema, caps: Capabilities, outs: Map<RsMod, RsOut>): void {
  const out = (m: RsMod) => outs.get(m) as RsOut;
  actions(s, out('actions'));
  events(s, out('events'));
  packet(s, out('packet'));
  projections(s, out('projections'));
  container(s, out('container'));
  abi(s, out('abi'));
  rustProtos(s, out('protos'));
  registries(s, out('registries'));
  capabilities(s, caps, out('capabilities'));
  rustSections(s, out('sections'), out('pools'));
}

const decl = (s: Schema, n: string) => s.decls.get(n) as Decl;

// ------------------------------------------------------------------------------------------- actions

function actions(s: Schema, o: RsOut): void {
  o.rt(
    'Reader',
    'Writer',
    'DResult',
    'EResult',
    'ErrorKind',
    'DecodeError',
    'Packed',
    'Dump',
    'enc_err',
    'Fixed',
  );
  const at = o.t(decl(s, 'ActionType'));
  const pi = o.t(decl(s, 'PlayerIndex'));
  const L = s.actionLimits;
  const lt = s.actions.some((a) => msgLifetime(a.msg));
  const variant = (n: string) => pascal(n);
  const ty = (a: (typeof s.actions)[number]) => `${o.t(a.msg)}${msgLifetime(a.msg) ? "<'a>" : ''}`;
  const blobs = s.actions.filter((a) => a.msg.fields.some((f) => f.ty.k === 'blob_or_bytes'));
  o.rt('BlobOrBytes');
  o.push(
    `/// The largest action payload (§15.3): an encoded action (4 + payload) fits every u16 length.
pub const PAYLOAD_MAX: usize = ${L.payload_max};
/// CLOSURE_MAX (§15.3).
pub const CLOSURE_MAX: usize = ${L.closure_max};
/// Bytes of every tick reserved for system actions (admission, §15.3).
pub const SYSTEM_RESERVE: usize = ${L.system_reserve};
/// Player indices are 0 to PLAYERS − 1 (11 §6.5).
pub const PLAYERS: usize = ${L.players};
/// Type ids from here are system actions.
pub const SYSTEM_TYPE_MIN: u16 = ${L.system_type_min};
/// The "player" of system batches.
pub const SYSTEM_PLAYER: ${pi} = ${pi}(0xFFFF);

/// A decoded action (§15.3): one variant per type in actions.yaml, borrowing from the closure.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action${lt ? "<'a>" : ''} {
${s.actions.map((a) => `    ${variant(a.name)}(${ty(a)}),`).join('\n')}
}

impl${lt ? "<'a>" : ''} Action${lt ? "<'a>" : ''} {
    /// The action's type.
    pub const fn action_type(&self) -> ${at} {
        match self {
${s.actions.map((a) => `            Self::${variant(a.name)}(_) => ${at}::${enumVariant(a.name)},`).join('\n')}
        }
    }

    /// Decodes a payload of type \`ty\`, checking everything the schema declares (§15.3): a known type, a
    /// length that matches, enum values, EntityRef tags, bools, reserved fields, maxima and UTF-8. A failure
    /// is the reason \`malformed\`.
    pub fn decode(ty: u16, payload: &'a [u8]) -> DResult<Self> {
        let Some(t) = ${at}::from_value(ty) else {
            return Err(DecodeError { kind: ErrorKind::UnknownType, field: "Action", at: 0 });
        };
        let mut r = Reader::new(payload);
        let a = match t {
${s.actions.map((a) => `            ${at}::${enumVariant(a.name)} => Self::${variant(a.name)}(${o.t(a.msg)}::decode(&mut r)?),`).join('\n')}
        };
        r.finish("Action")?;
        Ok(a)
    }

    /// Encodes the payload (without the action header).
    pub fn encode(&self, w: &mut Writer<'_>) -> EResult {
        match self {
${s.actions.map((a) => `            Self::${variant(a.name)}(x) => x.encode(w),`).join('\n')}
        }
    }

    /// Encodes the action: \`u16 type, u16 len\`, then the payload (§15.3).
    pub fn encode_framed(&self, w: &mut Writer<'_>) -> EResult {
        w.u16(self.action_type().value());
        let len_at = w.pos();
        w.u16(0);
        let start = w.pos();
        self.encode(w)?;
        let n = w.pos() - start;
        if n > PAYLOAD_MAX {
            return Err(enc_err(ErrorKind::TooLong, "Action"));
        }
        w.patch_u16(len_at, n as u16);
        Ok(())
    }

    /// The held-input actions (D22), whose payload starts with the input generation.
    pub const fn is_held(t: ${at}) -> bool {
        matches!(t, ${
          s.actions
            .filter((a) => a.held)
            .map((a) => `${at}::${enumVariant(a.name)}`)
            .join(' | ') || 'never_held_placeholder'
        })
    }

    /// The input generation of a held-input action.
    pub const fn input_gen(&self) -> Option<u16> {
        match self {
${s.actions
  .filter((a) => a.held)
  .map((a) => `            Self::${variant(a.name)}(x) => Some(x.input_gen),`)
  .join('\n')}
            _ => None,
        }
    }

    /// The action with its input generation set (the sequencer stamps it, §15.3); others are unchanged.
    #[must_use]
    pub const fn with_input_gen(self, g: u16) -> Self {
        match self {
${s.actions
  .filter((a) => a.held)
  .map(
    (a) => `            Self::${variant(a.name)}(mut x) => { x.input_gen = g; Self::${variant(a.name)}(x) }`,
  )
  .join('\n')}
            other => other,
        }
    }

    /// The blob a \`blob_or_bytes\` field names, if any (§15.3).
    pub const fn blob(&self) -> Option<[u8; 32]> {
        match self {
${blobs
  .map((a) => {
    const f = a.msg.fields.find((x) => x.ty.k === 'blob_or_bytes') as Field;
    return `            Self::${variant(a.name)}(x) => match x.${f.name} { BlobOrBytes::Blob(h) => Some(h), BlobOrBytes::Bytes(_) => None },`;
  })
  .join('\n')}
            _ => None,
        }
    }

    /// Appends the text dump (test/fixtures/codec): the type's name, then the payload's fields.
    pub fn dump(&self, d: &mut Dump) {
        d.line("type", self.action_type().name());
        match self {
${s.actions.map((a) => `            Self::${variant(a.name)}(x) => x.dump(d, ""),`).join('\n')}
        }
    }
}

/// Why a closure failed the preflight (§15.3): a sequencer, codec or shell bug, which the shell treats like
/// a trap. \`Framing\` is ERR_FRAMING, \`BlobMissing\` ERR_BLOB_MISSING.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreflightError {
    Framing { at: usize, reason: &'static str },
    BlobMissing { at: usize },
}

/// What the preflight counted.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ClosureSummary {
    pub batches: u32,
    pub actions: u32,
}

/// One action of a closure that passed the preflight, in execution order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClosureAction<'a> {
    /// The offset of the action's frame (\`u16 type, u16 len\`) in the closure.
    pub at: usize,
    pub player: ${pi},
    pub seq: u32,
    pub system: bool,
    pub ty: u16,
    pub payload: &'a [u8],
}

const fn framing(at: usize, reason: &'static str) -> PreflightError {
    PreflightError::Framing { at, reason }
}

fn le16(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn le32(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// The framing rules of the preflight (§15.3 rules 1–3) over a closure stamped \`tick\`: the closure is at
/// most CLOSURE_MAX bytes and its batches consume exactly its bytes; every batch has this
/// ACTION_SCHEMA_VERSION, only the SYSTEM flag, a zero reserved field, this tick, a count of at least 1,
/// and a player 0–31 (0xFFFF exactly when SYSTEM); every action's header and payload lie inside the
/// closure, and its type id is from 0xFF00 exactly when the batch is a system batch. \`batch\` sees each
/// batch (offset, system, player, first seq, count) after these checks and may refuse it; \`action\` sees
/// each action (offset, action) and may refuse it.
fn walk<'a>(
    closure: &'a [u8],
    tick: u32,
    mut batch: impl FnMut(usize, bool, u16, u32, u16) -> Result<(), PreflightError>,
    mut action: impl FnMut(usize, ClosureAction<'a>) -> Result<(), PreflightError>,
) -> Result<ClosureSummary, PreflightError> {
    if closure.len() > CLOSURE_MAX {
        return Err(framing(0, "closure larger than CLOSURE_MAX"));
    }
    let mut sum = ClosureSummary::default();
    let mut at = 0usize;
    while at < closure.len() {
        if closure.len() - at < 16 {
            return Err(framing(at, "truncated batch header"));
        }
        let version = closure[at];
        let flags = closure[at + 1];
        let player = le16(closure, at + 2);
        let btick = le32(closure, at + 4);
        let first = le32(closure, at + 8);
        let count = le16(closure, at + 12);
        let reserved = le16(closure, at + 14);
        if version != crate::ACTION_SCHEMA_VERSION {
            return Err(framing(at, "batch version is not ACTION_SCHEMA_VERSION"));
        }
        if flags & !1 != 0 || reserved != 0 {
            return Err(framing(at, "batch flags or reserved field not zero"));
        }
        if btick != tick {
            return Err(framing(at, "batch tick is not the tick being run"));
        }
        if count == 0 {
            return Err(framing(at, "empty batch"));
        }
        let system = flags & 1 != 0;
        if system != (player == 0xFFFF) || (!system && usize::from(player) >= PLAYERS) {
            return Err(framing(at, "batch player out of range"));
        }
        batch(at, system, player, first, count)?;
        sum.batches += 1;
        at += 16;
        let mut seq = first;
        for _ in 0..count {
            if closure.len() - at < 4 {
                return Err(framing(at, "truncated action header"));
            }
            let ty = le16(closure, at);
            let len = usize::from(le16(closure, at + 2));
            if closure.len() - at - 4 < len {
                return Err(framing(at, "action payload runs past the closure"));
            }
            if (ty >= SYSTEM_TYPE_MIN) != system {
                return Err(framing(at, "system action outside a system batch, or the reverse"));
            }
            let payload = &closure[at + 4..at + 4 + len];
            action(at, ClosureAction { at, player: ${pi}(player), seq, system, ty, payload })?;
            sum.actions += 1;
            seq = seq.wrapping_add(1);
            at += 4 + len;
        }
    }
    Ok(sum)
}

/// The preflight's framing rules alone (rules 1–3, see \`walk\`), for a closure stamped \`tick\`: what a closure
/// log's reader checks of each record before it walks the actions (§8.5, C1b-r1 finding 5). A closure that
/// passes may be walked with ClosureIter.
pub fn check_framing(closure: &[u8], tick: u32) -> Result<ClosureSummary, PreflightError> {
    walk(closure, tick, |_, _, _, _, _| Ok(()), |_, _| Ok(()))
}

/// The preflight (§15.3, B1-r1 9): checks the whole closure of tick \`tick\` with temporary watermarks, and
/// changes nothing. \`last_seq[p]\` is player p's saved last_seq (0 for a player without state);
/// \`has_blob\` says whether a blob was supplied (sim_blob_put). Every structural rule:
/// 1–3. the framing rules (\`walk\`);
/// 4. seqs rise (D21): each batch's first seq is above its player's watermark, and first + count − 1 does
///    not pass u32::MAX;
/// 5. every blob named by an action that decodes has been supplied.
pub fn preflight(
    closure: &[u8],
    tick: u32,
    last_seq: &[u32; PLAYERS],
    last_system_seq: u32,
    has_blob: &dyn Fn(&[u8; 32]) -> bool,
) -> Result<ClosureSummary, PreflightError> {
    let mut marks = *last_seq;
    let mut system_mark = last_system_seq;
    walk(
        closure,
        tick,
        |at, system, player, first, count| {
            let mark = if system { &mut system_mark } else { &mut marks[usize::from(player)] };
            if first <= *mark {
                return Err(framing(at, "seqs do not rise (D21)"));
            }
            let Some(last) = first.checked_add(u32::from(count) - 1) else {
                return Err(framing(at, "seq range passes u32::MAX"));
            };
            *mark = last;
            Ok(())
        },
        |at, a| {
            if let Ok(act) = Action::decode(a.ty, a.payload) {
                if let Some(h) = act.blob() {
                    if !has_blob(&h) {
                        return Err(PreflightError::BlobMissing { at });
                    }
                }
            }
            Ok(())
        },
    )
}

/// Iterates the actions of a closure that passed the preflight or \`check_framing\`, in execution order
/// (§15.3). On any other closure it stops early, but never panics.
#[derive(Clone, Debug)]
pub struct ClosureIter<'a> {
    closure: &'a [u8],
    at: usize,
    player: ${pi},
    system: bool,
    seq: u32,
    left: u16,
}

impl<'a> ClosureIter<'a> {
    pub const fn new(closure: &'a [u8]) -> Self {
        Self { closure, at: 0, player: ${pi}(0), system: false, seq: 0, left: 0 }
    }
}

impl<'a> Iterator for ClosureIter<'a> {
    type Item = ClosureAction<'a>;
    fn next(&mut self) -> Option<Self::Item> {
        let b = self.closure;
        if self.left == 0 {
            if self.at + 16 > b.len() {
                return None;
            }
            self.system = b[self.at + 1] & 1 != 0;
            self.player = ${pi}(le16(b, self.at + 2));
            self.seq = le32(b, self.at + 8);
            self.left = le16(b, self.at + 12);
            self.at += 16;
            if self.left == 0 {
                // An empty batch breaks rule 2: a closure that passed the framing has none.
                self.at = b.len();
                return None;
            }
        }
        if self.at + 4 > b.len() {
            return None;
        }
        let ty = le16(b, self.at);
        let len = usize::from(le16(b, self.at + 2));
        let payload = b.get(self.at + 4..self.at + 4 + len)?;
        let item = ClosureAction { at: self.at, player: self.player, seq: self.seq, system: self.system, ty, payload };
        self.at += 4 + len;
        self.seq = self.seq.wrapping_add(1);
        self.left -= 1;
        Some(item)
    }
}
`.replace('never_held_placeholder', 'false'),
  );
  void fixedSize;
}

// ------------------------------------------------------------------------------------------- events

function events(s: Schema, o: RsOut): void {
  o.rt('Reader', 'Writer', 'DResult', 'EResult', 'ErrorKind', 'DecodeError', 'Packed', 'Dump', 'enc_err');
  const et = o.t(decl(s, 'EventType'));
  const header = decl(s, 'EventHeader') as StructDecl;
  const ht = o.t(header);
  const L = s.eventLimits;
  const v = (n: string) => pascal(n);
  const hasFields = (e: (typeof s.events)[number]) => e.msg.fields.length > 0;
  o.push(`/// The event queue's limits (§15.6): on overflow the oldest are dropped and the packet carries
/// EVENTS_DROPPED.
pub const EVENT_QUEUE_MAX_EVENTS: usize = ${L.queue_max_events};
pub const EVENT_QUEUE_MAX_BYTES: usize = ${L.queue_max_bytes};
/// The main thread plays nothing for an event older than this many ticks (§15.6).
pub const EVENT_STALE_TICKS: u32 = ${L.stale_ticks};

/// An event's payload (§15.6), one variant per type in events.yaml.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EventPayload {
${s.events.map((e) => (hasFields(e) ? `    ${v(e.name)}(${o.t(e.msg)}),` : `    ${v(e.name)},`)).join('\n')}
}

impl EventPayload {
    pub const fn event_type(&self) -> ${et} {
        match self {
${s.events.map((e) => `            Self::${v(e.name)}${hasFields(e) ? '(_)' : ''} => ${et}::${enumVariant(e.name)},`).join('\n')}
        }
    }

    /// The payload's size in bytes (the record's \`len\`).
    pub const fn len(&self) -> usize {
        match self {
${s.events.map((e) => `            Self::${v(e.name)}${hasFields(e) ? '(_)' : ''} => ${e.msg.fixed},`).join('\n')}
        }
    }

    pub const fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Decodes the payload of an event of type \`ty\`, which must fill \`bytes\` exactly.
    pub fn decode(ty: ${et}, bytes: &[u8]) -> DResult<Self> {
        let mut r = Reader::new(bytes);
        let p = match ty {
${s.events.map((e) => `            ${et}::${enumVariant(e.name)} => ${hasFields(e) ? `Self::${v(e.name)}(${o.t(e.msg)}::decode(&mut r)?)` : `Self::${v(e.name)}`},`).join('\n')}
        };
        r.finish("EventPayload")?;
        Ok(p)
    }

    pub fn encode(&self, w: &mut Writer<'_>) -> EResult {
        match self {
${s.events.map((e) => (hasFields(e) ? `            Self::${v(e.name)}(x) => x.encode(w),` : `            Self::${v(e.name)} => Ok(()),`)).join('\n')}
        }
    }

    pub fn dump(&self, d: &mut Dump) {
        d.line("type", self.event_type().name());
        match self {
${s.events.map((e) => (hasFields(e) ? `            Self::${v(e.name)}(x) => x.dump(d, ""),` : `            Self::${v(e.name)} => {}`)).join('\n')}
        }
    }
}

/// Writes one EVENTS record (§15.6): the 16-byte header, the payload, zero padding to 4. The header's
/// \`type\` and \`len\` come from the payload.
pub fn write_event(w: &mut Writer<'_>, header: &${ht}, payload: &EventPayload) -> EResult {
    if header.r#type != payload.event_type() {
        return Err(enc_err(ErrorKind::Inconsistent, "EventHeader.type"));
    }
    let start = w.pos();
    let mut h = *header;
    h.len = payload.len() as u16;
    crate::codec::Fixed::write(&h, w, "EventHeader")?;
    payload.encode(w)?;
    w.pad(start, 4);
    Ok(())
}

/// The payload size of an event type (its records' \`len\`).
pub const fn event_payload_size(t: ${et}) -> usize {
    match t {
${s.events.map((e) => `        ${et}::${enumVariant(e.name)} => ${e.msg.fixed},`).join('\n')}
    }
}

/// Reads one EVENTS record: the header, the payload (exactly \`len\` bytes of its type) and the padding. A
/// \`len\` other than the type's payload size is refused (\`bad_length\`).
pub fn read_event(r: &mut Reader<'_>) -> DResult<(${ht}, EventPayload)> {
    let start = r.pos();
    let h = <${ht} as crate::codec::Fixed>::read(r, "EventHeader")?;
    if usize::from(h.len) != event_payload_size(h.r#type) {
        return Err(r.err_at(start + 2, ErrorKind::BadLength, "EventHeader.len"));
    }
    let body = r.take(usize::from(h.len), "EventRecord.payload")?;
    let p = EventPayload::decode(h.r#type, body).map_err(|e| DecodeError { at: e.at + start + 16, ..e })?;
    r.pad(start, 4, "EventRecord.padding")?;
    Ok((h, p))
}
`);
}

// ------------------------------------------------------------------------------------------- packet

function packet(s: Schema, o: RsOut): void {
  o.rt('Writer', 'EResult', 'ErrorKind', 'enc_err', 'Fixed');
  const ps = o.t(decl(s, 'PacketSection'));
  const sk = o.t(decl(s, 'SectionKind'));
  const ck = o.t(decl(s, 'ChunkKey'));
  const vr = o.t(decl(s, 'ViewRequest'));
  const pf = o.t(decl(s, 'PacketFlags'));
  const sections = s.packet.sections;
  o.push(
    `/// "PWPK" (§15.4).
pub const PACKET_MAGIC: u32 = ${s.packet.magic};
pub const PACKET_HEADER_SIZE: usize = 32;
pub const PACKET_DIRECTORY_ENTRY_SIZE: usize = 16;
/// The shell's packet buffers and their initial size (§15.4).
pub const PACKET_BUFFERS: usize = ${s.packet.limits.buffers};
pub const PACKET_BUFFER_INITIAL_BYTES: usize = ${s.packet.limits.buffer_initial_bytes};

impl ${ps} {
    /// How the main thread applies the section (§15.4).
    pub const fn kind(self) -> ${sk} {
        match self {
${sections.map((x) => `            Self::${enumVariant(x.name.toLowerCase())} => ${sk}::${enumVariant(x.kind)},`).join('\n')}
        }
    }

    /// The section's record version (the directory's \`record_version\`).
    pub const fn record_version(self) -> u16 {
        match self {
${sections.map((x) => `            Self::${enumVariant(x.name.toLowerCase())} => ${x.recordVersion},`).join('\n')}
        }
    }

    /// The size of each record of a fixed-record section; None for variable records.
    pub const fn record_size(self) -> Option<usize> {
        match self {
${sections
  .map((x) => {
    const d = s.decls.get(x.record);
    const n = d?.kind === 'struct' ? d.size : null;
    return `            Self::${enumVariant(x.name.toLowerCase())} => ${n === null ? 'None' : `Some(${n})`},`;
  })
  .join('\n')}
        }
    }
}

/// The chunk key of chunk (cx, cy) (§4.4): (cx + 2^15) × 2^16 + (cy + 2^15), for cx and cy in
/// −32,768 … 32,767.
pub const fn chunk_key(cx: i32, cy: i32) -> ${ck} {
    ${ck}((((cx + 32768) as u32) << 16) | ((cy + 32768) as u32 & 0xFFFF))
}

/// The chunk of a key.
pub const fn chunk_xy(key: ${ck}) -> (i32, i32) {
    ((key.0 >> 16) as i32 - 32768, (key.0 & 0xFFFF) as i32 - 32768)
}

/// The chunk holding tile coordinate \`t\` (32 tiles per chunk, flooring toward −∞).
pub const fn tile_chunk(t: i32) -> i32 {
    t >> 5
}

/// A rectangle of chunks, both corners included.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChunkRect {
    pub cx0: i32,
    pub cy0: i32,
    pub cx1: i32,
    pub cy1: i32,
}

impl ChunkRect {
    pub const fn contains(&self, cx: i32, cy: i32) -> bool {
        cx >= self.cx0 && cx <= self.cx1 && cy >= self.cy0 && cy <= self.cy1
    }
}

/// The held set (§15.4): the chunks overlapping the view request's visible rectangle (tiles, upper bounds
/// exclusive) grown by one chunk on every side, within the chunk-key range; None when the rectangle is
/// empty. src/shared/gen/packet.ts has the same function.
pub fn held_chunks(v: &${vr}) -> Option<ChunkRect> {
    if v.x1 <= v.x0 || v.y1 <= v.y0 {
        return None;
    }
    let lo = |t: i32| (tile_chunk(t) - 1).clamp(-32768, 32767);
    let hi = |t: i32| (tile_chunk(t - 1) + 1).clamp(-32768, 32767);
    Some(ChunkRect { cx0: lo(v.x0), cy0: lo(v.y0), cx1: hi(v.x1), cy1: hi(v.y1) })
}

/// Writes a packet (§15.4): the header (state_gen and view_seq zero, for the shell to fill), a directory of
/// \`sections\` entries, then each section 8-aligned, in ascending type.
#[derive(Debug)]
pub struct PacketBuilder {
    start: usize,
    declared: usize,
    written: usize,
    last: u16,
    open: Option<(usize, usize)>,
}

impl PacketBuilder {
    /// Writes the header and an empty directory for \`sections\` sections.
    pub fn begin(w: &mut Writer<'_>, sections: usize, tick: u32, flags: ${pf}, daylight: u16) -> Self {
        let start = w.pos();
        w.u32(PACKET_MAGIC);
        w.u16(crate::PACKET_VERSION);
        w.u16(flags.bits());
        w.u32(0);
        w.u32(tick);
        w.u32(0);
        w.u16(daylight);
        w.u16(sections as u16);
        w.u32(0);
        w.u32(0);
        w.zeros(sections * PACKET_DIRECTORY_ENTRY_SIZE);
        Self { start, declared: sections, written: 0, last: 0, open: None }
    }

    /// Starts the next section; types must ascend.
    pub fn section(&mut self, w: &mut Writer<'_>, t: ${ps}) -> EResult {
        if self.open.is_some() || self.written == self.declared || t.value() <= self.last {
            return Err(enc_err(ErrorKind::Unsorted, "PacketBuilder.section"));
        }
        w.pad(self.start, 8);
        let entry = self.start + PACKET_HEADER_SIZE + self.written * PACKET_DIRECTORY_ENTRY_SIZE;
        w.patch_u16_at(entry, t.value());
        w.patch_u16_at(entry + 2, t.record_version());
        w.patch_u32(entry + 4, (w.pos() - self.start) as u32);
        self.open = Some((entry, w.pos()));
        self.last = t.value();
        Ok(())
    }

    /// Ends the open section with its record count.
    pub fn end(&mut self, w: &mut Writer<'_>, count: u32) -> EResult {
        let Some((entry, at)) = self.open.take() else {
            return Err(enc_err(ErrorKind::Inconsistent, "PacketBuilder.end"));
        };
        w.patch_u32(entry + 8, (w.pos() - at) as u32);
        w.patch_u32(entry + 12, count);
        self.written += 1;
        Ok(())
    }

    /// Checks that every declared section was written and fills in the packet's length.
    pub fn finish(self, w: &mut Writer<'_>) -> EResult {
        if self.open.is_some() || self.written != self.declared {
            return Err(enc_err(ErrorKind::BadCount, "PacketBuilder.finish"));
        }
        w.pad(self.start, 8);
        w.patch_u32(self.start + 24, (w.pos() - self.start) as u32);
        Ok(())
    }
}
`.replaceAll('w.patch_u16_at(', 'w.patch_u16('),
  );
  void fixedSize;
}

// ------------------------------------------------------------------------------------------- projections

function projections(s: Schema, o: RsOut): void {
  o.rt('Writer', 'EResult', 'ErrorKind', 'enc_err', 'Fixed');
  const pk = o.t(decl(s, 'ProjectionKind'));
  const us = o.t(decl(s, 'UiStatus'));
  const qk = o.t(decl(s, 'QueryKind'));
  const L = s.projections.limits;
  o.push(`/// Subscription and query limits (§15.5).
${sortedEntries(L)
  .map(([k, x]) => `pub const ${upperSnake(k)}: usize = ${x};`)
  .join('\n')}

/// A projection's cadence (§15.5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cadence {
    /// Every packet.
    Every,
    /// On subscribing, then at the first extraction at least SLOW_CADENCE_TICKS after the last evaluation.
    Slow,
}

/// What a subscription's \`target\` holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    None,
    Entity,
    Player,
}

impl ${pk} {
    pub const fn cadence(self) -> Cadence {
        match self {
${s.projections.kinds.map((k) => `            Self::${enumVariant(k.name.toLowerCase())} => Cadence::${k.cadence === 'every' ? 'Every' : 'Slow'},`).join('\n')}
        }
    }

    pub const fn target(self) -> Target {
        match self {
${s.projections.kinds.map((k) => `            Self::${enumVariant(k.name.toLowerCase())} => Target::${pascal(k.target)},`).join('\n')}
        }
    }

    /// Whether the schema declares the kind's record (the others arrive with later milestones).
    pub const fn has_record(self) -> bool {
        matches!(self, ${s.projections.kinds
          .filter((k) => k.record)
          .map((k) => `Self::${enumVariant(k.name.toLowerCase())}`)
          .join(' | ')})
    }
}

impl ${qk} {
    /// Dev-build queries (§15.5).
    pub const fn is_dev(self) -> bool {
        matches!(self, ${
          s.projections.queries
            .filter((q) => q.dev)
            .map((q) => `Self::${enumVariant(q.name)}`)
            .join(' | ') || 'Self::__None'
        })
    }
}

/// Writes one UI record (§15.5): the 16-byte header, the body that \`body\` writes, padding to 4.
pub fn write_ui_record(
    w: &mut Writer<'_>,
    sub_id: u32,
    kind: ${pk},
    status: ${us},
    version: u32,
    body: impl FnOnce(&mut Writer<'_>) -> EResult,
) -> EResult {
    let start = w.pos();
    w.u32(sub_id);
    w.u16(kind.value());
    w.u16(status.value());
    w.u32(version);
    let len_at = w.pos();
    w.u32(0);
    body(w)?;
    let len = w.pos() - len_at - 4;
    if len > RECORD_MAX {
        return Err(enc_err(ErrorKind::TooLong, "UiRecord.body"));
    }
    w.patch_u32(len_at, len as u32);
    w.pad(start, 4);
    Ok(())
}
`);
}

// ------------------------------------------------------------------------------------------- container

function container(s: Schema, o: RsOut): void {
  o.rt('Reader', 'DResult', 'ErrorKind', 'Fixed', 'Packed');
  const clh = o.t(decl(s, 'ClosureLogHeader'));
  const cr = o.t(decl(s, 'ClosureRecord'));
  const lb = o.t(decl(s, 'LogBlob'));
  const ss = o.t(decl(s, 'SaveSection'));
  const sv = s.save;
  o.push(`/// The save container's magic and format (§8.1).
pub const SAVE_MAGIC: &[u8; 8] = b${canonicalJson(sv.magic, 0).replace('\\u0000', '\\0')};
pub const SAVE_FORMAT_VERSION: u32 = ${sv.formatVersion};
/// "PWCL" and the closure log's format (§8.5).
pub const CLOSURE_LOG_MAGIC: u32 = ${sv.closureLog.magic};
pub const CLOSURE_LOG_FORMAT_VERSION: u16 = ${sv.closureLog.formatVersion};
/// Digest shards (§4.8).
pub const SHARDS: u32 = ${sv.shards};

impl ${ss} {
    /// Whether the full state hash covers the section (§4.8).
    pub const fn hashed(self) -> bool {
        matches!(self, ${sv.sections
          .filter((x) => x.hashed)
          .map((x) => `Self::${enumVariant(x.name.toLowerCase())}`)
          .join(' | ')})
    }
    /// The schema version at which the section's layout last changed (§8.1).
    pub const fn version(self) -> u16 {
        match self {
${sv.sections.map((x) => `            Self::${enumVariant(x.name.toLowerCase())} => ${x.version},`).join('\n')}
            _ => 0,
        }
    }
    /// Whether this build writes the section (reserved ids belong to later milestones).
    pub const fn is_declared(self) -> bool {
        matches!(self, ${sv.sections.map((x) => `Self::${enumVariant(x.name.toLowerCase())}`).join(' | ')})
    }
}

/// The smallest encoded ClosureRecord (tick, length, one byte) and LogBlob (hash, length): capacity bounds.
const RECORD_MIN: usize = 9;
const BLOB_MIN: usize = 36;

/// A parsed closure log (§8.5), borrowing its bytes.
#[derive(Clone, Debug, PartialEq)]
pub struct ClosureLog<'a> {
    pub header: ${clh},
    pub records: Vec<${cr}<'a>>,
    /// The per-tick digests, digest_first_tick onward.
    pub digests: Vec<u64>,
    pub blobs: Vec<${lb}<'a>>,
}

impl<'a> ClosureLog<'a> {
    /// Parses and checks a closure log (§8.5): every region consumes exactly its declared bytes; records rise
    /// strictly within (start_tick, end_tick], are not empty, and each passes the preflight's framing rules
    /// for its tick (\`check_framing\`; else \`bad_framing\` at the failing batch or action); the digest range
    /// lies in the tick range; blobs are sorted by hash without duplicates; every blob an action names is
    /// present (else \`bad_ref\` at that action). Counts are checked against the bytes before anything is
    /// allocated for them (C1b-r1 findings 3–5).
    pub fn parse(bytes: &'a [u8]) -> DResult<Self> {
        let mut r = Reader::new(bytes);
        let header = ${clh}::read(&mut r, "ClosureLogHeader")?;
        if header.magic != CLOSURE_LOG_MAGIC {
            return Err(r.err_at(0, ErrorKind::BadMagic, "ClosureLogHeader.magic"));
        }
        if header.format_version != CLOSURE_LOG_FORMAT_VERSION {
            return Err(r.err_at(4, ErrorKind::BadVersion, "ClosureLogHeader.format_version"));
        }
        if header.end_tick < header.start_tick {
            return Err(r.err_at(12, ErrorKind::Range, "ClosureLogHeader.end_tick"));
        }
        let mut rec = r.sub(header.record_bytes as usize, "ClosureLog.records")?;
        // At most one record per RECORD_MIN bytes, whatever record_count claims.
        let mut records = Vec::with_capacity((header.record_count as usize).min(rec.remaining() / RECORD_MIN));
        let mut closures_at = Vec::with_capacity(records.capacity());
        let mut last = header.start_tick;
        for _ in 0..header.record_count {
            let at = rec.pos();
            let x = ${cr}::decode(&mut rec)?;
            if x.tick <= last || x.tick > header.end_tick {
                return Err(rec.err_at(at, ErrorKind::Unsorted, "ClosureRecord.tick"));
            }
            if let Err(crate::PreflightError::Framing { at: k, .. } | crate::PreflightError::BlobMissing { at: k }) =
                crate::check_framing(x.closure, x.tick.0)
            {
                return Err(rec.err_at(at + 8 + k, ErrorKind::BadFraming, "ClosureRecord.closure"));
            }
            last = x.tick;
            records.push(x);
            closures_at.push(at + 8);
        }
        rec.finish("ClosureLog.records")?;
        let has_digests = header.flags.contains(crate::ClosureLogFlags::HAS_DIGESTS);
        if !has_digests && (header.digest_count != 0 || header.digest_first_tick.0 != 0) {
            return Err(r.err_at(96, ErrorKind::Inconsistent, "ClosureLogHeader.digest_count"));
        }
        if has_digests && header.digest_count > 0 {
            let lo = u64::from(header.digest_first_tick.0);
            let hi = lo + u64::from(header.digest_count) - 1;
            if lo <= u64::from(header.start_tick.0) || hi > u64::from(header.end_tick.0) {
                return Err(r.err_at(96, ErrorKind::Range, "ClosureLogHeader.digest_first_tick"));
            }
        }
        let n = (header.digest_count as usize).checked_mul(8).ok_or_else(|| r.err(ErrorKind::Truncated, "ClosureLog.digests"))?;
        let mut dg = r.sub(n, "ClosureLog.digests")?;
        let mut digests = Vec::with_capacity(dg.remaining() / 8);
        for _ in 0..header.digest_count {
            digests.push(dg.u64("ClosureLog.digests")?);
        }
        let mut bl = r.sub(header.blob_bytes as usize, "ClosureLog.blobs")?;
        let mut blobs: Vec<${lb}<'a>> = Vec::with_capacity((header.blob_count as usize).min(bl.remaining() / BLOB_MIN));
        for _ in 0..header.blob_count {
            let at = bl.pos();
            let x = ${lb}::decode(&mut bl)?;
            if blobs.last().is_some_and(|p| p.sha256.bytes >= x.sha256.bytes) {
                return Err(bl.err_at(at, ErrorKind::Unsorted, "LogBlob.sha256"));
            }
            blobs.push(x);
        }
        bl.finish("ClosureLog.blobs")?;
        r.finish("ClosureLog")?;
        for (x, &base) in records.iter().zip(&closures_at) {
            for a in crate::ClosureIter::new(x.closure) {
                if let Ok(act) = crate::Action::decode(a.ty, a.payload) {
                    if let Some(h) = act.blob() {
                        if blobs.binary_search_by(|b| b.sha256.bytes.cmp(&h)).is_err() {
                            return Err(r.err_at(base + a.at, ErrorKind::BadRef, "ClosureLog.blobs"));
                        }
                    }
                }
            }
        }
        Ok(Self { header, records, digests, blobs })
    }
}
`);
  void typeName;
}

// ------------------------------------------------------------------------------------------- abi

function abi(s: Schema, o: RsOut): void {
  const st = o.t(decl(s, 'SimStatus'));
  const rustParam = (t: { k: string; s?: string; d?: { base: string } }) =>
    t.k === 'scalar' ? (t.s as string) : (t.d?.base as string);
  const sig = (e: (typeof s.abi.exports)[number]) => {
    const params = [
      ...(e.input !== undefined ? ['len: u32'] : []),
      ...(e.kind === 'input' ? ['len: u32'] : []),
      ...e.params.map((p) => `${p.name}: ${rustParam(p.ty as never)}`),
    ];
    const ret = e.kind === 'plain' ? (e.returns as string) : 'u32';
    return { params, ret };
  };
  const traitOf = (module: 'sim' | 'gen', trait: string, macro: string) => {
    const ex = s.abi.exports.filter((e) => e.module === module);
    return `/// The ${module}.wasm exports (§15.8), with the signatures of schema/abi.yaml. \`${module === 'sim' ? 'simabi' : 'genabi'}\` implements
/// it and writes the \`extern "C"\` shims with [\`${macro}!\`], so a missing or mistyped export does not compile.
/// Pointers and lengths are u32; status exports return a [\`${st}\`] value; envelope exports return 0 or
/// an 8-byte-aligned pointer to \`{u32 len, bytes}\`.
pub trait ${trait} {
${ex
  .map((e) => {
    const { params, ret } = sig(e);
    return `${e.doc ? `    /// ${e.doc}\n` : ''}    fn ${e.name}(${params.join(', ')}) -> ${ret};`;
  })
  .join('\n')}
}

/// Declares every ${module}.wasm export as an \`extern "C"\` function that calls the [\`${trait}\`]
/// implementation \`$t\`. Use it once, in the ABI crate.
#[macro_export]
macro_rules! ${macro} {
    ($t:ty) => {
${ex
  .map((e) => {
    const { params, ret } = sig(e);
    const args = params.map((p) => p.split(':')[0]).join(', ');
    return `        #[unsafe(no_mangle)]\n        pub extern "C" fn ${e.name}(${params.join(', ')}) -> ${ret} {\n            <$t as $crate::abi::${trait}>::${e.name}(${args})\n        }`;
  })
  .join('\n')}
    };
}
`;
  };
  const names = (module: 'sim' | 'gen') =>
    s.abi.exports
      .filter((e) => e.module === module)
      .map((e) => rsStr(e.name))
      .join(', ');
  o.push(`/// Every sim.wasm export, in schema order (§15.8).
pub const SIM_EXPORTS: [&str; ${s.abi.exports.filter((e) => e.module === 'sim').length}] = [${names('sim')}];
/// Every gen.wasm export (§15.9).
pub const GEN_EXPORTS: [&str; ${s.abi.exports.filter((e) => e.module === 'gen').length}] = [${names('gen')}];
/// The imports both modules may use, from module \`env\` (§15.8).
pub const IMPORTS: [&str; ${s.abi.imports.length}] = [${s.abi.imports.map((i) => rsStr(i.name)).join(', ')}];

${traitOf('sim', 'SimAbi', 'export_sim_abi')}
${traitOf('gen', 'GenAbi', 'export_gen_abi')}`);
}

// ------------------------------------------------------------------------------------------- registries

function registries(s: Schema, o: RsOut): void {
  const strs = s.registries.filter((r) => r.strings);
  o.push(`${strs
    .map(
      (r) =>
        `/// ${r.doc ?? r.name}\npub const ${upperSnake(r.name)}: [&str; ${r.strings?.length}] = [${(r.strings ?? []).map(rsStr).join(', ')}];`,
    )
    .join('\n\n')}

/// Names the engine must know (§2.4 step 4): resolved by name when Protos loads.
pub const WELL_KNOWN: [(&str, &str); ${s.wellKnown.length}] = [${s.wellKnown.map((w) => `(${rsStr(w.name)}, ${rsStr(w.kind)})`).join(', ')}];
`);
}

// ------------------------------------------------------------------------------------------- capabilities

function capabilities(s: Schema, caps: Capabilities, o: RsOut): void {
  const at = o.t(decl(s, 'ActionType'));
  const pk = o.t(decl(s, 'ProjectionKind'));
  const qk = o.t(decl(s, 'QueryKind'));
  const ps = o.t(decl(s, 'PacketSection'));
  const m = (t: string, names: readonly string[], lower: boolean) =>
    names.length ? names.map((n) => `${t}::${enumVariant(lower ? n.toLowerCase() : n)}`).join(' | ') : null;
  const fn = (name: string, doc: string, t: string, names: readonly string[], lower: boolean) => {
    const pat = m(t, names, lower);
    return `/// ${doc}\npub const fn ${name}(t: ${t}) -> bool {\n    ${pat ? `matches!(t, ${pat})` : 'let _ = t;\n    false'}\n}`;
  };
  o.push(`/// The capability manifest this build implements (game/data/engine/capabilities.yaml \`current\`).
pub const CAPABILITY_MANIFEST: &str = ${rsStr(caps.name)};

${fn('action_supported', 'Whether the sim implements the action; any other one decodes and is refused as `unsupported` (§15.3).', at, [...caps.actions, ...caps.systemActions], false)}

${fn('projection_supported', 'Whether the module produces the projection; any other one gets status 2, reason `unsupported` (§15.5).', pk, caps.projections, true)}

${fn('query_supported', 'Whether the module answers the query; any other one fails as `unsupported` (§15.5).', qk, caps.queries, false)}

${fn('packet_section_supported', 'Whether the module writes the packet section (§15.4).', ps, caps.packetSections, true)}

/// The META blocks of prototypes.bin this engine reads: \`Protos::load\` refuses a file that omits one
/// (C1a-r1 finding 5).
pub const REQUIRED_DATA: [&str; ${caps.data.length}] = [${caps.data.map(rsStr).join(', ')}];

/// The registry entries this milestone implements (§2.4 step 4).
pub const IMPLEMENTED_EFFECTS: [&str; ${caps.registries.effects.length}] = [${caps.registries.effects.map(rsStr).join(', ')}];
pub const IMPLEMENTED_TRIGGERS: [&str; ${caps.registries.triggers.length}] = [${caps.registries.triggers.map(rsStr).join(', ')}];
pub const IMPLEMENTED_ACHIEVEMENT_CONDITIONS: [&str; ${caps.registries.achievement_conditions.length}] = [${caps.registries.achievement_conditions.map(rsStr).join(', ')}];
pub const IMPLEMENTED_FORMULA_REFS: [&str; ${caps.registries.formula_refs.length}] = [${caps.registries.formula_refs.map(rsStr).join(', ')}];
`);
  void (null as unknown as EnumDecl | MessageDecl);
}
