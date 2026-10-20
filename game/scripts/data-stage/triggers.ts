// A trigger technology's target (C1a-r1 finding 4). The trigger's type decides the field that names the
// target and the namespace it lives in, so a name shared across kinds (the item, recipe and entity
// `iron-chest`) resolves to the right one:
//   craft-item, launch    `item`    an item or a fluid
//   craft-recipe          `recipe`  a recipe
//   build-entity          `entity`  an entity
//   mine-entity           `entity`  a resource or an entity (a name that is both is ambiguous)
//   start, research       no target
import type { Technology } from './schema/technologies.ts';

export type TargetKind = 'item' | 'recipe' | 'entity' | 'resource';

export interface TargetSets {
  items: ReadonlySet<string>;
  recipes: ReadonlySet<string>;
  entities: ReadonlySet<string>;
  resources: ReadonlySet<string>;
}

type Trigger = NonNullable<Technology['trigger']>;

const FIELD: Record<Trigger['type'], 'item' | 'recipe' | 'entity' | null> = {
  start: null,
  research: null,
  'craft-item': 'item',
  launch: 'item',
  'craft-recipe': 'recipe',
  'build-entity': 'entity',
  'mine-entity': 'entity',
};

/**
 * The target of a trigger inside a set of prototypes: `{kind, name}`, null for a trigger without a target,
 * or a message when the target is missing, outside the set, named by the wrong field, or ambiguous.
 */
export function triggerTarget(
  tr: Trigger,
  sets: TargetSets,
): { kind: TargetKind; name: string } | null | string {
  const field = FIELD[tr.type];
  const named = (['item', 'recipe', 'entity'] as const).filter((f) => tr[f] !== undefined);
  if (field === null) {
    return named.length === 0
      ? null
      : `a ${tr.type} trigger names no target, but this one has \`${named.join('`, `')}\``;
  }
  if (named.length !== 1 || named[0] !== field)
    return `a ${tr.type} trigger names its target in \`${field}\` (and nothing else)`;
  const name = tr[field] as string;
  switch (tr.type) {
    case 'craft-item':
    case 'launch':
      return sets.items.has(name)
        ? { kind: 'item', name }
        : `${tr.type} target ${name} is not an item of this build`;
    case 'craft-recipe':
      return sets.recipes.has(name)
        ? { kind: 'recipe', name }
        : `craft-recipe target ${name} is not a recipe of this build`;
    case 'build-entity':
      return sets.entities.has(name)
        ? { kind: 'entity', name }
        : `build-entity target ${name} is not an entity of this build`;
    case 'mine-entity': {
      const res = sets.resources.has(name);
      const ent = sets.entities.has(name);
      if (res && ent) return `mine-entity target ${name} is both a resource and an entity: ambiguous`;
      if (res) return { kind: 'resource', name };
      if (ent) return { kind: 'entity', name };
      return `mine-entity target ${name} is neither a resource nor an entity of this build`;
    }
  }
  return `unknown trigger type ${tr.type}`;
}
