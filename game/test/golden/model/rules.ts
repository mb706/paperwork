// M0's rules (10 §5.1–§5.2, §15.3; I §3.1–§3.9): phase 1 applies a closure's actions and advances each
// character; phase 15 keeps the statistics (§5.20). Straight-line code; each rule cites its source, and every
// decision the spec leaves open is marked "Model decision" and listed in README.md.
import { type Action, type ClosureAction, decodeAction } from '../../../src/shared/gen/actions.ts';
import { SUPPORTED_ACTIONS } from '../../../src/shared/gen/capabilities.ts';
import type { EventPayload } from '../../../src/shared/gen/events.ts';
import type { EntityTableRow } from '../../../src/shared/gen/pools.ts';
import type { CraftEntry, Player } from '../../../src/shared/gen/state.ts';
import { MiningMode } from '../../../src/shared/gen/state.ts';
import type { EntityRef, FinePos, InvSlot } from '../../../src/shared/gen/types.ts';
import {
  BuildMode,
  EntityRefTag,
  FailReason,
  FlyingText,
  GameSetting,
  InventoryType,
  MiningTarget,
  PlayerSetting,
  StatKind,
} from '../../../src/shared/gen/types.ts';
import {
  chestInv,
  clear,
  count,
  emptyHand,
  fingerprint,
  handOrigin,
  type Inv,
  insert,
  keys,
  mainInv,
  remove,
  room,
  sortMain,
  stackSize,
} from './inventory.ts';
import type { Presentation } from './presentation.ts';
import { NONE16, type Rect, SURFACE, tileIndex, type World } from './world.ts';

/**
 * Model decision (hand mining and crafting): a unit of work completes in the tick its progress reaches
 * 1 − 10⁻⁹, and the progress then keeps what passed 1 (never below 0). Accumulating 1/30 thirty times in
 * IEEE doubles gives 0.9999999999999999, so without the tolerance a 0.5-s craft would take 31 ticks; with
 * it, 0.5 s is 30 ticks, ore by hand 120 and a chest 24, as in Factorio, and the remainder keeps the
 * average rate exact when bonuses make the rate irrational.
 */
export const UNIT_DONE = 1 - 1e-9;

/** The 8 walking directions (§5.1), y pointing south: unit vectors for Direction / 2. */
const S = Math.SQRT1_2;
const WALK: readonly (readonly [number, number])[] = [
  [0, -1],
  [S, -S],
  [1, 0],
  [S, S],
  [0, 1],
  [-S, S],
  [-1, 0],
  [-S, -S],
];

/** Model decision: a new character faces south (Direction 8), towards the camera. */
const NEW_CHARACTER_DIR = 8;

/** A stat key (§5.20, types.yaml `StatKey`): (StatKind << 24) | id. */
export const statKey = (kind: number, id: number): number => kind * 2 ** 24 + id;
export const itemStat = (itemKey: number): number => statKey(StatKind.item, itemKey);

/** What one tick accumulates for phase 15 and the digest (§4.8, §5.20), by stat key. */
export interface Counters {
  produced: Map<number, number>;
  consumed: Map<number, number>;
  handcrafted: Map<number, number>;
}

export interface Ctx {
  w: World;
  pres: Presentation;
  tick: number;
  counters: Counters;
}

const add = (m: Map<number, number>, k: number, v: number): void => {
  m.set(k, (m.get(k) ?? 0) + v);
};

// ------------------------------------------------------------------------------------------- geometry

/** A position in 1/256 tile (types.yaml `FinePos`); model decision: round half up, floor(v × 256 + 0.5). */
export const fine = (v: number): number => Math.floor(v * 256 + 0.5);
const finePos = (x: number, y: number): FinePos => ({ x: fine(x), y: fine(y) });
/** An entity's centre as a FinePos: x2 / 2 tiles = x2 × 128 positions, exactly. */
const entityPos = (e: EntityTableRow): FinePos => ({ x: e.x2 * 128, y: e.y2 * 128 });

/** Squared distance from a point to a box (0 inside), written with comparisons (D19's `min`/`max` ban). */
export function dist2(px: number, py: number, b: Rect): number {
  const dx = px < b.x0 ? b.x0 - px : px > b.x1 ? px - b.x1 : 0;
  const dy = py < b.y0 ? b.y0 - py : py > b.y1 ? py - b.y1 : 0;
  return dx * dx + dy * dy;
}

/**
 * Reach (I §3.1): "distance is measured from the character to the target's bounding box". Model decision:
 * the entity's collision box; a resource tile's whole square; compared squared, d² ≤ reach².
 */
export const inReach = (p: Player, box: Rect, reach: number): boolean =>
  dist2(p.x, p.y, box) <= reach * reach;

/** Strict overlap: boxes that only touch do not collide. */
export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const tileBox = (tx: number, ty: number): Rect => ({ x0: tx, y0: ty, x1: tx + 1, y1: ty + 1 });

function characterBox(w: World, x: number, y: number): Rect {
  const c = w.protos.entity[w.protos.character] as {
    collision_x0: number;
    collision_y0: number;
    collision_x1: number;
    collision_y1: number;
  };
  return { x0: x + c.collision_x0, y0: y + c.collision_y0, x1: x + c.collision_x1, y1: y + c.collision_y1 };
}

/**
 * Whether a character at (x, y) collides (§4.4, §5.1): its box overlaps a tile that is not walkable (water,
 * the out-of-map tile, anything outside the map or not generated) or a building's collision box. Trimmed
 * collision (§4.4) exempts chests, M0's only building, so it changes nothing here. Model decision:
 * characters do not collide with each other (Factorio's characters pass through each other).
 */
function blocked(w: World, x: number, y: number): boolean {
  const box = characterBox(w, x, y);
  for (let tx = Math.floor(box.x0); tx < box.x1; tx++)
    for (let ty = Math.floor(box.y0); ty < box.y1; ty++) if (!w.walkable(tx, ty)) return true;
  for (const e of w.liveEntities()) if (overlaps(box, w.collisionBox(e))) return true;
  return false;
}

