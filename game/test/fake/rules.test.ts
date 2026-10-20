// The fake sim's M0 interactions (GATE-r1 finding 13), checked on its world directly: build, mine, the chest's
// transfers and limit bar, crafting, the hand, walking, with the reference model's refusals and its settled
// rules (README rules 16, 19, 23, 25: what does not fit is a flying text, never a refusal), and the rule that a
// refusal changes nothing.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Action } from '../../src/shared/gen/actions.ts';
import { readEvents } from '../../src/shared/gen/events.ts';
import { FailReason, FlyingText, InventoryType, MiningTarget } from '../../src/shared/gen/types.ts';
import { FakeProtos } from '../../src/simworker/fake/protos.ts';
import { applyAction, type Refusal, sortMain } from '../../src/simworker/fake/rules.ts';
import { type Char, FakeWorld } from '../../src/simworker/fake/world.ts';
import { fakeProtos, fakeProtosBin } from './harness.ts';

let protos: FakeProtos;
beforeAll(() => {
  protos = new FakeProtos(fakeProtos(), fakeProtosBin());
}, 60_000);

const NONE_REF = { a: 0, b: 0, tag: 0 };
const serialRef = (a: number) => ({ a, b: 0, tag: 1 });
const creationRef = (seq: number) => ({ a: seq, b: 0, tag: 2 });
const mainSlot = (slot: number) => ({ owner: NONE_REF, inv: InventoryType.main, slot });
const chestSlot = (ref: { a: number; b: number; tag: number }, slot: number) => ({
  owner: ref,
  inv: InventoryType.chest,
  slot,
});

/** A fresh world, its player 0, and an action runner that checks that refusals change nothing. */
function setup() {
  const w = new FakeWorld(protos, 1945);
  const c = w.chars[0] as Char;
  let seq = 0;
  const key = (name: string) => protos.key(name) as number;
  const slotOf = (name: string) => c.main.findIndex((s) => s.key === key(name) && s.count > 0);
  const total = (name: string) => c.main.reduce((n, s) => (s.key === key(name) ? n + s.count : n), 0);
  const events = () => {
    const all = w.events;
    w.events = [];
    const bytes = new Uint8Array(all.reduce((n, e) => n + e.length, 0));
    let at = 0;
    for (const e of all) {
      bytes.set(e, at);
      at += e.length;
    }
    return readEvents(bytes, all.length).map((e) => ({ ...e.payload, seq: e.header.seq }));
  };
  /** One tick with this action applied in phase 1; returns its refusal, or null. */
  const act = (a: Action): Refusal | null => {
    seq++;
    w.begin();
    const before = JSON.stringify(w.snapshot());
    const r = applyAction(w, c, seq, a);
    if (r) expect(JSON.stringify(w.snapshot()), `refused ${a.type} changed the world`).toBe(before);
    else sortMain(w, c);
    w.end();
    return r;
  };
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) w.step();
  };
  return { w, c, key, slotOf, total, events, act, ticks, seq: () => seq };
}

