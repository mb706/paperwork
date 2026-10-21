// M0's exit, "chests placed, filled and mined through actions ... in Node through the shell" (10 §12; C8): SimHost
// with the sim worker's shell in-process (`inlineSim`, the code the page runs in its worker) on the real sim.wasm
// and gen.wasm, in test mode. Actions go through `host.act` (the UI's encoder's path) into the shell's
// LocalSequencer; the player mines ore by hand, crafts the chest from the start's plates, builds it, fills it
// (Shift+LMB's `stack_transfer`, then a fast transfer from the hand), and mines it back. The chest's INVENTORY,
// the player's CHARACTER and STATS are read from the packets' UI records, as the UI reads them.
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inlineGen, inlineSim } from '../../src/app/inline.ts';
import { SimHost } from '../../src/app/sim-host.ts';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import { type Action, actionBytes } from '../../src/shared/gen/actions.ts';
import { Reader } from '../../src/shared/gen/codec.ts';
import { decodePacket } from '../../src/shared/gen/packet.ts';
import {
  type Character,
  CharacterCodec,
  type Inventory,
  InventoryCodec,
  ProjectionKind,
  type Stats,
  StatsCodec,
  UiRecordCodec,
} from '../../src/shared/gen/projections.ts';
import { Direction, InventoryType, StatPrecision } from '../../src/shared/gen/types.ts';
import { testIo } from '../helpers/io.ts';
import { goldenProtos, manifest } from '../helpers/shell-harness.ts';
import { realGen, realSim } from '../helpers/stubs.ts';

const real = await realSim();
const skip = 'skip' in real ? real.skip : null;
const module = 'module' in real ? real.module : null;
const sha256 = async (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());

const CHEST = 0; // item keys of the golden prototypes, quality 0
const ORE = 8;
const PLATE = 16;
const NONE = { tag: 0, a: 0, b: 0 };
const serialRef = (s: number) => ({ tag: 1, a: s, b: 0 });

