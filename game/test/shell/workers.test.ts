// The worldgen and IO workers (src/genworker, src/ioworker; 10 §3.1, §8.2, §15.9) with the sim worker's shell,
// in-process over MessageChannels: the pool answers chunk requests before their commit tick (the stub sim logs
// "supplied"), a late, refused or absent pool leaves them to inline generation; saves go through the IO worker
// (deflate, SHA-256, IndexedDB here, OPFS in browsers) and load back to the same state; autosave slots rotate;
// damaged and malformed containers are refused.
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inlineGen, inlineIo } from '../../src/app/inline.ts';
import { IoService } from '../../src/ioworker/io.ts';
import { MemorySaveLock } from '../../src/ioworker/ownership.ts';
import { claimEpoch, IdbStorage } from '../../src/ioworker/storage.ts';
import { PreviewRequestCodec } from '../../src/shared/gen/abi.ts';
import { actionBytes } from '../../src/shared/gen/actions.ts';
import { readSaveContainer } from '../../src/shared/gen/container.ts';
import { StateHashCodec } from '../../src/shared/gen/projections.ts';
import type { GenToMain } from '../../src/shared/gen-protocol.ts';
import type { IoReply, IoRequest } from '../../src/shared/io-protocol.ts';
import { freshDb } from '../helpers/io.ts';
import { golden, manifest, ShellHarness, settle } from '../helpers/shell-harness.ts';
import { STUB_COMMAND, scaffold, stubGen, stubSim } from '../helpers/stubs.ts';

const sha256 = async (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());
const env = { sha256, now: () => performance.now() };

/** A pool of in-process worldgen workers booted with `module`; their pool ports for the shell. */
function pool(
  module: WebAssembly.Module,
  n: number,
): { ports: MessagePort[]; main: GenToMain[]; stop(): void } {
  const main: GenToMain[] = [];
  const ports: MessagePort[] = [];
  const workers = Array.from({ length: n }, () => inlineGen());
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<GenToMain>) => main.push(e.data);
    const ch = new MessageChannel();
    w.postMessage({ t: 'boot', build: manifest(), module });
    w.postMessage({ t: 'port', port: ch.port1 }, [ch.port1]);
    ports.push(ch.port2);
  }
  return {
    ports,
    main,
    stop: () => {
      for (const w of workers) w.terminate();
    },
  };
}

const logs = (h: ShellHarness, what: string) =>
  h.out.filter((m) => m.t === 'log' && m.msg.includes(what)).map((m) => (m as { msg: string }).msg);

async function settleAll(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await settle();
}

