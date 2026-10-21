// Regression tests for codex's review C1a-r1 (findings 1–6): each fails on the code before its fix.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { edit, messages, options, scratchRepo } from '../../test/helpers/data-stage.ts';
import { ByteReader } from '../lib/bytes.ts';
import { readColumnTable, readSections } from './emit/container.ts';
import { HEADER_BYTES, SECTION_IDS } from './emit/protos-bin.ts';
import { type DataStageOptions, OUTPUT_PATHS, runDataStage } from './index.ts';

const m1 = (game: string, spec: string): DataStageOptions => ({
  ...options(game, spec),
  manifest: 'm1',
  allowIncomplete: true,
});

/** The sections of a prototypes.bin, by id. */
function sections(bin: Uint8Array): Map<number, Uint8Array> {
  const rd = new ByteReader(bin);
  rd.take(HEADER_BYTES - 8);
  const count = rd.u32();
  rd.u32();
  return new Map(readSections(rd, count).map((s) => [s.id, s.data]));
}

describe('C1a-r1 findings', () => {
  it('1: refuses a value that becomes infinite in the engine unit, at its YAML field', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(spec, 'data/items.yaml'),
      'heat_capacity_kj_per_k: 2\n  tags: [fluid]\n  desc: Boils',
      'heat_capacity_kj_per_k: 1.0e+308\n  tags: [fluid]\n  desc: Boils',
    );
    const out = messages(runDataStage(m1(game, spec))).join('\n');
    expect(out).toMatch(
      /items\.yaml:\d+:\d+: items\[\d+\] \(water\)\.heat_capacity_kj_per_k: heat_capacity \(.*\): Infinity is not a finite number/,
    );
  });

  it('1: refuses an integer that does not fit its column', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(spec, 'data/items.yaml'),
      /(- id: iron-chest\n {2}name: Iron chest\n {2}type: item\n {2})stack: 50/,
      '$1stack: 5000000000',
    );
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(
      /items\.yaml:\d+:\d+: items\[\d+\] \(iron-chest\)\.stack: stack_size \(items\.stack\): 5000000000 does not fit a u32/,
    );
  });

  it('2: refuses a paid technology without a unit count', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(spec, 'data/technologies.yaml'),
      '  cost:\n    count: 25\n    time: 10\n    packs: {memo: 1}\n  unlocks:\n    recipes: [electric-mining-drill]',
      '  cost:\n    time: 10\n    packs: {memo: 1}\n  unlocks:\n    recipes: [electric-mining-drill]',
    );
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(
      /technologies\.yaml:\d+:\d+: technologies\[\d+\] \(electric-mining-drill\)\.cost: a paid technology needs cost\.count or a count_formula/,
    );
  });

  it('3: refuses a resource no included extractor can take', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(game, 'data/engine/capabilities.yaml'),
      'resources: [iron-ore-patch]',
      'resources: [iron-ore-patch, water]',
    );
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(/resource water cannot be extracted in m0/);
    expect(out).toMatch(/item water is not obtainable in m0/);
  });

  it('3: refuses a recipe no included technology enables', () => {
    const { game, spec } = scratchRepo();
    edit(join(game, 'data/engine/capabilities.yaml'), 'recipes: [iron-chest]', 'recipes: [iron-chest, pipe]');
    edit(
      join(game, 'data/engine/capabilities.yaml'),
      'entities: [iron-chest]',
      'entities: [iron-chest, pipe]',
    );
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(/recipe pipe is never enabled in m0/);
    expect(out).toMatch(/item pipe is not obtainable in m0/);
  });

  it('3: refuses a technology the build cannot research, and a trigger target outside the build', () => {
    const { game, spec } = scratchRepo();
    edit(join(game, 'data/engine/capabilities.yaml'), 'technologies: []', 'technologies: [steam-power]');
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /steam-power unlocks pipe, which m0 does not include/,
    );
    const two = scratchRepo();
    edit(
      join(two.spec, 'data/technologies.yaml'),
      'trigger: {type: craft-item, item: iron-plate, count: 50}\n  unlocks:\n    recipes: [pipe, pipe-to-ground, offshore-pump, boiler, steam-engine]',
      'trigger: {type: craft-item, item: copper-plate, count: 50}\n  unlocks:\n    recipes: []',
    );
    edit(join(two.game, 'data/engine/capabilities.yaml'), 'technologies: []', 'technologies: [steam-power]');
    edit(join(two.game, 'data/engine/capabilities.yaml'), 'triggers: []', 'triggers: [craft-item]');
    const out = messages(runDataStage(options(two.game, two.spec))).join('\n');
    expect(out).toMatch(/steam-power: craft-item target copper-plate is not an item of this build/);
    expect(out).toMatch(/technology steam-power cannot be researched inside m0/);
  });

  it('4: resolves a build-entity trigger to the entity, not the item of the same name', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(spec, 'data/technologies.yaml'),
      'trigger: {type: craft-item, item: iron-plate, count: 50}',
      'trigger: {type: build-entity, entity: iron-chest}',
    );
    const r = runDataStage(m1(game, spec));
    expect(messages(r)).toEqual([]);
    const s = sections(r.outputs.get(OUTPUT_PATHS.bin) as Uint8Array);
    const names = new ByteReader(s.get(SECTION_IDS.NAMES) as Uint8Array);
    const kinds = Array.from({ length: 9 }, () => Array.from({ length: names.u16() }, () => names.str16()));
    const tech = readColumnTable(s.get(SECTION_IDS.PROTO_TECH) as Uint8Array);
    const col = (n: string) => tech.columns.find((c) => c.name === n)?.values ?? [];
    const row = (kinds[4] as string[]).indexOf('steam-power');
    expect(col('trigger_target_kind')[row]).toBe(3);
    expect(col('trigger_target')[row]).toBe((kinds[3] as string[]).indexOf('iron-chest'));
  });

  it('4: refuses a trigger whose target is named by the wrong field', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(spec, 'data/technologies.yaml'),
      'trigger: {type: craft-item, item: iron-plate, count: 50}',
      'trigger: {type: build-entity, item: iron-chest}',
    );
    expect(messages(runDataStage(m1(game, spec))).join('\n')).toMatch(
      /technologies\.yaml:\d+:\d+: technologies\[\d+\] \(steam-power\)\.trigger: a build-entity trigger names its target in `entity`/,
    );
  });

  it('5: every output states what it carries and what it omits', () => {
    const r = runDataStage(options());
    const meta = new ByteReader(
      sections(r.outputs.get(OUTPUT_PATHS.bin) as Uint8Array).get(SECTION_IDS.META) as Uint8Array,
    );
    expect(meta.u32()).toBe(2);
    expect(meta.u16()).toBe(1); // record types ascend: 1 start, then 2 contents
    meta.take(meta.u32());
    expect(meta.u16()).toBe(2);
    meta.u32();
    const strList = (): string[] => {
      expect(meta.u16() > 0).toBe(true); // field id
      meta.u32();
      return Array.from({ length: meta.u32() }, () => meta.str16());
    };
    expect(strList()).toEqual(['start.inventory']);
    const omitted = strList();
    expect(omitted).toContain('meta.world');
    expect(omitted).toContain('technologies.unlocks.effects');
    expect(omitted).toContain('enemies');
    const json = JSON.parse(new TextDecoder().decode(r.outputs.get(OUTPUT_PATHS.json)));
    const manifest = JSON.parse(new TextDecoder().decode(r.outputs.get(OUTPUT_PATHS.manifest)));
    expect(json.contents).toEqual({ meta: ['start.inventory'], omitted });
    expect(manifest.contents).toEqual(json.contents);
  });

  it('5: refuses a capability manifest that reads a META block the binary does not carry', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(game, 'data/engine/capabilities.yaml'),
      'data: [start.inventory]',
      'data: [start.inventory, world]',
    );
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /m0 reads meta world, which prototypes\.bin does not carry yet/,
    );
  });

  it('6: refuses a level range the engine cannot store', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(spec, 'data/technologies.yaml'),
      'count_formula: 2^L*1000\n  first_level: 1',
      'count_formula: 1/(L-65536)\n  first_level: 65536',
    );
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /\(artillery-range\)\.first_level: first_level 65536 is above the highest level, 65535/,
    );
  });
});
