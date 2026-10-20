// prototypes.json (10 §15.2): what the UI and the renderer read. A header (formatVersion, schemaHash,
// prototypesHash), then per kind an array in id order (names, groups and order, locale keys, the art set
// each record draws with, boxes, display values), and the namespace tables ids resolve through (§15.7's
// lookup contracts):
//   - `icons`: the icon table that EntityView.alt_icon indexes: every item's icon, then every fluid's,
//     then any recipe icon not already listed;
//   - `localeKeys`: per enum with player-facing text (FailReason, FlyingText, AlertType, Status), each value's
//     locale key, or null for a developer value (the schema's `locale` prefixes; src/shared/gen/types.ts);
//   - `sounds`: the sound-id table (empty until game/data/engine/sounds.yaml exists, 10 §15.6);
//   - `milestones`: text.yaml's milestone ids, sorted, which MilestoneId indexes (§15.6);
//   - `treeSpecies`, `decoratives`, `cliffs`, `townBuildings`: the set-name tables of the overlay's
//     sets.yaml;
// plus `groups` and `subgroups`, and `strings`: the English text of every locale key the records name,
// from the design data (names come from the data, 08).
// Set names are `<namespace>/<name>` (§15.7); the asset build makes the sets, and a name without a set
// draws its greybox or `fx/missing`. schema/protos.yaml declares this layout (`json`); the generated
// validatePrototypesJson checks every output against it. The engine's character is the last `entity`.
import { PROTOTYPES_JSON_VERSION, validatePrototypesJson } from '../../../src/shared/gen/protos.ts';
import {
  AlertTypeCodec,
  FailReasonCodec,
  FlyingTextCodec,
  StatusCodec,
} from '../../../src/shared/gen/types.ts';
import { canonicalJson, compareCodeUnits } from '../../lib/canonical.ts';
import type { Model, StackRef } from '../model.ts';
import { CHARACTER, stackRef } from '../model.ts';
import { contentsRecord } from './contents.ts';

export const JSON_FORMAT_VERSION = PROTOTYPES_JSON_VERSION;

/** prototypes.json's localeKeys (§15.6, 08 §8): generated from the schema's enums. */
export const LOCALE_KEYS = {
  FailReason: FailReasonCodec.LOCALE_KEYS,
  FlyingText: FlyingTextCodec.LOCALE_KEYS,
  AlertType: AlertTypeCodec.LOCALE_KEYS,
  Status: StatusCodec.LOCALE_KEYS,
};

const stack = (s: StackRef | null) => (s ? { kind: s.kind === 0 ? 'item' : 'fluid', id: s.id } : null);

