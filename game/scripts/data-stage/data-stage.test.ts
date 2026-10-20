// The data stage end to end (10 §2.4, §15.2): determinism (D14), the binary format read back, M0's
// prototypes, and diagnostics that name the file, the path and the line. Error cases run on a scratch
// copy of the repository's data, so the real files are never touched.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { edit, messages, options, scratchRepo } from '../../test/helpers/data-stage.ts';
import { ByteReader } from '../lib/bytes.ts';
import { sha256Hex } from '../lib/hash.ts';
import { formatDiagnostic } from './diagnostics.ts';
import { readColumnTable, readSections } from './emit/container.ts';
import { DATA_VERSION, FORMAT_VERSION, HEADER_BYTES, MAGIC } from './emit/protos-bin.ts';
import { SECTION_IDS } from './emit/tables.ts';
import { type DataStageResult, OUTPUT_PATHS, runDataStage } from './index.ts';

describe('the data stage on the repository data', () => {
  let r: DataStageResult;
  beforeAll(() => {
    r = runDataStage(options());
  });

  it('has no errors or warnings', () => {
    expect(r.diagnostics.list.map(formatDiagnostic)).toEqual([]);
    expect([...r.outputs.keys()].sort()).toEqual(Object.values(OUTPUT_PATHS).sort());
  });

  it('gives byte-identical outputs on a second run (D14)', () => {
    const again = runDataStage(options());
    for (const [path, bytes] of r.outputs)
      expect(Buffer.compare(Buffer.from(bytes), Buffer.from(again.outputs.get(path) ?? [])), path).toBe(0);
  });

  it('checks every milestone filter (R17)', () => {
    expect(r.filters.map((f) => f.name)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    for (const f of r.filters) expect(f.problems, f.name).toEqual([]);
  });

  it('writes prototypes.bin in the layout of 10 §15.2', () => {
    const bin = r.outputs.get(OUTPUT_PATHS.bin) as Uint8Array;
    const rd = new ByteReader(bin);
    expect([...rd.take(8)]).toEqual([...MAGIC]);
    expect(rd.u32()).toBe(FORMAT_VERSION);
    expect([...rd.take(32)].every((b) => b === 0)).toBe(true);
    expect(rd.u32()).toBe(DATA_VERSION);
    const count = rd.u32();
    expect(rd.u32()).toBe(0);
    expect(rd.pos).toBe(HEADER_BYTES);
    const sections = readSections(rd, count);
    expect(rd.remaining).toBe(0);
    expect(sections.map((s) => s.id)).toEqual(Object.values(SECTION_IDS));
    for (const s of sections) expect(s.offset % 8).toBe(0);
    const byId = new Map(sections.map((s) => [s.id, s.data]));
    const table = (id: number) => {
      const t = readColumnTable(byId.get(id) as Uint8Array);
      return { rows: t.rows, col: (name: string) => t.columns.find((c) => c.name === name)?.values };
    };
    // NAMES: each kind's names in id order, in ProtoKind order.
    const names = new ByteReader(byId.get(SECTION_IDS.NAMES) as Uint8Array);
    const kinds: string[][] = [];
    for (let k = 0; k < 9; k++) kinds.push(Array.from({ length: names.u16() }, () => names.str16()));
    expect(names.remaining).toBe(0);
    const [items, fluids, recipes, entities, techs, resources, tiles, world, signals] = kinds;
    expect(items).toEqual(['iron-chest', 'iron-ore', 'iron-plate']);
    expect([fluids, techs, world, signals]).toEqual([[], [], [], []]);
    expect(recipes).toEqual(['iron-chest']);
    expect(entities).toEqual(['iron-chest']);
    expect(resources).toEqual(['iron-ore-patch']);
    expect(tiles).toEqual(['deep-water', 'dirt', 'grass', 'out-of-map', 'sand', 'water']);
    const item = table(SECTION_IDS.PROTO_ITEM);
    expect(item.rows).toBe(3);
    expect(item.col('stack_size')).toEqual([50, 50, 100]);
    expect(item.col('places_entity')).toEqual([0, 0xffff, 0xffff]);
    const ent = table(SECTION_IDS.PROTO_ENTITY);
    expect(ent.col('inventory_slots')).toEqual([32]);
    expect(ent.col('item')).toEqual([0]);
    expect(ent.col('collision_x0')).toEqual([-0.35]);
    expect(ent.col('selection_x1')).toEqual([0.5]);
    expect(ent.col('mining_time')).toEqual([0.2]);
    expect(ent.col('rotatable')).toEqual([false]);
    const rec = table(SECTION_IDS.PROTO_RECIPE);
    expect(rec.col('energy_required')).toEqual([0.5]);
    expect(rec.col('handcraft')).toEqual([true]);
    expect(rec.col('enabled_at_start')).toEqual([true]);
    // LISTS: the recipe's ingredient (8 iron plates) and product (1 iron chest).
    const lists = byId.get(SECTION_IDS.LISTS) as Uint8Array;
    const ing = new ByteReader(lists.subarray(rec.col('ingredients_off')?.[0] as number));
    expect([ing.u8(), ing.u8(), ing.u16(), ing.u32(), ing.f64()]).toEqual([0, 0, 2, 0, 8]);
    const prod = new ByteReader(lists.subarray(rec.col('products_off')?.[0] as number));
    expect([prod.u8(), prod.u8(), prod.u16(), prod.u32(), prod.f64(), prod.f64(), prod.f64()]).toEqual([
      0, 0, 0, 0xffffffff, 1, 1, 0,
    ]);
    // META: the start record holds the start inventory filtered to M0's items (8 iron plates).
    // u32 count; record: u16 type 1 (start), u32 length; field 1 (inventory): u16 id, u32 length, then the
    // list: u32 count, and per item u32 length and its triples (1: u16 item, 2: u32 count).
    const meta = new ByteReader(byId.get(SECTION_IDS.META) as Uint8Array);
    expect([meta.u32(), meta.u16(), meta.u32()]).toEqual([2, 1, 32]);
    expect([meta.u16(), meta.u32(), meta.u32(), meta.u32()]).toEqual([1, 26, 1, 18]);
    expect([meta.u16(), meta.u32(), meta.u16(), meta.u16(), meta.u32(), meta.u32()]).toEqual([
      1, 2, 2, 2, 4, 8,
    ]);
    expect(meta.u16()).toBe(2); // then the contents record (C1a-r1 finding 5)
  });

  it('records the prototypes hash and the M0 contents in prototypes.json and build-manifest.json', () => {
    const bin = r.outputs.get(OUTPUT_PATHS.bin) as Uint8Array;
    const manifest = JSON.parse(new TextDecoder().decode(r.outputs.get(OUTPUT_PATHS.manifest)));
    expect(manifest.prototypesHash).toBe(sha256Hex(bin));
    expect(manifest.dev).toBe(true);
    const json = JSON.parse(new TextDecoder().decode(r.outputs.get(OUTPUT_PATHS.json)));
    expect(json.prototypesHash).toBe(sha256Hex(bin));
    expect(json.build).toBe('m0');
    expect(json.entity[0].sprite).toBe('entity/iron-chest');
    expect(json.icons).toEqual(['item/iron-chest', 'item/iron-ore', 'item/iron-plate']);
    expect(json.strings['item-name.iron-plate']).toBe('Iron plate');
    expect(json.localeKeys).toEqual([]);
  });
});

describe('diagnostics point at the YAML file, path and line', () => {
  it('reports a wrongly typed field', () => {
    const { game, spec } = scratchRepo();
    edit(join(spec, 'data/entities.yaml'), 'extra: {slots: 32}', 'extra: {slots: many}');
    const out = messages(runDataStage(options(game, spec)));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(
      /^design\/spec\/data\/entities\.yaml:\d+:\d+: entities\[\d+\] \(iron-chest\)\.extra\.slots: .*expected number/,
    );
  });

  it('reports a misspelt field and an unknown reference', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(spec, 'data/recipes.yaml'),
      /- id: iron-chest\n {2}category: crafting/,
      '- id: iron-chest\n  categroy: crafting',
    );
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(/recipes\.yaml:\d+:\d+: recipes\[\d+\] \(iron-chest\): .*categroy/);
    const second = scratchRepo();
    edit(join(second.spec, 'data/items.yaml'), 'places: iron-chest', 'places: iron-chests');
    expect(messages(runDataStage(options(second.game, second.spec))).join('\n')).toMatch(
      /items\.yaml:\d+:\d+: items\[\d+\] \(iron-chest\)\.places: places unknown entity iron-chests/,
    );
  });

  it('reports a bad expression with its position', () => {
    const { game, spec } = scratchRepo();
    edit(join(spec, 'data/technologies.yaml'), 'count_formula: 2^L*1000', 'count_formula: 2^(L/2)*1000');
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(
      /technologies\.yaml:\d+:\d+: technologies\[\d+\] \(artillery-range\)\.count_formula: count_formula "2\^\(L\/2\)\*1000": '\^' needs an integer exponent \(at L = 1\)/,
    );
  });

  it('refuses an overlay that sets a design field', () => {
    const { game, spec } = scratchRepo();
    writeFileSync(
      join(game, 'data/engine/mirrors.yaml'),
      'entities:\n  iron-chest: {collision_box: [-0.35, -0.35, 0.35, 0.35], selection_box: [-0.5, -0.5, 0.5, 0.5], mining_time: 0.2, item: 1}\n',
    );
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /mirrors\.yaml:\d+:\d+: entities\.iron-chest: Unrecognized key: "item"/,
    );
  });

  it('refuses a capability manifest whose prototypes do not close', () => {
    const { game, spec } = scratchRepo();
    // Copper cable needs copper plates, which nothing in M0 makes.
    edit(
      join(game, 'data/engine/capabilities.yaml'),
      'recipes: [iron-chest]',
      'recipes: [iron-chest, copper-cable]',
    );
    const out = messages(runDataStage(options(game, spec))).join('\n');
    expect(out).toMatch(
      /capabilities\.yaml:\d+:\d+: manifests\.m0\.prototypes: item copper-plate is not obtainable in m0/,
    );
  });

  it('refuses manifests.yaml when it drifts from 10 §12', () => {
    const { game, spec } = scratchRepo();
    edit(
      join(game, 'data/engine/manifests.yaml'),
      'exclude_with_dependents: [scaling-laws]',
      'exclude_with_dependents: [scaling-laws, fusion-power]',
    );
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /manifests\.yaml: differs from the manifests block in 10 §12/,
    );
  });

  it('refuses a slice whose derived keys disagree with the data', () => {
    const { game, spec } = scratchRepo();
    edit(join(spec, '09-vertical-slice.md'), 'world_objects: [tree, ', 'world_objects: [');
    expect(messages(runDataStage(options(game, spec))).join('\n')).toMatch(
      /09-vertical-slice\.md \(§2\.7\):\d+:\d+: slice\.world_objects: the derived key world_objects disagrees with the data; missing: tree/,
    );
  });
});
