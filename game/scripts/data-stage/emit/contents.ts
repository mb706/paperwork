// What the outputs carry and what they do not (C1a-r1 finding 5). The data stage emits only part of the
// design data so far: the kind tables of emit/tables.ts and META's start record. Everything else is
// declared omitted here, and every output says so, so that a consumer refuses a build that lacks what it
// needs instead of reading silent zeros:
//   - prototypes.bin: META record 2 (`contents`): field 1 the META blocks it carries, field 2 the omitted
//     parts, both lists of strings;
//   - prototypes.json and build-manifest.json: `contents: {meta, omitted}`;
//   - capabilities.yaml: `data` lists the parts a milestone's engine reads; the stage refuses a manifest
//     that needs an omitted part.
// The schema package (C1b, gate item 1) declares these blocks in schema/protos.yaml and emits them.
// scripts/data-stage/contents.test.ts checks that every field of every kind's schema is classified here.
import { compareCodeUnits, sortedEntries } from '../../lib/canonical.ts';

/** bin: in prototypes.bin; json: in prototypes.json only; both; doc: documentation or validator-only;
 *  partial: some subfields omitted (listed in PARTIAL); omitted: design data no output carries yet. */
export type FieldStatus = 'bin' | 'json' | 'both' | 'doc' | 'partial' | 'omitted';

const DOCS = { rule: 'doc', formula: 'doc', formula_ref: 'doc', note: 'doc', notes: 'doc' } as const;

export const FIELD_STATUS: Record<string, Record<string, FieldStatus>> = {
  items: {
    ...DOCS,
    id: 'both',
    name: 'json',
    type: 'both',
    stack: 'both',
    tier: 'bin',
    mirrors: 'doc',
    sprite: 'doc',
    places: 'both',
    places_tile: 'both',
    tags: 'bin',
    desc: 'json',
    handbook_note: 'json',
    fuel_value: 'both',
    fuel_category: 'bin',
    default_temperature: 'bin',
    max_temperature: 'bin',
    heat_capacity_kj_per_k: 'bin',
    module: 'omitted',
    ammo: 'omitted',
    armor: 'omitted',
    equipment: 'omitted',
    staff: 'omitted',
    spoil: 'omitted',
  },
  recipes: {
    ...DOCS,
    id: 'both',
    name: 'json',
    category: 'both',
    time: 'both',
    ingredients: 'both',
    products: 'both',
    handcraft: 'both',
    allow_productivity: 'bin',
    mirrors: 'doc',
    container: 'bin',
    handbook_note: 'json',
    pseudo: 'doc',
    shared_unlock: 'doc',
    amounts_by_j: 'bin',
    victory: 'omitted',
  },
  entities: {
    ...DOCS,
    id: 'both',
    name: 'json',
    type: 'both',
    size: 'both',
    item: 'both',
    energy: 'partial',
    mirrors: 'doc',
    extra: 'partial',
    module_slots: 'bin',
    desc: 'json',
    handbook_note: 'json',
    heat: 'partial',
    crafting_speed: 'bin',
    categories: 'omitted',
    consumes: 'omitted',
    produces: 'omitted',
    placement: 'bin',
    mining_speed: 'bin',
    deploys: 'omitted',
    staff_slots: 'omitted',
    staff_demand: 'omitted',
    allowed_effects: 'omitted',
    effect_receiver: 'omitted',
  },
  technologies: {
    ...DOCS,
    note: 'json',
    id: 'both',
    name: 'json',
    code: 'doc',
    era: 'doc',
    regime: 'both',
    prerequisites: 'both',
    unlocks: 'partial',
    mirrors: 'doc',
    cost: 'bin',
    trigger: 'bin',
    upgrade: 'bin',
    citation: 'omitted',
    branch: 'omitted',
    desc: 'json',
    handbook_note: 'json',
    count_formula: 'bin',
    first_level: 'both',
    max_level: 'both',
    field_year: 'bin',
    essential: 'bin',
    hidden: 'bin',
  },
  resources: {
    ...DOCS,
    id: 'both',
    name: 'json',
    kind: 'both',
    yields: 'both',
    mining_time: 'both',
    infinite: 'bin',
    requires_fluid: 'bin',
    autoplace: 'doc',
    mirrors: 'doc',
  },
  tiles: {
    ...DOCS,
    id: 'both',
    name: 'json',
    kappa_per_s: 'bin',
    buildable: 'both',
    walking_speed: 'both',
    map_color: 'both',
    minable_back: 'bin',
    biome: 'omitted',
    placed_by: 'bin',
    town: 'bin',
    placed_on: 'omitted',
  },
  world: {
    ...DOCS,
    id: 'both',
    name: 'json',
    kind: 'both',
    size: 'both',
    mining_time: 'both',
    yields: 'bin',
    collides: 'bin',
    cosmetic: 'bin',
    selectable: 'bin',
    sprite: 'doc',
    mirrors: 'doc',
    leaf_stages: 'bin',
    gui: 'omitted',
  },
  meta: {
    ...DOCS,
    tiers: 'bin',
    crafting_categories: 'bin',
    fuel_categories: 'bin',
    town_classes: 'omitted',
    start: 'partial',
    quality: 'omitted',
    heat: 'partial',
    staffing: 'omitted',
    runaways: 'omitted',
    hollow_work: 'omitted',
    world: 'omitted',
    world_settings: 'omitted',
    endgame: 'omitted',
    damage_categories: 'omitted',
    effects: 'omitted',
    checks: 'doc',
    citation_rules: 'doc',
  },
};

/** The omitted subfields of the `partial` fields. */
export const PARTIAL: Record<string, readonly string[]> = {
  'entities.energy': ['fuel_categories', 'per_movement_kj', 'per_rotation_kj', 'priority'],
  'entities.extra': ['every type-specific field except chests and wagons slots and belts items_per_s'],
  'entities.heat': [
    'liquid_cooling',
    'while',
    'emission',
    'waste_heat',
    'removes_kw',
    'full_rate_dt_k',
    'water_per_mj',
    'coolant_in_min_c',
    'coolant_out_c',
  ],
  'technologies.unlocks': ['effects'],
  'meta.start': ['salvage', 'guarantees'],
  'meta.heat': ['every block except classes (carried as each entity t_star)'],
};

/** Whole design files that no output carries yet: enemies have no PROTO kind in 10 §15.2. */
export const OMITTED_FILES = ['enemies', 'text'] as const;

/** The META blocks prototypes.bin carries. */
export const EMITTED_META = ['start.inventory'] as const;

/** The flat list of omitted parts, sorted: what a consumer must not expect. */
export function omittedParts(): string[] {
  const out: string[] = [...OMITTED_FILES];
  for (const [kind, fields] of sortedEntries(FIELD_STATUS)) {
    for (const [field, status] of sortedEntries(fields)) {
      if (status === 'omitted') out.push(`${kind}.${field}`);
      if (status === 'partial')
        for (const sub of PARTIAL[`${kind}.${field}`] ?? []) out.push(`${kind}.${field}.${sub}`);
    }
  }
  return out.sort(compareCodeUnits);
}

/** What every output states about itself. */
export function contentsRecord(): { meta: string[]; omitted: string[] } {
  return { meta: [...EMITTED_META], omitted: omittedParts() };
}
