// The golden set's prototype files: the data stage's M0 build (10 §15.10 "the M0 prototype set"), produced
// in-process from design/spec/data and game/data/engine, so the golden set is a pure function of the
// repository. The committed copies are frozen: a data or schema change that alters them shows up as a
// stale golden set (`node test/golden/build/main.ts --check`).
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { formatDiagnostic } from '../../../scripts/data-stage/diagnostics.ts';
import { runDataStage } from '../../../scripts/data-stage/index.ts';
import { PROTOCOL_VERSION, SCHEMA_HASH } from '../../../src/shared/gen/schema.ts';
import { GAME, SPEC } from '../../helpers/paths.ts';

export interface ProtoFiles {
  bin: Uint8Array;
  json: Uint8Array;
  /** SHA-256 of prototypes.bin, lowercase hex (§15.2 `prototypesHash`). */
  hash: string;
}

export function m0Protos(): ProtoFiles {
  const r = runDataStage({
    gameDir: GAME,
    specDir: SPEC,
    schemaHash: SCHEMA_HASH,
    protocolVersion: PROTOCOL_VERSION,
  });
  if (r.diagnostics.errors.length > 0)
    throw new Error(`the data stage failed:\n${r.diagnostics.errors.map(formatDiagnostic).join('\n')}`);
  const bin = r.outputs.get('public/data/prototypes.bin');
  const json = r.outputs.get('public/data/prototypes.json');
  if (!bin || !json) throw new Error('the data stage wrote no prototypes');
  return { bin, json, hash: createHash('sha256').update(bin).digest('hex') };
}

export { worldgenDataHash } from '../model/protos.ts';

export const repoPath = (...p: string[]): string => join(GAME, ...p);
