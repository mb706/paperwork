// The prototype tables of prototypes.bin (10 §15.2): one column table per kind, plus the LISTS, META,
// EXPR and NAMES sections. This declarative description is C1a's first version of what
// schema/protos.yaml will hold (C1b moves it there and generates both the writer and Rust's loader from
// it); every column names its source in the design data or the overlay.
//
// Units are converted to the engine's (10 §4.2): energy in J, power in W, times in seconds.
import { ByteWriter } from '../../lib/bytes.ts';
import { sortedEntries } from '../../lib/canonical.ts';
import { toHex } from '../../lib/hash.ts';
import { EXPR_NONE } from '../expr.ts';
import {
  type EntityRec,
  type ItemRec,
  type Model,
  NONE_U8,
  NONE_U16,
  PROTO_KINDS,
  type ProtoKind,
  type Ranked,
  type RecipeRec,
  stackRef,
  type TechRec,
} from '../model.ts';
import { ENERGY_SOURCES, ENTITY_TYPES } from '../schema/entities.ts';
import { ITEM_TAGS } from '../schema/items.ts';
import { REGIMES, TRIGGER_TYPES } from '../schema/technologies.ts';
import { RESOURCE_KINDS, type Resource, type Tile, WORLD_KINDS, type WorldObject } from '../schema/world.ts';
import { triggerTarget } from '../triggers.ts';
import type { ColType } from './container.ts';

/** Section ids of prototypes.bin. */
export const SECTION_IDS = {
  PROTO_ITEM: 1,
  PROTO_FLUID: 2,
  PROTO_RECIPE: 3,
  PROTO_ENTITY: 4,
  PROTO_TECH: 5,
  PROTO_RESOURCE: 6,
  PROTO_TILE: 7,
  PROTO_WORLD: 8,
  PROTO_SIGNAL: 9,
  LISTS: 16,
  META: 17,
  EXPR: 18,
  NAMES: 19,
} as const;

/** Record types in the META section: 1 the start record, 2 what the file carries and omits (contents.ts). */
export const META_RECORDS = { start: 1, contents: 2 } as const;

export interface ColumnSpec {
  name: string;
  type: ColType;
  /** Where the value comes from (documentation; becomes protos.yaml's source path). */
  from: string;
  /** The field in the prototype's YAML that a bad value points at, when there is one. */
  path?: readonly (string | number)[];
}

export interface Ctx {
  model: Model;
  lists: ListPool;
  exprs: ExprPool;
}

export interface TableSpec<R> {
  section: keyof typeof SECTION_IDS;
  kind: ProtoKind;
  rows: (m: Model) => readonly R[];
  columns: readonly ColumnSpec[];
  row: (r: R, c: Ctx) => Record<string, number | boolean>;
}

/** Variable-length parts, addressed from the columns by (u32 byte offset, u16 count); each list 8-aligned. */
export class ListPool {
  private readonly w = new ByteWriter();

  add(count: number, write: (w: ByteWriter) => void): { off: number; count: number } {
    if (count === 0) return { off: 0, count: 0 };
    if (count > 0xffff) throw new Error(`a list of ${count} entries exceeds u16`);
    this.w.pad(8);
    const off = this.w.length;
    write(this.w);
    return { off, count };
  }

  finish(): Uint8Array {
    this.w.pad(8);
    return this.w.finish();
  }
}

/** The expression bytecode pool: identical programs share one offset (an ExprRef). */
export class ExprPool {
  private readonly w = new ByteWriter();
  private readonly seen = new Map<string, number>();

  add(code: Uint8Array): number {
    const key = toHex(code);
    const have = this.seen.get(key);
    if (have !== undefined) return have;
    const off = this.w.length;
    this.w.bytes(code);
    this.seen.set(key, off);
    return off;
  }

  finish(): Uint8Array {
    return this.w.finish();
  }
}

/** A value an emitter cannot write, with the field of the prototype it comes from. */
export class EmitError extends Error {
  readonly path: readonly (string | number)[];
  constructor(message: string, path: readonly (string | number)[] = []) {
    super(message);
    this.path = path;
  }
}

