// text.yaml (SCHEMA.md "text.yaml"; owned by R4-ui): engine-readable text. The strings are 08's; the
// engine reads ids, conditions and requirements.
import { z } from 'zod';
import { block, bool, doc, id, key, num, posInt } from './common.ts';

/** The `requires` vocabulary (SCHEMA.md text.yaml). */
export const REQUIRES = [
  'heat',
  'staffing',
  'runaways',
  'hollow-work',
  'race',
  'scooped',
  'exchanges',
  'quality',
  'agents',
] as const;

const requires = z.array(z.enum(REQUIRES));
const asserts = z.array(doc);
const conditionValue = z.union([num, z.string(), bool, z.array(z.union([z.string(), num]))]);

export const text = block({
  tips: z.array(block({ id, text: doc, requires, asserts: asserts.optional() })),
  tips_and_tricks: z.array(
    block({ id, title: doc, requires, unlocked_by: id.nullable(), text: doc, asserts: asserts.optional() }),
  ),
  milestones: z.array(block({ id, kind: z.enum(['produce', 'build', 'research', 'event']), target: id })),
  achievements: z.array(
    block({
      id,
      name: doc,
      text: doc,
      condition: z.record(z.string(), conditionValue).and(z.object({ type: id })),
      arc: z.enum(['early', 'mid', 'late']),
      why: doc,
      requires: requires.optional(),
      mirrors: doc.optional(),
      asserts: asserts.optional(),
    }),
  ),
  town_names: block({
    first_by_climate: z.record(id, z.array(doc)),
    second: block({ joined: z.array(doc), spaced: z.array(doc) }),
    blocklist: block({ exact: z.array(doc), containing: z.array(doc) }),
    university: z.record(id, doc),
    library: doc,
    records_store: block({ elements: z.array(doc), pattern: doc }),
    uniqueness: block({ within_cells: posInt, redraws: posInt, suffix: doc }),
  }),
  world_text: z.record(key, block({ desc: doc.optional(), handbook_note: doc.optional() })),
  condition_types: z.array(id).optional(),
});

export type Text = z.infer<typeof text>;
