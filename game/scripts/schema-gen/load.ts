// Reads game/schema/*.yaml into the resolved model (model.ts).
import { join } from 'node:path';
import { buildSchema, SCHEMA_FILES, type Schema, type SchemaFile } from './model.ts';
import { loadSource, parseSource, type Source } from './yaml.ts';

/** Loads the schema from `schemaDir` (game/schema). */
export function loadSchema(schemaDir: string): Schema {
  const sources = new Map<SchemaFile, Source>();
  for (const f of SCHEMA_FILES) sources.set(f, loadSource(join(schemaDir, `${f}.yaml`), `schema/${f}.yaml`));
  return buildSchema(sources);
}

/** Builds the schema from in-memory texts (tests that mutate it). */
export function schemaFromTexts(texts: Record<SchemaFile, string>): Schema {
  const sources = new Map<SchemaFile, Source>();
  for (const f of SCHEMA_FILES) sources.set(f, parseSource(`schema/${f}.yaml`, texts[f]));
  return buildSchema(sources);
}
