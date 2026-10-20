// resources.yaml, tiles.yaml, world.yaml and enemies.yaml (SCHEMA.md).
import { z } from 'zod';
import { block, bool, doc, id, idList, int, nonNeg, num, pair, posInt, posNum, size } from './common.ts';

export const RESOURCE_KINDS = ['solid', 'fluid', 'offshore'] as const;

export const resource = block({
  id,
  name: doc,
  kind: z.enum(RESOURCE_KINDS),
  yields: id,
  mining_time: posNum.optional(),
  infinite: bool.optional(),
  requires_fluid: id.optional(),
  autoplace: doc,
  mirrors: doc,
});

export const tile = block({
  id,
  name: doc,
  kappa_per_s: posNum.nullable(),
  buildable: bool,
  walking_speed: posNum.nullable(),
  map_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: 'expected a colour #rrggbb' }),
  minable_back: bool,
  biome: idList.optional(),
  placed_by: id.optional(),
  town: bool.optional(),
  placed_on: idList.optional(),
});

export const WORLD_KINDS = ['tree', 'rock', 'town-building', 'campus', 'landmark'] as const;

/** A yield: `n`, or `[min, max]`. */
export const yieldAmount = z.union([posInt, z.tuple([posInt, posInt])]);

export const worldObject = block({
  id,
  name: doc,
  kind: z.enum(WORLD_KINDS),
  size,
  mining_time: posNum.optional(),
  yields: z.record(id, yieldAmount).optional(),
  collides: bool,
  cosmetic: bool.optional(),
  selectable: bool.optional(),
  sprite: doc,
  mirrors: doc.optional(),
  leaf_stages: posInt.optional(),
  gui: id.optional(),
});

export const ENEMY_KINDS = ['copy', 'spawner', 'unit', 'stationary'] as const;

export const enemy = block({
  id,
  name: doc,
  kind: z.enum(ENEMY_KINDS),
  mirrors: doc,
  sprite: doc,
  desc: doc,
  health: z.union([posNum, pair]).optional(),
  resist: doc.optional(),
  tier: z.union([int, doc]).optional(),
  attack: block({
    type: id,
    damage: nonNeg.optional(),
    range: z.union([nonNeg, doc]),
    puddle: bool.optional(),
  }).optional(),
  join_cost: nonNeg.optional(),
  appears_at_evolution: num.optional(),
  spawn_cooldown_ticks: pair.optional(),
  max_units: posInt.optional(),
  spawns: idList.optional(),
  loot: z.record(z.string(), z.union([nonNeg, doc])).optional(),
  spread_interval_s: z.array(posNum).optional(),
  escape_timer_s: z.array(posNum).optional(),
  targets: doc.optional(),
  effect: doc.optional(),
  spread: doc.optional(),
});

export type Resource = z.infer<typeof resource>;
export type Tile = z.infer<typeof tile>;
export type WorldObject = z.infer<typeof worldObject>;
export type Enemy = z.infer<typeof enemy>;
