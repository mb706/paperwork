// The codex review C3-r1 (pm/reviews/C3-r1.md): one test per finding, each failing on the reviewed code
// (commit 215f7af) and passing now. The numbers are the review's. Where a finding is not about the API, the
// tests drive the world through what the reviewed SimHost had too (`control({step})`, packets), so that on the
// reviewed code they fail on the finding itself; pm/reports/C3.md lists each failure.
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inlineGen, inlineSim } from '../../src/app/inline.ts';
import type { IoClient } from '../../src/app/io-client.ts';
import { metaOf, SimHost, type SimHostEvents, type WorkerLike } from '../../src/app/sim-host.ts';
import { gameHooks } from '../../src/dev/game-hooks.ts';
import { IoService } from '../../src/ioworker/io.ts';
import { IdbStorage, OpfsStorage } from '../../src/ioworker/storage.ts';
import { LoadInputCodec, NewWorldCodec, SaveOutputCodec } from '../../src/shared/gen/abi.ts';
import {
  ActionType,
  actionBytes,
  closureActions,
  encodeClosure,
  PlaceBlueprintActionCodec,
} from '../../src/shared/gen/actions.ts';
import { Writer } from '../../src/shared/gen/codec.ts';
import {
  parseClosureLog,
  readSaveContainer,
  SectionFrameCodec,
  writeSaveContainer,
} from '../../src/shared/gen/container.ts';
import { ViewRequestCodec } from '../../src/shared/gen/packet.ts';
import { QueryKind, StateHashCodec } from '../../src/shared/gen/projections.ts';
import type { IoRequest, SaveInfo } from '../../src/shared/io-protocol.ts';
import type { MainToSim } from '../../src/shared/protocol.ts';
import { PacketPool } from '../../src/simworker/packets.ts';
import { PortSource } from '../../src/simworker/sequencer.ts';
import {
  claimEpoch,
  type Fence,
  freshDb,
  ioEnv,
  MemoryOpfs,
  MemorySaveLock,
  sha256,
  startOutput,
  testIo,
} from '../helpers/io.ts';
import { golden, goldenProtos, manifest, ShellHarness, settle, sha256hex } from '../helpers/shell-harness.ts';
import { STUB_TRAP_ON_EXTRACT_SEED, stubGen, stubSim } from '../helpers/stubs.ts';

const settings = (seed = 1945) => ({ ...NewWorldCodec.defaults(), seed });

