// More of the shell end to end: a save of other prototypes remapped by name (§8.3: the remap-load trace's tables,
// load report and state), the closure port's catch-up (11 §3.6: extraction off, events historical), queries
// stepped by the shell (§15.5: four at once, the rest waiting, cancel), and SimHost driving the fake sim
// (`?sim=fake` speaks the same protocol, so the main thread's side works on it unchanged).
import { describe, expect, it } from 'vitest';
import { channelWorker } from '../../src/app/inline.ts';
import { SimHost } from '../../src/app/sim-host.ts';
import { LoadInputCodec, NewWorldCodec } from '../../src/shared/gen/abi.ts';
import { Writer } from '../../src/shared/gen/codec.ts';
import { parseClosureLog, readSaveContainer, SectionFrameCodec } from '../../src/shared/gen/container.ts';
import { readEvents } from '../../src/shared/gen/events.ts';
import { decodePacket, ViewRequestCodec } from '../../src/shared/gen/packet.ts';
import {
  ProjectionKind,
  QueryKind,
  readUiRecords,
  StateHashCodec,
} from '../../src/shared/gen/projections.ts';
import type { SimToMain } from '../../src/shared/protocol.ts';
import { FakeSim } from '../../src/simworker/fake.ts';
import { fakeProtos, fakeProtosBin } from '../fake/harness.ts';
import { golden, ShellHarness, settle } from '../helpers/shell-harness.ts';

describe('a save of other prototypes (§8.3)', () => {
  it('is remapped by name: the remap-load trace’s report and state', async () => {
    const input = LoadInputCodec.decode(golden('abi/traces/remap-load/02-sim_load.in.bin'));
    const w = new Writer();
    w.u32(input.sections.length, 'sections');
    for (const f of input.sections) SectionFrameCodec.write(w, f);
    const sections = w.finish().slice().buffer as ArrayBuffer;
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
      sections,
      meta: {
        lineage: input.r.toString(16).padStart(16, '0'),
        prototypesHash: header.prototypesHash,
        tick: 0,
        header,
      },
    });
    const report = h.last('loadReport');
    expect(
      Buffer.compare(
        new Uint8Array(report?.report as ArrayBuffer),
        golden('abi/traces/remap-load/03-sim_load_report.out.bin'),
      ),
    ).toBe(0);
    await h.send({ t: 'dev', id: 1, op: { op: 'hash' } });
    const want = StateHashCodec.decode(golden('abi/traces/remap-load/04-sim_state_hash.out.bin')).hash;
    expect(StateHashCodec.decode(new Uint8Array(h.last('res')?.value as ArrayBuffer)).hash).toBe(want);
    expect(h.errors()).toEqual([]);
  });
});

describe('the closure port (S11, 11 §3.6)', () => {
  it('a backlog over 30 ticks runs as catch-up: no packets meanwhile, then one whose events are historical', async () => {
    const h = new ShellHarness({ model: true });
    const ch = new MessageChannel();
    await h.boot(null, undefined, { closurePort: ch.port1 });
    await h.load(golden('start.save'), 1, 'start', false);
    await h.send({ t: 'view', gen: 1, v: { ...ViewRequestCodec.decode(golden('view.bin')), view_seq: 1 } });
    h.advance(16);
    const before = h.packets.length;
    const log = parseClosureLog(golden('closure-log.pwlog'));
    const byTick = new Map(log.records.map((x) => [x.tick, x.closure]));
    ch.port2.postMessage({
      t: 'closures',
      first: 1,
      closures: Array.from({ length: 100 }, (_, i) => (byTick.get(i + 1) ?? new Uint8Array()).slice().buffer),
      // The log's blob, needed by tick 55 (sha256 ‖ bytes).
      blobs: log.blobs.map((b) => {
        const u = new Uint8Array(32 + b.bytes.length);
        u.set(b.sha256.bytes, 0);
        u.set(b.bytes, 32);
        return u.buffer;
      }),
    });
    for (let i = 0; i < 1000 && h.shell.horizon < 100; i++) await settle();
    h.advance(5);
    expect(h.errors()).toEqual([]);
    expect(h.shell.tick).toBe(100);
    const after = h.packets.slice(before);
    expect(after).toHaveLength(1);
    const events = after[0]?.packet.sections.find((s) => s.name === 'EVENTS');
    expect(events).toBeDefined();
    const list = readEvents(events?.bytes as Uint8Array, events?.count as number);
    expect(list.length).toBeGreaterThan(10);
    expect(list.every((e) => (e.header.flags & 1) === 1)).toBe(true);
    // Live again: the next closure runs on time, its events not historical.
    ch.port2.postMessage({
      t: 'closures',
      first: 101,
      closures: [(byTick.get(101) ?? new Uint8Array()).slice().buffer],
      blobs: [],
    });
    for (let i = 0; i < 1000 && h.shell.horizon < 101; i++) await settle();
    h.advance(5);
    expect(h.shell.tick).toBe(101);
    expect(h.packets.at(-1)?.packet.header.tick).toBe(101);
    // In multiplayer the room paces the game: sequencer control and local actions are refused.
    await h.send({ t: 'act', gen: 1, firstSeq: 1, actions: new ArrayBuffer(0) });
    expect(h.last('error')).toMatchObject({ op: 'act' });
  });
});

