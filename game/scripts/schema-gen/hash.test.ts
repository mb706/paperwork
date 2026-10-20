// SCHEMA_HASH (10 §15.1 "Drift is caught four ways", 3; B1-r1 finding 3): every change to a wire or save
// layout changes the hash, and a change to documentation, comments or YAML style does not. Each case
// edits the real schema's text in memory, rebuilds the model and compares hashes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME } from '../../test/helpers/paths.ts';
import { loadCapabilities } from './capabilities.ts';
import { listing, schemaHash } from './listing.ts';
import { schemaFromTexts } from './load.ts';
import { buildSchema, SCHEMA_FILES, type SchemaFile } from './model.ts';
import { emitTsFiles } from './ts-modules.ts';
import { parseSource, type Source } from './yaml.ts';

const BASE = Object.fromEntries(
  SCHEMA_FILES.map((f) => [f, readFileSync(join(GAME, 'schema', `${f}.yaml`), 'utf8')]),
) as Record<SchemaFile, string>;

type Edit = [file: SchemaFile, from: string, to: string];

const memo = new Map<readonly Edit[], string>();
const parsed = new Map<string, Source>();

function hashWith(edits: readonly Edit[]): string {
  const known = memo.get(edits);
  if (known) return known;
  const texts = { ...BASE };
  for (const [file, from, to] of edits) {
    const n = texts[file].split(from).length - 1;
    if (n !== 1) throw new Error(`${file}.yaml: expected one \`${from}\`, found ${n}: update this test`);
    texts[file] = texts[file].replace(from, to);
  }
  // Only the edited files are parsed again (parsing is most of a build; buildSchema leaves sources alone).
  const sources = new Map<SchemaFile, Source>();
  for (const f of SCHEMA_FILES) {
    const key = `${f}\0${texts[f]}`;
    const src = parsed.get(key) ?? parseSource(`schema/${f}.yaml`, texts[f]);
    parsed.set(key, src);
    sources.set(f, src);
  }
  const h = schemaHash(buildSchema(sources));
  memo.set(edits, h);
  return h;
}

const base = schemaHash(schemaFromTexts(BASE));

// One case per kind of layout fact the listing must carry.
const LAYOUT: [string, Edit[]][] = [
  ['an id’s width', [['types', '- TileId: {base: u8, none: 0xFF,', '- TileId: {base: u16, none: 0xFF,']]],
  [
    'an id’s none value',
    [['types', '- ItemKey: {base: u16, none: 0xFFFF,', '- ItemKey: {base: u16, none: 0xFFFE,']],
  ],
  ['an enum value', [['types', '- north_north_east: 1\n', '- north_north_east: 17\n']]],
  ['a new enum value', [['types', '- north_north_west: 15\n', '- north_north_west: 15\n        - up: 16\n']]],
  ['a flag bit', [['types', '- indestructible: 4\n', '- indestructible: 5\n']]],
  ['a struct check', [['types', '      check: entity_ref\n', '']]],
  ['the schema version', [['types', 'schema_version: 1\n', 'schema_version: 2\n']]],
  [
    'a struct field’s width',
    [['actions', '- count: {type: u16, doc: "1–65,535"}', '- count: {type: u32, doc: "1–65,535"}']],
  ],
  [
    'struct field order',
    [
      ['actions', '        - tick: {type: Tick, doc: "the tick this closure belongs to"}\n', ''],
      [
        'actions',
        '        - count: {type: u16, doc: "1–65,535"}\n',
        '        - count: {type: u16, doc: "1–65,535"}\n        - tick: {type: Tick, doc: "the tick this closure belongs to"}\n',
      ],
    ],
  ],
  ['an action id', [['actions', '- rotate_entity: {id: 21,', '- rotate_entity: {id: 29,']]],
  [
    'allowed values',
    [['actions', 'allowed: [0, 2, 4, 6, 8, 10, 12, 14]', 'allowed: [0, 2, 4, 6, 8, 10, 12]']],
  ],
  ['a held action', [['actions', '- stop_walking: {id: 2, held: true}', '- stop_walking: {id: 2}']]],
  [
    'the action version',
    [['actions', 'version: 1          # ACTION_SCHEMA_VERSION', 'version: 2          #']],
  ],
  ['an action limit', [['actions', 'closure_max: 1048576', 'closure_max: 1048577']]],
  ['an event id', [['events', '  - flying_text:\n      id: 2\n', '  - flying_text:\n      id: 15\n']]],
  ['an event field', [['events', '        - total: i32\n', '']]],
  [
    'message padding',
    [
      [
        'packet',
        '      pad_to: 4\n      fields:\n        - line_id: u32',
        '      pad_to: 8\n      fields:\n        - line_id: u32',
      ],
    ],
  ],
  ['a counted array’s count', [['packet', 'gaps: "i16[count-1]"', 'gaps: "i16[count]"']]],
  ['a packet section id', [['packet', '- DYN: {id: 3,', '- DYN: {id: 18,']]],
  ['a packet section kind', [['packet', '- DYN: {id: 3, kind: snapshot,', '- DYN: {id: 3, kind: delta,']]],
  ['the packet magic', [['packet', 'magic: 0x4B505750', 'magic: 0x4B505751']]],
  ['the packet version', [['packet', 'version: 1             # PACKET_VERSION', 'version: 2             #']]],
  ['a range', [['packet', 'band: {type: u8, range: [0, 7]', 'band: {type: u8, range: [0, 6]']]],
  [
    'a list max',
    [
      [
        'projections',
        '- alerts: {type: "list<AlertCount>", max: 64}',
        '- alerts: {type: "list<AlertCount>", max: 65}',
      ],
    ],
  ],
  [
    'a list’s item type',
    [['projections', '- phase_us: {type: "list<f32>", max: 16,', '- phase_us: {type: "list<f64>", max: 16,']],
  ],
  [
    'a length width',
    [['projections', '- tail: {type: bytes, max: 4096,', '- tail: {type: bytes, max: 4096, len: u32,']],
  ],
  ['an optional field', [['projections', ', when: flags.tail', '']]],
  ['a record field id', [['abi', '- height: {id: 2, type: u32,', '- height: {id: 16, type: u32,']]],
  [
    'a record default',
    [
      [
        'abi',
        '- starting_area: {id: 3, type: f64, default: 1}',
        '- starting_area: {id: 3, type: f64, default: 2}',
      ],
    ],
  ],
  ['a section id', [['sections', '- STATS: {id: 13,', '- STATS: {id: 18,']]],
  [
    'a section key',
    [['sections', 'key: [commit_tick, surface, cy, cx]', 'key: [commit_tick, surface, cx, cy]']],
  ],
  ['a section’s shard', [['sections', 'header_shard: 3001', 'header_shard: 3003']]],
  [
    'a section’s hashing',
    [['sections', 'record: globals, hashed: true,', 'record: globals, hashed: false,']],
  ],
  [
    'the save format',
    [['sections', '  format_version: 2\n  header_align: 8', '  format_version: 3\n  header_align: 8']],
  ],
  ['the closure-log magic', [['sections', 'magic: 0x4C435750', 'magic: 0x4C435751']]],
  ['a kept column', [['state', 'wraps: true, keep: true,', 'wraps: true,']]],
  [
    'a saved column',
    [
      [
        'state',
        '- built_tick: {type: Tick, saved: true, view: true}',
        '- built_tick: {type: Tick, saved: false, presentation: true, view: true}',
      ],
    ],
  ],
  ['a proto column', [['protos', '- stack_size: {type: u32,', '- stack_size: {type: u16,']]],
  ['the prototypes format', [['protos', 'format_version: 1       #', 'format_version: 2       #']]],
  ['a registry id', [['registries', '- artillery-range: 19', '- artillery-range: 45']]],
  ['a table row limit', [['state', 'max_rows: 4194304     # 2^22', 'max_rows: 4194303     # 2^22']]],
  [
    'a save-header limit',
    [['sections', 'roster: "RosterEntry[32] ascending index"', 'roster: "RosterEntry[31] ascending index"']],
  ],
  ['a save-header string length', [['sections', 'name: "string(1..64)"', 'name: "string(1..63)"']]],
  ['an enum locale prefix', [['types', '      locale: alert\n', '      locale: alerts\n']]],
];

