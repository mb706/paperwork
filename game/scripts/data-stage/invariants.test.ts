// The relationship checks (D1-r1 finding 5): the data stage refuses what tools/validate_spec.py refuses, in every
// build, at the YAML field. python-agreement.test.ts holds the two validators to the same verdicts over a set of
// mutations; these pin the messages and locations. Error cases run on a scratch copy of the inputs.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { edit, messages, options, scratchRepo } from '../../test/helpers/data-stage.ts';
import { runDataStage } from './index.ts';

const m1 = (game: string, spec: string) => ({ ...options(game, spec), manifest: 'm1' });

describe('the relationship checks refuse', () => {
  it("a steam engine whose max_kw is not its steam's power, even in the strict M1 build (the review's case)", () => {
    const { game, spec } = scratchRepo();
    edit(
      join(spec, 'data/entities.yaml'),
      'extra: {max_kw: 900, steam_per_s: 30',
      'extra: {max_kw: 901, steam_per_s: 30',
    );
    for (const o of [m1(game, spec), options(game, spec)])
      expect(messages(runDataStage(o)).join('\n')).toMatch(
        /entities\.yaml:\d+:\d+: entities\[\d+\] \(steam-engine\)\.extra\.max_kw: entity steam-engine: max_kw 901 is not steam_per_s × \(max_temperature_c − 15 °C\) × steam's heat capacity = 900/,
      );
  });

  it("water's heat capacity at steam's: the 1 : 10 no longer carries the energy over", () => {
    const { game, spec } = scratchRepo();
    edit(join(spec, 'data/items.yaml'), '  heat_capacity_kj_per_k: 2\n', '  heat_capacity_kj_per_k: 0.2\n');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(
      /entity boiler: water_per_s × water's heat capacity \(1\.2\) must equal steam_per_s × steam's \(12\)/,
    );
    expect(out).toMatch(/entity heat-exchanger: water_per_s × water's heat capacity/);
  });

  it("steam without its 5,000 °C limit: the boiler's 165 °C lies outside it", () => {
    const { game, spec } = scratchRepo();
    edit(join(spec, 'data/items.yaml'), '  max_temperature: 5000\n', '');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(
      /\(boiler\)\.extra\.temp_c: entity boiler: extra\.temp_c 165 °C lies outside steam's temperatures \[15, 15\]/,
    );
    expect(out).toMatch(
      /entity steam-turbine: extra\.max_temperature_c 500 °C lies outside steam's temperatures/,
    );
  });

  it('a lamp without the lamp priority, and the priority on something else', () => {
    const { game, spec } = scratchRepo();
    const ents = join(spec, 'data/entities.yaml');
    edit(ents, '{source: electric, kw: 5, priority: lamp}', '{source: electric, kw: 5}');
    edit(
      ents,
      '{source: electric, kw: 1}\n  mirrors: decider-combinator',
      '{source: electric, kw: 1, priority: lamp}\n  mirrors: decider-combinator',
    );
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(
      /\(small-lamp\)\.energy: entity small-lamp: energy\.priority lamp is exactly the lamps'/,
    );
    expect(out).toMatch(/entity decider-combinator: energy\.priority lamp is exactly the lamps'/);
  });

  it('town class probabilities that do not sum to 1, and a copy that disagrees', () => {
    const { game, spec } = scratchRepo();
    const meta = join(spec, 'data/meta.yaml');
    edit(meta, 'probability: [0.4, 0.25, 0.15]', 'probability: [0.5, 0.25, 0.15]');
    edit(meta, 'starting_archive_records: 80000', 'starting_archive_records: 80001');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(/meta\.world\.towns\.classes: the class probabilities of band 0 sum to 1\.1, not 1/);
    expect(out).toMatch(
      /duplicated value disagrees: meta\.world\.archives\.starting_archive vs meta\.start\.guarantees\.starting_archive_records: 80000 != 80001/,
    );
  });
});