async function until(cond: () => boolean, what: string, n = 3000): Promise<void> {
  for (let i = 0; i < n && !cond(); i++) await settle();
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

/** Test mode's steps through `control` (as the reviewed SimHost had it): resolves once the tick is shown. */
async function stepTo(h: SimHost, n: number): Promise<number> {
  const target = h.lastTick + n;
  h.control({ step: n });
  await until(() => h.lastTick >= target, `tick ${target}`);
  return h.lastTick;
}

/** Resolves with the promise's outcome, or 'pending' if it has not settled within `n` turns. */
async function outcome<T>(p: Promise<T>, n = 400): Promise<{ ok: T } | { err: Error } | 'pending'> {
  let r: { ok: T } | { err: Error } | 'pending' = 'pending';
  p.then(
    (v) => {
      r = { ok: v };
    },
    (e: unknown) => {
      r = { err: e instanceof Error ? e : new Error(String(e)) };
    },
  );
  for (let i = 0; i < n && r === 'pending'; i++) await settle();
  return r;
}

/** A worker wrapper that counts terminations and can hold back what the worker says. */
function watched(w: WorkerLike): WorkerLike & { terminated: number; mute: boolean; sent: MainToSim[] } {
  let handler: ((e: MessageEvent) => void) | null = null;
  const x = {
    terminated: 0,
    mute: false,
    sent: [] as MainToSim[],
    postMessage(m: unknown, transfer?: Transferable[]) {
      x.sent.push(m as MainToSim);
      w.postMessage(m, transfer);
    },
    terminate() {
      x.terminated += 1;
      w.terminate();
    },
    get onmessage() {
      return handler;
    },
    set onmessage(f: ((e: MessageEvent) => void) | null) {
      handler = f;
      w.onmessage = f ? (e: MessageEvent) => (x.mute ? undefined : f(e)) : null;
    },
  };
  return x;
}

/** SimHost on the stub modules, in test mode unless asked, with an IO worker and watched sim workers. */
async function stubHost(
  o: { io?: IoClient; opfs?: MemoryOpfs; test?: boolean; events?: SimHostEvents; recover?: boolean } = {},
) {
  const protos = goldenProtos();
  const io = o.io ?? (await testIo(o.opfs ? { opfs: o.opfs } : {})).io;
  const workers: ReturnType<typeof watched>[] = [];
  const traps: Parameters<NonNullable<SimHostEvents['trap']>>[0][] = [];
  const generations: number[] = [];
  const h = new SimHost({
    build: manifest(protos),
    sim: await stubSim(),
    gen: await stubGen(),
    createSim: () => {
      const w = watched(inlineSim({ protos: async () => protos, sha256 }));
      workers.push(w);
      return w;
    },
    createGen: () => inlineGen(),
    genWorkers: 1,
    io,
    test: o.test ?? true,
    events: { trap: (t) => traps.push(t), generation: (g) => generations.push(g), ...o.events },
    ...(o.recover === false ? { recover: false } : {}),
  });
  return { h, io, workers, traps, generations };
}

const storeReq = (
  name: string,
  savedAt: string,
  reason: SaveInfo['reason'] = 'manual',
): IoRequest & { t: 'store' } => {
  const { save, header } = startOutput(savedAt);
  return { t: 'store', id: 1, name, reason, save, header };
};

describe('C3-r1 1 (critical): a failed overwrite never destroys the save it replaces', () => {
  for (const fault of ['a quota error', 'a short write', 'a commit after the saves changed owner'] as const)
    it(`OPFS: ${fault} leaves the previous version intact, and no orphan`, async () => {
      const opfs = new MemoryOpfs();
      const db = await freshDb();
      const fence: Fence = await claimEpoch(db, 0);
      const svc = new IoService(new OpfsStorage(db, opfs.root), ioEnv, () => fence);
      const first = await svc.handle(storeReq('slot', '2026-01-01T00:00:00.000Z'));
      if (first.reply.t !== 'stored') throw new Error(JSON.stringify(first.reply));
      const v1 = first.reply.info;
      if (fault === 'a quota error') opfs.fault = { after: 100, mode: 'throw' };
      else if (fault === 'a short write') opfs.fault = { after: 100, mode: 'short' };
      else await claimEpoch(db, 1); // another tab became the owner meanwhile
      const second = await svc.handle(storeReq('slot', '2026-01-02T00:00:00.000Z'));
      expect(second.reply.t).toBe('failed');
      const back = await svc.handle({ t: 'read', id: 3, name: 'slot' });
      if (back.reply.t !== 'read') throw new Error(JSON.stringify(back.reply));
      expect(back.reply.info.sha256).toBe(v1.sha256);
      expect(back.reply.header.savedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(opfs.names('saves')).toEqual([v1.file]);
    });

  it('a successful overwrite replaces the version and removes the old one', async () => {
    const opfs = new MemoryOpfs();
    const db = await freshDb();
    const fence = await claimEpoch(db, 0);
    const svc = new IoService(new OpfsStorage(db, opfs.root), ioEnv, () => fence);
    await svc.handle(storeReq('slot', '2026-01-01T00:00:00.000Z'));
    const second = await svc.handle(storeReq('slot', '2026-01-02T00:00:00.000Z'));
    if (second.reply.t !== 'stored') throw new Error(JSON.stringify(second.reply));
    expect(opfs.names('saves')).toEqual([second.reply.info.file]);
  });

  it('IndexedDB: a commit after the saves changed owner leaves the previous record', async () => {
    const db = await freshDb();
    const fence = await claimEpoch(db, 0);
    const svc = new IoService(new IdbStorage(db), ioEnv, () => fence);
    const first = await svc.handle(storeReq('slot', '2026-01-01T00:00:00.000Z'));
    if (first.reply.t !== 'stored') throw new Error('store');
    await claimEpoch(db, 1);
    expect((await svc.handle(storeReq('slot', '2026-01-02T00:00:00.000Z'))).reply).toMatchObject({
      t: 'failed',
      notOwner: true,
    });
    const back = await svc.handle({ t: 'read', id: 3, name: 'slot' });
    expect(back.reply.t === 'read' && back.reply.info.sha256).toBe(first.reply.info.sha256);
  });
});

describe('C3-r1 10: one tab at a time (§8.2)', () => {
  it('a second tab cannot write; Take over saves the first tab’s game, then fences it for good', async () => {
    const db = await freshDb();
    const lock = new MemorySaveLock();
    const channel = `paperwork-test-${Date.now()}-a`;
    const a = await testIo({ db, lock, channel: new BroadcastChannel(channel) });
    await until(() => a.io.owner === true, 'tab A owns the saves');
    const storage: boolean[] = [];
    const A = await stubHost({ io: a.io, events: { storage: (s) => storage.push(s.owner) } });
    await A.h.newGame(settings());
    expect(await stepTo(A.h, 5)).toBe(5);
    const b = await testIo({
      db,
      lock: lock.sibling(),
      channel: new BroadcastChannel(channel),
      waitMs: 5000,
    });
    await until(() => b.io.owner === false, 'tab B is not the owner');
    const bytes = () => golden('start.save').slice().buffer as ArrayBuffer;
    expect(await b.io.request({ t: 'import', name: 'b', bytes: bytes() })).toMatchObject({
      t: 'failed',
      notOwner: true,
    });
    // Take over: tab A saves its game (an exit save) and lets go; tab B owns the saves; tab A is read-only.
    b.io.takeOver();
    await until(() => b.io.owner === true && a.io.owner === false, 'the takeover');
    const list = await b.io.request({ t: 'list' });
    expect(list.t === 'list' && list.saves.map((s) => [s.name, s.tick])).toEqual([['_autosave1', 5]]);
    expect(storage).toEqual([false]);
    expect(A.h.paused).toBe(true);
    // A later save of tab A is refused; tab B writes.
    const late = await A.h.save('auto');
    expect(late).toMatchObject({ t: 'saveFailed' });
    expect((late as { message: string }).message).toMatch(/another tab owns the saves/);
    expect((await b.io.request({ t: 'import', name: 'b', bytes: bytes() })).t).toBe('imported');
    A.h.close();
  });

  it('an owner that does not answer loses the saves when the takeover times out, and its commits fail', async () => {
    const db = await freshDb();
    const lock = new MemorySaveLock();
    const channel = `paperwork-test-${Date.now()}-b`;
    const a = await testIo({ db, lock, channel: new BroadcastChannel(channel) });
    await until(() => a.io.owner === true, 'tab A owns the saves');
    a.io.onTakeover = () => {}; // a frozen tab: no last save, no release
    const b = await testIo({ db, lock: lock.sibling(), channel: new BroadcastChannel(channel), waitMs: 30 });
    await until(() => b.io.owner === false, 'tab B is not the owner');
    b.io.takeOver();
    await until(() => b.io.owner === true && a.io.owner === false, 'the stolen lock');
    const { save, header } = startOutput();
    expect(await a.io.request({ t: 'store', name: 'late', reason: 'manual', save, header })).toMatchObject({
      t: 'failed',
      notOwner: true,
    });
  });
});

describe('C3-r1 9: a bundle’s base is an exact, pinned version: the last autosave', () => {
  it('overwriting the base’s save before a trap: the bundle and the recovery still use the autosave’s bytes', async () => {
    const opfs = new MemoryOpfs();
    const { h, io, traps } = await stubHost({ opfs });
    await h.newGame(settings());
    expect(await stepTo(h, 5)).toBe(5);
    const auto = await h.save('auto');
    if (auto.t !== 'saved') throw new Error(JSON.stringify(auto));
    expect(await stepTo(h, 3)).toBe(8);
    // Another save takes the slot's name (the review's overwrite before the trap's acknowledgement).
    const other = await io.request({
      t: 'import',
      name: '_autosave1',
      bytes: golden('start.save').slice().buffer,
    });
    expect(other.t).toBe('imported');
    await h.dev({ op: 'panic' });
    h.control({ step: 1 });
    await until(() => traps.length === 1 && h.gen === 2, 'the trap and the recovery');
    // The kept bundle holds the autosave's bytes (not the overwriting save's), and the recovery reloaded them.
    await until(() => opfs.names('reports').some((n) => n.endsWith('/save.save')), 'the kept bundle');
    const kept = opfs.names('reports').find((n) => n.endsWith('/save.save')) as string;
    expect(sha256hex(opfs.files.get(`reports/${kept}`) as Uint8Array)).toBe(auto.sha256);
    expect(h.lastTick).toBe(5);
    h.close();
  });

  it('the recovery reloads the last autosave, not a later manual save', async () => {
    const { h, traps } = await stubHost();
    await h.newGame(settings());
    expect(await stepTo(h, 5)).toBe(5);
    expect(await h.save('auto')).toMatchObject({ t: 'saved' });
    expect(await stepTo(h, 5)).toBe(10);
    expect(await h.save('manual', 'mine')).toMatchObject({ t: 'saved' });
    expect(await stepTo(h, 2)).toBe(12);
    await h.dev({ op: 'panic' });
    h.control({ step: 1 });
    await until(() => traps.length === 1 && h.gen === 2, 'the recovery');
    expect(h.lastTick).toBe(5);
    h.close();
  });
});

describe('C3-r1 2: a recovery never replaces a newer world', () => {
  it('a new game started while the trap’s bundle is being kept: no notice, no recovery, the new game stays', async () => {
    const { io } = await testIo();
    // The IO worker's answers to the bundle (or, before C3-r1, the base's export) wait for the gate.
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const request = io.request.bind(io);
    io.request = ((req: Parameters<IoClient['request']>[0], transfer?: Transferable[]) =>
      req.t === 'bundle' || req.t === 'export'
        ? gate.then(() => request(req, transfer))
        : request(req, transfer)) as IoClient['request'];
    const errors: string[] = [];
    const { h, traps, generations } = await stubHost({
      io,
      events: { log: (level, msg) => (level === 'error' ? errors.push(msg) : undefined) },
    });
    await h.newGame(settings());
    expect(await stepTo(h, 3)).toBe(3);
    expect(await h.save('auto')).toMatchObject({ t: 'saved' });
    await h.dev({ op: 'panic' });
    h.control({ step: 1 });
    await until(() => errors.some((e) => e.includes('trapped at tick 4')), 'the trap');
    const b = await h.newGame(settings(7));
    expect(b.gen).toBe(2);
    open();
    for (let i = 0; i < 200; i++) await settle();
    expect(h.gen).toBe(2);
    expect(generations).toEqual([1, 2]);
    expect(traps).toEqual([]);
    h.close();
  });
});

describe('C3-r1 3: a failed or superseded replacement rejects, and its worker goes', () => {
  it('a world that traps in its first extraction (after bound): the replacement rejects and its worker ends', async () => {
    const { h, workers } = await stubHost();
    const r = await outcome(h.newGame(settings(STUB_TRAP_ON_EXTRACT_SEED)));
    expect(r).not.toBe('pending');
    expect(r !== 'pending' && 'err' in r ? r.err.message : 'resolved').toMatch(/trapped/);
    expect(workers[0]?.terminated).toBe(1);
    h.close();
  });

  it('a replacement superseded before its worker is ready rejects; the newer one is shown', async () => {
    const { h } = await stubHost();
    const first = outcome(h.newGame(settings(1)));
    const second = await h.newGame(settings(2));
    expect(second.gen).toBe(2);
    const r = await first;
    expect(r).not.toBe('pending');
    expect(r !== 'pending' && 'err' in r ? r.err.message : 'resolved').toMatch(
      /replaced before it was shown/,
    );
    h.close();
  });

  it('close rejects every request still waiting on a world', async () => {
    const { h, workers } = await stubHost();
    await h.newGame(settings());
    (workers[0] as ReturnType<typeof watched>).mute = true;
    const hash = outcome(h.dev({ op: 'hash' }));
    const save = outcome(h.save('auto'));
    h.close();
    for (const r of [await hash, await save]) {
      expect(r).not.toBe('pending');
      expect(r !== 'pending' && 'err' in r ? r.err.message : 'resolved').toMatch(/closed/);
    }
  });
});

describe('C3-r1 4: an extraction that cannot run is owed, not retried at once', () => {
  it('a hidden, paused world with a view: no wake storm; the packet comes when the page shows', async () => {
    const h = new ShellHarness();
    await h.boot(await stubSim());
    await h.newWorld(1);
    const packets = h.packets.length;
    await h.send({ t: 'hidden', hidden: true });
    await h.send({ t: 'view', gen: 1, v: { ...loadView(), view_seq: 1 } });
    h.fired = 0;
    h.advance(100);
    expect(h.fired).toBeLessThanOrEqual(2);
    expect(h.packets.length).toBe(packets);
    await h.send({ t: 'hidden', hidden: false });
    h.advance(20);
    expect(h.packets.length).toBe(packets + 1);
  });

  it('no free buffer: no wake storm; the owed packet goes out when a buffer comes back', async () => {
    const h = new ShellHarness();
    await h.boot(await stubSim());
    await h.newWorld(1);
    h.hold = true;
    for (let i = 0; i < 3; i++) await h.step(1); // the three buffers are out
    const packets = h.packets.length;
    await h.send({ t: 'view', gen: 1, v: { ...loadView(), view_seq: 1 } });
    h.fired = 0;
    h.advance(100);
    expect(h.fired).toBeLessThanOrEqual(2);
    expect(h.packets.length).toBe(packets);
    h.hold = false;
    h.release();
    h.advance(5);
    expect(h.packets.length).toBe(packets + 1);
  });
});

const loadView = () => ViewRequestCodec.decode(golden('view.bin'));

describe('C3-r1 5: an act with blobs is stamped when it arrives (§15.3, D22)', () => {
  it('a release_inputs sent after a walking action that names a blob cannot overtake it', async () => {
    const h = new ShellHarness();
    await h.boot(await stubSim());
    await h.newWorld(1);
    const blob = new Uint8Array(70_000).fill(7);
    const name = new Uint8Array(createHash('sha256').update(blob).digest());
    const put = new Uint8Array(32 + blob.length);
    put.set(name, 0);
    put.set(blob, 32);
    const bp = actionBytes({
      type: 'place_blueprint',
      ...PlaceBlueprintActionCodec.defaults(),
      record: { blob: name },
    });
    const walk = actionBytes({ type: 'start_walking', input_gen: 0, dir: 2 });
    const acts = new Uint8Array(bp.length + walk.length);
    acts.set(bp, 0);
    acts.set(walk, bp.length);
    const release = actionBytes({ type: 'release_inputs', player: 0 });
    // As they arrive from the main thread: the act, then (in the same turn) the release.
    void h.shell.handle({ t: 'act', gen: 1, firstSeq: 1, actions: acts.buffer, blobs: [put.buffer] });
    void h.shell.handle({ t: 'dev', id: 9, op: { op: 'system', actions: release.slice().buffer } });
    for (let i = 0; i < 20; i++) await settle();
    await h.step(2);
    await h.send({ t: 'dev', id: 10, op: { op: 'bundle' } });
    const log = parseClosureLog(new Uint8Array(h.last('bundle')?.bundle.log as ArrayBuffer));
    const tick1 = closureActions(log.records.find((r) => r.tick === 1)?.closure as Uint8Array);
    const types = tick1.map((a) => a.type);
    const w = types.indexOf(ActionType.start_walking);
    const rel = types.indexOf(ActionType.release_inputs);
    expect(w).toBeGreaterThanOrEqual(0);
    expect(rel).toBeGreaterThan(w);
    // Stamped with the generation before the release (the sequencer's, D22).
    expect(tick1[w]?.payload[0]).toBe(0);
    expect(h.errors()).toEqual([]);
  });

  it('a blob that does not hash to its name refuses the whole act, synchronously', async () => {
    const h = new ShellHarness();
    await h.boot(await stubSim());
    await h.newWorld(1);
    const bad = new Uint8Array(64).fill(1);
    void h.shell.handle({
      t: 'act',
      gen: 1,
      firstSeq: 1,
      actions: actionBytes({ type: 'start_walking', input_gen: 0, dir: 2 }).slice().buffer,
      blobs: [bad.buffer],
    });
    expect(h.last('error')).toMatchObject({ op: 'act' });
  });
});

describe('C3-r1 7: closure-port blobs are verified, and dropped after their last tick', () => {
  const blobClosure = (tick: number, seq: number, name: Uint8Array) =>
    encodeClosure([
      {
        player: 0,
        system: false,
        tick,
        firstSeq: seq,
        actions: [
          actionBytes({
            type: 'place_blueprint',
            ...PlaceBlueprintActionCodec.defaults(),
            record: { blob: name },
          }),
        ],
      },
    ]);

  it('a bad or missing blob refuses the message before the horizon moves; a good one is held while named', () => {
    const blob = new Uint8Array(1000).fill(3);
    const name = new Uint8Array(createHash('sha256').update(blob).digest());
    const put = new Uint8Array(32 + blob.length);
    put.set(name, 0);
    put.set(blob, 32);
    const bad = put.slice();
    bad[40] = (bad[40] as number) ^ 1;
    const c1 = blobClosure(1, 1, name).slice().buffer;
    const c2 = blobClosure(2, 2, name).slice().buffer;
    const src = new PortSource(0);
    expect(String(src.receive(1, [c1, c2], [bad.buffer]))).toMatch(/does not hash to its name/);
    expect(src.horizon()).toBe(0);
    expect(String(src.receive(1, [c1, c2], []))).toMatch(/did not come/);
    expect(src.horizon()).toBe(0);
    expect(src.receive(1, [c1, c2], [put.slice().buffer])).toBeNull();
    expect(src.horizon()).toBe(2);
    expect(src.blobs(1)?.length).toBe(1);
    src.done(1);
    expect(src.heldBlobs).toBe(1); // tick 2 names it too
    src.done(2);
    expect(src.heldBlobs).toBe(0);
  });
});

describe('C3-r1 8: a remapped load’s base is a snapshot in this build’s identity', () => {
  it('the start base of a save of other prototypes reloads to the same state', async () => {
    const input = LoadInputCodec.decode(golden('abi/traces/remap-load/02-sim_load.in.bin'));
    const w = new Writer();
    w.u32(input.sections.length, 'sections');
    for (const f of input.sections) SectionFrameCodec.write(w, f);
    const start = readSaveContainer(golden('start.save')).header;
    const header = {
      ...start,
      prototypesHash: 'a'.repeat(64),
      nameTables: { ...start.nameTables, item: ['iron-ore', 'iron-chest', 'copper-plate', 'iron-plate'] },
    };
    const h = new ShellHarness({ model: true });
    await h.boot(null);
    await h.send({ t: 'seq', op: 'pause' });
    await h.send({
      t: 'world',
      gen: 1,
      op: 'load',
      sections: w.finish().slice().buffer as ArrayBuffer,
      meta: {
        lineage: input.r.toString(16).padStart(16, '0'),
        prototypesHash: header.prototypesHash,
        tick: 0,
        header,
      },
    });
    await h.send({ t: 'dev', id: 1, op: { op: 'bundle' } });
    const base = h.last('bundle')?.bundle.base;
    if (base?.kind !== 'start') throw new Error(`base ${base?.kind}`);
    expect(base.header.prototypesHash).toBe(sha256hex(goldenProtos()));
    const out = SaveOutputCodec.decode(new Uint8Array(base.save));
    const container = writeSaveContainer(
      { ...base.header, lineage: out.r.toString(16).padStart(16, '0') },
      out.sections,
    );
    const again = new ShellHarness({ model: true });
    await again.boot(null);
    await again.load(container);
    await again.send({ t: 'dev', id: 2, op: { op: 'hash' } });
    const want = StateHashCodec.decode(golden('abi/traces/remap-load/04-sim_state_hash.out.bin')).hash;
    expect(StateHashCodec.decode(new Uint8Array(again.last('res')?.value as ArrayBuffer)).hash).toBe(want);
  });
});

describe('C3-r1 11: cancelling running queries starts the waiting ones', () => {
  it('five queries, the four running cancelled: the fifth answers', async () => {
    const h = new ShellHarness({ model: true });
    await h.boot(null);
    await h.load(golden('start.save'));
    const q = new Uint8Array(4);
    new DataView(q.buffer).setUint16(0, QueryKind.hash, true);
    for (let id = 1; id <= 5; id++) await h.send({ t: 'query', gen: 1, id, q: q.slice().buffer });
    for (let id = 1; id <= 4; id++) await h.send({ t: 'cancel', gen: 1, id });
    h.advance(50);
    expect(h.of('res').map((r) => r.id)).toEqual([5]);
  });
});

describe('C3-r1 12: each step is answered by its own reply', () => {
  it('concurrent step(1) and step(2) resolve at ticks 1 and 3', async () => {
    const { h } = await stubHost();
    await h.newGame(settings());
    const hooks = gameHooks(h);
    expect(await Promise.all([hooks.step(1), hooks.step(2)])).toEqual([1, 3]);
    h.close();
  });
});

describe('C3-r1 13: showing the page does not undo the player’s pause', () => {
  it('pause, hide, show: no resume; without the pause, hide pauses and show resumes', async () => {
    const { h, workers } = await stubHost({ test: false });
    await h.newGame(settings());
    const w = workers[0] as ReturnType<typeof watched>;
    const seqOps = () => w.sent.flatMap((m) => (m.t === 'seq' && typeof m.op === 'string' ? [m.op] : []));
    h.control('pause');
    h.setHidden(true);
    h.setHidden(false);
    expect(seqOps()).toEqual(['pause']);
    h.control('resume');
    h.setHidden(true);
    h.setHidden(false);
    expect(seqOps()).toEqual(['pause', 'resume', 'pause', 'resume']);
    h.close();
  });
});

describe('C3-r1 14: the trap’s bundle is assembled by the IO worker', () => {
  it('the main thread asks for a bundle and receives no container', async () => {
    const opfs = new MemoryOpfs();
    const { io } = await testIo({ opfs });
    const asked: string[] = [];
    const got: number[] = [];
    const request = io.request.bind(io);
    io.request = ((req: Parameters<IoClient['request']>[0], transfer?: Transferable[]) => {
      asked.push(req.t);
      return request(req, transfer).then((r) => {
        if (r.t === 'bundled' && r.save) got.push(r.save.byteLength);
        if (r.t === 'exported') got.push(r.bytes.byteLength);
        return r;
      });
    }) as IoClient['request'];
    const { h, traps } = await stubHost({ io });
    await h.newGame(settings());
    expect(await stepTo(h, 3)).toBe(3);
    expect(await h.save('auto')).toMatchObject({ t: 'saved' });
    asked.length = 0;
    await h.dev({ op: 'panic' });
    h.control({ step: 1 });
    await until(() => traps.length === 1 && h.gen === 2, 'the recovery');
    expect(asked).toContain('bundle');
    expect(asked).not.toContain('export');
    expect(got).toEqual([]);
    expect(opfs.names('reports').some((n) => n.endsWith('/save.save'))).toBe(true);
    h.close();
  });
});

describe('C3-r1 15: a buffer back from another thread keeps its slot', () => {
  it('a transferred buffer (another object) re-points a posted slot: no new slot objects', () => {
    const pool = new PacketPool(1, 1024);
    const s1 = pool.take(100);
    if (!s1) throw new Error('no buffer');
    pool.posted(s1);
    const moved = structuredClone(s1.buf, { transfer: [s1.buf] });
    expect(moved).not.toBe(s1.buf);
    pool.release(moved);
    const s2 = pool.take(100);
    expect(s2 === s1).toBe(true);
    expect(s2?.buf === moved).toBe(true);
    expect(pool.made).toBe(0);
  });
});

describe('C3-r1 16: packets fan out to every listener before the ack', () => {
  it('two packet listeners each see every packet; the buffer goes back after both', async () => {
    const { h, workers } = await stubHost();
    const a: number[] = [];
    const b: number[] = [];
    let acked = 0;
    h.on('packet', (_bytes, gen) => a.push(gen));
    h.on('packet', (bytes) => {
      b.push(bytes.length);
      // The worker has not had this buffer back yet: the ack follows the listeners.
      acked = (workers[0] as ReturnType<typeof watched>).sent.filter((m) => m.t === 'ack').length;
    });
    await h.newGame(settings());
    expect(await stepTo(h, 2)).toBe(2);
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(b.length).toBe(a.length);
    expect(acked).toBe(a.length - 1);
    h.close();
  });
});

describe('C3-r1 6: a background swap hands over only once the shadow has caught up (S11)', () => {
  it('the old world plays on while the shadow catches up with the room’s closure port, then hands over', async () => {
    const { h, io, generations } = await stubHost();
    await h.newGame(settings());
    expect(await stepTo(h, 10)).toBe(10);
    expect(await h.save('manual', 'checkpoint-10')).toMatchObject({ t: 'saved' });
    expect(await stepTo(h, 30)).toBe(40);
    const r = await io.request({ t: 'read', name: 'checkpoint-10' });
    if (r.t !== 'read') throw new Error(JSON.stringify(r));
    const room = new MessageChannel();
    const swap = h.replace(
      { op: 'load', sections: r.sections, meta: metaOf(r.header, 'checkpoint-10') },
      { background: true, closurePort: room.port1, handover: { tick: 40 } },
    );
    // The shadow is bound at tick 10 but not shown: generation 1 is, and still plays.
    for (let i = 0; i < 50; i++) await settle();
    expect(h.gen).toBe(1);
    expect(await stepTo(h, 1)).toBe(41);
    // The room's closures of ticks 11–40 catch the shadow up; then it hands over.
    room.port2.postMessage({
      t: 'closures',
      first: 11,
      closures: Array.from({ length: 30 }, () => new ArrayBuffer(0)),
      blobs: [],
    });
    const b = await swap;
    expect(b.gen).toBe(2);
    expect(h.gen).toBe(2);
    expect(h.lastTick).toBeGreaterThanOrEqual(40);
    expect(generations).toEqual([1, 2]);
    h.close();
  });
});
