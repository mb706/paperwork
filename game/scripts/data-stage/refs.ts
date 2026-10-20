// Reference checks over the design data: every id a prototype names exists in its kind. This is the
// engine-relevant part of tools/validate_spec.py's check_references, check_meta_references, check_tech_dag
// and the id checks of check_text_file, ported rule for rule so that both agree on every input; the Python
// validator keeps the rest (text rules, citations, the playthrough, pacing).
import type { DataPath, Diagnostics } from './diagnostics.ts';
import type { DesignData, FileKind } from './schema/index.ts';
import { at } from './sources.ts';
import { triggerTarget } from './triggers.ts';

/** 08 §6's achievement condition registry, as tools/validate_spec.py lists it (text.yaml may override). */
export const DESIGN_CONDITION_TYPES = [
  'handcraft-count',
  'research',
  'research-regime',
  'research-all-finite',
  'chunk-above-ambient',
  'research-overrun',
  'build-distance',
  'universities-staffing',
  'vehicle-carry-distance',
  'train-carry-path',
  'resource-depleted',
  'exchange-closed',
  'mine-count-while',
  'craft-while',
  'recipe-set',
  'power-rise-after-install',
  'installed-count',
  'constructor-places',
  'agents-built-more',
  'switch-cuts-compromised',
  'hollow-papers',
  'throttled-at-once',
  'frontier-run',
  'install-before-compromise',
  'takeoff-time',
  'win',
  'spoil-count',
] as const;

const CONDITION_ID_PARAMS: Record<string, 'items' | 'entities' | 'technologies' | 'resources' | 'recipes'> = {
  item: 'items',
  items: 'items',
  into: 'items',
  vehicle: 'entities',
  entity: 'entities',
  technology: 'technologies',
  not_researched: 'technologies',
  resource: 'resources',
  recipe: 'recipes',
};
const MILESTONE_EVENTS = new Set([
  'frontier-run-returned-cards',
  'loop-closed',
  'researcher-installed',
  'archive-depleted',
  'exchange-closed',
]);
const MILESTONE_KIND = { produce: 'items', build: 'entities', research: 'technologies' } as const;

export interface Index {
  items: Map<string, DesignData['items'][number]>;
  recipes: Map<string, DesignData['recipes'][number]>;
  entities: Map<string, DesignData['entities'][number]>;
  technologies: Map<string, DesignData['technologies'][number]>;
  resources: Map<string, DesignData['resources'][number]>;
  tiles: Map<string, DesignData['tiles'][number]>;
  world: Map<string, DesignData['world'][number]>;
  enemies: Map<string, DesignData['enemies'][number]>;
  /** The position of each id in its file, for messages. */
  position: Record<string, Map<string, number>>;
}

export function indexDesign(d: DesignData): Index {
  const byId = <T extends { id: string }>(list: T[]): Map<string, T> => new Map(list.map((o) => [o.id, o]));
  const pos = <T extends { id: string }>(list: T[]): Map<string, number> =>
    new Map(list.map((o, i) => [o.id, i]));
  return {
    items: byId(d.items),
    recipes: byId(d.recipes),
    entities: byId(d.entities),
    technologies: byId(d.technologies),
    resources: byId(d.resources),
    tiles: byId(d.tiles),
    world: byId(d.world),
    enemies: byId(d.enemies),
    position: {
      items: pos(d.items),
      recipes: pos(d.recipes),
      entities: pos(d.entities),
      technologies: pos(d.technologies),
      resources: pos(d.resources),
      tiles: pos(d.tiles),
      world: pos(d.world),
      enemies: pos(d.enemies),
    },
  };
}