export function prototypesJson(m: Model, schemaHashHex: string, prototypesHashHex: string): string {
  const ov = m.overlay;
  const strings: Record<string, string> = {};
  const text = (key: string, value: string | undefined): string | null => {
    if (value === undefined) return null;
    strings[key] = value;
    return key;
  };
  const groups = [...ov.groups.entries()].map(([name, g]) => ({ name, order: g.order }));
  const subgroups = [...ov.subgroups.entries()].map(([name, s]) => ({
    name,
    group: groups.findIndex((g) => g.name === s.group),
    order: s.order,
  }));
  const gIndex = (name: string) => groups.findIndex((g) => g.name === name);
  const sIndex = (name: string) => subgroups.findIndex((s) => s.name === name);

  const itemIcon = new Map<string, string>();
  for (const r of m.items) itemIcon.set(r.id, ov.prototypes.items[r.id]?.icon ?? `item/${r.id}`);
  for (const r of m.fluids) itemIcon.set(r.id, ov.prototypes.items[r.id]?.icon ?? `fluid/${r.id}`);
  const recipeIcon = (r: Model['recipes'][number]): string => {
    const own = ov.prototypes.recipes[r.id]?.icon;
    if (own) return own;
    const first = r.data.products[0]?.id;
    return (first && itemIcon.get(first)) ?? `recipe/${r.id}`;
  };
  const icons = [
    ...m.items.map((r) => itemIcon.get(r.id) as string),
    ...m.fluids.map((r) => itemIcon.get(r.id) as string),
  ];
  for (const r of m.recipes) {
    const ic = recipeIcon(r);
    if (!icons.includes(ic)) icons.push(ic);
  }

  const itemJson = (kind: 'item' | 'fluid') => (r: Model['items'][number]) => ({
    name: r.id,
    localeName: text(`${kind}-name.${r.id}`, r.data.name),
    localeDescription: text(`${kind}-description.${r.id}`, r.data.desc),
    localeHandbook: text(`${kind}-handbook.${r.id}`, r.data.handbook_note),
    group: gIndex(r.ordering.group),
    subgroup: sIndex(r.ordering.subgroup),
    order: r.ordering.order,
    icon: itemIcon.get(r.id),
    stack: r.data.stack ?? null,
    places: r.data.places !== undefined ? (m.ids.entity.get(r.data.places) ?? null) : null,
    placesTile: r.data.places_tile !== undefined ? (m.ids.tile.get(r.data.places_tile) ?? null) : null,
    fuelValueJ: r.data.fuel_value !== undefined ? r.data.fuel_value * 1e6 : null,
  });

  const out = {
    formatVersion: JSON_FORMAT_VERSION,
    schemaHash: schemaHashHex,
    prototypesHash: prototypesHashHex,
    build: m.build.name,
    character: m.build.character,
    contents: contentsRecord(),
    item: m.items.map(itemJson('item')),
    fluid: m.fluids.map(itemJson('fluid')),
    recipe: m.recipes.map((r) => {
      const first = r.data.products[0]?.id;
      const displayName = r.data.name ?? (first ? m.index.items.get(first)?.name : undefined) ?? r.id;
      return {
        name: r.id,
        localeName: text(`recipe-name.${r.id}`, displayName),
        localeHandbook: text(`recipe-handbook.${r.id}`, r.data.handbook_note),
        group: gIndex(r.ordering.group),
        subgroup: sIndex(r.ordering.subgroup),
        order: r.ordering.order,
        icon: recipeIcon(r),
        category: r.data.category,
        time: r.data.time,
        handcraft: r.data.handcraft ?? r.data.category === 'crafting',
        enabledAtStart: m.build.startRecipes.has(r.id),
        ingredients: r.data.ingredients.map((x) => ({ ...stack(stackRef(m, x.id)), amount: x.amount })),
        products: r.data.products.map((x) => ({
          ...stack(stackRef(m, x.id)),
          amount: x.amount,
          probability: x.probability ?? 1,
          catalyst: x.catalyst ?? 0,
        })),
      };
    }),
    entity: [
      ...m.entities.map((r) => ({
        name: r.id,
        localeName: text(`entity-name.${r.id}`, r.data.name),
        localeDescription: text(`entity-description.${r.id}`, r.data.desc),
        localeHandbook: text(`entity-handbook.${r.id}`, r.data.handbook_note),
        type: r.data.type,
        size: r.data.size,
        item: m.ids.item.get(r.data.item) ?? null,
        sprite: r.engine.sprite,
        collisionBox: r.engine.collision_box,
        selectionBox: r.engine.selection_box,
        selectionPriority: r.engine.selection_priority,
        rotatable: r.engine.rotatable,
        energySource: r.data.energy.source,
        energyUsageW: (r.data.energy.kw ?? 0) * 1e3,
        inventorySlots: (r.data.extra as { slots?: number } | undefined)?.slots ?? null,
      })),
      ...(m.character ? [characterJson(m)] : []),
    ],
    technology: m.technologies.map((r) => ({
      name: r.id,
      localeName: text(`technology-name.${r.id}`, r.data.name),
      localeDescription: text(`technology-description.${r.id}`, r.data.desc),
      localeNote: text(`technology-note.${r.id}`, r.data.note),
      localeHandbook: text(`technology-handbook.${r.id}`, r.data.handbook_note),
      regime: r.data.regime,
      firstLevel: r.levels.first,
      maxLevel: r.levels.last,
      infinite: r.levels.infinite,
      prerequisites: r.data.prerequisites.map((p) => m.ids.technology.get(p) ?? null),
    })),
    resource: m.resources.map((r) => ({
      name: r.id,
      localeName: text(`resource-name.${r.id}`, r.data.name),
      sprite: ov.prototypes.resources[r.id]?.sprite ?? `resource/${r.id}`,
      kind: r.data.kind,
      yields: stack(stackRef(m, r.data.yields)),
      miningTime: r.data.mining_time ?? null,
    })),
    tile: m.tiles.map((r) => ({
      name: r.id,
      localeName: text(`tile-name.${r.id}`, r.data.name),
      mapColor: r.data.map_color.toLowerCase(),
      buildable: r.data.buildable,
      walkable: r.data.walking_speed !== null,
    })),
    world: m.world.map((r) => ({
      name: r.id,
      localeName: text(`world-name.${r.id}`, r.data.name),
      sprite: ov.prototypes.world[r.id]?.sprite ?? `object/${r.id}`,
      kind: r.data.kind,
      size: r.data.size,
      miningTime: r.data.mining_time ?? null,
    })),
    signal: [],
    groups,
    subgroups,
    icons,
    localeKeys: LOCALE_KEYS,
    sounds: [],
    milestones: m.design.text.milestones.map((x) => x.id).sort(compareCodeUnits),
    treeSpecies: ov.sets.tree_species.map((x) => `object/${x}`),
    decoratives: ov.sets.decoratives.map((x) => `decor/${x}`),
    cliffs: ov.sets.cliffs.map((x) => `cliff/${x}`),
    townBuildings: ov.sets.town_buildings.map((x) => `town/${x}`),
  };
  const json = { ...out, strings };
  validatePrototypesJson(JSON.parse(canonicalJson(json)));
  return canonicalJson(json);
}

/** The engine's character as an `entity` record: MOVERS' `proto` indexes it, and `sprite` names its art. */
function characterJson(m: Model) {
  const c = m.character?.engine;
  if (!c) throw new Error('no character');
  return {
    name: CHARACTER,
    localeName: null,
    localeDescription: null,
    localeHandbook: null,
    type: 'character',
    size: [0, 0],
    item: null,
    sprite: c.sprite,
    collisionBox: c.collision_box,
    selectionBox: c.selection_box,
    selectionPriority: c.selection_priority ?? 50,
    rotatable: false,
    energySource: 'none',
    energyUsageW: 0,
    inventorySlots: c.inventory_size,
  };
}
