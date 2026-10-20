// Every field of every design kind is classified as emitted, documentation or omitted, so the outputs'
// `contents` cannot silently go stale when the schema grows (C1a-r1 finding 5).
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { FIELD_STATUS, omittedParts, PARTIAL } from './emit/contents.ts';
import { entity } from './schema/entities.ts';
import { item } from './schema/items.ts';
import { meta } from './schema/meta.ts';
import { recipe } from './schema/recipes.ts';
import { technology } from './schema/technologies.ts';
import { text } from './schema/text.ts';
import { resource, tile, worldObject } from './schema/world.ts';

const SCHEMAS: Record<string, z.ZodObject> = {
  items: item,
  recipes: recipe,
  entities: entity,
  technologies: technology,
  resources: resource,
  tiles: tile,
  world: worldObject,
  text,
  meta,
};

describe('the contents declaration', () => {
  it.each(Object.keys(SCHEMAS))('classifies every field of %s', (kind) => {
    const fields = Object.keys((SCHEMAS[kind] as z.ZodObject).shape).sort();
    expect(Object.keys(FIELD_STATUS[kind] ?? {}).sort()).toEqual(fields);
  });
  it('lists the omitted subfields of every partial field', () => {
    for (const [kind, fields] of Object.entries(FIELD_STATUS))
      for (const [field, status] of Object.entries(fields))
        if (status === 'partial') expect(PARTIAL[`${kind}.${field}`], `${kind}.${field}`).toBeDefined();
    expect(omittedParts()).toContain('meta.world');
    expect(omittedParts()).toContain('technologies.unlocks.effects');
  });
});