// ------------------------------------------------------------------------------------------- events

function emit(ctx: Ctx, seq: number, player: number, payload: EventPayload): void {
  ctx.pres.events.push({ tick: ctx.tick, seq, player, surface: SURFACE }, payload);
}

/** Where an event about a player happens by default: its character, or the origin without one. */
function playerPos(p: Player | undefined): FinePos {
  return p && p.character !== 0 ? finePos(p.x, p.y) : { x: 0, y: 0 };
}

interface Refusal {
  reason: number;
  pos?: FinePos;
  serial?: number;
}

const fail = (reason: number, pos?: FinePos, serial = 0): Refusal =>
  pos === undefined ? { reason, serial } : { reason, pos, serial };

// ------------------------------------------------------------------------------------------- references

/**
 * An entity reference (§15.3, D23): tag 1 through the serial index, tag 2 through the acting player's creation
 * ring; never by position. Characters are not entities, so a character's serial resolves to nothing.
 */
export function resolve(w: World, p: Player, ref: EntityRef): EntityTableRow | null {
  if (ref.tag === EntityRefTag.serial) return w.entityBySerial(ref.a) ?? null;
  if (ref.tag === EntityRefTag.creation) {
    const c = p.creation_ring.find((x) => x.seq === ref.a);
    if (!c || ref.b >= c.count) return null;
    return w.entityBySerial(c.first_serial + ref.b) ?? null;
  }
  return null;
}

/** The reach for opening, transferring and mining entities (I §3.1: reach_distance 10). */
const reachOf = (w: World): number =>
  (w.protos.entity[w.protos.character] as { reach_distance: number }).reach_distance;

/**
 * An inventory slot named by an action (types.yaml `InvSlot`): owner tag 0 is the acting player's main
 * inventory; otherwise the entity's inventory of type `inv`, in reach. Model decision on the order of checks:
 * target gone, out of reach, no such inventory, slot out of range.
 */
function resolveSlot(
  w: World,
  p: Player,
  s: InvSlot,
): { inv: Inv; owner: EntityTableRow | null; index: number } | Refusal {
  let inv: Inv;
  let owner: EntityTableRow | null = null;
  if (s.owner.tag === EntityRefTag.none) {
    if (s.inv !== InventoryType.main) return fail(FailReason.invalid_index);
    inv = mainInv(w, p);
  } else {
    owner = resolve(w, p, s.owner);
    if (!owner) return fail(FailReason.target_gone);
    if (!inReach(p, w.collisionBox(owner), reachOf(w)))
      return fail(FailReason.out_of_reach, entityPos(owner));
    if (s.inv !== InventoryType.chest) return fail(FailReason.invalid_index, entityPos(owner));
    inv = chestInv(w, owner);
  }
  if (s.slot >= inv.size) return fail(FailReason.invalid_index, owner ? entityPos(owner) : undefined);
  return { inv, owner, index: s.slot };
}

/** The "other" inventory of a transfer (I §3.8): tag 0 the player's main inventory, else the entity's. */
function resolveOther(
  w: World,
  p: Player,
  ref: EntityRef,
): { inv: Inv; owner: EntityTableRow | null } | Refusal {
  if (ref.tag === EntityRefTag.none) return { inv: mainInv(w, p), owner: null };
  const e = resolve(w, p, ref);
  if (!e) return fail(FailReason.target_gone);
  if (!inReach(p, w.collisionBox(e), reachOf(w))) return fail(FailReason.out_of_reach, entityPos(e));
  return { inv: chestInv(w, e), owner: e };
}

const isRefusal = (x: object): x is Refusal => 'reason' in x;

// ------------------------------------------------------------------------------------------- phase 1: actions

/**
 * Applies one action of the closure (§15.3, §4.6 phase 1): the seq is consumed first (refused or not), then
 * the generated decoder's field validation (`malformed`), the capability manifest (`unsupported`, §2.4), the
 * player's presence, input fencing for held inputs (D22), and the action's own rules.
 */
export function applyAction(ctx: Ctx, a: ClosureAction): void {
  const { w } = ctx;
  if (a.system) w.globals.last_system_seq = a.seq;
  else {
    // A player without state has no last_seq to keep (model decision); preflight treats it as 0.
    const p = w.player(a.player);
    if (p) p.last_seq = a.seq;
  }
  const refuse = (r: Refusal, p?: Player): void =>
    emit(ctx, a.seq, a.player, {
      type: 'action_failed',
      reason: r.reason,
      pos: r.pos ?? playerPos(p),
      serial: r.serial ?? 0,
    });
  let act: Action;
  try {
    act = decodeAction(a.type, a.payload);
  } catch {
    refuse(fail(FailReason.malformed), a.system ? undefined : w.player(a.player));
    return;
  }
  if (!SUPPORTED_ACTIONS.has(act.type)) {
    refuse(fail(FailReason.unsupported), a.system ? undefined : w.player(a.player));
    return;
  }
  if (a.system) {
    applySystem(ctx, act);
    return;
  }
  const p = w.player(a.player);
  if (!p?.online) {
    refuse(fail(FailReason.player_not_present), p);
    return;
  }
  if ('input_gen' in act && act.input_gen !== p.input_gen) {
    emit(ctx, a.seq, a.player, { type: 'input_fenced' });
    return;
  }
  const before = fingerprint(w, p);
  const r = applyPlayerAction(ctx, p, a.seq, act);
  // With auto-sort on, the main inventory is sorted at every step boundary (model decision; I §3.8).
  sortMain(w, p);
  if (fingerprint(w, p) !== before) p.inventory_version = (p.inventory_version + 1) >>> 0;
  if (r) refuse(r, p);
  else p.last_action_tick = ctx.tick;
}

