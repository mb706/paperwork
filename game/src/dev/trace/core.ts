// The cross-engine trace (10 §10.4 #6, §10.5 "The trace page"; D18 d; C8), as one piece of code that runs the same
// way in Node (in-process) and in a browser's module worker (test/trace/worker.ts, the trace page
// test/trace.html): a closure log and its start state, replayed through sim.wasm, two ways.
//
// 1. `moduleTrace`: the shell's own module layer (src/simworker/module.ts's SimInstance, the ReplaySource that
//    writes each closure into linear memory, blobs before their tick, the HISTORICAL flag as in a replay), tick by
//    tick, recording d_t and r_t after every tick and the full state hash (§4.8) on the ticks `schedule` names.
//    `simtool replay --trace --full` prints the same columns natively.
// 2. `shellReplay`: the real sim worker's shell (src/simworker/shell.ts, SimShell) loading the start and running
//    the log in its replay mode, which checks every d_t against the digests the log carries (recorded natively),
//    catching up in slices with extraction off (§3.3). Its digest ring gives the d_t trace, then the final state
//    hash and r.
//
// Both accept the start as a save container (`SITESAV`, raw or deflated sections) or as `sim_save`'s output (the
// scenario sessions' `.start` files and the golden `states/*.sections`).
import { inflateSync } from 'fflate';
import { InitInputCodec } from '../../shared/gen/abi.ts';
import { Writer } from '../../shared/gen/codec.ts';
import {
  type ClosureLog,
  parseClosureLog,
  readSaveContainer,
  type SaveHeader,
  SectionFrameCodec,
} from '../../shared/gen/container.ts';
import { DigestResultCodec, StateHashCodec } from '../../shared/gen/projections.ts';
import { SimFlags } from '../../shared/gen/types.ts';
import type { BuildManifest, SaveMeta, SimToMain } from '../../shared/protocol.ts';
import { hexOf, sha256 } from '../../shared/sha256.ts';
import { instantiateSim } from '../../simworker/module.ts';
import { ReplaySource } from '../../simworker/sequencer.ts';
import { type ShellHost, SimShell } from '../../simworker/shell.ts';
import { selfPostWaker } from '../../simworker/waker.ts';

export const hex16 = (v: bigint): string => v.toString(16).padStart(16, '0');
const u64 = (lo: number, hi: number): bigint => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);

/** Which ticks get the full state hash: every tick up to `everyUntil`, then every `thenEvery`-th tick, and the last. */
export interface Schedule {
  everyUntil: number;
  thenEvery: number;
}

/** §10.4 #6: every tick of a short adversarial log; D18 a's cadence (2,000, then every 600) for a long one. */
export function scheduleFor(ticks: number): Schedule {
  return ticks <= 3600 ? { everyUntil: ticks, thenEvery: 1 } : { everyUntil: 2000, thenEvery: 600 };
}

export const hashedAt = (s: Schedule, k: number, last: number): boolean =>
  k <= s.everyUntil || k === last || (s.thenEvery > 0 && k % s.thenEvery === 0);

export interface TraceInput {
  module: WebAssembly.Module;
  protos: Uint8Array;
  /** A save container or `sim_save`'s output. */
  start: Uint8Array;
  log: Uint8Array;
  schedule?: Schedule;
}

/** One tick of a trace, in hex: d_t, r_t and, on scheduled ticks, the full state hash. */
export interface TraceRow {
  tick: number;
  d: string;
  r: string;
  hash: string | null;
}

export interface ModuleTrace {
  startTick: number;
  endTick: number;
  startHash: string;
  rows: TraceRow[];
  finalHash: string;
  finalR: string;
  /** The first tick whose d_t differs from the log's recorded digest, if the log has digests. */
  logMismatch: number | null;
  ms: number;
}

export interface ShellReplay {
  ok: boolean;
  tick: number;
  message?: string;
  mismatch?: { tick: number; expected: string; actual: string };
  /** d_t of every replayed tick, from the shell's digest ring. */
  digests: string[];
  finalHash: string;
  finalR: string;
  ms: number;
}

const SAVE_MAGIC = [0x53, 0x49, 0x54, 0x45, 0x53, 0x41, 0x56, 0x00]; // "SITESAV\0"

