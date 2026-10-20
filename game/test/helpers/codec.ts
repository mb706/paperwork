// Helpers for the codec fixture tests (test/fixtures/codec): the entry files, the probes, the hand-written
// spec/*.hex fixtures, verdicts and round trips by type name. crates/sim/tests/codec_fixtures/main.rs reads the
// same files the same way.
import {
  type Action,
  actionBytes,
  decodeAction,
  dumpAction,
  PLAYERS,
  PreflightError,
  preflight,
} from '../../src/shared/gen/actions.ts';
import { DecodeError, Dump, Reader, Writer } from '../../src/shared/gen/codec.ts';
import { parseClosureLog } from '../../src/shared/gen/container.ts';
import {
  dumpEvent,
  type EventHeader,
  EventHeaderCodec,
  type EventPayload,
  readEvent,
  writeEvent,
} from '../../src/shared/gen/events.ts';
import { CODECS, TABLES } from '../../src/shared/gen/samples.ts';

const VARIANTS = ['zero', 'mixed', 'max'] as const;

export interface Entry {
  name: string;
  variant: (typeof VARIANTS)[number];
  /** FNV-1a of the reference codec's dump. */
  dumpHash: number;
  bytes: Uint8Array;
}

/** actions.bin and records.bin: u16 name length, name, u8 variant, u32 dump hash, u32 length, bytes. */
export function parseEntries(bytes: Uint8Array): Entry[] {
  const r = new Reader(bytes);
  const out: Entry[] = [];
  while (!r.isEmpty) {
    const name = new TextDecoder().decode(r.take(r.u16('entry'), 'entry'));
    const variant = VARIANTS[r.u8('entry')] ?? 'max';
    const dumpHash = r.u32('entry');
    out.push({ name, variant, dumpHash, bytes: r.take(r.u32('entry'), 'entry') });
  }
  return out;
}

export interface Probe {
  kind: string;
  target: string;
  name: string;
  verdict: string;
  bytes: Uint8Array;
}

export function fromHex(hex: string): Uint8Array {
  const digits = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(digits.length >> 1);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(digits.slice(2 * i, 2 * i + 2), 16) || 0;
  return bytes;
}

/** probes.txt: `<kind>:<target> <name> <verdict…> <hex>` lines; `#` starts a comment line. */
export function parseProbes(text: string): Probe[] {
  return text
    .split('\n')
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => {
      const t = l.split(' ');
      const [kind, target] = (t[0] as string).split(':') as [string, string];
      return {
        kind,
        target,
        name: t[1] as string,
        verdict: t.slice(2, -1).join(' '),
        bytes: fromHex(t[t.length - 1] as string),
      };
    });
}

/** The verdict of a decode, as probes.txt spells it. */
export function verdictOf(f: () => unknown): string {
  try {
    f();
    return 'ok';
  } catch (e) {
    if (e instanceof DecodeError) return `${e.kind} ${e.field} @${e.at}`;
    throw e;
  }
}

/** Decodes a framed action (u16 type, u16 len, payload) as Action::decode does. */
export function decodeFramed(bytes: Uint8Array): Action {
  if (bytes.length < 4) throw new DecodeError('truncated', 'Action', 0);
  const type = (bytes[0] as number) | ((bytes[1] as number) << 8);
  return decodeAction(type, bytes.subarray(4));
}

function sameBytes(a: Uint8Array, b: Uint8Array): string | null {
  if (a.length === b.length && a.every((x, i) => x === b[i])) return null;
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  return `re-encoding differs at byte ${at}: ${a.length} bytes against the fixture's ${b.length}`;
}

/** Decodes `bytes` as the named type (records strictly), re-encodes (same bytes) and dumps it. */
export function roundTrip(name: string, bytes: Uint8Array): string {
  const c = CODECS[name];
  if (!c) throw new Error(`no such type ${name}`);
  const v = c.decode(bytes);
  const diff = sameBytes(c.encode(v), bytes);
  if (diff) throw new Error(diff);
  const d = new Dump();
  c.dump(d, v);
  return d.out;
}

/** Round-trips a framed action and dumps it (`type=` line first). */
export function roundTripAction(bytes: Uint8Array): string {
  const a = decodeFramed(bytes);
  const diff = sameBytes(actionBytes(a), bytes);
  if (diff) throw new Error(diff);
  const d = new Dump();
  dumpAction(d, a);
  return d.out;
}

/** One EVENTS record (the header, its payload, the padding) that fills `bytes`, read as the main thread does. */
export function readOneEvent(bytes: Uint8Array): { header: EventHeader; payload: EventPayload } {
  const r = new Reader(bytes);
  const e = readEvent(r);
  r.finish('EVENTS');
  return e;
}

/** Reads one EVENTS record, writes it again (same bytes) and dumps it: `header.` fields, then the payload. */
export function roundTripEvent(bytes: Uint8Array): string {
  const { header, payload } = readOneEvent(bytes);
  const w = new Writer();
  const { type: _type, len: _len, ...meta } = header;
  writeEvent(w, meta, payload);
  const diff = sameBytes(w.finish(), bytes);
  if (diff) throw new Error(diff);
  const d = new Dump();
  EventHeaderCodec.dump(d, header, 'header.');
  dumpEvent(d, payload);
  return d.out;
}

