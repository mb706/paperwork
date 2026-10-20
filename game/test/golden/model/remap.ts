// Loading a save made with other prototypes (10 §8.3): the shell builds a remap table per prototype kind from
// the save's name tables (old id → new id, 0xFFFF removed), and `sim_load` applies them to every saved field
// that is a prototype id or an item key. What disappears is listed in the load report (§15.8 `load_report`),
// and the world starts a new digest lineage (§4.8 item 4).
import { ProtoKind } from '../../../src/shared/gen/types.ts';
import { emptyHand } from './inventory.ts';
import { NO_ITEM, type World } from './world.ts';

/**
 * A remap table (abi.yaml `RemapTable`): old id → new id, or 0xFFFF for removed, and the save's name of each
 * removed id, ascending by old id.
 */
export interface Remap {
  kind: number;
  ids: number[];
  removed: { name: Uint8Array }[];
}

export interface Removed {
  kind: number;
  name: string;
  count: number;
}

const REMOVED = 0xffff;

/**
 * Applies the remap tables to a freshly loaded world (its derived indexes built; rebuild them after) and returns
 * what disappeared, ascending by (kind, name). Model decisions (M0's state; rule 46):
 * - an item key keeps its quality bits; a removed item empties every slot and hand holding it, and its
 *   statistics record goes; `count` is the number of items lost;
 * - a removed entity prototype removes every entity of it with its inventory; `count` is the number of
 *   entities (their items are not counted again);
 * - a removed recipe drops its crafting-queue entries (their ingredients were consumed at enqueue, §5.1);
 *   `count` is the number of crafts dropped;
 * - tiles and resources must map to themselves in M0 (a remap of the map's own ids is not modelled);
 * - the report lists the removed prototypes the state used (count > 0), named by the remap table.
 */
export function applyRemaps(w: World, remaps: readonly Remap[]): Removed[] {
  const table = (kind: number): number[] | null => remaps.find((r) => r.kind === kind)?.ids ?? null;
  const removed = new Map<string, Removed>();
  const nameOf = (kind: number, oldId: number): string => {
    const r = remaps.find((x) => x.kind === kind) as Remap;
    const gone = r.ids.flatMap((v, i) => (v === REMOVED ? [i] : []));
    const n = r.removed[gone.indexOf(oldId)];
    if (!n) throw new Error(`the remap table of kind ${kind} names no removed id ${oldId}`);
    return new TextDecoder('utf-8', { fatal: true }).decode(n.name);
  };
  const lose = (kind: number, oldId: number, n: number): void => {
    if (n === 0) return;
    const name = nameOf(kind, oldId);
    const k = `${kind}:${name}`;
    const r = removed.get(k) ?? { kind, name, count: 0 };
    r.count += n;
    removed.set(k, r);
  };
  for (const r of remaps)
    if ((r.kind === ProtoKind.tile || r.kind === ProtoKind.resource) && r.ids.some((v, i) => v !== i))
      throw new Error('a remap of tiles or resources is not modelled in M0');

  const items = table(ProtoKind.item);
  const mapKey = (key: number): number | null => {
    if (!items || key === NO_ITEM) return key;
    const id = items[key >> 3];
    if (id === undefined) throw new Error(`item key ${key} is outside the save's item table`);
    return id === REMOVED ? null : id * 8 + (key & 7);
  };

  // Entities first: a removed prototype takes its entity, its container row and its inventory block with it.
  const entities = table(ProtoKind.entity);
  if (entities)
    w.entities.forEach((e, row) => {
      if (e.serial === 0) return;
      const id = entities[e.proto];
      if (id === undefined) throw new Error(`entity prototype ${e.proto} is outside the save's table`);
      if (id !== REMOVED) {
        e.proto = id;
        return;
      }
      lose(ProtoKind.entity, e.proto, 1);
      void row;
      w.freeEntity(e);
    });

  // Items in every live slot and hand.
  if (items) {
    for (const a of w.heap.arenas.values())
      for (const s of a.slots) {
        if (s.count === 0) continue;
        const k = mapKey(s.key);
        if (k === null) {
          lose(ProtoKind.item, s.key >> 3, s.count);
          s.key = NO_ITEM;
          s.count = 0;
        } else s.key = k;
      }
    for (const p of w.players) {
      if (p.hand.count === 0 && !p.hand.ghost) continue;
      const k = mapKey(p.hand.key);
      if (k === null) {
        if (!p.hand.ghost) lose(ProtoKind.item, p.hand.key >> 3, p.hand.count);
        p.hand = emptyHand();
      } else p.hand.key = k;
    }
    for (const [key, s] of [...w.stats.entries()]) {
      w.stats.delete(key);
      const kind = Math.floor(key / 2 ** 24);
      const k = kind === 1 ? mapKey(key % 2 ** 24) : key % 2 ** 24;
      if (k !== null) w.stats.set(kind * 2 ** 24 + k, { ...s, key: kind * 2 ** 24 + k });
    }
  }

  const recipes = table(ProtoKind.recipe);
  if (recipes)
    for (const p of w.players)
      p.crafting_queue = p.crafting_queue.filter((e) => {
        const id = recipes[e.recipe];
        if (id === undefined) throw new Error(`recipe ${e.recipe} is outside the save's table`);
        if (id === REMOVED) {
          lose(ProtoKind.recipe, e.recipe, e.count);
          return false;
        }
        e.recipe = id;
        return true;
      });

  return [...removed.values()].sort(
    (a, b) => a.kind - b.kind || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}
