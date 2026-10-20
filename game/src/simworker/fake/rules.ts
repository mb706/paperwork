// The fake sim's M0 rules (10 §5.1–§5.2, §15.3; I §3.1–§3.9): every action of M0's capability manifest is
// live, with the golden set's reference model (test/golden/model/rules.ts) as the authority: the same checks
// in the same order, the same refusal reasons, positions and serials, the same events and flying texts. The
// fake simplifies only what M0 cannot observe (no map edge, puppet players walk through buildings).
//
// GATE-r1's settled rules (Factorio 2.0.77, tested; README rules 16, 19, 23, 25): a click puts items into
// any slot, past the limit bar; bulk transfers stop at the bar; transfers and hand mining move what fits and
// say what did not with a flying text ("Cannot insert X. Inventory is full.", "Cannot put away the X. Player
// inventory is full."), never with a refusal; an `action_failed` is only a refusal, which changes nothing.
import type { Action } from '../../shared/gen/actions.ts';
import type { EntityRef, FinePos, InvSlot } from '../../shared/gen/types.ts';
import {
  BuildMode,
  EntityRefTag,
  FailReason,
  FlyingText,
  GameSetting,
  InventoryType,
  MiningTarget,
  PlayerSetting,
} from '../../shared/gen/types.ts';
import {
  clear,
  count,
  fitsAll,
  type Inv,
  insert,
  keys,
  NO_ITEM,
  remove,
  room,
  type Slot,
  sortSlots,
} from './inventory.ts';
import { type Char, type Ent, type FakeWorld, toChunk } from './world.ts';

/** A unit of hand mining or crafting completes at 1 − 10⁻⁹ (the model's UNIT_DONE). */
const UNIT_DONE = 1 - 1e-9;

/** A refusal: an `action_failed` reason, where it happened (default: the character) and a serial. */
export interface Refusal {
  reason: number;
  pos?: FinePos;
  serial?: number;
}

const fail = (reason: number, pos?: FinePos, serial = 0): Refusal =>
  pos === undefined ? { reason, serial } : { reason, pos, serial };

const isRefusal = (x: object): x is Refusal => 'reason' in x;

/** A position in 1/256 tile: floor(v × 256 + 0.5). */
export const fine = (v: number): number => Math.floor(v * 256 + 0.5);
const finePos = (x: number, y: number): FinePos => ({ x: fine(x), y: fine(y) });
const entityPos = (e: Ent): FinePos => ({ x: e.x2 * 128, y: e.y2 * 128 });

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function dist2(px: number, py: number, b: Box): number {
  const dx = px < b.x0 ? b.x0 - px : px > b.x1 ? px - b.x1 : 0;
  const dy = py < b.y0 ? b.y0 - py : py > b.y1 ? py - b.y1 : 0;
  return dx * dx + dy * dy;
}

export const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** An entity's collision box around a centre in doubled tiles, turned for east and west. */
export function protoBox(w: FakeWorld, proto: number, x2: number, y2: number, dir: number): Box {
  const b = w.p.json.entity[proto]?.collisionBox ?? [-0.4, -0.4, 0.4, 0.4];
  const turned = dir === 4 || dir === 12;
  const [x0, y0, x1, y1] = (turned ? [b[1], b[0], b[3], b[2]] : b) as [number, number, number, number];
  return { x0: x2 / 2 + x0, y0: y2 / 2 + y0, x1: x2 / 2 + x1, y1: y2 / 2 + y1 };
}

export const entityBox = (w: FakeWorld, e: Ent): Box => protoBox(w, e.proto, e.x2, e.y2, e.dir);

export function characterBox(w: FakeWorld, x: number, y: number): Box {
  const [x0, y0, x1, y1] = w.p.char.box;
  return { x0: x + x0, y0: y + y0, x1: x + x1, y1: y + y1 };
}

const tileBox = (tx: number, ty: number): Box => ({ x0: tx, y0: ty, x1: tx + 1, y1: ty + 1 });

const inReach = (c: Char, box: Box, reach: number): boolean => dist2(c.x, c.y, box) <= reach * reach;

// ------------------------------------------------------------------------------------------ inventories

/** The hand's origin slot while it holds a stack picked from the main inventory, else −1. */
export function handOrigin(c: Char): number {
  return c.hand.count > 0 && !c.hand.ghost && c.hand.origin !== NO_ITEM ? c.hand.origin : -1;
}

export function mainInv(c: Char): Inv {
  return { slots: c.main, bar: c.main.length, origin: handOrigin(c) };
}

