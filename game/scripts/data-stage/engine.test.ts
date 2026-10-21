// The engine overlay for M1 (D1; 10 §2.4 step 2): the slice's entities resolve to Factorio 2.0's geometry and
// tables, the M1 build is complete without --allow-incomplete, and the checks refuse a gap or a disagreement
// with the design data. Error cases run on a scratch copy, so the real files are never touched.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { type PrototypesJson, readPrototypesBin } from '../../src/shared/gen/protos.ts';
import { edit, messages, options, scratchRepo } from '../../test/helpers/data-stage.ts';
import { type CapabilityManifest, checkConditionalHeat } from './capabilities.ts';
import { Diagnostics, formatDiagnostic } from './diagnostics.ts';
import { fluidSymmetries } from './engine.ts';
import { type DataStageOptions, type DataStageResult, runDataStage } from './index.ts';
import type { EntityEngine } from './overlay.ts';
import { miningArea, trimmedBox } from './overlay.ts';
import { indexDesign } from './refs.ts';
import { parseYaml } from './sources.ts';

/** The M1 build filter, strict: every gap is an error. */
const m1 = (game?: string, spec?: string): DataStageOptions => ({ ...options(game, spec), manifest: 'm1' });

describe('the M1 engine overlay on the repository data', () => {
  let r: DataStageResult;
  beforeAll(() => {
    r = runDataStage(m1());
  }, 60_000);
  const engine = (id: string): EntityEngine => {
    const e = r.model?.entities.find((x) => x.id === id);
    if (!e) throw new Error(`no entity ${id} in the M1 build`);
    return e.engine;
  };

  it('is complete: the M1 build has neither errors nor warnings without --allow-incomplete', () => {
    expect(r.diagnostics.list.map(formatDiagnostic)).toEqual([]);
    expect(r.model?.entities).toHaveLength(32);
  });

  it("gives the inserters Factorio 2.0's vectors and swing speeds (10 §5.4)", () => {
    expect(engine('inserter').inserter).toEqual({
      pickup: [0, -1],
      drop: [0, 1.2],
      rotation_speed: 0.014,
      extension_speed: 0.035,
      hand_size: 0.75,
      starting_distance: 0.7,
      bulk: false,
    });
    expect(engine('burner-inserter').inserter).toMatchObject({
      rotation_speed: 0.013,
      extension_speed: 0.035,
    });
    expect(engine('long-handed-inserter').inserter).toMatchObject({
      pickup: [0, -2],
      drop: [0, 2.2],
      rotation_speed: 0.02,
    });
    expect(engine('fast-inserter').inserter).toMatchObject({ rotation_speed: 0.04, extension_speed: 0.1 });
    expect(engine('long-handed-inserter').fast_replaceable_group).toBe('long-handed-inserter');
    expect(engine('inserter').next_upgrade).toBe('fast-inserter');
  });

  it('gives the drills their mining areas and drop points, the pump its pumping position (10 §5.6)', () => {
    expect(engine('burner-mining-drill').mining_drill).toEqual({
      resource_searching_radius: 0.99,
      vector_to_place_result: [-0.5, -1.3],
      mining_area: [2, 2],
    });
    expect(engine('electric-mining-drill').mining_drill).toMatchObject({
      mining_area: [5, 5],
      vector_to_place_result: [0, -1.85],
    });
    expect(engine('offshore-pump').offshore_pump).toEqual({ pumping_position: [0, -0.5] });
    expect(engine('offshore-pump').collision_mask).toEqual(['object', 'train']);
  });

  it('gives the fluid entities their boxes (10 §5.8)', () => {
    const boiler = engine('boiler').fluid_boxes;
    expect(boiler.map((b) => [b.production, b.filter, b.connections.map((c) => c.direction)])).toEqual([
      ['input', 'water', ['west', 'east']],
      ['output', 'steam', ['north']],
    ]);
    expect(engine('pipe').fluid_boxes[0]?.connections).toHaveLength(4);
    expect(engine('pipe-to-ground').fluid_boxes[0]?.connections.map((c) => c.type ?? 'normal')).toEqual([
      'normal',
      'underground',
    ]);
    expect(
      engine('assembling-machine-2').fluid_boxes.map((b) => [b.production, b.off_without_fluid_recipe]),
    ).toEqual([
      ['input', true],
      ['output', true],
    ]);
    expect(engine('steam-engine').fluid_boxes[0]).toMatchObject({ volume: 200, filter: 'steam' });
    expect(engine('assembling-machine-1').fluid_boxes).toEqual([]);
  });

  it('gives poles, lamps, burners and furnaces their tables', () => {
    expect(engine('small-electric-pole').electric_pole).toEqual({
      auto_connect_up_to_n_wires: 5,
      track_coverage_during_drag_building: true,
    });
    expect(engine('big-electric-pole').electric_pole?.track_coverage_during_drag_building).toBe(false);
    expect(engine('small-lamp').lamp).toEqual({
      darkness_on: 0.5,
      darkness_off: 0.3,
      light: { size: 40, intensity: 0.9, color: [1, 1, 0.75] },
    });
    expect(engine('stone-furnace').burner).toEqual({ fuel_slots: 1, burnt_result_slots: 0 });
    expect(engine('stone-furnace').furnace).toEqual({ source_slots: 1, result_slots: 1 });
    expect(engine('inserter').burner).toBeNull(); // electric: no burner block
    expect(engine('keypunch')).toMatchObject({ fast_replaceable_group: 'data-smelter', next_upgrade: null });
    expect(engine('stone-furnace').next_upgrade).toBe('steel-furnace');
  });

  it("derives trimmed player boxes (10 §4.4) and gives Factorio's collision masks and map colours", () => {
    expect(engine('solar-panel').player_collision_box).toEqual([-1.25, -1.25, 1.25, 1.25]);
    expect(engine('steam-engine').player_collision_box).toEqual([-1.25, -2.25, 1.25, 2.25]);
    expect(engine('iron-chest').player_collision_box).toEqual([-0.35, -0.35, 0.35, 0.35]); // chests are exempt
    expect(engine('transport-belt')).toMatchObject({
      collision_mask: ['object', 'water'],
      map_color: '#cca147',
    });
    expect(engine('pipe-to-ground').collision_mask).toEqual(['item', 'water']);
    expect(engine('assembling-machine-1')).toMatchObject({
      collision_mask: ['item', 'object', 'player', 'water'],
      map_color: '#006191',
    });
    expect(engine('small-electric-pole').map_color).toBe('#009ea3');
  });

  it('has a terrain material for every tile and a map colour for every resource and world object', () => {
    const ov = r.model?.overlay;
    for (const t of r.model?.tiles ?? []) expect(ov?.terrain[t.id], t.id).toBeDefined();
    expect(ov?.terrain['town-street']).toMatchObject({ crisp: true });
    expect(ov?.terrain.water).toMatchObject({ water: true });
    for (const w of r.model?.world ?? []) expect(ov?.prototypes.world[w.id]?.map_color, w.id).toMatch(/^#/);
    expect(ov?.prototypes.resources['iron-ore-patch']?.map_color).toBe('#6a8694');
    expect(ov?.defaults.belt_lanes).toMatchObject({ straight: 256, curve_inner: 106, curve_outer: 295 });
  });

  it("emits what the slice reads (D1-r1): Seminars that never compute, flipping assemblers, 2.0's water and steam", () => {
    const bin = r.outputs.get('public/data/prototypes.bin');
    if (!bin) throw new Error('no prototypes.bin');
    const p = readPrototypesBin(bin);
    const entity = (name: string) => p.entity[p.names.entity.indexOf(name)];
    const fluid = (name: string) => p.fluid[p.names.fluid.indexOf(name)];
    // No Researcher in the slice (09 §9): the Seminar's accelerator class never holds, so it never throttles (S-G9).
    expect(entity('seminar')).toMatchObject({ computing: false, t_star: 0 });
    // Assembling machine 2's ports lie on its axis, so it flips (FFF-394; I §3.3; m1's flip_entity).
    expect(entity('assembling-machine-2')?.flippable).toBe(true);
    expect(entity('assembling-machine-1')?.flippable).toBe(false);
    // factorio-data 2.0.77 fluid.lua: water 2 kJ/K up to 100 °C, steam 0.2 kJ/K up to 5,000 °C (J/K in the bin).
    expect(fluid('water')).toMatchObject({
      default_temperature: 15,
      max_temperature: 100,
      heat_capacity: 2000,
    });
    expect(fluid('steam')).toMatchObject({
      default_temperature: 15,
      max_temperature: 5000,
      heat_capacity: 200,
    });
  });

  it('carries the set-name tables the slice draws (D1-r1; 10 §9.9, §15.7)', () => {
    const json = r.outputs.get('public/data/prototypes.json');
    if (!json) throw new Error('no prototypes.json');
    const p = JSON.parse(new TextDecoder().decode(json)) as PrototypesJson;
    expect(p.treeSpecies).toHaveLength(10);
    expect(p.treeSpecies).toContain('object/tree-oak');
    expect(p.decoratives).toHaveLength(15);
    expect(p.decoratives).toContain('decor/green-hairy-grass');
    // skins 1 and 2, 8 block pictures each, flat and skin by skin
    expect(p.townBuildings).toHaveLength(16);
    expect([p.townBuildings[0], p.townBuildings[7], p.townBuildings[8]]).toEqual([
      'town/skin-1-block-1',
      'town/skin-1-block-8',
      'town/skin-2-block-1',
    ]);
    const sets = r.model?.overlay.sets;
    expect(sets?.tree_biomes.temperate).toEqual(['tree-willow', 'tree-beech', 'tree-oak']);
    expect(Object.keys(sets?.decorative_biomes ?? {})).toEqual(r.model?.design.meta.world.biomes.order);
  });

  it('leaves the tables empty in a build without trees or towns (M0)', () => {
    const m0 = runDataStage(options());
    const json = m0.outputs.get('public/data/prototypes.json');
    if (!json) throw new Error(m0.diagnostics.list.map(formatDiagnostic).join('\n'));
    const p = JSON.parse(new TextDecoder().decode(json)) as PrototypesJson;
    expect([p.treeSpecies, p.decoratives, p.cliffs, p.townBuildings]).toEqual([[], [], [], []]);
  }, 60_000);
});

describe('the derivations', () => {
  it("gives a drill's mining area as Factorio counts it", () => {
    expect(miningArea([2, 2], 0.99)).toEqual([2, 2]);
    expect(miningArea([3, 3], 2.49)).toEqual([5, 5]);
    expect(miningArea([2, 2], 1.49)).toEqual([2, 2]);
    expect(miningArea([2, 2], 1.5)).toEqual([4, 4]);
  });

  it("finds the lines a building's fluid connections are symmetric about (FFF-394)", () => {
    const box = (
      production: 'input' | 'output',
      ...cs: [number, number, 'north' | 'east' | 'south' | 'west'][]
    ) => ({
      volume: 100,
      production,
      connections: cs.map(([x, y, direction]) => ({
        position: [x, y] as [number, number],
        direction,
        flow: production,
      })),
    });
    const e = (w: number, h: number) => ({ size: [w, h] }) as Parameters<typeof fluidSymmetries>[0];
    // assembling machine 2: input north, output south, both on the vertical axis
    expect(
      fluidSymmetries(e(3, 3), [box('input', [0, -1, 'north']), box('output', [0, 1, 'south'])]),
    ).toEqual(['vertical']);
    // the storage tank (entities.lua 2.0.77): north and west at the north-west tile, east and south at the
    // south-east one; symmetric about both diagonals, not the axes (it flips by its diagonal, FFF-394)
    const tank = {
      volume: 25000,
      production: 'none' as const,
      connections: (
        [
          [-1, -1, 'north'],
          [1, 1, 'east'],
          [1, 1, 'south'],
          [-1, -1, 'west'],
        ] as const
      ).map(([x, y, direction]) => ({
        position: [x, y] as [number, number],
        direction,
        flow: 'input-output' as const,
      })),
    };
    expect(fluidSymmetries(e(3, 3), [tank])).toEqual(['diagonal', 'antidiagonal']);
    // an input north and an output east: no line maps the building onto itself
    expect(fluidSymmetries(e(3, 3), [box('input', [0, -1, 'north']), box('output', [1, 0, 'east'])])).toEqual(
      [],
    );
  });

  it('refuses a manifest whose build holds a Seminar and a Researcher but does not read heat.while', () => {
    const diags = new Diagnostics();
    const src = parseYaml('caps.yaml', 'manifests:\n  mx:\n    reads: []\n', diags);
    if (!src) throw new Error('caps.yaml');
    const seminar = { id: 'seminar', heat: { class: 'accelerator', while: 'researcher' } };
    const ix = indexDesign({
      items: [],
      recipes: [],
      entities: [seminar],
      technologies: [],
      resources: [],
      tiles: [],
      world: [],
      enemies: [],
    } as unknown as Parameters<typeof indexDesign>[0]);
    const cap = { name: 'mx', reads: [] as string[] } as CapabilityManifest;
    const build = { entities: new Set(['seminar']), items: new Set(['seminar']) };
    checkConditionalHeat(cap, build as never, ix, src, diags);
    expect(diags.errors).toEqual([]); // no Researcher: the data stage resolves the Seminar as not computing
    build.items.add('researcher');
    checkConditionalHeat(cap, build as never, ix, src, diags);
    expect(diags.errors.map(formatDiagnostic).join('\n')).toMatch(
      /mx's build holds seminar, which computes only while a researcher is installed, .*: mx must read entities\.heat\.while/,
    );
    const reads = new Diagnostics();
    checkConditionalHeat({ ...cap, reads: ['entities.heat.while'] }, build as never, ix, src, reads);
    expect(reads.errors).toEqual([]);
  });
});

describe('the engine checks refuse gaps and disagreements', () => {
  it('an inserter without a drop vector', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(game, 'data/engine/mirrors.yaml'),
      'inserter: {pickup: [0, -1], drop: [0, 1.2], rotation_speed: 0.014,',
      'inserter: {pickup: [0, -1], rotation_speed: 0.014,',
    );
    expect(messages(runDataStage(m1(game, spec))).join('\n')).toMatch(/inserter inserter lacks drop/);
  });

  it("an electric inserter whose kw is not its swing's maximum power", () => {
    const { game, spec } = scratchRepo();
    edit(join(spec, 'data/entities.yaml'), 'kw: 14.7, drain_kw: 0.4', 'kw: 13.2, drain_kw: 0.4');
    expect(messages(runDataStage(m1(game, spec))).join('\n')).toMatch(
      /entities\.yaml:\d+:\d+: entities\[\d+\] \(inserter\)\.energy\.kw: inserter inserter: energy\.kw 13\.2 is not .* = 14\.7 kW/,
    );
  });

  it('a fluid connection that does not face out of the footprint', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(game, 'data/engine/mirrors.yaml'),
      '{position: [0, -0.5], direction: north, flow: output}',
      '{position: [0, -0.5], direction: south, flow: output}',
    );
    expect(messages(runDataStage(m1(game, spec))).join('\n')).toMatch(
      /boiler: fluid box 1's south connection at \(0, -0.5\) is not on the footprint's edge facing out/,
    );
  });

  it('a tile without a terrain material, in the M0 build', () => {
    const { game, spec } = scratchRepo();
    edit(join(game, 'data/engine/terrain.yaml'), '  sand: {material: sand}\n', '');
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /tile sand has no terrain material/,
    );
  });

  it('a block on an entity type that takes none', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(game, 'data/engine/prototypes.yaml'),
      'entities:\n',
      'entities:\n  iron-chest: {inserter: {rotation_speed: 0.1}}\n',
    );
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /gives entity iron-chest \(a chest\) a inserter block, which it does not take/,
    );
  });

  it('a working machine of the slice without a working sound', () => {
    const { game, spec } = scratchRepo();
    edit(join(game, 'data/engine/sounds.yaml'), '    steam-engine: steam-engine-loop\n', '');
    expect(messages(runDataStage(m1(game, spec))).join('\n')).toMatch(
      /working machine steam-engine has no working sound/,
    );
  });

  it('a planned map that names no sound', () => {
    const { game, spec } = scratchRepo();
    edit(join(game, 'data/engine/sounds.yaml'), '    radar: radar-loop\n', '    radar: radar-hum\n');
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /planned working_sounds radar names radar-hum, which is neither a sound nor a planned one/,
    );
  });

  it('an assembler whose fluid ports are symmetric but that does not flip (D1-r1)', () => {
    const { game, spec } = scratchRepo();
    edit(join(game, 'data/engine/mirrors.yaml'), '    flippable: true\n', '');
    expect(messages(runDataStage(m1(game, spec))).join('\n')).toMatch(
      /assembler assembling-machine-2's fluid connections are symmetric \(vertical\), so it flips in Factorio 2\.0/,
    );
  });

  it('a flipping entity whose fluid ports have no line of symmetry', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(game, 'data/engine/mirrors.yaml'),
      '{position: [0, 1], direction: south, flow: output}',
      '{position: [1, 0], direction: east, flow: output}',
    );
    expect(messages(runDataStage(m1(game, spec))).join('\n')).toMatch(
      /entity assembling-machine-2 is flippable, but its fluid connections have no line of symmetry/,
    );
  });

  it('set tables that disagree with the biomes or with themselves (D1-r1)', () => {
    const { game, spec } = scratchRepo();
    const sets = join(game, 'data/engine/sets.yaml');
    edit(sets, '  desert: [tree-mesquite]', '  desert: [tree-oak]');
    edit(sets, '  steppe: [brown-hairy-grass', '  savanna: [brown-hairy-grass');
    edit(sets, ', skin-2-block-8]', ']');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(/tree_biomes puts tree-oak in both temperate and desert/);
    expect(out).toMatch(/tree_species entry tree-mesquite is in no biome of tree_biomes/);
    expect(out).toMatch(/decorative_biomes names savanna, which is no biome of meta\.world\.biomes\.order/);
    expect(out).toMatch(/decorative_biomes lacks the biome steppe/);
    expect(out).toMatch(/town_buildings skin 2 has 7 pictures and skin 1 8/);
  });

  it('an overlay key that names no prototype or mirrors id', () => {
    const { game, spec } = scratchRepo();
    edit(join(game, 'data/engine/prototypes.yaml'), '  tokenizer: {', '  tokeniser: {');
    edit(join(game, 'data/engine/mirrors.yaml'), '  radar: {collision_box', '  radr: {collision_box');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(/prototypes\.yaml:\d+:\d+: entities\.tokeniser: no entity named tokeniser/);
    expect(out).toMatch(/mirrors\.yaml:\d+:\d+: entities\.radr: no entity mirrors radr/);
  });
});

describe('trimmed collision', () => {
  it('keeps a box already inside the footprint inset by 0.25', () => {
    const e = { type: 'inserter', size: [1, 1] } as unknown as Parameters<typeof trimmedBox>[0];
    expect(trimmedBox(e, [-0.15, -0.15, 0.15, 0.15])).toEqual([-0.15, -0.15, 0.15, 0.15]);
  });
});
