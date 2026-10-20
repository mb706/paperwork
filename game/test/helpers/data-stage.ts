// Helpers for the data stage's tests: options, a scratch copy of its inputs, edits, messages.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDiagnostic } from '../../scripts/data-stage/diagnostics.ts';
import type { DataStageOptions, DataStageResult } from '../../scripts/data-stage/index.ts';
import { ZERO_HASH_HEX } from '../../scripts/lib/hash.ts';
import { GAME, REPO, scratchDir } from './paths.ts';

export const options = (gameDir = GAME, specDir = join(REPO, 'design', 'spec')): DataStageOptions => ({
  gameDir,
  specDir,
  schemaHash: ZERO_HASH_HEX,
  protocolVersion: 0,
});

/** A scratch copy of the inputs: design/spec (data, 09, 10) and game/data/engine plus the expr edge cases. */
export function scratchRepo(): { game: string; spec: string } {
  const root = scratchDir('data-stage');
  const spec = join(root, 'design', 'spec');
  const game = join(root, 'game');
  mkdirSync(spec, { recursive: true });
  cpSync(join(REPO, 'design/spec/data'), join(spec, 'data'), { recursive: true });
  for (const f of ['09-vertical-slice.md', '10-architecture.md'])
    cpSync(join(REPO, 'design/spec', f), join(spec, f));
  cpSync(join(GAME, 'data/engine'), join(game, 'data/engine'), { recursive: true });
  cpSync(join(GAME, 'test/fixtures/expr/edge-cases.yaml'), join(game, 'test/fixtures/expr/edge-cases.yaml'));
  return { game, spec };
}

export function edit(path: string, from: string | RegExp, to: string): void {
  const text = readFileSync(path, 'utf8');
  const next = text.replace(from, to);
  if (next === text) throw new Error(`edit did not apply to ${path}`);
  writeFileSync(path, next);
}

export const messages = (r: DataStageResult) => r.diagnostics.errors.map(formatDiagnostic);
