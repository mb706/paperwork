// The golden ABI traces (10 §15.8, §15.10; GATE-r1 findings 10 and 11): call sequences against the module's
// exports, each call with its input bytes, its expected status, its expected envelope, and, for a refusal, the
// assertion that the state did not change. The reference model's Module produces them; the sim's module must
// answer every call identically, the shell drives the same sequences, and the renderer and UI read the packets
// and records they hold. m0/abi/traces.json is the machine-readable index (README "ABI traces").
import {
  InitInputCodec,
  LoadInputCodec,
  LoadReportCodec,
  PendingChunksCodec,
  QueryInputCodec,
  QueryStepOutputCodec,
  SaveOutputCodec,
  SimMetaCodec,
  SimStatus,
  SubscribeInputCodec,
  UnsubscribeInputCodec,
} from '../../../src/shared/gen/abi.ts';
import { Dump } from '../../../src/shared/gen/codec.ts';
import { decodePacket, type ViewRequest, ViewRequestCodec } from '../../../src/shared/gen/packet.ts';
import { DigestResultCodec, StateHashCodec, type SubRequest } from '../../../src/shared/gen/projections.ts';
import { SimFlags } from '../../../src/shared/gen/types.ts';
import { dumpPacket } from '../../helpers/packets.ts';
import { type CallResult, Module } from '../model/module.ts';

export const STATUS_NAME = new Map(Object.entries(SimStatus).map(([k, v]) => [v as number, k]));

/** One call of a trace, as written: its input (or parameters), and what to expect. */
export interface TraceCall {
  call: string;
  in?: Uint8Array;
  params?: number[];
  /** Why this call is here. */
  note?: string;
}

export interface Trace {
  name: string;
  why: string;
  calls: TraceCall[];
}

/** A call as recorded: what the model answered. */
export interface Recorded extends TraceCall {
  status: string;
  out?: Uint8Array;
  /**
   * Whether the full state hash after the call equals the one before it (`unchanged`) or not (`changed`);
   * absent when no world existed before or after. Every refusal is `unchanged` (§15.3, §15.8).
   */
  state?: 'unchanged' | 'changed';
}

/** Runs one call against a module (the dispatcher every trace consumer reimplements over its own module). */
export function invoke(m: Module, c: TraceCall): CallResult {
  const input = c.in ?? new Uint8Array();
  const p = c.params ?? [];
  switch (c.call) {
    case 'sim_init':
      return m.sim_init(input);
    case 'sim_new_world':
      return m.sim_new_world(input);
    case 'sim_load':
      return m.sim_load(input);
    case 'sim_tick':
      return m.sim_tick(input);
    case 'sim_set_flags':
      return m.sim_set_flags(p[0] ?? 0);
    case 'sim_blob_put':
      return m.sim_blob_put(input);
    case 'sim_supply_chunk':
      return m.sim_supply_chunk(input);
    case 'sim_pending_chunks':
      return m.sim_pending_chunks();
    case 'sim_extract':
      return m.sim_extract(input);
    case 'sim_subscribe':
      return m.sim_subscribe(input);
    case 'sim_unsubscribe':
      return m.sim_unsubscribe(input);
    case 'sim_query':
      return m.sim_query(input);
    case 'sim_query_step':
      return m.sim_query_step(p[0] ?? 0);
    case 'sim_query_cancel':
      return m.sim_query_cancel(p[0] ?? 0);
    case 'sim_digest':
      return m.sim_digest();
    case 'sim_state_hash':
      return m.sim_state_hash();
    case 'sim_save':
      return m.sim_save(input);
    case 'sim_meta':
      return m.sim_meta();
    case 'sim_load_report':
      return m.sim_load_report();
    case 'gen_init':
      return m.gen_init(input);
    case 'gen_preview':
      return m.gen_preview(input);
    default:
      throw new Error(`no export ${c.call}`);
  }
}

const stateHash = (m: Module): bigint | null => (m.sim ? m.sim.w.stateHash().hash : null);

/**
 * Runs a trace through a fresh module and records every answer. Every refusal must leave the state as it was
 * (§15.3, §15.8): the model proves it, and the trace says so.
 */