describe('queries (§15.5)', () => {
  const q = (kind: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint16(0, kind, true);
    return b.buffer;
  };

  it('four run at once and the rest wait; each answers once; cancel drops one', async () => {
    const h = new ShellHarness({ model: true });
    await h.boot(null);
    await h.load(golden('start.save'));
    for (let id = 1; id <= 6; id++)
      await h.send({ t: 'query', gen: 1, id, q: q(id === 3 ? QueryKind.rates : QueryKind.hash) });
    await h.send({ t: 'cancel', gen: 1, id: 2 });
    await h.send({ t: 'cancel', gen: 1, id: 6 }); // waiting, never started
    await h.send({ t: 'query', gen: 7, id: 99, q: q(QueryKind.hash) }); // another generation: dropped
    h.advance(50);
    const res = h.of('res');
    expect(res.map((r) => r.id).sort()).toEqual([1, 3, 4, 5]);
    const hash = res.find((r) => r.id === 1);
    expect(hash?.ok).toBe(true);
    expect(StateHashCodec.decode(new Uint8Array(hash?.value as ArrayBuffer)).sections.length).toBeGreaterThan(
      0,
    );
    // `rates` is outside M0's manifest: refused as unsupported (reason 1).
    const rates = res.find((r) => r.id === 3);
    expect(rates?.ok).toBe(false);
    expect(new DataView(rates?.value as ArrayBuffer).getUint16(0, true)).toBe(1);
  });
});

describe('SimHost on the fake sim (§15.10: `?sim=fake` speaks the same protocol)', () => {
  it('a new game, a view and a subscription, a replacement: the fake follows the replacement protocol', async () => {
    const protos = fakeProtos();
    const fake = () =>
      channelWorker((port) => {
        const timers = new Set<ReturnType<typeof setTimeout>>();
        const sim = new FakeSim({
          post: (m, transfer) => port.postMessage(m, transfer ?? []),
          now: () => performance.now(),
          wake: (ms, f) => {
            const t = setTimeout(() => {
              timers.delete(t);
              f();
            }, ms);
            timers.add(t);
            return t;
          },
          cancel: (t) => {
            clearTimeout(t as ReturnType<typeof setTimeout>);
            timers.delete(t as ReturnType<typeof setTimeout>);
          },
          protos: async () => protos,
          protosBin: async () => fakeProtosBin(),
        });
        port.onmessage = (e: MessageEvent) => void sim.handle(e.data);
        return () => {
          for (const t of timers) clearTimeout(t);
        };
      });
    const packets: { gen: number; tick: number; ui: number[] }[] = [];
    const generations: number[] = [];
    const host = new SimHost({
      build: { build: 'm1', buildHash: '0'.repeat(64), dev: true },
      sim: null,
      createSim: fake,
      test: true,
      events: {
        packet: (bytes, gen) => {
          const p = decodePacket(bytes);
          const ui = p.sections
            .filter((s) => s.name === 'UI')
            .flatMap((s) => readUiRecords(s.bytes, s.count).map((r) => r.sub_id));
          packets.push({ gen, tick: p.header.tick, ui });
        },
        generation: (g) => generations.push(g),
      },
    });
    const b = await host.newGame({ ...NewWorldCodec.defaults(), seed: 1945 });
    expect(b.gen).toBe(1);
    host.setView({ ...ViewRequestCodec.decode(golden('view.bin')), x0: -20, y0: -20, x1: 20, y1: 20 });
    const sub = host.subscribe({
      kind: ProjectionKind.character,
      flags: 0,
      target: 0,
      p0: 0,
      p1: 0,
      p2: 0,
      p3: 0,
    });
    host.control({ step: 3 });
    for (let i = 0; i < 500 && !packets.some((p) => p.ui.includes(sub)); i++) await settle();
    expect(packets.some((p) => p.gen === 1 && p.ui.includes(sub))).toBe(true);
    const b2 = await host.newGame({ ...NewWorldCodec.defaults(), seed: 7 });
    expect(b2.gen).toBe(2);
    host.control({ step: 1 });
    for (let i = 0; i < 500 && !packets.some((p) => p.gen === 2 && p.ui.includes(sub)); i++) await settle();
    // The subscription was re-sent to the new world: its records arrive in generation 2.
    expect(packets.some((p) => p.gen === 2 && p.ui.includes(sub))).toBe(true);
    expect(generations).toEqual([1, 2]);
    host.close();
    const m: SimToMain['t'] = 'pkt';
    expect(m).toBe('pkt');
  });
});