/** A chest's inventory (not a ghost's: ghosts hold nothing). */
export function chestInv(e: Ent): Inv | null {
  return e.role === 'chest' && (e.flags & 1) === 0 ? { slots: e.inv, bar: e.bar, origin: -1 } : null;
}

export const emptyHand = (): Char['hand'] => ({ key: NO_ITEM, count: 0, origin: NO_ITEM, ghost: false });

/** Auto-sort at a step boundary (I §3.8, D11), when the player's setting is on. */
export function sortMain(w: FakeWorld, c: Char): void {
  if (c.autoSort) sortSlots(mainInv(c), (k) => w.p.stack(k));
}

// ------------------------------------------------------------------------------------------ references

/** Tag 1 by serial, tag 2 by the acting player's creation ring; never by position (§15.3, D23). */
export function resolve(w: FakeWorld, c: Char, ref: EntityRef): Ent | null {
  if (ref.tag === EntityRefTag.serial) return w.entityBySerial(ref.a);
  if (ref.tag === EntityRefTag.creation) {
    const k = c.creation.find((x) => x.seq === ref.a);
    if (!k || ref.b >= 1) return null;
    return w.entityBySerial(k.serial + ref.b);
  }
  return null;
}

function resolveSlot(
  w: FakeWorld,
  c: Char,
  s: InvSlot,
): { inv: Inv; owner: Ent | null; index: number } | Refusal {
  let inv: Inv;
  let owner: Ent | null = null;
  if (s.owner.tag === EntityRefTag.none) {
    if (s.inv !== InventoryType.main) return fail(FailReason.invalid_index);
    inv = mainInv(c);
  } else {
    owner = resolve(w, c, s.owner);
    if (!owner) return fail(FailReason.target_gone);
    if (!inReach(c, entityBox(w, owner), w.p.char.reach))
      return fail(FailReason.out_of_reach, entityPos(owner));
    const chest = chestInv(owner);
    if (s.inv !== InventoryType.chest || !chest) return fail(FailReason.invalid_index, entityPos(owner));
    inv = chest;
  }
  if (s.slot >= inv.slots.length) return fail(FailReason.invalid_index, owner ? entityPos(owner) : undefined);
  return { inv, owner, index: s.slot };
}

function resolveOther(w: FakeWorld, c: Char, ref: EntityRef): { inv: Inv; owner: Ent | null } | Refusal {
  if (ref.tag === EntityRefTag.none) return { inv: mainInv(c), owner: null };
  const e = resolve(w, c, ref);
  if (!e) return fail(FailReason.target_gone);
  if (!inReach(c, entityBox(w, e), w.p.char.reach)) return fail(FailReason.out_of_reach, entityPos(e));
  const chest = chestInv(e);
  if (!chest) return fail(FailReason.invalid_index, entityPos(e));
  return { inv: chest, owner: e };
}

/**
 * "Cannot insert Iron plate. Inventory is full." (2.0.77): what did not fit the player's inventory, as a flying
 * text at the character (count: how many did not fit, total −1), never a refusal: the step did what it could.
 */
function notFitting(w: FakeWorld, c: Char, seq: number, key: number, n: number): void {
  w.emit(
    { seq, player: c.player },
    {
      type: 'flying_text',
      text: FlyingText.inventory_full,
      item: key,
      count: n,
      total: -1,
      pos: finePos(c.x, c.y),
    },
  );
}

// ------------------------------------------------------------------------------------------ actions

/**
 * Applies one decoded action of a player (phase 1, §4.6). The caller has already consumed the seq and refused
 * malformed and unsupported actions; null means it applied.
 */
