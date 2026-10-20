// Shared building blocks of the design-data schema (design/spec/data/SCHEMA.md).
//
// J1 (10 §2.4 step 4): the engine's schema names every field. Fields the engine consumes are typed as a
// number, an id, an enum or an expression. Fields it does not consume are documentation for people
// (`doc`): free text, never read by code. Objects are strict, so a misspelt field is an error, but the
// documentation keys of DOC_KEYS are welcome in every block.
import { z } from 'zod';

export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A prototype id: kebab-case, unique within its kind. */
export const id = z.string().regex(ID_PATTERN, { error: 'expected a kebab-case id' });
/** A mapping key that is not a prototype id (setting names, text keys): snake_case or kebab-case. */
export const key = z.string().regex(/^[a-z][a-z0-9_-]*$/, { error: 'expected a lowercase key' });
/** Documentation for people: never read by the engine. */
export const doc = z.string();
export const num = z.number();
export const int = z.int();
export const posNum = z.number().positive();
export const nonNeg = z.number().nonnegative();
export const posInt = z.int().positive();
export const bool = z.boolean();
export const idList = z.array(id);
/** A formula field (10 §2.4 step 2): a number, or an expression the expression compiler parses. */
export const expr = z.union([z.number(), z.string()]);
/** `{item-id: amount}`. */
export const amounts = z.record(id, z.number());
/** `[a, b]`. */
export const pair = z.tuple([z.number(), z.number()]);
/** `[w, h]` in tiles. */
export const size = z.tuple([posInt, posInt]);

/** Keys that hold documentation wherever they appear (rules, formulas, notes, citations of the prose). */
export const DOC_KEYS = ['rule', 'formula', 'formula_ref', 'note', 'notes'] as const;

const docShape = Object.fromEntries(DOC_KEYS.map((k) => [k, doc.optional()])) as {
  [K in (typeof DOC_KEYS)[number]]: z.ZodOptional<z.ZodString>;
};

/** A strict object that also accepts the documentation keys. */
export function block<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject({ ...docShape, ...shape });
}