describe('the fake sim’s M0 interactions', () => {
  it('builds from the hand, refills it, and names the new entity by creation id', () => {
    const { w, c, key, slotOf, act, events, seq } = setup();
    const chests = slotOf('iron-chest');
    expect(act({ type: 'cursor_transfer', slot: mainSlot(chests) })).toBeNull();
    expect(c.hand).toMatchObject({ key: key('iron-chest'), count: 10, origin: chests });
    expect(
      act({
        type: 'build',
        item: key('iron-chest'),
        pos: { x2: 5, y2: 1 },
        dir: 0,
        flip: false,
        mode: 0,
        flags: 0,
        drag_id: 0,
      }),
    ).toBeNull();
    const built = seq();
    const e = w.entities[w.entities.length - 1];
    expect(e).toMatchObject({ name: 'iron-chest', x2: 5, y2: 1, role: 'chest', bar: 32 });
    expect(e?.inv.length).toBe(32);
    expect(c.hand.count).toBe(9);
    expect(events()).toContainEqual(
      expect.objectContaining({ type: 'entity_built', serial: e?.serial, seq: built }),
    );
    // The creation id resolves: set its bar.
    expect(
      act({ type: 'set_inventory_bar', target: creationRef(built), inv: InventoryType.chest, bar: 4 }),
    ).toBeNull();
    expect(e?.bar).toBe(4);
    // Refusals, each changing nothing (checked by `act`).
    const place = (x2: number, y2: number, item = key('iron-chest')) =>
      act({ type: 'build', item, pos: { x2, y2 }, dir: 0, flip: false, mode: 0, flags: 0, drag_id: 0 });
    expect(place(5, 1)).toMatchObject({ reason: FailReason.entity_in_the_way, serial: e?.serial });
    expect(place(101, 1)?.reason).toBe(FailReason.out_of_reach);
    expect(place(4, 1)?.reason).toBe(FailReason.malformed); // a 1×1 entity's centre is on a half tile
    expect(place(1, 1)).toMatchObject({ reason: FailReason.entity_in_the_way, serial: c.serial }); // the player
    expect(place(9, 1, key('iron-plate'))?.reason).toBe(FailReason.no_item_in_hand);
    // An unbuildable tile: make (4, 2) water.
    const ch = w.chunk(0, 0);
    ch.tiles[2 * 32 + 4] = protos.id('tile', 'water') as number;
    expect(place(9, 5)?.reason).toBe(FailReason.cannot_build_on_tile);
    expect(
      act({
        type: 'build',
        item: key('iron-chest'),
        pos: { x2: 9, y2: 1 },
        dir: 0,
        flip: false,
        mode: 1,
        flags: 0,
        drag_id: 0,
      })?.reason,
    ).toBe(FailReason.unsupported);
    // Building the last chest refills the hand from the main inventory; none left empties it.
    c.hand.count = 1;
    for (const s of c.main) if (s.key === key('iron-chest')) s.count = 0;
    for (const s of c.main) if (s.count === 0) s.key = 0xffff;
    expect(place(9, 1)).toBeNull();
    expect(c.hand).toMatchObject({ count: 0, key: 0xffff, ghost: false });
  });

  it('moves items between the hand, the main inventory and a chest, as the model does', () => {
    const { w, c, key, slotOf, total, act, events, seq } = setup();
    act({ type: 'cursor_transfer', slot: mainSlot(slotOf('iron-chest')) });
    act({
      type: 'build',
      item: key('iron-chest'),
      pos: { x2: 5, y2: 1 },
      dir: 0,
      flip: false,
      mode: 0,
      flags: 0,
      drag_id: 0,
    });
    const chest = creationRef(seq());
    act({ type: 'clear_cursor' });
    expect(c.hand.count).toBe(0);
    expect(total('iron-chest')).toBe(9);
    const e = w.entities[w.entities.length - 1] as (typeof w.entities)[number];
    // Ctrl+click: every iron plate to the chest.
    expect(act({ type: 'inventory_transfer', from: mainSlot(slotOf('iron-plate')), to: chest })).toBeNull();
    expect(total('iron-plate')).toBe(0);
    expect(e.inv.reduce((n, s) => n + s.count, 0)).toBe(192);
    // Shift+RMB from the chest: half a stack back (rounded up).
    expect(act({ type: 'stack_split', from: chestSlot(chest, 1), to: NONE_REF })).toBeNull();
    expect(total('iron-plate')).toBe(46);
    // Fast transfer with an empty hand: everything comes back, with a flying text per item.
    events();
    expect(act({ type: 'fast_entity_transfer', target: chest })).toBeNull();
    expect(total('iron-plate')).toBe(192);
    expect(events()).toContainEqual(
      expect.objectContaining({ type: 'flying_text', item: key('iron-plate'), count: 146, total: 192 }),
    );
    expect(act({ type: 'fast_entity_transfer', target: chest })?.reason).toBe(FailReason.nothing_to_transfer);
    // Fast transfer from the hand: the stack goes in, the flying text counts it negative.
    act({ type: 'cursor_transfer', slot: mainSlot(slotOf('coal')) });
    expect(act({ type: 'fast_entity_transfer', target: chest })).toBeNull();
    expect(events()).toContainEqual(
      expect.objectContaining({ type: 'flying_text', item: key('coal'), count: -50, total: 0 }),
    );
    // The limit bar: one slot, already holding coal. A bulk transfer into the chest stops at it, silently.
    expect(act({ type: 'set_inventory_bar', target: chest, inv: InventoryType.chest, bar: 1 })).toBeNull();
    const copper = total('copper-plate');
    events();
    expect(act({ type: 'stack_transfer', from: mainSlot(slotOf('copper-plate')), to: chest })).toBeNull();
    expect(act({ type: 'inventory_transfer', from: mainSlot(slotOf('copper-plate')), to: chest })).toBeNull();
    expect(total('copper-plate')).toBe(copper);
    expect(events()).toEqual([]);
    // A click puts items past the bar (rule 16): the gears go to slot 5.
    act({ type: 'cursor_transfer', slot: mainSlot(slotOf('iron-gear-wheel')) });
    expect(act({ type: 'cursor_transfer', slot: chestSlot(chest, 5) })).toBeNull();
    expect(e.inv[5]).toMatchObject({ key: key('iron-gear-wheel'), count: 15 });
    // Fast transfer from the hand into a chest with no slot below its bar: nothing happens, no text.
    act({ type: 'set_inventory_bar', target: chest, inv: InventoryType.chest, bar: 0 });
    act({ type: 'cursor_split', slot: mainSlot(slotOf('copper-plate')) });
    const held = c.hand.count;
    events();
    expect(act({ type: 'fast_entity_transfer', target: chest })).toBeNull();
    expect(c.hand.count).toBe(held);
    expect(events()).toEqual([]);
    act({ type: 'clear_cursor' });
    // Into a full player inventory: what fits moves, and "Cannot insert …" names the first item that did not.
    for (const x of c.main.filter((y) => y.count === 0)) {
      x.key = key('stone-furnace');
      x.count = 50;
    }
    const first = Math.min(key('coal'), key('iron-gear-wheel'));
    expect(act({ type: 'fast_entity_transfer', target: chest })).toBeNull();
    expect(events()).toEqual([
      expect.objectContaining({
        type: 'flying_text',
        text: FlyingText.inventory_full,
        item: first,
        total: -1,
        seq: seq(),
      }),
    ]);
    expect(act({ type: 'stack_transfer', from: chestSlot(chest, 0), to: NONE_REF })).toBeNull();
    expect(events()).toEqual([
      expect.objectContaining({
        type: 'flying_text',
        text: FlyingText.inventory_full,
        item: key('coal'),
        count: 50,
      }),
    ]);
    for (const x of c.main.filter((y) => y.key === key('stone-furnace'))) {
      x.key = 0xffff;
      x.count = 0;
    }
    // Refusals with their reasons, changing nothing.
    act({ type: 'clear_cursor' });
    expect(act({ type: 'stack_transfer', from: mainSlot(0), to: NONE_REF })?.reason).toBe(
      FailReason.invalid_index,
    );
    expect(act({ type: 'cursor_transfer', slot: chestSlot(chest, 32) })?.reason).toBe(
      FailReason.invalid_index,
    );
    expect(act({ type: 'cursor_transfer', slot: chestSlot(serialRef(99999), 0) })?.reason).toBe(
      FailReason.target_gone,
    );
    const far = w.entities.find((x) => x.name === 'iron-chest' && x.x2 === 51) as (typeof w.entities)[number];
    expect(act({ type: 'fast_entity_transfer', target: serialRef(far.serial) })?.reason).toBe(
      FailReason.out_of_reach,
    );
    expect(act({ type: 'set_inventory_bar', target: chest, inv: InventoryType.chest, bar: 33 })?.reason).toBe(
      FailReason.invalid_index,
    );
    expect(act({ type: 'set_player_setting', setting: 1, value: 2 })?.reason).toBe(
      FailReason.invalid_setting,
    );
  });

  it('mines a chest by rule 23: its contents first, as far as they fit; the chest only when all of it fits', () => {
    const { w, c, key, slotOf, act, events, seq, ticks, total } = setup();
    act({ type: 'cursor_transfer', slot: mainSlot(slotOf('iron-chest')) });
    act({
      type: 'build',
      item: key('iron-chest'),
      pos: { x2: 5, y2: 1 },
      dir: 0,
      flip: false,
      mode: 0,
      flags: 0,
      drag_id: 0,
    });
    const chest = creationRef(seq());
    act({ type: 'clear_cursor' });
    act({ type: 'inventory_transfer', from: mainSlot(slotOf('coal')), to: chest });
    const e = w.entities[w.entities.length - 1] as (typeof w.entities)[number];
    events();
    // No room at all: a unit (0.2 s at 0.5 speed: 24 ticks) moves nothing, says so, and mining goes on.
    for (const s of c.main.filter((x) => x.count === 0))
      Object.assign(s, { key: key('stone-furnace'), count: 50 });
    expect(act({ type: 'begin_mining', input_gen: 0, target: chest })).toBeNull();
    ticks(23);
    const full = { type: 'flying_text', text: FlyingText.inventory_full, total: -1, seq: 0 };
    expect(events()).toEqual([expect.objectContaining({ ...full, item: key('coal'), count: 50 })]);
    expect(c.mining).not.toBeNull();
    expect(w.entityBySerial(e.serial)).toBe(e);
    // Room for 20 coal: they move (an item_delta), the other 30 stay and are named.
    Object.assign(c.main.find((x) => x.key === key('stone-furnace')) as object, {
      key: key('coal'),
      count: 30,
    });
    ticks(24);
    expect(events()).toEqual([
      expect.objectContaining({
        type: 'flying_text',
        text: FlyingText.item_delta,
        item: key('coal'),
        count: 20,
        total: 50,
      }),
      expect.objectContaining({ ...full, item: key('coal'), count: 30 }),
    ]);
    expect(e.inv.reduce((n, x) => n + x.count, 0)).toBe(30);
    // Room for everything: the rest of the coal, then the chest itself.
    for (const s of c.main) if (s.key === key('stone-furnace')) Object.assign(s, { key: 0xffff, count: 0 });
    ticks(24);
    const ev = events();
    expect(ev[0]).toMatchObject({ type: 'entity_mined', serial: e.serial, seq: 0 });
    expect(ev.slice(1).map((x) => (x as { item: number }).item)).toEqual(
      [key('coal'), key('iron-chest')].sort((a, b) => a - b),
    );
    expect(total('coal')).toBe(80);
    expect(total('iron-chest')).toBe(10);
    expect(c.mining).toBeNull();
    expect(act({ type: 'begin_mining', input_gen: 0, target: chest })?.reason).toBe(FailReason.target_gone);
  });

  it('mines ore by hand at the model’s rate, within reach, into the statistics', () => {
    const { w, c, key, act, events, ticks, total } = setup();
    // Stand by the iron patch (its centre is (-14, -10)).
    c.x = -11.5;
    c.y = -8.5;
    const pos = { x: -12 * 256 + 128, y: -9 * 256 + 128 };
    expect(
      act({ type: 'begin_mining_terrain', input_gen: 0, kind: MiningTarget.resource_tile, pos }),
    ).toBeNull();
    events();
    const ore = total('iron-ore');
    ticks(119); // 1 s ore at 0.5 speed: 120 ticks, the first in the action's tick
    expect(total('iron-ore')).toBe(ore + 1);
    expect(events()).toContainEqual(
      expect.objectContaining({ type: 'flying_text', item: key('iron-ore'), count: 1 }),
    );
    // Hand-mined ore is production (the factory's drills add theirs too).
    expect(w.stats.records.get((1 << 24) + key('iron-ore'))?.producedTotal).toBeGreaterThanOrEqual(1);
    // A full inventory: the unit removes nothing, says so, and mining goes on (rule 23).
    for (const x of c.main.filter((y) => y.count === 0))
      Object.assign(x, { key: key('stone-furnace'), count: 50 });
    for (const x of c.main.filter((y) => y.key === key('iron-ore'))) x.count = 50;
    const tile = w.chunk(-1, -1).resources.find((r) => r.tile === (-9 + 32) * 32 + (-12 + 32)) as {
      amount: number;
    };
    const amount = tile.amount;
    ticks(120);
    expect(events()).toContainEqual(
      expect.objectContaining({
        type: 'flying_text',
        text: FlyingText.inventory_full,
        item: key('iron-ore'),
        count: 1,
        total: -1,
        seq: 0,
      }),
    );
    expect(tile.amount).toBe(amount);
    expect(c.mining).not.toBeNull();
    for (const x of c.main.filter((y) => y.key === key('stone-furnace')))
      Object.assign(x, { key: 0xffff, count: 0 });
    const far = { x: -20 * 256, y: -10 * 256 };
    expect(
      act({ type: 'begin_mining_terrain', input_gen: 0, kind: MiningTarget.resource_tile, pos: far })?.reason,
    ).toBe(FailReason.out_of_reach);
    expect(
      act({
        type: 'begin_mining_terrain',
        input_gen: 0,
        kind: MiningTarget.resource_tile,
        pos: { x: 256 * 40, y: 0 },
      })?.reason,
    ).toBe(FailReason.nothing_to_mine);
  });

  it('crafts from the main inventory at enqueue time, pauses when full, and cancels with refunds', () => {
    const { w, c, key, act, events, ticks, total } = setup();
    const gear = protos.id('recipe', 'iron-gear-wheel') as number;
    expect(act({ type: 'craft', recipe: gear, count: 5 })).toBeNull();
    expect(total('iron-plate')).toBe(182);
    ticks(29); // 0.5 s per gear: the first completes in the 30th tick
    expect(total('iron-gear-wheel')).toBe(16);
    expect(events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'item_crafted', recipe: gear, count: 1 }),
        expect.objectContaining({ type: 'flying_text', item: key('iron-gear-wheel'), count: 1, total: 16 }),
      ]),
    );
    // Over-request: 1,000 gears from 182 plates queue the 91 affordable ones, without a message.
    events();
    expect(act({ type: 'craft', recipe: gear, count: 1000 })).toBeNull();
    expect(total('iron-plate')).toBe(0);
    expect(events()).toEqual([]);
    expect(act({ type: 'craft', recipe: gear, count: 1 })?.reason).toBe(FailReason.not_enough_ingredients);
    // Cancel what was queued: the plates return.
    const queued = c.queue.reduce((n, q) => n + q.count, 0);
    expect(act({ type: 'cancel_craft', index: 0, count: 0 })).toBeNull();
    expect(c.queue.reduce((n, q) => n + q.count, 0)).toBeLessThan(queued);
    while (c.queue.length > 0) act({ type: 'cancel_craft', index: 0, count: 0 });
    // Every plate comes back except the 2 of each gear crafted (the kit holds 192 plates and 15 gears).
    expect(total('iron-plate')).toBe(192 - 2 * (total('iron-gear-wheel') - 15));
    // Crafting pauses while its product cannot fit, says so once (rule 25), and resumes when it can.
    act({ type: 'craft', recipe: gear, count: 1 });
    const free = c.main.filter((s) => s.count === 0);
    for (const s of free) {
      s.key = key('stone-furnace');
      s.count = 50;
    }
    const gearSlots = c.main.filter((s) => s.key === key('iron-gear-wheel'));
    for (const s of gearSlots) s.count = 100;
    events();
    ticks(60);
    expect(c.queue.length).toBe(1);
    expect(events().filter((e) => e.type === 'flying_text')).toEqual([
      expect.objectContaining({
        text: FlyingText.inventory_full,
        item: key('iron-gear-wheel'),
        count: 1,
        total: -1,
        seq: 0,
      }),
    ]);
    for (const s of free) {
      s.key = 0xffff;
      s.count = 0;
    }
    ticks(1);
    expect(c.queue.length).toBe(0);
    // A refund that does not fit is refused, changing nothing.
    act({ type: 'craft', recipe: gear, count: 1 });
    for (const s of c.main.filter((x) => x.count === 0)) {
      s.key = key('stone-furnace');
      s.count = 50;
    }
    const plates = c.main.filter((s) => s.key === key('iron-plate'));
    for (const s of plates) s.count = 100;
    expect(act({ type: 'cancel_craft', index: 0, count: 0 })?.reason).toBe(FailReason.inventory_full);
    expect(act({ type: 'cancel_craft', index: 3, count: 0 })?.reason).toBe(FailReason.invalid_index);
    expect(w.stats.records.get((1 << 24) + key('iron-gear-wheel'))?.producedTotal).toBeGreaterThan(0);
  });

  it('returns the hand with Q: to its origin slot first; what does not fit stays, with a flying text', () => {
    const { w, c, key, slotOf, act, seq, events } = setup();
    const plates = slotOf('iron-plate');
    act({ type: 'cursor_split', slot: mainSlot(plates) });
    expect(c.hand).toMatchObject({ key: key('iron-plate'), count: 50, origin: plates });
    expect(act({ type: 'clear_cursor' })).toBeNull();
    expect(c.hand.count).toBe(0);
    expect(c.main[plates]).toMatchObject({ key: key('iron-plate'), count: 100 });
    // A stack from a chest, with room for only 30 of it.
    act({ type: 'cursor_transfer', slot: mainSlot(slotOf('iron-chest')) });
    act({
      type: 'build',
      item: key('iron-chest'),
      pos: { x2: 5, y2: 1 },
      dir: 0,
      flip: false,
      mode: 0,
      flags: 0,
      drag_id: 0,
    });
    const chest = creationRef(seq());
    act({ type: 'clear_cursor' });
    const e = w.entities[w.entities.length - 1] as (typeof w.entities)[number];
    e.inv[0] = { key: key('copper-plate'), count: 100 };
    act({ type: 'cursor_transfer', slot: chestSlot(chest, 0) });
    for (const s of c.main.filter((x) => x.count === 0)) {
      s.key = key('stone-furnace');
      s.count = 50;
    }
    const copper = c.main.find((s) => s.key === key('copper-plate')) as { count: number };
    copper.count = 70;
    events();
    // "Cannot put away the Copper plate. Player inventory is full." (rule 19): never a refusal.
    expect(act({ type: 'clear_cursor' })).toBeNull();
    expect(c.hand.count).toBe(70);
    expect(c.main.reduce((n, x) => (x.key === key('copper-plate') ? n + x.count : n), 0)).toBe(100);
    const away = {
      type: 'flying_text',
      text: FlyingText.cannot_put_away,
      item: key('copper-plate'),
      total: -1,
    };
    expect(events()).toEqual([expect.objectContaining({ ...away, count: 70, seq: seq() })]);
    // Nothing fits at all: the hand keeps everything, and says so again.
    expect(act({ type: 'clear_cursor' })).toBeNull();
    expect(c.hand.count).toBe(70);
    expect(events()).toEqual([expect.objectContaining({ ...away, count: 70, seq: seq() })]);
  });

  it('walks at the tile’s speed, stops at buildings, and slides along them diagonally', () => {
    const { w, c, act } = setup();
    // On concrete (x ≥ 4) the character walks 0.15 × 1.4 tiles a tick.
    c.x = 6.5;
    c.y = 1.5;
    act({ type: 'start_walking', input_gen: 0, dir: 4 });
    expect(c.x).toBeCloseTo(6.5 + 0.15 * 1.4, 12);
    act({ type: 'stop_walking', input_gen: 0 });
    // Into the wooden chest at (2.5, −2.5): walking north from (2.5, 0.5) stops before it.
    c.x = 2.5;
    c.y = 0.5;
    act({ type: 'start_walking', input_gen: 0, dir: 0 });
    for (let i = 0; i < 40; i++) w.step();
    const box = 0.35 + 0.2;
    expect(c.y).toBeGreaterThanOrEqual(-2.5 + box);
    expect(c.y).toBeLessThan(-2.5 + box + 0.16);
    // North-east: blocked as a whole, it slides east.
    const y = c.y;
    act({ type: 'start_walking', input_gen: 0, dir: 2 });
    expect(c.y).toBe(y);
    expect(c.x).toBeGreaterThan(2.5);
  });
});
