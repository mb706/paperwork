// The golden closure log's script (10 §15.10): 600 ticks with every M0 action, a refusal of every M0 reason
// that M0's content can reach, a malformed and an unsupported action, a fenced held input, a player who leaves
// and returns, two players' batches interleaved in one tick, and a blob. `why` says what each step tests; the
// scenario report (m0/scenario.txt) shows what the model did with it.
import { createHash } from 'node:crypto';
import type { Action } from '../../../src/shared/gen/actions.ts';
import type { EntityRef, FinePos, InvSlot, TilePos2 } from '../../../src/shared/gen/types.ts';
import type { Step } from './stamp.ts';

export const TICKS = 600;

const ref = (serial: number): EntityRef => ({ a: serial, b: 0, tag: 1 });
const created = (seq: number, b = 0): EntityRef => ({ a: seq, b, tag: 2 });
const none: EntityRef = { a: 0, b: 0, tag: 0 };
const main = (slot: number): InvSlot => ({ owner: none, inv: 1, slot });
const chest = (serial: number, slot: number): InvSlot => ({ owner: ref(serial), inv: 2, slot });
const at = (tx: number, ty: number): TilePos2 => ({ x2: 2 * tx + 1, y2: 2 * ty + 1 });
const fineTile = (tx: number, ty: number): FinePos => ({ x: tx * 256 + 128, y: ty * 256 + 128 });

/** Item keys and ids of the M0 build (C1a decision 19's order: iron-chest, iron-ore, iron-plate). */
export interface Ids {
  chestKey: number;
  oreKey: number;
  plateKey: number;
  recipe: number;
}

/** Serials the script names, as the start save and the script's own creations assign them. */
export const SERIAL = { p0: 1, chestA: 2, chestB: 3, chestC: 4, p1: 5, chestD: 8 } as const;

/** 4 KiB of deterministic bytes: the blob a place_blueprint names (§15.3 "Blobs"). */
export function blobBytes(): Uint8Array {
  const b = new Uint8Array(4096);
  let x = 0x2545f491;
  for (let i = 0; i < b.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    b[i] = x >>> 24;
  }
  return b;
}