/** The start as `world load` and `sim_load` take it: the sections region (raw frames) and its meta. */
export function startSections(
  start: Uint8Array,
  protosHash: string,
): { sections: Uint8Array; meta: SaveMeta } {
  if (SAVE_MAGIC.every((b, i) => start[i] === b)) {
    const c = readSaveContainer(start);
    const w = new Writer();
    w.u32(c.frames.length, 'sections');
    for (const f of c.frames) {
      // A deflated section (§8.1, codec 1: fflate's raw DEFLATE) goes to the module inflated, as the IO worker
      // hands it over.
      const data = f.codec === 1 ? inflateSync(f.data) : f.data;
      if (data.length !== f.raw_length)
        throw new Error(`section ${f.id}: ${data.length} bytes, not ${f.raw_length}`);
      SectionFrameCodec.write(w, { ...f, codec: 0, data });
    }
    const meta: SaveMeta = {
      lineage: c.header.lineage,
      prototypesHash: c.header.prototypesHash,
      tick: c.header.tick,
      header: c.header as SaveHeader,
    };
    return { sections: w.finish(), meta };
  }
  // `sim_save`'s output: the sections region, then the lineage r (u64).
  const dv = new DataView(start.buffer, start.byteOffset, start.byteLength);
  const r = u64(dv.getUint32(start.length - 8, true), dv.getUint32(start.length - 4, true));
  return {
    sections: start.subarray(0, start.length - 8),
    meta: { lineage: hex16(r), prototypesHash: protosHash, tick: -1 },
  };
}

/** `LoadInput` (§15.8): the sections, no remap tables, the lineage. */
function loadInput(sections: Uint8Array, lineage: string): Uint8Array {
  const tail = new Writer();
  tail.u16(0, 'LoadInput.kind_count');
  tail.u64(BigInt(`0x${lineage}`), 'LoadInput.r');
  const rest = tail.finish();
  const out = new Uint8Array(sections.length + rest.length);
  out.set(sections, 0);
  out.set(rest, sections.length);
  return out;
}

const quiet = { log: () => {}, now: () => 0 };

/** Replays the log through the shell's module layer, tick by tick (see the header, part 1). */
export async function moduleTrace(input: TraceInput): Promise<ModuleTrace> {
  const t0 = performance.now();
  const protosHash = hexOf(sha256(input.protos));
  const log = parseClosureLog(input.log);
  const src = new ReplaySource(log);
  const sim = await instantiateSim(input.module, quiet, false);
  sim.cold((s) => s.init(InitInputCodec.encode({ protos: input.protos, flags: 0 })));
  const { sections, meta } = startSections(input.start, protosHash);
  const li = loadInput(sections, meta.lineage);
  const p = sim.input(li.length);
  sim.lease.u8.set(li, p);
  sim.load(li.length);
  // A replay runs with HISTORICAL set (the shell's replay mode, §15.6): events are marked, nothing else changes.
  sim.setFlags(SimFlags.historical);
  const stateHash = (): string => hex16(StateHashCodec.decode(sim.cold((s) => s.stateHash())).hash);
  const startHash = stateHash();
  const startTick = log.header.start_tick;
  const endTick = log.header.end_tick;
  const schedule = input.schedule ?? scheduleFor(endTick - startTick);
  const rows: TraceRow[] = [];
  let logMismatch: number | null = null;
  for (let t = startTick + 1; t <= endTick; t++) {
    const blobs = src.blobs(t);
    if (blobs) for (const b of blobs) sim.cold((s) => s.blobPut(b));
    const len = src.length(t);
    const at = sim.input(len);
    src.write(t, sim.lease.u8, sim.lease.dv, at);
    const status = sim.tick(len);
    if (status !== 0)
      throw new Error(`tick ${t}: the module refused the closure (${sim.lastError().message})`);
    sim.digest();
    const o = sim.digestOut;
    if (o[0] !== t) throw new Error(`tick ${t}: sim_digest names tick ${o[0]}`);
    sim.pendingChunks(); // the shell's per-tick call (§15.8), here without a worldgen pool: commits are inline
    const k = t - startTick;
    rows.push({
      tick: t,
      d: hex16(u64(o[1] as number, o[2] as number)),
      r: hex16(u64(o[3] as number, o[4] as number)),
      hash: hashedAt(schedule, k, endTick - startTick) ? stateHash() : null,
    });
    if (logMismatch === null && src.hasDigest(t) && (src.expectLo(t) !== o[1] || src.expectHi(t) !== o[2]))
      logMismatch = t;
  }
  const last = rows[rows.length - 1];
  return {
    startTick,
    endTick,
    startHash,
    rows,
    finalHash: stateHash(),
    finalR: last ? last.r : '',
    logMismatch,
    ms: performance.now() - t0,
  };
}

/** A dev build manifest for these prototypes (the shell's boot, §15.2). */
function manifestFor(protos: Uint8Array): BuildManifest {
  return { build: 'trace', buildHash: '0'.repeat(64), dev: true, prototypesHash: hexOf(sha256(protos)) };
}

