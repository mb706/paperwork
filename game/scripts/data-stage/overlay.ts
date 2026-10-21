// The engine overlay (10 §2.4 step 2): game/data/engine/*.yaml. It holds only fields the design schema does
// not carry, in three layers: defaults per entity type, defaults per `mirrors` id, and per-prototype
// entries. The overlay may add engine fields; it may never set a number the design data carries (that
// is an error: the fix belongs in the design YAML).
//
// D1 (M1 data readiness) added the engine geometry and tables M1's systems read, typed here and resolved per
// entity in `resolveEntity`: collision masks (10 §4.4), map colours, the inserter's vectors and swing speeds,
// the drill's mining area and drop point, the offshore pump's pumping position, pole wiring, lamps, burner and
// furnace inventories, fluid boxes, the belt lane geometry (`belt_lanes`), terrain materials per tile
// (terrain.yaml), map colours of resources and world objects, and the planned sounds of the slice
// (sounds.yaml `planned`). engine.ts checks that a build's prototypes have all of it.
import { z } from 'zod';
import { compareCodeUnits } from '../lib/canonical.ts';
import type { Diagnostics } from './diagnostics.ts';
import { ENTITY_TYPES, type Entity, type EntityType } from './schema/entities.ts';
import type { Item } from './schema/items.ts';
import { at, type SourceFile } from './sources.ts';

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const box = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const vec = z.tuple([z.number(), z.number()]);
const positive = z.number().positive();
const fraction = z.number().min(0).max(1);
const slots = z.int().min(0).max(255);
/** #rrggbb, or #rrggbbaa where a colour is drawn translucent (trees on the map). */
const color = z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/, { error: 'expected #rrggbb or #rrggbbaa' });

