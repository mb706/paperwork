// The data stage's command line (10 §2.4; `npm run data`).
//
//   node scripts/data-stage.ts            build the current capability manifest (M0) into public/data/,
//                                         and refresh src/shared/gen/proto-ids.ts and the expression
//                                         cross-check fixture
//   node scripts/data-stage.ts --check    strict mode (npm run check): run twice and require byte-identical
//                                         outputs (D14; the second run in another process, under another
//                                         locale and time zone), require the committed outputs to be fresh,
//                                         and emit every milestone filter in memory; writes nothing
//   node scripts/data-stage.ts --hashes   print the SHA-256 of every output as JSON; writes nothing
//   node scripts/data-stage.ts --manifest m2 [--allow-incomplete]
//                                         build a milestone filter into .cache/data/m2/
//   --quiet                               print only problems
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION, SCHEMA_HASH } from '../src/shared/gen/schema.ts';
import { formatDiagnostic } from './data-stage/diagnostics.ts';
import { type DataStageOptions, OUTPUT_PATHS, runDataStage } from './data-stage/index.ts';
import { sha256Hex } from './lib/hash.ts';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = join(GAME, '..', 'design', 'spec');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The second run of --check (D14): the same stage in another process, under a locale and a time zone
 * chosen to break careless code (Turkish case mapping, a +14:00 offset). Resolves with its output hashes.
 */
function hashesElsewhere(): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8', TZ: 'Pacific/Kiritimati' };
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--hashes'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) =>
      code === 0
        ? resolve(JSON.parse(out) as Record<string, string>)
        : reject(new Error(err || `exit ${code}`)),
    );
  });
}

async function main(): Promise<number> {
  const check = process.argv.includes('--check');
  if (process.argv.includes('--hashes')) {
    const r = runDataStage({
      gameDir: GAME,
      specDir: SPEC,
      schemaHash: SCHEMA_HASH,
      protocolVersion: PROTOCOL_VERSION,
    });
    if (r.diagnostics.errors.length > 0) return 1;
    process.stdout.write(
      JSON.stringify(Object.fromEntries([...r.outputs].map(([p, b]) => [p, sha256Hex(b)]))),
    );
    return 0;
  }
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
  const elsewhere = check && !manifest ? hashesElsewhere() : null;
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
    // D14: a second run from the same files, in another process, locale and time zone, gives the same bytes.
    const again = await (elsewhere as Promise<Record<string, string>>);
    for (const [path, bytes] of r.outputs) {
      if (again[path] !== sha256Hex(bytes)) problems.push(`${path}: a second run gave different bytes (D14)`);
    }
    // The committed outputs are fresh.
    for (const path of [OUTPUT_PATHS.protoIds, OUTPUT_PATHS.exprFixture, OUTPUT_PATHS.protosFixture]) {
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

process.exitCode = await main();