export function applyAction(w: FakeWorld, c: Char, seq: number, a: Action): Refusal | null {
  switch (a.type) {
    case 'start_walking':
      c.walking = true;
      c.dir = a.dir;
      return null;
    case 'stop_walking':
      c.walking = false;
      return null;
    case 'begin_mining':
      return beginMining(w, c, a.target);
    case 'begin_mining_terrain':
      return beginMiningTerrain(w, c, a.kind, a.pos);
    case 'stop_mining':
      c.mining = null;
      c.miningProgress = 0;
      return null;
    case 'build':
      return build(w, c, seq, a);
    case 'clear_cursor':
      return clearCursor(w, c, seq);
    case 'cursor_transfer':
      return cursorTransfer(w, c, a.slot, false);
    case 'cursor_split':
      return cursorTransfer(w, c, a.slot, true);
    case 'stack_transfer':
      return stackTransfer(w, c, seq, a.from, a.to, false);
    case 'stack_split':
      return stackTransfer(w, c, seq, a.from, a.to, true);
    case 'inventory_transfer':
      return inventoryTransfer(w, c, seq, a.from, a.to, false);
    case 'inventory_split':
      return inventoryTransfer(w, c, seq, a.from, a.to, true);
    case 'fast_entity_transfer':
      return fastTransfer(w, c, seq, a.target, false);
    case 'fast_entity_split':
      return fastTransfer(w, c, seq, a.target, true);
    case 'set_inventory_bar':
      return setInventoryBar(w, c, a.target, a.inv, a.bar);
    case 'craft':
      return craft(w, c, a.recipe, a.count);
    case 'cancel_craft':
      return cancelCraft(w, c, a.index, a.count);
    case 'set_player_setting':
      if (a.value > 1) return fail(FailReason.invalid_setting);
      if (a.setting === PlayerSetting.auto_sort_inventory) {
        c.autoSort = a.value === 1;
        sortMain(w, c);
      } else if (a.setting === PlayerSetting.pick_ghost_cursor) c.pickGhost = a.value === 1;
      return null;
    case 'set_game_setting':
      if (a.value > 1) return fail(FailReason.invalid_setting);
      if (a.setting === GameSetting.trimmed_collision) w.trimmedCollision = a.value === 1;
      return null;
    default:
      // System actions never come through `act`, and every other action is outside M0's manifest.
      return fail(FailReason.unsupported);
  }
}

// ------------------------------------------------------------------------------------------ mining

function beginMining(w: FakeWorld, c: Char, target: EntityRef): Refusal | null {
  const e = resolve(w, c, target);
  if (!e) return fail(FailReason.target_gone);
  // Ghosts are not M0's; an entity marked for deconstruction can still be mined by hand (I §3.7).
  if (!(w.p.miningTime(e.proto) > 0) || (e.flags & 1) !== 0)
    return fail(FailReason.not_minable, entityPos(e));
  if (!inReach(c, entityBox(w, e), w.p.char.reach)) return fail(FailReason.out_of_reach, entityPos(e));
  const same = c.mining?.kind === 'entity' && c.mining.serial === e.serial;
  c.mining = { kind: 'entity', serial: e.serial };
  if (!same) c.miningProgress = 0;
  return null;
}

/** The resource at a tile, if any. */
function resourceAt(w: FakeWorld, tx: number, ty: number) {
  const ch = w.chunk(toChunk(tx), toChunk(ty));
  return ch.resources.find((r) => r.tile === (ty - ch.cy * 32) * 32 + (tx - ch.cx * 32)) ?? null;
}

function beginMiningTerrain(w: FakeWorld, c: Char, kind: number, pos: FinePos): Refusal | null {
  const tx = Math.floor(pos.x / 256);
  const ty = Math.floor(pos.y / 256);
  if (kind === MiningTarget.resource_tile) {
    const r = resourceAt(w, tx, ty);
    if (!r) return fail(FailReason.nothing_to_mine, pos);
    if (!w.p.resource(r.resource)) return fail(FailReason.not_minable, pos);
    if (!inReach(c, tileBox(tx, ty), w.p.char.resourceReach)) return fail(FailReason.out_of_reach, pos);
    const same = c.mining?.kind === 'tile' && c.mining.tx === tx && c.mining.ty === ty;
    c.mining = { kind: 'tile', tx, ty, pos: { x: pos.x, y: pos.y } };
    if (!same) c.miningProgress = 0;
    return null;
  }
  if (kind === MiningTarget.tile) return fail(FailReason.not_minable, pos); // M0 places no tiles
  // World objects and ground items are not M0's (its manifest has neither).
  return fail(FailReason.nothing_to_mine, pos);
}

/** The band of a resource amount (§15.4): Factorio's ore stages, 0 the richest. */
export function band(amount: number): number {
  const stages = [15000, 9500, 5500, 2900, 1300, 400, 150];
  for (let i = 0; i < stages.length; i++) if (amount >= (stages[i] as number)) return i;
  return 7;
}

/** A flying text per item key, ascending, at the character, with the main inventory's new total. */
function flyingTexts(w: FakeWorld, c: Char, merged: ReadonlyMap<number, number>): void {
  for (const k of [...merged.keys()].sort((a, b) => a - b))
    w.emit(
      { seq: 0, player: c.player },
      {
        type: 'flying_text',
        text: FlyingText.item_delta,
        item: k,
        count: merged.get(k) as number,
        total: count(mainInv(c), k),
        pos: finePos(c.x, c.y),
      },
    );
}

/**
 * A completed unit of mining an entity (I §3.7; rule 23): its contents move first, its first slots first, as far
 * as they fit, with an item_delta text per moved key; the entity goes, with its own item, only when everything
 * moved and its item fits (`entity_mined`). Otherwise it stays and "Cannot insert …" names the first item that
 * did not fit (its own item if only that). Returns whether the entity was mined.
 */
