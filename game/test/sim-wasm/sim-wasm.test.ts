// The simulation in WebAssembly (10 §4.1: native code and every engine compute the same bits). Runs sim.wasm
// (built by cargo with the full ABI) against the golden set (states, ticks, packets, projections, queries, the ABI
// traces and the negative cases) and the regression cases of codex's reviews (test/sim-wasm/cases/, written by
// the native tests), so the native and the wasm32 answers are compared on the same inputs.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AllocStatsCodec,
  PoolDirCodec,
  QueryInputCodec,
  QueryStepOutputCodec,
  SubscribeInputCodec,
  UnsubscribeInputCodec,
} from '../../src/shared/gen/abi.ts';
import { actionBlob, closureActions, decodeAction } from '../../src/shared/gen/actions.ts';
import { Reader } from '../../src/shared/gen/codec.ts';
import { parseClosureLog } from '../../src/shared/gen/container.ts';
import { decodePacket } from '../../src/shared/gen/packet.ts';
import {
  DebugCodec,
  DigestResultCodec,
  ProjectionKind,
  QueryKind,
  readUiRecords,
} from '../../src/shared/gen/projections.ts';
import { GEN_ABI_VERSION } from '../../src/shared/gen/schema.ts';
import { GAME } from '../helpers/paths.ts';
import { buildModule, initInput, stateInput, WasmSim } from './module.ts';

const GOLDEN = join(GAME, 'test', 'golden', 'm0');
const CASES = join(GAME, 'test', 'sim-wasm', 'cases');
const golden = (rel: string): Uint8Array => new Uint8Array(readFileSync(join(GOLDEN, rel)));
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

let module: WebAssembly.Module;
let protos: Uint8Array;

beforeAll(() => {
  module = buildModule();
  protos = golden('protos/prototypes.bin');
}, 600_000);

/** A fresh instance with the golden prototypes. */
function fresh(): WasmSim {
  const s = new WasmSim(module);
  expect(s.status('sim_init', initInput(protos))).toBe('ok');
  return s;
}

/** `sim_load`'s input for a save container (§8.1): its frames and the header's lineage. */
function containerInput(save: Uint8Array): Uint8Array {
  const v = new DataView(save.buffer, save.byteOffset, save.byteLength);
  const headerLength = v.getUint32(12, true);
  const header = new TextDecoder().decode(save.subarray(16, 16 + headerLength));
  const lineage = BigInt(`0x${(/"lineage":"([0-9a-f]{16})"/.exec(header) as RegExpExecArray)[1]}`);
  const frames: Uint8Array[] = [];
  let at = 16 + headerLength;
  while (at < save.length) {
    const stored = v.getUint32(at + 12, true);
    const next = at + 16 + stored + ((8 - (stored % 8)) % 8);
    frames.push(save.subarray(at, next));
    at = next;
  }
  const size = 4 + frames.reduce((n, f) => n + f.length, 0) + 2 + 8;
  const out = new Uint8Array(size);
  const o = new DataView(out.buffer);
  o.setUint32(0, frames.length, true);
  let p = 4;
  for (const f of frames) {
    out.set(f, p);
    p += f.length;
  }
  o.setUint16(p, 0, true);
  o.setBigUint64(p + 2, lineage, true);
  return out;
}

