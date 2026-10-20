// The main thread's side (src/app/sim-host.ts; 10 §3.1–§3.6, S11, S15) with in-process workers: the
// world-replacement protocol through a fresh worker per world, the generation switch on the first packet (view
// and subscriptions re-sent, pending queries rejected, stale packets dropped), seqs across replacements, a
// subscription whose target is gone, the background swap, refusals, and trap recovery with a bundle that
// reproduces the trap.
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inlineGen, inlineSim } from '../../src/app/inline.ts';
import { RefusedError, SimHost, type SimHostEvents, WorldError } from '../../src/app/sim-host.ts';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import { actionBytes } from '../../src/shared/gen/actions.ts';
import { parseClosureLog } from '../../src/shared/gen/container.ts';
import { decodePacket, ViewRequestCodec } from '../../src/shared/gen/packet.ts';
import { ProjectionKind, QueryKind, readUiRecords, UiStatus } from '../../src/shared/gen/projections.ts';
import { handshake, type SimInstance } from '../../src/simworker/module.ts';
import { MemoryOpfs, testIo } from '../helpers/io.ts';
import { modelExports } from '../helpers/model-module.ts';
import { golden, goldenProtos, manifest, settle } from '../helpers/shell-harness.ts';
import { STUB_COMMAND, stubGen, stubSim } from '../helpers/stubs.ts';

const sha256 = async (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());

