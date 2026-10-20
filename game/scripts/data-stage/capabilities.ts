// Capability manifests (10 §2.4, B1-r1 19; game/data/engine/capabilities.yaml): what the engine supports
// at each milestone. The data stage builds prototypes.bin and prototypes.json from the current manifest's
// prototypes and checks that they close: every item the build holds is obtainable from its resources, the
// start inventory and its recipes, every recipe can be crafted by hand or by an included machine, and every
// placeable thing it holds can be placed.
import { z } from 'zod';
import { compareCodeUnits } from '../lib/canonical.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { Index } from './refs.ts';
import type { DesignData } from './schema/index.ts';
import { at, type SourceFile } from './sources.ts';

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const name = z.string().regex(/^[A-Za-z0-9_-]+$/);
const manifest = z.strictObject({
  extends: z.string().optional(),
  prototypes: z.strictObject({
    character: z.boolean(),
    entities: z.array(id),
    recipes: z.array(id),
    resources: z.array(id),
    tiles: z.array(id),
    world_objects: z.array(id),
    technologies: z.array(id),
  }),
  actions: z.array(name),
  system_actions: z.array(name),
  registries: z.strictObject({
    effects: z.array(id),
    triggers: z.array(id),
    achievement_conditions: z.array(id),
    formula_refs: z.array(z.string()),
  }),
  projections: z.array(name),
  queries: z.array(name),
  packet_sections: z.array(name),
  rule_scenarios: z.array(name),
  benchmarks: z.array(name),
});
const file = z.strictObject({ current: z.string(), manifests: z.record(z.string(), manifest) });

export type CapabilityManifest = z.infer<typeof manifest> & { name: string };

/** The prototypes a build holds, by kind, in no particular order (ids assign the order). */
export interface BuildSet {
  /** `m0` for a capability manifest, or a build filter's name (`m1` … `m5`). */
  name: string;
  character: boolean;
  items: Set<string>;
  recipes: Set<string>;
  entities: Set<string>;
  technologies: Set<string>;
  resources: Set<string>;
  tiles: Set<string>;
  worldObjects: Set<string>;
  /** meta.start.inventory restricted to the build's items. */
  startInventory: Map<string, number>;
  /** Recipes enabled when a game starts: prior-art's unlocks and meta.start.recipes, inside the build. */
  startRecipes: Set<string>;
}

export function loadCapabilities(src: SourceFile, diags: Diagnostics): CapabilityManifest | null {
  const r = file.safeParse(src.value);
  if (!r.success) {
    for (const issue of r.error.issues)
      diags.error(issue.message, at(src, issue.path as (string | number)[]));
    return null;
  }
  const all = r.data.manifests;
  const resolve = (n: string, seen: string[]): CapabilityManifest | null => {
    const m = all[n];
    if (!m) {
      diags.error(
        `no capability manifest ${n}`,
        at(src, seen.length ? ['manifests', seen[seen.length - 1] as string, 'extends'] : ['current']),
      );
      return null;
    }
    if (seen.includes(n)) {
      diags.error(
        `capability manifests extend each other in a cycle: ${[...seen, n].join(' -> ')}`,
        at(src, ['manifests', n]),
      );
      return null;
    }
    if (!m.extends) return { ...m, name: n };
    const base = resolve(m.extends, [...seen, n]);
    if (!base) return null;
    const u = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];
    return {
      name: n,
      prototypes: {
        character: base.prototypes.character || m.prototypes.character,
        entities: u(base.prototypes.entities, m.prototypes.entities),
        recipes: u(base.prototypes.recipes, m.prototypes.recipes),
        resources: u(base.prototypes.resources, m.prototypes.resources),
        tiles: u(base.prototypes.tiles, m.prototypes.tiles),
        world_objects: u(base.prototypes.world_objects, m.prototypes.world_objects),
        technologies: u(base.prototypes.technologies, m.prototypes.technologies),
      },
      actions: u(base.actions, m.actions),
      system_actions: u(base.system_actions, m.system_actions),
      registries: {
        effects: u(base.registries.effects, m.registries.effects),
        triggers: u(base.registries.triggers, m.registries.triggers),
        achievement_conditions: u(
          base.registries.achievement_conditions,
          m.registries.achievement_conditions,
        ),
        formula_refs: u(base.registries.formula_refs, m.registries.formula_refs),
      },
      projections: u(base.projections, m.projections),
      queries: u(base.queries, m.queries),
      packet_sections: u(base.packet_sections, m.packet_sections),
      rule_scenarios: u(base.rule_scenarios, m.rule_scenarios),
      benchmarks: u(base.benchmarks, m.benchmarks),
    };
  };
  return resolve(r.data.current, []);
}

