// What a build's player can actually reach (C1a-r1 finding 3): tools/validate_spec.py's `producible`,
// `recipe_craftable`, `trigger_ok`, `lab_exists` and `playthrough`, ported rule for rule but restricted
// to the build's own prototypes. A resource yields only if the character can mine it by hand (solids) or
// an included, placeable extractor can (with its required fluid); a recipe counts only once it is enabled
// (at start, or unlocked by an included technology the build can research); a technology is researchable
// only from inside the build.
import type { Index } from './refs.ts';

/** The prototypes a build holds, by kind. */
export interface PlaySet {
  items: ReadonlySet<string>;
  recipes: ReadonlySet<string>;
  entities: ReadonlySet<string>;
  technologies: ReadonlySet<string>;
  resources: ReadonlySet<string>;
  worldObjects: ReadonlySet<string>;
  startInventory: ReadonlySet<string>;
  startRecipes: ReadonlySet<string>;
}

export interface Playthrough {
  /** Items and fluids obtainable once every reachable technology is researched. */
  have: Set<string>;
  /** Recipes enabled at the end: start recipes and every researched technology's unlocks in the build. */
  enabled: Set<string>;
  /** Technologies researched, in waves. */
  researched: Set<string>;
  /** Resources whose yield can be extracted. */
  extractable: Set<string>;
}

const EXTRACTOR_FOR_KIND: Record<string, readonly string[]> = {
  solid: ['mining-drill'],
  fluid: ['pumpjack', 'mining-drill'],
  offshore: ['offshore-pump'],
};

export function playthrough(set: PlaySet, ix: Index): Playthrough {
  const entities = [...set.entities].map((e) => ix.entities.get(e)).filter((e) => e !== undefined);
  const hasPumpjack = entities.some((e) => e.type === 'pumpjack');
  const free = new Set<string>();
  for (const w of set.worldObjects) for (const y of Object.keys(ix.world.get(w)?.yields ?? {})) free.add(y);
  const isFluid = (i: string) => ix.items.get(i)?.type === 'fluid';
  const handcraftable = (rid: string): boolean => {
    const r = ix.recipes.get(rid);
    if (!r) return false;
    return (r.handcraft ?? r.category === 'crafting') && !r.ingredients.some((i) => isFluid(i.id));
  };
  const extractable = new Set<string>();

  const producible = (enabled: ReadonlySet<string>): Set<string> => {
    const have = new Set([...set.startInventory, ...free]);
    for (;;) {
      const placeable = entities.filter((e) => have.has(e.item));
      const crafters = new Set(placeable.flatMap((e) => e.categories ?? []));
      const add: string[] = [];
      for (const e of placeable)
        if ((e.consumes ?? []).every((f) => have.has(f))) add.push(...(e.produces ?? []));
      for (const iid of have) {
        const into = ix.items.get(iid)?.spoil?.into;
        if (into) add.push(into);
      }
      for (const rid of set.resources) {
        const r = ix.resources.get(rid);
        if (!r) continue;
        const kinds = r.kind === 'fluid' && hasPumpjack ? ['pumpjack'] : (EXTRACTOR_FOR_KIND[r.kind] ?? []);
        const hand = r.kind === 'solid';
        const extractor = placeable.some((e) => kinds.includes(e.type));
        const fluidOk = !r.requires_fluid || have.has(r.requires_fluid);
        if (hand || (extractor && fluidOk)) {
          extractable.add(rid);
          add.push(r.yields);
        }
      }
      for (const rid of enabled) {
        const r = ix.recipes.get(rid);
        if (!r?.ingredients.every((i) => have.has(i.id))) continue;
        if (handcraftable(rid) || crafters.has(r.category)) add.push(...r.products.map((p) => p.id));
      }
      const before = have.size;
      for (const x of add) if (set.items.has(x)) have.add(x);
      if (have.size === before) return have;
    }
  };

  const recipeCraftable = (rid: string, enabled: ReadonlySet<string>, have: ReadonlySet<string>): boolean => {
    const r = ix.recipes.get(rid);
    if (!r || !enabled.has(rid) || !r.ingredients.every((i) => have.has(i.id))) return false;
    if (handcraftable(rid)) return true;
    return entities.some((e) => have.has(e.item) && (e.categories ?? []).includes(r.category));
  };

  const triggerOk = (tid: string, enabled: ReadonlySet<string>, have: ReadonlySet<string>): boolean => {
    const tr = ix.technologies.get(tid)?.trigger;
    if (!tr) return false;
    if (tr.type === 'start') return true;
    if (tr.type === 'craft-recipe') return recipeCraftable(tr.recipe ?? '', enabled, have);
    const target = tr.item ?? tr.entity;
    if (target === undefined) return true;
    if (set.resources.has(target))
      return extractable.has(target) && have.has(ix.resources.get(target)?.yields ?? '');
    if (set.items.has(target)) return have.has(target);
    const e = set.entities.has(target) ? ix.entities.get(target) : undefined;
    return e !== undefined && have.has(e.item);
  };

  const enabled = new Set([...set.startRecipes].filter((r) => set.recipes.has(r)));
  const researched = new Set<string>();
  for (const t of set.technologies) {
    if (ix.technologies.get(t)?.trigger?.type === 'start') {
      researched.add(t);
      for (const r of ix.technologies.get(t)?.unlocks.recipes ?? []) if (set.recipes.has(r)) enabled.add(r);
    }
  }
  for (;;) {
    const have = producible(enabled);
    const labs = entities.some((e) => e.type === 'lab' && have.has(e.item));
    const ready = [...set.technologies].filter((tid) => {
      const t = ix.technologies.get(tid);
      if (!t || researched.has(tid) || !t.prerequisites.every((p) => researched.has(p))) return false;
      if (t.trigger) return triggerOk(tid, enabled, have);
      return labs && Object.keys(t.cost?.packs ?? {}).every((p) => have.has(p));
    });
    if (ready.length === 0) return { have, enabled, researched, extractable };
    for (const tid of ready) {
      researched.add(tid);
      for (const r of ix.technologies.get(tid)?.unlocks.recipes ?? []) if (set.recipes.has(r)) enabled.add(r);
    }
  }
}