/** The engine's collision layers (10 §4.4), in code-unit order. */
export const COLLISION_LAYERS = ['item', 'object', 'player', 'rail', 'resource', 'train', 'water'] as const;
export type CollisionLayer = (typeof COLLISION_LAYERS)[number];
/** Fluid connections face one of the four sides, in the entity's north-facing frame. */
export const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
export type Direction4 = (typeof DIRECTIONS)[number];
/** A direction's unit vector (x east, y south). */
export const DIRECTION_VECTOR: Record<Direction4, [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

// Type-specific blocks. Every field is optional in a layer: blocks merge key by key down the layers
// (type → mirrors → prototype), and engine.ts checks that the merged block is complete.
const inserterBlock = z.strictObject({
  pickup: vec.optional(),
  drop: vec.optional(),
  rotation_speed: positive.optional(),
  extension_speed: positive.optional(),
  hand_size: positive.optional(),
  starting_distance: z.number().nonnegative().optional(),
  bulk: z.boolean().optional(),
});
const miningDrillBlock = z.strictObject({
  resource_searching_radius: positive.optional(),
  vector_to_place_result: vec.optional(),
});
const offshorePumpBlock = z.strictObject({ pumping_position: vec.optional() });
const electricPoleBlock = z.strictObject({
  auto_connect_up_to_n_wires: slots.optional(),
  track_coverage_during_drag_building: z.boolean().optional(),
});
const lampBlock = z.strictObject({
  darkness_on: fraction.optional(),
  darkness_off: fraction.optional(),
  light: z
    .strictObject({ size: positive, intensity: fraction, color: z.tuple([fraction, fraction, fraction]) })
    .optional(),
});
const burnerBlock = z.strictObject({ fuel_slots: slots.optional(), burnt_result_slots: slots.optional() });
const furnaceBlock = z.strictObject({ source_slots: slots.optional(), result_slots: slots.optional() });
const connection = z.strictObject({
  position: vec,
  direction: z.enum(DIRECTIONS),
  flow: z.enum(['input', 'output', 'input-output']),
  type: z.enum(['normal', 'underground']).optional(),
});
const fluidBox = z.strictObject({
  volume: positive,
  production: z.enum(['input', 'output', 'none']),
  filter: id.optional(),
  /** U50: `default` boxes connect to pipes, `data` boxes to data lines; categories never intersect. */
  category: z.enum(['default', 'data']).optional(),
  /** Factorio's fluid_boxes_off_when_no_fluid_recipe: the box exists only while the recipe has a fluid. */
  off_without_fluid_recipe: z.boolean().optional(),
  connections: z.array(connection).min(1),
});
export type FluidBox = z.infer<typeof fluidBox>;

/** The nested blocks: they merge key by key down the layers; every other field is replaced whole. */
const BLOCKS = [
  'inserter',
  'mining_drill',
  'offshore_pump',
  'electric_pole',
  'lamp',
  'burner',
  'furnace',
] as const;
type BlockKey = (typeof BLOCKS)[number];

/** Engine fields of an entity (any layer). */
const entityFields = {
  collision_box: box.optional(),
  selection_box: box.optional(),
  collision_inset: z.number().nonnegative().optional(),
  mining_time: z.number().positive().optional(),
  rotatable: z.boolean().optional(),
  flippable: z.boolean().optional(),
  selection_priority: z.int().min(0).max(255).optional(),
  fast_replaceable_group: id.nullable().optional(),
  next_upgrade: id.nullable().optional(),
  /** The art set, where it differs from `entity/<id>` (10 §15.7). */
  sprite: z.string().optional(),
  /** The engine layers it occupies (10 §4.4). */
  collision_mask: z.array(z.enum(COLLISION_LAYERS)).min(1).optional(),
  /** Its colour on the map and the minimap (10 §2.4, §5.19). */
  map_color: color.optional(),
  inserter: inserterBlock.optional(),
  mining_drill: miningDrillBlock.optional(),
  offshore_pump: offshorePumpBlock.optional(),
  electric_pole: electricPoleBlock.optional(),
  lamp: lampBlock.optional(),
  burner: burnerBlock.optional(),
  furnace: furnaceBlock.optional(),
  fluid_boxes: z.array(fluidBox).optional(),
};
const entityLayer = z.strictObject(entityFields);
type EntityLayer = z.infer<typeof entityLayer>;
const itemLayer = z.strictObject({
  group: id.optional(),
  subgroup: id.optional(),
  order: z.string().optional(),
  /** The icon set, where it differs from `item/<id>` (`fluid/<id>`), or for recipes the main product's. */
  icon: z.string().optional(),
});
const spriteLayer = z.strictObject({ sprite: z.string().optional(), map_color: color.optional() });
/**
 * game/data/engine/sets.yaml (10 §15.7's set-name tables; D1-r1): the tree species and decoratives with their
 * biome maps (biome → entries, every biome of meta.world.biomes.order, each entry in one biome), the cliff
 * shapes, and the town buildings skin by skin (every skin the same number of pictures). checkSets holds them to
 * the design data; prototypes.json carries the flat lists its build can show.
 */
const setsFile = z.strictObject({
  tree_species: z.array(id),
  tree_biomes: z.record(id, z.array(id)),
  decoratives: z.array(id),
  decorative_biomes: z.record(id, z.array(id)),
  cliffs: z.array(id),
  town_buildings: z.array(z.array(id)),
});

/**
 * game/data/engine/sounds.yaml (10 §15.6; C1b decision 14): the audio package owns the file and its format. The
 * data stage reads the sound names (ids are dense, sorted by name) and the entity → working-sound table; the rest
 * (events, music, mixing) is the audio module's and passes through unread. `planned` (D1) is M1c's map in the
 * same shapes, read here only to check it: its sounds have no ids until they move up.
 */
const soundsFile = z.looseObject({
  sounds: z.record(id, z.unknown()),
  working_sounds: z.record(id, id).optional(),
  events: z.record(z.string(), z.unknown()).optional(),
  planned: z
    .strictObject({
      sounds: z.record(id, z.unknown()),
      working_sounds: z.record(id, id),
      events: z.record(z.string(), z.unknown()),
      footsteps: z.record(id, id),
    })
    .optional(),
});

/** The sound tables a build carries: names by id, and each entity's working sound by name. */
export interface SoundTables {
  names: string[];
  working: Map<string, string>;
  /** M1c's planned sounds and uses (sounds.yaml `planned`), checked by engine.ts; none have ids yet. */
  planned: {
    sounds: Set<string>;
    working: Map<string, string>;
    footsteps: Map<string, string>;
  };
}

/** terrain.yaml: every tile's terrain material and shader flags (10 §6.5, §9.9). */
const terrainFile = z.strictObject({
  tiles: z.record(
    id,
    z.strictObject({
      material: id,
      crisp: z.boolean().optional(),
      water: z.boolean().optional(),
      fallback: z.strictObject({ base: id.nullable(), wash: color }).optional(),
    }),
  ),
});
export type TerrainTable = z.infer<typeof terrainFile>['tiles'];

/** defaults.yaml `belt_lanes` (10 §5.3): lane lengths in positions (1/256 tile), the drawn lane offset. */
const beltLanes = z.strictObject({
  positions_per_tile: z.int().positive(),
  item_spacing: z.int().positive(),
  lane_offset_tiles: positive,
  straight: z.int().positive(),
  curve_inner: z.int().positive(),
  curve_outer: z.int().positive(),
  underground: z.int().positive(),
  splitter_input: z.int().positive(),
  splitter_buffer: z.int().nonnegative(),
  splitter_output: z.int().positive(),
  side_load_late: z.int().positive(),
  side_load_early: z.int().positive(),
});
export type BeltLanes = z.infer<typeof beltLanes>;

const groupsFile = z.strictObject({
  groups: z.array(z.strictObject({ id, order: z.string() })),
  subgroups: z.array(z.strictObject({ id, group: id, order: z.string() })),
});
const defaultsFile = z.strictObject({
  entity_types: z.record(z.union([z.enum(ENTITY_TYPES), z.literal('_all')]), entityLayer),
  belt_lanes: beltLanes,
  item_subgroups: z.strictObject({
    by_entity_type: z.record(z.enum(ENTITY_TYPES), id),
    tile: id,
    by_tag: z.array(z.strictObject({ tag: z.string(), subgroup: id })),
    fluid: id,
    fallback: id,
  }),
});
const mirrorsFile = z.strictObject({ entities: z.record(id, entityLayer) });
/**
 * The engine's character (10 §5.1, §15.2; C1a open issue 3): not a data prototype. The data stage writes it
 * as the last row of PROTO_ENTITY (type `character`) when the capability manifest includes it; MOVERS'
 * `proto` names that row, and prototypes.json gives its `sprite`.
 */
const characterLayer = z.strictObject({
  running_speed: z.number().positive(),
  reach_distance: z.number().positive(),
  build_distance: z.number().positive(),
  resource_reach_distance: z.number().positive(),
  item_pickup_distance: z.number().positive(),
  inventory_size: z.int().min(1).max(0xffff),
  mining_speed: z.number().positive(),
  crafting_speed: z.number().positive(),
  collision_box: box,
  selection_box: box,
  collision_mask: z.array(z.enum(COLLISION_LAYERS)).min(1),
  selection_priority: z.int().min(0).max(255).optional(),
  sprite: z.string(),
});
export type CharacterEngine = z.infer<typeof characterLayer>;

const prototypesFile = z.strictObject({
  character: characterLayer.optional(),
  entities: z.record(id, entityLayer),
  items: z.record(id, itemLayer),
  recipes: z.record(id, itemLayer),
  resources: z.record(id, spriteLayer),
  world: z.record(id, spriteLayer),
});

export type Box = [number, number, number, number];

export interface InserterEngine {
  pickup: [number, number];
  drop: [number, number];
  rotation_speed: number;
  extension_speed: number;
  hand_size: number;
  starting_distance: number;
  bulk: boolean;
}

export interface MiningDrillEngine {
  resource_searching_radius: number;
  vector_to_place_result: [number, number];
  /** The tiles it mines, [w, h]: those whose centres lie within the radius of its centre (10 §5.6). */
  mining_area: [number, number];
}

/** An entity's resolved engine fields. A block is null when the entity's type takes none. */
export interface EntityEngine {
  collision_box: Box;
  selection_box: Box;
  /**
   * The box the character collides with under trimmed collision (10 §4.4, 07 §16; the default): the collision
   * box intersected with the footprint inset by 0.25 tile, except for chests, walls and gates, which keep it.
   */
  player_collision_box: Box;
  mining_time: number;
  rotatable: boolean;
  flippable: boolean;
  selection_priority: number;
  fast_replaceable_group: string | null;
  next_upgrade: string | null;
  /** The entity's art set (10 §15.7): `entity/<id>` unless the overlay names another. */
  sprite: string;
  collision_mask: CollisionLayer[];
  map_color: string;
  /** The merged blocks, as the layers give them (engine.ts checks them complete for the build). */
  inserter: z.infer<typeof inserterBlock> | null;
  mining_drill: (z.infer<typeof miningDrillBlock> & { mining_area?: [number, number] }) | null;
  offshore_pump: z.infer<typeof offshorePumpBlock> | null;
  electric_pole: z.infer<typeof electricPoleBlock> | null;
  lamp: z.infer<typeof lampBlock> | null;
  burner: z.infer<typeof burnerBlock> | null;
  furnace: z.infer<typeof furnaceBlock> | null;
  fluid_boxes: FluidBox[];
  /** Which layers contributed, for diagnostics. */
  mirrorsId: string | null;
}

export interface Ordering {
  group: string;
  subgroup: string;
  order: string;
}

export interface Overlay {
  groups: Map<string, { order: string; index: number }>;
  subgroups: Map<string, { group: string; order: string; index: number }>;
  defaults: z.infer<typeof defaultsFile>;
  mirrors: z.infer<typeof mirrorsFile>;
  prototypes: z.infer<typeof prototypesFile>;
  sets: z.infer<typeof setsFile>;
  terrain: TerrainTable;
  /** Empty tables when sounds.yaml does not exist yet. */
  sounds: SoundTables;
  sources: OverlaySources;
}

export interface OverlaySources {
  groups: SourceFile;
  defaults: SourceFile;
  mirrors: SourceFile;
  prototypes: SourceFile;
  sets: SourceFile;
  terrain: SourceFile;
  /** Optional: absent until the audio package adds it. */
  sounds: SourceFile | null;
}

function parseWith<T>(schema: z.ZodType<T>, src: SourceFile, diags: Diagnostics): T | null {
  const r = schema.safeParse(src.value ?? {});
  if (r.success) return r.data;
  for (const issue of r.error.issues) diags.error(issue.message, at(src, issue.path as (string | number)[]));
  return null;
}

const byCodeUnits = (a: string, b: string): number => compareCodeUnits(a, b);

export function loadOverlay(sources: OverlaySources, diags: Diagnostics): Overlay | null {
  const g = parseWith(groupsFile, sources.groups, diags);
  const d = parseWith(defaultsFile, sources.defaults, diags);
  const m = parseWith(mirrorsFile, sources.mirrors, diags);
  const p = parseWith(prototypesFile, sources.prototypes, diags);
  const sets = parseWith(setsFile, sources.sets, diags);
  const terrain = parseWith(terrainFile, sources.terrain, diags);
  const snd = sources.sounds ? parseWith(soundsFile, sources.sounds, diags) : { sounds: {} };
  if (!g || !d || !m || !p || !sets || !terrain || !snd) return null;
  // Sound ids are dense and sorted by name, in code-unit order (C1b decision 14; the audio module agrees).
  const names = Object.keys(snd.sounds).sort(byCodeUnits);
  const working = new Map(Object.entries(snd.working_sounds ?? {}));
  for (const [entity, sound] of working)
    if (!(sound in snd.sounds) && sources.sounds)
      diags.error(
        `working sound ${sound} of ${entity} is not a declared sound`,
        at(sources.sounds, ['working_sounds', entity]),
      );
  const planned = 'planned' in snd ? snd.planned : undefined;
  const plannedSounds = new Set(Object.keys(planned?.sounds ?? {}));
  if (planned && sources.sounds) {
    const src = sources.sounds;
    for (const name of [...plannedSounds].sort(byCodeUnits))
      if (name in snd.sounds)
        diags.error(
          `planned sound ${name} is already declared: drop it from planned`,
          at(src, ['planned', 'sounds', name]),
        );
    const known = (s: string) => s in snd.sounds || plannedSounds.has(s);
    for (const [table, entries] of [
      ['working_sounds', planned.working_sounds],
      ['footsteps', planned.footsteps],
    ] as const)
      for (const [k, s] of Object.entries(entries))
        if (!known(s))
          diags.error(
            `planned ${table} ${k} names ${s}, which is neither a sound nor a planned one`,
            at(src, ['planned', table, k]),
          );
    // Event maps: every string leaf names a sound (a name, or a rule's values: bySize, byKind).
    const leaves = (v: unknown, path: (string | number)[]): [string, (string | number)[]][] =>
      typeof v === 'string'
        ? [[v, path]]
        : v && typeof v === 'object'
          ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
              typeof x === 'number' ? [] : leaves(x, [...path, k]),
            )
          : [];
    for (const [s, path] of leaves(planned.events, ['planned', 'events']))
      if (!known(s))
        diags.error(
          `planned event map names ${s}, which is neither a sound nor a planned one`,
          at(src, path),
        );
  }
  const groups = new Map(g.groups.map((x, index) => [x.id, { order: x.order, index }]));
  const subgroups = new Map(g.subgroups.map((x, index) => [x.id, { group: x.group, order: x.order, index }]));
  g.subgroups.forEach((s, i) => {
    if (!groups.has(s.group))
      diags.error(`unknown group ${s.group}`, at(sources.groups, ['subgroups', i, 'group']));
  });
  const checkSub = (sub: string, path: (string | number)[], src: SourceFile): void => {
    if (!subgroups.has(sub)) diags.error(`unknown subgroup ${sub}`, at(src, path));
  };
  for (const [t, s] of Object.entries(d.item_subgroups.by_entity_type))
    checkSub(s, ['item_subgroups', 'by_entity_type', t], sources.defaults);
  d.item_subgroups.by_tag.forEach((x, i) => {
    checkSub(x.subgroup, ['item_subgroups', 'by_tag', i, 'subgroup'], sources.defaults);
  });
  for (const k of ['tile', 'fluid', 'fallback'] as const)
    checkSub(d.item_subgroups[k], ['item_subgroups', k], sources.defaults);
  for (const [kind, entries] of [
    ['items', p.items],
    ['recipes', p.recipes],
  ] as const) {
    for (const [pid, e] of Object.entries(entries))
      if (e.subgroup) checkSub(e.subgroup, [kind, pid, 'subgroup'], sources.prototypes);
  }
  return {
    groups,
    subgroups,
    defaults: d,
    mirrors: m,
    prototypes: p,
    sets,
    terrain: terrain.tiles,
    sounds: {
      names,
      working,
      planned: {
        sounds: plannedSounds,
        working: new Map(Object.entries(planned?.working_sounds ?? {})),
        footsteps: new Map(Object.entries(planned?.footsteps ?? {})),
      },
    },
    sources,
  };
}