const MJ = 1e6;
const KW = 1e3;
const KJ = 1e3;

function enumIndex<T extends string>(list: readonly T[], v: T | undefined, none = NONE_U8): number {
  if (v === undefined) return none;
  const i = list.indexOf(v);
  if (i < 0) throw new Error(`${v} is not one of ${list.join(', ')}`);
  return i;
}

function idOr(m: Model, kind: ProtoKind, name: string | undefined, none = NONE_U16): number {
  if (name === undefined) return none;
  return m.ids[kind].get(name) ?? none;
}

function exprRef(c: Ctx, owner: string): number {
  const use = c.model.formulas.uses.find((u) => u.name === owner);
  return use ? c.exprs.add(use.compiled.code) : EXPR_NONE;
}

const box = (prefix: string, from: string): ColumnSpec[] =>
  ['x0', 'y0', 'x1', 'y1'].map((k) => ({
    name: `${prefix}_${k}`,
    type: 'f64' as const,
    from: `${from}[${k}]`,
  }));
const list = (name: string, from: string): ColumnSpec[] => [
  { name: `${name}_off`, type: 'u32', from: `${from} (LISTS byte offset)` },
  { name: `${name}_count`, type: 'u16', from: `${from} (entries)` },
];

/** IngredientEntry (16 bytes): u8 kind (0 item, 1 fluid), u8 reserved, u16 id, u32 reserved, f64 amount. */
export const INGREDIENT_ENTRY_BYTES = 16;
/**
 * ProductEntry (32 bytes): u8 kind, u8 flags (bit 0: not affected by quality), u16 id, u32 amount_expr
 * (ExprRef of amounts_by_j), f64 amount, f64 probability, f64 catalyst.
 */
export const PRODUCT_ENTRY_BYTES = 32;
/** PackEntry (16 bytes): u16 item id, u16 reserved, u32 reserved, f64 amount per unit. */
export const PACK_ENTRY_BYTES = 16;
/** YieldEntry (12 bytes): u16 item id, u16 reserved, u32 min, u32 max. */
export const YIELD_ENTRY_BYTES = 12;

const items: TableSpec<ItemRec> = {
  section: 'PROTO_ITEM',
  kind: 'item',
  rows: (m) => m.items,
  columns: [
    { name: 'stack_size', type: 'u32', from: 'items.stack', path: ['stack'] },
    { name: 'places_entity', type: 'u16', from: 'items.places (EntityId; 0xFFFF none)' },
    { name: 'places_tile', type: 'u8', from: 'items.places_tile (TileId; 0xFF none)' },
    { name: 'fuel_value', type: 'f64', from: 'items.fuel_value (MJ → J)', path: ['fuel_value'] },
    {
      name: 'fuel_category',
      type: 'u8',
      from: 'items.fuel_category (index in meta.fuel_categories; 0xFF none)',
    },
    { name: 'tier', type: 'u8', from: 'items.tier (index in meta.tiers)' },
    { name: 'tags', type: 'u16', from: 'items.tags (bit i = ITEM_TAGS[i])' },
  ],
  row: (r, c) => ({
    stack_size: r.data.stack ?? 0,
    places_entity: idOr(c.model, 'entity', r.data.places),
    places_tile: idOr(c.model, 'tile', r.data.places_tile, NONE_U8),
    fuel_value: (r.data.fuel_value ?? 0) * MJ,
    fuel_category: enumIndex(c.model.design.meta.fuel_categories, r.data.fuel_category),
    tier: enumIndex(c.model.design.meta.tiers, r.data.tier),
    tags: r.data.tags.reduce((bits, t) => bits | (1 << ITEM_TAGS.indexOf(t)), 0),
  }),
};

