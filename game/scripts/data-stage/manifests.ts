// Milestone build filters (10 §2.4 step 3, §12; J17) and their closure check (R17).
//
// A manifest is a rule over the full data: the technologies whose packs all lie in its tiers (trigger
// technologies follow their prerequisites), minus its excluded branches and every technology that depends
// on an excluded root. Everything else is derived: the recipes are exactly those unlocked by an included
// technology or by prior-art, items and entities follow from them, and resources from the extractors.
// M1 is 09 §2.7's explicit list. The rules and counts are those of design/round4/arch-data/manifests.py,
// ported line for line; a test compares the counts on the current data.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { compareCodeUnits } from '../lib/canonical.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { Index } from './refs.ts';
import type { DesignData } from './schema/index.ts';
import { at, parseYaml, type SourceFile } from './sources.ts';

const id = z.string();
const ruleManifest = z.strictObject({
  tiers: z.union([z.array(id), z.literal('all')]),
  exclude_branch: z.array(z.string()).optional(),
  exclude_with_dependents: z.array(id).optional(),
  exclude_wild: z.boolean().optional(),
});
const manifestsFile = z.strictObject({
  wild_roots: z.array(id),
  manifests: z.record(id, z.union([z.strictObject({ from: z.literal('09 §2.7') }), ruleManifest])),
});
const sliceBlock = z.strictObject({
  technologies: z.array(id),
  start_recipes: z.array(id),
  recipes: z.literal('unlocked'),
  items: z.array(id),
  entities: z.array(id),
  tiles: z.array(id),
  world_objects: z.array(id),
  resources: z.array(id),
  scenery: z.array(id),
  tiers: z.array(id),
});

export type ManifestsFile = z.infer<typeof manifestsFile>;
export type SliceBlock = z.infer<typeof sliceBlock>;

/** A build filter's result: the sets it includes, and its closure problems. */
export interface BuildFilter {
  name: string;
  /** Technologies, prior-art included. */
  technologies: Set<string>;
  /** Unlocked recipes, pseudo ones included (manifests.py counts them). */
  recipes: Set<string>;
  /** Items and fluids obtainable inside the filter. */
  items: Set<string>;
  entities: Set<string>;
  resources: Set<string>;
  scenery: string[];
  /** The tiles the build includes; every tile unless the manifest lists them. */
  tiles: Set<string>;
  worldObjects: Set<string>;
  /** Recipes that need only a conditional item (a spoil result or Wild loot): inert, not an error. */
  inert: string[];
  problems: string[];
}

/** Reads the fenced YAML block of a Markdown file that starts with `firstLine` (as manifests.py does). */
export function markdownYamlBlock(markdown: string, test: (block: string) => boolean): string | null {
  const re = /```yaml\n([\s\S]*?)```/g;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) if (test(m[1] ?? '')) return m[1] ?? '';
  return null;
}

export function loadManifests(src: SourceFile, diags: Diagnostics): ManifestsFile | null {
  const r = manifestsFile.safeParse(src.value);
  if (!r.success) {
    for (const issue of r.error.issues)
      diags.error(issue.message, at(src, issue.path as (string | number)[]));
    return null;
  }
  return r.data;
}

/** The slice manifest of 09 §2.7. */
export function loadSlice(
  specDir: string,
  diags: Diagnostics,
): { block: SliceBlock; src: SourceFile } | null {
  const file = 'design/spec/09-vertical-slice.md';
  let md: string;
  try {
    md = readFileSync(`${specDir}/09-vertical-slice.md`, 'utf8');
  } catch (e) {
    diags.error(`cannot read: ${(e as Error).message}`, { file });
    return null;
  }
  const text = markdownYamlBlock(md, (b) => b.startsWith('slice:'));
  if (text === null) {
    diags.error('09 §2.7 has no ```yaml slice: block', { file });
    return null;
  }
  const src = parseYaml(`${file} (§2.7)`, text, diags);
  if (!src) return null;
  const r = sliceBlock.safeParse((src.value as { slice?: unknown }).slice);
  if (!r.success) {
    for (const issue of r.error.issues)
      diags.error(issue.message, at(src, ['slice', ...(issue.path as (string | number)[])]));
    return null;
  }
  return { block: r.data, src };
}

