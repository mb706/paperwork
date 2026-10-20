// Module extras of the TypeScript output: the action union with its encoder, decoder and the closure
// tools (§15.3), the event union (§15.6), the packet writer and decoder with the held set (§15.4), UI
// records and projection decoding (§15.5), the save container and closure logs (§8.1, §8.5), the ABI
// wrappers (§15.8), registries and the capability manifest.
import { sortedEntries } from '../lib/canonical.ts';
import type { Capabilities } from './capabilities.ts';
import { type Decl, type MessageDecl, pascal, type Schema, type StructDecl, upperSnake } from './model.ts';
import { type TsMod, type TsOut, tsStr } from './ts.ts';
import { jsonHelpers, jsonValidator } from './ts-json.ts';
import { tsProtos } from './ts-protos.ts';
import { tsState } from './ts-state.ts';

export function tsExtras(s: Schema, caps: Capabilities, outs: Map<TsMod, TsOut>): void {
  const out = (m: TsMod) => outs.get(m) as TsOut;
  actions(s, out('actions'));
  events(s, out('events'));
  packet(s, out('packet'));
  projections(s, out('projections'));
  container(s, out('container'));
  abi(s, out('abi'));
  tsProtos(s, out('protos'));
  registries(s, out('registries'));
  capabilities(s, caps, out('capabilities'));
  tsState(s, out('sections'), out('pools'));
}

const decl = (s: Schema, n: string) => s.decls.get(n) as Decl;

// ------------------------------------------------------------------------------------------- actions

