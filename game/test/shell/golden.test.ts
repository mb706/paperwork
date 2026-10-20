// The golden set from the shell's side (test/golden/README.md "Shell (C3)"; 10 §15.10):
// - the closure log replayed from start.save through the LocalSequencer's replay mode: with the reference model
//   behind the ABI the digests equal digests.txt (d_t at every tick, r at the end); with the stub, the framing
//   and order of every closure the module received;
// - the logs it must parse, and the negative logs it must refuse with the reader's error;
// - the golden flow's packets through the shell (the closure port, backpressure, state_gen and view_seq);
// - the negative saves through `world load`;
// - every ABI trace driven through the shell's module wrapper (statuses, envelopes, `sim_last_error`, state).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { closureActions } from '../../src/shared/gen/actions.ts';
import { Reader } from '../../src/shared/gen/codec.ts';
import { parseClosureLog, readSaveContainer } from '../../src/shared/gen/container.ts';
import { decodePacket, ViewRequestCodec } from '../../src/shared/gen/packet.ts';
import { StateHashCodec, SubRequestCodec } from '../../src/shared/gen/projections.ts';
import { handshake } from '../../src/simworker/module.ts';
import { STATUS_NAME } from '../golden/build/traces.ts';
import { modelExports } from '../helpers/model-module.ts';
import { GAME } from '../helpers/paths.ts';
import { golden, loadMessage, ShellHarness, settle } from '../helpers/shell-harness.ts';
import { stubDigest, stubSim } from '../helpers/stubs.ts';
import { invokeTrace } from './trace-invoke.ts';

const digestsTxt = () =>
  new TextDecoder()
    .decode(golden('digests.txt'))
    .trim()
    .split('\n')
    .slice(1)
    .map(
      (l) =>
        l.split(' ').map((x, i) => (i === 0 ? Number(x) : BigInt(`0x${x}`))) as [
          number,
          bigint,
          bigint,
          bigint,
        ],
    );

const index = () =>
  JSON.parse(readFileSync(join(GAME, 'test', 'golden', 'm0', 'negative', 'index.json'), 'utf8')) as {
    file: string;
    call: string;
    expect: string;
  }[];

async function modelWorld(container = golden('start.save')): Promise<ShellHarness> {
  const h = new ShellHarness({ model: true });
  await h.boot(null);
  await h.load(container, 1, 'start');
  return h;
}

/** Runs the timers until the replay ends (it yields every 12 ms of work). */
function runReplay(h: ShellHarness): void {
  for (let i = 0; i < 100_000 && h.of('replayed').length === 0; i++) h.advance(1);
}

describe('the golden closure log through the replay mode (§8.5)', () => {
  it('with the reference model: every d_t of digests.txt, and r_3600', async () => {
    const h = await modelWorld();
    await h.send({ t: 'replay', gen: 1, log: golden('closure-log.pwlog').slice().buffer });
    runReplay(h);
    expect(h.last('replayed')).toEqual({ t: 'replayed', gen: 1, ok: true, tick: 3600 });
    const want = digestsTxt();
    expect(want).toHaveLength(3600);
    for (const [t, d] of want) expect(h.shell.digests.get(t), `d_${t}`).toBe(d);
    await h.send({ t: 'dev', id: 1, op: { op: 'digest' } });
    const v = new DataView(h.last('res')?.value as ArrayBuffer);
    expect(v.getUint32(0, true)).toBe(3600);
    expect(v.getBigUint64(12, true)).toBe(want[3599]?.[3]);
    // The replay ran as a fast-forward: extraction off, events historical, then one packet at its end.
    expect(h.packets.at(-1)?.packet.header.tick).toBe(3600);
    expect(h.packets.length).toBe(2);
    expect(h.last('bound')?.tick).toBe(3600);
    expect(h.errors()).toEqual([]);
  });

  it('with the stub: every closure reached the module in order, byte for byte (the stub digests them)', async () => {
    const h = new ShellHarness();
    await h.boot(await stubSim());
    await h.load(golden('start.save'), 1, 'start');
    // The digest-less log, restamped with the stub's own start state hash (it hashes its own state).
    await h.send({ t: 'dev', id: 1, op: { op: 'hash' } });
    const stubHash = StateHashCodec.decode(new Uint8Array(h.last('res')?.value as ArrayBuffer)).hash;
    const log = golden('logs/no-digests.pwlog').slice();
    new DataView(log.buffer).setBigUint64(80, stubHash, true);
    await h.send({ t: 'replay', gen: 1, log: log.buffer });
    runReplay(h);
    expect(h.last('replayed')).toMatchObject({ ok: true });
    const parsed = parseClosureLog(log);
    const byTick = new Map(parsed.records.map((r) => [r.tick, r.closure]));
    for (let t = 1; t <= parsed.header.end_tick; t++)
      expect(h.shell.digests.get(t), `tick ${t}`).toBe(stubDigest(t, byTick.get(t) ?? new Uint8Array()));
    // The blob the log names reached the module before its tick: the preflight would refuse it otherwise.
    expect(parsed.blobs).toHaveLength(1);
    expect(h.errors()).toEqual([]);
  });

  it('reports the first digest that differs from the log', async () => {
    const h = await modelWorld();
    const log = golden('closure-log.pwlog').slice();
    const p = parseClosureLog(log);
    // Corrupt d_100 in the digest region.
    const at =
      log.length - 8 * (p.header.digest_count - (100 - p.header.digest_first_tick)) - p.header.blob_bytes;
    log[at] = (log[at] as number) ^ 1;
    await h.send({ t: 'replay', gen: 1, log: log.buffer });
    runReplay(h);
    const r = h.last('replayed');
    expect(r).toMatchObject({ ok: false, tick: 100, mismatch: { tick: 100 } });
    expect(r?.mismatch?.actual).toBe(digestsTxt()[99]?.[1].toString(16).padStart(16, '0'));
  });

  it('refuses a log that does not start from the world (tick, state, prototypes)', async () => {
    const h = await modelWorld();
    await h.send({ t: 'replay', gen: 1, log: golden('logs/empty.pwlog').slice().buffer });
    expect(h.last('replayed')).toMatchObject({ ok: false });
  });
});

