// The capability manifests (10 §2.4; D1): every manifest is resolved and checked, not only the current one, so
// the M1 packages can build against m1 before it is current. Error cases run on a scratch copy.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { edit, messages, options, scratchRepo } from '../../test/helpers/data-stage.ts';
import { GAME } from '../../test/helpers/paths.ts';
import { isDesignPart, loadCapabilities, omittedUnder } from './capabilities.ts';
import { Diagnostics } from './diagnostics.ts';
import { runDataStage } from './index.ts';
import { parseYaml } from './sources.ts';

const capsFile = 'data/engine/capabilities.yaml';

function caps() {
  const d = new Diagnostics();
  const src = parseYaml(capsFile, readFileSync(join(GAME, capsFile), 'utf8'), d);
  if (!src) throw new Error('capabilities.yaml does not parse');
  const c = loadCapabilities(src, d);
  expect(d.list).toEqual([]);
  if (!c) throw new Error('capabilities.yaml does not load');
  return c;
}

describe('the M1 capability manifest', () => {
  it('extends M0, takes the slice filter, and lists what M1 implements', () => {
    const c = caps();
    expect(c.current.name).toBe('m0');
    const m1 = c.manifests.find((m) => m.name === 'm1');
    expect(m1?.filter).toBe('m1');
    expect(m1?.prototypes.entities).toEqual(['iron-chest']); // m0's, which the filter must contain
    expect(m1?.actions).toEqual(expect.arrayContaining(['build', 'rotate_entity', 'undo', 'start_research']));
    expect(m1?.packet_sections).toEqual(
      expect.arrayContaining(['BELT_GEOM', 'BELT_ITEMS', 'HANDS', 'CHART']),
    );
    expect(Object.keys(m1?.systems ?? {})).toEqual(
      expect.arrayContaining(['belts', 'heat', 'staffing', 'worldgen']),
    );
    expect(m1?.registries.effects.sort()).toEqual([
      'character-crafting-speed',
      'character-inventory-slots',
      'character-mining-speed',
      'laboratory-speed',
    ]);
  });

  it('names its reads the way the contents record names the design data', () => {
    expect(isDesignPart('entities.categories')).toBe(true);
    expect(isDesignPart('technologies.unlocks.effects')).toBe(true);
    expect(isDesignPart('entities.heat.emission')).toBe(true);
    expect(isDesignPart('entities.heat.class')).toBe(false); // carried as t_star: not a partial's omitted subfield
    expect(isDesignPart('entities.nonsense')).toBe(false);
    expect(omittedUnder('entities.extra')).toHaveLength(1);
    expect(omittedUnder('entities.mining_speed')).toEqual([]); // carried
    for (const p of caps().manifests.find((m) => m.name === 'm1')?.reads ?? [])
      expect(isDesignPart(p), p).toBe(true);
  });
});

describe('every manifest is checked', () => {
  it('refuses a name the schema lacks, in a manifest that is not current', () => {
    const { game, spec } = scratchRepo();
    edit(join(game, capsFile), '      - pipette\n', '      - pipette\n      - teleport\n');
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /m1: action teleport is not in the schema/,
    );
  });

  it('refuses a system that is none of 10 §5, and a read that is no part of the design data', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(game, capsFile),
      '    systems:\n      character: the walk',
      '    systems:\n      telepathy: none\n      character: the walk',
    );
    edit(join(game, capsFile), '      - world.gui ', '      - world.gui\n      - entities.colour ');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(/m1: system telepathy is none of 10 §5's/);
    expect(out).toMatch(/m1: reads entities.colour, which is no part of the design data/);
  });

  it("checks m1's engine overlay strictly while m0 is current", () => {
    const { game, spec } = scratchRepo();
    edit(
      join(game, 'data/engine/mirrors.yaml'),
      'mining_drill: {resource_searching_radius: 2.49, vector_to_place_result: [0, -1.85]}',
      'mining_drill: {resource_searching_radius: 2.49}',
    );
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /drill electric-mining-drill lacks its mining area or drop point/,
    );
  });

  it('once m1 is current, refuses a build that omits what M1 reads', () => {
    const { game, spec } = scratchRepo();
    edit(join(game, capsFile), 'current: m0', 'current: m1');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(/m1 reads entities\.categories, which the build omits/);
    expect(out).toMatch(/m1 reads meta heat, which prototypes\.bin does not carry yet/);
    expect(out).toMatch(/01 §8 has no implementation tagged `\/\/ @formula 01 §8` under crates\//);
  });
});