function applyPlayerAction(ctx: Ctx, p: Player, seq: number, act: Action): Refusal | null {
  const { w } = ctx;
  switch (act.type) {
    case 'start_walking':
      p.walking = true;
      p.walking_dir = act.dir;
      return null;
    case 'stop_walking':
      p.walking = false;
      return null;
    case 'begin_mining':
      return beginMining(w, p, act.target);
    case 'begin_mining_terrain':
      return beginMiningTerrain(w, p, act.kind, act.pos);
    case 'stop_mining':
      stopMining(p);
      return null;
    case 'build':
      return build(ctx, p, seq, act);
    case 'clear_cursor':
      return clearCursor(w, p);
    case 'cursor_transfer':
      return cursorTransfer(w, p, act.slot, false);
    case 'cursor_split':
      return cursorTransfer(w, p, act.slot, true);
    case 'stack_transfer':
      return stackTransfer(w, p, act.from, act.to, false);
    case 'stack_split':
      return stackTransfer(w, p, act.from, act.to, true);
    case 'inventory_transfer':
      return inventoryTransfer(w, p, act.from, act.to, false);
    case 'inventory_split':
      return inventoryTransfer(w, p, act.from, act.to, true);
    case 'fast_entity_transfer':
      return fastTransfer(ctx, p, seq, act.target, false);
    case 'fast_entity_split':
      return fastTransfer(ctx, p, seq, act.target, true);
    case 'set_inventory_bar':
      return setInventoryBar(w, p, act.target, act.inv, act.bar);
    case 'craft':
      return craft(w, p, act.recipe, act.count);
    case 'cancel_craft':
      return cancelCraft(w, p, act.index, act.count);
    case 'set_player_setting':
      if (act.value > 1) return fail(FailReason.invalid_setting);
      if (act.setting === PlayerSetting.auto_sort_inventory) {
        p.auto_sort = act.value === 1;
        sortMain(w, p);
      } else if (act.setting === PlayerSetting.pick_ghost_cursor) p.pick_ghost_cursor = act.value === 1;
      return null;
    case 'set_game_setting':
      if (act.value > 1) return fail(FailReason.invalid_setting);
      if (act.setting === GameSetting.trimmed_collision) w.globals.game.trimmed_collision = act.value === 1;
      return null;
    default:
      // Unreachable: SUPPORTED_ACTIONS lists exactly the cases above and the system actions.
      throw new Error(`no rule for ${act.type}`);
  }
}

// ------------------------------------------------------------------------------------------- mining (§5.1, I §3.7)

function stopMining(p: Player): void {
  p.mining = { mode: MiningMode.none, serial: 0, pos: { x: 0, y: 0 }, progress: 0 };
}

function beginMining(w: World, p: Player, target: EntityRef): Refusal | null {
  const e = resolve(w, p, target);
  if (!e) return fail(FailReason.target_gone);
  if (!((w.protos.entity[e.proto]?.mining_time ?? 0) > 0)) return fail(FailReason.not_minable, entityPos(e));
  if (!inReach(p, w.collisionBox(e), reachOf(w))) return fail(FailReason.out_of_reach, entityPos(e));
  // Model decision: beginning on the target already being mined keeps its progress.
  const same = p.mining.mode === MiningMode.entity && p.mining.serial === e.serial;
  p.mining = {
    mode: MiningMode.entity,
    serial: e.serial,
    pos: { x: 0, y: 0 },
    progress: same ? p.mining.progress : 0,
  };
  return null;
}

/** The resource tile at a fine position, if any (§4.4: resources are per tile). */
function resourceAt(
  w: World,
  pos: FinePos,
): { tx: number; ty: number; res: { tile: number; resource: number; amount: number } } | null {
  const tx = Math.floor(pos.x / 256);
  const ty = Math.floor(pos.y / 256);
  const c = w.chunkAt(tx, ty);
  const res = c?.rec.resources.find((r) => r.tile === tileIndex(tx, ty));
  return res ? { tx, ty, res } : null;
}

function beginMiningTerrain(w: World, p: Player, kind: number, pos: FinePos): Refusal | null {
  if (kind === MiningTarget.resource_tile) {
    const at = resourceAt(w, pos);
    if (!at) return fail(FailReason.nothing_to_mine, pos);
    const proto = w.protos.resource[at.res.resource];
    if (proto?.kind !== 0) return fail(FailReason.not_minable, pos); // only solid resources by hand
    const reach = (w.protos.entity[w.protos.character] as { resource_reach_distance: number })
      .resource_reach_distance;
    if (!inReach(p, tileBox(at.tx, at.ty), reach)) return fail(FailReason.out_of_reach, pos);
    const old = p.mining.mode === MiningMode.resource_tile ? resourceAt(w, p.mining.pos) : null;
    const same = old !== null && old.tx === at.tx && old.ty === at.ty;
    p.mining = { mode: MiningMode.resource_tile, serial: 0, pos, progress: same ? p.mining.progress : 0 };
    return null;
  }
  if (kind === MiningTarget.tile) {
    // Only placed tiles are minable (tiles.minable_back); M0 has none to place.
    const t = w.tileAt(Math.floor(pos.x / 256), Math.floor(pos.y / 256));
    if (t === null) return fail(FailReason.nothing_to_mine, pos);
    return fail(FailReason.not_minable, pos);
  }
  // World objects and ground items: M0's map has neither (no world objects in its manifest; nothing drops).
  return fail(FailReason.nothing_to_mine, pos);
}

/** Whether every one of `items` fits the main inventory at once (tried on a copy). */
function fitsAll(w: World, p: Player, items: readonly { key: number; n: number }[]): boolean {
  const inv = mainInv(w, p);
  const saved = [];
  for (let i = 0; i < inv.size; i++) {
    const s = w.heap.slot(inv.ref, i);
    saved.push({ key: s.key, count: s.count });
  }
  let ok = true;
  for (const it of items) if (insert(w, inv, it.key, it.n) < it.n) ok = false;
  saved.forEach((v, i) => {
    const s = w.heap.slot(inv.ref, i);
    s.key = v.key;
    s.count = v.count;
  });
  return ok;
}

