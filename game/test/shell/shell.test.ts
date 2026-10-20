// The sim worker's shell (src/simworker/shell.ts; 10 §3.1–§3.6) against the stub module (test/stubs): the boot
// handshake, the world lifecycle, the LocalSequencer's stamping and framing, pacing and clock generations,
// packets and backpressure, generations, traps and memory growth.
import { describe, expect, it } from 'vitest';
import { InitInputCodec } from '../../src/shared/gen/abi.ts';
import { type Action, actionBytes, closureActions, decodeAction } from '../../src/shared/gen/actions.ts';
import { parseClosureLog } from '../../src/shared/gen/container.ts';
import { PacketFlags } from '../../src/shared/gen/packet.ts';
import { ABI_VERSION, SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import { DEV_PANIC_DUMP_ID } from '../../src/simworker/dev.ts';
import { golden, manifest, ShellHarness, sha256hex } from '../helpers/shell-harness.ts';
import {
  FNV_OFFSET,
  fnv,
  STUB_COMMAND,
  stubDigest,
  stubLineage0,
  stubRoll,
  stubSim,
} from '../helpers/stubs.ts';

const frames = (...actions: Action[]): ArrayBuffer => {
  const parts = actions.map(actionBytes);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
};

async function stubWorld(opts: { paused?: boolean } = {}): Promise<ShellHarness> {
  const h = new ShellHarness();
  await h.boot(await stubSim());
  await h.newWorld(1, 1945, opts.paused ?? true);
  return h;
}

/** The closures the shell has recorded since its base (the bundle's closure log). */
async function recorded(h: ShellHarness): Promise<Map<number, Uint8Array>> {
  await h.send({ t: 'dev', id: 900, op: { op: 'bundle' } });
  const b = h.last('bundle');
  if (!b) throw new Error('no bundle');
  const log = parseClosureLog(new Uint8Array(b.bundle.log));
  return new Map(log.records.map((r) => [r.tick, r.closure]));
}

describe('boot: the handshake (§3.2 versions, §15.1, §15.2)', () => {
  it('answers ready with the ABI version and the schema hash', async () => {
    const h = new ShellHarness();
    await h.boot(await stubSim());
    expect(h.of('ready')).toEqual([
      { t: 'ready', abi: ABI_VERSION, schemaHash: SCHEMA_HASH, buildHash: '0'.repeat(64), steps: true },
    ]);
  });

  it('refuses the golden stale module, naming both hashes', async () => {
    const h = new ShellHarness();
    await h.boot(await WebAssembly.compile(golden('negative/module/stale-schema.wasm')));
    const r = h.last('refused');
    expect(r?.reason).toBe('schema');
    expect(r?.message).toContain(SCHEMA_HASH);
    expect(r?.schemaHash).not.toBe(SCHEMA_HASH);
    expect(h.of('ready')).toEqual([]);
  });

  it('refuses a stale prototypes.bin (§15.2 step 2) and a build manifest of another schema or protocol', async () => {
    const h = new ShellHarness();
    await h.boot(await stubSim(), manifest(undefined, { prototypesHash: 'f'.repeat(64) }));
    expect(h.last('refused')?.reason).toBe('protos');
    const h2 = new ShellHarness();
    await h2.boot(await stubSim(), manifest(undefined, { schemaHash: '0'.repeat(64) }));
    expect(h2.last('refused')?.reason).toBe('build');
    const h3 = new ShellHarness();
    await h3.boot(await stubSim(), manifest(undefined, { protocolVersion: 999 }));
    expect(h3.last('refused')?.reason).toBe('build');
  });

  it('refuses prototypes.bin of another schema (ERR_PROTOS)', async () => {
    const stale = golden('negative/protos/stale-schema.bin');
    const h = new ShellHarness({ protos: stale });
    await h.boot(await stubSim(), manifest(stale));
    expect(h.last('refused')?.reason).toBe('protos');
    expect(InitInputCodec).toBeDefined();
  });
});

describe('a world (§3.4: bound, then an unsolicited FULL packet)', () => {
  it('binds, sends a FULL packet with its generation, and reports the clock', async () => {
    const h = await stubWorld();
    expect(h.out.filter((m) => m.t !== 'log').map((m) => m.t)).toEqual(['ready', 'bound', 'pkt', 'clock']);
    expect(h.last('bound')).toEqual({ t: 'bound', gen: 1, tick: 0, players: [] });
    const p = h.packets[0]?.packet;
    expect(p?.header.flags).toBe(PacketFlags.full);
    expect(p?.header.state_gen).toBe(1);
    expect(p?.header.view_seq).toBe(0);
    expect(h.last('clock')).toMatchObject({ gen: 1, paused: true, tick: 0 });
  });

  it('issues player_joined(0) in a new world’s first tick, with the next system seq', async () => {
    const h = await stubWorld();
    await h.step(1);
    const c = (await recorded(h)).get(1) as Uint8Array;
    const a = closureActions(c);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ player: 0xffff, seq: 1, system: true });
    expect(decodeAction(a[0]?.type as number, a[0]?.payload as Uint8Array)).toEqual({
      type: 'player_joined',
      player: 0,
      flags: 0,
    });
    // The stub's digest is FNV over (tick, closure): the closure the module ran is the one recorded.
    const d = h.shell.digests.get(1);
    expect(d).toBe(stubDigest(1, c));
    expect(h.packets.at(-1)?.packet.header.tick).toBe(1);
  });

  it('refuses a second world: one world per worker (decision 10)', async () => {
    const h = await stubWorld();
    await h.newWorld(2);
    expect(h.errors().some((e) => e.includes('one world per worker'))).toBe(true);
    expect(h.shell.stateGen).toBe(1);
  });
});