export const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export function script(ids: Ids): Step[] {
  const { chestKey, plateKey, recipe } = ids;
  const build = (pos: TilePos2, mode = 0): Action => ({
    type: 'build',
    item: chestKey,
    pos,
    dir: 0,
    flip: false,
    mode,
    flags: 0,
    drag_id: 0,
  });
  const blob = blobBytes();
  const blobHash = new Uint8Array(createHash('sha256').update(blob).digest());
  const s: Step[] = [
    // ---- t1–t4: P0 starts mining, sets a game setting, crafts, builds and fills a chest by creation id.
    {
      t: 1,
      who: 0,
      a: { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: fineTile(40, -2) },
      why: 'mine the 2-ore tile until it is depleted',
    },
    {
      t: 1,
      who: 0,
      a: { type: 'set_game_setting', setting: 1, value: 0 },
      why: 'trimmed collision off (world state, D11)',
    },
    {
      t: 1,
      who: 'sys',
      a: { type: 'snapshot_marker', snapshot_id: 1, donor: 0 },
      why: 'a system batch beside a player batch; nothing in the World',
    },
    {
      t: 2,
      who: 0,
      a: { type: 'craft', recipe, count: 1 },
      why: 'hand-craft an iron chest (8 plates leave at enqueue)',
    },
    {
      t: 2,
      who: 5,
      a: { type: 'start_walking', input_gen: 0, dir: 0 },
      why: 'a player without state: player_not_present',
    },
    {
      t: 3,
      who: 0,
      a: { type: 'cursor_transfer', slot: main(0) },
      why: 'pick up the chests (hand, origin slot 0)',
    },
    { t: 4, who: 0, a: build(at(38, 2)), label: 'buildC', why: 'build chest C (serial 4)' },
    {
      t: 4,
      who: 0,
      a: (r) => ({ type: 'fast_entity_transfer', target: created(r.seq('buildC')) }),
      why: 'fast transfer into chest C named by creation id (S5)',
    },
    // ---- t5–t10: P1 joins, takes plates, crafts two chests, mines, picks up a stack and walks.
    {
      t: 5,
      who: 'sys',
      a: { type: 'player_joined', player: 1, flags: 0 },
      why: 'a new player: character 5 at the spawn point',
    },
    { t: 5, who: 0, a: build(at(37, 2)), why: 'the hand is empty: no_item_in_hand' },
    {
      t: 6,
      who: 1,
      a: { type: 'fast_entity_transfer', target: ref(SERIAL.chestB) },
      why: 'take every plate from chest B',
    },
    { t: 7, who: 1, a: { type: 'craft', recipe, count: 2 }, why: 'P1 crafts two chests' },
    {
      t: 8,
      who: 1,
      a: { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: fineTile(1, 1) },
      why: 'P1 mines ore by the spawn point',
    },
    {
      t: 9,
      who: 1,
      a: { type: 'cursor_transfer', slot: main(0) },
      why: 'P1 holds its plates (origin slot 0)',
    },
    {
      t: 9,
      who: 1,
      a: { type: 'craft', recipe, count: 1 },
      why: 'crafting reads the main inventory, not the hand: not_enough_ingredients',
    },
    { t: 10, who: 1, a: { type: 'start_walking', input_gen: 0, dir: 4 }, why: 'P1 walks east while mining' },
    {
      t: 10,
      who: 0,
      a: { type: 'set_inventory_bar', target: ref(SERIAL.chestA), inv: 2, bar: 1 },
      why: 'limit chest A to one slot',
    },
    // ---- t11–t29: P0's inventory transfers, every kind, with their refusals.
    {
      t: 11,
      who: 0,
      a: { type: 'fast_entity_transfer', target: ref(SERIAL.chestA) },
      why: 'empty hand: take everything from chest A',
    },
    { t: 12, who: 0, a: { type: 'cursor_transfer', slot: main(0) }, why: 'pick up the ore' },
    {
      t: 13,
      who: 0,
      a: { type: 'fast_entity_transfer', target: ref(SERIAL.chestA) },
      why: 'the hand into chest A (its one unlocked slot)',
    },
    { t: 14, who: 0, a: { type: 'cursor_transfer', slot: main(0) }, why: 'pick up the plates' },
    {
      t: 15,
      who: 0,
      a: { type: 'fast_entity_transfer', target: ref(SERIAL.chestA) },
      why: 'chest A has no room for plates: inventory_full',
    },
    {
      t: 16,
      who: 0,
      a: { type: 'fast_entity_split', target: ref(SERIAL.chestC) },
      why: 'half the hand into chest C',
    },
    {
      t: 17,
      who: 0,
      a: { type: 'cursor_transfer', slot: chest(SERIAL.chestA, 5) },
      why: 'slot 5 is past the bar: cannot_insert',
    },
    { t: 18, who: 0, a: { type: 'clear_cursor' }, why: 'Q: the rest goes back to its origin slot' },
    {
      t: 19,
      who: 0,
      a: { type: 'stack_split', from: main(0), to: ref(SERIAL.chestC) },
      why: 'half a stack into chest C',
    },
    {
      t: 20,
      who: 0,
      a: { type: 'stack_transfer', from: chest(SERIAL.chestC, 1), to: none },
      why: "a chest's stack into the main inventory",
    },
    {
      t: 21,
      who: 0,
      a: { type: 'inventory_transfer', from: chest(SERIAL.chestC, 5), to: none },
      why: 'an empty slot: everything from chest C',
    },
    {
      t: 22,
      who: 0,
      a: { type: 'inventory_split', from: main(1), to: ref(SERIAL.chestC) },
      why: 'half of every plate into chest C',
    },
    {
      t: 23,
      who: 0,
      a: { type: 'cursor_split', slot: chest(SERIAL.chestC, 0) },
      why: 'RMB with an empty hand: half of the stack',
    },
    {
      t: 24,
      who: 0,
      a: { type: 'cursor_split', slot: main(5) },
      why: 'RMB with a stack: one item into an empty slot',
    },
    {
      t: 25,
      who: 0,
      a: { type: 'cursor_transfer', slot: main(0) },
      why: 'a different item in the slot: swap',
    },
    { t: 26, who: 0, a: { type: 'set_player_setting', setting: 1, value: 0 }, why: 'auto-sort off (D11)' },
    {
      t: 26,
      who: 0,
      a: { type: 'set_player_setting', setting: 1, value: 7 },
      why: 'a value other than 0 or 1: invalid_setting',
    },
    {
      t: 26,
      who: 0,
      a: { type: 'set_player_setting', setting: 1, value: 1 },
      why: 'auto-sort on again: the inventory sorts',
    },
    { t: 27, who: 0, a: { type: 'clear_cursor' }, why: 'Q with the swapped stack' },
    {
      t: 28,
      who: 0,
      a: { type: 'set_inventory_bar', target: ref(SERIAL.chestA), inv: 2, bar: 32 },
      why: 'no limit (the entry goes)',
    },
    {
      t: 28,
      who: 0,
      a: { type: 'set_inventory_bar', target: ref(SERIAL.chestA), inv: 2, bar: 40 },
      why: 'a bar past the 32 slots: invalid_index',
    },
    {
      t: 29,
      who: 0,
      a: { type: 'cancel_craft', index: 3, count: 1 },
      why: 'no queue entry 3: invalid_index',
    },
    // ---- t30–t45: P1 leaves while walking, mining, crafting and holding a stack, and returns.
    {
      t: 30,
      who: 0,
      a: { type: 'craft', recipe, count: 2 },
      why: 'two more chests: merged into the queued entry',
    },
    {
      t: 30,
      who: 'sys',
      a: { type: 'player_left', player: 1 },
      why: 'P1 leaves (R26): stops, its hand returns, its queue pauses',
    },
    {
      t: 31,
      who: 1,
      a: { type: 'start_walking', input_gen: 0, dir: 4 },
      why: 'an offline player: player_not_present',
    },
    {
      t: 35,
      who: 0,
      a: { type: 'cancel_craft', index: 0, count: 1 },
      why: 'cancel one unit: its plates come back',
    },
    {
      t: 40,
      who: 'sys',
      a: { type: 'player_joined', player: 1, flags: 1 },
      why: 'P1 returns: the same character, its queue resumes',
    },
    {
      t: 41,
      who: 1,
      a: { type: 'start_walking', input_gen: 0, dir: 4 },
      gen: 0,
      why: 'stamped before the release: fenced (D22)',
    },
    { t: 42, who: 1, a: { type: 'start_walking', input_gen: 0, dir: 6 }, why: 'P1 walks south-east' },
    // Three batches in one tick: P0, P1, P0 (§15.3: a player's actions may form several batches).
    {
      t: 43,
      who: 0,
      a: { type: 'set_player_setting', setting: 2, value: 1 },
      why: 'pick a ghost cursor when out of items',
    },
    { t: 43, who: 1, a: { type: 'stop_walking', input_gen: 0 }, why: 'P1 stops' },
    { t: 43, who: 0, a: { type: 'cursor_transfer', slot: main(0) }, why: 'P0 picks up its chests' },
    {
      t: 44,
      who: 1,
      a: { type: 'set_player_setting', setting: 1, value: 0 },
      why: 'P1 turns auto-sort off; P0 keeps it on (R29)',
    },
    // ---- t44–t60: P0's building refusals, then two builds that leave a ghost cursor.
    { t: 44, who: 0, a: build(at(38, -1)), why: "P0's own character is in the way" },
    { t: 45, who: 0, a: build(at(34, 6)), why: 'water: cannot_build_on_tile' },
    { t: 46, who: 0, a: build(at(48, -1)), why: 'past the map edge: out_of_map' },
    { t: 47, who: 0, a: build(at(25, 0)), label: 'farBuild', why: 'too far: out_of_reach' },
    { t: 48, who: 0, a: build({ x2: 72, y2: 5 }), why: 'an even centre for a 1×1 chest: malformed' },
    { t: 49, who: 0, a: build(at(36, -3)), why: 'chest A is in the way' },
    { t: 50, who: 0, a: build(at(37, 3), 1), why: 'ghost mode is not in M0: unsupported' },
    { t: 51, who: 0, a: build(at(37, 3)), why: 'build' },
    { t: 52, who: 0, a: build(at(36, 3)), why: 'build the last chest: the hand becomes a ghost cursor' },
    { t: 53, who: 0, a: { type: 'clear_cursor' }, why: 'Q clears the ghost cursor' },
    {
      t: 53,
      who: 0,
      a: { type: 'rotate_entity', target: ref(SERIAL.chestA), reverse: false },
      why: 'outside the capability manifest: unsupported',
    },
    {
      t: 54,
      who: 0,
      a: (r) => ({ type: 'begin_mining', input_gen: 0, target: created(r.seq('farBuild')) }),
      why: 'a creation id of a failed build: target_gone (R25)',
    },
    {
      t: 55,
      who: 0,
      a: {
        type: 'place_blueprint',
        pos: at(30, 0),
        dir: 0,
        flip: false,
        mode: 0,
        record: { blob: blobHash },
      },
      blob,
      why: 'a blob (supplied for its tick); the action itself is unsupported in M0',
    },
    {
      t: 56,
      who: 0,
      raw: { type: 1, payload: new Uint8Array([0, 0, 3]) },
      why: 'start_walking with direction 3: malformed',
    },
    {
      t: 56,
      who: 0,
      raw: { type: 999, payload: new Uint8Array([1, 2]) },
      why: 'an unknown action type: malformed',
    },
    {
      t: 57,
      who: 0,
      a: { type: 'begin_mining_terrain', input_gen: 0, kind: 3, pos: fineTile(37, 0) },
      why: 'grass is not minable',
    },
    {
      t: 58,
      who: 0,
      a: { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: fineTile(37, 0) },
      why: 'no resource there: nothing_to_mine',
    },
    {
      t: 59,
      who: 0,
      a: { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: fineTile(45, -6) },
      why: 'ore out of reach',
    },
    {
      t: 60,
      who: 0,
      a: { type: 'stack_transfer', from: main(40), to: ref(SERIAL.chestA) },
      why: 'an empty slot: nothing_to_transfer',
    },
    { t: 60, who: 0, a: { type: 'cursor_transfer', slot: main(200) }, why: 'slot 200 of 80: invalid_index' },
    // ---- t60–t100: P1 builds, mines its chest back, rebuilds; P0 names the old serial (R24).
    {
      t: 61,
      who: 1,
      a: { type: 'cursor_transfer', slot: main(1) },
      why: 'P1 picks up its chest (no auto-sort: slot 1)',
    },
    { t: 62, who: 1, a: build(at(3, 0)), why: "P1's own character is in the way" },
    { t: 63, who: 1, a: build(at(7, 3)), label: 'buildD', why: 'P1 builds chest D' },
    {
      t: 64,
      who: 1,
      a: (r) => ({ type: 'begin_mining', input_gen: 0, target: created(r.seq('buildD')) }),
      why: 'P1 mines chest D back, named by creation id',
    },
    { t: 89, who: 1, a: { type: 'cursor_transfer', slot: main(1) }, why: 'P1 picks up its chests again' },
    { t: 90, who: 1, a: build(at(7, 3)), why: 'P1 builds again on the same tile: a new serial' },
    {
      t: 91,
      who: 0,
      a: { type: 'fast_entity_transfer', target: ref(SERIAL.chestD) },
      why: 'the old serial: target_gone, never the new chest (R24)',
    },
    {
      t: 92,
      who: 1,
      a: { type: 'begin_mining', input_gen: 0, target: ref(SERIAL.chestD) },
      why: 'the mined chest: target_gone',
    },
    // ---- t241–t340: P0 walks to the map edge, is released, a stale start is fenced, it slides north.
    {
      t: 241,
      who: 0,
      a: { type: 'start_walking', input_gen: 0, dir: 4 },
      why: 'walk east, toward the map edge',
    },
    {
      t: 300,
      who: 'sys',
      a: { type: 'release_inputs', player: 0 },
      why: 'released at 300: the character stops at 300 (R23)',
    },
    {
      t: 301,
      who: 0,
      a: { type: 'start_walking', input_gen: 0, dir: 2 },
      gen: 0,
      why: 'stamped before the release: fenced',
    },
    {
      t: 302,
      who: 0,
      a: { type: 'start_walking', input_gen: 0, dir: 2 },
      why: 'north-east into the edge: slides north',
    },
    { t: 320, who: 0, a: { type: 'stop_walking', input_gen: 0 }, why: "stop in chest A's row" },
    { t: 341, who: 'sys', a: { type: 'debug_dump', dump_id: 7 }, why: 'nothing in the World' },
    {
      t: 341,
      who: 0,
      a: { type: 'set_game_setting', setting: 1, value: 1 },
      why: 'trimmed collision back on',
    },
    // ---- t342–t480: P0 walks west into chest A, slides past it, mines chest C with its contents.
    {
      t: 342,
      who: 0,
      a: { type: 'start_walking', input_gen: 0, dir: 12 },
      why: 'walk west until chest A blocks',
    },
    {
      t: 420,
      who: 0,
      a: { type: 'start_walking', input_gen: 0, dir: 14 },
      why: 'north-west: slides north along chest A',
    },
    { t: 430, who: 0, a: { type: 'stop_walking', input_gen: 0 }, why: 'stop' },
    {
      t: 431,
      who: 0,
      a: { type: 'begin_mining', input_gen: 0, target: ref(SERIAL.chestC) },
      why: 'mine chest C and its contents',
    },
    {
      t: 460,
      who: 0,
      a: { type: 'begin_mining', input_gen: 0, target: ref(SERIAL.chestC) },
      why: 'chest C is gone: target_gone',
    },
    { t: 461, who: 0, a: { type: 'start_walking', input_gen: 0, dir: 4 }, why: 'back east, toward the ore' },
    { t: 471, who: 0, a: { type: 'stop_walking', input_gen: 0 }, why: 'stop' },
    {
      t: 472,
      who: 0,
      a: { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: fineTile(40, -3) },
      why: 'mine ore: one unit by tick 591',
    },
    {
      t: 501,
      who: 0,
      a: { type: 'fast_entity_transfer', target: ref(SERIAL.chestA) },
      why: 'the hand is empty: take from chest A',
    },
    {
      t: 502,
      who: 0,
      a: { type: 'fast_entity_transfer', target: ref(SERIAL.chestA) },
      why: 'chest A is empty: nothing_to_transfer',
    },
    { t: 503, who: 0, a: { type: 'craft', recipe, count: 0 }, why: 'craft all that can be crafted' },
    { t: 595, who: 0, a: { type: 'stop_mining', input_gen: 0 }, why: 'stop mining' },
  ];
  void plateKey;
  return s;
}
