// The engine overlay (10 §2.4 step 2): game/data/engine/*.yaml. It holds only fields the design schema
// does not carry, in three layers: defaults per entity type, defaults per `mirrors` id, and per-prototype
// entries. The overlay may add engine fields; it may never set a number the design data carries (that
// is an error: the fix belongs in the design YAML).
import { z } from 'zod';
import type { Diagnostics } from './diagnostics.ts';
import { ENTITY_TYPES, type Entity, type EntityType } from './schema/entities.ts';
import type { Item } from './schema/items.ts';
import { at, type SourceFile } from './sources.ts';

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const box = z.tuple([z.number(), z.number(), z.number(), z.number()]);

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
};
const entityLayer = z.strictObject(entityFields);
const itemLayer = z.strictObject({
  group: id.optional(),
  subgroup: id.optional(),
  order: z.string().optional(),
  /** The icon set, where it differs from `item/<id>` (`fluid/<id>`), or for recipes the main product's. */
  icon: z.string().optional(),
});
const spriteLayer = z.strictObject({ sprite: z.string().optional() });
const setsFile = z.strictObject({
  tree_species: z.array(id),
  decoratives: z.array(id),
  cliffs: z.array(id),
  town_buildings: z.array(id),
});

const groupsFile = z.strictObject({
  groups: z.array(z.strictObject({ id, order: z.string() })),
  subgroups: z.array(z.strictObject({ id, group: id, order: z.string() })),
});
const defaultsFile = z.strictObject({
  entity_types: z.record(z.union([z.enum(ENTITY_TYPES), z.literal('_all')]), entityLayer),
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

/** An entity's resolved engine fields. */
export interface EntityEngine {
  collision_box: Box;
  selection_box: Box;
  mining_time: number;
  rotatable: boolean;
  flippable: boolean;
  selection_priority: number;
  fast_replaceable_group: string | null;
  next_upgrade: string | null;
  /** The entity's art set (10 §15.7): `entity/<id>` unless the overlay names another. */
  sprite: string;
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
  sources: OverlaySources;
}

export interface OverlaySources {
  groups: SourceFile;
  defaults: SourceFile;
  mirrors: SourceFile;
  prototypes: SourceFile;
  sets: SourceFile;
}

function parseWith<T>(schema: z.ZodType<T>, src: SourceFile, diags: Diagnostics): T | null {
  const r = schema.safeParse(src.value ?? {});
  if (r.success) return r.data;
  for (const issue of r.error.issues) diags.error(issue.message, at(src, issue.path as (string | number)[]));
  return null;
}

export function loadOverlay(sources: OverlaySources, diags: Diagnostics): Overlay | null {
  const g = parseWith(groupsFile, sources.groups, diags);
  const d = parseWith(defaultsFile, sources.defaults, diags);
  const m = parseWith(mirrorsFile, sources.mirrors, diags);
  const p = parseWith(prototypesFile, sources.prototypes, diags);
  const sets = parseWith(setsFile, sources.sets, diags);
  if (!g || !d || !m || !p || !sets) return null;
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
  return { groups, subgroups, defaults: d, mirrors: m, prototypes: p, sets, sources };
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

/**
 * Resolves an entity's engine fields from the three layers. Reports an overlay field that collides with a
 * design field, and (as an error when `strict`, else a warning) an entity whose `mirrors` is `new` without
 * a per-prototype entry.
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
  }
  if (!mid && !own) {
    const msg = `entity ${e.id} mirrors \`new\`, so it needs a full entry in game/data/engine/prototypes.yaml (J23)`;
    const where = { file: 'game/data/engine/prototypes.yaml' };
    if (strict) diags.error(msg, where);
    else diags.warn(msg, where);
  }
  const merged = { ...all, ...byType, ...(fromMirrors ?? {}), ...(own ?? {}) };
  const inset = merged.collision_inset ?? 0.3;
  return {
    collision_box: (merged.collision_box as Box | undefined) ?? footprintBox(e, inset),
    selection_box: (merged.selection_box as Box | undefined) ?? footprintBox(e, 0),
    mining_time: merged.mining_time ?? 0.2,
    rotatable: merged.rotatable ?? true,
    flippable: merged.flippable ?? false,
    selection_priority: merged.selection_priority ?? 50,
    fast_replaceable_group: merged.fast_replaceable_group ?? null,
    next_upgrade: merged.next_upgrade ?? null,
    sprite: merged.sprite ?? `entity/${e.id}`,
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