describe('the worldgen pool (§15.9)', () => {
  it('answers the requests before their commit tick: supplied, not generated inline', async () => {
    const p = pool(await stubGen(), 2);
    const h = new ShellHarness();
    await h.boot(await stubSim(), manifest(), { genPorts: p.ports });
    await h.newWorld(1);
    await settleAll();
    expect(p.main.filter((m) => m.t === 'ready')).toHaveLength(2);
    await h.step(2);
    expect(logs(h, 'supplied at tick 2')).toHaveLength(4);
    expect(logs(h, 'generated inline')).toHaveLength(0);
    h.shell.close();
    p.stop();
  });

  it('requests that come with a tick reach the pool too (the per-tick sim_pending_chunks)', async () => {
    const p = pool(await stubGen(), 2);
    const h = new ShellHarness();
    await h.boot(await stubSim(), manifest(), { genPorts: p.ports });
    await h.newWorld(1);
    await settleAll();
    await h.step(3);
    const cmd = actionBytes({ type: 'debug_dump', dump_id: STUB_COMMAND.request });
    await h.send({ t: 'dev', id: 1, op: { op: 'system', actions: cmd.slice().buffer } });
    await h.step(1); // tick 4 issues the requests for tick 34; the shell reads them after the tick
    await settleAll();
    expect(logs(h, 'supplied for tick 34')).toHaveLength(2);
    await h.step(30);
    expect(logs(h, 'supplied at tick 34')).toHaveLength(2);
    expect(logs(h, 'chunk 5,0 generated inline')).toHaveLength(0);
    h.shell.close();
    p.stop();
  });

  it('with no pool, or a late one, the same chunks are generated inline (D12)', async () => {
    const h = new ShellHarness();
    await h.boot(await stubSim());
    await h.newWorld(1);
    await h.step(2);
    expect(logs(h, 'generated inline')).toHaveLength(4);
    const p = pool(await stubGen(), 1);
    const late = new ShellHarness();
    await late.boot(await stubSim(), manifest(), { genPorts: p.ports });
    await late.newWorld(1);
    await late.step(2); // before any answer arrived
    await settleAll();
    expect(logs(late, 'generated inline')).toHaveLength(4);
    expect(logs(late, 'supplied')).toHaveLength(0);
    // The digests do not depend on the pool.
    expect(late.shell.digests.get(2)).toBe(h.shell.digests.get(2));
    late.shell.close();
    p.stop();
  });

  it('a refused module (the M0 scaffold gen.wasm) leaves everything to inline generation', async () => {
    const p = pool(await scaffold(), 1);
    const h = new ShellHarness();
    await h.boot(await stubSim(), manifest(), { genPorts: p.ports });
    await h.newWorld(1);
    await settleAll();
    expect(p.main.find((m) => m.t === 'refused')).toMatchObject({ reason: 'scaffold', abi: 0 });
    await h.step(2);
    expect(logs(h, 'generated inline')).toHaveLength(4);
    h.shell.close();
    p.stop();
  });

  it('answers a map preview on its own channel', async () => {
    const w = inlineGen();
    const got: GenToMain[] = [];
    w.onmessage = (e: MessageEvent<GenToMain>) => got.push(e.data);
    w.postMessage({ t: 'boot', build: manifest(), module: await stubGen() });
    const world = new Uint8Array([8, 0, 0, 0, 1, 0, 4, 0, 0, 0, 7, 0, 0, 0]); // too short: init fails
    w.postMessage({
      t: 'init',
      id: 1,
      gen: 1,
      protos: golden('protos/prototypes.bin').buffer,
      world: world.buffer,
    });
    w.postMessage({
      t: 'preview',
      id: 2,
      gen: 1,
      request: PreviewRequestCodec.encode({ x0: 0, y0: 0, width: 4, height: 2, step: 8, flags: 0 }).buffer,
    });
    await settleAll();
    expect(got.find((m) => m.t === 'failed' && m.id === 1)).toBeDefined();
    // Without a successful init the preview is refused too (ERR_ORDER).
    expect(got.find((m) => m.t === 'failed' && m.id === 2)).toMatchObject({ status: 6 });
    w.terminate();
  });
});

/** An IO worker over fake IndexedDB, and a port for a shell. */
async function ioWorker(): Promise<{
  port(): MessagePort;
  request(r: IoRequest): Promise<IoReply>;
  stop(): void;
}> {
  const db = await freshDb();
  const w = inlineIo(env, {
    storage: Promise.resolve({ storage: new IdbStorage(db), db }),
    lock: new MemorySaveLock(),
    channel: null,
  });
  const waiting = new Map<number, (r: IoReply) => void>();
  w.onmessage = (e: MessageEvent<IoReply | { t: 'ready' }>) => {
    const m = e.data;
    if ('id' in m) waiting.get(m.id)?.(m);
  };
  return {
    port() {
      const ch = new MessageChannel();
      w.postMessage({ t: 'port', port: ch.port1 }, [ch.port1]);
      return ch.port2;
    },
    request(r) {
      return new Promise((resolve) => {
        waiting.set(r.id, resolve);
        w.postMessage(r);
      });
    },
    stop: () => w.terminate(),
  };
}

async function untilSaved(h: ShellHarness, n: number): Promise<void> {
  for (let i = 0; i < 200 && h.of('saved').length + h.of('saveFailed').length < n; i++) await settle();
}