/** One tick of a character's hand mining (§5.1: progress = 0.5 × (1 + bonuses) ÷ mining_time per second). */
function mineTick(ctx: Ctx, p: Player): void {
  const { w } = ctx;
  const m = p.mining;
  if (m.mode === MiningMode.none) return;
  const ch = w.protos.entity[w.protos.character] as { mining_speed: number; resource_reach_distance: number };
  let time: number;
  let target: EntityTableRow | null = null;
  let tile: ReturnType<typeof resourceAt> = null;
  if (m.mode === MiningMode.entity) {
    target = w.entityBySerial(m.serial) ?? null;
    // Model decision: mining stops, silently, when its target is gone or out of reach.
    if (!target || !inReach(p, w.collisionBox(target), reachOf(w))) {
      stopMining(p);
      return;
    }
    time = (w.protos.entity[target.proto] as { mining_time: number }).mining_time;
  } else {
    tile = resourceAt(w, m.pos);
    if (!tile || !inReach(p, tileBox(tile.tx, tile.ty), ch.resource_reach_distance)) {
      stopMining(p);
      return;
    }
    time = (w.protos.resource[tile.res.resource] as { mining_time: number }).mining_time;
  }
  // Bit-exact: speed / (time × 60), evaluated in this order (no bonuses in M0).
  const rate = ch.mining_speed / (time * 60);
  if (m.progress < UNIT_DONE) m.progress += rate;
  if (m.progress < UNIT_DONE) return;

  const where = target ? entityPos(target) : (m.pos as FinePos);
  const gains: { key: number; n: number }[] = [];
  if (target) {
    const item = (w.protos.entity[target.proto] as { item: number }).item;
    gains.push({ key: item * 8 + target.quality, n: 1 });
    const inv = chestInv(w, target);
    for (const k of keys(w, inv)) gains.push({ key: k, n: count(w, inv, k) });
  } else if (tile) {
    const res = w.protos.resource[tile.res.resource] as { yield_id: number };
    gains.push({ key: res.yield_id * 8, n: 1 });
  }
  // 2.0.67: mining whose result does not fit is refused, and nothing drops (I §3.7).
  if (!fitsAll(w, p, gains)) {
    emit(ctx, 0, p.index, {
      type: 'action_failed',
      reason: FailReason.inventory_full,
      pos: where,
      serial: 0,
    });
    stopMining(p);
    return;
  }
  const main = mainInv(w, p);
  const merged = new Map<number, number>();
  for (const g of gains) {
    insert(w, main, g.key, g.n);
    merged.set(g.key, (merged.get(g.key) ?? 0) + g.n);
  }
  sortMain(w, p);
  const flying = (): void => {
    for (const k of [...merged.keys()].sort((a, b) => a - b))
      emit(ctx, 0, p.index, {
        type: 'flying_text',
        text: FlyingText.item_delta,
        item: k,
        count: merged.get(k) as number,
        total: count(w, mainInv(w, p), k),
        pos: finePos(p.x, p.y),
      });
  };
  if (target) {
    const c = w.chunkAt(target.x2 >> 1, target.y2 >> 1);
    if (c) {
      c.rec.rule_version = (c.rec.rule_version + 1) >>> 0;
      c.view.entities++;
    }
    emit(ctx, 0, p.index, {
      type: 'entity_mined',
      serial: target.serial,
      proto: target.proto,
      pos: { x2: target.x2, y2: target.y2 },
    });
    w.freeEntity(target);
    flying();
    stopMining(p);
    return;
  }
  if (tile) {
    const c = w.chunkAt(tile.tx, tile.ty);
    if (!c) throw new Error('a resource outside every chunk');
    const before = resourceBand(tile.res.amount);
    tile.res.amount -= 1;
    // Mined ore is production (I §4.12: hand-mined items count, §15.5 STATS "hand-mined").
    for (const [k, n] of merged) add(ctx.counters.produced, itemStat(k), n);
    c.rec.rule_version = (c.rec.rule_version + 1) >>> 0;
    flying();
    if (tile.res.amount === 0) {
      c.rec.resources = c.rec.resources.filter((r) => r !== tile.res);
      c.view.resources++;
      stopMining(p);
      return;
    }
    if (resourceBand(tile.res.amount) !== before) c.view.resources++;
    m.progress = m.progress - 1 < 0 ? 0 : m.progress - 1;
  }
}

/**
 * The richness band of a resource tile (§15.4 CHUNK_RESOURCES, §15.7 `band`: the depletion stage). Model
 * decision: Factorio's ore `stage_counts` {15000, 9500, 5500, 2900, 1300, 400, 150, 80}: band 0 (the richest
 * sprite) from 15,000 down to band 7 below 150, the same for every solid resource until the engine overlay
 * carries per-resource stages.
 */
export function resourceBand(amount: number): number {
  const stages = [15000, 9500, 5500, 2900, 1300, 400, 150];
  for (let i = 0; i < stages.length; i++) if (amount >= (stages[i] as number)) return i;
  return 7;
}

// ------------------------------------------------------------------------------------------- building (§5.2, I §3.3)