export function finishEntityMining(w: FakeWorld, c: Char, target: Ent): boolean {
  const main = mainInv(c);
  const moved = new Map<number, number>();
  let short: { key: number; n: number } | null = null;
  const chest = chestInv(target);
  if (chest)
    for (const s of chest.slots) {
      if (s.count === 0) continue;
      const key = s.key;
      const n = insert(main, key, s.count, w.p.stack(key));
      if (n > 0) moved.set(key, (moved.get(key) ?? 0) + n);
      s.count -= n;
      if (s.count === 0) clear(s);
      else if (!short) short = { key, n: s.count };
    }
  const item = w.p.json.entity[target.proto]?.item;
  const itemKey = item === null || item === undefined ? null : item * 8;
  if (!short && (itemKey === null || room(mainInv(c), itemKey, 1, w.p.stack(itemKey)) === 1)) {
    if (itemKey !== null) {
      insert(mainInv(c), itemKey, 1, w.p.stack(itemKey));
      moved.set(itemKey, (moved.get(itemKey) ?? 0) + 1);
    }
    sortMain(w, c);
    w.emit(
      { seq: 0, player: c.player },
      {
        type: 'entity_mined',
        serial: target.serial,
        proto: target.proto,
        pos: { x2: target.x2, y2: target.y2 },
      },
    );
    w.removeEntity(target);
    flyingTexts(w, c, moved);
    return true;
  }
  sortMain(w, c);
  flyingTexts(w, c, moved);
  const missing = short ?? { key: itemKey as number, n: 1 };
  notFitting(w, c, 0, missing.key, missing.n);
  return false;
}

/** One tick of hand mining (§5.1): progress = mining speed ÷ (mining time × 60). */
function mineTick(w: FakeWorld, c: Char): void {
  const m = c.mining;
  if (!m) return;
  let time: number;
  let target: Ent | null = null;
  let res: ReturnType<typeof resourceAt> = null;
  if (m.kind === 'entity') {
    target = w.entityBySerial(m.serial);
    if (!target || !inReach(c, entityBox(w, target), w.p.char.reach)) {
      c.mining = null;
      c.miningProgress = 0;
      return;
    }
    time = w.p.miningTime(target.proto);
  } else {
    res = resourceAt(w, m.tx, m.ty);
    const r = res ? w.p.resource(res.resource) : null;
    if (!res || !r || !inReach(c, tileBox(m.tx, m.ty), w.p.char.resourceReach)) {
      c.mining = null;
      c.miningProgress = 0;
      return;
    }
    time = r.miningTime;
  }
  const rate = w.p.char.miningSpeed / (time * 60);
  if (c.miningProgress < UNIT_DONE) c.miningProgress += rate;
  if (c.miningProgress < UNIT_DONE) return;

  // A unit that cannot deliver its result restarts, and mining goes on while the input is held (rule 23;
  // 2.0.67: nothing drops; 2.0.77: nothing is removed, "Cannot insert Iron ore. Inventory is full.").
  const restart = (): void => {
    c.miningProgress = c.miningProgress - 1 < 0 ? 0 : c.miningProgress - 1;
  };
  if (target) {
    if (finishEntityMining(w, c, target)) {
      c.mining = null;
      c.miningProgress = 0;
    } else restart();
    return;
  }
  if (!res || m.kind !== 'tile') return;
  const key = (w.p.resource(res.resource) as { yieldItem: number }).yieldItem * 8;
  if (room(mainInv(c), key, 1, w.p.stack(key)) < 1) {
    notFitting(w, c, 0, key, 1);
    restart();
    return;
  }
  insert(mainInv(c), key, 1, w.p.stack(key));
  sortMain(w, c);
  const ch = w.chunk(toChunk(m.tx), toChunk(m.ty));
  const before = band(res.amount);
  res.amount -= 1;
  ch.modified = true;
  // Mined ore is production (I §4.12: hand-mined items count).
  w.count(w.produced, key, 1);
  flyingTexts(w, c, new Map([[key, 1]]));
  if (res.amount <= 0) {
    ch.resources = ch.resources.filter((r) => r !== res);
    ch.version.resources++;
    c.mining = null;
    c.miningProgress = 0;
    return;
  }
  if (band(res.amount) !== before) ch.version.resources++;
  c.miningProgress = c.miningProgress - 1 < 0 ? 0 : c.miningProgress - 1;
}

// ------------------------------------------------------------------------------------------ building

