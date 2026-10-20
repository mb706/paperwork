// entities.yaml (SCHEMA.md "entities.yaml"): placeable buildings and vehicles. `extra` is validated per
// entity type against EXTRA (an unknown type-specific field is an error). Several engine-read values are
// still prose in the data (an electric pole's supply area, a Switch's supply area and profile); they are
// typed `doc` here and listed in the C1a report for the package that implements those systems (J1).
import { z } from 'zod';
import { block, bool, doc, id, idList, nonNeg, num, posInt, posNum, size } from './common.ts';
import { MODULE_EFFECTS } from './items.ts';

/** Entity types (SCHEMA.md), in its order. The engine's EntityType enum takes these values (C1b). */
export const ENTITY_TYPES = [
  'assembler',
  'furnace',
  'mining-drill',
  'offshore-pump',
  'pumpjack',
  'lab',
  'belt',
  'underground-belt',
  'splitter',
  'inserter',
  'chest',
  'pipe',
  'pipe-to-ground',
  'pump',
  'storage-tank',
  'boiler',
  'generator',
  'solar-panel',
  'accumulator',
  'reactor',
  'heat-pipe',
  'heat-exchanger',
  'electric-pole',
  'roboport',
  'logistic-chest',
  'rail',
  'train-stop',
  'rail-signal',
  'locomotive',
  'cargo-wagon',
  'fluid-wagon',
  'beacon',
  'radar',
  'wall',
  'gate',
  'turret',
  'rocket-silo',
  'combinator',
  'lamp',
  'cooler',
  'other',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENERGY_SOURCES = ['none', 'electric', 'burner', 'heat'] as const;

export const energy = block({
  source: z.enum(ENERGY_SOURCES),
  // The burner inserter has no fixed draw: it pays per_movement_kj and per_rotation_kj (SCHEMA.md).
  kw: nonNeg.optional(),
  drain_kw: nonNeg.optional(),
  fuel_categories: idList.optional(),
  per_movement_kj: nonNeg.optional(),
  per_rotation_kj: nonNeg.optional(),
  priority: z.enum(['interruptible']).optional(),
});

export const heat = block({
  class: id.optional(),
  liquid_cooling: bool.optional(),
  while: z.enum(['researcher']).optional(),
  emission: z.enum(['twice-output', 'none']).optional(),
  waste_heat: bool.optional(),
  removes_kw: nonNeg.optional(),
  full_rate_dt_k: num.optional(),
  water_per_mj: nonNeg.optional(),
  coolant_in_min_c: num.optional(),
  coolant_out_c: num.optional(),
  into: doc.optional(),
});

export const placement = z.union([
  z.strictObject({ must_be_on: id }),
  z.strictObject({ must_touch: z.union([id, idList]) }),
]);

const hallTier = block({ item: id, speed: posNum, kw: nonNeg, drain_kw: nonNeg });

/** Type-specific fields (`extra`), per entity type. A type absent here takes no `extra`. */
export const EXTRA: Partial<Record<EntityType, z.ZodType>> = {
  accumulator: block({ capacity_mj: nonNeg, flow_kw: nonNeg }),
  assembler: block({
    keeps_working_on_closed_exchange: bool.optional(),
    accelerator_slots: posInt.optional(),
    weights_slots: posInt.optional(),
    weights_item: id.optional(),
    tiers: z.array(hallTier).optional(),
    mixed_tiers: doc.optional(),
    runs_when: doc.optional(),
    loading: doc.optional(),
    upgrade: doc.optional(),
    output_returns_accelerators: bool.optional(),
    accelerator_quality: doc.optional(),
  }),
  beacon: block({
    distribution_efficiency: nonNeg,
    supply_area: doc,
    profile: doc,
    throttle: doc.optional(),
  }),
  belt: block({ items_per_s: posNum }),
  boiler: block({ steam_per_s: posNum, temp_c: num, water_per_s: posNum }),
  'cargo-wagon': block({ slots: posInt }),
  chest: block({ slots: posInt }),
  combinator: block({ reads: doc.optional(), signals: doc.optional(), rescan: doc.optional() }),
  'electric-pole': block({ wire_reach: posNum, supply: doc }),
  'fluid-wagon': block({ capacity: posNum }),
  furnace: block({ returns: nonNeg.optional() }),
  gate: block({ health: posNum }),
  generator: block({ max_kw: nonNeg, plasma_per_s: nonNeg.optional() }),
  'heat-exchanger': block({ steam_per_s: posNum, temp_c: num, water_per_s: posNum }),
  'offshore-pump': block({ pumping_per_s: posNum }),
  other: block({
    fluid_box: doc.optional(),
    statuses: doc.optional(),
    range: nonNeg.optional(),
    rail_vehicle: bool.optional(),
    ammo_category: id.optional(),
    slots: posInt.optional(),
    weapons: z.array(id).optional(),
    grid: size.optional(),
    holds: doc.optional(),
    circuit: doc.optional(),
    signals: doc.optional(),
    built_by: doc.optional(),
  }),
  'pipe-to-ground': block({ max_gap: posInt }),
  reactor: block({
    heat_mw: nonNeg.optional(),
    neighbor_bonus: nonNeg.optional(),
    max_temperature_c: num.optional(),
    electric_kw: nonNeg.optional(),
    plasma_per_s: nonNeg.optional(),
    plasma_mw: nonNeg.optional(),
    feeds_generators: posInt.optional(),
  }),
  'rocket-silo': block({
    parts_required: posInt.optional(),
    idle_kw: nonNeg.optional(),
    payload: doc.optional(),
    returns: doc.optional(),
  }),
  'solar-panel': block({ peak_kw: posNum }),
  'storage-tank': block({ capacity: posNum }),
  turret: block({
    range: nonNeg.optional(),
    clean_interval_s: posNum.optional(),
    ammo: id.optional(),
    health: posNum.optional(),
    shots_per_s: posNum.optional(),
    ammo_category: id.optional(),
    damage: nonNeg.optional(),
    kj_per_shot: nonNeg.optional(),
    damage_type: id.optional(),
    chains: bool.optional(),
    auto_targets: doc.optional(),
    capacity: posInt.optional(),
    dispatch_radius: nonNeg.optional(),
  }),
  'underground-belt': block({ max_gap: posInt }),
  wall: block({ health: posNum, resist: z.record(id, num).optional() }),
};

export const entity = block({
  id,
  name: doc,
  type: z.enum(ENTITY_TYPES),
  size,
  item: id,
  energy,
  mirrors: doc,
  extra: z.record(z.string(), z.unknown()).optional(),
  module_slots: z.int().nonnegative().optional(),
  desc: doc.optional(),
  handbook_note: doc.optional(),
  heat: heat.optional(),
  crafting_speed: posNum.optional(),
  categories: idList.optional(),
  consumes: idList.optional(),
  produces: idList.optional(),
  placement: placement.optional(),
  mining_speed: posNum.optional(),
  deploys: bool.optional(),
  staff_slots: posInt.optional(),
  staff_demand: nonNeg.optional(),
  allowed_effects: z.array(z.enum(MODULE_EFFECTS)).optional(),
  effect_receiver: block({
    uses_module_effects: bool.optional(),
    uses_beacon_effects: bool.optional(),
  }).optional(),
});

export type Entity = z.infer<typeof entity>;