function actions(s: Schema, o: TsOut): void {
  o.rt('Reader', 'Writer', 'DecodeError', 'EncodeError', 'Dump');
  const L = s.actionLimits;
  const union = s.actions.map((a) => `  | ({ type: ${tsStr(a.name)} } & ${o.t(a.msg)})`).join('\n');
  const blobs = s.actions.filter((a) => a.msg.fields.some((f) => f.ty.k === 'blob_or_bytes'));
  o.push(`/** The largest action payload (§15.3). */
export const PAYLOAD_MAX = ${L.payload_max};
/** CLOSURE_MAX (§15.3). */
export const CLOSURE_MAX = ${L.closure_max};
/** Bytes of every tick reserved for system actions (admission, §15.3). */
export const SYSTEM_RESERVE = ${L.system_reserve};
/** Player indices are 0 to PLAYERS − 1 (11 §6.5). */
export const PLAYERS = ${L.players};
/** Type ids from here are system actions. */
export const SYSTEM_TYPE_MIN = ${L.system_type_min};
/** The "player" of system batches. */
export const SYSTEM_PLAYER = 0xffff;
/** ACTION_SCHEMA_VERSION (every batch header carries it). */
export const ACTION_SCHEMA_VERSION = ${s.versions.action};

/** An action (§15.3): its type name and its payload's fields. */
export type Action =
${union};
export type ActionName = Action['type'];

/** Action type ids by name (actions.yaml). */
export const ACTION_IDS: Readonly<Record<ActionName, number>> = {
${s.actions.map((a) => `  ${a.name}: ${a.id},`).join('\n')}
};
const ACTION_BY_ID: ReadonlyMap<number, ActionName> = new Map([${s.actions.map((a) => `[${a.id}, ${tsStr(a.name)}]`).join(', ')}]);
/** The name of an action type id, or undefined. */
export function actionName(id: number): ActionName | undefined {
  return ACTION_BY_ID.get(id);
}
/** The held-input actions (D22): their payload starts with the input generation. */
export const HELD_ACTIONS: ReadonlySet<ActionName> = new Set([${s.actions
    .filter((a) => a.held)
    .map((a) => tsStr(a.name))
    .join(', ')}]);
/** The system actions (§15.3). */
export const SYSTEM_ACTIONS: ReadonlySet<ActionName> = new Set([${s.actions
    .filter((a) => a.system)
    .map((a) => tsStr(a.name))
    .join(', ')}]);

/** Encodes an action's payload (without the action header). */
export function encodeActionPayload(w: Writer, a: Action): void {
  switch (a.type) {
${s.actions.map((a) => `    case ${tsStr(a.name)}:\n      ${o.c(a.msg)}.write(w, a);\n      return;`).join('\n')}
  }
}

/** Encodes an action: \`u16 type, u16 len\`, then the payload (§15.3). */
export function encodeAction(w: Writer, a: Action): void {
  const id = ACTION_IDS[a.type];
  if (id === undefined) throw new EncodeError('unknown_type', 'Action');
  w.u16(id, 'Action');
  const lenAt = w.pos;
  w.u16(0, 'Action');
  encodeActionPayload(w, a);
  const n = w.pos - lenAt - 2;
  if (n > PAYLOAD_MAX) throw new EncodeError('too_long', 'Action');
  w.patchU16(lenAt, n);
}

/** One action, framed, as bytes. */
export function actionBytes(a: Action): Uint8Array {
  const w = new Writer();
  encodeAction(w, a);
  return w.finish();
}

/**
 * Decodes a payload of type \`type\`, checking everything the schema declares (§15.3): a known type, a length
 * that matches, enum values, EntityRef tags, bools, reserved fields, maxima and UTF-8. A failure is the
 * reason \`malformed\`.
 */
export function decodeAction(type: number, payload: Uint8Array): Action {
  const name = ACTION_BY_ID.get(type);
  if (name === undefined) throw new DecodeError('unknown_type', 'Action', 0);
  const r = new Reader(payload);
  let a: Action;
  switch (name) {
${s.actions.map((a) => `    case ${tsStr(a.name)}:\n      a = { type: name, ...${o.c(a.msg)}.read(r) };\n      break;`).join('\n')}
  }
  r.finish('Action');
  return a;
}

/** The action with its input generation set (the sequencer stamps it, §15.3); others are unchanged. */
export function withInputGen(a: Action, g: number): Action {
  return 'input_gen' in a ? { ...a, input_gen: g } : a;
}

/** The blob a \`blob_or_bytes\` field names, if any (§15.3). */
export function actionBlob(a: Action): Uint8Array | null {
  switch (a.type) {
${blobs
  .map((a) => {
    const f = a.msg.fields.find((x) => x.ty.k === 'blob_or_bytes') as { name: string };
    return `    case ${tsStr(a.name)}:\n      return 'blob' in a.${f.name} ? a.${f.name}.blob : null;`;
  })
  .join('\n')}
    default:
      return null;
  }
}

/** Appends the text dump (test/fixtures/codec): the type's name, then the payload's fields. */
export function dumpAction(d: Dump, a: Action): void {
  d.line('type', a.type);
  switch (a.type) {
${s.actions.map((a) => `    case ${tsStr(a.name)}:\n      ${o.c(a.msg)}.dump(d, a, '');\n      return;`).join('\n')}
  }
}

/** One player's consecutive actions within one tick (§15.3). */
export interface BatchInput {
  player: number;
  system: boolean;
  tick: number;
  firstSeq: number;
  /** Framed actions (\`u16 type, u16 len, payload\`). */
  actions: readonly Uint8Array[];
}

/** Encodes a batch: the 16-byte header, then the actions. */
export function encodeBatch(w: Writer, b: BatchInput): void {
  if (b.actions.length < 1 || b.actions.length > 0xffff) throw new EncodeError('bad_count', 'BatchHeader.count');
  w.u8(ACTION_SCHEMA_VERSION, 'BatchHeader.version');
  w.u8(b.system ? 1 : 0, 'BatchHeader.flags');
  w.u16(b.system ? SYSTEM_PLAYER : b.player, 'BatchHeader.player');
  w.u32(b.tick, 'BatchHeader.tick');
  w.u32(b.firstSeq, 'BatchHeader.first_seq');
  w.u16(b.actions.length, 'BatchHeader.count');
  w.u16(0, 'BatchHeader.reserved');
  for (const a of b.actions) w.bytes(a);
}

/** A closure: the batches of one tick, back to back, in execution order (§15.3). */
export function encodeClosure(batches: readonly BatchInput[]): Uint8Array {
  const w = new Writer();
  for (const b of batches) encodeBatch(w, b);
  return w.finish();
}

/** Why a closure failed the preflight (§15.3): ERR_FRAMING or ERR_BLOB_MISSING. */
export class PreflightError extends Error {
  readonly code: 'framing' | 'blob_missing';
  readonly at: number;
  readonly reason: string;
  constructor(code: 'framing' | 'blob_missing', at: number, reason: string) {
    super(\`preflight \${code} at byte \${at}: \${reason}\`);
    this.code = code;
    this.at = at;
    this.reason = reason;
  }
}

/** One action of a closure that passed the preflight, in execution order. */
export interface ClosureAction {
  /** The offset of the action's frame (\`u16 type, u16 len\`) in the closure. */
  at: number;
  player: number;
  seq: number;
  system: boolean;
  type: number;
  payload: Uint8Array;
}

const le16 = (b: Uint8Array, at: number): number => (b[at] as number) | ((b[at + 1] as number) << 8);
const le32 = (b: Uint8Array, at: number): number =>
  ((b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16) | ((b[at + 3] as number) << 24)) >>> 0;
const framing = (at: number, reason: string) => new PreflightError('framing', at, reason);

/**
 * The framing rules of the preflight (§15.3 rules 1–3) over a closure stamped \`tick\`, as the Rust module's
 * \`walk\`: \`batch\` sees each batch after these checks and may throw; \`action\` sees each action.
 */
function walk(
  closure: Uint8Array,
  tick: number,
  batch: (at: number, system: boolean, player: number, first: number, count: number) => void,
  action: (at: number, a: ClosureAction) => void,
): { batches: number; actions: number } {
  if (closure.length > CLOSURE_MAX) throw framing(0, 'closure larger than CLOSURE_MAX');
  let batches = 0;
  let count = 0;
  let at = 0;
  while (at < closure.length) {
    if (closure.length - at < 16) throw framing(at, 'truncated batch header');
    const version = closure[at] as number;
    const flags = closure[at + 1] as number;
    const player = le16(closure, at + 2);
    const btick = le32(closure, at + 4);
    const first = le32(closure, at + 8);
    const n = le16(closure, at + 12);
    const reserved = le16(closure, at + 14);
    if (version !== ACTION_SCHEMA_VERSION) throw framing(at, 'batch version is not ACTION_SCHEMA_VERSION');
    if ((flags & ~1) !== 0 || reserved !== 0) throw framing(at, 'batch flags or reserved field not zero');
    if (btick !== tick) throw framing(at, 'batch tick is not the tick being run');
    if (n === 0) throw framing(at, 'empty batch');
    const system = (flags & 1) !== 0;
    if (system !== (player === 0xffff) || (!system && player >= PLAYERS)) throw framing(at, 'batch player out of range');
    batch(at, system, player, first, n);
    batches++;
    at += 16;
    let seq = first;
    for (let i = 0; i < n; i++) {
      if (closure.length - at < 4) throw framing(at, 'truncated action header');
      const type = le16(closure, at);
      const len = le16(closure, at + 2);
      if (closure.length - at - 4 < len) throw framing(at, 'action payload runs past the closure');
      if (type >= SYSTEM_TYPE_MIN !== system) throw framing(at, 'system action outside a system batch, or the reverse');
      action(at, { at, player, seq, system, type, payload: closure.subarray(at + 4, at + 4 + len) });
      count++;
      seq = (seq + 1) >>> 0;
      at += 4 + len;
    }
  }
  return { batches, actions: count };
}

/**
 * The preflight's framing rules alone (rules 1–3), for a closure stamped \`tick\`: what a closure log's reader
 * checks of each record (§8.5, C1b-r1 finding 5). Throws PreflightError ('framing').
 */
export function checkFraming(closure: Uint8Array, tick: number): { batches: number; actions: number } {
  return walk(closure, tick, () => {}, () => {});
}

/**
 * The preflight (§15.3, B1-r1 9), as the Rust module runs it: checks the whole closure of tick \`tick\` with
 * temporary watermarks and changes nothing. \`lastSeq[p]\` is player p's saved last_seq (0 without state).
 * Returns the batch and action counts; throws PreflightError with the same reasons as the Rust preflight.
 */
export function preflight(
  closure: Uint8Array,
  tick: number,
  lastSeq: readonly number[],
  lastSystemSeq: number,
  hasBlob: (sha256: Uint8Array) => boolean,
): { batches: number; actions: number } {
  const marks = Array.from({ length: PLAYERS }, (_, i) => lastSeq[i] ?? 0);
  let systemMark = lastSystemSeq;
  return walk(
    closure,
    tick,
    (at, system, player, first, n) => {
      const mark = system ? systemMark : (marks[player] as number);
      if (first <= mark) throw framing(at, 'seqs do not rise (D21)');
      const last = first + n - 1;
      if (last > 0xffffffff) throw framing(at, 'seq range passes u32::MAX');
      if (system) systemMark = last;
      else marks[player] = last;
    },
    (at, a) => {
      let act: Action | null = null;
      try {
        act = decodeAction(a.type, a.payload);
      } catch {
        act = null;
      }
      const blob = act ? actionBlob(act) : null;
      if (blob && !hasBlob(blob)) throw new PreflightError('blob_missing', at, 'a named blob was not supplied');
    },
  );
}

/**
 * The actions of a closure that passed the preflight or \`checkFraming\`, in execution order (§15.3). On any
 * other closure it stops early.
 */
export function closureActions(closure: Uint8Array): ClosureAction[] {
  const out: ClosureAction[] = [];
  let at = 0;
  while (at + 16 <= closure.length) {
    const system = ((closure[at + 1] as number) & 1) !== 0;
    const player = le16(closure, at + 2);
    let seq = le32(closure, at + 8);
    const n = le16(closure, at + 12);
    at += 16;
    if (n === 0) break;
    for (let i = 0; i < n && at + 4 <= closure.length; i++) {
      const type = le16(closure, at);
      const len = le16(closure, at + 2);
      if (at + 4 + len > closure.length) return out;
      out.push({ at, player, seq, system, type, payload: closure.subarray(at + 4, at + 4 + len) });
      at += 4 + len;
      seq = (seq + 1) >>> 0;
    }
  }
  return out;
}
`);
}