// Documentation and style: the listing leaves them out.
const COSMETIC: [string, Edit[]][] = [
  [
    'a doc string',
    [['types', 'never reused; every reference across the boundary. 0 = none', 'never reused. 0 = none']],
  ],
  ['a comment', [['types', '# Raised with every change', '# Raised by every change']]],
  ['a new doc', [['actions', '        - len: u16\n', '        - len: {type: u16, doc: "payload bytes"}\n']]],
  [
    'flow style to block style',
    [
      [
        'actions',
        '  - rotate_entity: {id: 21, fields: [{target: EntityRef}, {reverse: bool}]}\n',
        '  - rotate_entity:\n      id: 21\n      fields:\n        - target: EntityRef\n        - reverse: {type: bool}\n',
      ],
    ],
  ],
];

describe('SCHEMA_HASH', () => {
  it('tells a float default of 0 from one of −0 (C1b-r1 finding 7)', () => {
    const at = '- starting_area: {id: 3, type: f64, default: 1}';
    const zero = hashWith([['abi', at, '- starting_area: {id: 3, type: f64, default: 0.0}']]);
    const negative = hashWith([['abi', at, '- starting_area: {id: 3, type: f64, default: -0.0}']]);
    expect(zero).not.toBe(negative);
    // …and the TypeScript defaults keep −0, as Rust's from_bits does.
    const texts = {
      ...BASE,
      abi: BASE.abi.replace(at, '- starting_area: {id: 3, type: f64, default: -0.0}'),
    };
    const s = schemaFromTexts(texts);
    const abi = emitTsFiles(
      s,
      loadCapabilities(join(GAME, 'data', 'engine', 'capabilities.yaml')),
      'x',
      '',
    ).find((f) => f.path === 'src/shared/gen/abi.ts');
    expect(abi?.text).toContain('starting_area: -0,');
  });

  it('is the SHA-256 of the committed listing', () => {
    expect(readFileSync(join(GAME, 'src', 'shared', 'gen', 'layout.txt'), 'utf8')).toContain(
      listing(schemaFromTexts(BASE)),
    );
  });

  it.each(LAYOUT)('changes with %s', (_name, edits) => {
    expect(hashWith(edits)).not.toBe(base);
  });

  it('tells every layout change apart', () => {
    const hashes = LAYOUT.map(([, e]) => hashWith(e));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it.each(COSMETIC)('ignores %s', (_name, edits) => {
    expect(hashWith(edits)).toBe(base);
  });
});