function build(w: FakeWorld, c: Char, seq: number, a: Extract<Action, { type: 'build' }>): Refusal | null {
  const where: FinePos = { x: a.pos.x2 * 128, y: a.pos.y2 * 128 };
  if (a.mode !== BuildMode.normal) return fail(FailReason.unsupported, where);
  const proto = c.hand.ghost || c.hand.count === 0 || c.hand.key !== a.item ? null : w.p.places(a.item);
  const ej = proto === null ? undefined : w.p.json.entity[proto];
  if (proto === null || !ej) return fail(FailReason.no_item_in_hand, where);
  const dir = ej.rotatable ? a.dir : 0;
  const turned = dir === 4 || dir === 12;
  const sw = (turned ? ej.size[1] : ej.size[0]) as number;
  const sh = (turned ? ej.size[0] : ej.size[1]) as number;
  if (((a.pos.x2 & 1) === 1) !== (sw % 2 === 1) || ((a.pos.y2 & 1) === 1) !== (sh % 2 === 1))
    return fail(FailReason.malformed, where);
  const box = protoBox(w, proto, a.pos.x2, a.pos.y2, dir);
  if (!inReach(c, box, w.p.char.build)) return fail(FailReason.out_of_reach, where);
  const tx0 = a.pos.x2 / 2 - sw / 2;
  const ty0 = a.pos.y2 / 2 - sh / 2;
  // The fake's map has no edge (M0's out_of_map needs a bounded map); tiles must be buildable.
  for (let tx = tx0; tx < tx0 + sw; tx++)
    for (let ty = ty0; ty < ty0 + sh; ty++)
      if (!w.p.buildable(w.tileAt(tx, ty))) return fail(FailReason.cannot_build_on_tile, where);
  const inWay = w.entities
    .filter((e) => overlaps(box, entityBox(w, e)))
    .sort((x, y) => x.serial - y.serial)[0];
  if (inWay) return fail(FailReason.entity_in_the_way, where, inWay.serial);
  const chars = w.chars
    .filter((q) => overlaps(box, characterBox(w, q.x, q.y)))
    .sort((x, y) => x.serial - y.serial);
  if (chars.length > 0) return fail(FailReason.entity_in_the_way, where, (chars[0] as Char).serial);

  const e = w.addBuilt(proto, a.pos.x2, a.pos.y2, dir);
  c.creation.push({ seq, serial: e.serial });
  if (c.creation.length > 256) c.creation.shift();
  // The hand loses the item; auto-replenish from the main inventory (I §3.2), else a ghost cursor or empty.
  c.hand.count -= 1;
  if (c.hand.count === 0) {
    const from = c.main.findIndex((s) => s.key === a.item && s.count > 0);
    if (from >= 0) {
      const s = c.main[from] as Slot;
      c.hand = { key: s.key, count: s.count, origin: from, ghost: false };
      clear(s);
    } else if (c.pickGhost) c.hand = { key: a.item, count: 0, origin: NO_ITEM, ghost: true };
    else c.hand = emptyHand();
    sortMain(w, c);
  }
  w.emit(
    { seq, player: c.player },
    {
      type: 'entity_built',
      serial: e.serial,
      proto: e.proto,
      dir: e.dir,
      flags: 0,
      pos: { x2: e.x2, y2: e.y2 },
    },
  );
  return null;
}

// ------------------------------------------------------------------------------------------ the hand and transfers

/**
 * Q (I §3.2): a ghost cursor clears; a stack goes back to its origin slot first (merging), the rest into the main
 * inventory. What does not fit stays in the hand with "Cannot put away the X. Player inventory is full." (rule 19);
 * never a refusal. A stack picked from the main inventory always fits: its origin slot is reserved.
 */
function clearCursor(w: FakeWorld, c: Char, seq: number): Refusal | null {
  if (c.hand.ghost) {
    c.hand = emptyHand();
    return null;
  }
  if (c.hand.count === 0) return null;
  const key = c.hand.key;
  const stack = w.p.stack(key);
  const origin = handOrigin(c);
  let left = c.hand.count;
  if (origin >= 0) {
    const s = c.main[origin] as Slot;
    if (s.count === 0 || s.key === key) {
      const k = Math.min(left, stack - s.count);
      s.key = key;
      s.count += k;
      left -= k;
    }
  }
  c.hand = { key, count: left, origin: NO_ITEM, ghost: false };
  left -= insert(mainInv(c), key, left, stack);
  c.hand = left > 0 ? { key, count: left, origin: NO_ITEM, ghost: false } : emptyHand();
  sortMain(w, c);
  if (left > 0)
    w.emit(
      { seq, player: c.player },
      {
        type: 'flying_text',
        text: FlyingText.cannot_put_away,
        item: key,
        count: left,
        total: -1,
        pos: finePos(c.x, c.y),
      },
    );
  return null;
}

