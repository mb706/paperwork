// The data stage's command line (10 §2.4; `npm run data`).
//
//   node scripts/data-stage.ts            build the current capability manifest (M0) into public/data/,
//                                         and refresh src/shared/gen/proto-ids.ts and the expression
//                                         cross-check fixture
//   node scripts/data-stage.ts --check    strict mode (npm run check): run twice and require byte-identical
//                                         outputs (D14), require the committed outputs to be fresh, and
//                                         emit every milestone filter in memory; writes nothing
//   node scripts/data-stage.ts --manifest m2 [--allow-incomplete]
//                                         build a milestone filter into .cache/data/m2/
//   --quiet                               print only problems
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, SCHEMA_HASH } from '../src/shared/gen/schema.ts';
import { formatDiagnostic } from './data-stage/diagnostics.ts';
import { type DataStageOptions, OUTPUT_PATHS, runDataStage } from './data-stage/index.ts';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = join(GAME, '..', 'design', 'spec');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function main(): number {
  const check = process.argv.includes('--check');
  const quiet = process.argv.includes('--quiet');
  const manifest = arg('--manifest');
  // check-arch-ignore determinism: the elapsed time goes to the log, never into an output
  const started = performance.now();
  const opts: DataStageOptions = {
    gameDir: GAME,
    specDir: SPEC,
    allowIncomplete: process.argv.includes('--allow-incomplete'),
    schemaHash: SCHEMA_HASH,
    protocolVersion: PROTOCOL_VERSION,
    ...(manifest ? { manifest } : {}),
    ...(check ? { extraBuilds: ['m1', 'm2', 'm3', 'm4', 'm5'] } : {}),
  };
  const r = runDataStage(opts);
  for (const d of r.diagnostics.list) console.error(formatDiagnostic(d));
  if (!quiet) for (const line of r.report) console.log(line);
  const errors = r.diagnostics.errors.length;
  if (errors > 0) {
    console.error(`data stage: ${errors} error(s), ${r.diagnostics.warnings.length} warning(s)`);
    return 1;
  }
  const problems: string[] = [];
  if (check) {
    // D14: a second run from the same files gives the same bytes.
    const again = runDataStage(opts);
    for (const [path, bytes] of r.outputs) {
      const b = again.outputs.get(path);
      if (!b || !same(bytes, b)) problems.push(`${path}: a second run gave different bytes (D14)`);
    }
    // The committed outputs are fresh.
    for (const path of [OUTPUT_PATHS.protoIds, OUTPUT_PATHS.exprFixture]) {
      const want = r.outputs.get(path);
      const abs = join(GAME, path);
      if (!want) continue;
      if (!existsSync(abs) || !same(new Uint8Array(readFileSync(abs)), want))
        problems.push(`${path} is stale: run \`npm run data\``);
    }
    if (!quiet)
      for (const e of r.extra)
        console.log(
          `  ${e.name}: prototypes.bin ${e.bytes} bytes, prototypes.json ${e.jsonBytes} bytes, sha256 ${e.hash.slice(0, 16)}…`,
        );
  } else {
    for (const [path, bytes] of r.outputs) {
      const target =
        manifest && path.startsWith('public/data/')
          ? path.replace('public/data/', `.cache/data/${manifest}/`)
          : path;
      const abs = join(GAME, target);
      if (existsSync(abs) && same(new Uint8Array(readFileSync(abs)), bytes)) continue;
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
      if (!quiet) console.log(`data stage: wrote ${target}`);
    }
  }
  for (const p of problems) console.error(`data stage --check: ${p}`);
  // check-arch-ignore determinism: the elapsed time goes to the log, never into an output
  const ms = Math.round(performance.now() - started);
  console.log(
    `data stage${check ? ' --check' : ''}: ${problems.length === 0 ? 'ok' : 'FAILED'} in ${ms} ms (${r.diagnostics.warnings.length} warning(s))`,
  );
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = main();
