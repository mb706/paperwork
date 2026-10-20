// Generated files (10 §15.1; C1a-r1 finding 11). Only the generators write src/shared/gen/,
// crates/schema/src/ and crates/sim/src/gen/, and the inventory says which file each one writes. A file
// there must be in the inventory, name its own generator and source, carry the current schema's hash
// when schema-gen wrote it, and match its content hash; every file in the inventory must exist. A
// hand-written file with a copied header therefore fails, whatever hash it carries. An inventory file
// outside those directories (the Rust codec-fixture test's dispatch module) gets the same header checks.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import { OUTPUT_PATHS } from '../data-stage/outputs.ts';
import { GENERATED_DIRS, type Generator, headerProblem, parseHeader } from '../lib/generated.ts';
import { SCHEMA_GEN_PATHS } from '../schema-gen.ts';
import type { Violation } from './common.ts';

export interface Expected {
  path: string;
  generator: Generator;
  source: string;
  schemaHash: string | null;
}

/** Every file the generators write into the generated directories. */
export function generatedInventory(): Expected[] {
  return [
    ...SCHEMA_GEN_PATHS.map((path) => ({
      path,
      generator: 'scripts/schema-gen.ts' as const,
      source: 'schema/',
      schemaHash: SCHEMA_HASH,
    })),
    {
      path: OUTPUT_PATHS.protoIds,
      generator: 'scripts/data-stage.ts',
      source: 'design/spec/data',
      schemaHash: null,
    },
  ];
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

export function checkGeneratedFiles(root: string, inventory: readonly Expected[]): Violation[] {
  const out: Violation[] = [];
  const v = (file: string, message: string) =>
    out.push({ file, line: 1, col: 1, rule: 'generated', message });
  const expected = new Map(inventory.map((e) => [e.path, e]));
  const present = new Set<string>();
  const checkHeader = (file: string, abs: string, exp: Expected) => {
    const text = readFileSync(abs, 'utf8');
    const problem = headerProblem(text);
    if (problem) {
      v(file, `${problem} (written only by ${exp.generator})`);
      return;
    }
    const h = parseHeader(text);
    if (h?.generator !== exp.generator || h.source !== exp.source)
      v(
        file,
        `the header names ${h?.generator} from ${h?.source}, but ${exp.generator} writes this file from ${exp.source}`,
      );
    else if (exp.schemaHash !== null && h.schemaHash !== exp.schemaHash)
      v(
        file,
        `generated from schema ${h.schemaHash?.slice(0, 12)}…, but the schema is ${exp.schemaHash.slice(0, 12)}…: run npm run gen`,
      );
  };
  for (const dir of GENERATED_DIRS) {
    for (const abs of walk(join(root, dir))) {
      const file = relative(root, abs).split(sep).join('/');
      present.add(file);
      const exp = expected.get(file);
      if (!exp) {
        v(file, 'no generator writes this file: generated directories hold only the generators’ outputs');
        continue;
      }
      checkHeader(file, abs, exp);
    }
  }
  for (const e of inventory) {
    if (present.has(e.path)) continue;
    const abs = join(root, e.path);
    const inside = GENERATED_DIRS.some((d) => e.path.startsWith(`${d}/`));
    if (!inside && existsSync(abs)) checkHeader(e.path, abs, e);
    else v(e.path, `missing: ${e.generator} writes it (run npm run gen, npm run data)`);
  }
  return out;
}
