// The generator is a pure function of its inputs (D14; C1b quality bar): two generations from separately
// loaded schemas give the same bytes (rustfmt aside, which `schema-gen --check` covers against the
// committed files), and the generated outputs agree with the committed ones on the handshake constants.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import { GAME } from '../../test/helpers/paths.ts';
import { loadCapabilities } from './capabilities.ts';
import { codecFixtures } from './fixtures.ts';
import { listing, schemaHash } from './listing.ts';
import { loadSchema } from './load.ts';
import { emitRustFiles } from './rust-modules.ts';
import { emitTsFiles } from './ts-modules.ts';

function generateOnce(): Map<string, string | Uint8Array> {
  const s = loadSchema(join(GAME, 'schema'));
  const caps = loadCapabilities(join(GAME, 'data', 'engine', 'capabilities.yaml'));
  const hash = schemaHash(s);
  const out = new Map<string, string | Uint8Array>();
  for (const f of emitRustFiles(s, caps, hash)) out.set(f.path, f.text);
  for (const f of emitTsFiles(s, caps, hash, listing(s))) out.set(f.path, f.text);
  const fx = codecFixtures(s);
  out.set('actions.bin', fx.actions);
  out.set('records.bin', fx.records);
  out.set('probes.txt', fx.probes);
  return out;
}

describe('schema-gen', () => {
  it('generates the same bytes twice', () => {
    const a = generateOnce();
    const b = generateOnce();
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [k, v] of a) expect(b.get(k), k).toEqual(v);
  });

  it('agrees with the committed SCHEMA_HASH', () => {
    const s = loadSchema(join(GAME, 'schema'));
    expect(schemaHash(s)).toBe(SCHEMA_HASH);
    const rs = readFileSync(join(GAME, 'crates', 'schema', 'src', 'lib.rs'), 'utf8');
    expect(rs).toContain(`pub const SCHEMA_HASH_HEX: &str = "${SCHEMA_HASH}";`);
  });
});