describe('sim.wasm: the golden set without systems', () => {
  it('loads start.save and saves it to states/tick-0000.sections with its hashes', () => {
    const s = fresh();
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const saved = s.envelope('sim_save', new Uint8Array(4));
    expect(saved.status).toBe('ok');
    expect(hex(saved.out as Uint8Array)).toBe(hex(golden('states/tick-0000.sections')));
    expect(s.stateHash()?.toString(16).padStart(16, '0')).toBe('49a36d5a1c7b89c3');
    expect(s.panics).toEqual([]);
  });

  it('round-trips every frozen state with the hashes of states/hashes.txt', () => {
    const lines = readFileSync(join(GOLDEN, 'states', 'hashes.txt'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('tick '));
    expect(lines.length).toBe(6);
    for (const line of lines) {
      const f = line.split(' ');
      const tick = Number(f[1]);
      const state = golden(`states/tick-${String(tick).padStart(4, '0')}.sections`);
      const s = fresh();
      expect(s.status('sim_load', stateInput(state)), `tick ${tick}`).toBe('ok');
      expect(hex(s.envelope('sim_save', new Uint8Array(4)).out as Uint8Array), `tick ${tick}`).toBe(
        hex(state),
      );
      expect(s.stateHash()?.toString(16).padStart(16, '0'), `tick ${tick}`).toBe(f[2]);
    }
  });

  it('replays every ABI trace: statuses, envelopes and state assertions', () => {
    const traces = JSON.parse(readFileSync(join(GOLDEN, 'abi', 'traces.json'), 'utf8')) as {
      traces: {
        name: string;
        calls: {
          call: string;
          in: string | null;
          params?: number[];
          status: string;
          out: string | null;
          state?: string;
        }[];
      }[];
    };
    expect(traces.traces.map((t) => t.name).sort()).toEqual(
      [
        'boot-and-order',
        'capacity',
        'packet-transitions',
        'queries',
        'remap-load',
        'subscriptions',
        'watermarks',
      ].sort(),
    );
    for (const t of traces.traces) {
      const name = t.name;
      const s = new WasmSim(module);
      t.calls.forEach((c, i) => {
        const input = c.in ? golden(c.in) : new Uint8Array();
        const before = s.stateHash();
        let status: string;
        let out: Uint8Array | null = null;
        if (['sim_set_flags', 'sim_query_cancel'].includes(c.call))
          status = s.statusArgs(c.call, ...(c.params ?? []));
        else if (
          [
            'sim_meta',
            'sim_load_report',
            'sim_digest',
            'sim_state_hash',
            'sim_pending_chunks',
            'sim_query_step',
          ].includes(c.call)
        ) {
          const r = s.envelope(c.call, undefined, ...(c.params ?? []));
          status = r.status;
          out = r.out;
        } else if (['sim_save', 'sim_extract'].includes(c.call)) {
          const r = s.envelope(c.call, input);
          status = r.status;
          out = r.out;
        } else status = s.status(c.call, input);
        expect(status, `${name} call ${i} (${c.call})`).toBe(c.status);
        if (c.out) expect(hex(out as Uint8Array), `${name} call ${i} (${c.call})`).toBe(hex(golden(c.out)));
        const after = s.stateHash();
        if (c.state === 'unchanged') expect(after, `${name} call ${i}`).toBe(before);
        if (c.state === 'changed') expect(after, `${name} call ${i}`).not.toBe(before);
      });
      expect(s.panics).toEqual([]);
    }
  });

  it('refuses every negative closure and save as natively', () => {
    const index = JSON.parse(readFileSync(join(GOLDEN, 'negative', 'index.json'), 'utf8')) as {
      file: string;
      expect: string;
    }[];
    let n = 0;
    for (const c of index) {
      if (!c.file.startsWith('closures/')) continue;
      const s = fresh();
      expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
      const before = hex(s.envelope('sim_save', new Uint8Array(4)).out as Uint8Array);
      expect(s.status('sim_tick', golden(`negative/${c.file}`)), c.file).toBe(c.expect);
      expect(hex(s.envelope('sim_save', new Uint8Array(4)).out as Uint8Array), c.file).toBe(before);
      n++;
    }
    expect(n).toBe(19);
  });

  it('refuses every negative ABI input of sim.wasm and gen.wasm as indexed', () => {
    const index = JSON.parse(readFileSync(join(GOLDEN, 'negative', 'index.json'), 'utf8')) as {
      file: string;
      call: string;
      expect: string;
    }[];
    const envelopes = ['sim_save', 'sim_extract', 'gen_init', 'gen_preview'];
    const genModule = buildModule('genabi');
    let n = 0;
    for (const c of index) {
      if (!c.file.startsWith('abi/') && !c.file.startsWith('protos/')) continue;
      const call = c.call.split(' ')[0] as string;
      const input = golden(`negative/${c.file}`);
      if (call.startsWith('gen_')) {
        const gen = new WasmSim(genModule, 'gen');
        if (call === 'gen_preview') {
          const init = readFileSync(join(GAME, 'test', 'sim-wasm', 'worldgen', 'init.bin'));
          expect(gen.envelope('gen_init', new Uint8Array(init)).status).toBe('ok');
        }
        expect(gen.envelope(call, input).status, c.file).toBe(c.expect);
        expect(gen.panics, c.file).toEqual([]);
        n++;
        continue;
      }
      const s = fresh();
      expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
      const before = s.stateHash();
      const bytes = c.file.startsWith('protos/') ? initInput(input) : input;
      const status = envelopes.includes(call) ? s.envelope(call, bytes).status : s.status(call, bytes);
      expect(status, `${c.file} (${call})`).toBe(c.expect);
      if (call !== 'sim_init') expect(s.stateHash(), c.file).toBe(before);
      expect(s.panics, c.file).toEqual([]);
      n++;
    }
    expect(n).toBe(28);
  });
});

/** The golden log's closures and blobs, and `digests.txt` as (d, r) per tick. */
function goldenRun() {
  const log = parseClosureLog(golden('closure-log.pwlog'));
  const closures = new Map(log.records.map((r) => [r.tick, r.closure]));
  const digests = new Map<number, { d: string; r: string }>();
  for (const line of new TextDecoder().decode(golden('digests.txt')).split('\n')) {
    const f = line.split(' ');
    if (line.startsWith('#') || f.length < 4) continue;
    digests.set(Number(f[0]), { d: f[1] as string, r: f[3] as string });
  }
  return { log, closures, digests };
}

/** Runs tick `t` of the golden log in `s` (its blobs first) and returns `sim_digest`'s d and r, hex. */
function tickGolden(s: WasmSim, run: ReturnType<typeof goldenRun>, t: number): { d: string; r: string } {
  const closure = run.closures.get(t) ?? new Uint8Array();
  // The blobs this tick's actions name (§15.3), supplied before the tick.
  for (const a of closureActions(closure)) {
    let h: Uint8Array | null = null;
    try {
      h = actionBlob(decodeAction(a.type, a.payload));
    } catch {
      h = null;
    }
    const b = h && run.log.blobs.find((x) => hex(x.sha256.bytes) === hex(h as Uint8Array));
    if (!b) continue;
    const input = new Uint8Array(32 + b.bytes.length);
    input.set(b.sha256.bytes, 0);
    input.set(b.bytes, 32);
    expect(s.status('sim_blob_put', input)).toBe('ok');
  }
  expect(s.status('sim_tick', closure), `tick ${t}: ${s.lastError().message}`).toBe('ok');
  const out = s.envelope('sim_digest').out as Uint8Array;
  const v = DigestResultCodec.read(new Reader(out));
  expect(v.tick).toBe(t);
  return { d: v.d.toString(16).padStart(16, '0'), r: v.r.toString(16).padStart(16, '0') };
}

describe('sim.wasm: the golden set ticks', () => {
  it('runs the closure log: every d_t and r_t, and the states and hashes after 1, 2, 300, 600 and 3,600', () => {
    const run = goldenRun();
    const s = fresh();
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const hashes = new Map(
      new TextDecoder()
        .decode(golden('states/hashes.txt'))
        .split('\n')
        .filter((l) => l.startsWith('tick '))
        .map((l) => [Number(l.split(' ')[1]), l.split(' ')[2] as string]),
    );
    for (let t = 1; t <= 3600; t++) {
      const got = tickGolden(s, run, t);
      const want = run.digests.get(t);
      if (got.d !== want?.d || got.r !== want?.r) expect(got, `tick ${t}`).toEqual(want);
      if (hashes.has(t)) {
        const state = golden(`states/tick-${String(t).padStart(4, '0')}.sections`);
        expect(hex(s.envelope('sim_save', new Uint8Array(4)).out as Uint8Array), `tick ${t}`).toBe(
          hex(state),
        );
        expect(s.stateHash()?.toString(16).padStart(16, '0'), `tick ${t}`).toBe(hashes.get(t));
      }
    }
    expect(s.panics).toEqual([]);
  }, 120_000);

  it('continues from states/tick-0300.sections with the same digests', () => {
    const run = goldenRun();
    const s = fresh();
    expect(s.status('sim_load', stateInput(golden('states/tick-0300.sections')))).toBe('ok');
    for (let t = 301; t <= 3600; t++) {
      const got = tickGolden(s, run, t);
      const want = run.digests.get(t);
      if (got.d !== want?.d || got.r !== want?.r) expect(got, `tick ${t}`).toEqual(want);
    }
    expect(hex(s.envelope('sim_save', new Uint8Array(4)).out as Uint8Array)).toBe(
      hex(golden('states/tick-3600.sections')),
    );
  }, 120_000);
});

/** The state ticks of the golden set: its states, projections and queries. */
const STATE_TICKS = [0, 1, 2, 300, 600, 3600];

/** One line of `projections/tick-NNNN.txt` (DEBUG's is masked and checked apart). */
interface ProjectionLine {
  name: string;
  kind: number;
  target: number;
  p: [number, number, number];
  status: string;
}

function projectionIndex(t: number): ProjectionLine[] {
  const text = readFileSync(join(GOLDEN, 'projections', `tick-${String(t).padStart(4, '0')}.txt`), 'utf8');
  return text
    .split('\n')
    .filter((l) => l.startsWith('## ') && !l.startsWith('## debug '))
    .map((l) => {
      const f = new Map(
        l
          .slice(3)
          .split(' ')
          .map((x) => x.split('=') as [string, string]),
      );
      const num = (k: string) => Number(f.get(k));
      return {
        name: l.slice(3).split(' ')[0] as string,
        kind: (ProjectionKind as Record<string, number>)[f.get('kind') as string] as number,
        target: num('target'),
        p: [num('p0'), num('p1'), num('p2')],
        status: f.get('status') as string,
      };
    });
}

describe('sim.wasm: the boundary (extraction, projections, queries)', () => {
  it('extracts the golden packets in the golden flow', () => {
    const run = goldenRun();
    const s = fresh();
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const view = golden('view.bin');
    const check = (name: string) => {
      const r = s.envelope('sim_extract', view);
      expect(r.status, s.lastError().message).toBe('ok');
      expect(hex(r.out as Uint8Array), name).toBe(hex(golden(`packets/${name}.bin`)));
    };
    check('tick-0000-full');
    expect(s.status('sim_subscribe', golden('subs.bin'))).toBe('ok');
    check('tick-0000');
    tickGolden(s, run, 1);
    check('tick-0001');
    for (let t = 2; t <= 600; t++) tickGolden(s, run, t);
    check('tick-0600');
    expect(s.panics).toEqual([]);
  }, 120_000);

  it('answers every projection and query of the state ticks with the golden records', () => {
    const run = goldenRun();
    const s = fresh();
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const view = golden('view.bin');
    // The first packet of a world carries no subscription record (rule 31).
    expect(s.envelope('sim_extract', view).status).toBe('ok');
    let live: number[] = [];
    let checked = 0;
    for (let t = 0; t <= 3600; t++) {
      if (t > 0) tickGolden(s, run, t);
      if (!STATE_TICKS.includes(t)) continue;
      const tt = String(t).padStart(4, '0');
      // Fresh subscriptions (STATS whole): one per index line, then DEBUG.
      const lines = projectionIndex(t);
      expect(s.status('sim_unsubscribe', UnsubscribeInputCodec.encode({ ids: live }))).toBe('ok');
      const subs = lines.map((l, i) => ({
        sub_id: i + 1,
        kind: l.kind,
        flags: 0,
        target: l.target,
        p0: l.p[0],
        p1: l.p[1],
        p2: l.p[2],
        p3: 0,
      }));
      const debugId = lines.length + 1;
      subs.push({
        sub_id: debugId,
        kind: ProjectionKind.debug,
        flags: 0,
        target: 0,
        p0: 0,
        p1: 0,
        p2: 0,
        p3: 0,
      });
      expect(s.status('sim_subscribe', SubscribeInputCodec.encode({ subs })), `tick ${t}`).toBe('ok');
      live = subs.map((x) => x.sub_id);
      const packet = decodePacket(s.envelope('sim_extract', view).out as Uint8Array);
      const ui = packet.sections.find((x) => x.name === 'UI');
      const records = new Map(
        readUiRecords(ui?.bytes ?? new Uint8Array(), ui?.count ?? 0).map((r) => [r.sub_id, r]),
      );
      lines.forEach((l, i) => {
        const r = records.get(i + 1);
        expect(r, `tick ${t}: ${l.name}`).toBeDefined();
        const status = ['ok', 'gone', 'invalid'][r?.status ?? 3];
        expect(status, `tick ${t}: ${l.name}`).toBe(l.status.split(' ')[0]);
        if (status === 'ok')
          expect(hex(r?.body as Uint8Array), `tick ${t}: ${l.name}`).toBe(
            hex(golden(`projections/tick-${tt}/${l.name}.bin`)),
          );
        checked++;
      });
      // DEBUG, its implementation-defined fields masked (memory_bytes, pools[].capacity, phase_us).
      const ours = DebugCodec.decode(records.get(debugId)?.body as Uint8Array);
      const want = DebugCodec.decode(golden(`projections/tick-${tt}/debug.bin`));
      const masked = (d: typeof ours) => ({
        tick: d.tick,
        entity_count: d.entity_count,
        d: d.d,
        r: d.r,
        pools: d.pools.map((p) => [p.pool, p.rows, p.active]),
      });
      expect(masked(ours), `tick ${t}: DEBUG`).toEqual(masked(want));
      expect(ours.memory_bytes, 'the module reports its memory').toBeGreaterThan(0);
      // The queries: each file of queries/tick-NNNN/ (inspect-S, hash, digest).
      const files = readdirSync(join(GOLDEN, 'queries', `tick-${tt}`)).sort();
      expect(files.length).toBeGreaterThanOrEqual(4);
      for (const f of files) {
        const name = f.slice(0, -4);
        const kind = name.startsWith('inspect-')
          ? QueryKind.inspect
          : (QueryKind as Record<string, number>)[name];
        const params = name.startsWith('inspect-')
          ? new Uint8Array(new Uint32Array([Number(name.slice(8))]).buffer)
          : new Uint8Array();
        const q = QueryInputCodec.encode({ id: 7, header: { kind: kind as number, flags: 0 }, params });
        expect(s.status('sim_query', q), `tick ${t}: ${name}`).toBe('ok');
        const step = QueryStepOutputCodec.decode(
          s.envelope('sim_query_step', undefined, 0xffffffff).out as Uint8Array,
        );
        expect(step.results.length).toBe(1);
        const r = step.results[0];
        expect(r?.ok, `tick ${t}: ${name}`).toBe(true);
        expect(hex(r?.body as Uint8Array), `tick ${t}: ${name}`).toBe(hex(golden(`queries/tick-${tt}/${f}`)));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(s.panics).toEqual([]);
  }, 120_000);

  it('allocates nothing per tick once warm: sim_tick, sim_digest, sim_pending_chunks, sim_extract (§2.5)', () => {
    const run = goldenRun();
    const s = fresh();
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const view = golden('view.bin');
    expect(s.envelope('sim_extract', view).status).toBe('ok');
    expect(s.status('sim_subscribe', golden('subs.bin'))).toBe('ok');
    const allocs = (): bigint =>
      AllocStatsCodec.decode(s.envelope('sim_allocs').out as Uint8Array).allocations;
    const step = (t: number) => {
      tickGolden(s, run, t);
      expect(s.envelope('sim_pending_chunks').status).toBe('ok');
      expect(s.envelope('sim_extract', view).status).toBe('ok');
    };
    // The golden log's last actions are at tick 595. A whole cycle of the 3,600 digest shards grows every
    // buffer to its largest member (the slices visit each shard once per cycle); then 2,400 idle ticks.
    for (let t = 1; t <= 3600; t++) step(t);
    allocs();
    const before = allocs();
    for (let t = 3601; t <= 6000; t++) step(t);
    expect(allocs() - before).toBe(0n);
    expect(s.panics).toEqual([]);
  }, 120_000);

  it('refuses huge query parameters without copying the request (C2c-r1 finding 10)', () => {
    const s = fresh();
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const params = new Uint8Array(48 << 20);
    const q = QueryInputCodec.encode({ id: 5, header: { kind: QueryKind.inspect, flags: 0 }, params });
    const at = (s.exports.sim_input?.(q.length) as number) >>> 0;
    new Uint8Array(s.memory.buffer, at, q.length).set(q);
    const before = s.memory.buffer.byteLength;
    expect(s.exports.sim_query?.(q.length)).toBe(0);
    // The reviewed module copied the 48 MiB request first: its memory grew by as much.
    expect(s.memory.buffer.byteLength - before).toBeLessThan(1 << 20);
    const step = QueryStepOutputCodec.decode(s.envelope('sim_query_step', undefined, 1).out as Uint8Array);
    expect(step.results.map((r) => [r.id, r.ok, [...r.body]])).toEqual([[5, false, [2, 0]]]);
    expect(s.panics).toEqual([]);
  });

  it('describes its pool columns and counts its allocations (simcheck)', () => {
    const s = fresh();
    expect(s.envelope('sim_pool_dir').status).toBe('err_order');
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const epoch = s.exports.sim_memory_epoch?.();
    const dir = s.envelope('sim_pool_dir');
    expect(dir.status).toBe('ok');
    const columns = PoolDirCodec.decode(dir.out as Uint8Array).columns;
    expect(columns.length).toBeGreaterThan(0);
    // Each column is a live range of the module's memory (§15.8: the shell's read views).
    for (const c of columns) {
      expect(c.ptr + c.len).toBeLessThanOrEqual(s.memory.buffer.byteLength);
    }
    expect(columns.map((c) => c.column)).toEqual([...columns.map((c) => c.column)].sort((x, y) => x - y));
    const allocs = s.envelope('sim_allocs');
    expect(allocs.status).toBe('ok');
    const a = AllocStatsCodec.decode(allocs.out as Uint8Array);
    expect(a.allocations).toBeGreaterThan(0n);
    expect(a.peak_bytes).toBeGreaterThanOrEqual(a.live_bytes);
    expect(s.exports.sim_memory_epoch?.()).toBeGreaterThanOrEqual(epoch as number);
  });
});

describe('sim.wasm: the recorded sessions of test/logs/ (D18 e, natively and in WebAssembly)', () => {
  it('replays every scenario session to its digests, state hash and lineage', () => {
    const dir = join(GAME, 'test', 'logs');
    const names = readdirSync(dir)
      .filter((f) => f.endsWith('.pwlog'))
      .map((f) => f.slice(0, -6))
      .sort();
    expect(names.length).toBeGreaterThanOrEqual(10);
    for (const name of names) {
      const log = parseClosureLog(new Uint8Array(readFileSync(join(dir, `${name}.pwlog`))));
      const s = fresh();
      expect(
        s.status('sim_load', stateInput(new Uint8Array(readFileSync(join(dir, `${name}.start`))))),
        name,
      ).toBe('ok');
      expect(s.stateHash(), name).toBe(log.header.start_state_hash);
      const closures = new Map(log.records.map((r) => [r.tick, r.closure]));
      let d = 0n;
      let r = 0n;
      for (let t = log.header.start_tick + 1; t <= log.header.end_tick; t++) {
        expect(s.status('sim_tick', closures.get(t) ?? new Uint8Array()), `${name} tick ${t}`).toBe('ok');
        const v = DigestResultCodec.read(new Reader(s.envelope('sim_digest').out as Uint8Array));
        d = v.d;
        r = v.r;
        if (d !== log.digests[t - log.header.start_tick - 1])
          expect(d, `${name}: d_${t}`).toBe(log.digests[t - log.header.start_tick - 1]);
      }
      const hex64 = (v: bigint | null) => (v ?? 0n).toString(16).padStart(16, '0');
      expect(
        `${name} ticks ${log.header.start_tick}..${log.header.end_tick} state ${hex64(s.stateHash())} r ${hex64(r)}\n`,
      ).toBe(readFileSync(join(dir, `${name}.txt`), 'utf8'));
      expect(s.panics, name).toEqual([]);
    }
  }, 120_000);
});

describe('gen.wasm: worldgen v0 natively and in WebAssembly', () => {
  it('answers gen_init, gen_chunk and gen_chart with the native bytes', () => {
    const gen = new WasmSim(buildModule('genabi'), 'gen');
    const dir = join(GAME, 'test', 'sim-wasm', 'worldgen');
    const fixture = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
    expect(gen.exports.gen_abi_version?.()).toBe(GEN_ABI_VERSION);
    const init = gen.envelope('gen_init', fixture('init.bin'));
    expect(init.status, gen.lastError().message).toBe('ok');
    const hash = new DataView((init.out as Uint8Array).buffer).getBigUint64(0, true);
    expect(`${hash.toString(16).padStart(16, '0')}\n`).toBe(
      readFileSync(join(dir, 'world-hash.txt'), 'utf8'),
    );
    const chunks = readdirSync(dir).filter((f) => f.startsWith('chunk_'));
    expect(chunks.length).toBeGreaterThanOrEqual(9);
    for (const f of chunks) {
      const [cx, cy] = f.slice(6, -4).split('_').map(Number) as [number, number];
      const r = gen.envelope('gen_chunk', undefined, 0, cx, cy);
      expect(r.status, `${f}: ${gen.lastError().message}`).toBe('ok');
      expect(hex(r.out as Uint8Array), f).toBe(hex(fixture(f)));
    }
    expect(hex(gen.envelope('gen_chart', undefined, 0, 0, 0).out as Uint8Array)).toBe(
      hex(fixture('chart_0_0.bin')),
    );
    expect(gen.envelope('gen_chunk', undefined, 0, 40_000, 0).status).toBe('err_input');
    // C2b-r1 finding 4: settings outside the bounds are refused at gen_init.
    const fresh = new WasmSim(buildModule('genabi'), 'gen');
    expect(fresh.envelope('gen_init', fixture('init-unbounded.bin')).status).toBe('err_input');
    expect(gen.panics).toEqual([]);
  });
});

describe('sim.wasm: codex C2a-r1 regressions', () => {
  it('answers every malformed load as the native code does (findings 1, 2, 4)', () => {
    const index = JSON.parse(readFileSync(join(CASES, 'index.json'), 'utf8')) as {
      name: string;
      input: string;
      expect: string;
    }[];
    expect(index.length).toBeGreaterThanOrEqual(12);
    for (const c of index) {
      const s = fresh();
      const status = s.status('sim_load', new Uint8Array(readFileSync(join(CASES, c.input))));
      expect(status, `${c.name}: ${s.lastError().message}`).toBe(c.expect);
      expect(s.panics, c.name).toEqual([]);
    }
  });

  it('bounds the blobs held for a tick (finding 5)', () => {
    const s = fresh();
    expect(s.status('sim_load', containerInput(golden('start.save')))).toBe('ok');
    const put = (bytes: Uint8Array): string => {
      const input = new Uint8Array(32 + bytes.length);
      input.set(createHash('sha256').update(bytes).digest(), 0);
      input.set(bytes, 32);
      return s.status('sim_blob_put', input);
    };
    const word = (i: number) => new Uint8Array(new Uint32Array([i]).buffer);
    for (let i = 0; i < 64; i++) expect(put(word(i))).toBe('ok');
    expect(put(word(0))).toBe('ok');
    expect(put(word(9999))).toBe('err_limit');
    expect(s.status('sim_tick', new Uint8Array())).toBe('ok');
    expect(put(new Uint8Array(8 * 1024 * 1024 + 1))).toBe('err_input');
    for (let i = 0; i < 4; i++) {
      const b = new Uint8Array(8 * 1024 * 1024);
      b[0] = i;
      expect(put(b)).toBe('ok');
    }
    expect(put(new Uint8Array([1]))).toBe('err_limit');
  });
});
