// The schema generator (10 §15.1): reads game/schema/*.yaml and writes Rust into crates/schema/src/ and
// crates/sim/src/gen/, and TypeScript into src/shared/gen/.
//
// STUB (C1a). Work package C1b replaces the body of `generate()` with the real generator. Until then the
// schema is empty: the stub writes the empty schema's outputs, so the crates compile, the header hashes
// are exercised by check-arch, and `--check` keeps them fresh. If schema/ holds YAML, the stub fails.
//
// Usage: node scripts/schema-gen.ts [--check]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CommentStyle, GENERATED_DIRS, parseHeader, withHeader } from './lib/generated.ts';
import { ZERO_HASH_HEX } from './lib/hash.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'schema');

interface Output {
  path: string;
  comment: CommentStyle;
  body: string;
}

/** The generated files the (empty) schema produces, with their full text: the inventory check-arch uses. */
export function schemaGenOutputs(schemaHash = ZERO_HASH_HEX): { path: string; text: string }[] {
  return generate(schemaHash).map((o) => ({ path: o.path, text: render(o, schemaHash) }));
}

function generate(schemaHash: string): Output[] {
  const hashBytes = '[0; 32]';
  return [
    {
      path: 'crates/schema/src/lib.rs',
      comment: '//',
      body: `//! Generated from \`game/schema/\` (10 §15.1): ids, enums, shared records, codecs, record writers and
//! the \`Protos\` loader. The schema is empty until work package C1b writes it.
#![forbid(unsafe_code)]

/// The SHA-256 of the schema's resolved layouts (10 §15.1). All zero while the schema is empty.
pub const SCHEMA_HASH: [u8; 32] = ${hashBytes};
`,
    },
    {
      path: 'crates/sim/src/gen/mod.rs',
      comment: '//',
      body: `//! Generated from \`game/schema/state.yaml\` and \`sections.yaml\` (10 §15.1): the SoA pools and save
//! sections. Empty until work package C1b writes the schema.
`,
    },
    {
      path: 'src/shared/gen/schema.ts',
      comment: '//',
      body: `// The schema's identity (10 §15.1). Empty until work package C1b writes the schema.

/** The SHA-256 of the schema's resolved layouts, as hex. All zero while the schema is empty. */
export const SCHEMA_HASH = '${schemaHash}';

/** PROTOCOL_VERSION of the worker protocol (10 §3.2). 0 until the schema defines it. */
export const PROTOCOL_VERSION = 0;
`,
    },
  ];
}

function render(o: Output, schemaHash: string): string {
  return withHeader(
    {
      generator: 'scripts/schema-gen.ts',
      source: 'schema/',
      command: 'npm run gen',
      schemaHash,
      comment: o.comment,
    },
    o.body,
  );
}

function schemaFiles(): string[] {
  if (!existsSync(SCHEMA_DIR)) return [];
  return readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
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

function main(): number {
  const check = process.argv.includes('--check');
  const yaml = schemaFiles();
  if (yaml.length > 0) {
    console.error(
      `schema-gen: game/schema/ holds ${yaml.join(', ')}, but scripts/schema-gen.ts is still the C1a stub. ` +
        'Work package C1b implements the generator.',
    );
    return 1;
  }
  const schemaHash = ZERO_HASH_HEX;
  const outputs = generate(schemaHash);
  const want = new Map(outputs.map((o) => [o.path, render(o, schemaHash)]));
  const problems: string[] = [];
  for (const [path, text] of want) {
    const abs = join(ROOT, path);
    const have = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (have === text) continue;
    if (check) problems.push(`${path}: ${have === null ? 'missing' : 'stale'}`);
    else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
      console.log(`schema-gen: wrote ${path}`);
    }
  }
  // Files that name this generator but that it no longer writes are stale.
  for (const dir of GENERATED_DIRS) {
    for (const abs of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, abs);
      if (want.has(rel)) continue;
      const h = parseHeader(readFileSync(abs, 'utf8'));
      if (h?.generator === 'scripts/schema-gen.ts')
        problems.push(`${rel}: written by schema-gen but no longer generated`);
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`schema-gen --check: ${p}`);
    console.error('Run `npm run gen` to regenerate.');
    return 1;
  }
  if (check) console.log(`schema-gen --check: ${want.size} generated files are fresh (empty schema)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
