// items.yaml (SCHEMA.md "items.yaml"): items and fluids.
import { z } from 'zod';
import { block, bool, doc, id, idList, int, nonNeg, num, posInt, size } from './common.ts';

export const ITEM_TAGS = [
  'raw',
  'intermediate',
  'science-pack',
  'building',
  'fluid',
  'fuel',
  'module',
  'ammo',
  'final',
  'equipment',
  'armor',
  'installed',
  'staff',
] as const;

export const MODULE_EFFECTS = ['speed', 'productivity', 'consumption', 'quality'] as const;

export const item = block({
  id,
  name: doc,
  type: z.enum(['item', 'fluid']),
  stack: posInt.optional(),
  tier: id,
  mirrors: doc,
  sprite: doc,
  places: id.optional(),
  places_tile: id.optional(),
  tags: z.array(z.enum(ITEM_TAGS)),
  desc: doc.optional(),
  handbook_note: doc.optional(),
  fuel_value: nonNeg.optional(),
  fuel_category: id.optional(),
  default_temperature: num.optional(),
  max_temperature: num.optional(),
  heat_capacity_kj_per_k: nonNeg.optional(),
  module: block({
    speed: num.optional(),
    productivity: num.optional(),
    consumption: num.optional(),
    quality: num.optional(),
  }).optional(),
  ammo: block({
    category: id,
    damage_category: id.optional(),
    rounds: posInt.optional(),
    damage: z.union([num, z.record(id, num)]).optional(),
    damage_type: id.optional(),
    use: doc.optional(),
    stats: doc.optional(),
  }).optional(),
  armor: block({ grid: size.nullable() }).optional(),
  equipment: block({
    size,
    kw: num.optional(),
    mj: num.optional(),
    shield: num.optional(),
    stats: doc.optional(),
    ammo_category: id.optional(),
  }).optional(),
  staff: block({
    fully_staffs: bool.optional(),
    kw: nonNeg.optional(),
    heat_class: id.optional(),
    liquid_cooling: bool.optional(),
    interruptible: bool.optional(),
    deploys: bool.optional(),
    model_tier: int.optional(),
    draws: doc.optional(),
    energy_scaled_by: idList.optional(),
  }).optional(),
  spoil: block({ ticks: posInt, into: id, setting: id }).optional(),
});

export type Item = z.infer<typeof item>;
