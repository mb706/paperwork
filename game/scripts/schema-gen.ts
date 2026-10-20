// The schema generator (10 §15.1): reads game/schema/*.yaml (and the current capability manifest,
// game/data/engine/capabilities.yaml), validates and resolves it (scripts/schema-gen/model.ts), and writes
//   - Rust into crates/schema/src/ (shared: ids, enums, records, codecs, the action pipeline, packets,
//     projections, the ABI, the Protos loader) and crates/sim/src/gen/ (state.yaml's pools, records and
//     save sections), formatted by rustfmt;
//   - TypeScript into src/shared/gen/;
//   - the codec fixtures into test/fixtures/codec/ (actions.bin, records.bin, probes.txt).
// SCHEMA_HASH is the SHA-256 of the resolved-layout listing (src/shared/gen/layout.txt). Output is a pure
// function of the inputs (D14): run it twice and get the same bytes. game/schema/README.md is the guide.
//
// Usage: node scripts/schema-gen.ts [--check] [--quiet]
//   --check  regenerate in memory and fail on any difference with the files on disk (npm run check)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CommentStyle, GENERATED_DIRS, parseHeader, withHeader } from './lib/generated.ts';
import { checkCapabilities, loadCapabilities } from './schema-gen/capabilities.ts';
import { codecFixtures } from './schema-gen/fixtures.ts';
import { listing, schemaHash } from './schema-gen/listing.ts';
import { loadSchema } from './schema-gen/load.ts';
import type { Schema } from './schema-gen/model.ts';
import { emitRustFiles, RUST_FIXTURES_PATH } from './schema-gen/rust-modules.ts';
import { emitTsFiles } from './schema-gen/ts-modules.ts';
import { SchemaError } from './schema-gen/yaml.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'schema');
const CAPABILITIES = join(ROOT, 'data', 'engine', 'capabilities.yaml');

/** Every file the generator writes into the generated directories (check-arch's inventory). */
export const SCHEMA_GEN_PATHS: readonly string[] = [
  ...[
    'lib',
    'codec',
    'types',
    'actions',
    'events',
    'packet',
    'projections',
    'container',
    'abi',
    'protos',
    'registries',
    'capabilities',
  ].map((m) => `crates/schema/src/${m}.rs`),
  ...['mod', 'state', 'pools', 'sections'].map((m) => `crates/sim/src/gen/${m}.rs`),
  RUST_FIXTURES_PATH,
  ...[
    'schema',
    'codec',
    'types',
    'actions',
    'events',
    'packet',
    'projections',
    'container',
    'abi',
    'protos',
    'registries',
    'capabilities',
    'state',
    'pools',
    'sections',
    'samples',
  ].map((m) => `src/shared/gen/${m}.ts`),
  'src/shared/gen/layout.txt',
];

/** The codec fixtures the generator writes (outside the generated directories, without headers). */
export const FIXTURE_PATHS = {
  actions: 'test/fixtures/codec/actions.bin',
  records: 'test/fixtures/codec/records.bin',
  probes: 'test/fixtures/codec/probes.txt',
} as const;
const FIXTURES: readonly string[] = [FIXTURE_PATHS.actions, FIXTURE_PATHS.records, FIXTURE_PATHS.probes];

export interface Generated {
  hash: string;
  files: { path: string; bytes: Uint8Array }[];
}

