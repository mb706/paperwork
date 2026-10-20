// The golden set's command line (10 §15.10; test/golden/README.md "Freezing").
//
//   node test/golden/build/main.ts                         check: the reference model reproduces m0/ exactly
//   node test/golden/build/main.ts --write                 rewrite m0/ and MANIFEST.json from the model
//   node test/golden/build/main.ts --write --bump "why"    and record a new version in VERSIONS.txt
//
// A changed golden file is a changed contract: --write alone leaves the set failing its freeze test until the
// change has been reviewed and recorded with --bump.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_HASH } from '../../../src/shared/gen/schema.ts';
import { goldenFiles } from './files.ts';

export const M0 = join(dirname(fileURLToPath(import.meta.url)), '..', 'm0');
export const MANIFEST = 'MANIFEST.json';
export const VERSIONS = 'VERSIONS.txt';

const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

export interface Manifest {
  version: number;
  schemaHash: string;
  files: Record<string, string>;
  /** Files of the set that live elsewhere, by path from game/: the tiny atlas, C6's fixture (§15.7, §15.10). */
  external: Record<string, string>;
}

/** The golden set's parts kept outside m0/: the tiny atlas is the asset pipeline's fixture (README "The tiny atlas"). */
export const EXTERNAL_DIRS = ['test/fixtures/sprites'];
export const GAME_DIR = join(M0, '..', '..', '..');

/** The external files and their SHA-256, as they are on disk now. */
export function externalFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of EXTERNAL_DIRS)
    for (const name of readdirSync(join(GAME_DIR, dir)).sort()) {
      const p = join(dir, name);
      if (statSync(join(GAME_DIR, p)).isFile()) out[p] = sha256(readFileSync(join(GAME_DIR, p)));
    }
  return out;
}

const canonical = (t: Record<string, string>): string => {
  const keys = Object.keys(t).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(t[k])}`).join(',')}}`;
};

/**
 * The digest a VERSIONS line records: SHA-256 of the files table as canonical JSON (keys sorted), and of the
 * external table when there is one, so a change to the tiny atlas is a change to the set.
 */
export function filesDigest(files: Record<string, string>, external: Record<string, string> = {}): string {
  return sha256(
    Object.keys(external).length === 0 ? canonical(files) : `${canonical(files)}\n${canonical(external)}`,
  );
}

export function readVersions(): { version: number; digest: string; why: string }[] {
  const p = join(M0, VERSIONS);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [v, digest, ...why] = l.split(' ');
      return { version: Number(v), digest: digest as string, why: why.join(' ') };
    });
}

/** Every file under m0/ (relative paths), the manifest and the ledger excluded. */
export function committedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(M0, p));
    }
  };
  if (existsSync(M0)) walk(M0);
  return out.filter((p) => p !== MANIFEST && p !== VERSIONS).sort();
}

function manifestText(m: Manifest): string {
  const sorted = (t: Record<string, string>) =>
    Object.fromEntries(
      Object.keys(t)
        .sort()
        .map((k) => [k, t[k]]),
    );
  const body = {
    external: sorted(m.external),
    files: sorted(m.files),
    schemaHash: m.schemaHash,
    version: m.version,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

function main(): number {
  const write = process.argv.includes('--write');
  const bumpAt = process.argv.indexOf('--bump');
  const bump = bumpAt >= 0 ? (process.argv[bumpAt + 1] ?? '') : null;
  // check-arch-ignore determinism: the elapsed time goes to the log only
  const t0 = performance.now();
  const { files } = goldenFiles();
  const table: Record<string, string> = {};
  for (const [p, b] of files) table[p] = sha256(b);
  const versions = readVersions();
  const latest = versions[versions.length - 1];
  const external = externalFiles();
  const digest = filesDigest(table, external);

  if (!write) {
    const problems: string[] = [];
    const have = new Set(committedFiles());
    for (const [p, b] of files) {
      if (!have.has(p)) problems.push(`missing: ${p}`);
      else if (sha256(readFileSync(join(M0, p))) !== sha256(b)) problems.push(`differs: ${p}`);
    }
    for (const p of have) if (!files.has(p)) problems.push(`stale: ${p}`);
    const recorded = existsSync(join(M0, MANIFEST))
      ? (JSON.parse(readFileSync(join(M0, MANIFEST), 'utf8')) as Manifest).external
      : {};
    for (const [p, h] of Object.entries(external))
      if (recorded[p] !== h) problems.push(`external file changed: ${p}`);
    for (const p of Object.keys(recorded)) if (!(p in external)) problems.push(`external file missing: ${p}`);
    for (const p of problems.slice(0, 40)) console.error(`golden set: ${p}`);
    if (problems.length > 40) console.error(`… and ${problems.length - 40} more`);
    const ok = problems.length === 0;
    console.log(
      `golden set: ${ok ? 'the reference model reproduces m0/' : `${problems.length} file(s) differ: run --write, review, then --bump`} (${files.size} files, ${Math.round(performance.now() - t0)} ms)`,
    );
    return ok ? 0 : 1;
  }

  // --write: replace m0/'s files with the model's.
  for (const p of committedFiles()) if (!files.has(p)) rmSync(join(M0, p));
  for (const [p, b] of files) {
    const abs = join(M0, p);
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs) || sha256(readFileSync(abs)) !== sha256(b)) writeFileSync(abs, b);
  }
  let version = latest?.version ?? 0;
  if (bump !== null) {
    if (latest?.digest === digest) console.log('golden set: unchanged; no new version recorded');
    else {
      version += 1;
      const header =
        versions.length === 0
          ? '# The golden set\'s versions, append-only (test/golden/README.md "Freezing"): the version, the SHA-256 of\n# MANIFEST.json\'s "files" as canonical JSON, and why it changed. Never edit or delete a line.\n'
          : '';
      const line = `${version} ${digest} ${bump || 'no reason given'}\n`;
      writeFileSync(
        join(M0, VERSIONS),
        `${header}${versions.length === 0 ? '' : readFileSync(join(M0, VERSIONS), 'utf8')}${line}`,
      );
    }
  }
  writeFileSync(
    join(M0, MANIFEST),
    manifestText({ version, schemaHash: SCHEMA_HASH, files: table, external }),
  );
  const frozen = readVersions().some((v) => v.version === version && v.digest === digest);
  console.log(
    frozen
      ? `golden set: wrote ${files.size} files, version ${version}`
      : `golden set: wrote ${files.size} files; they differ from version ${version}: review the diff, then run with --bump "why"`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main();