function build(ctx: Ctx, p: Player, seq: number, a: Extract<Action, { type: 'build' }>): Refusal | null {
  const { w } = ctx;
  const where: FinePos = { x: a.pos.x2 * 128, y: a.pos.y2 * 128 };
  // Ghosts and super-forced building are not in M0 (§12): the developer reason, not a player-facing one.
  if (a.mode !== BuildMode.normal) return fail(FailReason.unsupported, where);
  // Model decision: the hand must hold a real stack of exactly `item`, which places an entity.
  const item = w.protos.item[a.item >> 3];
  if (p.hand.ghost || p.hand.count === 0 || p.hand.key !== a.item || !item || item.places_entity === NONE16)
    return fail(FailReason.no_item_in_hand, where);
  const proto = w.protos.entity[item.places_entity];
  if (!proto) return fail(FailReason.no_item_in_hand, where);
  // Model decision: a centre whose parity does not fit the footprint is not a building centre (§4.2).
  if (
    ((a.pos.x2 & 1) === 1) !== (proto.size_w % 2 === 1) ||
    ((a.pos.y2 & 1) === 1) !== (proto.size_h % 2 === 1)
  )
    return fail(FailReason.malformed, where);
  const cx = a.pos.x2 / 2;
  const cy = a.pos.y2 / 2;
  const box: Rect = {
    x0: cx + proto.collision_x0,
    y0: cy + proto.collision_y0,
    x1: cx + proto.collision_x1,
    y1: cy + proto.collision_y1,
  };
  const build = (w.protos.entity[w.protos.character] as { build_distance: number }).build_distance;
  // Model decision on the order: reach, map bounds, tiles, buildings, characters.
  if (!inReach(p, box, build)) return fail(FailReason.out_of_reach, where);
  const tx0 = cx - proto.size_w / 2;
  const ty0 = cy - proto.size_h / 2;
  for (let tx = tx0; tx < tx0 + proto.size_w; tx++)
    for (let ty = ty0; ty < ty0 + proto.size_h; ty++)
      if (!w.inMap(tx, ty)) return fail(FailReason.out_of_map, where);
  for (let tx = tx0; tx < tx0 + proto.size_w; tx++)
    for (let ty = ty0; ty < ty0 + proto.size_h; ty++)
      if (!w.buildable(tx, ty)) return fail(FailReason.cannot_build_on_tile, where);
  const inWay = w.liveEntities().find((e) => overlaps(box, w.collisionBox(e)));
  if (inWay) return fail(FailReason.entity_in_the_way, where, inWay.serial);
  // A building never covers a character (Factorio's buildings collide with the player layer).
  const chars = w.players
    .filter((q) => q.character !== 0 && overlaps(box, characterBox(w, q.x, q.y)))
    .sort((x, y) => x.character - y.character);
  if (chars.length > 0) return fail(FailReason.entity_in_the_way, where, (chars[0] as Player).character);

  const serial = w.nextSerial();
  const e = w.allocEntity(
    {
      proto: item.places_entity,
      kind: 1, // PoolKind.container: M0's only pool
      surface: SURFACE,
      dir: proto.rotatable ? a.dir : 0, // Model decision: a non-rotatable entity faces north
      flip: proto.flippable && a.flip ? 1 : 0,
      quality: a.item & 7,
      built_by: 16 + p.index, // S1: 16 + i for player i
      x2: a.pos.x2,
      y2: a.pos.y2,
      flags: 0,
      serial,
      built_tick: ctx.tick,
    },
    proto.inventory_slots,
  );
  // The creation ring (§4.3): the last 256 creating actions, oldest dropped.
  p.creation_ring.push({ seq, first_serial: serial, count: 1 });
  if (p.creation_ring.length > 256) p.creation_ring.shift();
  // The hand loses the item; auto-replenish from the main inventory (I §3.2), else empty or a ghost cursor.
  p.hand.count -= 1;
  if (p.hand.count === 0) {
    const main = mainInv(w, p);
    let from = -1;
    for (let i = 0; i < main.size; i++) {
      const s = w.heap.slot(main.ref, i);
      if (s.key === a.item && s.count > 0) {
        from = i;
        break;
      }
    }
    if (from >= 0) {
      const s = w.heap.slot(main.ref, from);
      p.hand = { key: s.key, ghost: false, origin: from, count: s.count };
      clear(s);
    } else if (p.pick_ghost_cursor) p.hand = { key: a.item, ghost: true, origin: NONE16, count: 0 };
    else p.hand = emptyHand();
    sortMain(w, p);
  }
  const c = w.chunkAt(a.pos.x2 >> 1, a.pos.y2 >> 1);
  if (c) {
    c.rec.rule_version = (c.rec.rule_version + 1) >>> 0;
    c.view.entities++;
  }
  emit(ctx, seq, p.index, {
    type: 'entity_built',
    serial,
    proto: e.proto,
    dir: e.dir,
    flags: 0,
    pos: { x2: e.x2, y2: e.y2 },
  });
  return null;
}

// ------------------------------------------------------------------------------------------- the hand and transfers (I §3.2, §3.8)

/**
 * Q (I §3.2): a ghost cursor clears; a stack goes back to its origin slot first (merging), the rest into the
 * main inventory. Model decision: what does not fit stays in the hand, with "Inventory full".
 */
function clearCursor(w: World, p: Player): Refusal | null {
  if (p.hand.ghost) {
    p.hand = emptyHand();
    return null;
  }
  if (p.hand.count === 0) return null;
  const key = p.hand.key;
  const origin = handOrigin(p);
  let left = p.hand.count;
  if (origin >= 0) {
    const s = w.heap.slot(p.main, origin);
    if (s.count === 0 || s.key === key) {
      const k = Math.min(left, stackSize(w, key) - s.count);
      s.key = key;
      s.count += k;
      left -= k;
    }
  }
  p.hand = { key, ghost: false, origin: NONE16, count: left };
  left -= insert(w, mainInv(w, p), key, left);
  p.hand = left > 0 ? { key, ghost: false, origin: NONE16, count: left } : emptyHand();
  sortMain(w, p);
  return left > 0 ? fail(FailReason.inventory_full) : null;
}