/** J23: the defaults id is the leading [a-z0-9-]+ token of `mirrors`; `new` means none. */
export function mirrorsId(mirrors: string): string | null {
  const tok = /^[a-z0-9-]+/.exec(mirrors)?.[0] ?? null;
  return tok === null || tok === 'new' ? null : tok;
}

function footprintBox(e: Entity, inset: number): Box {
  const w = e.size[0] / 2;
  const h = e.size[1] / 2;
  return [-(w - inset), -(h - inset), w - inset, h - inset];
}

/** The types each block belongs to; a block on another type is an error. */
const BLOCK_TYPES: Record<BlockKey, (e: Entity) => boolean> = {
  inserter: (e) => e.type === 'inserter',
  mining_drill: (e) => e.type === 'mining-drill',
  offshore_pump: (e) => e.type === 'offshore-pump',
  electric_pole: (e) => e.type === 'electric-pole',
  lamp: (e) => e.type === 'lamp',
  burner: (e) => e.energy.source === 'burner',
  furnace: (e) => e.type === 'furnace',
};

/** Types whose box the character keeps under trimmed collision (10 §4.4: chests, walls and gates). */
const UNTRIMMED: ReadonlySet<EntityType> = new Set(['chest', 'logistic-chest', 'wall', 'gate']);

