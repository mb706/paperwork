// recipes.yaml (SCHEMA.md "recipes.yaml").
import { z } from 'zod';
import { block, bool, doc, expr, id, nonNeg, posNum } from './common.ts';

export const ingredient = block({ id, amount: posNum });

export const product = block({
  id,
  amount: nonNeg,
  probability: z.number().gt(0).lte(1).optional(),
  catalyst: nonNeg.optional(),
  affected_by_quality: bool.optional(),
});

export const recipe = block({
  id,
  name: doc.optional(),
  category: id,
  time: posNum,
  ingredients: z.array(ingredient),
  products: z.array(product),
  handcraft: bool.optional(),
  allow_productivity: bool.optional(),
  mirrors: doc,
  container: z.enum(['fill', 'empty']).optional(),
  handbook_note: doc.optional(),
  pseudo: bool.optional(),
  shared_unlock: bool.optional(),
  amounts_by_j: z.record(id, expr).optional(),
  victory: bool.optional(),
});

export type Recipe = z.infer<typeof recipe>;
export type Product = z.infer<typeof product>;