/** LMB (`split` false) and RMB (`split` true) on a slot (I §3.8's table). */
function cursorTransfer(w: FakeWorld, c: Char, at: InvSlot, split: boolean): Refusal | null {
  const r = resolveSlot(w, c, at);
  if (isRefusal(r)) return r;
  const { inv, index } = r;
  const isMain = r.owner === null;
  const s = inv.slots[index] as Slot;
  if (c.hand.count === 0) {
    if (s.count === 0) return null; // nothing to pick up does nothing
    const take = split ? Math.ceil(s.count / 2) : s.count;
    c.hand = { key: s.key, count: take, origin: isMain ? index : NO_ITEM, ghost: false };
    s.count -= take;
    if (s.count === 0) clear(s);
    if (isMain) sortMain(w, c);
    return null;
  }
  // A click puts items into any slot, past the limit bar too: the bar limits machines and bulk transfers, not
  // the player's hand (rule 16; Factorio 2.0.77).
  const x = c.hand.key;
  const stack = w.p.stack(x);
  if (split) {
    if (s.count === 0 || (s.key === x && s.count < stack)) {
      s.key = x;
      s.count += 1;
      c.hand.count -= 1;
      if (c.hand.count === 0) c.hand = emptyHand();
    }
  } else if (s.count === 0) {
    s.key = x;
    s.count = c.hand.count;
    c.hand = emptyHand();
  } else if (s.key === x) {
    const k = Math.min(c.hand.count, stack - s.count);
    s.count += k;
    c.hand.count -= k;
    if (c.hand.count === 0) c.hand = emptyHand();
  } else {
    // A different item: swap; the hand's new stack remembers this slot if it is in the main inventory.
    const y = { key: s.key, count: s.count };
    s.key = x;
    s.count = c.hand.count;
    c.hand = { key: y.key, count: y.count, origin: isMain ? index : NO_ITEM, ghost: false };
  }
  return null;
}

/**
 * Shift+LMB / Shift+RMB: a stack, or half of it rounded up, to the other inventory (a chest below its bar). What
 * fits moves; into a chest Factorio says nothing, into the player's inventory "Cannot insert …" (rule 19).
 */
function stackTransfer(
  w: FakeWorld,
  c: Char,
  seq: number,
  from: InvSlot,
  to: EntityRef,
  split: boolean,
): Refusal | null {
  const src = resolveSlot(w, c, from);
  if (isRefusal(src)) return src;
  const dst = resolveOther(w, c, to);
  if (isRefusal(dst)) return dst;
  if (src.inv.slots === dst.inv.slots) return fail(FailReason.invalid_index);
  const s = src.inv.slots[src.index] as Slot;
  if (s.count === 0) return fail(FailReason.nothing_to_transfer);
  const n = split ? Math.ceil(s.count / 2) : s.count;
  const key = s.key;
  const moved = insert(dst.inv, key, n, w.p.stack(key));
  s.count -= moved;
  if (s.count === 0) clear(s);
  sortMain(w, c);
  if (moved < n && dst.owner === null) notFitting(w, c, seq, key, n - moved);
  return null;
}

/**
 * Ctrl+LMB / Ctrl+RMB: every stack of the slot's item, or of everything from an empty slot; or half. What fits
 * moves; a message only for the player's inventory, naming the first item that did not all fit (rule 19).
 */
function inventoryTransfer(
  w: FakeWorld,
  c: Char,
  seq: number,
  from: InvSlot,
  to: EntityRef,
  split: boolean,
): Refusal | null {
  const src = resolveSlot(w, c, from);
  if (isRefusal(src)) return src;
  const dst = resolveOther(w, c, to);
  if (isRefusal(dst)) return dst;
  if (src.inv.slots === dst.inv.slots) return fail(FailReason.invalid_index);
  const s = src.inv.slots[src.index] as Slot;
  const which = s.count > 0 ? [s.key] : keys(src.inv);
  if (which.length === 0) return fail(FailReason.nothing_to_transfer);
  let short: { key: number; n: number } | null = null;
  for (const k of which) {
    const total = count(src.inv, k);
    const want = split ? Math.ceil(total / 2) : total;
    const n = insert(dst.inv, k, want, w.p.stack(k));
    remove(src.inv, k, n);
    if (n < want && !short) short = { key: k, n: want - n };
  }
  sortMain(w, c);
  if (short && dst.owner === null) notFitting(w, c, seq, short.key, short.n);
  return null;
}

/**
 * Ctrl+click on an entity in the world (I §3.8 "Fast transfer"), with a flying text per item. Into the chest,
 * below its bar: what fits, and nothing at all (no text) when nothing fits; into the player's inventory: what
 * fits, then "Cannot insert …" for the first item that did not (rule 19).
 */
