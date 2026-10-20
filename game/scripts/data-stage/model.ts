// The build's prototypes with dense ids (10 §2.4 step 5): per kind, sorted by group, subgroup, order,
// then id (kinds without groups by id), and every reference resolved to an id.
import { compareTuples } from '../lib/canonical.ts';
import type { BuildSet } from './capabilities.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { Formulas, TechLevels } from './formulas.ts';
import {
  type EntityEngine,
  itemOrdering,
  type Ordering,
  type Overlay,
  orderingKey,
  resolveEntity,
} from './overlay.ts';
import type { Index } from './refs.ts';
import type { Entity } from './schema/entities.ts';
import type { DesignData } from './schema/index.ts';
import type { Item } from './schema/items.ts';
import type { Recipe } from './schema/recipes.ts';
import type { Technology } from './schema/technologies.ts';
import type { Resource, Tile, WorldObject } from './schema/world.ts';

/** The ProtoKind enum (10 §8.3): the order of the NAMES section and of remap tables. */
export const PROTO_KINDS = [
  'item',
  'fluid',
  'recipe',
  'entity',
  'technology',
  'resource',
  'tile',
  'world',
  'signal',
] as const;
export type ProtoKind = (typeof PROTO_KINDS)[number];

/** "None" in a u16 id column; tiles use 0xFF in their u8 columns (10 §4.3: at most 255 tile types). */
export const NONE_U16 = 0xffff;
export const NONE_U8 = 0xff;
/** Item keys hold the item index in 13 bits (10 §4.3: (itemIndex << 3) | quality). */
export const MAX_ITEMS = 8192;

export interface Ranked<T> {
  id: string;
  index: number;
  data: T;
  /** The position in its YAML file. */
  filePos: number;
}

export interface ItemRec extends Ranked<Item> {
  ordering: Ordering;
}
export interface EntityRec extends Ranked<Entity> {
  ordering: Ordering;
  engine: EntityEngine;
}
export interface RecipeRec extends Ranked<Recipe> {
  ordering: Ordering;
}
export interface TechRec extends Ranked<Technology> {
  levels: TechLevels;
}

export interface Model {
  build: BuildSet;
  items: ItemRec[];
  fluids: ItemRec[];
  recipes: RecipeRec[];
  entities: EntityRec[];
  technologies: TechRec[];
  resources: Ranked<Resource>[];
  tiles: Ranked<Tile>[];
  world: Ranked<WorldObject>[];
  signals: Ranked<never>[];
  /** Dense id per kind and name. */
  ids: Record<ProtoKind, Map<string, number>>;
  formulas: Formulas;
  design: DesignData;
  index: Index;
  overlay: Overlay;
}

/** An item-or-fluid reference: kind 0 item, 1 fluid. */
export interface StackRef {
  kind: 0 | 1;
  id: number;
}

export function buildModel(
  build: BuildSet,
  d: DesignData,
  ix: Index,
  ov: Overlay,
  formulas: Formulas,
  diags: Diagnostics,
  strict: boolean,
): Model {
  const pos = ix.position;
  const placedType = (it: Item) => (it.places ? (ix.entities.get(it.places)?.type ?? null) : null);
  const ordered = <R extends { id: string }>(list: R[], key: (r: R) => (string | number)[]): R[] =>
    [...list].sort((a, b) => compareTuples(key(a), key(b)));

  const itemRecs = [...build.items].map((iid): ItemRec => {
    const it = ix.items.get(iid) as Item;
    const filePos = pos.items?.get(iid) ?? 0;
    return { id: iid, index: 0, data: it, filePos, ordering: itemOrdering(it, filePos, placedType(it), ov) };
  });
  const sortItems = (recs: ItemRec[]) =>
    ordered(recs, (r) => orderingKey(r.ordering, ov, r.id)).map((r, index) => ({ ...r, index }));
  const items = sortItems(itemRecs.filter((r) => r.data.type === 'item'));
  const fluids = sortItems(itemRecs.filter((r) => r.data.type === 'fluid'));
  const itemOrd = new Map([...items, ...fluids].map((r) => [r.id, r.ordering]));

  const recipes = ordered(
    [...build.recipes].map((rid): RecipeRec => {
      const r = ix.recipes.get(rid) as Recipe;
      const own = ov.prototypes.recipes[rid];
      const main = itemOrd.get(r.products[0]?.id ?? '') ?? { group: 'other', subgroup: 'other', order: '' };
      const ordering: Ordering = {
        group:
          own?.group ?? (own?.subgroup ? (ov.subgroups.get(own.subgroup)?.group ?? 'other') : main.group),
        subgroup: own?.subgroup ?? main.subgroup,
        order: own?.order ?? main.order,
      };
      return { id: rid, index: 0, data: r, filePos: pos.recipes?.get(rid) ?? 0, ordering };
    }),
    (r) => orderingKey(r.ordering, ov, r.id),
  ).map((r, index) => ({ ...r, index }));

  const entities = ordered(
    [...build.entities].map((eid): EntityRec => {
      const e = ix.entities.get(eid) as Entity;
      return {
        id: eid,
        index: 0,
        data: e,
        filePos: pos.entities?.get(eid) ?? 0,
        ordering: itemOrd.get(e.item) ?? { group: 'other', subgroup: 'other', order: '' },
        engine: resolveEntity(e, ov, diags, strict),
      };
    }),
    (r) => orderingKey(r.ordering, ov, r.id),
  ).map((r, index) => ({ ...r, index }));

  const byId = <T>(list: Iterable<string>, map: Map<string, T>, kind: string): Ranked<T>[] =>
    [...list]
      .sort((a, b) => compareTuples([a], [b]))
      .map((x, index) => ({ id: x, index, data: map.get(x) as T, filePos: pos[kind]?.get(x) ?? 0 }));
  const technologies = byId(build.technologies, ix.technologies, 'technologies').map(
    (t): TechRec => ({ ...t, levels: formulas.levels.get(t.id) ?? { first: 1, last: 1, infinite: false } }),
  );
  const model: Model = {
    build,
    items,
    fluids,
    recipes,
    entities,
    technologies,
    resources: byId(build.resources, ix.resources, 'resources'),
    tiles: byId(build.tiles, ix.tiles, 'tiles'),
    world: byId(build.worldObjects, ix.world, 'world'),
    signals: [],
    ids: {} as Model['ids'],
    formulas,
    design: d,
    index: ix,
    overlay: ov,
  };
  const lists: Record<ProtoKind, { id: string }[]> = {
    item: model.items,
    fluid: model.fluids,
    recipe: model.recipes,
    entity: model.entities,
    technology: model.technologies,
    resource: model.resources,
    tile: model.tiles,
    world: model.world,
    signal: model.signals,
  };
  for (const k of PROTO_KINDS) model.ids[k] = new Map(lists[k].map((r, i) => [r.id, i]));
  const limits: Partial<Record<ProtoKind, number>> = { item: MAX_ITEMS, tile: NONE_U8 };
  for (const k of PROTO_KINDS) {
    const max = limits[k] ?? NONE_U16;
    if (lists[k].length > max)
      diags.error(`${build.name} holds ${lists[k].length} ${k} prototypes; ids allow at most ${max}`);
  }
  return model;
}

/** Resolves an item or fluid name inside the build. */
export function stackRef(m: Model, name: string): StackRef | null {
  const i = m.ids.item.get(name);
  if (i !== undefined) return { kind: 0, id: i };
  const f = m.ids.fluid.get(name);
  if (f !== undefined) return { kind: 1, id: f };
  return null;
}
