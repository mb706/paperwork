// The reference model against the spec's own numbers (10 §5.1, §5.20, §15.4–§15.5; I §3.7–§3.9): each test
// starts from the golden start save and drives the model through closures, as the sim is driven.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/shared/gen/actions.ts';
import { readSaveContainer } from '../../../src/shared/gen/container.ts';
import { decodePacket, PacketFlags } from '../../../src/shared/gen/packet.ts';
import {
  CONTAINERPOOL_COLUMNS,
  ENTITYTABLE_COLUMNS,
  encodeContainerPool,
  encodeEntityTable,
} from '../../../src/shared/gen/pools.ts';
import { StatsCodec } from '../../../src/shared/gen/projections.ts';
import { encodeSlotHeap } from '../../../src/shared/gen/sections.ts';
import { decodeAll } from '../../helpers/packets.ts';
import { M0 } from '../build/main.ts';
import { stamp } from '../build/stamp.ts';
import { Extractor } from './extract.ts';
import { mainInv, slots } from './inventory.ts';
import { loadProtos } from './protos.ts';
import { resourceBand, UNIT_DONE } from './rules.ts';
import { Sim } from './sim.ts';
import { type Member, members, sliceHash } from './slices.ts';
import { allSpan } from './stats.ts';
import { SECTION_ID, World } from './world.ts';

const bin = new Uint8Array(readFileSync(join(M0, 'protos/prototypes.bin')));
const save = new Uint8Array(readFileSync(join(M0, 'start.save')));
const protos = loadProtos(bin);
const fresh = () => {
  const c = readSaveContainer(save);
  return new Sim(World.load(protos, c.frames), BigInt(`0x${c.header.lineage}`));
};

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

  it('sends the `all` series whole again after a doubling, then only appended points (rule 26)', () => {
    const sim = fresh();
    const x = new Extractor();
    x.view = null;
    x.extract(sim); // the FULL packet
    const ore = {
      type: 'begin_mining_terrain' as const,
      input_gen: 0,
      kind: 0,
      pos: { x: 40 * 256 + 128, y: -3 * 256 + 128 },
    };
    // Precision `all` (8), items, with series; only iron ore's key in the tail (§15.5).
    const tail = new Uint8Array(4);
    new DataView(tail.buffer).setUint32(0, 2 ** 24 + ORE, true);
    expect(x.subscribe([{ sub_id: 1, kind: 7, flags: 1, target: 0, p0: 8, p1: 0, p2: 1, p3: 0, tail }])).toBe(
      true,
    );
    const series = () => {
      const p = decodeAll(x.extract(sim));
      const ui = p.sections.find((s) => s.name === 'UI');
      const rec = (ui?.records ?? []) as { sub_id: number; body: Uint8Array }[];
      const body = rec.find((r) => r.sub_id === 1)?.body;
      return body ? StatsCodec.decode(body) : null;
    };
    drive(sim, 1, { 1: [ore] });
    // A tail key is reported even before it exists, at zero (§15.5: the tail names the keys).
    expect(series()?.entries).toEqual([{ key: 2 ** 24 + ORE, produced: 0, consumed: 0 }]);
    drive(sim, 17_000); // past 140 ore: points every 60 ticks
    const before = series();
    expect(before?.series[0]?.from).toBe(0);
    expect(before?.series[0]?.produced.length).toBe(Math.floor(17_001 / 60));
    drive(sim, 1_100); // past tick 18,000: 300 points of 60 ticks merge into 150 of 120
    const after = series();
    expect(after?.series[0]?.from).toBe(0); // whole again
    expect(after?.series[0]?.produced.length).toBe(150 + Math.floor((18_101 - 18_000) / 120));
    drive(sim, 240);
    const appended = series();
    expect(appended?.series[0]?.from).toBe(150 + Math.floor((18_101 - 18_000) / 120));
    expect(appended?.series[0]?.produced.length).toBe(2);
    expect(appended?.entries[0]?.produced).toBe(p0(sim).hand_crafted + count(sim, ORE) - 10); // exact totals
  }, 120_000);
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