/** Trimmed collision (10 §4.4): the collision box intersected with the footprint inset by 0.25 tile. */
export function trimmedBox(e: Entity, collision: Box): Box {
  if (UNTRIMMED.has(e.type)) return collision;
  const f = footprintBox(e, 0.25);
  return [
    Math.max(collision[0], f[0]),
    Math.max(collision[1], f[1]),
    Math.min(collision[2], f[2]),
    Math.min(collision[3], f[3]),
  ];
}

/**
 * A drill's mining area (10 §5.6): the tiles whose centres lie within `radius` of its centre on both axes. An
 * odd side puts the centre on a tile centre, an even one on a tile edge: 0.99 on 2 × 2 is 2 × 2, 2.49 on 3 × 3
 * is 5 × 5, as in Factorio.
 */
export function miningArea(size: readonly [number, number], radius: number): [number, number] {
  const side = (s: number) => (s % 2 === 1 ? 2 * Math.floor(radius) + 1 : 2 * Math.floor(radius + 0.5));
  return [side(size[0]), side(size[1])];
}

/**
 * Resolves an entity's engine fields from the three layers. Reports an overlay field that collides with a
 * design field, a block on a type that takes none, and (as an error when `strict`, else a warning) an entity
 * whose `mirrors` is `new` without a per-prototype entry.
 */
