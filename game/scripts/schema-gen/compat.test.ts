// The compatibility ledger (C1b-r1 finding 8; 10 §15.1 "Versions"): a layout change needs its version
// bumped, versions never go down, a save section that changes takes the new schema_version, and an id is
// never reused for another name. Each case edits the real schema in memory and checks it against the real
// ledger (game/schema/compat.yaml).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME } from '../../test/helpers/paths.ts';
import { checkCompat, ledgerText, parseLedger } from './compat.ts';
import { schemaFromTexts } from './load.ts';
import { SCHEMA_FILES, type SchemaFile } from './model.ts';

const BASE = Object.fromEntries(
  SCHEMA_FILES.map((f) => [f, readFileSync(join(GAME, 'schema', `${f}.yaml`), 'utf8')]),
) as Record<SchemaFile, string>;
const LEDGER_TEXT = readFileSync(join(GAME, 'schema', 'compat.yaml'), 'utf8');
const LEDGER = parseLedger(LEDGER_TEXT);

type Edit = [file: SchemaFile, from: string, to: string];

function problems(edits: readonly Edit[], ledger = LEDGER): string[] {
  const texts = { ...BASE };
  for (const [file, from, to] of edits) {
    if (!texts[file].includes(from)) throw new Error(`${file}.yaml has no \`${from}\`: update this test`);
    texts[file] = texts[file].replace(from, to);
  }
  return checkCompat(schemaFromTexts(texts), ledger).problems;
}

const REVERSE_U16: Edit = ['actions', '{reverse: bool}', '{reverse: u16}'];
const ACTION_V2: Edit = ['actions', 'version: 1          # ACTION_SCHEMA_VERSION', 'version: 2          #'];

describe('the compatibility ledger', () => {
  it('holds the committed schema as it is', () => {
    const r = checkCompat(schemaFromTexts(BASE), LEDGER);
    expect(r.problems).toEqual([]);
    expect(ledgerText(r.next)).toBe(LEDGER_TEXT);
  });

  it('refuses a layout change without a version bump', () => {
    expect(problems([REVERSE_U16])).toEqual([
      'the action layout changed, but actions.yaml version (ACTION_SCHEMA_VERSION) is still 1: raise it',
    ]);
  });

  it('accepts it with the bump, and records the new version', () => {
    const texts = {
      ...BASE,
      actions: BASE.actions.replace(REVERSE_U16[1], REVERSE_U16[2]).replace(ACTION_V2[1], ACTION_V2[2]),
    };
    const r = checkCompat(schemaFromTexts(texts), LEDGER);
    expect(r.problems).toEqual([]);
    expect(Object.keys(r.next.versions.action ?? {})).toEqual(['1', '2']);
    // …after which going back to version 1 is refused.
    expect(problems([], r.next)).toContain(
      'actions.yaml version (ACTION_SCHEMA_VERSION) is 1, below 2: versions never go down',
    );
  });

  it('refuses a reused id, also for a renamed or removed entry', () => {
    expect(problems([['actions', '- rotate_entity: {id: 21,', '- turn_entity: {id: 21,']])).toContain(
      'action: id 21 was rotate_entity, now turn_entity: ids are never reused (a deliberate rename is recorded by renaming it in schema/compat.yaml)',
    );
    expect(problems([['types', '- north_north_east: 1\n', '- nne: 1\n']])).toContain(
      'enum:Direction: id 1 was north_north_east, now nne: ids are never reused (a deliberate rename is recorded by renaming it in schema/compat.yaml)',
    );
    expect(
      problems([['abi', '- height: {id: 2, type: u32,', '- tall: {id: 2, type: u32,']]).join('\n'),
    ).toMatch(/fields:map_settings: id 2 was height, now tall/);
  });

  it('requires a changed save section to take the new schema_version', () => {
    const field: Edit = [
      'state',
      '- online: {id: 2, type: bool, saved: true}',
      '- online: {id: 2, type: u8, saved: true}',
    ];
    expect(problems([field])).toEqual([
      'the schema layout changed, but types.yaml schema_version (every save section) is still 1: raise it',
      'save section PLAYERS changed, but its version is still 1: set it to the new schema_version (raise types.yaml schema_version)',
    ]);
    const schema2: Edit = ['types', 'schema_version: 1\n', 'schema_version: 2\n'];
    expect(problems([field, schema2])).toEqual([
      'save section PLAYERS changed, but its version is still 1: set it to the new schema_version (raise types.yaml schema_version)',
    ]);
    const players2: Edit = ['sections', '- PLAYERS: {id: 11, version: 1,', '- PLAYERS: {id: 11, version: 2,'];
    expect(problems([field, schema2, players2])).toEqual([]);
    expect(problems([players2])).toContain('save section PLAYERS has version 2, above schema_version 1');
  });

  it('ignores documentation', () => {
    expect(problems([['actions', '# Actions, batches and closures', '# Actions and closures']])).toEqual([]);
  });
});
