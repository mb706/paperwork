// The rows of prototypes.bin (10 §15.2) from the build's model, in the shape the generated writer takes
// (src/shared/gen/protos.ts, from schema/protos.yaml, which owns the layout since C1b). One row per
// prototype in id order; the engine's character is the entity table's last row. Names map to the schema's
// enums and flag sets (EntityType, Tier, CraftingCategory, ItemTags …), so a type, category, tier or tag
// the schema does not declare is refused here, at the YAML field it comes from. Units are converted to the
// engine's (10 §4.2): energy in J, power in W, times in seconds.

import {
  ENTITY_COLUMNS,
  type EntityRow,
  FLUID_COLUMNS,
  type FluidRow,
  ITEM_COLUMNS,
  type ItemRow,
  type ProtoColumnInfo,
  type ProtosInput,
  RECIPE_COLUMNS,
  RESOURCE_COLUMNS,
  type RecipeRow,
  type ResourceRow,
  TECHNOLOGY_COLUMNS,
  type TechnologyRow,
  TILE_COLUMNS,
  type TileRow,
  WORLD_OBJECT_COLUMNS,
  type WorldObjectRow,
} from '../../../src/shared/gen/protos.ts';
import {
  Biomes,
  ContainerKind,
  CraftingCategory,
  EnergySource,
  EntityType,
  FuelCategory,
  ItemTags,
  Placement,
  ProtoKind,
  Regime,
  ResourceKind,
  StackKind,
  Tier,
  TriggerType,
  WorldKind,
} from '../../../src/shared/gen/types.ts';
import { sortedEntries } from '../../lib/canonical.ts';
import { toHex } from '../../lib/hash.ts';
import { EXPR_NONE } from '../expr.ts';
import {
  CHARACTER,
  type ProtoKind as Kind,
  type Model,
  NONE_U8,
  NONE_U16,
  PROTO_KINDS,
  stackRef,
} from '../model.ts';
import { triggerTarget } from '../triggers.ts';
import { contentsRecord } from './contents.ts';

const MJ = 1e6;
const KW = 1e3;
const KJ = 1e3;

/** A value the stage cannot write, with the prototype and the YAML field it comes from (C1a-r1 finding 1). */
export interface EmitProblem {
  kind: Kind;
  id: string;
  /** The prototype's index in its YAML file (-1: not a design prototype, e.g. the character). */
  filePos: number;
  path: readonly (string | number)[];
  message: string;
}

/** An emitter's refusal, with the field of the prototype it concerns. */
export class EmitError extends Error {
  readonly path: readonly (string | number)[];
  constructor(message: string, path: readonly (string | number)[] = []) {
    super(message);
    this.path = path;
  }
}

/** The value of a schema enum or flag bit named in the design data's spelling (`mining-drill` → `mining_drill`). */
function named(
  values: Readonly<Record<string, number>>,
  what: string,
  name: string,
  path: readonly (string | number)[],
): number {
  const key = name.replace(/-/g, '_');
  if (!Object.hasOwn(values, key))
    throw new EmitError(`${what} ${name} is not in the schema's ${what} enum (game/schema/types.yaml)`, path);
  return values[key] as number;
}

const optionalNamed = (
  values: Readonly<Record<string, number>>,
  what: string,
  name: string | undefined,
  path: readonly (string | number)[],
): number | null => (name === undefined ? null : named(values, what, name, path));

const bits = (
  values: Readonly<Record<string, number>>,
  what: string,
  names: readonly string[],
  path: readonly (string | number)[],
) => names.reduce((acc, n, i) => acc | named(values, what, n, [...path, i]), 0);

/** The expression bytecode pool: identical programs share one offset (an ExprRef). */
class ExprPool {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  private readonly seen = new Map<string, number>();