/** LMB (`split` false) and RMB (`split` true) on a slot (I §3.8's table). */
function cursorTransfer(w: World, p: Player, at: InvSlot, split: boolean): Refusal | null {
  const r = resolveSlot(w, p, at);
  if (isRefusal(r)) return r;
  const { inv, index } = r;
  const isMain = inv.ref === p.main;
  const s = w.heap.slot(inv.ref, index);
  if (p.hand.count === 0) {
    // An empty hand (a ghost cursor counts as empty and is replaced): pick up all, or half rounded up.
    if (s.count === 0) return null; // Model decision: nothing to pick up does nothing, without an event
    const take = split ? Math.ceil(s.count / 2) : s.count;
    p.hand = { key: s.key, ghost: false, origin: isMain ? index : NONE16, count: take };
    s.count -= take;
    if (s.count === 0) clear(s);
    if (isMain) sortMain(w, p);
    return null;
  }
  // The hand holds a stack of X.
  if (index >= inv.bar) return fail(FailReason.cannot_insert, r.owner ? entityPos(r.owner) : undefined);
  const x = p.hand.key;
  const stack = stackSize(w, x);
  if (split) {
    // RMB: one X into an empty slot or a slot of X with room; anything else does nothing.
    if (s.count === 0 || (s.key === x && s.count < stack)) {
      s.key = x;
      s.count += 1;
      p.hand.count -= 1;
      if (p.hand.count === 0) p.hand = emptyHand();
    }
  } else if (s.count === 0) {
    s.key = x;
    s.count = p.hand.count;
    p.hand = emptyHand();
  } else if (s.key === x) {
    const k = Math.min(p.hand.count, stack - s.count);
    s.count += k;
    p.hand.count -= k;
    if (p.hand.count === 0) p.hand = emptyHand();
  } else {
    // A different item: swap (I §3.8). The hand's new stack remembers this slot if it is in the main inventory.
    const y = { key: s.key, count: s.count };
    s.key = x;
    s.count = p.hand.count;
    p.hand = { key: y.key, ghost: false, origin: isMain ? index : NONE16, count: y.count };
  }
  return null;
}

/** Shift+LMB / Shift+RMB: a stack, or half of it rounded up, to the other inventory. */
function stackTransfer(w: World, p: Player, from: InvSlot, to: EntityRef, split: boolean): Refusal | null {
  const src = resolveSlot(w, p, from);
  if (isRefusal(src)) return src;
  const dst = resolveOther(w, p, to);
  if (isRefusal(dst)) return dst;
  if (src.inv.ref === dst.inv.ref) return fail(FailReason.invalid_index); // the same inventory: no "other" one
  const s = w.heap.slot(src.inv.ref, src.index);
  if (s.count === 0) return fail(FailReason.nothing_to_transfer);
  const n = split ? Math.ceil(s.count / 2) : s.count;
  const moved = insert(w, dst.inv, s.key, n);
  if (moved === 0) return fail(FailReason.inventory_full, dst.owner ? entityPos(dst.owner) : undefined);
  s.count -= moved;
  if (s.count === 0) clear(s);
  sortMain(w, p);
  return null;
}

/** Ctrl+LMB / Ctrl+RMB: every stack of the slot's item, or of everything on an empty slot; or half, rounded up. */
function inventoryTransfer(
  w: World,
  p: Player,
  from: InvSlot,
  to: EntityRef,
  split: boolean,
): Refusal | null {
  const src = resolveSlot(w, p, from);
  if (isRefusal(src)) return src;
  const dst = resolveOther(w, p, to);
  if (isRefusal(dst)) return dst;
  if (src.inv.ref === dst.inv.ref) return fail(FailReason.invalid_index);
  const s = w.heap.slot(src.inv.ref, src.index);
  const which = s.count > 0 ? [s.key] : keys(w, src.inv);
  if (which.length === 0) return fail(FailReason.nothing_to_transfer);
  let moved = 0;
  for (const k of which) {
    const total = count(w, src.inv, k);
    const n = insert(w, dst.inv, k, split ? Math.ceil(total / 2) : total);
    remove(w, src.inv, k, n);
    moved += n;
  }
  sortMain(w, p);
  return moved === 0 ? fail(FailReason.inventory_full, dst.owner ? entityPos(dst.owner) : undefined) : null;
}

/** Ctrl+click on an entity in the world (I §3.8 "Fast transfer"), with its flying text per item. */
function fastTransfer(ctx: Ctx, p: Player, seq: number, target: EntityRef, split: boolean): Refusal | null {
  const { w } = ctx;
  const e = resolve(w, p, target);
  if (!e) return fail(FailReason.target_gone);
  if (!inReach(p, w.collisionBox(e), reachOf(w))) return fail(FailReason.out_of_reach, entityPos(e));
  const chest = chestInv(w, e);
  const text = (key: number, n: number): void =>
    emit(ctx, seq, p.index, {
      type: 'flying_text',
      text: FlyingText.item_delta,
      item: key,
      count: n,
      total: count(w, mainInv(w, p), key),
      pos: entityPos(e),
    });
  if (p.hand.count > 0) {
    const key = p.hand.key;
    const moved = insert(w, chest, key, split ? Math.ceil(p.hand.count / 2) : p.hand.count);
    if (moved === 0) return fail(FailReason.inventory_full, entityPos(e));
    p.hand.count -= moved;
    if (p.hand.count === 0) p.hand = emptyHand();
    text(key, -moved);
    return null;
  }
  const which = keys(w, chest);
  if (which.length === 0) return fail(FailReason.nothing_to_transfer, entityPos(e));
  const main = mainInv(w, p);
  const moved: [number, number][] = [];
  for (const k of which) {
    const total = count(w, chest, k);
    const n = insert(w, main, k, split ? Math.ceil(total / 2) : total);
    remove(w, chest, k, n);
    if (n > 0) moved.push([k, n]);
  }
  sortMain(w, p);
  if (moved.length === 0) return fail(FailReason.inventory_full, entityPos(e));
  for (const [k, n] of moved) text(k, n);
  return null;
}