// ------------------------------------------------------------------------------------------- events

function events(s: Schema, o: TsOut): void {
  o.rt('Reader', 'Writer', 'DecodeError', 'EncodeError', 'Dump');
  const L = s.eventLimits;
  const eh = decl(s, 'EventHeader') as StructDecl;
  const union = s.events
    .map((e) => `  | ({ type: ${tsStr(e.name)} }${e.msg.fields.length ? ` & ${o.t(e.msg)}` : ''})`)
    .join('\n');
  o.push(`/** The event queue's limits (§15.6). */
export const EVENT_QUEUE_MAX_EVENTS = ${L.queue_max_events};
export const EVENT_QUEUE_MAX_BYTES = ${L.queue_max_bytes};
/** The main thread plays nothing for an event older than this many ticks (§15.6). */
export const EVENT_STALE_TICKS = ${L.stale_ticks};

/** An event's payload (§15.6), by type name. */
export type EventPayload =
${union};
export type EventName = EventPayload['type'];
export const EVENT_IDS: Readonly<Record<EventName, number>> = {
${s.events.map((e) => `  ${e.name}: ${e.id},`).join('\n')}
};
const EVENT_BY_ID: ReadonlyMap<number, EventName> = new Map([${s.events.map((e) => `[${e.id}, ${tsStr(e.name)}]`).join(', ')}]);
const EVENT_SIZE: Readonly<Record<EventName, number>> = {
${s.events.map((e) => `  ${e.name}: ${e.msg.fixed},`).join('\n')}
};

/** The event header without its type and length (they come from the payload). */
export type EventMeta = Omit<${o.t(eh)}, 'type' | 'len'>;

/** Decodes the payload of an event of type id \`type\`, which must fill \`bytes\` exactly. */
export function decodeEventPayload(type: number, bytes: Uint8Array): EventPayload {
  const name = EVENT_BY_ID.get(type);
  if (name === undefined) throw new DecodeError('unknown_type', 'EventPayload', 0);
  const r = new Reader(bytes);
  let p: EventPayload;
  switch (name) {
${s.events.map((e) => `    case ${tsStr(e.name)}:\n      p = ${e.msg.fields.length ? `{ type: name, ...${o.c(e.msg)}.read(r) }` : '{ type: name }'};\n      break;`).join('\n')}
  }
  r.finish('EventPayload');
  return p;
}

export function encodeEventPayload(w: Writer, p: EventPayload): void {
  switch (p.type) {
${s.events.map((e) => `    case ${tsStr(e.name)}:\n      ${e.msg.fields.length ? `${o.c(e.msg)}.write(w, p);\n      return;` : 'return;'}`).join('\n')}
  }
}

/** Writes one EVENTS record (§15.6): the header, the payload, zero padding to 4. */
export function writeEvent(w: Writer, meta: EventMeta, p: EventPayload): void {
  const id = EVENT_IDS[p.type];
  if (id === undefined) throw new EncodeError('unknown_type', 'EventHeader.type');
  const start = w.pos;
  ${o.c(eh)}.write(w, { ...meta, type: id, len: EVENT_SIZE[p.type] });
  encodeEventPayload(w, p);
  w.pad(start, 4);
}

/**
 * Reads one EVENTS record: the header, the payload (exactly \`len\` bytes of its type) and the padding. A
 * \`len\` other than the type's payload size is refused (\`bad_length\`).
 */
export function readEvent(r: Reader): { header: ${o.t(eh)}; payload: EventPayload } {
  const start = r.pos;
  const header = ${o.c(eh)}.read(r, 'EventHeader');
  if (header.len !== EVENT_SIZE[EVENT_BY_ID.get(header.type) as EventName]) throw new DecodeError('bad_length', 'EventHeader.len', start + 2);
  const body = r.take(header.len, 'EventRecord.payload');
  let payload: EventPayload;
  try {
    payload = decodeEventPayload(header.type, body);
  } catch (e) {
    if (e instanceof DecodeError) throw new DecodeError(e.kind, e.field, e.at + start + 16);
    throw e;
  }
  r.pad(start, 4, 'EventRecord.padding');
  return { header, payload };
}

/** The records of an EVENTS section. */
export function readEvents(bytes: Uint8Array, count: number): { header: ${o.t(eh)}; payload: EventPayload }[] {
  const r = new Reader(bytes);
  const out: { header: ${o.t(eh)}; payload: EventPayload }[] = [];
  for (let i = 0; i < count; i++) out.push(readEvent(r));
  r.finish('EVENTS');
  return out;
}

export function dumpEvent(d: Dump, p: EventPayload): void {
  d.line('type', p.type);
  switch (p.type) {
${s.events.map((e) => `    case ${tsStr(e.name)}:\n      ${e.msg.fields.length ? `${o.c(e.msg)}.dump(d, p, '');\n      return;` : 'return;'}`).join('\n')}
  }
}
`);
}

// ------------------------------------------------------------------------------------------- packet