const fluids: TableSpec<ItemRec> = {
  section: 'PROTO_FLUID',
  kind: 'fluid',
  rows: (m) => m.fluids,
  columns: [
    {
      name: 'default_temperature',
      type: 'f64',
      from: 'items.default_temperature (°C; 15 when absent, ISO)',
      path: ['default_temperature'],
    },
    {
      name: 'max_temperature',
      type: 'f64',
      from: 'items.max_temperature (°C; the default temperature when absent)',
      path: ['max_temperature'],
    },
    {
      name: 'heat_capacity',
      type: 'f64',
      from: 'items.heat_capacity_kj_per_k (kJ/K → J/K; 1 kJ/K when absent, ISO)',
      path: ['heat_capacity_kj_per_k'],
    },
    { name: 'tier', type: 'u8', from: 'items.tier (index in meta.tiers)' },
  ],
  row: (r, c) => {
    const t = r.data.default_temperature ?? 15;
    return {
      default_temperature: t,
      max_temperature: r.data.max_temperature ?? t,
      heat_capacity: (r.data.heat_capacity_kj_per_k ?? 1) * KJ,
      tier: enumIndex(c.model.design.meta.tiers, r.data.tier),
    };
  },
};

const recipes: TableSpec<RecipeRec> = {
  section: 'PROTO_RECIPE',
  kind: 'recipe',
  rows: (m) => m.recipes,
  columns: [
    { name: 'category', type: 'u8', from: 'recipes.category (index in meta.crafting_categories)' },
    { name: 'energy_required', type: 'f64', from: 'recipes.time (s at crafting speed 1)', path: ['time'] },
    ...list('ingredients', 'recipes.ingredients (IngredientEntry)'),
    ...list('products', 'recipes.products (ProductEntry)'),
    { name: 'handcraft', type: 'bool', from: 'recipes.handcraft (default: category is crafting)' },
    { name: 'allow_productivity', type: 'bool', from: 'recipes.allow_productivity (default false)' },
    { name: 'container', type: 'u8', from: 'recipes.container (0 none, 1 fill, 2 empty)' },
    { name: 'enabled_at_start', type: 'bool', from: "prior-art's unlocks and meta.start.recipes" },
  ],
  row: (r, c) => {
    const m = c.model;
    const ing = c.lists.add(r.data.ingredients.length, (w) => {
      for (const x of r.data.ingredients) {
        const s = stackRef(m, x.id);
        if (!s) throw new Error(`recipe ${r.id}: ingredient ${x.id} is outside the build`);
        w.u8(s.kind).u8(0).u16(s.id).u32(0).f64(x.amount);
      }
    });
    const prod = c.lists.add(r.data.products.length, (w) => {
      for (const x of r.data.products) {
        const s = stackRef(m, x.id);
        if (!s) throw new Error(`recipe ${r.id}: product ${x.id} is outside the build`);
        const flags = x.affected_by_quality === false ? 1 : 0;
        w.u8(s.kind)
          .u8(flags)
          .u16(s.id)
          .u32(exprRef(c, `amounts_by_j/${r.id}/${x.id}`));
        w.f64(x.amount)
          .f64(x.probability ?? 1)
          .f64(x.catalyst ?? 0);
      }
    });
    return {
      category: enumIndex(m.design.meta.crafting_categories, r.data.category),
      energy_required: r.data.time,
      ingredients_off: ing.off,
      ingredients_count: ing.count,
      products_off: prod.off,
      products_count: prod.count,
      handcraft: r.data.handcraft ?? r.data.category === 'crafting',
      allow_productivity: r.data.allow_productivity ?? false,
      container: r.data.container === 'fill' ? 1 : r.data.container === 'empty' ? 2 : 0,
      enabled_at_start: m.build.startRecipes.has(r.id),
    };
  },
};

