// The save container's header (10 §8.1; sections.yaml save_header; C1b-r1 finding 6): its nested formats are
// declared in the schema, so the generated validator refuses wrong element types, unknown or missing keys,
// out-of-range values, bad colours, unsorted rosters and duplicate names, and the container round-trips.
import { describe, expect, it } from 'vitest';
import { MapSettingsCodec, WorldSettingsCodec } from '../../src/shared/gen/abi.ts';
import {
  readSaveContainer,
  type SaveHeader,
  validateSaveHeader,
  writeSaveContainer,
} from '../../src/shared/gen/container.ts';

/** A record's JSON form: its fields in camelCase (sections.yaml `record:`). */
function jsonForm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonForm);
  if (typeof v === 'bigint') return Number(v);
  if (v !== null && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase()),
        jsonForm(x),
      ]),
    );
  return v;
}

const HEADER = (): SaveHeader => ({
  formatVersion: 2,
  gameVersion: '0.0.0-m0',
  buildHash: 'a'.repeat(64),
  protocolVersion: 1,
  schemaHash: 'b'.repeat(64),
  prototypesHash: 'c'.repeat(64),
  tick: 3600,
  seed: 12345,
  mapSettings: jsonForm(MapSettingsCodec.defaults()) as SaveHeader['mapSettings'],
  worldSettings: jsonForm(WorldSettingsCodec.defaults()) as SaveHeader['worldSettings'],
  playTimeTicks: 3600,
  savedAt: '2026-10-20T15:04:05Z',
  thumbnailSection: 0,
  nameTables: {
    item: ['iron-chest', 'iron-ore', 'iron-plate'],
    fluid: [],
    recipe: ['iron-chest'],
    entity: ['iron-chest', 'character'],
    technology: [],
    resource: ['iron-ore-patch'],
    tile: ['deep-water', 'dirt', 'grass', 'out-of-map', 'sand', 'water'],
    world_object: [],
    signal: [],
  },
  roster: [
    { index: 0, name: 'Ada', color: '#ff8800' },
    { index: 3, name: 'Grace', color: '#0066cc' },
  ],
  lineage: '0123456789abcdef',
});

/** The header with one change at a path, as untyped JSON. */
function edited(path: (string | number)[], value: unknown): unknown {
  const h = JSON.parse(JSON.stringify(HEADER())) as Record<string, unknown>;
  let o: Record<string | number, unknown> = h;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  if (value === undefined) delete o[last];
  else o[last] = value;
  return h;
}

describe('the save header schema', () => {
  it('accepts a complete header and round-trips the container', () => {
    expect(validateSaveHeader(HEADER())).toEqual(HEADER());
    const bytes = writeSaveContainer(HEADER(), []);
    expect(bytes.length % 8).toBe(0);
    expect(readSaveContainer(bytes).header).toEqual(HEADER());
  });

  it.each([
    ['a name table of the wrong type', ['nameTables', 'item'], 42, '$.nameTables.item is not an array'],
    [
      'a name that is not a string',
      ['nameTables', 'item', 0],
      7,
      'nameTables.item[0] is not a string of 1 to 255',
    ],
    ['a duplicate name', ['nameTables', 'recipe'], ['a', 'a'], 'nameTables.recipe is not without duplicates'],
    ['a missing prototype kind', ['nameTables', 'signal'], undefined, 'nameTables.signal is not present'],
    ['an unknown key', ['nameTables', 'enemy'], [], 'nameTables.enemy is not a known key'],
    ['a null roster entry', ['roster', 0], null, '$.roster[0] is not an object'],
    ['a player index out of range', ['roster', 1, 'index'], 32, 'roster[1].index is not an integer, 0 to 31'],
    ['an unsorted roster', ['roster', 1, 'index'], 0, '$.roster is not strictly ascending by index'],
    ['a bad colour', ['roster', 0, 'color'], 'orange', 'roster[0].color is not a colour #rrggbb'],
    ['an empty player name', ['roster', 0, 'name'], '', 'roster[0].name is not a string of 1 to 64'],
    [
      'a settings field missing',
      ['mapSettings', 'startingArea'],
      undefined,
      'mapSettings.startingArea is not present',
    ],
    [
      'a settings value of the wrong type',
      ['worldSettings', 'heat'],
      1,
      'worldSettings.heat is not a boolean',
    ],
    [
      'an undeclared enum value',
      ['worldSettings', 'runaways'],
      99,
      'worldSettings.runaways is not an integer, one of',
    ],
    ['a lineage of the wrong length', ['lineage'], '0123', '$.lineage is not 16 lowercase hex digits'],
    ['a local save time', ['savedAt'], '2026-10-20 17:04', '$.savedAt is not a UTC time'],
    ['another container format', ['formatVersion'], 3, '$.formatVersion is not an integer, 2 to 2'],
  ])('refuses %s', (_what, path, value, message) => {
    expect(() => validateSaveHeader(edited(path, value))).toThrow(message);
  });
});