/** Items a prototype set needs, and the closure check (10 §2.4: "the build's prototypes close over it"). */
export function capabilityBuild(
  cap: CapabilityManifest,
  d: DesignData,
  ix: Index,
  diags: Diagnostics,
  src: SourceFile,
): BuildSet {
  const p = cap.prototypes;
  const base = ['manifests', cap.name, 'prototypes'];
  const err = (path: (string | number)[], msg: string): void => diags.error(msg, at(src, [...base, ...path]));
  const known = <T>(list: string[], map: Map<string, T>, key: string): Set<string> => {
    list.forEach((x, k) => {
      if (!map.has(x)) err([key, k], `unknown ${key.replace(/s$/, '').replace('_', ' ')} ${x}`);
    });
    return new Set(list.filter((x) => map.has(x)));
  };
  const entities = known(p.entities, ix.entities, 'entities');
  const recipes = known(p.recipes, ix.recipes, 'recipes');
  const resources = known(p.resources, ix.resources, 'resources');
  const tiles = known(p.tiles, ix.tiles, 'tiles');
  const worldObjects = known(p.world_objects, ix.world, 'world_objects');
  const technologies = known(p.technologies, ix.technologies, 'technologies');
  const items = new Set<string>();
  for (const e of entities) items.add(ix.entities.get(e)?.item ?? '');
  for (const r of recipes)
    for (const x of [...(ix.recipes.get(r)?.ingredients ?? []), ...(ix.recipes.get(r)?.products ?? [])])
      items.add(x.id);
  for (const r of resources) items.add(ix.resources.get(r)?.yields ?? '');
  for (const w of worldObjects) for (const y of Object.keys(ix.world.get(w)?.yields ?? {})) items.add(y);
  for (const t of technologies)
    for (const pk of Object.keys(ix.technologies.get(t)?.cost?.packs ?? {})) items.add(pk);
  items.delete('');
  const startInventory = new Map(Object.entries(d.meta.start.inventory).filter(([k]) => items.has(k)));
  // Closure: everything obtainable from resources, world objects, the start inventory and the recipes.
  const ok = new Set<string>([...startInventory.keys()]);
  for (const r of resources) ok.add(ix.resources.get(r)?.yields ?? '');
  for (const w of worldObjects) for (const y of Object.keys(ix.world.get(w)?.yields ?? {})) ok.add(y);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of recipes) {
      const rec = ix.recipes.get(r);
      if (!rec?.ingredients.every((i) => ok.has(i.id))) continue;
      for (const pr of rec.products)
        if (!ok.has(pr.id)) {
          ok.add(pr.id);
          changed = true;
        }
    }
  }
  const cats = new Set<string>();
  for (const e of entities) for (const c of ix.entities.get(e)?.categories ?? []) cats.add(c);
  for (const i of [...items].sort(compareCodeUnits))
    if (!ok.has(i)) err([], `item ${i} is not obtainable in ${cap.name}`);
  for (const r of recipes) {
    const rec = ix.recipes.get(r);
    if (rec && !(rec.handcraft ?? rec.category === 'crafting') && !cats.has(rec.category))
      err(['recipes'], `recipe ${r} can be crafted neither by hand nor by an included machine`);
  }
  for (const i of items) {
    const it = ix.items.get(i);
    if (it?.places && !entities.has(it.places))
      err(['entities'], `item ${i} places ${it.places}, which ${cap.name} does not include`);
    if (it?.places_tile && !tiles.has(it.places_tile))
      err(['tiles'], `item ${i} places tile ${it.places_tile}, which ${cap.name} does not include`);
  }
  for (const t of technologies) {
    const tech = ix.technologies.get(t);
    for (const pre of tech?.prerequisites ?? [])
      if (!technologies.has(pre))
        err(['technologies'], `${t} needs ${pre}, which ${cap.name} does not include`);
    for (const r of tech?.unlocks.recipes ?? [])
      if (!recipes.has(r)) err(['technologies'], `${t} unlocks ${r}, which ${cap.name} does not include`);
    for (const ef of tech?.unlocks.effects ?? [])
      if (!cap.registries.effects.includes(ef.type))
        err(['technologies'], `${t} uses the effect ${ef.type}, which ${cap.name} does not implement`);
    const tr = tech?.trigger?.type;
    if (tr && !cap.registries.triggers.includes(tr))
      err(['technologies'], `${t} uses the trigger ${tr}, which ${cap.name} does not implement`);
  }
  const startRecipes = new Set(
    [...(ix.technologies.get('prior-art')?.unlocks.recipes ?? []), ...d.meta.start.recipes].filter((r) =>
      recipes.has(r),
    ),
  );
  return {
    name: cap.name,
    character: p.character,
    items,
    recipes,
    entities,
    technologies,
    resources,
    tiles,
    worldObjects,
    startInventory,
    startRecipes,
  };
}