function rustfmt(text: string, path: string): string {
  try {
    return execFileSync('rustfmt', ['--edition', '2024', '--config-path', join(ROOT, 'rustfmt.toml')], {
      input: text,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = (e as { stderr?: string }).stderr ?? String(e);
    throw new Error(`rustfmt refused ${path}:\n${err.split('\n').slice(0, 20).join('\n')}`);
  }
}

const enc = new TextEncoder();

/** Generates every output in memory. */
export function generate(schema: Schema = loadSchema(SCHEMA_DIR)): Generated {
  const caps = loadCapabilities(CAPABILITIES);
  const problems = checkCapabilities(caps, schema);
  if (problems.length > 0)
    throw new Error(`data/engine/capabilities.yaml (manifest ${caps.name}):\n  ${problems.join('\n  ')}`);
  const hash = schemaHash(schema);
  const text = listing(schema);
  const header = (body: string, comment: CommentStyle = '//') =>
    withHeader(
      {
        generator: 'scripts/schema-gen.ts',
        source: 'schema/',
        command: 'npm run gen',
        schemaHash: hash,
        comment,
      },
      body,
    );
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const f of emitRustFiles(schema, caps, hash))
    files.push({ path: f.path, bytes: enc.encode(header(rustfmt(f.text, f.path))) });
  for (const f of emitTsFiles(schema, caps, hash, text))
    files.push({
      path: f.path,
      bytes: enc.encode(header(f.text, f.path.endsWith('.txt') ? '#' : '//')),
    });
  const fx = codecFixtures(schema);
  files.push({ path: FIXTURE_PATHS.actions, bytes: fx.actions });
  files.push({ path: FIXTURE_PATHS.records, bytes: fx.records });
  files.push({ path: FIXTURE_PATHS.probes, bytes: enc.encode(fx.probes) });
  const want = new Set(SCHEMA_GEN_PATHS);
  for (const f of files)
    if (!want.has(f.path) && !FIXTURES.includes(f.path))
      throw new Error(`generated ${f.path}, which SCHEMA_GEN_PATHS does not list`);
  for (const p of want)
    if (!files.some((f) => f.path === p))
      throw new Error(`SCHEMA_GEN_PATHS lists ${p}, which was not generated`);
  return { hash, files };
}

/** The generated files with their text, for tools (check-arch reads SCHEMA_GEN_PATHS instead). */
export function schemaGenOutputs(): { path: string; text: string }[] {
  const dec = new TextDecoder();
  return generate()
    .files.filter((f) => SCHEMA_GEN_PATHS.includes(f.path))
    .map((f) => ({ path: f.path, text: dec.decode(f.bytes) }));
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function main(): number {
  const check = process.argv.includes('--check');
  const quiet = process.argv.includes('--quiet');
  // check-arch-ignore determinism: the run time is printed, never written into an output
  const t0 = performance.now();
  let g: Generated;
  try {
    g = generate();
  } catch (e) {
    console.error(
      e instanceof SchemaError ? `schema-gen: ${e.message}` : `schema-gen: ${(e as Error).message}`,
    );
    return 1;
  }
  const problems: string[] = [];
  let wrote = 0;
  for (const f of g.files) {
    const abs = join(ROOT, f.path);
    const have = existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
    if (have && same(have, f.bytes)) continue;
    if (check) problems.push(`${f.path}: ${have === null ? 'missing' : 'stale'}`);
    else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.bytes);
      wrote++;
      if (!quiet) console.log(`schema-gen: wrote ${f.path}`);
    }
  }
  // Files that name this generator but that it no longer writes are stale.
  const paths = new Set(g.files.map((f) => f.path));
  for (const dir of GENERATED_DIRS) {
    for (const abs of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, abs);
      if (paths.has(rel)) continue;
      const h = parseHeader(readFileSync(abs, 'utf8'));
      if (h?.generator === 'scripts/schema-gen.ts')
        problems.push(`${rel}: written by schema-gen but no longer generated`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`schema-gen${check ? ' --check' : ''}: ${p}`);
    if (check) console.error('Run `npm run gen` to regenerate.');
    return 1;
  }
  // check-arch-ignore determinism: the run time is printed, never written into an output
  const ms = Math.round(performance.now() - t0);
  if (check)
    console.log(
      `schema-gen --check: ${g.files.length} outputs are fresh (schema ${g.hash.slice(0, 12)}…, ${ms} ms)`,
    );
  else if (!quiet || wrote > 0)
    console.log(
      `schema-gen: ${wrote} of ${g.files.length} outputs written (schema ${g.hash.slice(0, 12)}…, ${ms} ms)`,
    );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