function packet(s: Schema, o: TsOut): void {
  o.rt('Reader', 'Writer', 'DecodeError', 'EncodeError');
  const sections = s.packet.sections;
  const vr = decl(s, 'ViewRequest');
  const ph = decl(s, 'PacketHeader');
  const se = decl(s, 'SectionEntry');
  const recOf = (r: string) => {
    if (r === 'events' || r === 'ui') return null;
    return decl(s, r);
  };
  o.push(`/** "PWPK" (§15.4). */
export const PACKET_MAGIC = ${s.packet.magic};
export const PACKET_VERSION = ${s.versions.packet};
export const PACKET_HEADER_SIZE = 32;
export const PACKET_DIRECTORY_ENTRY_SIZE = 16;
/** The shell's packet buffers and their initial size (§15.4). */
export const PACKET_BUFFERS = ${s.packet.limits.buffers};
export const PACKET_BUFFER_INITIAL_BYTES = ${s.packet.limits.buffer_initial_bytes};

/** Each packet section's facts (§15.4): how it applies, its record version, its fixed record size. */
export const PACKET_SECTIONS: ReadonlyMap<number, { name: string; kind: 'snapshot' | 'event' | 'delta'; recordVersion: number; recordSize: number | null }> = new Map([
${sections
  .map((x) => {
    const d = recOf(x.record);
    const size = d?.kind === 'struct' ? d.size : null;
    return `  [${x.id}, { name: ${tsStr(x.name)}, kind: ${tsStr(x.kind)}, recordVersion: ${x.recordVersion}, recordSize: ${size} }],`;
  })
  .join('\n')}
]);

/** The chunk key of chunk (cx, cy) (§4.4), for cx and cy in −32,768 … 32,767. */
export function chunkKey(cx: number, cy: number): number {
  return (((cx + 32768) << 16) | ((cy + 32768) & 0xffff)) >>> 0;
}

/** The chunk of a key. */
export function chunkXY(key: number): [number, number] {
  return [(key >>> 16) - 32768, (key & 0xffff) - 32768];
}

/** The chunk holding tile coordinate \`t\` (32 tiles per chunk, flooring toward −∞). */
export function tileChunk(t: number): number {
  return t >> 5;
}

/** A rectangle of chunks, both corners included. */
export interface ChunkRect {
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
}

const clampChunk = (c: number): number => (c < -32768 ? -32768 : c > 32767 ? 32767 : c);

/**
 * The held set (§15.4): the chunks overlapping the view request's visible rectangle (tiles, upper bounds
 * exclusive) grown by one chunk on every side, within the chunk-key range; null when the rectangle is
 * empty. crates/schema's \`held_chunks\` is the same function.
 */
export function heldChunks(v: ${o.t(vr)}): ChunkRect | null {
  if (v.x1 <= v.x0 || v.y1 <= v.y0) return null;
  return {
    cx0: clampChunk(tileChunk(v.x0) - 1),
    cy0: clampChunk(tileChunk(v.y0) - 1),
    cx1: clampChunk(tileChunk(v.x1 - 1) + 1),
    cy1: clampChunk(tileChunk(v.y1 - 1) + 1),
  };
}

/** One section of a decoded packet: its directory entry and its bytes. */
export interface PacketSectionView {
  type: number;
  name: string;
  recordVersion: number;
  offset: number;
  byteLength: number;
  count: number;
  bytes: Uint8Array;
}

/** A decoded packet: its header and its sections, in ascending type. */
export interface Packet {
  header: ${o.t(ph)};
  sections: PacketSectionView[];
}

/**
 * Decodes and checks a packet (§15.4): the magic and version, known flags, a zero reserved field, the
 * length, a directory of known types in ascending order, each section 8-aligned inside the packet after
 * the previous one, with its declared record version, and fixed-record sections exactly count records long.
 */
export function decodePacket(bytes: Uint8Array): Packet {
  const r = new Reader(bytes);
  const header = ${o.c(ph)}.read(r, 'PacketHeader');
  if (header.magic !== PACKET_MAGIC) throw new DecodeError('bad_magic', 'PacketHeader.magic', 0);
  if (header.version !== PACKET_VERSION) throw new DecodeError('bad_version', 'PacketHeader.version', 4);
  if (header.byte_length !== bytes.length) throw new DecodeError('bad_length', 'PacketHeader.byte_length', 24);
  const sections: PacketSectionView[] = [];
  let last = 0;
  let end = PACKET_HEADER_SIZE + header.section_count * PACKET_DIRECTORY_ENTRY_SIZE;
  for (let i = 0; i < header.section_count; i++) {
    const at = r.pos;
    const e = ${o.c(se)}.read(r, 'SectionEntry');
    const facts = PACKET_SECTIONS.get(e.type);
    if (!facts) throw new DecodeError('unknown_type', 'SectionEntry.type', at);
    if (e.type <= last) throw new DecodeError('unsorted', 'SectionEntry.type', at);
    last = e.type;
    if (e.record_version !== facts.recordVersion) throw new DecodeError('bad_version', 'SectionEntry.record_version', at + 2);
    if (e.offset % 8 !== 0 || e.offset < end || e.offset + e.byte_length > bytes.length)
      throw new DecodeError('bad_length', 'SectionEntry.offset', at + 4);
    if (facts.recordSize !== null && e.byte_length !== e.count * facts.recordSize)
      throw new DecodeError('bad_count', 'SectionEntry.count', at + 12);
    end = e.offset + e.byte_length;
    sections.push({
      type: e.type,
      name: facts.name,
      recordVersion: e.record_version,
      offset: e.offset,
      byteLength: e.byte_length,
      count: e.count,
      bytes: bytes.subarray(e.offset, e.offset + e.byte_length),
    });
  }
  return { header, sections };
}

/** Writes a packet (§15.4): the header (state_gen and view_seq zero), a directory, sections 8-aligned in ascending type. */
export class PacketWriter {
  readonly w: Writer;
  private readonly start: number;
  private readonly declared: number;
  private written = 0;
  private last = 0;
  private open: { entry: number; at: number } | null = null;

  constructor(w: Writer, sections: number, tick: number, flags: number, daylight: number) {
    this.w = w;
    this.start = w.pos;
    this.declared = sections;
    ${o.c(ph)}.write(w, {
      magic: PACKET_MAGIC,
      version: PACKET_VERSION,
      flags,
      state_gen: 0,
      tick,
      view_seq: 0,
      daylight,
      section_count: sections,
      byte_length: 0,
    });
    w.zeros(sections * PACKET_DIRECTORY_ENTRY_SIZE);
  }

  /** Starts the next section; types must ascend. */
  section(type: number): void {
    const facts = PACKET_SECTIONS.get(type);
    if (!facts) throw new EncodeError('unknown_type', 'PacketWriter.section');
    if (this.open || this.written === this.declared || type <= this.last)
      throw new EncodeError('unsorted', 'PacketWriter.section');
    this.w.pad(this.start, 8);
    const entry = this.start + PACKET_HEADER_SIZE + this.written * PACKET_DIRECTORY_ENTRY_SIZE;
    this.w.patchU16(entry, type);
    this.w.patchU16(entry + 2, facts.recordVersion);
    this.w.patchU32(entry + 4, this.w.pos - this.start);
    this.open = { entry, at: this.w.pos };
    this.last = type;
  }

  /** Ends the open section with its record count. */
  end(count: number): void {
    if (!this.open) throw new EncodeError('inconsistent', 'PacketWriter.end');
    this.w.patchU32(this.open.entry + 8, this.w.pos - this.open.at);
    this.w.patchU32(this.open.entry + 12, count);
    this.open = null;
    this.written++;
  }

  /** Checks that every declared section was written and fills in the packet's length. */
  finish(): void {
    if (this.open || this.written !== this.declared) throw new EncodeError('bad_count', 'PacketWriter.finish');
    this.w.pad(this.start, 8);
    this.w.patchU32(this.start + 24, this.w.pos - this.start);
  }
}
`);
}