/** The manifests file must equal 10 §12's block (manifests.py reads that one). */
export function checkAgainstSpec(file: ManifestsFile, specDir: string, diags: Diagnostics): void {
  const where = { file: 'game/data/engine/manifests.yaml' };
  let md: string;
  try {
    md = readFileSync(`${specDir}/10-architecture.md`, 'utf8');
  } catch (e) {
    diags.error(`cannot read 10-architecture.md: ${(e as Error).message}`, where);
    return;
  }
  const text = markdownYamlBlock(md, (b) => b.includes('manifests:'));
  if (text === null) {
    diags.error('10 §12 has no ```yaml block with `manifests:`', where);
    return;
  }
  const src = parseYaml('design/spec/10-architecture.md (§12)', text, diags);
  if (!src) return;
  if (JSON.stringify(canonical(src.value)) !== JSON.stringify(canonical(file)))
    diags.error(
      'differs from the manifests block in 10 §12; the two must agree (manifests.py reads 10)',
      where,
    );
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort(compareCodeUnits)
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/** manifests.py `dependents`: the roots and every technology with a prerequisite among them (fixpoint). */
function dependents(roots: readonly string[], ix: Index): Set<string> {
  const out = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of ix.technologies.values()) {
      if (!out.has(t.id) && t.prerequisites.some((p) => out.has(p))) {
        out.add(t.id);
        changed = true;
      }
    }
  }
  return out;
}

/** manifests.py `select`: a rule manifest's technologies, prerequisite-closed. */
export function selectTechnologies(
  m: z.infer<typeof ruleManifest>,
  wildRoots: readonly string[],
  d: DesignData,
  ix: Index,
): Set<string> {
  const tiers = m.tiers === 'all' ? d.meta.tiers : m.tiers;
  const roots = [...(m.exclude_with_dependents ?? []), ...(m.exclude_wild ? wildRoots : [])];
  const excl = dependents(roots, ix);
  const branches = new Set(m.exclude_branch ?? []);
  const cand = new Set<string>();
  for (const t of ix.technologies.values()) {
    const tierOk = t.cost === undefined || Object.keys(t.cost.packs).every((p) => tiers.includes(p));
    if (tierOk && !excl.has(t.id) && !(t.branch !== undefined && branches.has(t.branch))) cand.add(t.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const tid of [...cand].sort(compareCodeUnits)) {
      if ((ix.technologies.get(tid)?.prerequisites ?? []).some((p) => !cand.has(p))) {
        cand.delete(tid);
        changed = true;
      }
    }
  }
  return cand;
}

/** The start inventory and the salvage's items (manifests.py `closure`'s `start`). */
export function startItems(d: DesignData, ix: Index): Map<string, number> {
  const start = new Map(Object.entries(d.meta.start.inventory));
  const sal = d.meta.start.salvage;
  for (const part of [sal.crate, sal.per_piece])
    for (const [k, v] of Object.entries(part)) if (ix.items.has(k)) start.set(k, v);
  return start;
}