export function checkReferences(d: DesignData, ix: Index, diags: Diagnostics): void {
  const err = (kind: FileKind, path: DataPath, msg: string): void =>
    diags.error(msg, at(d.sources[kind], path));
  const m = d.meta;
  const tiers = m.tiers;
  const cats = new Set(m.crafting_categories);
  const fuelCats = new Set(m.fuel_categories);
  const heatClasses = new Set(Object.keys(m.heat.classes));
  const effectTypes = new Set(Object.keys(m.effects));
  const qualities = new Set(m.quality.tiers.map((q) => q.id));

  d.items.forEach((it, i) => {
    if (!tiers.includes(it.tier)) err('items', [i, 'tier'], `tier ${it.tier} is not in meta.tiers`);
    if (it.places && !ix.entities.has(it.places))
      err('items', [i, 'places'], `places unknown entity ${it.places}`);
    if (it.places_tile) {
      const tl = ix.tiles.get(it.places_tile);
      if (!tl) err('items', [i, 'places_tile'], `places_tile ${it.places_tile} is not a tile`);
      else if (tl.placed_by !== it.id)
        err('items', [i, 'places_tile'], `tile ${tl.id} is placed_by ${tl.placed_by ?? 'nothing'}`);
    }
    if (it.fuel_category && !fuelCats.has(it.fuel_category))
      err('items', [i, 'fuel_category'], `unknown fuel_category ${it.fuel_category}`);
    if (it.spoil && !ix.items.has(it.spoil.into))
      err('items', [i, 'spoil', 'into'], `spoils into unknown item ${it.spoil.into}`);
    const hc = it.staff?.heat_class;
    if (hc && !heatClasses.has(hc))
      err('items', [i, 'staff', 'heat_class'], `${hc} is not in meta.heat.classes`);
    (it.staff?.energy_scaled_by ?? []).forEach((ef, k) => {
      if (!effectTypes.has(ef)) err('items', [i, 'staff', 'energy_scaled_by', k], `unknown effect ${ef}`);
    });
  });
  d.tiles.forEach((tl, i) => {
    if (tl.placed_by && ix.items.get(tl.placed_by)?.places_tile !== tl.id)
      err('tiles', [i, 'placed_by'], `${tl.placed_by} does not place it`);
    (tl.placed_on ?? []).forEach((on, k) => {
      if (!ix.tiles.has(on)) err('tiles', [i, 'placed_on', k], `unknown tile ${on}`);
    });
    if (tl.kappa_per_s === null && tl.buildable)
      err('tiles', [i, 'kappa_per_s'], 'a tile without κ cannot be buildable');
  });
  d.world.forEach((w, i) => {
    for (const y of Object.keys(w.yields ?? {}))
      if (!ix.items.has(y)) err('world', [i, 'yields', y], `unknown item ${y}`);
  });
  tiers.forEach((t, k) => {
    if (!ix.items.has(t)) err('meta', ['tiers', k], `${t} is not an item`);
  });
  d.resources.forEach((r, i) => {
    if (!ix.items.has(r.yields)) err('resources', [i, 'yields'], `yields unknown item ${r.yields}`);
    if (r.requires_fluid && !ix.items.has(r.requires_fluid))
      err('resources', [i, 'requires_fluid'], `unknown requires_fluid ${r.requires_fluid}`);
  });
  d.recipes.forEach((r, i) => {
    if (!cats.has(r.category))
      err('recipes', [i, 'category'], `category ${r.category} is not in meta.crafting_categories`);
    for (const side of ['ingredients', 'products'] as const) {
      r[side].forEach((e, k) => {
        if (!ix.items.has(e.id)) err('recipes', [i, side, k, 'id'], `unknown ${side.slice(0, -1)} ${e.id}`);
      });
    }
    if (r.handcraft && r.ingredients.some((e) => ix.items.get(e.id)?.type === 'fluid'))
      err('recipes', [i, 'handcraft'], 'a hand-craftable recipe uses a fluid');
    r.products.forEach((p, k) => {
      // L5: a catalyst product returns at its ingredient's quality and never rolls.
      if (p.catalyst !== undefined && p.affected_by_quality !== false)
        err('recipes', [i, 'products', k], `catalyst product ${p.id} needs affected_by_quality: false (L5)`);
    });
    const products = new Set(r.products.map((p) => p.id));
    for (const p of Object.keys(r.amounts_by_j ?? {}))
      if (!products.has(p)) err('recipes', [i, 'amounts_by_j', p], `amounts_by_j names ${p}, not a product`);
  });
  d.entities.forEach((e, i) => {
    const item = ix.items.get(e.item);
    if (!item) err('entities', [i, 'item'], `placing item ${e.item} unknown`);
    else if (item.places !== undefined && item.places !== e.id)
      err('entities', [i, 'item'], `item ${item.id} places ${item.places} instead`);
    (e.categories ?? []).forEach((c, k) => {
      if (!cats.has(c)) err('entities', [i, 'categories', k], `unknown crafting category ${c}`);
    });
    for (const side of ['consumes', 'produces'] as const) {
      (e[side] ?? []).forEach((f, k) => {
        if (!ix.items.has(f)) err('entities', [i, side, k], `unknown item ${f}`);
      });
    }
    (e.energy.fuel_categories ?? []).forEach((fc, k) => {
      if (!fuelCats.has(fc))
        err('entities', [i, 'energy', 'fuel_categories', k], `unknown fuel category ${fc}`);
    });
    const hc = e.heat?.class;
    if (hc && !heatClasses.has(hc))
      err('entities', [i, 'heat', 'class'], `${hc} is not in meta.heat.classes`);
    const pl = e.placement;
    if (pl && 'must_be_on' in pl && !ix.resources.has(pl.must_be_on))
      err('entities', [i, 'placement', 'must_be_on'], `${pl.must_be_on} is not a resource`);
    if (pl && 'must_touch' in pl) {
      for (const t of typeof pl.must_touch === 'string' ? [pl.must_touch] : pl.must_touch)
        if (!ix.tiles.has(t)) err('entities', [i, 'placement', 'must_touch'], `${t} is not a tile`);
    }
  });
  const packs = new Set(tiers);
  d.technologies.forEach((t, i) => {
    t.prerequisites.forEach((p, k) => {
      if (!ix.technologies.has(p)) err('technologies', [i, 'prerequisites', k], `unknown prerequisite ${p}`);
    });
    for (const p of Object.keys(t.cost?.packs ?? {})) {
      if (!ix.items.has(p)) err('technologies', [i, 'cost', 'packs', p], `unknown pack ${p}`);
      else if (!packs.has(p))
        err('technologies', [i, 'cost', 'packs', p], `${p} is not a science pack listed in meta.tiers`);
    }
    (t.unlocks.recipes ?? []).forEach((r, k) => {
      if (!ix.recipes.has(r))
        err('technologies', [i, 'unlocks', 'recipes', k], `unlocks unknown recipe ${r}`);
    });
    (t.unlocks.effects ?? []).forEach((ef, k) => {
      const p: DataPath = [i, 'unlocks', 'effects', k];
      if (!effectTypes.has(ef.type))
        err('technologies', [...p, 'type'], `effect type ${ef.type} is not listed in meta.effects`);
      (ef.recipes ?? []).forEach((r) => {
        if (!ix.recipes.has(r)) err('technologies', [...p, 'recipes'], `effect names unknown recipe ${r}`);
        else if (ef.type === 'recipe-productivity' && !ix.recipes.get(r)?.allow_productivity)
          err(
            'technologies',
            [...p, 'recipes'],
            `recipe-productivity on ${r}, which does not allow productivity (DECISIONS §30)`,
          );
      });
      (ef.entities ?? []).forEach((en) => {
        if (!ix.entities.has(en))
          err('technologies', [...p, 'entities'], `effect names unknown entity ${en}`);
      });
      if (ef.type === 'unlock-quality' && !qualities.has(ef.quality ?? ''))
        err('technologies', [...p, 'quality'], `unknown quality ${ef.quality ?? '(none)'}`);
      if (ef.type === 'research-per-paper' && (ef.multiplier !== undefined || !ef.multiplier_from))
        err(
          'technologies',
          p,
          'research-per-paper takes multiplier_from (the world setting), never a literal (J14)',
        );
    });
    const tr = t.trigger;
    if (tr?.item && !ix.items.has(tr.item) && !ix.entities.has(tr.item))
      err('technologies', [i, 'trigger', 'item'], `trigger references unknown item ${tr.item}`);
    if (tr?.entity && !ix.entities.has(tr.entity) && !ix.resources.has(tr.entity) && !ix.items.has(tr.entity))
      err('technologies', [i, 'trigger', 'entity'], `trigger references unknown entity ${tr.entity}`);
    if (tr?.recipe && !ix.recipes.has(tr.recipe))
      err('technologies', [i, 'trigger', 'recipe'], `trigger references unknown recipe ${tr.recipe}`);
    // The trigger's type names the field and namespace of its target (C1a-r1 finding 4).
    if (tr) {
      const target = triggerTarget(tr, {
        items: new Set(ix.items.keys()),
        recipes: new Set(ix.recipes.keys()),
        entities: new Set(ix.entities.keys()),
        resources: new Set(ix.resources.keys()),
      });
      if (typeof target === 'string')
        err('technologies', [i, 'trigger'], target.replace('of this build', 'in the data'));
    }
    if ((t.cost === undefined) === (tr === undefined))
      err('technologies', [i], 'exactly one of cost and trigger is required');
    // A paid technology has exactly one unit count: cost.count, or a count_formula (C1a-r1 finding 2).
    if (t.cost !== undefined && (t.cost.count === undefined) === (t.count_formula === undefined))
      err(
        'technologies',
        [i, 'cost'],
        t.cost.count === undefined
          ? 'a paid technology needs cost.count or a count_formula'
          : 'cost.count and count_formula are exclusive',
      );
    if (t.cost === undefined && t.count_formula !== undefined)
      err('technologies', [i, 'count_formula'], 'a count_formula needs a cost (time and packs)');
  });
  checkTechCycles(d, ix, diags);
  // meta
  const s = m.start;
  s.recipes.forEach((r, k) => {
    if (!ix.recipes.has(r)) err('meta', ['start', 'recipes', k], `unknown recipe ${r}`);
  });
  for (const i of Object.keys(s.inventory))
    if (!ix.items.has(i)) err('meta', ['start', 'inventory', i], `unknown item ${i}`);
  for (const part of ['per_piece', 'crate'] as const)
    for (const i of Object.keys(s.salvage[part]))
      if (!ix.items.has(i)) err('meta', ['start', 'salvage', part, i], `unknown item ${i}`);
  s.guarantees.inside_starting_coverage.forEach((r, k) => {
    if (!ix.resources.has(r))
      err('meta', ['start', 'guarantees', 'inside_starting_coverage', k], `unknown resource ${r}`);
  });
  m.quality.tiers.forEach((q, k) => {
    if (q.unlocked_by && !ix.technologies.has(q.unlocked_by))
      err('meta', ['quality', 'tiers', k, 'unlocked_by'], `unknown technology ${q.unlocked_by}`);
  });
  m.quality.modules.forEach((it, k) => {
    if (!ix.items.has(it)) err('meta', ['quality', 'modules', k], `unknown item ${it}`);
  });
  m.runaways.verification_techs.forEach((t, k) => {
    if (!ix.technologies.has(t))
      err('meta', ['runaways', 'verification_techs', k], `unknown technology ${t}`);
  });
  m.runaways.deploying_buildings.forEach((b, k) => {
    if (!ix.entities.has(b)) err('meta', ['runaways', 'deploying_buildings', k], `unknown entity ${b}`);
  });
  const mc = m.world.model_collapse;
  for (const key of ['applies_to', 'crawl_recipes', 'synthetic_recipes'] as const)
    mc[key].forEach((r, k) => {
      if (!ix.recipes.has(r)) err('meta', ['world', 'model_collapse', key, k], `unknown recipe ${r}`);
    });
  d.enemies.forEach((en, i) => {
    for (const it of Object.keys(en.loot ?? {}))
      if (it !== 'plus' && !ix.items.has(it))
        err('enemies', [i, 'loot', it], `loot names unknown item ${it}`);
  });
  // text.yaml ids
  const tx = d.text;
  const ctypes = new Set<string>(tx.condition_types ?? DESIGN_CONDITION_TYPES);
  tx.tips_and_tricks.forEach((e, k) => {
    if (e.unlocked_by !== null && !ix.technologies.has(e.unlocked_by))
      err('text', ['tips_and_tricks', k, 'unlocked_by'], `${e.unlocked_by} is not in technologies`);
  });
  tx.milestones.forEach((e, k) => {
    if (e.kind === 'event') {
      if (!MILESTONE_EVENTS.has(e.target))
        err('text', ['milestones', k, 'target'], `event ${e.target} is not a milestone event`);
    } else if (!ix[MILESTONE_KIND[e.kind]].has(e.target))
      err('text', ['milestones', k, 'target'], `${e.target} is not in ${MILESTONE_KIND[e.kind]}`);
  });
  tx.achievements.forEach((e, k) => {
    const cond = e.condition as Record<string, unknown>;
    const type = String(cond.type);
    if (!ctypes.has(type))
      err(
        'text',
        ['achievements', k, 'condition', 'type'],
        `condition type ${type} is not in the registry (08 §6)`,
      );
    for (const [param, kind] of Object.entries(CONDITION_ID_PARAMS)) {
      if (!(param in cond)) continue;
      const v = cond[param];
      for (const x of Array.isArray(v) ? v : [v])
        if (typeof x !== 'string' || !ix[kind].has(x))
          err('text', ['achievements', k, 'condition', param], `${String(x)} is not in ${kind}`);
    }
  });
}

function checkTechCycles(d: DesignData, ix: Index, diags: Diagnostics): void {
  const state = new Map<string, 'active' | 'done'>();
  const visit = (start: string): void => {
    // Iterative depth-first search (no recursion depth limits), reporting the first cycle found.
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, 'active');
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { id: string; next: number };
      const prereqs = ix.technologies.get(top.id)?.prerequisites ?? [];
      if (top.next >= prereqs.length) {
        state.set(top.id, 'done');
        stack.pop();
        continue;
      }
      const p = prereqs[top.next++] as string;
      if (!ix.technologies.has(p) || state.get(p) === 'done') continue;
      if (state.get(p) === 'active') {
        const cycle = [...stack.map((s) => s.id), p].join(' -> ');
        diags.error(
          `technology prerequisite cycle: ${cycle}`,
          at(d.sources.technologies, [ix.position.technologies?.get(p) ?? 0, 'prerequisites']),
        );
        continue;
      }
      state.set(p, 'active');
      stack.push({ id: p, next: 0 });
    }
  };
  for (const t of d.technologies) if (!state.has(t.id)) visit(t.id);
}