  add(code: Uint8Array): number {
    const key = toHex(code);
    const have = this.seen.get(key);
    if (have !== undefined) return have;
    const off = this.length;
    this.parts.push(code);
    this.length += code.length;
    this.seen.set(key, off);
    return off;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

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

const TYPE_NAMES: Record<number, string> = {
  1: 'u8',
  2: 'u16',
  3: 'u32',
  4: 'u64',
  5: 'i8',
  6: 'i16',
  7: 'i32',
  8: 'i64',
  9: 'f32',
  10: 'f64',
  11: 'bool',
};
const INT_RANGE: Record<number, [number, number]> = {
  1: [0, 0xff],
  2: [0, 0xffff],
  3: [0, 0xffffffff],
  4: [0, Number.MAX_SAFE_INTEGER],
  5: [-0x80, 0x7f],
  6: [-0x8000, 0x7fff],
  7: [-0x80000000, 0x7fffffff],
  8: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
};
const F32_MAX = 3.4028234663852886e38;

/** The §8.1 type name of a column's type code. */
export const typeName = (code: number): string => TYPE_NAMES[code] ?? `code ${code}`;

/** Why a value cannot be written to a column of this type code, or null. Floats must be finite (D6). */
export function valueProblem(code: number, v: unknown): string | null {
  if (v === null) return null; // an optional enum: written as its none value
  if (code === 11) return typeof v === 'boolean' ? null : `${String(v)} is not a boolean`;
  if (typeof v !== 'number') return `${String(v)} is not a number`;
  if (code === 9 || code === 10) {
    if (!Number.isFinite(v)) return `${v} is not a finite number`;
    if (code === 9 && Math.abs(v) > F32_MAX) return `${v} does not fit an f32`;
    return null;
  }
  const [lo, hi] = INT_RANGE[code] ?? [0, 0];
  if (!Number.isInteger(v)) return `${v} is not an integer`;
  if (v < lo || v > hi) return `${v} does not fit a ${typeName(code)}`;
  return null;
}

/** The data stage's kind names as the schema's ProtoKind values (`world` is world_object). */
const PROTO_KIND_VALUE: Record<Kind, number> = {
  item: ProtoKind.item,
  fluid: ProtoKind.fluid,
  recipe: ProtoKind.recipe,
  entity: ProtoKind.entity,
  technology: ProtoKind.technology,
  resource: ProtoKind.resource,
  tile: ProtoKind.tile,
  world: ProtoKind.world_object,
  signal: ProtoKind.signal,
};

/** The data stage's kinds in ProtoKind order (they must agree with the schema's). */
export function checkKindOrder(): string | null {
  for (const [i, k] of PROTO_KINDS.entries())
    if (PROTO_KIND_VALUE[k] !== i)
      return `the data stage's kind ${k} is ProtoKind ${PROTO_KIND_VALUE[k]}, not ${i}`;
  return null;
}

interface Table<R> {
  kind: Kind;
  columns: readonly ProtoColumnInfo[];
  rows: R[];
}

export interface ProtosRows {
  input: ProtosInput;
  problems: EmitProblem[];
}

/** Every row of every kind table, META, EXPR and NAMES, for the generated writer. */
export function protosInput(m: Model, schemaHash: Uint8Array): ProtosRows {
  const problems: EmitProblem[] = [];
  const exprs = new ExprPool();
  const idOr = (kind: Kind, name: string | undefined, none = NONE_U16): number =>
    name === undefined ? none : (m.ids[kind].get(name) ?? none);
  const exprRef = (owner: string): number => {
    const use = m.formulas.uses.find((u) => u.name === owner);
    return use ? exprs.add(use.compiled.code) : EXPR_NONE;
  };

  /** Builds one row per record, checking every scalar value against its column (C1a-r1 finding 1). */
  function table<T extends { id: string; filePos: number }, R extends object>(
    kind: Kind,
    columns: readonly ProtoColumnInfo[],
    recs: readonly T[],
    row: (r: T) => R,
  ): Table<R> {
    const rows: R[] = [];
    for (const r of recs) {
      let v: R;
      try {
        v = row(r);
      } catch (e) {
        if (!(e instanceof Error)) throw e;
        problems.push({
          kind,
          id: r.id,
          filePos: r.filePos,
          path: e instanceof EmitError ? e.path : [],
          message: e.message,
        });
        continue;
      }
      const values = v as Record<string, unknown>;
      for (const c of columns) {
        if (c.name.endsWith('_off') || c.name.endsWith('_count')) {
          const base = c.name.replace(/_(off|count)$/, '');
          if (Array.isArray(values[base])) continue;
        }
        const bad = valueProblem(c.code, values[c.name]);
        if (bad)
          problems.push({
            kind,
            id: r.id,
            filePos: r.filePos,
            path: c.path ?? [],
            message: `${c.name} (${c.from}): ${bad}`,
          });
      }
      rows.push(v);
    }
    return { kind, columns, rows };
  }

  const items = table(
    'item',
    ITEM_COLUMNS,
    m.items,
    (r): ItemRow => ({
      stack_size: r.data.stack ?? 0,
      places_entity: idOr('entity', r.data.places),
      places_tile: idOr('tile', r.data.places_tile, NONE_U8),
      fuel_value: (r.data.fuel_value ?? 0) * MJ,
      fuel_category: optionalNamed(FuelCategory, 'FuelCategory', r.data.fuel_category, ['fuel_category']),
      tier: optionalNamed(Tier, 'Tier', r.data.tier, ['tier']),
      tags: bits(ItemTags, 'ItemTags', r.data.tags, ['tags']),
    }),
  );

  const fluids = table('fluid', FLUID_COLUMNS, m.fluids, (r): FluidRow => {
    const t = r.data.default_temperature ?? 15;
    return {
      default_temperature: t,
      max_temperature: r.data.max_temperature ?? t,
      heat_capacity: (r.data.heat_capacity_kj_per_k ?? 1) * KJ,
      tier: optionalNamed(Tier, 'Tier', r.data.tier, ['tier']),
    };
  });

  const recipes = table(
    'recipe',
    RECIPE_COLUMNS,
    m.recipes,
    (r): RecipeRow => ({
      category: named(CraftingCategory, 'CraftingCategory', r.data.category, ['category']),
      energy_required: r.data.time,
      ingredients: r.data.ingredients.map((x, i) => {
        const s = stackRef(m, x.id);
        if (!s) throw new EmitError(`ingredient ${x.id} is outside the build`, ['ingredients', i]);
        return { kind: s.kind === 0 ? StackKind.item : StackKind.fluid, id: s.id, amount: x.amount };
      }),
      products: r.data.products.map((x, i) => {
        const s = stackRef(m, x.id);
        if (!s) throw new EmitError(`product ${x.id} is outside the build`, ['products', i]);
        return {
          kind: s.kind === 0 ? StackKind.item : StackKind.fluid,
          flags: x.affected_by_quality === false ? 1 : 0,
          id: s.id,
          amount_expr: exprRef(`amounts_by_j/${r.id}/${x.id}`),
          amount: x.amount,
          probability: x.probability ?? 1,
          catalyst: x.catalyst ?? 0,
        };
      }),
      handcraft: r.data.handcraft ?? r.data.category === 'crafting',
      allow_productivity: r.data.allow_productivity ?? false,
      container: named(ContainerKind, 'ContainerKind', r.data.container ?? 'none', ['container']),
      enabled_at_start: m.build.startRecipes.has(r.id),
    }),
  );

  const sounds = m.overlay.sounds;
  const soundId = (entity: string): number => {
    const name = sounds.working.get(entity);
    return name === undefined ? NONE_U16 : sounds.names.indexOf(name);
  };
  const entityRows = table('entity', ENTITY_COLUMNS, m.entities, (r): EntityRow => {
    const e = r.data;
    const g = r.engine;
    const extra = e.extra as { slots?: unknown; items_per_s?: unknown } | undefined;
    const cls = e.heat?.class;
    const pl = e.placement;
    const touch =
      pl && 'must_touch' in pl ? (typeof pl.must_touch === 'string' ? [pl.must_touch] : pl.must_touch) : [];
    return {
      type: named(EntityType, 'EntityType', e.type, ['type']),
      size_w: e.size[0],
      size_h: e.size[1],
      item: idOr('item', e.item),
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
      energy_source: named(EnergySource, 'EnergySource', e.energy.source, ['energy', 'source']),
      energy_usage: (e.energy.kw ?? 0) * KW,
      drain: (e.energy.drain_kw ?? 0) * KW,
      crafting_speed: e.crafting_speed ?? 0,
      mining_speed: e.mining_speed ?? 0,
      module_slots: e.module_slots ?? 0,
      inventory_slots: typeof extra?.slots === 'number' ? extra.slots : 0,
      belt_speed:
        e.type === 'belt' && typeof extra?.items_per_s === 'number' ? beltSpeed(e.id, extra.items_per_s) : 0,
      computing: cls !== undefined,
      t_star: cls !== undefined ? (m.design.meta.heat.classes[cls] ?? 0) : 0,
      placement:
        pl === undefined ? Placement.none : 'must_be_on' in pl ? Placement.must_be_on : Placement.must_touch,
      placement_resource: pl && 'must_be_on' in pl ? idOr('resource', pl.must_be_on) : NONE_U16,
      placement_tiles: touch.map((t) => idOr('tile', t, NONE_U8)),
      // Sound ids come from game/data/engine/sounds.yaml (10 §15.6; C1b decision 14): dense, sorted by name.
      working_sound: soundId(e.id),
      running_speed: 0,
      reach_distance: 0,
      build_distance: 0,
      resource_reach_distance: 0,
      item_pickup_distance: 0,
    };
  });
  if (m.character) {
    const c = m.character.engine;
    entityRows.rows.push({
      type: EntityType.character,
      size_w: 0, // not a grid entity: it moves in f64 tiles (§5.1)
      size_h: 0,
      item: NONE_U16,
      collision_x0: c.collision_box[0],
      collision_y0: c.collision_box[1],
      collision_x1: c.collision_box[2],
      collision_y1: c.collision_box[3],
      selection_x0: c.selection_box[0],
      selection_y0: c.selection_box[1],
      selection_x1: c.selection_box[2],
      selection_y1: c.selection_box[3],
      mining_time: 0,
      selection_priority: c.selection_priority ?? 50,
      rotatable: false,
      flippable: false,
      energy_source: EnergySource.none,
      energy_usage: 0,
      drain: 0,
      crafting_speed: c.crafting_speed,
      mining_speed: c.mining_speed,
      module_slots: 0,
      inventory_slots: c.inventory_size,
      belt_speed: 0,
      computing: false,
      t_star: 0,
      placement: Placement.none,
      placement_resource: NONE_U16,
      placement_tiles: [],
      working_sound: NONE_U16,
      running_speed: c.running_speed,
      reach_distance: c.reach_distance,
      build_distance: c.build_distance,
      resource_reach_distance: c.resource_reach_distance,
      item_pickup_distance: c.item_pickup_distance,
    });
  }

  const techs = table('technology', TECHNOLOGY_COLUMNS, m.technologies, (t): TechnologyRow => {
    // Packs in tier order (meta.tiers), whatever their order in the YAML.
    const cost = t.data.cost?.packs ?? {};
    const packs = m.design.meta.tiers.filter((p) => cost[p] !== undefined);
    const tr = t.data.trigger;
    let targetKind: number | null = null;
    let target = NONE_U16;
    if (tr) {
      const names = (k: Kind) => new Set(m.ids[k].keys());
      const r = triggerTarget(tr, {
        items: new Set([...names('item'), ...names('fluid')]),
        recipes: names('recipe'),
        entities: names('entity'),
        resources: names('resource'),
      });
      if (typeof r === 'string') throw new EmitError(r, ['trigger']);
      if (r !== null) {
        const kind: Kind = r.kind === 'item' ? (m.ids.item.has(r.name) ? 'item' : 'fluid') : r.kind;
        targetKind = PROTO_KIND_VALUE[kind];
        target = m.ids[kind].get(r.name) as number;
      }
    }
    return {
      count: t.data.cost?.count ?? 0,
      count_expr: exprRef(`count_formula/${t.id}`),
      time: t.data.cost?.time ?? 0,
      first_level: t.levels.first,
      max_level: t.levels.last,
      infinite: t.levels.infinite,
      packs: packs.map((p) => ({ item: idOr('item', p), per_unit: cost[p] as number })),
      prerequisites: t.data.prerequisites.map((p) => idOr('technology', p)),
      unlock_recipes: (t.data.unlocks.recipes ?? [])
        .filter((r) => m.ids.recipe.has(r))
        .map((r) => idOr('recipe', r)),
      trigger_type: optionalNamed(TriggerType, 'TriggerType', tr?.type, ['trigger', 'type']),
      trigger_target_kind: targetKind,
      trigger_target: target,
      trigger_count: tr ? (tr.count ?? 1) : 0,
      field_year_expr: exprRef(`field_year/${t.id}`),
      regime: named(Regime, 'Regime', t.data.regime, ['regime']),
      hidden: t.data.hidden ?? false,
      essential: t.data.essential ?? false,
      upgrade: t.data.upgrade ?? false,
    };
  });

  const resources = table('resource', RESOURCE_COLUMNS, m.resources, (r): ResourceRow => {
    const y = stackRef(m, r.data.yields);
    return {
      kind: named(ResourceKind, 'ResourceKind', r.data.kind, ['kind']),
      yield_kind: y === null ? null : y.kind === 0 ? StackKind.item : StackKind.fluid,
      yield_id: y?.id ?? NONE_U16,
      mining_time: r.data.mining_time ?? 0,
      infinite: r.data.infinite ?? false,
      requires_fluid: idOr('fluid', r.data.requires_fluid),
    };
  });

  const tiles = table(
    'tile',
    TILE_COLUMNS,
    m.tiles,
    (t): TileRow => ({
      kappa_per_s: t.data.kappa_per_s ?? 0,
      has_kappa: t.data.kappa_per_s !== null,
      walking_speed: t.data.walking_speed ?? 0,
      walkable: t.data.walking_speed !== null,
      buildable: t.data.buildable,
      map_color: Number.parseInt(t.data.map_color.slice(1), 16),
      placed_by: idOr('item', t.data.placed_by),
      minable_back: t.data.minable_back,
      town: t.data.town ?? false,
      biomes: bits(Biomes, 'Biomes', t.data.biome ?? [], ['biome']),
      // Tiles outside the build are left out: the tile cannot be placed on what the map never has.
      placed_on: (t.data.placed_on ?? [])
        .filter((x) => m.ids.tile.has(x))
        .map((x) => idOr('tile', x, NONE_U8)),
    }),
  );

  const world = table(
    'world',
    WORLD_OBJECT_COLUMNS,
    m.world,
    (o): WorldObjectRow => ({
      kind: named(WorldKind, 'WorldKind', o.data.kind, ['kind']),
      size_w: o.data.size[0],
      size_h: o.data.size[1],
      mining_time: o.data.mining_time ?? 0,
      collides: o.data.collides,
      selectable: o.data.selectable ?? false,
      cosmetic: o.data.cosmetic ?? false,
      leaf_stages: o.data.leaf_stages ?? 0,
      // Yields by item id, whatever their order in the YAML.
      yields: sortedEntries(o.data.yields ?? {})
        .map(([item, n]) => {
          const [lo, hi] = typeof n === 'number' ? [n, n] : n;
          return { item: idOr('item', item), min: lo, max: hi };
        })
        .sort((a, b) => a.item - b.item),
    }),
  );

  // META: the start inventory by item id, and what the file carries and omits.
  const inventory = [...m.build.startInventory]
    .map(([name, count]) => ({ item: m.ids.item.get(name), count }))
    .filter((x): x is { item: number; count: number } => x.item !== undefined)
    .sort((a, b) => a.item - b.item);
  const names = (list: readonly { id: string }[]) => list.map((r) => r.id);
  const input: ProtosInput = {
    schemaHash,
    item: items.rows,
    fluid: fluids.rows,
    recipe: recipes.rows,
    entity: entityRows.rows,
    technology: techs.rows,
    resource: resources.rows,
    tile: tiles.rows,
    world_object: world.rows,
    signal: [],
    meta: { start: { inventory }, contents: contentsRecord() },
    expr: exprs.finish(),
    names: {
      item: names(m.items),
      fluid: names(m.fluids),
      recipe: names(m.recipes),
      entity: [...names(m.entities), ...(m.character ? [CHARACTER] : [])],
      technology: names(m.technologies),
      resource: names(m.resources),
      tile: names(m.tiles),
      world_object: names(m.world),
      signal: names(m.signals),
    },
  };
  return { input, problems };
}
