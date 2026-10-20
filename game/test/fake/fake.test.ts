// The fake sim (10 §15.10): it speaks §3.2's protocol, follows the replacement protocol, and every packet it
// writes decodes with the generated decoders, section by section, and survives the round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import { readEvents } from '../../src/shared/gen/events.ts';
import { decodePacket, PacketFlags, type ViewRequest } from '../../src/shared/gen/packet.ts';
import {
  DigestResultCodec,
  HudCodec,
  InspectResultCodec,
  ProjectionKind,
  QueryKind,
  type UiRecord,
} from '../../src/shared/gen/projections.ts';
import { SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import { decodeAll, encodeAll, UI_CODECS } from '../helpers/packets.ts';
import { fakeProtos, Harness } from './harness.ts';

const VIEW: ViewRequest = {
  view_seq: 7,
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
const sub = (sub_id: number, kind: number, target: number, p0 = 0, p1 = 0, p2 = 0) => ({
  sub_id,
  kind,
  flags: 0,
  target,
  p0,
  p1,
  p2,
  p3: 0,
});
const SUBS = [sub(1, 2, 0), sub(2, 1, 0), sub(3, 7, 0, 1, 0, 1), sub(4, 10, 0), sub(5, 6, 0), sub(6, 2, 9)];

beforeAll(() => {
  fakeProtos();
}, 60_000);

async function run(script: (h: Harness) => Promise<void>): Promise<Harness> {
  const h = new Harness();
  await h.start();
  await h.send({ t: 'view', gen: 1, v: VIEW });
  await h.send({ t: 'sub', gen: 1, subs: SUBS });
  await script(h);
  return h;
}

describe('the fake sim', () => {
  it('boots, binds a world and sends an unsolicited FULL packet first (§3.4)', async () => {
    const h = new Harness();
    await h.start(3);
    const ready = h.out.find((m) => m.t === 'ready');
    expect(ready).toEqual({ t: 'ready', abi: 1, schemaHash: SCHEMA_HASH, buildHash: '0'.repeat(64) });
    const bound = h.out.find((m) => m.t === 'bound');
    expect(bound).toMatchObject({ t: 'bound', gen: 3, tick: 0 });
    const full = decodePacket(h.packets[0] as Uint8Array);
    expect(full.header.flags & PacketFlags.full).toBe(PacketFlags.full);
    expect(full.header.state_gen).toBe(3);
    expect(full.sections.length).toBe(0);
  });

  it("answers a view and subscriptions while paused, and drops another generation's messages", async () => {
    const h = new Harness();
    await h.start();
    const before = h.packets.length;
    await h.send({ t: 'view', gen: 2, v: VIEW });
    expect(h.packets.length).toBe(before);
    await h.send({ t: 'view', gen: 1, v: VIEW });
    const p = decodeAll(h.packets[h.packets.length - 1] as Uint8Array);
    expect(p.header.view_seq).toBe(7);
    expect(p.sections.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        'CHUNK_TILES',
        'CHUNK_ENTITIES',
        'DYN',
        'HANDS',
        'BELT_GEOM',
        'BELT_ITEMS',
        'MOVERS',
        'AUDIO_WORKING',
        'CHUNK_OBJECTS',
        'CHUNK_RESOURCES',
      ]),
    );
    await h.send({ t: 'sub', gen: 1, subs: SUBS });
    const ui = decodeAll(h.packets[h.packets.length - 1] as Uint8Array).sections.find((s) => s.name === 'UI');
    const recs = (ui?.records ?? []) as UiRecord[];
    expect(recs.map((r) => [r.sub_id, r.status])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 2], // RESEARCH: outside M0's capability manifest
      [6, 1], // CHARACTER of player 9: gone
    ]);
    expect([...(recs[4] as UiRecord).body]).toEqual([1, 0]); // reason 1, unsupported
  });

  it('writes packets that decode and round-trip, with every section M0 consumers read', async () => {
    const seen = new Set<string>();
    const h = await run(async (h) => {
      for (let i = 0; i < 40; i++) await h.step(50); // 2,000 ticks: past the belt rebuild at 1,800
    });
    for (const bytes of h.packets) {
      const p = decodeAll(bytes);
      for (const s of p.sections) seen.add(s.name);
      expect(encodeAll(p)).toEqual(bytes);
    }
    for (const name of [
      'CHUNK_TILES',
      'CHUNK_ENTITIES',
      'DYN',
      'HANDS',
      'BELT_GEOM',
      'BELT_ITEMS',
      'MOVERS',
      'EVENTS',
      'UI',
      'AUDIO_WORKING',
      'CHUNK_OBJECTS',
      'CHUNK_RESOURCES',
      'BELT_RETIRE',
    ])
      expect(seen, name).toContain(name);
  });

  it('walks the character on act messages and refuses actions outside the manifest', async () => {
    const h = await run(async (h) => {
      await h.step(1);
      await h.act(
        1,
        { type: 'start_walking', input_gen: 0, dir: 4 },
        { type: 'rotate_entity', target: { a: 2, b: 0, tag: 1 }, reverse: false },
      );
      await h.step(20);
    });
    const p = decodePacket(h.packets[h.packets.length - 1] as Uint8Array);
    const movers = p.sections.find((s) => s.name === 'MOVERS') as { bytes: Uint8Array };
    const x = new DataView(movers.bytes.buffer, movers.bytes.byteOffset).getInt32(8, true);
    expect(x).toBe(Math.floor((0.5 + 20 * 0.15) * 256 + 0.5));
    const events = h.packets.flatMap((b) => {
      const s = decodePacket(b).sections.find((x) => x.name === 'EVENTS');
      return s ? readEvents(s.bytes, s.count) : [];
    });
    expect(
      events.some((e) => e.payload.type === 'action_failed' && e.payload.reason === 2 && e.header.seq === 2),
    ).toBe(true);
  });

  it('serves every M0 projection with records that decode and round-trip, and answers queries', async () => {
    const h = new Harness();
    await h.start();
    await h.send({ t: 'view', gen: 1, v: { ...VIEW, hovered_serial: 92 } }); // the wooden chest by the spawn
    await h.send({
      t: 'sub',
      gen: 1,
      subs: [
        sub(1, 2, 0),
        sub(2, 1, 0),
        sub(3, 7, 0, 1, 0, 1),
        sub(4, 10, 0),
        sub(7, 3, 73, 2),
        sub(8, 4, 71),
      ],
    });
    await h.step(120);
    const latest = new Map<number, UiRecord>();
    for (const b of h.packets)
      for (const s of decodeAll(b).sections)
        if (s.name === 'UI') for (const r of s.records as UiRecord[]) latest.set(r.sub_id, r);
    expect([...latest.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 7, 8]);
    const body = new Map<number, Record<string, unknown>>();
    for (const r of latest.values()) {
      expect(r.status, `sub ${r.sub_id}`).toBe(0);
      const codec = UI_CODECS.get(r.kind);
      expect(codec, `kind ${r.kind}`).toBeDefined();
      const v = codec?.decode(r.body) as Record<string, unknown>;
      expect(codec?.encode(v)).toEqual(r.body);
      body.set(r.kind, v);
    }
    expect(body.get(ProjectionKind.inventory)).toMatchObject({ serial: 73 });
    // Iron gear wheels: 0.5 s at assembling machine 1's crafting speed 0.5, so one a second (§5.3).
    expect(body.get(ProjectionKind.entity_panel)).toMatchObject({ serial: 71, crafts_per_s: 1 });
    expect(body.get(ProjectionKind.hover)).toMatchObject({ serial: 92 });
    expect(body.get(ProjectionKind.stats)?.entries).not.toEqual([]);
    expect(body.get(ProjectionKind.debug)).toMatchObject({ tick: 120 });

    const ask = async (q: Uint8Array) => {
      await h.send({ t: 'query', gen: 1, id: h.out.length, q: q.slice().buffer });
      return h.out[h.out.length - 1] as { t: 'res'; ok: boolean; value: ArrayBuffer };
    };
    const q = (kind: number, ...u32: number[]) => {
      const b = new DataView(new ArrayBuffer(4 + 4 * u32.length));
      b.setUint16(0, kind, true);
      u32.forEach((x, i) => {
        b.setUint32(4 + 4 * i, x, true);
      });
      return new Uint8Array(b.buffer);
    };
    const inspect = await ask(q(QueryKind.inspect, 73));
    expect(inspect.ok).toBe(true);
    expect(InspectResultCodec.decode(new Uint8Array(inspect.value))).toMatchObject({
      serial: 73,
      found: true,
    });
    const rates = await ask(q(QueryKind.rates, 0));
    expect(rates.ok).toBe(false);
    expect([...new Uint8Array(rates.value)]).toEqual([1, 0]); // unsupported: outside M0's capability manifest
    // The dev hooks (§3.5) answer with a `res` of the same id.
    await h.send({ t: 'dev', id: 99, op: { op: 'digest' } });
    const dev = h.out[h.out.length - 1] as { t: 'res'; id: number; ok: boolean; value: ArrayBuffer };
    expect(dev).toMatchObject({ t: 'res', id: 99, ok: true });
    expect(DigestResultCodec.decode(new Uint8Array(dev.value)).tick).toBe(120);
  });

  it('feeds the music: Literature rises and the factory draws power (HUD, §15.6)', async () => {
    const h = await run(async (h) => {
      await h.step(3600);
    });
    const ui = decodeAll(h.packets[h.packets.length - 1] as Uint8Array).sections.find((s) => s.name === 'UI');
    const hud = ((ui?.records ?? []) as UiRecord[]).find((r) => r.kind === 1) as UiRecord;
    const v = HudCodec.decode(hud.body);
    expect(v.literature).toBeCloseTo(1946, 6);
    expect(v.activity_w).toBeGreaterThan(100_000);
  });

  it('paces at 60 UPS on its clock, at most 3 ticks a wake, and rebases a stalled clock (§3.3)', async () => {
    const h = new Harness();
    const build = { build: 'm1', buildHash: '0'.repeat(64), dev: true };
    await h.send({ t: 'boot', build, module: null, ioPort: null, genPorts: [] });
    await h.send({ t: 'world', gen: 1, op: 'new', settings: { ...NewWorldCodec.defaults(), seed: 1945 } });
    const tick = () => decodePacket(h.packets[h.packets.length - 1] as Uint8Array).header.tick;
    const clocks = () => h.out.filter((m) => m.t === 'clock').length;
    // Tick k is due at k × 16.667 ms: one wake and one packet per tick.
    h.advance(1001);
    expect(tick()).toBe(60);
    expect(h.packets.length).toBe(61); // the FULL packet first
    // A wake 70 ms late finds 4 ticks due: it runs 3 and extracts once.
    let n = h.packets.length;
    h.clock += 70;
    h.advance(1);
    expect(tick()).toBe(63);
    expect(h.packets.length).toBe(n + 1);
    // A stall of 500 ms (31 ticks due) rebases the clock in a new clock generation and drops the backlog.
    const c = clocks();
    h.clock += 500;
    h.advance(1);
    expect(clocks()).toBe(c + 1);
    expect(tick()).toBe(63);
    h.advance(1001);
    expect(tick()).toBe(123);
    // Speed 2 (a new clock generation): 120 ticks a second.
    await h.send({ t: 'seq', op: { speed: 2 } });
    n = h.packets.length;
    h.advance(1001);
    expect(tick()).toBe(243);
    expect(h.packets.length).toBe(n + 120);
    // Paused: no ticks, but a view change is still answered (extraction without ticks, B1-r1 12).
    await h.send({ t: 'seq', op: 'pause' });
    h.advance(500);
    expect(tick()).toBe(243);
    n = h.packets.length;
    await h.send({ t: 'view', gen: 1, v: VIEW });
    expect(h.packets.length).toBe(n + 1);
  });

  it('is deterministic: the same inputs give the same packets', async () => {
    const script = async (h: Harness) => {
      await h.step(30);
      await h.act(1, { type: 'start_walking', input_gen: 0, dir: 6 });
      await h.step(90);
    };
    const a = await run(script);
    const b = await run(script);
    expect(a.packets.length).toBe(b.packets.length);
    a.packets.forEach((p, i) => {
      expect(p).toEqual(b.packets[i]);
    });
  });
});