const entities: TableSpec<EntityRec> = {
  section: 'PROTO_ENTITY',
  kind: 'entity',
  rows: (m) => m.entities,
  columns: [
    { name: 'type', type: 'u8', from: 'entities.type (index in ENTITY_TYPES)' },
    { name: 'size_w', type: 'u8', from: 'entities.size[0]', path: ['size', 0] },
    { name: 'size_h', type: 'u8', from: 'entities.size[1]', path: ['size', 1] },
    { name: 'item', type: 'u16', from: 'entities.item (ItemId: placed by, mined into)' },
    ...box('collision', 'overlay collision_box'),
    ...box('selection', 'overlay selection_box'),
    { name: 'mining_time', type: 'f64', from: 'overlay mining_time (s, by hand)' },
    { name: 'selection_priority', type: 'u8', from: 'overlay selection_priority' },
    { name: 'rotatable', type: 'bool', from: 'overlay rotatable' },
    { name: 'flippable', type: 'bool', from: 'overlay flippable' },
    { name: 'energy_source', type: 'u8', from: 'entities.energy.source (index in ENERGY_SOURCES)' },
    { name: 'energy_usage', type: 'f64', from: 'entities.energy.kw (kW → W)', path: ['energy', 'kw'] },
    { name: 'drain', type: 'f64', from: 'entities.energy.drain_kw (kW → W)', path: ['energy', 'drain_kw'] },
    {
      name: 'crafting_speed',
      type: 'f64',
      from: 'entities.crafting_speed (0 when absent)',
      path: ['crafting_speed'],
    },
    {
      name: 'mining_speed',
      type: 'f64',
      from: 'entities.mining_speed (0 when absent)',
      path: ['mining_speed'],
    },
    { name: 'module_slots', type: 'u8', from: 'entities.module_slots', path: ['module_slots'] },
    {
      name: 'inventory_slots',
      type: 'u16',
      from: 'entities.extra.slots (chests, wagons; 0 otherwise)',
      path: ['extra', 'slots'],
    },
    {
      name: 'belt_speed',
      type: 'u16',
      from: 'entities.extra.items_per_s of a belt, as positions per tick (15 → 8)',
      path: ['extra', 'items_per_s'],
    },
    { name: 'computing', type: 'bool', from: 'entities.heat.class is set (10 §5.9)' },
    {
      name: 't_star',
      type: 'f64',
      from: 'meta.heat.classes[entities.heat.class] (°C; 0 when not computing)',
    },
    { name: 'placement', type: 'u8', from: 'entities.placement (0 none, 1 must_be_on, 2 must_touch)' },
    {
      name: 'placement_resource',
      type: 'u16',
      from: 'entities.placement.must_be_on (ResourceId; 0xFFFF none)',
    },
    ...list('placement_tiles', 'entities.placement.must_touch (u8 TileId each)'),
  ],
  row: (r, c) => {
    const e = r.data;
    const g = r.engine;
    const extra = e.extra as { slots?: unknown; items_per_s?: unknown } | undefined;
    const slots = extra?.slots;
    const cls = e.heat?.class;
    const pl = e.placement;
    const touch =
      pl && 'must_touch' in pl ? (typeof pl.must_touch === 'string' ? [pl.must_touch] : pl.must_touch) : [];
    const tiles = c.lists.add(touch.length, (w) => {
      for (const t of touch) w.u8(idOr(c.model, 'tile', t, NONE_U8));
    });
    return {
      type: enumIndex(ENTITY_TYPES, e.type),
      size_w: e.size[0],
      size_h: e.size[1],
      item: idOr(c.model, 'item', e.item),
      collision_x0: g.collision_box[0],
      collision_y0: g.collision_box[1],
      collision_x1: g.collision_box[2],
      collision_y1: g.collision_box[3],
      selection_x0: g.selection_box[0],
      selection_y0: g.selection_box[1],
      selection_x1: g.selection_box[2],
      selection_y1: g.selection_box[3],
      mining_time: g.mining_time,
      selection_priority: g.selection_priority,
      rotatable: g.rotatable,
      flippable: g.flippable,
      energy_source: enumIndex(ENERGY_SOURCES, e.energy.source),
      energy_usage: (e.energy.kw ?? 0) * KW,
      drain: (e.energy.drain_kw ?? 0) * KW,
      crafting_speed: e.crafting_speed ?? 0,
      mining_speed: e.mining_speed ?? 0,
      module_slots: e.module_slots ?? 0,
      inventory_slots: typeof slots === 'number' ? slots : 0,
      belt_speed:
        e.type === 'belt' && typeof extra?.items_per_s === 'number' ? beltSpeed(e.id, extra.items_per_s) : 0,
      computing: cls !== undefined,
      t_star: cls !== undefined ? (c.model.design.meta.heat.classes[cls] ?? 0) : 0,
      placement: pl === undefined ? 0 : 'must_be_on' in pl ? 1 : 2,
      placement_resource: pl && 'must_be_on' in pl ? idOr(c.model, 'resource', pl.must_be_on) : NONE_U16,
      placement_tiles_off: tiles.off,
      placement_tiles_count: tiles.count,
    };
  },
};

