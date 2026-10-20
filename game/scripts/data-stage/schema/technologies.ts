// technologies.yaml (SCHEMA.md "technologies.yaml").
import { z } from 'zod';
import { block, bool, doc, expr, id, idList, int, num, posInt, posNum } from './common.ts';

/** Trigger types (SCHEMA.md); the engine's registry holds the same list (schema/registries.yaml, C1b). */
export const TRIGGER_TYPES = [
  'start',
  'craft-item',
  'craft-recipe',
  'mine-entity',
  'build-entity',
  'research',
  'launch',
] as const;

export const REGIMES = ['cited', 'infrastructure', 'beyond'] as const;
export const CITATION_KINDS = [
  'article',
  'book',
  'chapter',
  'report',
  'thesis',
  'preprint',
  'patent',
] as const;

export const effect = block({
  type: id,
  value: num.optional(),
  multiplier: num.optional(),
  multiplier_from: z.enum(['returns_to_research']).optional(),
  category: id.optional(),
  turret: id.optional(),
  quality: id.optional(),
  recipes: idList.optional(),
  entities: idList.optional(),
  fraction: num.optional(),
  output: num.optional(),
  energy: num.optional(),
  floor_temperature_k: num.optional(),
});

export const trigger = block({
  type: z.enum(TRIGGER_TYPES),
  item: id.optional(),
  entity: id.optional(),
  recipe: id.optional(),
  count: posInt.optional(),
});

export const citation = block({
  authors: z.array(doc),
  more_authors: bool.optional(),
  role: z.enum(['editor']).optional(),
  year: int,
  title: doc,
  venue: doc,
  kind: z.enum(CITATION_KINDS),
  url: doc.optional(),
});

export const technology = block({
  id,
  name: doc,
  code: doc,
  era: doc,
  regime: z.enum(REGIMES),
  prerequisites: idList,
  unlocks: block({ recipes: idList.optional(), effects: z.array(effect).optional() }),
  mirrors: doc,
  cost: block({ count: posNum.optional(), time: posNum, packs: z.record(id, posNum) }).optional(),
  trigger: trigger.optional(),
  upgrade: bool.optional(),
  citation: z.array(citation).optional(),
  branch: doc.optional(),
  desc: doc.optional(),
  handbook_note: doc.optional(),
  count_formula: z.string().optional(),
  first_level: posInt.optional(),
  max_level: z.union([posInt, z.literal('infinite')]).optional(),
  field_year: expr.optional(),
  essential: bool.optional(),
  hidden: bool.optional(),
});

export type Technology = z.infer<typeof technology>;