export function record(t: Trace): Recorded[] {
  const m = new Module();
  return t.calls.map((c) => {
    const before = stateHash(m);
    const r = invoke(m, c);
    const after = stateHash(m);
    const out: Recorded = { ...c, status: STATUS_NAME.get(r.status) ?? String(r.status) };
    if (r.out) out.out = r.out;
    if (r.status !== SimStatus.ok && before !== after)
      throw new Error(`${t.name}: ${c.call} was refused (${out.status}) and changed the state`);
    if (before !== null && after !== null) out.state = before === after ? 'unchanged' : 'changed';
    return out;
  });
}

/** traces.json's entry for one call: files by path under m0/, parameters inline. */
export interface IndexedCall {
  call: string;
  in: string | null;
  params?: number[];
  status: string;
  out: string | null;
  state?: 'unchanged' | 'changed';
  note?: string;
}

/** Replays an indexed trace against a fresh module: the problems, or none (what golden.test.ts runs). */
export function replay(calls: readonly IndexedCall[], read: (path: string) => Uint8Array): string[] {
  const m = new Module();
  const problems: string[] = [];
  calls.forEach((c, i) => {
    const before = stateHash(m);
    const r = invoke(m, { call: c.call, in: c.in ? read(c.in) : new Uint8Array(), params: c.params ?? [] });
    const after = stateHash(m);
    const status = STATUS_NAME.get(r.status) ?? String(r.status);
    if (status !== c.status) problems.push(`call ${i + 1} ${c.call}: ${status}, expected ${c.status}`);
    if ((c.out === null) !== (r.out === undefined))
      problems.push(`call ${i + 1} ${c.call}: envelope presence`);
    if (c.out && r.out && Buffer.compare(read(c.out), r.out) !== 0)
      problems.push(`call ${i + 1} ${c.call}: envelope differs`);
    const state =
      before !== null && after !== null ? (before === after ? 'unchanged' : 'changed') : undefined;
    if (state !== c.state) problems.push(`call ${i + 1} ${c.call}: state ${state}, expected ${c.state}`);
  });
  return problems;
}

// ------------------------------------------------------------------------------------------------- inputs

export const initInput = (protosBin: Uint8Array, flags = 0): Uint8Array =>
  InitInputCodec.encode({ protos: protosBin, flags });

export const loadInput = (
  sections: readonly { id: number; version: number; data: Uint8Array }[],
  r: bigint,
  remaps: { kind: number; ids: number[]; removed: { name: Uint8Array }[] }[] = [],
): Uint8Array =>
  LoadInputCodec.encode({
    sections: sections.map((f) => ({
      id: f.id,
      version: f.version,
      codec: 0,
      flags: 1,
      raw_length: f.data.length,
      data: f.data,
    })),
    remaps,
    r,
  });

export const subscribeInput = (subs: SubRequest[]): Uint8Array => SubscribeInputCodec.encode({ subs });
export const unsubscribeInput = (ids: number[]): Uint8Array => UnsubscribeInputCodec.encode({ ids });
export const viewInput = (v: ViewRequest): Uint8Array => ViewRequestCodec.encode(v);
export const queryInput = (id: number, kind: number, params: Uint8Array = new Uint8Array()): Uint8Array =>
  QueryInputCodec.encode({ id, header: { kind, flags: 0 }, params });

export const FLAGS = SimFlags;

/** The envelope codec of each export with an envelope (abi.yaml `sim_exports` `out`). */
const OUT_CODECS: Record<
  string,
  { decode(b: Uint8Array): unknown; dump(d: Dump, v: never, p?: string): void }
> = {
  sim_meta: SimMetaCodec as never,
  sim_load_report: LoadReportCodec as never,
  sim_digest: DigestResultCodec as never,
  sim_state_hash: StateHashCodec as never,
  sim_pending_chunks: PendingChunksCodec as never,
  sim_query_step: QueryStepOutputCodec as never,
  sim_save: SaveOutputCodec as never,
};

/** A review dump of a recorded envelope: packets as packets, records and messages with their codecs. */
export function dumpOut(call: string, b: Uint8Array): string {
  if (call === 'sim_extract') {
    decodePacket(b);
    return dumpPacket(b);
  }
  const codec = OUT_CODECS[call];
  if (!codec) throw new Error(`no envelope codec for ${call}`);
  const d = new Dump();
  codec.dump(d, codec.decode(b) as never, '');
  return d.out;
}