/**
 * A belt's speed in positions (1/256 tile) per tick from its throughput (10 §2.4 step 3): two lanes of
 * items 1/4 tile apart, so positions per tick = items_per_s / 2 × 64 / 60 = items_per_s × 8 / 15. It must
 * be a whole number, as Factorio's belt speeds are (15 → 8, 30 → 16, 45 → 24).
 */
export function beltSpeed(id: string, itemsPerS: number): number {
  const v = (itemsPerS * 8) / 15;
  if (!Number.isInteger(v))
    throw new Error(`belt ${id}: ${itemsPerS} items/s is ${v} positions per tick, not a whole number`);
  return v;
}

/** The trigger's target as (ProtoKind, id); throws when it is not in the build (C1a-r1 finding 4). */
const triggerTargetId = (m: Model, t: TechRec): { kind: number; id: number } => {
  const tr = t.data.trigger;
  if (!tr) return { kind: NONE_U8, id: NONE_U16 };
  const names = (k: ProtoKind) => new Set(m.ids[k].keys());
  const r = triggerTarget(tr, {
    items: new Set([...names('item'), ...names('fluid')]),
    recipes: names('recipe'),
    entities: names('entity'),
    resources: names('resource'),
  });
  if (r === null) return { kind: NONE_U8, id: NONE_U16 };
  if (typeof r === 'string') throw new EmitError(r, ['trigger']);
  const kind: ProtoKind = r.kind === 'item' ? (m.ids.item.has(r.name) ? 'item' : 'fluid') : r.kind;
  return { kind: PROTO_KINDS.indexOf(kind), id: m.ids[kind].get(r.name) as number };
};

