// The codec fixtures (10 §15.1 "Cross-language fixtures", D18 g), TypeScript side. `npm run gen` writes
// test/fixtures/codec/ with the reference codec (scripts/schema-gen/refcodec.ts); `cargo test` holds the
// generated Rust to the same files (crates/sim/tests/codec_fixtures/main.rs). Here the generated TypeScript must:
// - encode every sample's literal (src/shared/gen/samples.ts) to exactly the fixture's bytes, decode the
//   bytes back to the literal, and dump it to exactly the reference dump (whose hash the fixture carries);
// - give every limit probe of probes.txt exactly its verdict (error kind, field and byte offset);
// - decode each hand-written fixture of spec/*.hex to the dump written beside it, or refuse it as written.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSchema } from '../../scripts/schema-gen/load.ts';
import type { MessageDecl } from '../../scripts/schema-gen/model.ts';
import { refDump, refDumpAction } from '../../scripts/schema-gen/refcodec.ts';
import { samples } from '../../scripts/schema-gen/samples.ts';
import { type Action, actionBytes } from '../../src/shared/gen/actions.ts';
import { Dump } from '../../src/shared/gen/codec.ts';
import { CODECS, SAMPLES } from '../../src/shared/gen/samples.ts';
import {
  closureVerdict,
  decodeFramed,
  type Entry,
  fnv1a32,
  parseEntries,
  parseHexFile,
  parseProbes,
  refusalMatches,
  roundTrip,
  roundTripAction,
  verdictOf,
} from '../helpers/codec.ts';
import { GAME } from '../helpers/paths.ts';

const FIXTURES = join(GAME, 'test', 'fixtures', 'codec');
const read = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

describe('codec fixtures (generated round trips)', () => {
  const actions = parseEntries(read('actions.bin'));
  const entries = new Map<string, Entry & { action: boolean }>();
  for (const e of actions) entries.set(`${e.name}/${e.variant}`, { ...e, action: true });
  for (const e of parseEntries(read('records.bin')))
    entries.set(`${e.name}/${e.variant}`, { ...e, action: false });

  it('has an entry for every sample and a sample for every entry', () => {
    const keys = new Set(SAMPLES.map((s) => `${s.name}/${s.variant}`));
    expect([...entries.keys()].filter((k) => !keys.has(k))).toEqual([]);
    expect([...keys].filter((k) => !entries.has(k))).toEqual([]);
    expect(SAMPLES.length).toBeGreaterThan(400);
  });

  it('encodes every sample to the fixture bytes and decodes them back', () => {
    const failures: string[] = [];
    for (const s of SAMPLES) {
      const bytes = (entries.get(`${s.name}/${s.variant}`) as Entry).bytes;
      try {
        if (s.kind === 'action') {
          const a = s.value as Action;
          expect(actionBytes(a)).toEqual(bytes);
          expect(decodeFramed(bytes)).toEqual(a);
        } else {
          const c = CODECS[s.name];
          if (!c) throw new Error('no codec');
          expect(c.encode(s.value)).toEqual(bytes);
          expect(c.decode(bytes)).toEqual(s.value);
        }
      } catch (e) {
        failures.push(`${s.name} (${s.variant}): ${(e as Error).message.split('\n')[0]}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('dumps every decoded sample to the reference dump', () => {
    const schema = loadSchema(join(GAME, 'schema'));
    const failures: string[] = [];
    for (const smp of samples(schema)) {
      const e = entries.get(`${smp.decl.name}/${smp.variant}`) as Entry & { action: boolean };
      const action = schema.actions.find((a) => a.msg === smp.decl);
      const want = action
        ? refDumpAction(action.name, smp.decl as MessageDecl, smp.value)
        : refDump(smp.decl, smp.value);
      if (fnv1a32(want) !== e.dumpHash)
        failures.push(`${e.name} (${e.variant}): the fixture's dump hash is stale`);
      const got = e.action ? roundTripAction(e.bytes) : roundTrip(e.name, e.bytes);
      if (got !== want) {
        const gl = got.split('\n');
        const wl = want.split('\n');
        const i = gl.findIndex((l, k) => l !== wl[k]);
        failures.push(`${e.name} (${e.variant}): line ${i + 1}: got \`${gl[i]}\`, want \`${wl[i]}\``);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('codec probes (every limit, and a refusal just past it)', () => {
  const probes = parseProbes(readFileSync(join(FIXTURES, 'probes.txt'), 'utf8'));

  it('has probes of every kind of refusal', () => {
    expect(probes.length).toBeGreaterThan(1000);
    const kinds = new Set(probes.map((p) => p.verdict.split(' ')[0]));
    const want = ['ok', 'truncated', 'trailing', 'bad_enum', 'bad_flags', 'bad_bool', 'reserved', 'range'];
    want.push('too_long', 'bad_utf8', 'bad_ref', 'not_a_number', 'bad_length', 'unsorted', 'field_order');
    want.push('unknown_field', 'missing_field');
    expect(want.filter((k) => !kinds.has(k))).toEqual([]);
  });

  it('gives every probe its verdict', () => {
    const failures: string[] = [];
    for (const p of probes) {
      const c = CODECS[p.target];
      const got =
        p.kind === 'action'
          ? verdictOf(() => decodeFramed(p.bytes))
          : c
            ? verdictOf(() => c.decode(p.bytes))
            : 'no such type';
      if (got !== p.verdict)
        failures.push(`${p.kind}:${p.target} ${p.name}: got \`${got}\`, want \`${p.verdict}\``);
    }
    expect(failures).toEqual([]);
  });
});

describe('hand-written fixtures (spec/*.hex)', () => {
  const dir = join(FIXTURES, 'spec');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.hex'))
    .sort();

  it('decodes each to the dump written beside it, or refuses it as written', () => {
    expect(files.length).toBeGreaterThan(0);
    const failures: string[] = [];
    let count = 0;
    for (const f of files)
      for (const c of parseHexFile(f, readFileSync(join(dir, f), 'utf8'))) {
        count++;
        const where = `${c.file}:${c.line} ${c.target}`;
        if (c.target === '@closure') {
          const got = closureVerdict(c.params, c.bytes);
          const ok =
            'ok' in c.expect
              ? got === c.expect.ok
              : 'error' in c.expect && refusalMatches(c.expect.error, got);
          if (!ok) failures.push(`${where}: got \`${got}\``);
          continue;
        }
        if ('error' in c.expect) {
          const cd = CODECS[c.target];
          const got =
            c.target === '@action'
              ? verdictOf(() => decodeFramed(c.bytes))
              : cd
                ? verdictOf(() => cd.decode(c.bytes))
                : 'no such type';
          if (!refusalMatches(c.expect.error, got))
            failures.push(`${where}: got \`${got}\`, want \`${c.expect.error}\``);
          continue;
        }
        try {
          const got = c.target === '@action' ? roundTripAction(c.bytes) : roundTrip(c.target, c.bytes);
          if ('dump' in c.expect && got !== c.expect.dump)
            failures.push(`${where}: dump differs:\n--- want\n${c.expect.dump}--- got\n${got}`);
        } catch (e) {
          failures.push(`${where}: ${(e as Error).message}`);
        }
      }
    expect(count).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('dumps with the same text format as the reference', () => {
    const d = new Dump();
    d.str('s', 'a"\\\n\u0001é');
    d.f32('f', -0);
    d.f64('g', 1.5);
    d.bytes('b', new Uint8Array([0, 255]));
    expect(d.out).toBe('s="a\\"\\\\\\n\\u0001é"\nf=f32:80000000\ng=f64:3ff8000000000000\nb=hex:00ff\n');
  });
});
