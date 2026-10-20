// The reference model against the spec's own numbers (10 §5.1, §5.20, §15.4–§15.5; I §3.7–§3.9): each test
// starts from the golden start save and drives the model through closures, as the sim is driven.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/shared/gen/actions.ts';
import { readSaveContainer } from '../../../src/shared/gen/container.ts';
import { decodePacket, PacketFlags } from '../../../src/shared/gen/packet.ts';
import { decodeAll } from '../../helpers/packets.ts';
import { M0 } from '../build/main.ts';
import { stamp } from '../build/stamp.ts';
import { Extractor } from './extract.ts';
import { mainInv, slots } from './inventory.ts';
import { loadProtos } from './protos.ts';
import { resourceBand, UNIT_DONE } from './rules.ts';
import { Sim } from './sim.ts';
import { allSpan } from './stats.ts';
import { World } from './world.ts';

const bin = new Uint8Array(readFileSync(join(M0, 'protos/prototypes.bin')));
const save = new Uint8Array(readFileSync(join(M0, 'start.save')));
const protos = loadProtos(bin);
const fresh = () => new Sim(World.load(protos, readSaveContainer(save).frames));

/** Runs `ticks` ticks, with `actions[t]` (player 0 unless given) stamped into tick t. */
function drive(
  sim: Sim,
  ticks: number,
  actions: Record<number, (Action | { p: number; a: Action })[]> = {},
): void {
  const steps = Object.entries(actions).flatMap(([t, xs]) =>
    xs.map((x) =>
      'p' in x ? { t: Number(t), who: x.p, a: x.a, why: '' } : { t: Number(t), who: 0, a: x, why: '' },
    ),
  );
  const shifted = steps.map((s) => ({ ...s, t: sim.w.tick + s.t }));
  const st = stamp(sim.w, shifted, () => '');
  const end = sim.w.tick + ticks;
  while (sim.w.tick < end) {
    const r = sim.tick(st.closures.get(sim.w.tick + 1) ?? new Uint8Array());
    if (r.status !== 0) throw new Error(`status ${r.status}`);
  }
}

const p0 = (sim: Sim) => sim.w.player(0) as NonNullable<ReturnType<World['player']>>;
const count = (sim: Sim, key: number) =>
  slots(sim.w, mainInv(sim.w, p0(sim))).reduce((n, s) => (s.key === key ? n + s.count : n), 0);
const CHEST = 0;
const ORE = 8;
const PLATE = 16;

describe('hand crafting (I §3.9)', () => {
  it('takes 0.5 s = 30 ticks per iron chest, ingredients leaving at enqueue', () => {
    const sim = fresh();
    drive(sim, 1, { 1: [{ type: 'craft', recipe: 0, count: 2 }] });
    expect(count(sim, PLATE)).toBe(24 - 16);
    drive(sim, 28);
    expect(count(sim, CHEST)).toBe(2);
    drive(sim, 1);
    expect(sim.w.tick).toBe(30);
    expect(count(sim, CHEST)).toBe(3);
    drive(sim, 29);
    expect(count(sim, CHEST)).toBe(3);
    drive(sim, 1);
    expect(count(sim, CHEST)).toBe(4);
    expect(p0(sim).hand_crafted).toBe(2);
  });

  it('keeps the completion tolerance below one ULP-sized accumulation error and far above it', () => {
    let p = 0;
    for (let i = 0; i < 30; i++) p += 1 / 30;
    expect(p).toBeLessThan(1);
    expect(p).toBeGreaterThanOrEqual(UNIT_DONE);
    expect(29 / 30).toBeLessThan(UNIT_DONE);
  });
});

describe('hand mining (§5.1, I §3.7)', () => {
  it('mines one ore every 120 ticks (mining time 1 at speed 0.5)', () => {
    const sim = fresh();
    drive(sim, 119, {
      1: [
        {
          type: 'begin_mining_terrain',
          input_gen: 0,
          kind: 0,
          pos: { x: 40 * 256 + 128, y: -3 * 256 + 128 },
        },
      ],
    });
    expect(count(sim, ORE)).toBe(10);
    drive(sim, 1);
    expect(count(sim, ORE)).toBe(11);
    drive(sim, 120);
    expect(count(sim, ORE)).toBe(12);
  });

  it('mines a chest in 24 ticks (mining time 0.2), with its contents', () => {
    const sim = fresh();
    drive(sim, 23, { 1: [{ type: 'begin_mining', input_gen: 0, target: { a: 2, b: 0, tag: 1 } }] });
    expect(sim.w.entityBySerial(2)).toBeDefined();
    drive(sim, 1);
    expect(sim.w.entityBySerial(2)).toBeUndefined();
    expect(count(sim, CHEST)).toBe(3);
    expect(count(sim, PLATE)).toBe(24 + 30);
    expect(count(sim, ORE)).toBe(10 + 20);
  });

  it('uses Factorio iron ore stage counts for the richness bands', () => {
    expect([20000, 15000, 14999, 9500, 5500, 2900, 1300, 400, 399, 150, 149, 1].map(resourceBand)).toEqual([
      0, 0, 1, 1, 2, 3, 4, 5, 6, 6, 7, 7,
    ]);
  });
});