/** manifests.py `closure`, plus the spec's tile rule (10 §2.4 step 3). */
export function closure(
  name: string,
  techList: Iterable<string>,
  d: DesignData,
  ix: Index,
  scenery: readonly string[] = [],
  listedTiles: readonly string[] | null = null,
): BuildFilter {
  const techs = new Set([...techList, 'prior-art']);
  const problems: string[] = [];
  const recipes = new Set<string>();
  for (const tid of techs) for (const r of ix.technologies.get(tid)?.unlocks.recipes ?? []) recipes.add(r);
  const start = startItems(d, ix);
  const placeables = new Set<string>();
  for (const r of recipes) for (const p of ix.recipes.get(r)?.products ?? []) placeables.add(p.id);
  const entities = new Set<string>();
  for (const x of [...placeables, ...start.keys()]) {
    const pl = ix.items.get(x)?.places;
    if (pl !== undefined && ix.entities.has(pl)) entities.add(pl);
  }
  const extractTypes = new Set([...entities].map((e) => ix.entities.get(e)?.type));
  const resources = new Set<string>();
  for (const r of ix.resources.values()) {
    if (scenery.includes(r.id)) continue;
    if (r.kind === 'solid') resources.add(r.id);
    else if (r.kind === 'offshore' && extractTypes.has('offshore-pump')) resources.add(r.id);
    else if (r.kind === 'fluid' && extractTypes.has('pumpjack')) resources.add(r.id);
    else if (r.id === 'trees') resources.add(r.id);
  }
  const ok = new Set(start.keys());
  const cond = new Map<string, string>();
  for (const en of d.enemies)
    for (const k of Object.keys(en.loot ?? {}))
      if (ix.items.has(k) && !cond.has(k)) cond.set(k, `loot of ${en.id} (Wild)`);
  for (const r of resources) {
    const y = ix.resources.get(r)?.yields;
    if (y) ok.add(y);
  }
  for (const w of d.world) for (const k of Object.keys(w.yields ?? {})) ok.add(k);
  const gated = new Set(['boiler', 'heat-exchanger', 'reactor']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const eid of entities) {
      const e = ix.entities.get(eid);
      if (!e) continue;
      // As manifests.py: only boilers, heat exchangers and reactors wait for what they consume.
      const ready =
        !gated.has(e.type) || (e.consumes ?? []).filter((c) => ix.items.has(c)).every((c) => ok.has(c));
      if (ready || e.type === 'offshore-pump') {
        for (const p of e.produces ?? []) {
          if (!ok.has(p)) {
            ok.add(p);
            changed = true;
          }
        }
      }
    }
    for (const rid of recipes) {
      const r = ix.recipes.get(rid);
      if (!r || r.container) continue;
      if (r.ingredients.every((i) => ok.has(i.id))) {
        for (const p of r.products) {
          if (!ok.has(p.id)) {
            ok.add(p.id);
            changed = true;
          }
        }
      }
    }
    for (const iid of [...ok]) {
      const sp = ix.items.get(iid)?.spoil;
      if (sp && !ok.has(sp.into) && !cond.has(sp.into)) {
        cond.set(sp.into, `spoil of ${iid} (setting ${sp.setting})`);
        changed = true;
      }
    }
  }
  const cats = new Set<string>();
  for (const eid of entities) for (const c of ix.entities.get(eid)?.categories ?? []) cats.add(c);
  for (const tid of [...techs].sort(compareCodeUnits)) {
    const t = ix.technologies.get(tid);
    if (!t) {
      problems.push(`${tid}: not a technology`);
      continue;
    }
    for (const p of t.prerequisites)
      if (!techs.has(p)) problems.push(`${tid}: prerequisite ${p} outside the filter`);
    for (const p of Object.keys(t.cost?.packs ?? {}))
      if (!ok.has(p)) problems.push(`${tid}: pack ${p} not obtainable`);
    const tr = t.trigger;
    if (tr?.type === 'craft-item' && !ok.has(tr.item ?? ''))
      problems.push(`${tid}: trigger item ${tr.item} not obtainable`);
    if (
      (tr?.type === 'build-entity' || tr?.type === 'mine-entity') &&
      !entities.has(tr.entity ?? '') &&
      !resources.has(tr.entity ?? '')
    )
      problems.push(`${tid}: trigger target ${tr.entity} not in the filter`);
  }
  const inert: string[] = [];
  for (const rid of [...recipes].sort(compareCodeUnits)) {
    const r = ix.recipes.get(rid);
    if (!r || r.container) continue;
    const miss = r.ingredients.map((i) => i.id).filter((i) => !ok.has(i));
    if (miss.length > 0 && miss.every((x) => cond.has(x)))
      inert.push(`${rid} (needs ${miss.map((x) => cond.get(x)).join(', ')})`);
    else if (miss.length > 0) problems.push(`recipe ${rid}: ingredients not obtainable [${miss.join(', ')}]`);
    const handcraft = r.handcraft ?? r.category === 'crafting';
    if (!r.pseudo && !cats.has(r.category) && !handcraft)
      problems.push(`recipe ${rid}: no machine for category ${r.category}`);
  }
  const items = new Set([...ok].filter((x) => ix.items.has(x)));
  const tiles = new Set(listedTiles ?? d.tiles.map((t) => t.id));
  if (listedTiles) {
    for (const i of items) {
      const pt = ix.items.get(i)?.places_tile;
      if (pt && !tiles.has(pt))
        problems.push(`item ${i} places tile ${pt}, which the manifest does not list`);
    }
    for (const t of d.tiles)
      if (!t.placed_by && !tiles.has(t.id))
        problems.push(`worldgen places tile ${t.id}, which the manifest does not list`);
  }
  return {
    name,
    technologies: techs,
    recipes,
    items,
    entities,
    resources,
    scenery: [...scenery],
    tiles,
    worldObjects: new Set(d.world.map((w) => w.id)),
    inert,
    problems,
  };
}

/** The one-line summary manifests.py prints, for comparison. */
export function summary(f: BuildFilter): string {
  const sc = f.scenery.length > 0 ? ` + scenery ${f.scenery.join(',')}` : '';
  return `${f.name}: ${f.technologies.size - 1} technologies (+ prior-art), ${f.recipes.size} recipes, ${f.items.size} items and fluids, ${f.entities.size} entities, ${f.resources.size} resources${sc}; closure ${f.problems.length === 0 ? 'OK' : 'FAILS'}`;
}

