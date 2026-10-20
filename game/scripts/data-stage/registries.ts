// The design data against the engine registries (schema/registries.yaml, generated into
// src/shared/gen/registries.ts; 10 §2.4 step 4, C1a open issue 2). Over the whole design data, not only the
// build, every effect type, trigger type, achievement condition and formula reference the data names must
// be in its registry: the vocabulary is closed, and a new name needs a registry entry (an append-only id)
// before the engine can dispatch on it. The capability manifest's `registries` lists, the entries a
// milestone implements, are checked against the same registries by schema-gen (scripts/schema-gen/
// capabilities.ts) and the data stage (capabilities.ts).
import { ACHIEVEMENT_CONDITIONS, EFFECTS, FORMULA_REFS, TRIGGERS } from '../../src/shared/gen/registries.ts';
import type { Diagnostics } from './diagnostics.ts';
import { leadingRef } from './formula-refs.ts';
import type { DesignData } from './schema/index.ts';
import { at } from './sources.ts';

const has = (list: readonly string[], x: string) => list.includes(x);

export function checkRegistries(d: DesignData, diags: Diagnostics): void {
  const err = (file: 'meta' | 'technologies' | 'text', path: (string | number)[], message: string) =>
    diags.error(message, at(d.sources[file], path));
  for (const name of Object.keys(d.meta.effects).sort())
    if (!has(EFFECTS, name))
      err(
        'meta',
        ['effects', name],
        `effect ${name} is not in the effects registry (game/schema/registries.yaml)`,
      );
  d.technologies.forEach((t, i) => {
    (t.unlocks.effects ?? []).forEach((e, k) => {
      if (!has(EFFECTS, e.type))
        err(
          'technologies',
          [i, 'unlocks', 'effects', k, 'type'],
          `effect ${e.type} is not in the effects registry (game/schema/registries.yaml)`,
        );
    });
    const tr = t.trigger?.type;
    if (tr && !has(TRIGGERS, tr.replace(/-/g, '_')))
      err(
        'technologies',
        [i, 'trigger', 'type'],
        `trigger ${tr} is not in the triggers registry (TriggerType, game/schema/types.yaml)`,
      );
  });
  d.text.achievements.forEach((a, i) => {
    const type = String((a.condition as { type: unknown }).type);
    if (!has(ACHIEVEMENT_CONDITIONS, type))
      err(
        'text',
        ['achievements', i, 'condition', 'type'],
        `achievement condition ${type} is not in the achievement_conditions registry (game/schema/registries.yaml)`,
      );
  });
  (d.text.condition_types ?? []).forEach((c, i) => {
    if (!has(ACHIEVEMENT_CONDITIONS, c))
      err(
        'text',
        ['condition_types', i],
        `achievement condition ${c} is not in the achievement_conditions registry (game/schema/registries.yaml)`,
      );
  });
  // Formula references: every block of meta.yaml that cites one.
  const walk = (v: unknown, path: (string | number)[]): void => {
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(x, [...path, i]);
    } else if (v && typeof v === 'object')
      for (const k of Object.keys(v).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (k === 'formula_ref' && typeof x === 'string') {
          const r = leadingRef(x);
          if (r && !has(FORMULA_REFS, r))
            err(
              'meta',
              [...path, k],
              `formula reference ${r} is not in the formula_refs registry (game/schema/registries.yaml)`,
            );
        } else walk(x, [...path, k]);
      }
  };
  walk(d.meta, []);
}