const technologies: TableSpec<TechRec> = {
  section: 'PROTO_TECH',
  kind: 'technology',
  rows: (m) => m.technologies,
  columns: [
    {
      name: 'count',
      type: 'f64',
      from: 'technologies.cost.count (0 with a count_formula or a trigger)',
      path: ['cost', 'count'],
    },
    { name: 'count_expr', type: 'u32', from: 'technologies.count_formula (ExprRef; 0xFFFFFFFF none)' },
    { name: 'time', type: 'f64', from: 'technologies.cost.time (s per unit)', path: ['cost', 'time'] },
    { name: 'first_level', type: 'u32', from: 'technologies.first_level (1)' },
    {
      name: 'max_level',
      type: 'u32',
      from: 'technologies.max_level, or the level cap of an infinite technology',
    },
    { name: 'infinite', type: 'bool', from: 'technologies.max_level == infinite' },
    ...list('packs', 'technologies.cost.packs (PackEntry)'),
    ...list('prerequisites', 'technologies.prerequisites (u16 TechId each)'),
    ...list('unlock_recipes', 'technologies.unlocks.recipes (u16 RecipeId each)'),
    {
      name: 'trigger_type',
      type: 'u8',
      from: 'technologies.trigger.type (index in TRIGGER_TYPES; 0xFF none)',
    },
    { name: 'trigger_target_kind', type: 'u8', from: 'the trigger target kind (ProtoKind; 0xFF none)' },
    {
      name: 'trigger_target',
      type: 'u16',
      from: 'technologies.trigger.item, .entity or .recipe (id in its kind)',
    },
    {
      name: 'trigger_count',
      type: 'u32',
      from: 'technologies.trigger.count (1)',
      path: ['trigger', 'count'],
    },
    { name: 'field_year_expr', type: 'u32', from: 'technologies.field_year (ExprRef; 0xFFFFFFFF none)' },
    { name: 'regime', type: 'u8', from: 'technologies.regime (index in REGIMES)' },
    { name: 'hidden', type: 'bool', from: 'technologies.hidden' },
    { name: 'essential', type: 'bool', from: 'technologies.essential' },
    { name: 'upgrade', type: 'bool', from: 'technologies.upgrade' },
  ],
  row: (t, c) => {
    const m = c.model;
    // Packs in tier order (meta.tiers), whatever their order in the YAML.
    const cost = t.data.cost?.packs ?? {};
    const packs = m.design.meta.tiers.filter((p) => cost[p] !== undefined);
    const pk = c.lists.add(packs.length, (w) => {
      for (const p of packs)
        w.u16(idOr(m, 'item', p))
          .u16(0)
          .u32(0)
          .f64(cost[p] as number);
    });
    const ids = (kind: ProtoKind, names: readonly string[]) =>
      c.lists.add(names.length, (w) => {
        for (const n of names) w.u16(idOr(m, kind, n));
      });
    const pre = ids('technology', t.data.prerequisites);
    const unl = ids(
      'recipe',
      (t.data.unlocks.recipes ?? []).filter((r) => m.ids.recipe.has(r)),
    );
    const target = triggerTargetId(m, t);
    return {
      count: t.data.cost?.count ?? 0,
      count_expr: exprRef(c, `count_formula/${t.id}`),
      time: t.data.cost?.time ?? 0,
      first_level: t.levels.first,
      max_level: t.levels.last,
      infinite: t.levels.infinite,
      packs_off: pk.off,
      packs_count: pk.count,
      prerequisites_off: pre.off,
      prerequisites_count: pre.count,
      unlock_recipes_off: unl.off,
      unlock_recipes_count: unl.count,
      trigger_type: enumIndex(TRIGGER_TYPES, t.data.trigger?.type),
      trigger_target_kind: target.kind,
      trigger_target: target.id,
      trigger_count: t.data.trigger ? (t.data.trigger.count ?? 1) : 0,
      field_year_expr: exprRef(c, `field_year/${t.id}`),
      regime: enumIndex(REGIMES, t.data.regime),
      hidden: t.data.hidden ?? false,
      essential: t.data.essential ?? false,
      upgrade: t.data.upgrade ?? false,
    };
  },
};

const resources: TableSpec<Ranked<Resource>> = {
  section: 'PROTO_RESOURCE',
  kind: 'resource',
  rows: (m) => m.resources,
  columns: [
    { name: 'kind', type: 'u8', from: 'resources.kind (index in RESOURCE_KINDS)' },
    { name: 'yield_kind', type: 'u8', from: 'resources.yields (0 item, 1 fluid)' },
    { name: 'yield_id', type: 'u16', from: 'resources.yields (ItemId or FluidId)' },
    {
      name: 'mining_time',
      type: 'f64',
      from: 'resources.mining_time (s at mining speed 1; 0 for fluids)',
      path: ['mining_time'],
    },
    { name: 'infinite', type: 'bool', from: 'resources.infinite' },
    { name: 'requires_fluid', type: 'u16', from: 'resources.requires_fluid (FluidId; 0xFFFF none)' },
  ],
  row: (r, c) => {
    const y = stackRef(c.model, r.data.yields);
    return {
      kind: enumIndex(RESOURCE_KINDS, r.data.kind),
      yield_kind: y?.kind ?? NONE_U8,
      yield_id: y?.id ?? NONE_U16,
      mining_time: r.data.mining_time ?? 0,
      infinite: r.data.infinite ?? false,
      requires_fluid: idOr(c.model, 'fluid', r.data.requires_fluid),
    };
  },
};