/**
 * M1: 09 §2.7's slice. Its source keys are `technologies`, `resources`, `scenery` and `tiers`; its derived
 * keys must equal what the rules give (render_slice.py's derivation).
 */
export function sliceFilter(
  slice: SliceBlock,
  d: DesignData,
  ix: Index,
  diags: Diagnostics,
  src: SourceFile,
): BuildFilter {
  const missing = slice.technologies.filter((t) => !ix.technologies.has(t));
  if (missing.length > 0)
    diags.error(`names unknown technologies: ${missing.join(', ')}`, at(src, ['slice', 'technologies']));
  const scenery = slice.scenery.length > 0 ? slice.scenery : ['exchange'];
  const f = closure(
    'm1 (09 §2.7)',
    slice.technologies.filter((t) => ix.technologies.has(t)),
    d,
    ix,
    scenery,
    slice.tiles,
  );
  const derived = deriveSlice(slice, d, ix);
  const compare = (key: keyof SliceBlock, want: Iterable<string>): void => {
    const have = new Set(slice[key] as string[]);
    const w = new Set(want);
    const extra = [...have].filter((x) => !w.has(x)).sort(compareCodeUnits);
    const lack = [...w].filter((x) => !have.has(x)).sort(compareCodeUnits);
    if (extra.length > 0 || lack.length > 0)
      diags.error(
        `the derived key ${key} disagrees with the data${extra.length > 0 ? `; not derived: ${extra.join(', ')}` : ''}${lack.length > 0 ? `; missing: ${lack.join(', ')}` : ''} (rerun tools/render_slice.py)`,
        at(src, ['slice', key]),
      );
  };
  compare('start_recipes', derived.startRecipes);
  compare('items', derived.items);
  compare('entities', derived.entities);
  compare('tiles', derived.tiles);
  compare('world_objects', derived.worldObjects);
  if (JSON.stringify(slice.start_recipes) !== JSON.stringify(derived.startRecipes))
    diags.error(
      "start_recipes must equal prior-art's unlocks, in order",
      at(src, ['slice', 'start_recipes']),
    );
  for (const r of slice.resources)
    if (!ix.resources.has(r)) diags.error(`unknown resource ${r}`, at(src, ['slice', 'resources']));
  for (const r of f.recipes)
    if (ix.recipes.get(r)?.pseudo)
      diags.error(`the slice contains the pseudo recipe ${r}`, at(src, ['slice']));
  return f;
}

/** render_slice.py `derive`: the slice's derived keys from its source keys. */
export function deriveSlice(slice: SliceBlock, d: DesignData, ix: Index) {
  const startRecipes = [...(ix.technologies.get('prior-art')?.unlocks.recipes ?? [])];
  const unlocked: string[] = [];
  for (const t of ['prior-art', ...slice.technologies.filter((x) => ix.technologies.has(x))])
    for (const r of ix.technologies.get(t)?.unlocks.recipes ?? [])
      if (ix.recipes.has(r) && !unlocked.includes(r)) unlocked.push(r);
  const items = new Set<string>();
  for (const r of unlocked)
    for (const x of [...(ix.recipes.get(r)?.ingredients ?? []), ...(ix.recipes.get(r)?.products ?? [])])
      items.add(x.id);
  for (const res of slice.resources) {
    const r = ix.resources.get(res);
    if (r) items.add(r.yields);
  }
  for (const k of Object.keys(d.meta.start.inventory)) items.add(k);
  const sal = d.meta.start.salvage;
  for (const k of [...Object.keys(sal.per_piece), ...Object.keys(sal.crate)]) items.add(k);
  for (const t of slice.technologies) {
    const it = ix.technologies.get(t)?.trigger?.item;
    if (it) items.add(it);
  }
  for (const t of slice.tiers) items.add(t);
  for (const w of d.world) for (const k of Object.keys(w.yields ?? {})) items.add(k);
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of [...items]) {
      const e = ix.entities.get(ix.items.get(i)?.places ?? '');
      for (const f of [...(e?.consumes ?? []), ...(e?.produces ?? [])]) {
        if (!items.has(f)) {
          items.add(f);
          changed = true;
        }
      }
    }
  }
  const entities = new Set<string>();
  for (const i of items) {
    const p = ix.items.get(i)?.places;
    if (p) entities.add(p);
  }
  const placed = new Set<string>();
  for (const i of items) {
    const pt = ix.items.get(i)?.places_tile;
    if (pt) placed.add(pt);
  }
  const tiles = new Set([...d.tiles.filter((t) => !t.placed_by).map((t) => t.id), ...placed]);
  return { startRecipes, unlocked, items, entities, tiles, worldObjects: d.world.map((w) => w.id) };
}