describe('the LocalSequencer (§3.3, §15.3)', () => {
  it('stamps actions for the next tick, frames them in batches, and writes input generations (D22)', async () => {
    const h = await stubWorld();
    await h.step(1);
    await h.send({
      t: 'act',
      gen: 1,
      firstSeq: 1,
      actions: frames(
        { type: 'start_walking', input_gen: 77, dir: 4 },
        { type: 'craft', recipe: 0, count: 1 },
      ),
    });
    await h.send({ t: 'act', gen: 1, firstSeq: 3, actions: frames({ type: 'stop_walking', input_gen: 9 }) });
    await h.step(1);
    const c = (await recorded(h)).get(2) as Uint8Array;
    const acts = closureActions(c);
    expect(acts.map((a) => [a.player, a.seq, decodeAction(a.type, a.payload).type])).toEqual([
      [0, 1, 'start_walking'],
      [0, 2, 'craft'],
      [0, 3, 'stop_walking'],
    ]);
    // One batch: consecutive seqs of one player. The sequencer wrote the tracked generation (0) over the
    // main thread's values: the main thread never needs to know generations.
    expect(c.length).toBe(16 + acts.reduce((n, a) => n + 4 + a.payload.length, 0));
    expect(
      (decodeAction(acts[0]?.type as number, acts[0]?.payload as Uint8Array) as { input_gen: number })
        .input_gen,
    ).toBe(0);
    expect(
      (decodeAction(acts[2]?.type as number, acts[2]?.payload as Uint8Array) as { input_gen: number })
        .input_gen,
    ).toBe(0);
  });

  it('refuses seqs that do not rise, drops system types from players, and starts a batch at a seq gap', async () => {
    const h = await stubWorld();
    await h.step(1);
    await h.send({ t: 'act', gen: 1, firstSeq: 1, actions: frames({ type: 'clear_cursor' }) });
    await h.send({ t: 'act', gen: 1, firstSeq: 1, actions: frames({ type: 'clear_cursor' }) });
    expect(h.last('error')).toMatchObject({ op: 'act', status: 0 });
    expect(h.last('error')?.message).toMatch(/does not rise/);
    await h.send({
      t: 'act',
      gen: 1,
      firstSeq: 2,
      actions: frames({ type: 'debug_dump', dump_id: 5 } as Action, { type: 'clear_cursor' }),
    });
    await h.step(1);
    const c = (await recorded(h)).get(2) as Uint8Array;
    const acts = closureActions(c);
    expect(acts.map((a) => [a.seq, a.system])).toEqual([
      [1, false],
      [3, false],
    ]);
    expect(c.length).toBe(2 * 16 + 2 * 4); // seq 2 was dropped: two batches
    expect(
      h.out.some((m) => m.t === 'log' && m.level === 'warn' && m.msg.includes('never enters a tick')),
    ).toBe(true);
  });

  it('drops messages of another generation', async () => {
    const h = await stubWorld();
    await h.send({ t: 'act', gen: 7, firstSeq: 1, actions: frames({ type: 'clear_cursor' }) });
    await h.step(2);
    const recs = await recorded(h);
    expect(closureActions(recs.get(2) ?? new Uint8Array())).toEqual([]);
    expect(recs.has(2)).toBe(false);
  });
});