function fastTransfer(w: FakeWorld, c: Char, seq: number, target: EntityRef, split: boolean): Refusal | null {
  const e = resolve(w, c, target);
  if (!e) return fail(FailReason.target_gone);
  if (!inReach(c, entityBox(w, e), w.p.char.reach)) return fail(FailReason.out_of_reach, entityPos(e));
  const chest = chestInv(e);
  if (!chest) return fail(FailReason.invalid_index, entityPos(e));
  const text = (key: number, n: number): void =>
    w.emit(
      { seq, player: c.player },
      {
        type: 'flying_text',
        text: FlyingText.item_delta,
        item: key,
        count: n,
        total: count(mainInv(c), key),
        pos: entityPos(e),
      },
    );
  if (c.hand.count > 0) {
    const key = c.hand.key;
    const moved = insert(chest, key, split ? Math.ceil(c.hand.count / 2) : c.hand.count, w.p.stack(key));
    if (moved === 0) return null;
    c.hand.count -= moved;
    if (c.hand.count === 0) c.hand = emptyHand();
    text(key, -moved);
    return null;
  }
  const which = keys(chest);
  if (which.length === 0) return fail(FailReason.nothing_to_transfer, entityPos(e));
  const moved: [number, number][] = [];
  let short: { key: number; n: number } | null = null;
  for (const k of which) {
    const total = count(chest, k);
    const want = split ? Math.ceil(total / 2) : total;
    const n = insert(mainInv(c), k, want, w.p.stack(k));
    remove(chest, k, n);
    if (n > 0) moved.push([k, n]);
    if (n < want && !short) short = { key: k, n: want - n };
  }
  sortMain(w, c);
  for (const [k, n] of moved) text(k, n);
  if (short) notFitting(w, c, seq, short.key, short.n);
  return null;
}

function setInventoryBar(w: FakeWorld, c: Char, target: EntityRef, inv: number, bar: number): Refusal | null {
  const e = resolve(w, c, target);
  if (!e) return fail(FailReason.target_gone);
  if (!inReach(c, entityBox(w, e), w.p.char.reach)) return fail(FailReason.out_of_reach, entityPos(e));
  const chest = chestInv(e);
  if (inv !== InventoryType.chest || !chest) return fail(FailReason.invalid_index, entityPos(e));
  if (bar > chest.slots.length) return fail(FailReason.invalid_index, entityPos(e));
  e.bar = bar;
  return null;
}

// ------------------------------------------------------------------------------------------ hand crafting

/**
 * Queues a hand craft (I §3.9): ingredients leave the main inventory at enqueue time. A count above what can be
 * crafted queues what can, without a message (Factorio's begin_crafting); none at all is "Not enough ingredients".
 */
function craft(w: FakeWorld, c: Char, recipe: number, want: number): Refusal | null {
  const r = w.p.json.recipe[recipe];
  if (!r) return fail(FailReason.invalid_index);
  if (!r.enabledAtStart) return fail(FailReason.recipe_locked);
  if (!r.handcraft || r.ingredients.some((i) => i.kind !== 'item')) return fail(FailReason.cannot_handcraft);
  const main = mainInv(c);
  let can = Number.MAX_SAFE_INTEGER;
  for (const ing of r.ingredients) {
    const k = Math.floor(count(main, ing.id * 8) / ing.amount);
    if (k < can) can = k;
  }
  let n = want === 0 ? can : want < can ? want : can;
  if (n > 0xffff) n = 0xffff;
  if (n === 0) return fail(FailReason.not_enough_ingredients);
  const last = c.queue[c.queue.length - 1];
  const merge = last !== undefined && last.recipe === recipe && last.count + n <= 0xffff;
  if (!merge && c.queue.length >= 256) return fail(FailReason.invalid_index);
  for (const ing of r.ingredients) remove(main, ing.id * 8, n * ing.amount);
  sortMain(w, c);
  if (merge) last.count += n;
  else c.queue.push({ recipe, count: n, progress: 0 });
  return null;
}

/**
 * Cancels units of a queue entry and refunds their ingredients. M0 refuses a refund that does not fit ("Inventory
 * full", nothing changes); Factorio spills it on the ground, which needs ground items (M1).
 */