describe.skipIf(skip !== null)('a chest through the shell in Node (SimHost, the real modules)', () => {
  it('is crafted, built, filled and mined back through actions; INVENTORY, CHARACTER and STATS agree', async () => {
    const protos = goldenProtos();
    const { io } = await testIo();
    // The latest UI record of each subscription.
    const records = new Map<number, { kind: number; status: number; body: Uint8Array }>();
    const built: number[] = [];
    const h = new SimHost({
      build: manifest(protos),
      sim: module as WebAssembly.Module,
      gen: await realGen(),
      createSim: () => inlineSim({ protos: async () => protos, sha256 }),
      createGen: () => inlineGen(),
      genWorkers: 1,
      io,
      test: true,
      events: {
        packet: (bytes) => {
          const p = decodePacket(bytes);
          for (const s of p.sections) {
            if (s.name !== 'UI') continue;
            const r = new Reader(s.bytes);
            for (let i = 0; i < s.count; i++) {
              const u = UiRecordCodec.read(r);
              records.set(u.sub_id, { kind: u.kind, status: u.status, body: u.body.slice() });
            }
          }
        },
      },
    });
    const act = (a: Action) => h.act(actionBytes(a));
    const character = (): Character => {
      const r = records.get(charSub);
      if (!r) throw new Error('no CHARACTER record');
      return CharacterCodec.decode(r.body);
    };
    const count = (key: number) =>
      character()
        .main.filter((s) => s.key === key)
        .reduce((n, s) => n + s.count, 0);
    const slotOf = (key: number) => character().main.findIndex((s) => s.key === key && s.count > 0);

    await h.newGame({ ...NewWorldCodec.defaults(), seed: 1945 });
    await h.step(1); // player 0 joins in the world's first tick
    const charSub = h.subscribe({
      kind: ProjectionKind.character,
      flags: 0,
      target: 0,
      p0: 0,
      p1: 0,
      p2: 0,
      p3: 0,
    });
    // STATS over all time (precision `all`), the item tab
    const statsSub = h.subscribe({
      kind: ProjectionKind.stats,
      flags: 0,
      target: 0,
      p0: StatPrecision.all,
      p1: 0,
      p2: 0,
      p3: 0,
    });
    await h.step(1);
    expect(count(PLATE)).toBe(8);

    // Walk north-east next to the starting patch's nearest ore tile (4, -7) for seed 1945, then mine three ore.
    act({ type: 'start_walking', input_gen: 0, dir: Direction.north_east });
    await h.step(40);
    act({ type: 'stop_walking', input_gen: 0 });
    act({
      type: 'begin_mining_terrain',
      input_gen: 0,
      kind: 0,
      pos: { x: 4 * 256 + 128, y: -7 * 256 + 128 },
    });
    await h.step(3 * 120 + 1);
    act({ type: 'stop_mining', input_gen: 0 });
    await h.step(1);
    expect(count(ORE)).toBe(3);

    // Craft the chest from the start's eight plates; LMB on it (the hand); build it two tiles east.
    act({ type: 'craft', recipe: 0, count: 1 });
    await h.step(31);
    expect([count(CHEST), count(PLATE)]).toEqual([1, 0]);
    act({ type: 'cursor_transfer', slot: { owner: NONE, inv: InventoryType.main, slot: slotOf(CHEST) } });
    await h.step(1);
    const c = character();
    expect(c.hand_count).toBe(1);
    // Build on tile (6, -5), within reach of where the walk ended (40 ticks north-east of the spawn point: about
    // (4.2, -4.2)).
    const seq = act({
      type: 'build',
      item: CHEST,
      pos: { x2: 2 * 6 + 1, y2: 2 * -5 + 1 },
      dir: 0,
      flip: false,
      mode: 0,
      flags: 0,
      drag_id: 0,
    });
    await h.step(1);
    const chest = { tag: 2, a: seq, b: 0 }; // its creation id (S5)
    // INVENTORY takes a serial: the chest's is the next after the character's (the world's serials so far: the
    // character's, then this build's).
    const serial = c.serial + 1;
    built.push(serial);
    const invSub = h.subscribe({
      kind: ProjectionKind.inventory,
      flags: 0,
      target: serial,
      p0: InventoryType.chest,
      p1: 0,
      p2: 0,
      p3: 0,
    });
    await h.step(1);
    const inventory = (): Inventory => {
      const r = records.get(invSub);
      if (r?.status !== 0) throw new Error(`INVENTORY: status ${r?.status}`);
      return InventoryCodec.decode(r.body);
    };
    expect(inventory().view.slots.every((s) => s.count === 0)).toBe(true);

    // Shift+LMB on the ore: the stack goes into the chest (by its creation id: S5's reference by identity).
    act({
      type: 'stack_transfer',
      from: { owner: NONE, inv: InventoryType.main, slot: slotOf(ORE) },
      to: chest,
    });
    await h.step(2);
    expect(inventory().view.slots[0]).toMatchObject({ key: ORE, count: 3 });
    expect(count(ORE)).toBe(0);
    // Ctrl+LMB on the chest's stack takes it back; then the stack into the hand and a fast transfer puts it in.
    act({
      type: 'inventory_transfer',
      from: { owner: serialRef(serial), inv: InventoryType.chest, slot: 0 },
      to: NONE,
    });
    await h.step(1);
    expect(count(ORE)).toBe(3);
    act({ type: 'cursor_transfer', slot: { owner: NONE, inv: InventoryType.main, slot: slotOf(ORE) } });
    act({ type: 'fast_entity_transfer', target: serialRef(serial) });
    await h.step(2);
    expect(inventory().view.slots[0]).toMatchObject({ key: ORE, count: 3 });
    expect(character().hand_count).toBe(0);

    // Mine it back (24 ticks): it goes, with its contents, into the inventory; INVENTORY says it is gone.
    act({ type: 'begin_mining', input_gen: 0, target: serialRef(serial) });
    await h.step(30);
    act({ type: 'stop_mining', input_gen: 0 });
    await h.step(2);
    expect([count(CHEST), count(ORE)]).toEqual([1, 3]);
    expect(records.get(invSub)?.status).toBe(1); // gone
    // STATS (all time): three ore mined, one chest crafted, eight plates consumed.
    await h.step(60);
    const st = records.get(statsSub);
    expect(st?.status).toBe(0);
    const stats = StatsCodec.decode((st as { body: Uint8Array }).body) as Stats;
    const entry = (key: number) =>
      stats.entries.find((e) => (e.key & 0xffffff) === key && e.key >>> 24 === 1);
    expect(entry(ORE)?.produced).toBe(3);
    expect(entry(CHEST)?.produced).toBe(1);
    expect(entry(PLATE)?.consumed).toBe(8);
    h.close();
  });
});