export function resolveEntity(e: Entity, ov: Overlay, diags: Diagnostics, strict: boolean): EntityEngine {
  const all = ov.defaults.entity_types._all ?? {};
  const byType = ov.defaults.entity_types[e.type as EntityType] ?? {};
  const mid = mirrorsId(e.mirrors);
  const fromMirrors = mid ? ov.mirrors.entities[mid] : undefined;
  const own = ov.prototypes.entities[e.id];
  const design = new Set([...Object.keys(e), ...Object.keys(e.extra ?? {})]);
  for (const [layer, src, path, fields] of [
    ['mirrors.yaml', ov.sources.mirrors, ['entities', mid ?? ''], fromMirrors],
    ['prototypes.yaml', ov.sources.prototypes, ['entities', e.id], own],
  ] as const) {
    for (const k of Object.keys(fields ?? {}))
      if (design.has(k))
        diags.error(
          `${layer} sets ${k} for entity ${e.id}, a field the design data carries: change the design YAML instead`,
          at(src, [...path, k]),
        );
    for (const b of BLOCKS)
      if (fields?.[b] !== undefined && !BLOCK_TYPES[b](e))
        diags.error(
          `${layer} gives entity ${e.id} (a ${e.type}${b === 'burner' ? ` with a ${e.energy.source} energy source` : ''}) a ${b} block, which it does not take`,
          at(src, [...path, b]),
        );
  }
  if (!mid && !own) {
    const msg = `entity ${e.id} mirrors \`new\`, so it needs a full entry in game/data/engine/prototypes.yaml (J23)`;
    const where = { file: 'game/data/engine/prototypes.yaml' };
    if (strict) diags.error(msg, where);
    else diags.warn(msg, where);
  }
  const layers: EntityLayer[] = [all, byType, fromMirrors ?? {}, own ?? {}];
  const merged: EntityLayer = Object.assign({}, ...layers);
  const block = <K extends BlockKey>(k: K): NonNullable<EntityLayer[K]> | null =>
    BLOCK_TYPES[k](e)
      ? (Object.assign({}, ...layers.map((l) => l[k] ?? {})) as NonNullable<EntityLayer[K]>)
      : null;
  const inset = merged.collision_inset ?? 0.3;
  const collision = (merged.collision_box as Box | undefined) ?? footprintBox(e, inset);
  const drill = block('mining_drill');
  const ins = block('inserter');
  return {
    collision_box: collision,
    selection_box: (merged.selection_box as Box | undefined) ?? footprintBox(e, 0),
    player_collision_box: trimmedBox(e, collision),
    mining_time: merged.mining_time ?? 0.2,
    rotatable: merged.rotatable ?? true,
    flippable: merged.flippable ?? false,
    selection_priority: merged.selection_priority ?? 50,
    fast_replaceable_group: merged.fast_replaceable_group ?? null,
    next_upgrade: merged.next_upgrade ?? null,
    sprite: merged.sprite ?? `entity/${e.id}`,
    collision_mask: [...(merged.collision_mask ?? [])].sort(byCodeUnits) as CollisionLayer[],
    map_color: merged.map_color ?? '',
    // InserterPrototype's defaults (Lua API 2.0): hand_size 0.75, starting_distance 0.7, bulk false.
    inserter: ins ? { hand_size: 0.75, starting_distance: 0.7, bulk: false, ...ins } : null,
    mining_drill: drill
      ? {
          ...drill,
          ...(drill.resource_searching_radius !== undefined
            ? { mining_area: miningArea(e.size, drill.resource_searching_radius) }
            : {}),
        }
      : null,
    offshore_pump: block('offshore_pump'),
    electric_pole: block('electric_pole'),
    lamp: block('lamp'),
    burner: block('burner'),
    furnace: block('furnace'),
    fluid_boxes: (merged.fluid_boxes ?? []) as FluidBox[],
    mirrorsId: mid,
  };
}