describe('the slice serialization (§4.8 item 2; README rules 37–41)', () => {
  /** Rebuilds a section's bytes from its members alone. */
  function rebuild(id: number, ms: Member[]): Uint8Array {
    const cat = (bs: Uint8Array[]) => Buffer.concat(bs.map((b) => Buffer.from(b)));
    const bytes = ms.map((m) => m.bytes());
    if (id === SECTION_ID.GLOBALS || id === SECTION_ID.RNG) return new Uint8Array(cat(bytes));
    if (id === SECTION_ID.ENTITY_TABLE || id === SECTION_ID.POOL_CONTAINER) {
      const cols = id === SECTION_ID.ENTITY_TABLE ? ENTITYTABLE_COLUMNS : CONTAINERPOOL_COLUMNS;
      const rows = bytes.slice(1).map((b) => {
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const row: Record<string, number> = {};
        let at = 4;
        for (const c of cols) {
          const read = {
            1: () => v.getUint8(at),
            2: () => v.getUint16(at, true),
            3: () => v.getUint32(at, true),
            7: () => v.getInt32(at, true),
          }[c.code as 1 | 2 | 3 | 7];
          row[c.name] = read();
          at += c.width;
        }
        return { index: v.getUint32(0, true), row };
      });
      rows.sort((a, b) => a.index - b.index);
      expect(new DataView((bytes[0] as Uint8Array).buffer).getUint32(0, true)).toBe(rows.length);
      return id === SECTION_ID.ENTITY_TABLE
        ? encodeEntityTable(rows.map((r) => r.row) as never)
        : encodeContainerPool(rows.map((r) => r.row) as never);
    }
    if (id === SECTION_ID.SLOT_HEAP) {
      const arenas: {
        class: number;
        block_slots: number;
        blocks: number;
        slots: { key: number; count: number }[];
      }[] = [];
      const bars: { inv: number; bar: number }[] = [];
      const filters: { inv: number; slot: number; key: number }[] = [];
      ms.forEach((m, i) => {
        const b = bytes[i] as Uint8Array;
        const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const cls = Number(m.key / 2n ** 32n);
        const block = Number(m.key % 2n ** 32n) - 1;
        if (block < 0) {
          arenas.push({
            class: v.getUint8(0),
            block_slots: v.getUint16(1, true),
            blocks: v.getUint32(3, true),
            slots: [],
          });
          return;
        }
        const a = arenas[arenas.length - 1] as (typeof arenas)[number];
        let at = 0;
        for (let k = 0; k < a.block_slots; k++, at += 6)
          a.slots.push({ key: v.getUint16(at, true), count: v.getUint32(at + 2, true) });
        const nb = v.getUint32(at, true);
        at += 4;
        for (let k = 0; k < nb; k++, at += 8)
          bars.push({ inv: v.getUint32(at, true), bar: v.getUint16(at + 4, true) });
        const nf = v.getUint32(at, true);
        at += 4;
        for (let k = 0; k < nf; k++, at += 8)
          filters.push({
            inv: v.getUint32(at, true),
            slot: v.getUint16(at + 4, true),
            key: v.getUint16(at + 6, true),
          });
        expect(cls).toBe(a.class);
      });
      return encodeSlotHeap({ arenas, filters, bars } as never);
    }
    return new Uint8Array(cat(bytes)); // `records` sections: the count, then every record in order
  }

  it('every section is exactly its members, and every member has one shard', () => {
    const sim = fresh();
    drive(sim, 60, {
      1: [{ type: 'craft', recipe: 0, count: 1 }],
      2: [{ type: 'set_inventory_bar', target: { a: 2, b: 0, tag: 1 }, inv: 2, bar: 3 }],
    });
    const ms = members(sim.w);
    for (const m of ms) expect(m.shard >= 0 && m.shard < 3600 && Number.isInteger(m.shard)).toBe(true);
    const keys = ms.map((m) => `${m.section}:${m.key}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const { id, bytes } of sim.w.sections()) {
      const mine = ms
        .filter((m) => m.section === id)
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      expect(Buffer.from(rebuild(id, mine)).equals(Buffer.from(bytes)), `section ${id}`).toBe(true);
    }
  });

  it('the 3,600 slices of a state hash every member once: a changed member changes exactly its shard', () => {
    const sim = fresh();
    const before = Array.from({ length: 3600 }, (_, s) => sliceHash(sim.w, s));
    const chest = sim.w.entityBySerial(2) as NonNullable<ReturnType<World['entityBySerial']>>;
    chest.built_tick = 7; // one byte of chest A's entity-table row
    const after = Array.from({ length: 3600 }, (_, s) => sliceHash(sim.w, s));
    const changed = after.flatMap((h, s) => (h !== before[s] ? [s] : []));
    expect(changed).toEqual([2]); // serial 2 mod 3,600
  });
});