async function until(cond: () => boolean, what: string, n = 2000): Promise<void> {
  for (let i = 0; i < n && !cond(); i++) await settle();
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

interface Seen {
  packets: {
    gen: number;
    tick: number;
    flags: number;
    ui: { sub: number; status: number; kind: number }[];
  }[];
  generations: number[];
  traps: Parameters<NonNullable<SimHostEvents['trap']>>[0][];
  errors: string[];
}

function events(): { seen: Seen; events: SimHostEvents } {
  const seen: Seen = { packets: [], generations: [], traps: [], errors: [] };
  return {
    seen,
    events: {
      packet: (bytes, gen) => {
        const p = decodePacket(bytes);
        const ui = p.sections
          .filter((s) => s.name === 'UI')
          .flatMap((s) =>
            readUiRecords(s.bytes, s.count).map((r) => ({ sub: r.sub_id, status: r.status, kind: r.kind })),
          );
        seen.packets.push({ gen, tick: p.header.tick, flags: p.header.flags, ui });
      },
      generation: (g) => seen.generations.push(g),
      trap: (t) => seen.traps.push(t),
      error: (e) => seen.errors.push(`${e.op}: ${e.message}`),
      log: (level, msg) => {
        if (level === 'error') seen.errors.push(msg);
      },
    },
  };
}

/** A host on the stub module (or the reference model), in test mode, with a pool and an IO worker. */
async function host(
  opts: { model?: boolean; background?: boolean; module?: WebAssembly.Module; opfs?: MemoryOpfs } = {},
) {
  const { seen, events: ev } = events();
  const { io } = await testIo(opts.opfs ? { opfs: opts.opfs } : {});
  const protos = goldenProtos();
  const h = new SimHost({
    build: manifest(protos),
    sim: opts.model ? null : (opts.module ?? (await stubSim())),
    gen: await stubGen(),
    createSim: () =>
      inlineSim({
        protos: async () => protos,
        sha256,
        ...(opts.model
          ? {
              instantiate: async (_m, _hooks, dev) =>
                handshake(modelExports() as unknown as Record<string, unknown>, null, dev) as SimInstance,
            }
          : {}),
      }),
    createGen: () => inlineGen(),
    genWorkers: 2,
    io,
    events: ev,
    test: true,
    background: opts.background ?? false,
  });
  return { h, seen, io };
}

const settings = (seed = 1945) => ({ ...NewWorldCodec.defaults(), seed });
const view = (seq = 0) => ({ ...ViewRequestCodec.decode(golden('view.bin')), view_seq: seq });

describe('SimHost: worlds and generations (§3.4, S15)', () => {
  it('a new game: generation 1, its FULL packet first, then steps', async () => {
    const { h, seen } = await host();
    const b = await h.newGame(settings());
    expect(b).toMatchObject({ gen: 1, tick: 0 });
    expect(seen.generations).toEqual([1]);
    expect(seen.packets[0]).toMatchObject({ gen: 1, tick: 0, flags: 1 });
    h.control({ step: 2 });
    await until(() => seen.packets.at(-1)?.tick === 2, 'tick 2');
    expect(seen.errors).toEqual([]);
    h.close();
  });

  it('a replacement re-sends the view and the subscriptions, rejects pending queries and drops the old world', async () => {
    const { h, seen } = await host({ model: true });
    await h.loadBytes(golden('start.save'));
    h.setView(view());
    const character = h.subscribe({
      kind: ProjectionKind.character,
      flags: 0,
      target: 0,
      p0: 0,
      p1: 0,
      p2: 0,
      p3: 0,
    });
    const gone = h.subscribe({
      kind: ProjectionKind.entity_panel,
      flags: 0,
      target: 99,
      p0: 0,
      p1: 0,
      p2: 0,
      p3: 0,
    });
    await until(
      () => seen.packets.some((p) => p.ui.some((u) => u.sub === character)),
      'the CHARACTER record',
    );
    // A query the old world will never answer: the replacement comes first (single player terminates it).
    const pending = expect(h.query(new Uint8Array([QueryKind.hash, 0, 0, 0]))).rejects.toThrow(
      /generation 1 was replaced/,
    );
    const b = await h.loadBytes(golden('start.save'));
    expect(b.gen).toBe(2);
    await pending;
    expect(seen.generations).toEqual([1, 2]);
    // The new world got the view and both subscriptions again: its records arrive in generation 2.
    await until(
      () =>
        seen.packets.some(
          (p) => p.gen === 2 && p.ui.some((u) => u.sub === character && u.status === UiStatus.ok),
        ),
      'CHARACTER in generation 2',
    );
    // The panel's entity does not exist: `gone`, once (§15.5 "Targets that disappear").
    await until(
      () => seen.packets.some((p) => p.gen === 2 && p.ui.some((u) => u.sub === gone)),
      'the gone record',
    );
    const g = seen.packets.filter((p) => p.gen === 2).flatMap((p) => p.ui.filter((u) => u.sub === gone));
    expect(g).toEqual([{ sub: gone, status: UiStatus.gone, kind: ProjectionKind.entity_panel }]);
    // Every packet after the switch is generation 2's.
    const switchAt = seen.packets.findIndex((p) => p.gen === 2);
    expect(seen.packets.slice(switchAt).every((p) => p.gen === 2)).toBe(true);
    h.close();
  });

  it('seqs continue from the loaded world (§3.2): nextSeq = loaded + 1 after a replacement', async () => {
    const { h, seen } = await host({ model: true });
    await h.loadBytes(golden('start.save'));
    const a = actionBytes({ type: 'clear_cursor' });
    expect(h.act(a)).toBe(1);
    expect(h.act(new Uint8Array([...a, ...a]))).toBe(2);
    expect(h.act(a)).toBe(4);
    h.control({ step: 1 });
    await until(() => seen.packets.at(-1)?.tick === 1, 'tick 1');
    const saved = await h.save('manual', 'seqs');
    expect(saved.t).toBe('saved');
    await h.loadSave('seqs');
    expect(h.act(a)).toBe(5); // the save's last_seq is 4
    h.close();
  });

  it('a background swap (multiplayer re-sync): the old world plays on until the new one’s first packet', async () => {
    const { h, seen } = await host({ background: true });
    await h.newGame(settings());
    const old = h.current;
    h.control({ step: 1 });
    await until(() => seen.packets.some((p) => p.gen === 1 && p.tick === 1), 'tick 1 of generation 1');
    const b = await h.newGame(settings(7));
    expect(b.gen).toBe(2);
    expect(h.current).not.toBe(old);
    expect(seen.generations).toEqual([1, 2]);
    // The old worker is gone: nothing more of generation 1 arrives.
    const n = seen.packets.length;
    h.control({ step: 1 });
    await until(() => seen.packets.length > n, 'a packet');
    expect(seen.packets.slice(n).every((p) => p.gen === 2)).toBe(true);
    h.close();
  });

  it('a stale module is refused (§15.1): the replacement fails with RefusedError', async () => {
    const { h } = await host({
      module: await WebAssembly.compile(golden('negative/module/stale-schema.wasm')),
    });
    await expect(h.newGame(settings())).rejects.toBeInstanceOf(RefusedError);
    expect(h.current).toBeNull();
    h.close();
  });

  it('a load the module refuses is a WorldError with its status (§3.6 structured errors)', async () => {
    const { h } = await host({ model: true });
    await expect(h.loadBytes(golden('negative/saves/newer-section-version.save'))).rejects.toBeInstanceOf(
      WorldError,
    );
    h.close();
  });
});

describe('SimHost: trap recovery (§3.6)', () => {
  it('a dev panic: the trap notice with a bundle, recovery into a fresh worker, and the bundle reproduces the panic', async () => {
    const opfs = new MemoryOpfs();
    const { h, seen } = await host({ opfs });
    await h.newGame(settings());
    h.control({ step: 2 });
    await until(() => seen.packets.at(-1)?.tick === 2, 'tick 2');
    const r = await h.dev({ op: 'panic' });
    expect(r).toMatchObject({ t: 'res', ok: true });
    h.control({ step: 1 });
    await until(() => seen.traps.length === 1, 'the trap');
    const t = seen.traps[0];
    expect(t?.tick).toBe(3);
    expect(t?.message).toMatch(/dev panic requested by debug_dump at tick 3/);
    // The IO worker kept the bundle under reports/<report>/ (C3-r1 14: assembled there, not here).
    expect(t?.report).toMatch(/^\d{4}-/);
    const file = (f: string) => opfs.files.get(`reports/${t?.report}/${f}`) as Uint8Array;
    const save = file('save.save');
    const logBytes = file('closures.pwlog');
    const meta = JSON.parse(new TextDecoder().decode(file('report.json'))) as {
      console: string[];
      base: unknown;
    };
    expect(meta.base).toEqual({ start: 0 });
    const log = parseClosureLog(logBytes);
    expect([log.header.start_tick, log.header.end_tick]).toEqual([0, 3]);
    expect(meta.console.some((l) => l.includes('panicked'))).toBe(true);
    // Recovery: the world's start (no save yet) in a fresh worker, generation 2.
    await until(() => seen.generations.length === 2, 'the recovered world');
    expect(h.gen).toBe(2);
    // The bundle reproduces the trap: its save and log, replayed, trap at the same tick.
    const recover = (h as unknown as { o: { recover?: boolean } }).o;
    recover.recover = false;
    await expect(h.replay({ bytes: save }, logBytes)).rejects.toThrow(
      /at tick 3: panic: .*dev panic requested by debug_dump at tick 3/s,
    );
    expect(seen.traps.at(-1)?.tick).toBe(3);
    h.close();
  });

  it('keeps running across memory growth', async () => {
    const { h, seen } = await host();
    await h.newGame(settings());
    const grow = actionBytes({ type: 'debug_dump', dump_id: STUB_COMMAND.grow });
    expect((await h.dev({ op: 'system', actions: grow.slice().buffer })).t).toBe('res');
    h.control({ step: 5 });
    await until(() => seen.packets.at(-1)?.tick === 5, 'tick 5');
    expect(seen.traps).toEqual([]);
    h.close();
  });
});