// ------------------------------------------------------------------------------------------- projections

function projections(s: Schema, o: TsOut): void {
  o.rt('Reader', 'Writer', 'DecodeError', 'EncodeError');
  const L = s.projections.limits;
  const kinds = s.projections.kinds;
  const withRec = kinds.filter((k) => k.record);
  const union = withRec
    .map((k) => `  | ({ kind: ${tsStr(k.name)} } & ${o.t(k.record as MessageDecl)})`)
    .join('\n');
  const qs = s.projections.queries;
  o.push(`/** Subscription and query limits (§15.5). */
${sortedEntries(L)
  .map(([k, x]) => `export const ${upperSnake(k)} = ${x};`)
  .join('\n')}

/** Each projection kind's facts (§15.5). */
export const PROJECTION_KINDS: ReadonlyMap<number, { name: string; cadence: 'every' | 'slow'; target: 'none' | 'entity' | 'player'; hasRecord: boolean }> = new Map([
${kinds.map((k) => `  [${k.id}, { name: ${tsStr(k.name)}, cadence: ${tsStr(k.cadence)}, target: ${tsStr(k.target)}, hasRecord: ${!!k.record} }],`).join('\n')}
]);

/** Each query kind's facts (§15.5). */
export const QUERY_KINDS: ReadonlyMap<number, { name: string; dev: boolean; hasResult: boolean }> = new Map([
${qs.map((q) => `  [${q.id}, { name: ${tsStr(q.name)}, dev: ${q.dev}, hasResult: ${!!q.result} }],`).join('\n')}
]);

/** A decoded projection record, by kind name. */
export type Projection =
${union};

/** Decodes the body of a UI record of kind id \`kind\` (status 0), which must fill \`body\` exactly. */
export function decodeProjection(kind: number, body: Uint8Array): Projection {
  const r = new Reader(body);
  let p: Projection;
  switch (kind) {
${withRec.map((k) => `    case ${k.id}:\n      p = { kind: ${tsStr(k.name)}, ...${o.c(k.record as MessageDecl)}.read(r) };\n      break;`).join('\n')}
    default:
      throw new DecodeError('unknown_type', 'UiRecord.kind', 0);
  }
  r.finish('UiRecord.body');
  return p;
}

/** Encodes a projection record's body. */
export function encodeProjection(w: Writer, p: Projection): void {
  switch (p.kind) {
${withRec.map((k) => `    case ${tsStr(k.name)}:\n      ${o.c(k.record as MessageDecl)}.write(w, p);\n      return;`).join('\n')}
  }
}

/** Writes one UI record (§15.5): the 16-byte header, the body that \`body\` writes, padding to 4. */
export function writeUiRecord(w: Writer, subId: number, kind: number, status: number, version: number, body: (w: Writer) => void): void {
  const start = w.pos;
  w.u32(subId, 'UiRecord.sub_id');
  w.u16(kind, 'UiRecord.kind');
  w.u16(status, 'UiRecord.status');
  w.u32(version, 'UiRecord.version');
  const lenAt = w.pos;
  w.u32(0, 'UiRecord.len');
  body(w);
  const len = w.pos - lenAt - 4;
  if (len > RECORD_MAX) throw new EncodeError('too_long', 'UiRecord.body');
  w.patchU32(lenAt, len);
  w.pad(start, 4);
}

/** The records of a UI section. */
export function readUiRecords(bytes: Uint8Array, count: number): ${o.t(decl(s, 'UiRecord'))}[] {
  const r = new Reader(bytes);
  const out: ${o.t(decl(s, 'UiRecord'))}[] = [];
  for (let i = 0; i < count; i++) out.push(${o.c(decl(s, 'UiRecord'))}.read(r));
  r.finish('UI');
  return out;
}
`);
}

// ------------------------------------------------------------------------------------------- container