/** Runs the log in the real shell's replay mode (see the header, part 2). */
export async function shellReplay(
  input: TraceInput,
  sha: (b: Uint8Array) => Promise<Uint8Array>,
): Promise<ShellReplay> {
  const t0 = performance.now();
  const log: ClosureLog = parseClosureLog(input.log);
  const waker = selfPostWaker();
  let shell: SimShell | null = null;
  let settle: ((m: SimToMain) => void) | null = null;
  const done = new Promise<SimToMain>((resolve) => {
    settle = resolve;
  });
  const problems: string[] = [];
  const host: ShellHost = {
    post: (m) => {
      if (m.t === 'pkt') {
        // Acked at once: the replay's last packet must not wait for a buffer.
        void shell?.handle({ t: 'ack', buf: m.buf });
        return;
      }
      if (m.t === 'replayed' || m.t === 'trap' || m.t === 'refused') settle?.(structuredClone(m));
      else if (m.t === 'error') problems.push(`${m.op}: ${m.message}`);
      else if (m.t === 'log' && m.level === 'error') problems.push(m.msg);
    },
    now: () => performance.now(),
    wake: waker.wake,
    cancel: waker.cancel,
    protos: async () => input.protos,
    sha256: sha,
  };
  shell = new SimShell(host);
  try {
    await shell.handle({
      t: 'boot',
      build: manifestFor(input.protos),
      module: input.module,
      ioPort: null,
      genPorts: [],
    });
    await shell.handle({ t: 'seq', op: 'pause' });
    const { sections, meta } = startSections(input.start, hexOf(sha256(input.protos)));
    await shell.handle({
      t: 'world',
      gen: 1,
      op: 'load',
      sections: sections.slice().buffer as ArrayBuffer,
      meta: meta.tick < 0 ? { ...meta, tick: log.header.start_tick } : meta,
    });
    if (problems.length > 0) throw new Error(`the shell refused the start: ${problems.join('; ')}`);
    await shell.handle({ t: 'replay', gen: 1, log: input.log.slice().buffer as ArrayBuffer });
    const m = await done;
    if (m.t !== 'replayed') throw new Error(`the shell stopped: ${JSON.stringify(m)}`);
    const sim = shell.instance;
    if (!sim) throw new Error('no module');
    const digests: string[] = [];
    for (let t = log.header.start_tick + 1; t <= m.tick; t++)
      digests.push(shell.digests.has(t) ? hex16(shell.digests.get(t)) : '-');
    const finalHash = hex16(StateHashCodec.decode(sim.cold((s) => s.stateHash())).hash);
    const d = DigestResultCodec.decode(sim.cold((s) => s.digest()));
    const out: ShellReplay = {
      ok: m.ok,
      tick: m.tick,
      digests,
      finalHash,
      finalR: hex16(d.r),
      ms: performance.now() - t0,
    };
    if (m.message !== undefined) out.message = m.message;
    if (m.mismatch) out.mismatch = m.mismatch;
    if (problems.length > 0) out.message = [out.message, ...problems].filter(Boolean).join('; ');
    return out;
  } finally {
    shell.close();
    waker.close();
  }
}

/** A trace as text, one tick per line: `tick d r [hash]` (hex; the hash on scheduled ticks). */
export function traceText(rows: readonly TraceRow[]): string {
  let s = '';
  for (const r of rows) s += `${r.tick} ${r.d} ${r.r}${r.hash ? ` ${r.hash}` : ''}\n`;
  return s;
}

/**
 * `simtool replay --trace --full`'s output (`tick d slice r hash` per tick) as rows, the hash kept only on the
 * ticks `schedule` names, so the texts compare directly.
 */
export function nativeRows(text: string, startTick: number, schedule: Schedule): TraceRow[] {
  const rows: TraceRow[] = [];
  const lines = text.split('\n').filter((l) => /^\d+ /.test(l));
  const last = lines.length;
  for (const l of lines) {
    const [t, d, , r, h] = l.split(' ') as [string, string, string, string, string | undefined];
    const tick = Number(t);
    rows.push({ tick, d, r, hash: h && hashedAt(schedule, tick - startTick, last) ? h : null });
  }
  return rows;
}

/** The first tick where two traces differ, with both lines; null when they are identical. */
export function firstDifference(
  a: readonly TraceRow[],
  b: readonly TraceRow[],
): { tick: number; a: string; b: string } | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    const sx = x ? traceText([x]).trim() : '(none)';
    const sy = y ? traceText([y]).trim() : '(none)';
    if (sx !== sy) return { tick: x?.tick ?? y?.tick ?? -1, a: sx, b: sy };
  }
  return null;
}
