// The fake sim's protocol duties beyond packets (GATE-r1 findings 8, 13 and 14): saves that complete and load
// back exactly, explicit refusal of other loads, STATS with key tails and the all-time ring past its first
// doubling, and the subscription limits enforced on replacements too.
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import type { ViewRequest } from '../../src/shared/gen/packet.ts';
import {
  StatsCodec,
  type SubRequest,
  UiInvalidReason,
  type UiRecord,
} from '../../src/shared/gen/projections.ts';
import type { SimToMain } from '../../src/shared/protocol.ts';
import {
  ALL_PRECISION,
  RING_POINTS,
  type SeriesState,
  Stats,
  statsRecord,
} from '../../src/simworker/fake/stats.ts';
import { decodeAll } from '../helpers/packets.ts';
import { fakeProtos, Harness } from './harness.ts';

const VIEW: ViewRequest = {
  view_seq: 1,
  surface: 0,
  flags: 1 << 3,
  x0: -24,
  y0: -18,
  x1: 40,
  y1: 18,
  zoom: 1,
  hovered_serial: 0,
  audio_half_range: 32,
  chart_x0: 0,
  chart_y0: 0,
  chart_x1: 0,
  chart_y1: 0,
};
const sub = (sub_id: number, kind: number, p0 = 0, p1 = 0, p2 = 0, tail?: number[]): SubRequest => {
  const r: SubRequest = { sub_id, kind, flags: tail ? 1 : 0, target: 0, p0, p1, p2, p3: 0 };
  if (tail) {
    const b = new Uint8Array(4 * tail.length);
    tail.forEach((k, i) => {
      new DataView(b.buffer).setUint32(4 * i, k, true);
    });
    r.tail = b;
  }
  return r;
};
const BUILD = { build: 'm1', buildHash: '0'.repeat(64), dev: true };

beforeAll(() => {
  fakeProtos();
}, 60_000);

/** Every UI record of a harness's packets, in order. */
function uiRecords(h: Harness): UiRecord[] {
  return h.packets.flatMap((b) =>
    decodeAll(b).sections.flatMap((s) => (s.name === 'UI' ? (s.records as UiRecord[]) : [])),
  );
}