describe('closure logs (§8.5): the golden logs parse, the negative ones are refused', () => {
  it('parses logs/*', () => {
    expect(parseClosureLog(golden('logs/empty.pwlog')).records).toEqual([]);
    expect(parseClosureLog(golden('logs/no-digests.pwlog')).header.end_tick).toBe(3600);
  });

  it('refuses every negative log with the indexed error, also as a replay', async () => {
    const cases = index().filter((c) => c.file.startsWith('logs/'));
    expect(cases.length).toBeGreaterThanOrEqual(6);
    for (const c of cases) {
      const bytes = golden(`negative/${c.file}`);
      expect(() => parseClosureLog(bytes), c.file).toThrow();
      try {
        parseClosureLog(bytes);
      } catch (e) {
        const err = e as { kind: string; field: string; at: number };
        expect(`${err.kind} ${err.field} @${err.at}`, c.file).toBe(c.expect);
      }
      const h = await modelWorld();
      await h.send({ t: 'replay', gen: 1, log: bytes.slice().buffer });
      expect(h.last('replayed')?.message, c.file).toContain(c.expect.split(' ')[0] as string);
    }
  });
});

describe('the golden packets through the shell (§15.4, README "The golden flow")', () => {
  it('reproduces packets/*.bin with state_gen and view_seq filled in', async () => {
    const h = new ShellHarness({ model: true });
    const ch = new MessageChannel();
    await h.boot(null, undefined, { closurePort: ch.port1 });
    h.hold = true;
    await h.load(golden('start.save'), 3, 'start', false);
    const subs: ReturnType<typeof SubRequestCodec.read>[] = [];
    const r = new Reader(golden('subs.bin'));
    const count = r.u16('count');
    for (let i = 0; i < count; i++) subs.push(SubRequestCodec.read(r));
    const view = { ...ViewRequestCodec.decode(golden('view.bin')), view_seq: 5 };
    await h.send({ t: 'sub', gen: 3, subs });
    await h.send({ t: 'view', gen: 3, v: view });
    h.advance(16);
    const log = parseClosureLog(golden('closure-log.pwlog'));
    const byTick = new Map(log.records.map((x) => [x.tick, x.closure]));
    const blobs = log.blobs.map((b) => {
      const u = new Uint8Array(32 + b.bytes.length);
      u.set(b.sha256.bytes, 0);
      u.set(b.bytes, 32);
      return u.buffer;
    });
    const send = (first: number, last: number) =>
      ch.port2.postMessage({
        t: 'closures',
        first,
        closures: Array.from(
          { length: last - first + 1 },
          (_, i) => (byTick.get(first + i) ?? new Uint8Array()).slice().buffer,
        ),
        blobs,
      });
    // Each message is run before the next is sent (MessagePort delivery takes its own time).
    const arrive = async (last: number) => {
      for (let i = 0; i < 1000 && h.shell.horizon < last; i++) await settle();
      expect(h.shell.horizon).toBe(last);
    };
    send(1, 1);
    await arrive(1);
    h.advance(2);
    expect(h.packets).toHaveLength(3);
    // Three packets are out (FULL, tick 0, tick 1): no free buffer, so ticks 2–600 run without extraction.
    for (let t = 2; t <= 600; t += 20) {
      send(t, Math.min(t + 19, 600));
      await arrive(Math.min(t + 19, 600));
      h.advance(10);
    }
    expect(h.shell.tick).toBe(600);
    h.release();
    h.advance(20);
    const names = ['tick-0000-full', 'tick-0000', 'tick-0001', 'tick-0600'];
    expect(h.packets).toHaveLength(4);
    h.packets.forEach((p, i) => {
      const want = golden(`packets/${names[i]}.bin`);
      const got = p.bytes.slice();
      const v = new DataView(got.buffer);
      expect(v.getUint32(8, true), names[i]).toBe(3);
      expect(v.getUint32(16, true), names[i]).toBe(i === 0 ? 0 : 5);
      v.setUint32(8, 0, true);
      v.setUint32(16, 0, true);
      expect(Buffer.compare(got, want), names[i]).toBe(0);
    });
    expect(decodePacket(h.packets[3]?.bytes as Uint8Array).header.flags).toBe(4); // COALESCED
    expect(h.errors()).toEqual([]);
  });
});

