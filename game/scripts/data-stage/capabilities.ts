// Capability manifests (10 §2.4, B1-r1 19; game/data/engine/capabilities.yaml): what the engine supports
// at each milestone. The data stage builds prototypes.bin and prototypes.json from the current manifest's
// prototypes and checks that they close: every item the build holds is obtainable from its resources, the
// start inventory and its recipes, every recipe can be crafted by hand or by an included machine, and every
// placeable thing it holds can be placed.
//
// D1: every manifest is resolved and checked, not only the current one, so the M1 packages can build against
// m1 before it is current: its names against the generated schema, its registry entries, its `systems` against
// 10 §5, its `data` and `reads` against the design data's parts (`reads` must not be omitted once current), and
// (index.ts, engine.ts) its prototypes' engine overlay. `prototypes: {filter: m1}` takes a build filter's
// prototypes (manifests.yaml) instead of lists.
import { z } from 'zod';
import { ACTION_IDS, type ActionName, SYSTEM_ACTIONS } from '../../src/shared/gen/actions.ts';
import { PACKET_SECTIONS } from '../../src/shared/gen/packet.ts';
import { PROJECTION_KINDS, QUERY_KINDS } from '../../src/shared/gen/projections.ts';
import { ACHIEVEMENT_CONDITIONS, EFFECTS, FORMULA_REFS, TRIGGERS } from '../../src/shared/gen/registries.ts';
import { compareCodeUnits } from '../lib/canonical.ts';
import type { Diagnostics } from './diagnostics.ts';
import { EMITTED_META, FIELD_STATUS, omittedParts, PARTIAL } from './emit/contents.ts';
import { leadingRef } from './formula-refs.ts';
import { playthrough } from './playthrough.ts';
import type { Index } from './refs.ts';
import type { DesignData } from './schema/index.ts';
import { at, type SourceFile } from './sources.ts';
import { triggerTarget } from './triggers.ts';

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const name = z.string().regex(/^[A-Za-z0-9_-]+$/);
const explicitPrototypes = z.strictObject({
  character: z.boolean(),
  entities: z.array(id),
  recipes: z.array(id),
  resources: z.array(id),
  tiles: z.array(id),
  world_objects: z.array(id),
  technologies: z.array(id),
});
const manifest = z.strictObject({
  extends: z.string().optional(),
  /** Lists, or a build filter of manifests.yaml (`{filter: m1}`) whose prototypes the milestone supports. */
  prototypes: z.union([explicitPrototypes, z.strictObject({ filter: z.string() })]),
  /** The META blocks the milestone's engine reads (C1a-r1 finding 5); each must be in prototypes.bin. */
  data: z.array(z.string()),
  /** The other parts of the design data its engine reads (D1); none may be omitted once it is current. */
  reads: z.array(z.string()).optional(),
  /** The systems of 10 §5 it implements, each with its scope (D1). */
  systems: z.record(z.string(), z.string()).optional(),
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

export type Prototypes = z.infer<typeof explicitPrototypes>;

/** A resolved manifest: its own fields united with those of the manifests it extends. */
export interface CapabilityManifest {
  name: string;
  /** The listed prototypes, united down the `extends` chain (a filter manifest's are its base's). */
  prototypes: Prototypes;
  /** The build filter whose prototypes the manifest takes (m1), or null for lists. */
  filter: string | null;
  data: string[];
  reads: string[];
  systems: Record<string, string>;
  actions: string[];
  system_actions: string[];
  registries: {
    effects: string[];
    triggers: string[];
    achievement_conditions: string[];
    formula_refs: string[];
  };
  projections: string[];
  queries: string[];
  packet_sections: string[];
  rule_scenarios: string[];
  benchmarks: string[];
}

/** Every manifest, resolved, and the current one. */
export interface Capabilities {
  current: CapabilityManifest;
  manifests: CapabilityManifest[];
}

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

/** The systems of 10 §5, by the name a manifest's `systems` gives them, with their section. */
export const SYSTEMS: Readonly<Record<string, string>> = {
  character: '10 §5.1',
  construction: '10 §5.2',
  belts: '10 §5.3',
  inserters: '10 §5.4',
  crafting: '10 §5.5',
  mining: '10 §5.6',
  energy: '10 §5.7',
  fluids: '10 §5.8',
  heat: '10 §5.9',
  staffing: '10 §5.10',
  'world-text': '10 §5.11',
  research: '10 §5.12',
  trains: '10 §5.13',
  agents: '10 §5.14',
  circuits: '10 §5.15',
  quality: '10 §5.16',
  runaways: '10 §5.17',
  worldgen: '10 §5.18',
  charting: '10 §5.19',
  statistics: '10 §5.20',
};

/** The prototype set of the empty manifest. */
const NO_PROTOTYPES: Prototypes = {
  character: false,
  entities: [],
  recipes: [],
  resources: [],
  tiles: [],
  world_objects: [],
  technologies: [],
};

export function loadCapabilities(src: SourceFile, diags: Diagnostics): Capabilities | null {
  const r = file.safeParse(src.value);
  if (!r.success) {
    for (const issue of r.error.issues)
      diags.error(issue.message, at(src, issue.path as (string | number)[]));
    return null;
  }
  const all = r.data.manifests;
  const u = (a: readonly string[], b: readonly string[] = []): string[] => [...new Set([...a, ...b])];
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
    const base: CapabilityManifest | null = m.extends
      ? resolve(m.extends, [...seen, n])
      : {
          name: n,
          prototypes: NO_PROTOTYPES,
          filter: null,
          data: [],
          reads: [],
          systems: {},
          actions: [],
          system_actions: [],
          registries: { effects: [], triggers: [], achievement_conditions: [], formula_refs: [] },
          projections: [],
          queries: [],
          packet_sections: [],
          rule_scenarios: [],
          benchmarks: [],
        };
    if (!base) return null;
    const own = 'filter' in m.prototypes ? null : m.prototypes;
    const bp = base.prototypes;
    return {
      name: n,
      prototypes: own
        ? {
            character: bp.character || own.character,
            entities: u(bp.entities, own.entities),
            recipes: u(bp.recipes, own.recipes),
            resources: u(bp.resources, own.resources),
            tiles: u(bp.tiles, own.tiles),
            world_objects: u(bp.world_objects, own.world_objects),
            technologies: u(bp.technologies, own.technologies),
          }
        : bp,
      filter: 'filter' in m.prototypes ? m.prototypes.filter : base.filter,
      data: u(base.data, m.data),
      reads: u(base.reads, m.reads),
      systems: { ...base.systems, ...(m.systems ?? {}) },
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
  const current = resolve(r.data.current, []);
  const manifests: CapabilityManifest[] = [];
  for (const n of Object.keys(all).sort(compareCodeUnits)) {
    const m = n === r.data.current ? current : resolve(n, []);
    if (m) manifests.push(m);
  }
  if (!current || manifests.length !== Object.keys(all).length) return null;
  return { current, manifests };
}

/**
 * A part of the design data named the way the outputs' contents record names it (`entities.categories`,
 * `technologies.unlocks.effects`, `text.milestones.kind`): a classified field, or a subfield of a partial one.
 */
export function isDesignPart(path: string): boolean {
  const [kind, field, ...rest] = path.split('.');
  const status = FIELD_STATUS[kind ?? '']?.[field ?? ''];
  if (status === undefined) return false;
  if (rest.length === 0) return true;
  return status === 'partial' && (PARTIAL[`${kind}.${field}`] ?? []).includes(rest.join('.'));
}

/** The omitted parts of the design data a `reads` path names (itself, or parts under it). */
export function omittedUnder(path: string): string[] {
  return omittedParts().filter((p) => p === path || p.startsWith(`${path}.`));
}

/**
 * The manifest's names against the generated schema and registries, its `systems` against 10 §5, its `data`
 * against meta.yaml's blocks and its `reads` against the design data's parts (any manifest, current or not).
 */
export function checkManifestNames(cap: CapabilityManifest, src: SourceFile, diags: Diagnostics): void {
  const where = (key: string) => at(src, ['manifests', cap.name, key]);
  const has = (what: string, key: string, names: readonly string[], known: Iterable<string>) => {
    const set = new Set(known);
    for (const n of names)
      if (!set.has(n)) diags.error(`${cap.name}: ${what} ${n} is not in the schema`, where(key));
  };
  const actions = Object.keys(ACTION_IDS);
  has(
    'action',
    'actions',
    cap.actions,
    actions.filter((a) => !SYSTEM_ACTIONS.has(a as ActionName)),
  );
  has('system action', 'system_actions', cap.system_actions, SYSTEM_ACTIONS as ReadonlySet<string>);
  has(
    'projection',
    'projections',
    cap.projections,
    [...PROJECTION_KINDS.values()].map((k) => k.name),
  );
  has(
    'query',
    'queries',
    cap.queries,
    [...QUERY_KINDS.values()].map((k) => k.name),
  );
  has(
    'packet section',
    'packet_sections',
    cap.packet_sections,
    [...PACKET_SECTIONS.values()].map((k) => k.name),
  );
  const reg = (what: string, names: readonly string[], known: readonly string[], norm = (x: string) => x) => {
    for (const n of names)
      if (!known.includes(norm(n)))
        diags.error(`${cap.name}: ${what} ${n} is not in its registry`, where('registries'));
  };
  reg('effect', cap.registries.effects, EFFECTS);
  reg('trigger', cap.registries.triggers, TRIGGERS, (x) => x.replace(/-/g, '_'));
  reg('achievement condition', cap.registries.achievement_conditions, ACHIEVEMENT_CONDITIONS);
  reg('formula reference', cap.registries.formula_refs, FORMULA_REFS, (x) => leadingRef(x) ?? x);
  for (const s of Object.keys(cap.systems))
    if (!(s in SYSTEMS))
      diags.error(
        `${cap.name}: system ${s} is none of 10 §5's (${Object.keys(SYSTEMS).join(', ')})`,
        where('systems'),
      );
  for (const d of cap.data)
    if (
      !(EMITTED_META as readonly string[]).includes(d) &&
      !isDesignPart(`meta.${d}`) &&
      !isDesignPart(`meta.${d.split('.')[0]}`)
    )
      diags.error(`${cap.name}: data ${d} names no block of meta.yaml`, where('data'));
  for (const p of cap.reads)
    if (!isDesignPart(p))
      diags.error(`${cap.name}: reads ${p}, which is no part of the design data`, where('reads'));
}

/** A current manifest's `reads`: the build must carry every part its engine reads (D1). */
export function checkReadsCarried(cap: CapabilityManifest, src: SourceFile, diags: Diagnostics): void {
  cap.reads.forEach((p, k) => {
    const missing = omittedUnder(p);
    if (missing.length > 0)
      diags.error(
        `${cap.name} reads ${p}, which the build omits (${missing.join('; ')}): emit it (a column, a list or META) before ${cap.name} is current`,
        at(src, ['manifests', cap.name, 'reads', k]),
      );
  });
}

/**
 * A conditional heat class (`heat.while`: the Seminar computes only while a Researcher is installed) resolves at
 * build time when the build lacks the staff item it waits for: the entity never computes there, and the rows say
 * so (emit/rows.ts computingIn; M1's Seminars, 09 S-G9, D1-r1). A build that holds both leaves the decision to
 * the engine, so its manifest must read `entities.heat.while` (and carry it once current, checkReadsCarried).
 */
export function checkConditionalHeat(
  cap: CapabilityManifest,
  build: BuildSet,
  ix: Index,
  src: SourceFile,
  diags: Diagnostics,
): void {
  if (cap.reads.some((r) => r === 'entities.heat' || r === 'entities.heat.while')) return;
  for (const id of [...build.entities].sort(compareCodeUnits)) {
    const w = ix.entities.get(id)?.heat?.while;
    if (w !== undefined && build.items.has(w))
      diags.error(
        `${cap.name}'s build holds ${id}, which computes only while a ${w} is installed, and the ${w} itself: ${cap.name} must read entities.heat.while`,
        at(src, ['manifests', cap.name, 'reads']),
      );
  }
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
  cap.data.forEach((part, k) => {
    if (!(EMITTED_META as readonly string[]).includes(part))
      diags.error(
        `${cap.name} reads meta ${part}, which prototypes.bin does not carry yet (it carries ${EMITTED_META.join(', ')}; the schema package emits the rest)`,
        at(src, ['manifests', cap.name, 'data', k]),
      );
  });
  const err = (path: (string | number)[], msg: string): void => diags.error(msg, at(src, [...base, ...path]));
  const singular: Record<string, string> = {
    entities: 'entity',
    recipes: 'recipe',
    resources: 'resource',
    tiles: 'tile',
    world_objects: 'world object',
    technologies: 'technology',
  };
  const known = <T>(list: string[], map: Map<string, T>, key: string): Set<string> => {
    list.forEach((x, k) => {
      if (!map.has(x)) err([key, k], `unknown ${singular[key] ?? key} ${x}`);
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
  // Closure (C1a-r1 finding 3): a playthrough inside the build. Items must be obtainable, recipes enabled
  // (at start, or unlocked by a technology the build researches), technologies researchable and resources
  // extractable, all with the build's own prototypes.
  const startRecipes = new Set(
    [...(ix.technologies.get('prior-art')?.unlocks.recipes ?? []), ...d.meta.start.recipes].filter((r) =>
      recipes.has(r),
    ),
  );
  const play = playthrough(
    {
      items,
      recipes,
      entities,
      technologies,
      resources,
      worldObjects,
      startInventory: new Set(startInventory.keys()),
      startRecipes,
    },
    ix,
  );
  for (const i of [...items].sort(compareCodeUnits))
    if (!play.have.has(i)) err([], `item ${i} is not obtainable in ${cap.name}`);
  for (const r of [...recipes].sort(compareCodeUnits))
    if (!play.enabled.has(r))
      err(
        ['recipes'],
        `recipe ${r} is never enabled in ${cap.name}: it is no start recipe, and no technology ${cap.name} researches unlocks it`,
      );
  for (const t of [...technologies].sort(compareCodeUnits))
    if (!play.researched.has(t))
      err(['technologies'], `technology ${t} cannot be researched inside ${cap.name}`);
  for (const r of [...resources].sort(compareCodeUnits))
    if (!play.extractable.has(r))
      err(
        ['resources'],
        `resource ${r} cannot be extracted in ${cap.name}: it is not solid, and no included extractor can take it`,
      );
  const cats = new Set<string>();
  for (const e of entities) for (const c of ix.entities.get(e)?.categories ?? []) cats.add(c);
  for (const r of recipes) {
    const rec = ix.recipes.get(r);
    if (rec && !(rec.handcraft ?? rec.category === 'crafting') && !cats.has(rec.category))
      err(['recipes'], `recipe ${r} can be crafted neither by hand nor by an included machine`);
  }
  // Trigger targets live inside the build, in the namespace their type names (C1a-r1 finding 4).
  for (const t of technologies) {
    const tr = ix.technologies.get(t)?.trigger;
    if (!tr || tr.type === 'start' || tr.type === 'research') continue;
    const target = triggerTarget(tr, { items, recipes, entities, resources });
    if (typeof target === 'string') err(['technologies'], `${t}: ${target}`);
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

/**
 * A manifest that takes a build filter's prototypes (`{filter: m1}`): the filter's build, with what
 * capabilityBuild checks of lists that a filter does not already guarantee (its closure is R17's, manifests.ts):
 * the prototypes of the manifests it extends lie inside it, every effect and trigger its technologies use is
 * implemented, and, when it is current, the META blocks it reads are carried.
 */
export function filterCapabilityBuild(
  cap: CapabilityManifest,
  f: Parameters<typeof filterBuild>[0],
  d: DesignData,
  ix: Index,
  diags: Diagnostics,
  src: SourceFile,
  current: boolean,
): BuildSet {
  const build = filterBuild(f, d, ix);
  const err = (key: string, msg: string): void => diags.error(msg, at(src, ['manifests', cap.name, key]));
  const p = cap.prototypes;
  for (const [key, list, set] of [
    ['entities', p.entities, build.entities],
    ['recipes', p.recipes, build.recipes],
    ['resources', p.resources, build.resources],
    ['tiles', p.tiles, build.tiles],
    ['world_objects', p.world_objects, build.worldObjects],
    ['technologies', p.technologies, build.technologies],
  ] as const)
    for (const x of list)
      if (!set.has(x))
        err(
          'prototypes',
          `${cap.name} extends a manifest that supports ${key} ${x}, which filter ${f.name} lacks`,
        );
  if (current)
    for (const part of cap.data)
      if (!(EMITTED_META as readonly string[]).includes(part))
        err(
          'data',
          `${cap.name} reads meta ${part}, which prototypes.bin does not carry yet (it carries ${EMITTED_META.join(', ')}; the schema package emits the rest)`,
        );
  for (const t of [...build.technologies].sort(compareCodeUnits)) {
    const tech = ix.technologies.get(t);
    for (const ef of tech?.unlocks.effects ?? [])
      if (!cap.registries.effects.includes(ef.type))
        err('registries', `${t} uses the effect ${ef.type}, which ${cap.name} does not implement`);
    const tr = tech?.trigger?.type;
    if (tr && !cap.registries.triggers.includes(tr))
      err('registries', `${t} uses the trigger ${tr}, which ${cap.name} does not implement`);
  }
  return build;
}