function cancelCraft(w: FakeWorld, c: Char, index: number, want: number): Refusal | null {
  const e = c.queue[index];
  if (!e) return fail(FailReason.invalid_index);
  const r = w.p.json.recipe[e.recipe];
  if (!r) return fail(FailReason.invalid_index);
  const m = want === 0 || want > e.count ? e.count : want;
  const refund = r.ingredients
    .filter((i) => i.kind === 'item')
    .map((i) => ({ key: i.id * 8, n: m * i.amount }));
  if (!fitsAll(mainInv(c), refund, (k) => w.p.stack(k))) return fail(FailReason.inventory_full);
  for (const x of refund) insert(mainInv(c), x.key, x.n, w.p.stack(x.key));
  sortMain(w, c);
  e.count -= m;
  if (e.count === 0) c.queue.splice(index, 1);
  return null;
}

/** One tick of the head of the crafting queue (I §3.9); it pauses while the product cannot fit. */
function craftTick(w: FakeWorld, c: Char): void {
  const e = c.queue[0];
  if (!e) return;
  const r = w.p.json.recipe[e.recipe];
  if (!r) {
    c.queue.shift();
    return;
  }
  const rate = w.p.char.craftingSpeed / (r.time * 60);
  const waited = e.progress >= UNIT_DONE; // completed in an earlier tick: paused since
  if (e.progress < UNIT_DONE) e.progress += rate;
  if (e.progress < UNIT_DONE) return;
  const products = r.products.filter((x) => x.kind === 'item').map((x) => ({ key: x.id * 8, n: x.amount }));
  // Crafting pauses while the product cannot fit (I §3.9) and says so once, in the tick the unit completes:
  // "Cannot insert Iron chest. Inventory is full." (rule 25).
  if (!fitsAll(mainInv(c), products, (k) => w.p.stack(k))) {
    const first = products[0];
    if (!waited && first) notFitting(w, c, 0, first.key, first.n);
    return;
  }
  for (const x of products) insert(mainInv(c), x.key, x.n, w.p.stack(x.key));
  sortMain(w, c);
  for (const x of products) w.count(w.produced, x.key, x.n);
  for (const i of r.ingredients) if (i.kind === 'item') w.count(w.consumed, i.id * 8, i.amount);
  w.emit({ seq: 0, player: c.player }, { type: 'item_crafted', recipe: e.recipe, count: 1 });
  for (const x of products)
    w.emit(
      { seq: 0, player: c.player },
      {
        type: 'flying_text',
        text: FlyingText.item_delta,
        item: x.key,
        count: x.n,
        total: count(mainInv(c), x.key),
        pos: finePos(c.x, c.y),
      },
    );
  e.count -= 1;
  e.progress = e.progress - 1 < 0 ? 0 : e.progress - 1;
  if (e.count === 0) c.queue.shift();
}

// ------------------------------------------------------------------------------------------ walking

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

/** Whether a character at (x, y) collides: unwalkable tiles, and buildings (not belts; puppets pass through). */
function blocked(w: FakeWorld, c: Char, x: number, y: number): boolean {
  const box = characterBox(w, x, y);
  for (let tx = Math.floor(box.x0); tx < box.x1; tx++)
    for (let ty = Math.floor(box.y0); ty < box.y1; ty++)
      if (!(w.p.walkingSpeed(w.tileAt(tx, ty)) > 0)) return true;
  if (c.scripted) return false;
  for (const e of w.entities)
    if (e.role !== 'belt' && e.flags !== 1 && overlaps(box, entityBox(w, e))) return true;
  return false;
}

/**
 * One tick of walking (§5.1): running speed × the walking speed of the tile underfoot, in 8 directions; a
 * blocked step is retried as its x part, then its y part (diagonals only); no movement up to contact.
 */
function walkTick(w: FakeWorld, c: Char): void {
  c.vx = 0;
  c.vy = 0;
  if (!c.walking) return;
  const speed = w.p.char.runningSpeed * w.p.walkingSpeed(w.tileAt(Math.floor(c.x), Math.floor(c.y)));
  const [ux, uy] = WALK[c.dir >> 1] as readonly [number, number];
  const dx = speed * ux;
  const dy = speed * uy;
  let mx = 0;
  let my = 0;
  if (!blocked(w, c, c.x + dx, c.y + dy)) {
    mx = dx;
    my = dy;
  } else if (dx !== 0 && dy !== 0) {
    if (!blocked(w, c, c.x + dx, c.y)) mx = dx;
    else if (!blocked(w, c, c.x, c.y + dy)) my = dy;
  }
  c.x += mx;
  c.y += my;
  c.vx = mx;
  c.vy = my;
}

/** Advances a character after the closure's actions: walking, mining, crafting (offline ones stand still). */
export function characterTick(w: FakeWorld, c: Char): void {
  if (!c.online) {
    c.vx = 0;
    c.vy = 0;
    return;
  }
  walkTick(w, c);
  mineTick(w, c);
  craftTick(w, c);
}
