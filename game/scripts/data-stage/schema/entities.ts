// entities.yaml (SCHEMA.md "entities.yaml"): placeable buildings and vehicles. `extra` is validated per
// entity type against EXTRA (an unknown type-specific field is an error). Every value an engine system reads
// is typed (J1; D1 typed the M1 ones and the cheap later ones: pole and Switch supply areas, the Switch's
// profile, underground and splitter throughput, steam generators, radar scans, the Frontier cluster's
// payloads). What is still `doc` documents a rule for people, or waits for its milestone (the Constructor's
// and the Area scanner's signal tables, M3; the Terminal's fluid box, M2): pm/reports/D1.md lists them.
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

/** Half the side of a square area around an entity's centre, in tiles (Factorio's supply_area_distance; ≤ 64). */
const areaDistance = z.number().positive().max(64);
/** A belt tier's throughput, both lanes (items per second): the belt speed derives from it (10 §2.4 step 3). */
const itemsPerS = posNum;
/** The Switch's 2.0 profile (FFF-409): the effect of n Switches is scaled by 1/√n. */
export const BEACON_PROFILES = ['inverse-sqrt'] as const;
/** What a turret targets by itself (10 §5.17; the artillery turret, M5). */
export const AUTO_TARGETS = ['replicators'] as const;

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
    supply_area_distance: areaDistance,
    profile: z.enum(BEACON_PROFILES),
    throttle: doc.optional(),
  }),
  belt: block({ items_per_s: itemsPerS }),
  boiler: block({ steam_per_s: posNum, temp_c: num, water_per_s: posNum }),
  'cargo-wagon': block({ slots: posInt }),
  chest: block({ slots: posInt }),
  combinator: block({ reads: doc.optional(), signals: doc.optional(), rescan: doc.optional() }),
  'electric-pole': block({ wire_reach: z.number().positive().max(64), supply_area_distance: areaDistance }),
  'fluid-wagon': block({ capacity: posNum }),
  furnace: block({ returns: nonNeg.optional() }),
  gate: block({ health: posNum }),
  // Steam generators carry their steam flow and temperature window (Factorio's fluid_usage_per_tick × 60,
  // fluid box minimum_temperature and maximum_temperature); the fusion generator its plasma flow.
  generator: block({
    max_kw: nonNeg,
    plasma_per_s: nonNeg.optional(),
    steam_per_s: posNum.optional(),
    min_temperature_c: num.optional(),
    max_temperature_c: num.optional(),
  }),
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
  // A radar's two scans (Factorio 2.0): sectors up to sector_range_chunks away, one per energy_per_sector_mj;
  // the chunks within nearby_range_chunks, rescanned per energy_per_nearby_scan_kj (10 §5.19).
  radar: block({
    sector_range_chunks: posInt,
    nearby_range_chunks: posInt,
    energy_per_sector_mj: posNum,
    energy_per_nearby_scan_kj: posNum,
  }),
  // The payload slot takes `payloads`; `empty_launch` allows a launch without one (04 §2.1). What a launch
  // returns is its pseudo recipe's products (launch, launch-empty, launch-final; 10 §5.5).
  'rocket-silo': block({
    parts_required: posInt.optional(),
    idle_kw: nonNeg.optional(),
    payloads: idList.optional(),
    empty_launch: bool.optional(),
  }),
  'solar-panel': block({ peak_kw: posNum }),
  splitter: block({ items_per_s: itemsPerS }),
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
    auto_targets: z.enum(AUTO_TARGETS).optional(),
    capacity: posInt.optional(),
    dispatch_radius: nonNeg.optional(),
  }),
  'underground-belt': block({ max_gap: posInt, items_per_s: itemsPerS }),
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