/** FNV-1a (32-bit) of a string's UTF-8 bytes. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}

export interface HexCase {
  file: string;
  line: number;
  /** A schema type's name, `@action` or `@closure`. */
  target: string;
  /** `@closure`'s parameters. */
  params: string;
  bytes: Uint8Array;
  expect: { dump: string } | { ok: string } | { error: string };
}

/** A spec/*.hex file (game/schema/README.md, "Fixtures"); crates/sim/tests/codec_fixtures/main.rs reads it too. */
export function parseHexFile(file: string, text: string): HexCase[] {
  const out: HexCase[] = [];
  let cur: HexCase | null = null;
  let hex = '';
  let inDump = false;
  const flush = () => {
    if (cur) out.push({ ...cur, bytes: fromHex(hex) });
    cur = null;
    hex = '';
  };
  text.split('\n').forEach((raw, i) => {
    const l = raw.trimEnd();
    if (l.startsWith('#') || l === '') return;
    if (l.startsWith('@')) {
      const d = (l.split(' #')[0] ?? '').trim();
      const sp = d.indexOf(' ');
      const word = sp < 0 ? d : d.slice(0, sp);
      const rest = sp < 0 ? '' : d.slice(sp + 1).trim();
      const start = (target: string, params = ''): HexCase => ({
        file,
        line: i + 1,
        target,
        params,
        bytes: new Uint8Array(),
        expect: { dump: '' },
      });
      inDump = false;
      if (word === '@type') {
        flush();
        cur = start(rest);
      } else if (word === '@action') {
        flush();
        cur = start('@action');
      } else if (word === '@event' || word === '@closure_log') {
        flush();
        cur = start(word);
      } else if (word === '@table' || word === '@lenient') {
        flush();
        cur = start(word, rest);
      } else if (word === '@closure') {
        flush();
        cur = start('@closure', rest);
      } else if (word === '@dump') inDump = true;
      else if (word === '@ok') {
        if (cur) cur.expect = { ok: `ok ${rest}`.trim() };
      } else if (word === '@error') {
        if (cur) cur.expect = { error: rest };
      } else if (word === '@end') flush();
      else throw new Error(`${file}:${i + 1}: unknown directive ${word}`);
    } else if (inDump) {
      const c = cur as HexCase | null;
      if (c && 'dump' in c.expect) c.expect = { dump: `${c.expect.dump}${l}\n` };
    } else hex += l.split('//')[0] ?? '';
  });
  flush();
  return out;
}

/** Runs the preflight with `tick=… last_seq=p:s,… system_seq=… blobs=h,…` and spells its verdict. */
export function closureVerdict(params: string, bytes: Uint8Array): string {
  let tick = 0;
  const lastSeq = new Array<number>(PLAYERS).fill(0);
  let systemSeq = 0;
  let blobs: string[] = [];
  for (const kv of params.split(/\s+/).filter((x) => x !== '')) {
    const [k, v = ''] = kv.split('=') as [string, string?];
    if (k === 'tick') tick = Number(v);
    else if (k === 'system_seq') systemSeq = Number(v);
    else if (k === 'last_seq')
      for (const pair of v.split(',').filter((x) => x !== '')) {
        const [p, q] = pair.split(':');
        lastSeq[Number(p)] = Number(q);
      }
    else if (k === 'blobs')
      blobs = v
        .split(',')
        .filter((x) => x !== '')
        .map((h) => h.toLowerCase());
    else throw new Error(`unknown @closure parameter ${k}`);
  }
  const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  try {
    const s = preflight(bytes, tick, lastSeq, systemSeq, (h) => blobs.includes(hexOf(h)));
    return `ok batches=${s.batches} actions=${s.actions}`;
  } catch (e) {
    if (e instanceof PreflightError) return `${e.code} @${e.at}`;
    throw e;
  }
}

/** A closure log through parseClosureLog: `ok records=N digests=M blobs=K`, or the refusal. */
export function closureLogVerdict(bytes: Uint8Array): string {
  try {
    const l = parseClosureLog(bytes);
    return `ok records=${l.records.length} digests=${l.digests.length} blobs=${l.blobs.length}`;
  } catch (e) {
    if (e instanceof DecodeError) return `${e.kind} ${e.field} @${e.at}`;
    throw e;
  }
}

/** A column table decoded, encoded again (same bytes): `ok rows=N`, or the refusal. */
export function tableVerdict(name: string, bytes: Uint8Array): string {
  const t = TABLES[name];
  if (!t) return 'no such table';
  try {
    const rows = t.decode(bytes);
    const diff = sameBytes(t.encode(rows), bytes);
    if (diff) return diff;
    return `ok rows=${rows.length}`;
  } catch (e) {
    if (e instanceof DecodeError) return `${e.kind} ${e.field} @${e.at}`;
    throw e;
  }
}

/** A record decoded leniently (§8.3) and dumped. */
export function lenientDump(name: string, bytes: Uint8Array): string {
  const c = CODECS[name];
  if (!c?.lenient) throw new Error(`no such record ${name}`);
  const d = new Dump();
  c.dump(d, c.lenient(bytes));
  return d.out;
}

/** An expected refusal matches a verdict exactly, or by its kind when it names only the kind. */
export function refusalMatches(want: string, got: string): boolean {
  return want.includes(' ') ? got === want : got.split(' ')[0] === want;
}