function setInventoryBar(w: World, p: Player, target: EntityRef, inv: number, bar: number): Refusal | null {
  const e = resolve(w, p, target);
  if (!e) return fail(FailReason.target_gone);
  if (!inReach(p, w.collisionBox(e), reachOf(w))) return fail(FailReason.out_of_reach, entityPos(e));
  if (inv !== InventoryType.chest) return fail(FailReason.invalid_index, entityPos(e));
  const chest = chestInv(w, e);
  if (bar > chest.size) return fail(FailReason.invalid_index, entityPos(e));
  w.heap.setBar(chest.ref, bar, chest.size);
  return null;
}

// ------------------------------------------------------------------------------------------- hand crafting (§5.1, I §3.9)

/**
 * Queues a hand craft. M0's one recipe has no hand-craftable intermediate, so chain crafting (I §3.9 steps 1–3)
 * reduces to direct crafting: ingredients come from the main inventory (model decision: not from the hand)
 * and leave it at enqueue time. Model decision: `count` above what can be crafted queues what can (Factorio's
 * begin_crafting), and only none at all is "Not enough ingredients".
 */
function craft(w: World, p: Player, recipe: number, want: number): Refusal | null {
  const r = w.protos.recipe[recipe];
  if (!r) return fail(FailReason.invalid_index);
  if (!r.enabled_at_start) return fail(FailReason.recipe_locked); // M0 researches nothing
  if (!r.handcraft || r.ingredients.some((i) => i.kind !== 0)) return fail(FailReason.cannot_handcraft);
  const main = mainInv(w, p);
  let can = Number.MAX_SAFE_INTEGER;
  for (const ing of r.ingredients) {
    const have = count(w, main, ing.id * 8);
    const k = Math.floor(have / ing.amount);
    if (k < can) can = k;
  }
  let n = want === 0 ? can : want < can ? want : can;
  if (n > 0xffff) n = 0xffff; // one queue entry's count is a u16
  if (n === 0) return fail(FailReason.not_enough_ingredients);
  const last = p.crafting_queue[p.crafting_queue.length - 1];
  const merge = last !== undefined && last.recipe === recipe && last.flags === 0 && last.count + n <= 0xffff;
  if (!merge && p.crafting_queue.length >= 256) return fail(FailReason.invalid_index);
  for (const ing of r.ingredients) remove(w, main, ing.id * 8, n * ing.amount);
  sortMain(w, p);
  // Consecutive clicks on the same recipe merge into one entry (I §3.9).
  if (merge) (last as CraftEntry).count += n;
  else p.crafting_queue.push({ recipe, count: n, flags: 0, parent: NONE16, progress: 0 });
  return null;
}

/** Cancels units of a queue entry and refunds their ingredients. Model decision: refused when they do not fit. */
function cancelCraft(w: World, p: Player, index: number, want: number): Refusal | null {
  const e = p.crafting_queue[index];
  if (!e) return fail(FailReason.invalid_index);
  const r = w.protos.recipe[e.recipe];
  if (!r) throw new Error('a queued recipe that does not exist');
  const m = want === 0 || want > e.count ? e.count : want;
  const refund = r.ingredients.map((i) => ({ key: i.id * 8, n: m * i.amount }));
  if (!fitsAll(w, p, refund)) return fail(FailReason.inventory_full);
  const main = mainInv(w, p);
  for (const x of refund) insert(w, main, x.key, x.n);
  sortMain(w, p);
  e.count -= m;
  if (e.count === 0) p.crafting_queue.splice(index, 1);
  return null;
}

/** One tick of the head of a character's crafting queue (I §3.9). */
function craftTick(ctx: Ctx, p: Player): void {
  const { w } = ctx;
  const e = p.crafting_queue[0];
  if (!e) return;
  const r = w.protos.recipe[e.recipe];
  if (!r) throw new Error('a queued recipe that does not exist');
  const speed = (w.protos.entity[w.protos.character] as { crafting_speed: number }).crafting_speed;
  // Bit-exact: speed / (energy_required × 60), in this order (no bonuses in M0).
  const rate = speed / (r.energy_required * 60);
  if (e.progress < UNIT_DONE) e.progress += rate;
  if (e.progress < UNIT_DONE) return;
  const products = r.products.map((x) => ({ key: x.id * 8, n: x.amount }));
  // Crafting pauses while the product cannot fit (I §3.9, 0.15); model decision: silently.
  if (!fitsAll(w, p, products)) return;
  const before = fingerprint(w, p);
  const main = mainInv(w, p);
  for (const x of products) insert(w, main, x.key, x.n);
  sortMain(w, p);
  for (const x of products) {
    add(ctx.counters.produced, itemStat(x.key), x.n);
    add(ctx.counters.handcrafted, itemStat(x.key), x.n);
    p.hand_crafted += x.n;
  }
  for (const i of r.ingredients) add(ctx.counters.consumed, itemStat(i.id * 8), i.amount);
  // Model decision: one item_crafted per completed craft (count 1), then a flying text per product.
  emit(ctx, 0, p.index, { type: 'item_crafted', recipe: e.recipe, count: 1 });
  for (const x of products)
    emit(ctx, 0, p.index, {
      type: 'flying_text',
      text: FlyingText.item_delta,
      item: x.key,
      count: x.n,
      total: count(w, main, x.key),
      pos: finePos(p.x, p.y),
    });
  if (fingerprint(w, p) !== before) p.inventory_version = (p.inventory_version + 1) >>> 0;
  e.count -= 1;
  e.progress = e.progress - 1 < 0 ? 0 : e.progress - 1;
  if (e.count === 0) p.crafting_queue.shift();
}

// ------------------------------------------------------------------------------------------- walking (§5.1)

/**
 * One tick of walking: 0.15 tiles per tick × the walking speed of the tile under the character (§5.1, tiles
 * `walking_speed`), in 8 directions with the speed along the direction (diagonals √½ per axis). Model
 * decision on collision: the whole step, else (diagonals only) its x part, else its y part, else none; no
 * movement up to contact.
 */