describe('the negative saves (§8.1, §8.3) through `world load`', () => {
  it('refuses each with its status, or with the container reader', async () => {
    for (const c of index().filter((x) => x.file.startsWith('saves/'))) {
      const bytes = golden(`negative/${c.file}`);
      if (c.expect.startsWith('refused by the container reader')) {
        expect(() => readSaveContainer(bytes), c.file).toThrow();
        continue;
      }
      const h = await modelWorld(bytes);
      if (c.expect === 'ok') expect(h.of('bound'), c.file).toHaveLength(1);
      else {
        const e = h.last('error');
        expect(e?.op, c.file).toBe('world');
        expect(STATUS_NAME.get(e?.status as number), c.file).toBe(c.expect);
        expect(h.of('bound'), c.file).toHaveLength(0);
      }
    }
  });

  it('remaps a save of other prototypes by name (§8.3): the trace remap-load’s tables', async () => {
    // remap-load's input is sim_load's; the shell builds the same tables from a header's name tables.
    const c = readSaveContainer(golden('start.save'));
    const header = { ...c.header, prototypesHash: 'a'.repeat(64) };
    header.nameTables = {
      ...header.nameTables,
      item: ['iron-ore', 'iron-chest', 'copper-plate', 'iron-plate'],
    };
    const { remapTables } = await import('../../src/simworker/remap.ts');
    const tables = remapTables(header.nameTables, c.header.nameTables);
    expect(tables).toEqual([
      { kind: 0, ids: [1, 0, 0xffff, 2], removed: [{ name: new TextEncoder().encode('copper-plate') }] },
    ]);
    expect(loadMessage).toBeDefined();
  });
});

describe('the ABI traces through the shell’s module wrapper (abi/traces.json)', () => {
  it('every sim trace replays: statuses, envelopes, sim_last_error and state assertions', () => {
    const traces = JSON.parse(
      readFileSync(join(GAME, 'test', 'golden', 'm0', 'abi', 'traces.json'), 'utf8'),
    ) as {
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
    let calls = 0;
    for (const t of traces.traces) {
      const sim = handshake(modelExports() as unknown as Record<string, unknown>, null, true);
      const hash = (): bigint | null => {
        try {
          return StateHashCodec.decode(sim.cold((m) => m.stateHash())).hash;
        } catch {
          return null;
        }
      };
      t.calls.forEach((c, i) => {
        if (c.call.startsWith('gen_')) return; // the worldgen workers' calls (src/genworker)
        const where = `${t.name} call ${i + 1} ${c.call}`;
        const before = hash();
        const r = invokeTrace(sim, c.call, c.in ? golden(c.in) : new Uint8Array(), c.params ?? []);
        const after = hash();
        expect(STATUS_NAME.get(r.status), where).toBe(c.status);
        if (c.out) expect(Buffer.compare(r.out as Uint8Array, golden(c.out)), where).toBe(0);
        else expect(r.out === undefined || c.status !== 'ok' || c.out === null, where).toBe(true);
        const state =
          before !== null && after !== null ? (before === after ? 'unchanged' : 'changed') : undefined;
        expect(state, where).toBe(c.state);
        calls += 1;
      });
    }
    expect(calls).toBeGreaterThan(300);
    expect(closureActions).toBeDefined();
  });
});