function container(s: Schema, o: TsOut): void {
  o.rt('Reader', 'Writer', 'DecodeError', 'EncodeError', 'cmpBytes', 'sameBytes', 'utf8', 'fromUtf8');
  const sv = s.save;
  const clh = decl(s, 'ClosureLogHeader');
  const cr = decl(s, 'ClosureRecord');
  const lb = decl(s, 'LogBlob');
  const fr = decl(s, 'SectionFrame');
  o.rt('utf8');
  const headerValidator = jsonValidator(sv.header.types, sv.header.root, {
    prefix: 'SaveHeader',
    rootName: 'SaveHeader',
    rootDoc:
      "The save container's header (§8.1; sections.yaml save_header): metadata outside the state hash.",
    validator: 'validateSaveHeader',
    label: 'save header',
  });
  o.push(`/** The save container (§8.1). */
export const SAVE_MAGIC = ${tsStr(sv.magic)};
export const SAVE_FORMAT_VERSION = ${sv.formatVersion};
/** "PWCL" and the closure log's format (§8.5). */
export const CLOSURE_LOG_MAGIC = ${sv.closureLog.magic};
export const CLOSURE_LOG_FORMAT_VERSION = ${sv.closureLog.formatVersion};

/** The container header (§8.1): UTF-8 JSON with sorted keys, outside the state hash. */
${jsonHelpers(headerValidator)}
${headerValidator}
/** JSON with keys sorted at every level (the header's canonical text). */
function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return \`[\${v.map(sortedJson).join(',')}]\`;
  if (v !== null && typeof v === 'object')
    return \`{\${Object.keys(v as object)
      .sort()
      .map((k) => \`\${JSON.stringify(k)}:\${sortedJson((v as Record<string, unknown>)[k])}\`)
      .join(',')}}\`;
  return JSON.stringify(v);
}

/** Writes a save container (§8.1): magic, version, the header padded with spaces to a multiple of 8, the frames. */
export function writeSaveContainer(header: SaveHeader, frames: readonly ${o.t(fr)}[]): Uint8Array {
  validateSaveHeader(header);
  const w = new Writer();
  w.bytes(utf8(SAVE_MAGIC));
  w.u32(SAVE_FORMAT_VERSION, 'SaveContainer.format_version');
  let text = utf8(sortedJson(header));
  const total = 16 + text.length;
  const pad = (8 - (total % 8)) % 8;
  if (pad > 0) text = utf8(sortedJson(header) + ' '.repeat(pad));
  w.u32(text.length, 'SaveContainer.header_length');
  w.bytes(text);
  let last = -1;
  for (const f of frames) {
    if (f.id <= last) throw new EncodeError('unsorted', 'SectionFrame.id');
    last = f.id;
    ${o.c(fr)}.write(w, f);
  }
  return w.finish();
}

/** Reads a save container: the header (validated) and the frames, which must be in ascending id. */
export function readSaveContainer(bytes: Uint8Array): { header: SaveHeader; frames: ${o.t(fr)}[] } {
  const r = new Reader(bytes);
  const magic = r.take(8, 'SaveContainer.magic');
  if (!sameBytes(magic, utf8(SAVE_MAGIC))) throw new DecodeError('bad_magic', 'SaveContainer.magic', 0);
  if (r.u32('SaveContainer.format_version') !== SAVE_FORMAT_VERSION) throw new DecodeError('bad_version', 'SaveContainer.format_version', 8);
  const n = r.u32('SaveContainer.header_length');
  if ((16 + n) % 8 !== 0) throw new DecodeError('not_canonical', 'SaveContainer.header_length', 12);
  const text = fromUtf8(r.take(n, 'SaveContainer.header'));
  if (text === null) throw new DecodeError('bad_utf8', 'SaveContainer.header', 16);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DecodeError('not_canonical', 'SaveContainer.header', 16);
  }
  const header = validateSaveHeader(json);
  const frames: ${o.t(fr)}[] = [];
  let last = -1;
  while (!r.isEmpty) {
    const at = r.pos;
    const f = ${o.c(fr)}.read(r);
    if (f.id <= last) throw new DecodeError('unsorted', 'SectionFrame.id', at);
    last = f.id;
    frames.push(f);
  }
  return { header, frames };
}

/** A closure log (§8.5). */
export interface ClosureLog {
  header: ${o.t(clh)};
  records: ${o.t(cr)}[];
  /** The per-tick digests, digest_first_tick onward. */
  digests: bigint[];
  blobs: ${o.t(lb)}[];
}

/**
 * Parses and checks a closure log as the Rust \`ClosureLog::parse\` does (§8.5), with the same errors: every
 * region consumes exactly its declared bytes; records rise strictly within (start_tick, end_tick], are not
 * empty, and pass the preflight's framing rules for their tick (\`bad_framing\` at the failing batch or
 * action); the digest range lies in the tick range; blobs are sorted by hash without duplicates; every blob
 * an action names is present (\`bad_ref\` at that action).
 */
export function parseClosureLog(bytes: Uint8Array): ClosureLog {
  const r = new Reader(bytes);
  const header = ${o.c(clh)}.read(r, 'ClosureLogHeader');
  if (header.magic !== CLOSURE_LOG_MAGIC) throw new DecodeError('bad_magic', 'ClosureLogHeader.magic', 0);
  if (header.format_version !== CLOSURE_LOG_FORMAT_VERSION) throw new DecodeError('bad_version', 'ClosureLogHeader.format_version', 4);
  if (header.end_tick < header.start_tick) throw new DecodeError('range', 'ClosureLogHeader.end_tick', 12);
  const rec = r.sub(header.record_bytes, 'ClosureLog.records');
  const records: ${o.t(cr)}[] = [];
  const closuresAt: number[] = [];
  let last = header.start_tick;
  for (let i = 0; i < header.record_count; i++) {
    const at = rec.pos;
    const x = ${o.c(cr)}.read(rec);
    if (x.tick <= last || x.tick > header.end_tick) throw new DecodeError('unsorted', 'ClosureRecord.tick', at);
    try {
      ${o.imp('actions', 'checkFraming')}(x.closure, x.tick);
    } catch (e) {
      if (e instanceof ${o.imp('actions', 'PreflightError')}) throw new DecodeError('bad_framing', 'ClosureRecord.closure', at + 8 + e.at);
      throw e;
    }
    last = x.tick;
    records.push(x);
    closuresAt.push(at + 8);
  }
  rec.finish('ClosureLog.records');
  const hasDigests = (header.flags & 1) !== 0;
  if (!hasDigests && (header.digest_count !== 0 || header.digest_first_tick !== 0))
    throw new DecodeError('inconsistent', 'ClosureLogHeader.digest_count', 96);
  if (hasDigests && header.digest_count > 0) {
    const lo = header.digest_first_tick;
    const hi = lo + header.digest_count - 1;
    if (lo <= header.start_tick || hi > header.end_tick) throw new DecodeError('range', 'ClosureLogHeader.digest_first_tick', 96);
  }
  const dg = r.sub(header.digest_count * 8, 'ClosureLog.digests');
  const digests: bigint[] = [];
  for (let i = 0; i < header.digest_count; i++) digests.push(dg.u64('ClosureLog.digests'));
  const bl = r.sub(header.blob_bytes, 'ClosureLog.blobs');
  const blobs: ${o.t(lb)}[] = [];
  for (let i = 0; i < header.blob_count; i++) {
    const at = bl.pos;
    const x = ${o.c(lb)}.read(bl);
    const prev = blobs[blobs.length - 1];
    if (prev && cmpBytes(prev.sha256.bytes, x.sha256.bytes) >= 0) throw new DecodeError('unsorted', 'LogBlob.sha256', at);
    blobs.push(x);
  }
  bl.finish('ClosureLog.blobs');
  r.finish('ClosureLog');
  records.forEach((x, i) => {
    for (const a of ${o.imp('actions', 'closureActions')}(x.closure)) {
      let act: ReturnType<typeof ${o.imp('actions', 'decodeAction')}> | null = null;
      try {
        act = decodeAction(a.type, a.payload);
      } catch {
        act = null;
      }
      const h = act ? ${o.imp('actions', 'actionBlob')}(act) : null;
      if (h && !blobs.some((b) => cmpBytes(b.sha256.bytes, h) === 0))
        throw new DecodeError('bad_ref', 'ClosureLog.blobs', (closuresAt[i] as number) + a.at);
    }
  });
  return { header, records, digests, blobs };
}

/** Writes a closure log (§8.5); records must rise and blobs be sorted, as parseClosureLog requires. */
export function writeClosureLog(log: Omit<ClosureLog, 'header'> & { header: Omit<${o.t(clh)}, 'magic' | 'format_version' | 'record_count' | 'record_bytes' | 'digest_count' | 'blob_count' | 'blob_bytes'> }): Uint8Array {
  const rw = new Writer();
  for (const x of log.records) ${o.c(cr)}.write(rw, x);
  const recs = rw.finish();
  const bw = new Writer();
  for (const x of log.blobs) ${o.c(lb)}.write(bw, x);
  const blobs = bw.finish();
  const w = new Writer();
  ${o.c(clh)}.write(w, {
    ...log.header,
    magic: CLOSURE_LOG_MAGIC,
    format_version: CLOSURE_LOG_FORMAT_VERSION,
    record_count: log.records.length,
    record_bytes: recs.length,
    digest_count: log.digests.length,
    blob_count: log.blobs.length,
    blob_bytes: blobs.length,
  });
  w.bytes(recs);
  for (const d of log.digests) w.u64(d, 'ClosureLog.digests');
  w.bytes(blobs);
  return w.finish();
}
`);
}