describe('pacing and clock generations (§3.3)', () => {
  it('runs 60 ticks a second, at most 3 per wake, one packet per wake', async () => {
    const h = await stubWorld({ paused: false });
    const before = h.packets.length;
    h.advance(1000);
    expect(h.shell.tick).toBeGreaterThanOrEqual(59);
    expect(h.shell.tick).toBeLessThanOrEqual(60);
    expect(h.packets.length - before).toBe(h.shell.tick);
  });

  it('rebases a backlog over 6 ticks in a new clock generation; speed and pause start generations too', async () => {
    const h = await stubWorld({ paused: false });
    h.advance(100);
    const gen0 = h.shell.clockState.gen;
    const tick0 = h.shell.tick;
    // A 500-ms stall: no timer ran. The next wake finds 30 ticks due and rebases instead of catching up.
    h.clock += 500;
    h.advance(20);
    expect(h.shell.clockState.gen).toBe(gen0 + 1);
    expect(h.shell.tick - tick0).toBeLessThanOrEqual(3);
    await h.send({ t: 'seq', op: { speed: 2 } });
    const t1 = h.shell.tick;
    h.advance(1000);
    expect(h.shell.tick - t1).toBeGreaterThanOrEqual(118);
    await h.send({ t: 'seq', op: 'pause' });
    const t2 = h.shell.tick;
    h.advance(500);
    expect(h.shell.tick).toBe(t2);
    expect(h.last('clock')).toMatchObject({ paused: true, speed: 2 });
  });

  it('extracts within 16 ms after a view while paused (§3.3 "Extraction without ticks")', async () => {
    const h = await stubWorld();
    const n = h.packets.length;
    await h.send({
      t: 'view',
      gen: 1,
      v: {
        view_seq: 7,
        surface: 0,
        flags: 0,
        x0: -10,
        y0: -10,
        x1: 10,
        y1: 10,
        zoom: 1,
        hovered_serial: 0,
        audio_half_range: 10,
        chart_x0: 0,
        chart_y0: 0,
        chart_x1: 0,
        chart_y1: 0,
      },
    });
    h.advance(16);
    expect(h.packets.length).toBe(n + 1);
    expect(h.packets.at(-1)?.packet.header.view_seq).toBe(7);
  });

  it('skips extraction without a free buffer and catches up when one comes back (backpressure)', async () => {
    const h = await stubWorld();
    h.hold = true;
    await h.step(1);
    await h.step(1);
    await h.step(1);
    const n = h.packets.length;
    await h.step(1); // no free buffer: skipped
    expect(h.packets.length).toBe(n);
    h.hold = false;
    h.release();
    h.advance(20);
    expect(h.packets.length).toBe(n + 1);
    expect(h.packets.at(-1)?.packet.header.tick).toBe(4);
  });

  it('stops extracting while hidden, and extracts on return', async () => {
    const h = await stubWorld({ paused: false });
    h.advance(100);
    await h.send({ t: 'hidden', hidden: true });
    const n = h.packets.length;
    const t = h.shell.tick;
    h.advance(200);
    expect(h.shell.tick).toBeGreaterThan(t);
    expect(h.packets.length).toBe(n);
    await h.send({ t: 'hidden', hidden: false });
    h.advance(17);
    expect(h.packets.length).toBeGreaterThan(n);
  });
});