const tiles: TableSpec<Ranked<Tile>> = {
  section: 'PROTO_TILE',
  kind: 'tile',
  rows: (m) => m.tiles,
  columns: [
    { name: 'kappa_per_s', type: 'f64', from: 'tiles.kappa_per_s (0 when null)', path: ['kappa_per_s'] },
    { name: 'has_kappa', type: 'bool', from: 'tiles.kappa_per_s is not null' },
    {
      name: 'walking_speed',
      type: 'f64',
      from: 'tiles.walking_speed (0 when null)',
      path: ['walking_speed'],
    },
    { name: 'walkable', type: 'bool', from: 'tiles.walking_speed is not null' },
    { name: 'buildable', type: 'bool', from: 'tiles.buildable' },
    { name: 'map_color', type: 'u32', from: 'tiles.map_color (0xRRGGBB)' },
    { name: 'placed_by', type: 'u16', from: 'tiles.placed_by (ItemId; 0xFFFF none)' },
    { name: 'minable_back', type: 'bool', from: 'tiles.minable_back' },
    { name: 'town', type: 'bool', from: 'tiles.town' },
  ],
  row: (t, c) => ({
    kappa_per_s: t.data.kappa_per_s ?? 0,
    has_kappa: t.data.kappa_per_s !== null,
    walking_speed: t.data.walking_speed ?? 0,
    walkable: t.data.walking_speed !== null,
    buildable: t.data.buildable,
    map_color: Number.parseInt(t.data.map_color.slice(1), 16),
    placed_by: idOr(c.model, 'item', t.data.placed_by),
    minable_back: t.data.minable_back,
    town: t.data.town ?? false,
  }),
};

const world: TableSpec<Ranked<WorldObject>> = {
  section: 'PROTO_WORLD',
  kind: 'world',
  rows: (m) => m.world,
  columns: [
    { name: 'kind', type: 'u8', from: 'world.kind (index in WORLD_KINDS)' },
    { name: 'size_w', type: 'u8', from: 'world.size[0]', path: ['size', 0] },
    { name: 'size_h', type: 'u8', from: 'world.size[1]', path: ['size', 1] },
    { name: 'mining_time', type: 'f64', from: 'world.mining_time (0: not minable)', path: ['mining_time'] },
    { name: 'collides', type: 'bool', from: 'world.collides' },
    { name: 'selectable', type: 'bool', from: 'world.selectable' },
    { name: 'cosmetic', type: 'bool', from: 'world.cosmetic' },
    { name: 'leaf_stages', type: 'u8', from: 'world.leaf_stages (0)', path: ['leaf_stages'] },
    ...list('yields', 'world.yields (YieldEntry)'),
  ],
  row: (o, c) => {
    // Yields by item id, whatever their order in the YAML.
    const ys = sortedEntries(o.data.yields ?? {}).sort(
      (a, b) => idOr(c.model, 'item', a[0]) - idOr(c.model, 'item', b[0]),
    );
    const y = c.lists.add(ys.length, (w) => {
      for (const [item, n] of ys) {
        const [lo, hi] = typeof n === 'number' ? [n, n] : n;
        w.u16(idOr(c.model, 'item', item))
          .u16(0)
          .u32(lo)
          .u32(hi);
      }
    });
    return {
      kind: enumIndex(WORLD_KINDS, o.data.kind),
      size_w: o.data.size[0],
      size_h: o.data.size[1],
      mining_time: o.data.mining_time ?? 0,
      collides: o.data.collides,
      selectable: o.data.selectable ?? false,
      cosmetic: o.data.cosmetic ?? false,
      leaf_stages: o.data.leaf_stages ?? 0,
      yields_off: y.off,
      yields_count: y.count,
    };
  },
};

const signals: TableSpec<Ranked<never>> = {
  section: 'PROTO_SIGNAL',
  kind: 'signal',
  rows: (m) => m.signals,
  columns: [],
  row: () => ({}),
};

/** The kind tables, in section order. */
export const TABLES: readonly TableSpec<never>[] = [
  items,
  fluids,
  recipes,
  entities,
  technologies,
  resources,
  tiles,
  world,
  signals,
] as unknown as readonly TableSpec<never>[];