// ------------------------------------------------------------------------------------------- abi

function abi(s: Schema, o: TsOut): void {
  o.rt('Reader', 'Writer', 'utf8');
  const st = decl(s, 'SimStatus');
  const sim = s.abi.exports.filter((e) => e.module === 'sim');
  const gen = s.abi.exports.filter((e) => e.module === 'gen');
  const sig = (e: (typeof s.abi.exports)[number]) => {
    const ps = [
      ...(e.input !== undefined || e.kind === 'input' ? ['len: number'] : []),
      ...e.params.map((p) => `${p.name}: number`),
    ];
    return `${e.name}(${ps.join(', ')}): number;`;
  };
  o.push(`/** sim_abi_version() and gen_abi_version() (abi.yaml). */
export const ABI_VERSION = ${s.versions.abi};
export const GEN_ABI_VERSION = ${s.versions.genAbi};

/** Every sim.wasm export, in schema order (§15.8). */
export const SIM_EXPORTS = [${sim.map((e) => tsStr(e.name)).join(', ')}] as const;
/** Every gen.wasm export (§15.9). */
export const GEN_EXPORTS = [${gen.map((e) => tsStr(e.name)).join(', ')}] as const;
/** The imports both modules may use, from module \`env\` (§15.8). */
export const IMPORTS = [${s.abi.imports.map((i) => tsStr(i.name)).join(', ')}] as const;

/** sim.wasm's exports as the shell sees them (pointers and lengths are u32). */
export interface SimExports {
  memory: { buffer: ArrayBuffer };
${sim.map((e) => `  ${sig(e)}`).join('\n')}
}

/** gen.wasm's exports. */
export interface GenExports {
  memory: { buffer: ArrayBuffer };
${gen.map((e) => `  ${sig(e)}`).join('\n')}
}

/** The names a module's exports lack or have beyond the schema's (\`memory\` included). */
export function checkExports(exports: Readonly<Record<string, unknown>>, module: 'sim' | 'gen'): { missing: string[]; extra: string[] } {
  const want = new Set<string>(['memory', ...(module === 'sim' ? SIM_EXPORTS : GEN_EXPORTS)]);
  const have = new Set(Object.keys(exports));
  return { missing: [...want].filter((n) => !have.has(n)), extra: [...have].filter((n) => !want.has(n)) };
}

/** A failed export: the status (SimStatus) and the module's message (sim_last_error). */
export class SimError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(\`\${${o.c(st)}.name(status) ?? \`status \${status}\`}: \${message}\`);
    this.status = status;
  }
}

/**
 * Typed calls into a module through its exports (§15.8's calling convention): inputs go through
 * \`<m>_input(len)\`, status exports throw SimError, envelope exports return a copy of their bytes. The wrapper
 * never keeps a view of linear memory across a call (the shell's MemoryLease owns longer-lived views, §3.6).
 */
class ModuleCalls {
  protected readonly e: { memory: { buffer: ArrayBuffer } } & Record<string, unknown>;
  private readonly prefix: string;
  constructor(e: { memory: { buffer: ArrayBuffer } }, prefix: 'sim' | 'gen') {
    this.e = e as { memory: { buffer: ArrayBuffer } } & Record<string, unknown>;
    this.prefix = prefix;
  }
  protected call(name: string, ...args: number[]): number {
    return ((this.e[name] as (...a: number[]) => number)(...args) >>> 0) as number;
  }
  /** Copies \`bytes\` into the input buffer and returns their length. */
  protected input(bytes: Uint8Array): number {
    const p = this.call(\`\${this.prefix}_input\`, bytes.length);
    if (p === 0 && bytes.length > 0) throw new SimError(${(st as { values: { name: string; value: number }[] }).values.find((v) => v.name === 'err_input')?.value}, 'the input buffer cannot grow');
    new Uint8Array(this.e.memory.buffer, p, bytes.length).set(bytes);
    return bytes.length;
  }
  /** The error of the last failing call. */
  lastError(): SimError {
    const p = this.call(\`\${this.prefix}_last_error\`);
    if (p === 0) return new SimError(0, 'no error');
    const b = this.envelope(p);
    const r = new Reader(b);
    const code = r.u32('ErrorEnvelope.code');
    return new SimError(code, new TextDecoder('utf-8', { ignoreBOM: true }).decode(r.rest()));
  }
  protected status(code: number): void {
    if (code !== 0) throw this.lastError();
  }
  /** A copy of the envelope at \`p\` (\`{u32 len, bytes}\`), or SimError when \`p\` is 0. */
  protected envelope(p: number): Uint8Array {
    if (p === 0) throw this.lastError();
    const view = new DataView(this.e.memory.buffer);
    const len = view.getUint32(p, true);
    return new Uint8Array(this.e.memory.buffer.slice(p + 4, p + 4 + len));
  }
}

/** sim.wasm (§15.8). */
export class SimModule extends ModuleCalls {
  constructor(e: SimExports) {
    super(e, 'sim');
  }
  abiVersion(): number {
    return this.call('sim_abi_version');
  }
  schemaHash(): Uint8Array {
    return this.envelope(this.call('sim_schema_hash'));
  }
  memoryEpoch(): number {
    return this.call('sim_memory_epoch');
  }
${sim
  .filter(
    (e) =>
      !['sim_abi_version', 'sim_schema_hash', 'sim_memory_epoch', 'sim_input', 'sim_last_error'].includes(
        e.name,
      ),
  )
  .map((e) => {
    const m = e.name.replace(/^sim_/, '').replace(/_([a-z])/g, (_x, c: string) => c.toUpperCase());
    const args = e.params.map((p) => `${p.name}: number`);
    const inArg = e.input !== undefined ? ['input: Uint8Array'] : [];
    const call = `this.call(${tsStr(e.name)}${e.input !== undefined ? ', this.input(input)' : ''}${e.params.map((p) => `, ${p.name}`).join('')})`;
    const doc = `  /** ${e.name}${e.input ? `: input ${e.input}` : ''}${e.output ? `, output ${e.output}` : ''}${e.doc ? ` (${e.doc})` : ''}. */\n`;
    if (e.kind === 'status')
      return `${doc}  ${m}(${[...inArg, ...args].join(', ')}): void {\n    this.status(${call});\n  }`;
    return `${doc}  ${m}(${[...inArg, ...args].join(', ')}): Uint8Array {\n    return this.envelope(${call});\n  }`;
  })
  .join('\n')}
}

/** gen.wasm (§15.9). */
export class GenModule extends ModuleCalls {
  constructor(e: GenExports) {
    super(e, 'gen');
  }
  abiVersion(): number {
    return this.call('gen_abi_version');
  }
  schemaHash(): Uint8Array {
    return this.envelope(this.call('gen_schema_hash'));
  }
${gen
  .filter((e) => !['gen_abi_version', 'gen_schema_hash', 'gen_input', 'gen_last_error'].includes(e.name))
  .map((e) => {
    const m = e.name.replace(/^gen_/, '').replace(/_([a-z])/g, (_x, c: string) => c.toUpperCase());
    const args = e.params.map((p) => `${p.name}: number`);
    const inArg = e.input !== undefined ? ['input: Uint8Array'] : [];
    const call = `this.call(${tsStr(e.name)}${e.input !== undefined ? ', this.input(input)' : ''}${e.params.map((p) => `, ${p.name}`).join('')})`;
    return `  /** ${e.name}${e.output ? `: output ${e.output}` : ''}. */\n  ${m}(${[...inArg, ...args].join(', ')}): Uint8Array {\n    return this.envelope(${call});\n  }`;
  })
  .join('\n')}
}
`);
  void pascal;
}