describe('packets (§15.4)', () => {
  it('grows a buffer for a packet larger than 256 KiB', async () => {
    const h = await stubWorld();
    await h.send({
      t: 'dev',
      id: 1,
      op: { op: 'system', actions: frames({ type: 'debug_dump', dump_id: STUB_COMMAND.bigPacket }) },
    });
    await h.step(1);
    const big = h.packets.at(-1);
    expect(big?.bytes.length).toBeGreaterThan(600_000);
    expect(big?.packet.sections[0]?.count).toBe(600);
    expect(big?.packet.header.state_gen).toBe(1);
  });
});

describe('traps and memory growth (§3.6)', () => {
  it('keeps running after memory grows: views are reacquired', async () => {
    const h = await stubWorld();
    const gen0 = h.shell.instance?.lease.generation as number;
    await h.send({
      t: 'dev',
      id: 1,
      op: { op: 'system', actions: frames({ type: 'debug_dump', dump_id: STUB_COMMAND.grow }) },
    });
    await h.step(3);
    expect(h.shell.instance?.lease.generation).toBeGreaterThan(gen0);
    expect(h.shell.stopped).toBeNull();
    expect(h.packets.at(-1)?.packet.header.tick).toBe(3);
  });

  it('a dev panic traps at its tick; the trap carries the closure log that reproduces it', async () => {
    const h = await stubWorld();
    await h.step(2);
    await h.send({ t: 'dev', id: 2, op: { op: 'panic' } });
    expect(h.last('res')).toMatchObject({ id: 2, ok: true });
    await h.step(1);
    const trap = h.last('trap');
    expect(trap).toMatchObject({ gen: 1, tick: 3 });
    expect(trap?.message).toMatch(
      /^panic: panicked at .*lib\.rs:\d+:\d+:\ndev panic requested by debug_dump at tick 3$/,
    );
    expect(h.shell.stopped).not.toBeNull();
    // The bundle: the world's start (a new world before its first save) and the log up to the trapping tick.
    const b = trap?.bundle;
    expect(b?.base.kind).toBe('start');
    const log = parseClosureLog(new Uint8Array(b?.log as ArrayBuffer));
    expect(log.header.start_tick).toBe(0);
    expect(log.header.end_tick).toBe(3);
    expect(log.digests).toHaveLength(2);
    const last = log.records.at(-1);
    expect(last?.tick).toBe(3);
    const dump = closureActions(last?.closure as Uint8Array).map((a) => decodeAction(a.type, a.payload));
    expect(dump).toEqual([{ type: 'debug_dump', dump_id: DEV_PANIC_DUMP_ID }]);
    // Nothing more: the instance is never called again.
    const n = h.out.length;
    await h.step(1);
    await h.send({ t: 'dev', id: 3, op: { op: 'hash' } });
    expect(h.out.slice(n).every((m) => m.t === 'res' && !m.ok)).toBe(true);
  });

  it('the stub digest contract holds: r rolls from r₀', async () => {
    const h = await stubWorld();
    await h.step(3);
    const recs = await recorded(h);
    let r = stubLineage0(1945);
    for (let t = 1; t <= 3; t++) r = stubRoll(r, stubDigest(t, recs.get(t) ?? new Uint8Array()));
    await h.send({ t: 'dev', id: 4, op: { op: 'digest' } });
    const v = new DataView(h.last('res')?.value as ArrayBuffer);
    expect(v.getUint32(0, true)).toBe(3);
    expect(v.getBigUint64(12, true)).toBe(r);
    expect(fnv(FNV_OFFSET, new Uint8Array()) === FNV_OFFSET).toBe(true);
    expect(sha256hex(new Uint8Array())).toHaveLength(64);
  });
});