describe('the IO worker (§8.1–§8.6)', () => {
  it('stores a save (deflated, SHA-256) and reads it back to the same state; an autosave becomes the log base', async () => {
    const io = await ioWorker();
    const h = new ShellHarness({ model: true });
    await h.boot(null, manifest(), { ioPort: io.port() });
    await h.load(golden('start.save'), 1, 'start');
    await h.step(5);
    await h.send({ t: 'save', id: 1, reason: 'manual', name: 'mine' });
    await untilSaved(h, 1);
    const saved = h.last('saved');
    expect(saved).toMatchObject({ id: 1 });
    const list = await io.request({ t: 'list', id: 10 });
    expect(list.t === 'list' && list.saves.map((s) => s.name)).toEqual(['mine']);
    const read = await io.request({ t: 'read', id: 11, name: 'mine' });
    if (read.t !== 'read') throw new Error(JSON.stringify(read));
    expect(read.header.tick).toBe(5);
    expect(read.info.sha256).toBe(saved?.sha256);
    // The container's sections are deflated (codec 1).
    const exported = await io.request({ t: 'export', id: 12, name: 'mine' });
    if (exported.t !== 'exported') throw new Error('export');
    expect(readSaveContainer(new Uint8Array(exported.bytes)).frames.some((f) => f.codec === 1)).toBe(true);
    // Loaded into a fresh shell: the same state hash.
    await h.send({ t: 'dev', id: 2, op: { op: 'hash' } });
    const before = StateHashCodec.decode(new Uint8Array(h.last('res')?.value as ArrayBuffer));
    const h2 = new ShellHarness({ model: true });
    await h2.boot(null);
    await h2.send({ t: 'seq', op: 'pause' });
    await h2.send({
      t: 'world',
      gen: 2,
      op: 'load',
      sections: read.sections,
      meta: {
        lineage: read.header.lineage,
        prototypesHash: read.header.prototypesHash,
        tick: 5,
        header: read.header,
        name: 'mine',
      },
    });
    await h2.send({ t: 'dev', id: 3, op: { op: 'hash' } });
    const after = StateHashCodec.decode(new Uint8Array(h2.last('res')?.value as ArrayBuffer));
    expect(after.hash).toBe(before.hash);
    // §8.5: a manual save is not the closure log's base; the last autosave is, as its exact stored version.
    await h.send({ t: 'dev', id: 4, op: { op: 'bundle' } });
    expect(h.last('bundle')?.bundle.base.kind).toBe('start');
    await h.send({ t: 'save', id: 5, reason: 'auto' });
    await untilSaved(h, 2);
    await h.send({ t: 'dev', id: 6, op: { op: 'bundle' } });
    const base = h.last('bundle')?.bundle.base;
    const auto = await io.request({ t: 'read', id: 13, name: '_autosave1' });
    if (auto.t !== 'read') throw new Error(JSON.stringify(auto));
    expect(base).toEqual({
      kind: 'save',
      version: { name: '_autosave1', file: auto.info.file, sha256: h.last('saved')?.sha256 },
      tick: 5,
    });
    io.stop();
  });

  it('rotates three autosave slots, and keeps a checkpoint with its manifest (§8.4, §8.6)', async () => {
    const io = await ioWorker();
    const h = new ShellHarness({ model: true });
    await h.boot(null, manifest(), { ioPort: io.port() });
    await h.load(golden('start.save'));
    for (let i = 1; i <= 4; i++) {
      await h.step(1);
      await h.send({ t: 'save', id: i, reason: 'auto' });
      await untilSaved(h, i);
    }
    await h.send({ t: 'save', id: 5, reason: 'checkpoint' });
    await untilSaved(h, 5);
    const list = await io.request({ t: 'list', id: 20 });
    if (list.t !== 'list') throw new Error('list');
    const byName = new Map(list.saves.map((s) => [s.name, s]));
    expect([...byName.keys()].sort()).toEqual(['_autosave1', '_autosave2', '_autosave3', '_checkpoint']);
    expect(byName.get('_autosave1')?.tick).toBe(4); // the fourth autosave replaced the oldest slot
    const cp = byName.get('_checkpoint');
    expect(cp?.manifest).toMatchObject({ id: '_checkpoint', tick: 4, chunkSize: 65536, sha256: cp?.sha256 });
    expect(cp?.manifest?.stateHash).toMatch(/^[0-9a-f]{16}$/);
    io.stop();
  });

  it('refuses damaged bytes, truncated and trailing containers, and a newer format', async () => {
    const db = await freshDb();
    const store = new IdbStorage(db);
    const fence = await claimEpoch(db, 0);
    const svc = new IoService(store, env, () => fence);
    const imp = await svc.handle({ t: 'import', id: 1, name: 'start', bytes: golden('start.save').buffer });
    expect(imp.reply.t).toBe('imported');
    // Damage the stored bytes: the SHA-256 kept with the metadata refuses them.
    const rec = await db.get('saves', 'start');
    rec.blob[100] ^= 1;
    await db.put('saves', rec);
    const read = await svc.handle({ t: 'read', id: 2, name: 'start' });
    expect(read.reply).toMatchObject({ t: 'failed' });
    expect((read.reply as { message: string }).message).toMatch(/SHA-256/);
    for (const bad of ['truncated', 'trailing'])
      expect(
        (
          await svc.handle({
            t: 'import',
            id: 3,
            name: bad,
            bytes: golden(`negative/saves/${bad}.save`).buffer,
          })
        ).reply.t,
      ).toBe('failed');
    const newer = golden('start.save').slice();
    new DataView(newer.buffer).setUint32(8, 3, true);
    expect((await svc.handle({ t: 'unpack', id: 4, bytes: newer.buffer })).reply.t).toBe('failed');
  });
});