/** A build filter's prototypes (`--manifest m1` … `m5`): everything its rules include. */
export function filterBuild(
  f: {
    name: string;
    technologies: Set<string>;
    recipes: Set<string>;
    items: Set<string>;
    entities: Set<string>;
    resources: Set<string>;
    tiles: Set<string>;
    worldObjects: Set<string>;
  },
  d: DesignData,
  ix: Index,
): BuildSet {
  const recipes = new Set([...f.recipes].filter((r) => !ix.recipes.get(r)?.pseudo));
  const items = new Set(f.items);
  // Every item a recipe, a technology, a resource or a world object names is in the build (inert recipes
  // name conditional items).
  for (const r of recipes)
    for (const x of [...(ix.recipes.get(r)?.ingredients ?? []), ...(ix.recipes.get(r)?.products ?? [])])
      items.add(x.id);
  for (const t of f.technologies)
    for (const pk of Object.keys(ix.technologies.get(t)?.cost?.packs ?? {})) items.add(pk);
  for (const r of f.resources) items.add(ix.resources.get(r)?.yields ?? '');
  for (const w of f.worldObjects) for (const y of Object.keys(ix.world.get(w)?.yields ?? {})) items.add(y);
  for (const e of f.entities) items.add(ix.entities.get(e)?.item ?? '');
  items.delete('');
  const entities = new Set(f.entities);
  for (const i of items) {
    const pl = ix.items.get(i)?.places;
    if (pl) entities.add(pl);
  }
  const startRecipes = new Set(
    [...(ix.technologies.get('prior-art')?.unlocks.recipes ?? []), ...d.meta.start.recipes].filter((r) =>
      recipes.has(r),
    ),
  );
  return {
    name: f.name,
    character: true,
    items,
    recipes,
    entities,
    technologies: new Set(f.technologies),
    resources: new Set(f.resources),
    tiles: new Set(f.tiles),
    worldObjects: new Set(f.worldObjects),
    startInventory: new Map(Object.entries(d.meta.start.inventory).filter(([k]) => items.has(k))),
    startRecipes,
  };
}