// ------------------------------------------------------------------------------------------- registries

function registries(s: Schema, o: TsOut): void {
  o.push(`${s.registries
    .map((r) => {
      const names = r.enumDecl ? r.enumDecl.values.map((v) => v.name) : (r.strings ?? []);
      return `/** ${r.doc ?? r.name} */\nexport const ${upperSnake(r.name)}: readonly string[] = [${names.map(tsStr).join(', ')}];`;
    })
    .join('\n\n')}

/** Names the engine must know (§2.4 step 4), resolved by name when Protos loads. */
export const WELL_KNOWN: readonly { name: string; kind: string }[] = [${s.wellKnown.map((w) => `{ name: ${tsStr(w.name)}, kind: ${tsStr(w.kind)} }`).join(', ')}];
`);
}

// ------------------------------------------------------------------------------------------- capabilities

function capabilities(s: Schema, caps: Capabilities, o: TsOut): void {
  const set = (xs: readonly string[]) => `new Set([${xs.map(tsStr).join(', ')}])`;
  o.push(`/** The capability manifest this build implements (game/data/engine/capabilities.yaml \`current\`, §2.4). */
export const CAPABILITY_MANIFEST = ${tsStr(caps.name)};
/** The actions the sim implements; any other one decodes and is refused as \`unsupported\` (§15.3). */
export const SUPPORTED_ACTIONS: ReadonlySet<string> = ${set([...caps.actions, ...caps.systemActions])};
/** The projections the module produces (§15.5). */
export const SUPPORTED_PROJECTIONS: ReadonlySet<string> = ${set(caps.projections)};
/** The queries the module answers (§15.5). */
export const SUPPORTED_QUERIES: ReadonlySet<string> = ${set(caps.queries)};
/** The packet sections the module writes (§15.4). */
export const SUPPORTED_PACKET_SECTIONS: ReadonlySet<string> = ${set(caps.packetSections)};
/** The META blocks of prototypes.bin this engine reads (C1a-r1 finding 5). */
export const REQUIRED_DATA: readonly string[] = [${caps.data.map(tsStr).join(', ')}];
/** The registry entries this milestone implements (§2.4 step 4). */
export const IMPLEMENTED_REGISTRIES = {
  effects: [${caps.registries.effects.map(tsStr).join(', ')}] as readonly string[],
  triggers: [${caps.registries.triggers.map(tsStr).join(', ')}] as readonly string[],
  achievement_conditions: [${caps.registries.achievement_conditions.map(tsStr).join(', ')}] as readonly string[],
  formula_refs: [${caps.registries.formula_refs.map(tsStr).join(', ')}] as readonly string[],
};

/**
 * The parts of REQUIRED_DATA a build's contents record (prototypes.json, build-manifest.json and
 * prototypes.bin's META) does not carry: the shell refuses such a build (C1a-r1 finding 5).
 */
export function missingData(contents: { meta: readonly string[]; omitted: readonly string[] }): string[] {
  return REQUIRED_DATA.filter((b) => !contents.meta.includes(b) || contents.omitted.includes(b));
}
`);
  void s;
}