describe('walking (§5.1)', () => {
  it('walks 0.15 tiles per tick east, and 0.15 × √½ per axis diagonally', () => {
    const sim = fresh();
    const x0 = p0(sim).x;
    drive(sim, 10, { 1: [{ type: 'start_walking', input_gen: 0, dir: 12 }] });
    expect(p0(sim).x).toBeCloseTo(x0 - 1.5, 12);
    const y0 = p0(sim).y;
    const x1 = p0(sim).x;
    drive(sim, 10, { 1: [{ type: 'start_walking', input_gen: 0, dir: 10 }] });
    expect(p0(sim).x).toBeCloseTo(x1 - 1.5 * Math.SQRT1_2, 12);
    expect(p0(sim).y).toBeCloseTo(y0 + 1.5 * Math.SQRT1_2, 12);
  });

  it('stops at the map edge and slides along it', () => {
    const sim = fresh();
    drive(sim, 80, { 1: [{ type: 'start_walking', input_gen: 0, dir: 4 }] });
    expect(p0(sim).x).toBeLessThanOrEqual(47.8 + 1e-9);
    expect(p0(sim).x).toBeGreaterThan(47.6);
    const y = p0(sim).y;
    drive(sim, 5, { 1: [{ type: 'start_walking', input_gen: 0, dir: 2 }] });
    expect(p0(sim).y).toBeLessThan(y - 0.4);
  });
});

describe('statistics rings (§5.20)', () => {
  it('doubles the span of the `all` ring each time its 300 points fill', () => {
    expect(allSpan(0)).toBe(60);
    expect(allSpan(17999)).toBe(60);
    expect(allSpan(18000)).toBe(120);
    expect(allSpan(35999)).toBe(120);
    expect(allSpan(36000)).toBe(240);
  });
});

describe('extraction (§15.4, §15.5)', () => {
  it('sends FULL first, then held chunks once, and resends only what changed', () => {
    const sim = fresh();
    const x = new Extractor();
    expect(decodePacket(x.extract(sim)).header.flags & PacketFlags.full).toBe(PacketFlags.full);
    x.view = {
      view_seq: 1,
      surface: 0,
      flags: 0,
      x0: 30,
      y0: -10,
      x1: 40,
      y1: 0,
      zoom: 1,
      hovered_serial: 0,
      audio_half_range: 5,
      chart_x0: 0,
      chart_y0: 0,
      chart_x1: 0,
      chart_y1: 0,
    };
    const first = decodeAll(x.extract(sim));
    const tiles = first.sections.find((s) => s.name === 'CHUNK_TILES');
    expect(tiles?.records.length).toBe(9); // chunks −1 … 1 × −2 … 0 (the held set, all generated)
    const again = decodeAll(x.extract(sim));
    expect(again.sections.map((s) => s.name)).toEqual(['MOVERS']);
    // A build bumps its chunk's entity version: only that chunk's entities are resent.
    drive(sim, 2, {
      1: [{ type: 'cursor_transfer', slot: { owner: { a: 0, b: 0, tag: 0 }, inv: 1, slot: 0 } }],
      2: [
        {
          type: 'build',
          item: 0,
          pos: { x2: 75, y2: -3 },
          dir: 0,
          flip: false,
          mode: 0,
          flags: 0,
          drag_id: 0,
        },
      ],
    });
    const after = decodeAll(x.extract(sim));
    expect(after.sections.map((s) => s.name)).toEqual(['CHUNK_ENTITIES', 'MOVERS', 'EVENTS']);
    // Moving the view away evicts chunks; moving it back resends them afresh.
    x.view = { ...x.view, x0: -40, x1: -30 };
    x.extract(sim);
    x.view = { ...x.view, x0: 30, x1: 40 };
    const back = decodeAll(x.extract(sim));
    expect(back.sections.find((s) => s.name === 'CHUNK_TILES')?.records.length).toBe(3);
  });
});
