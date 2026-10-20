// Trigger targets resolve in the namespace their type names (C1a-r1 finding 4).
import { describe, expect, it } from 'vitest';
import { triggerTarget } from './triggers.ts';

const sets = {
  items: new Set(['iron-chest', 'iron-plate', 'water']),
  recipes: new Set(['iron-chest', 'research-run']),
  entities: new Set(['iron-chest', 'twin']),
  resources: new Set(['iron-ore-patch', 'twin']),
};

describe('triggerTarget', () => {
  it('takes the namespace from the type, not from the name', () => {
    expect(triggerTarget({ type: 'build-entity', entity: 'iron-chest' }, sets)).toEqual({
      kind: 'entity',
      name: 'iron-chest',
    });
    expect(triggerTarget({ type: 'craft-item', item: 'iron-chest' }, sets)).toEqual({
      kind: 'item',
      name: 'iron-chest',
    });
    expect(triggerTarget({ type: 'craft-recipe', recipe: 'iron-chest' }, sets)).toEqual({
      kind: 'recipe',
      name: 'iron-chest',
    });
    expect(triggerTarget({ type: 'mine-entity', entity: 'iron-ore-patch' }, sets)).toEqual({
      kind: 'resource',
      name: 'iron-ore-patch',
    });
    expect(triggerTarget({ type: 'mine-entity', entity: 'iron-chest' }, sets)).toEqual({
      kind: 'entity',
      name: 'iron-chest',
    });
    expect(triggerTarget({ type: 'launch', item: 'water' }, sets)).toEqual({ kind: 'item', name: 'water' });
    expect(triggerTarget({ type: 'start' }, sets)).toBeNull();
    expect(triggerTarget({ type: 'research' }, sets)).toBeNull();
  });
  it('refuses a missing, misplaced, outside or ambiguous target', () => {
    expect(triggerTarget({ type: 'build-entity', item: 'iron-chest' }, sets)).toMatch(
      'names its target in `entity`',
    );
    expect(triggerTarget({ type: 'build-entity' }, sets)).toMatch('names its target in `entity`');
    expect(triggerTarget({ type: 'craft-item', item: 'iron-plate', entity: 'iron-chest' }, sets)).toMatch(
      'and nothing else',
    );
    expect(triggerTarget({ type: 'start', item: 'iron-plate' }, sets)).toMatch('names no target');
    expect(triggerTarget({ type: 'build-entity', entity: 'iron-plate' }, sets)).toMatch(
      'not an entity of this build',
    );
    expect(triggerTarget({ type: 'craft-item', item: 'copper-plate' }, sets)).toMatch(
      'not an item of this build',
    );
    expect(triggerTarget({ type: 'mine-entity', entity: 'twin' }, sets)).toMatch('ambiguous');
  });
});