function walkTick(ctx: Ctx, p: Player): void {
  const { w } = ctx;
  if (!p.walking) {
    ctx.pres.lastMove.set(p.index, { dx: 0, dy: 0 });
    return;
  }
  const ch = w.protos.entity[w.protos.character] as { running_speed: number };
  const t = w.tileAt(Math.floor(p.x), Math.floor(p.y));
  const tileSpeed = t === null ? 0 : (w.protos.tile[t] as { walking_speed: number }).walking_speed;
  const speed = ch.running_speed * tileSpeed;
  const [ux, uy] = WALK[p.walking_dir >> 1] as readonly [number, number];
  const dx = speed * ux;
  const dy = speed * uy;
  let mx = 0;
  let my = 0;
  if (!blocked(w, p.x + dx, p.y + dy)) {
    mx = dx;
    my = dy;
  } else if (dx !== 0 && dy !== 0) {
    if (!blocked(w, p.x + dx, p.y)) mx = dx;
    else if (!blocked(w, p.x, p.y + dy)) my = dy;
  }
  p.x += mx;
  p.y += my;
  ctx.pres.lastMove.set(p.index, { dx: mx, dy: my });
}

/**
 * Advances every character after the closure's actions, in ascending player index: walking, then mining,
 * then crafting. Model decision: §4.6 lists no phase for characters, so they run at the end of phase 1, and
 * an action applied in tick t takes effect in tick t (R23: a release at tick t stops the character at t).
 * Offline characters neither walk, mine nor craft (§5.1).
 */
export function charactersTick(ctx: Ctx): void {
  for (const p of [...ctx.w.players].sort((a, b) => a.index - b.index)) {
    if (!p.online || p.character === 0) {
      ctx.pres.lastMove.set(p.index, { dx: 0, dy: 0 });
      continue;
    }
    walkTick(ctx, p);
    const before = fingerprint(ctx.w, p);
    mineTick(ctx, p);
    sortMain(ctx.w, p);
    if (fingerprint(ctx.w, p) !== before) p.inventory_version = (p.inventory_version + 1) >>> 0;
    craftTick(ctx, p);
  }
}

// ------------------------------------------------------------------------------------------- system actions (§15.3)

/** Stops walking, mining and picking and raises the input generation (D22): release_inputs and player_left. */
function release(p: Player): void {
  p.walking = false;
  stopMining(p);
  p.picking = false;
  p.input_gen = (p.input_gen + 1) & 0xffff;
}

function applySystem(ctx: Ctx, act: Action): void {
  const { w } = ctx;
  switch (act.type) {
    case 'player_joined': {
      const p = w.player(act.player);
      if (p) {
        // A returning player gets the same character back (11 §4.5); joining while online changes nothing.
        if (p.online) return;
        p.online = true;
      } else w.players = [...w.players, newPlayer(w, act.player)].sort((a, b) => a.index - b.index);
      emit(ctx, 0, act.player, { type: 'player_joined' });
      return;
    }
    case 'player_left': {
      const p = w.player(act.player);
      if (!p) return; // model decision: a player without state has nothing to release
      release(p);
      if (!p.online) return;
      p.online = false;
      // The hand returns to the main inventory if it fits (§5.1); model decision: all of it or none.
      if (p.hand.ghost) p.hand = emptyHand();
      else if (p.hand.count > 0) {
        const before = fingerprint(w, p);
        const key = p.hand.key;
        const n = p.hand.count;
        const origin = handOrigin(p);
        const free = { ...mainInv(w, p), origin: -1 };
        if (room(w, free, key, n) === n) {
          p.hand = emptyHand();
          // As Q does: the origin slot first, then the rest (I §3.2).
          let left = n;
          if (origin >= 0) {
            const s = w.heap.slot(p.main, origin);
            if (s.count === 0 || s.key === key) {
              const k = Math.min(left, stackSize(w, key) - s.count);
              s.key = key;
              s.count += k;
              left -= k;
            }
          }
          insert(w, mainInv(w, p), key, left);
          sortMain(w, p);
        }
        if (fingerprint(w, p) !== before) p.inventory_version = (p.inventory_version + 1) >>> 0;
      }
      emit(ctx, 0, act.player, { type: 'player_left' });
      return;
    }
    case 'release_inputs': {
      const p = w.player(act.player);
      if (p) release(p);
      return;
    }
    case 'snapshot_marker':
    case 'debug_dump':
      return; // nothing in the World (§15.3)
    default:
      throw new Error(`no rule for system action ${act.type}`);
  }
}

/**
 * A new player (§15.3 `player_joined`, §5.1): a character with a fresh serial at the spawn point, an empty
 * hand and the start inventory (meta.start.inventory). Model decisions: the spawn point is (0, 0) and is not
 * searched for a free position in M0; every new player gets the start inventory.
 */
function newPlayer(w: World, index: number): Player {
  const p: Player = {
    index,
    online: true,
    character: w.nextSerial(),
    input_gen: 0,
    last_seq: 0,
    creation_ring: [],
    inventory_version: 0,
    main: w.heap.alloc(w.mainSize()),
    hand: emptyHand(),
    surface: SURFACE,
    x: 0,
    y: 0,
    walking: false,
    walking_dir: NEW_CHARACTER_DIR,
    mining: { mode: MiningMode.none, serial: 0, pos: { x: 0, y: 0 }, progress: 0 },
    picking: false,
    crafting_queue: [],
    auto_sort: true,
    pick_ghost_cursor: false,
    hand_crafted: 0,
    last_action_tick: 0,
  };
  for (const s of w.protos.startInventory) insert(w, mainInv(w, p), s.item * 8, s.count);
  sortMain(w, p);
  return p;
}

/** Re-exported for the start save: the same construction as `player_joined`. */
export { newPlayer };