describe('the fake sim’s saves', () => {
  it('complete with `saved`, and load back into exactly the world an uninterrupted run reaches', async () => {
    const h = new Harness();
    await h.start();
    await h.act(1, { type: 'start_walking', input_gen: 0, dir: 6 });
    await h.step(200);
    await h.send({ t: 'save', id: 7, reason: 'manual' });
    const saved = h.out.find((m) => m.t === 'saved') as Extract<SimToMain, { t: 'saved' }>;
    const bytes = h.sim.lastSave as Uint8Array;
    expect(saved).toMatchObject({ t: 'saved', id: 7, bytes: bytes.length });
    expect(saved.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    await h.step(300);
    const uninterrupted = JSON.stringify(h.sim.snapshot());

    const g = new Harness();
    await g.send({ t: 'boot', build: BUILD, module: null, ioPort: null, genPorts: [] });
    await g.send({ t: 'seq', op: 'pause' });
    await g.send({
      t: 'world',
      gen: 2,
      op: 'load',
      sections: bytes.slice().buffer,
      meta: { lineage: '0'.repeat(16), prototypesHash: fakeProtos().prototypesHash, tick: 200 },
    });
    expect(g.out.find((m) => m.t === 'bound')).toMatchObject({ gen: 2, tick: 200 });
    await g.step(300);
    expect(JSON.stringify(g.sim.snapshot())).toBe(uninterrupted);
  });

  it('refuses a load it cannot do with a trap that says why, and binds nothing', async () => {
    const g = new Harness();
    await g.send({ t: 'boot', build: BUILD, module: null, ioPort: null, genPorts: [] });
    await g.send({
      t: 'world',
      gen: 1,
      op: 'load',
      sections: new TextEncoder().encode('SITESAV\0 a real save container').buffer,
      meta: { lineage: '0'.repeat(16), prototypesHash: '', tick: 0 },
    });
    expect(g.out.find((m) => m.t === 'trap')).toMatchObject({ t: 'trap', gen: 1 });
    expect((g.out.find((m) => m.t === 'trap') as { message: string }).message).toMatch(/fake save/);
    expect(g.out.some((m) => m.t === 'bound')).toBe(false);
  });
});

describe('the fake sim’s STATS (§15.5, README rule 26)', () => {
  it('report exactly a tail’s keys, else every key of the tab', async () => {
    const h = new Harness();
    await h.start();
    await h.send({ t: 'view', gen: 1, v: VIEW });
    await h.step(600);
    const p = fakeProtos();
    const ore = (1 << 24) + p.item.findIndex((x) => x.name === 'iron-ore') * 8;
    const other = (1 << 24) + p.item.findIndex((x) => x.name === 'iron-plate') * 8;
    await h.send({
      t: 'sub',
      gen: 1,
      subs: [sub(1, 7, 1, 0, 1, [ore]), sub(2, 7, 1, 0, 0), sub(3, 7, 1, 0, 0, [other, ore])],
    });
    const recs = uiRecords(h).filter((r) => r.status === 0);
    const keys = (id: number) =>
      StatsCodec.decode((recs.find((r) => r.sub_id === id) as UiRecord).body).entries.map((e) => e.key);
    expect(keys(1)).toEqual([ore]);
    expect(keys(3)).toEqual([ore, other].sort((a, b) => a - b));
    expect(keys(2).length).toBeGreaterThan(1);
    expect(keys(2)).toContain(ore);
  });

  it('keep exact totals and a 300-point window, and resend the whole `all` series after it doubles', () => {
    const s = new Stats();
    const K = 1 << 24;
    const one = new Map([[K, 1]]);
    const none = new Map<number, number>();
    let series: SeriesState | null = null;
    const req = (p0: number): SubRequest => ({
      sub_id: 1,
      kind: 7,
      flags: 0,
      target: 0,
      p0,
      p1: 0,
      p2: 1,
      p3: 0,
    });
    const read = (p0: number) => {
      const r = statsRecord(s, req(p0), series);
      if ('reason' in r) throw new Error(`refused ${r.reason}`);
      series = r.next;
      return StatsCodec.decode(r.body);
    };
    for (let t = 1; t <= 400; t++) s.flush(t, one, none);
    // Precision 0 is 5 s: 300 points of one tick; `all` is the exact total.
    expect(read(0).entries[0]).toMatchObject({ key: K, produced: 300 });
    series = null;
    const first = read(ALL_PRECISION);
    expect(first.entries[0]).toMatchObject({ produced: 400 });
    expect(first.series[0]?.produced.length).toBe(6); // 400 ticks: six 60-tick points (the seventh is open)
    for (let t = 401; t <= 460; t++) s.flush(t, one, none);
    const next = read(ALL_PRECISION);
    expect(next.series[0]).toMatchObject({ from: 6 });
    expect(next.series[0]?.produced).toEqual([60]); // only the appended point
    for (let t = 461; t <= 18_120; t++) s.flush(t, one, none);
    const rec = s.records.get(K);
    expect(rec?.rings[ALL_PRECISION]?.doublings).toBe(1);
    const after = read(ALL_PRECISION);
    expect(after.entries[0]).toMatchObject({ produced: 18_120 });
    // After the doubling the series is whole again: 150 merged points of 120 ticks, then one more.
    expect(after.series[0]?.from).toBe(0);
    expect(after.series[0]?.produced.length).toBe(RING_POINTS / 2 + 1);
    expect(after.series[0]?.produced[0]).toBe(120);
  });
});

describe('the fake sim’s subscription limits (§15.5)', () => {
  it('hold for the set a replacement leaves: four STATS, 32 in all', async () => {
    const h = new Harness();
    await h.start();
    await h.send({ t: 'view', gen: 1, v: VIEW });
    await h.send({
      t: 'sub',
      gen: 1,
      subs: [sub(1, 7), sub(2, 7), sub(3, 7), sub(4, 7), sub(5, 1)],
    });
    // Replacing the HUD (5) by a fifth STATS is over the limit; replacing a STATS by a STATS is not.
    await h.send({ t: 'sub', gen: 1, subs: [sub(5, 7), sub(4, 7, 2)] });
    const last = (id: number) =>
      uiRecords(h)
        .filter((r) => r.sub_id === id)
        .pop() as UiRecord;
    expect(last(5)).toMatchObject({ status: 2 });
    expect([...last(5).body]).toEqual([UiInvalidReason.over_limit, 0]);
    expect(last(4)).toMatchObject({ status: 0 });
    // 32 subscriptions besides the hover: the 33rd is refused, a replacement within them is not.
    const many = Array.from({ length: 28 }, (_, i) => sub(10 + i, 1));
    await h.send({ t: 'sub', gen: 1, subs: many });
    await h.send({ t: 'sub', gen: 1, subs: [sub(99, 1), sub(37, 10)] });
    await h.step(1);
    expect(last(99)).toMatchObject({ status: 2 });
    expect([...last(99).body]).toEqual([UiInvalidReason.over_limit, 0]);
    expect(last(37)).toMatchObject({ status: 0 });
  });
});

// Keep the harness's protocol helpers honest: a fresh world through `new` also works after a load attempt.
describe('the fake sim after a refused load', () => {
  it('still binds a new world', async () => {
    const g = new Harness();
    await g.send({ t: 'boot', build: BUILD, module: null, ioPort: null, genPorts: [] });
    await g.send({
      t: 'world',
      gen: 1,
      op: 'load',
      sections: new ArrayBuffer(8),
      meta: { lineage: '0'.repeat(16), prototypesHash: '', tick: 0 },
    });
    await g.send({ t: 'world', gen: 2, op: 'new', settings: { ...NewWorldCodec.defaults(), seed: 1 } });
    expect(g.out.find((m) => m.t === 'bound')).toMatchObject({ gen: 2, tick: 0 });
  });
});
