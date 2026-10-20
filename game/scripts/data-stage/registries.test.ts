// The design data against the engine registries (C1a open issue 2): a name outside its registry is an
// error at its YAML field, over the whole design data. Edits run on a scratch copy of the data.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { edit, messages, options, scratchRepo } from '../../test/helpers/data-stage.ts';
import { runDataStage } from './index.ts';

describe('the registries', () => {
  it('refuses an effect type outside the effects registry', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(spec, 'data/meta.yaml'),
      /\neffects:\n/,
      "\neffects:\n  brand-new-effect: {line: 'New effect {pct}'}\n",
    );
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(
      /meta\.yaml:\d+:\d+: effects\.brand-new-effect: effect brand-new-effect is not in the effects registry/,
    );
  });

  it('refuses a formula reference outside the formula_refs registry', () => {
    const { game, spec } = scratchRepo();
    edit(join(spec, 'data/meta.yaml'), 'formula_ref: 01 §9\n', 'formula_ref: 99 §1\n');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(/meta\.yaml:\d+:\d+: .*formula reference 99 §1 is not in the formula_refs registry/);
  });

  it('refuses an achievement condition outside the achievement_conditions registry', () => {
    const { game, spec } = scratchRepo();
    edit(join(spec, 'data/text.yaml'), /condition: \{type: handcraft-count/, 'condition: {type: hand-count');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(
      /text\.yaml:\d+:\d+: .*achievement condition hand-count is not in the achievement_conditions registry/,
    );
  });
});