/**
 * An item's group, subgroup and order: the per-item entry, else the default subgroup rules; the order
 * defaults to the item's position in items.yaml, zero-padded, so the crafting grid follows the file.
 */
export function itemOrdering(it: Item, index: number, placedType: EntityType | null, ov: Overlay): Ordering {
  const own = ov.prototypes.items[it.id];
  const rules = ov.defaults.item_subgroups;
  let subgroup = own?.subgroup;
  if (!subgroup) {
    if (it.type === 'fluid') subgroup = rules.fluid;
    else if (placedType) subgroup = rules.by_entity_type[placedType] ?? rules.fallback;
    else if (it.places_tile) subgroup = rules.tile;
    else
      subgroup = rules.by_tag.find((t) => (it.tags as string[]).includes(t.tag))?.subgroup ?? rules.fallback;
  }
  const group = own?.group ?? ov.subgroups.get(subgroup)?.group ?? 'other';
  return { group, subgroup, order: own?.order ?? String(index).padStart(4, '0') };
}

/** The sort key of an ordering (10 §2.4 step 5): group order, subgroup order, item order, then id. */
export function orderingKey(o: Ordering, ov: Overlay, idStr: string): (string | number)[] {
  const g = ov.groups.get(o.group);
  const s = ov.subgroups.get(o.subgroup);
  return [g?.order ?? '~', g?.index ?? 0, s?.order ?? '~', s?.index ?? 0, o.order, idStr];
}
