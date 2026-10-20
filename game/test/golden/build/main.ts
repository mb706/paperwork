// The golden set's command line (10 §15.10; test/golden/README.md "Freezing"; pm/DECISIONS-IMPL.md decision 14).
//
//   node test/golden/build/main.ts                         check: the reference model reproduces m0/ exactly
//   node test/golden/build/main.ts --write                 rewrite m0/'s files from the model (not MANIFEST.json)
//   node test/golden/build/main.ts --write --bump mechanical "why"
//   node test/golden/build/main.ts --write --bump value --approval <ref> "why"
//                                                          record the reviewed change as a new version
//
// A changed golden file is a changed contract: --write alone leaves the set failing its freeze test until the
// change has been reviewed and recorded with --bump. Decision 14's two kinds: a *mechanical* bump changes no
// expected value (only the tiny atlas, a schema layout change: the schema hash moved, or only the frozen
// prototype files under protos/: a data change no expected value depends on), and the package that
// causes it may record it; a *value* bump changes expected states, digests, records, packets or refusals and
// names the approval it was made under (a review or the manager's decision, e.g. pm/reviews/GATE-r1.md). The
// tool refuses a mechanical bump of anything else, a value bump without an approval, and a short reason.
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
  /**
   * The contract's inputs, by path from game/ (GATE-r1 finding 15): the README's rules and the reference model's
   * sources, which bind the packages as much as the files they produce.
   */
  contract: Record<string, string>;
}

/** The golden set's parts kept outside m0/: the tiny atlas is the asset pipeline's fixture (README "The tiny atlas"). */
export const EXTERNAL_DIRS = ['test/fixtures/sprites'];
export const GAME_DIR = join(M0, '..', '..', '..');

/** The contract inputs: the golden README and the model's sources (tests excluded). */
export function contractFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (p: string) => {
    out[p] = sha256(readFileSync(join(GAME_DIR, p)));
  };
  add('test/golden/README.md');
  for (const name of readdirSync(join(GAME_DIR, 'test/golden/model')).sort())
    if (name.endsWith('.ts') && !name.endsWith('.test.ts')) add(`test/golden/model/${name}`);
  return out;
}

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
 * The digest a VERSIONS line records: SHA-256 of the files table as canonical JSON (keys sorted), then of the
 * external table and of the contract table when they are not empty (versions 1 and 2 had neither or no contract).
 */
export function filesDigest(
  files: Record<string, string>,
  external: Record<string, string> = {},
  contract: Record<string, string> = {},
): string {
  const parts = [canonical(files)];
  if (Object.keys(external).length > 0 || Object.keys(contract).length > 0) parts.push(canonical(external));
  if (Object.keys(contract).length > 0) parts.push(canonical(contract));
  return sha256(parts.join('\n'));
}

export const BUMP_KINDS = ['mechanical', 'value'] as const;
export type BumpKind = (typeof BUMP_KINDS)[number];

export interface Version {
  version: number;
  digest: string;
  /** null on the two lines written before kinds existed (versions 1 and 2, kept as written). */
  kind: BumpKind | null;
  approval: string | null;
  /** The first 16 hex digits of the previous line's SHA-256 (null on the old lines). */
  prev: string | null;
  why: string;
  line: string;
}

/**
 * The ledger. A line is `version digest why…` (versions 1–2, before GATE-r1), or
 * `version digest kind=K approval=A prev=P why…` (K mechanical or value, A a reference or `-`, P the previous
 * line's hash prefix): a hash chain, so an edited old line breaks every later one.
 */
export function readVersions(text?: string): Version[] {
  const p = join(M0, VERSIONS);
  if (text === undefined && !existsSync(p)) return [];
  return (text ?? readFileSync(p, 'utf8'))
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((line) => {
      const [v, digest, ...rest] = line.split(' ');
      const tag = (k: string) =>
        rest[0]?.startsWith(`${k}=`) ? (rest.shift() as string).slice(k.length + 1) : null;
      const kind = tag('kind');
      const approval = tag('approval');
      const prev = tag('prev');
      return {
        version: Number(v),
        digest: digest as string,
        kind: kind as BumpKind | null,
        approval: approval === '-' ? null : approval,
        prev,
        why: rest.join(' '),
        line,
      };
    });
}

/** The ledger's rules (decision 14, GATE-r1 finding 15): problems, or none. */
export function ledgerProblems(versions: readonly Version[]): string[] {
  const out: string[] = [];
  versions.forEach((v, i) => {
    if (v.version !== i + 1) out.push(`line ${i + 1}: version ${v.version}, expected ${i + 1}`);
    if (v.version <= 2) return; // written before kinds existed; kept as written (append-only)
    if (v.kind === null || !BUMP_KINDS.includes(v.kind)) out.push(`version ${v.version}: no kind`);
    if (v.kind === 'value' && !v.approval) out.push(`version ${v.version}: a value bump names no approval`);
    if (v.why.trim().length < 20) out.push(`version ${v.version}: the reason is too short`);
    const prev = versions[i - 1];
    if (prev && v.prev !== sha256(prev.line).slice(0, 16))
      out.push(`version ${v.version}: prev does not chain to version ${prev.version}'s line`);
  });
  return out;
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
    contract: sorted(m.contract),
    external: sorted(m.external),
    files: sorted(m.files),
    schemaHash: m.schemaHash,
    version: m.version,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * Why a bump may not be recorded (decision 14; GATE-r1 finding 15, GATE-r2 finding 4), or nothing. The baseline is
 * MANIFEST.json, which only a bump writes, and it must still be the latest ledger version's (its tables hash to
 * that line's digest), so a regeneration (`--write`) cannot move it. A mechanical bump changes no expected value:
 * against the baseline, only the tiny atlas changed, the schema layout did (the schema hash moved), or only the
 * frozen prototype files (protos/); the contract inputs never.
 */
export function bumpProblems(o: {
  kind: string;
  approval: string | null;
  why: string;
  baseline: Manifest | null;
  latest: Version | null;
  next: {
    files: Record<string, string>;
    external: Record<string, string>;
    contract: Record<string, string>;
    schemaHash: string;
  };
}): string[] {
  const out: string[] = [];
  if (!BUMP_KINDS.includes(o.kind as BumpKind))
    out.push(`--bump takes ${BUMP_KINDS.join(' or ')} (decision 14), not "${o.kind}"`);
  if (o.why.trim().length < 20)
    out.push('a bump needs a reason of at least 20 characters: what changed, and why');
  if (o.kind === 'value' && !o.approval)
    out.push('a value bump names its approval: --approval <review or decision>');
  const b = o.baseline;
  if (o.latest) {
    const verified =
      b !== null &&
      b.version === o.latest.version &&
      filesDigest(b.files, b.external, b.contract) === o.latest.digest;
    if (!verified) {
      out.push(
        `MANIFEST.json is not version ${o.latest.version}'s (its tables do not hash to the ledger's digest): restore it from git, then bump`,
      );
      return out;
    }
  }
  if (o.kind === 'mechanical' && b) {
    const changed = [...new Set([...Object.keys(b.files), ...Object.keys(o.next.files)])].filter(
      (p) => b.files[p] !== o.next.files[p],
    );
    const protosOnly = changed.length > 0 && changed.every((p) => p.startsWith('protos/'));
    const contractChanged = canonical(b.contract ?? {}) !== canonical(o.next.contract);
    const schemaMoved = b.schemaHash !== o.next.schemaHash;
    if (contractChanged || (changed.length > 0 && !schemaMoved && !protosOnly))
      out.push(
        'expected values or the contract changed without a schema change: that is a value bump (--bump value --approval …)',
      );
  }
  return out;
}

function argAfter(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function main(): number {
  const write = process.argv.includes('--write');
  const bumpKind = argAfter('--bump');
  const approval = argAfter('--approval');
  // The reason is the last argument that is not a flag or a flag's value.
  const taken = new Set<number>();
  for (const f of ['--bump', '--approval']) {
    const i = process.argv.indexOf(f);
    if (i >= 0) taken.add(i).add(i + 1);
  }
  const free = process.argv.slice(2).filter((a, i) => !a.startsWith('--') && !taken.has(i + 2));
  const why = free[free.length - 1] ?? '';
  // check-arch-ignore determinism: the elapsed time goes to the log only
  const t0 = performance.now();
  const { files } = goldenFiles();
  const table: Record<string, string> = {};
  for (const [p, b] of files) table[p] = sha256(b);
  const versions = readVersions();
  const latest = versions[versions.length - 1];
  const external = externalFiles();
  const contract = contractFiles();
  const digest = filesDigest(table, external, contract);

  if (!write) {
    const problems: string[] = [];
    const have = new Set(committedFiles());
    for (const [p, b] of files) {
      if (!have.has(p)) problems.push(`missing: ${p}`);
      else if (sha256(readFileSync(join(M0, p))) !== sha256(b)) problems.push(`differs: ${p}`);
    }
    for (const p of have) if (!files.has(p)) problems.push(`stale: ${p}`);
    const recorded = existsSync(join(M0, MANIFEST))
      ? (JSON.parse(readFileSync(join(M0, MANIFEST), 'utf8')) as Manifest)
      : null;
    for (const [p, h] of Object.entries(external))
      if (recorded?.external[p] !== h) problems.push(`external file changed: ${p}`);
    for (const p of Object.keys(recorded?.external ?? {}))
      if (!(p in external)) problems.push(`external file missing: ${p}`);
    for (const [p, h] of Object.entries(contract))
      if (recorded?.contract?.[p] !== h) problems.push(`contract input changed: ${p}`);
    problems.push(...ledgerProblems(versions));
    for (const p of problems.slice(0, 40)) console.error(`golden set: ${p}`);
    if (problems.length > 40) console.error(`… and ${problems.length - 40} more`);
    const ok = problems.length === 0;
    console.log(
      `golden set: ${ok ? 'the reference model reproduces m0/' : `${problems.length} problem(s): run --write, review, then --bump`} (${files.size} files, ${Math.round(performance.now() - t0)} ms)`,
    );
    return ok ? 0 : 1;
  }

  // The baseline every bump is classified against (GATE-r2 finding 4): MANIFEST.json, which only a bump writes.
  const baseline = existsSync(join(M0, MANIFEST))
    ? (JSON.parse(readFileSync(join(M0, MANIFEST), 'utf8')) as Manifest)
    : null;
  if (bumpKind !== null) {
    const problems = bumpProblems({
      kind: bumpKind,
      approval,
      why,
      baseline,
      latest: latest ?? null,
      next: { files: table, external, contract, schemaHash: SCHEMA_HASH },
    });
    if (problems.length > 0) {
      for (const p of problems) console.error(`golden set: ${p}`);
      return 1;
    }
  }

  // --write: replace m0/'s files with the model's (MANIFEST.json and VERSIONS.txt only with --bump).
  for (const p of committedFiles()) if (!files.has(p)) rmSync(join(M0, p));
  for (const [p, b] of files) {
    const abs = join(M0, p);
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs) || sha256(readFileSync(abs)) !== sha256(b)) writeFileSync(abs, b);
  }
  if (bumpKind === null) {
    const same = latest?.digest === digest;
    console.log(
      same
        ? `golden set: wrote ${files.size} files: version ${latest?.version ?? 0}, unchanged`
        : `golden set: wrote ${files.size} files; they differ from version ${latest?.version ?? 0}: review the diff, then run with --bump (MANIFEST.json still names version ${latest?.version ?? 0})`,
    );
    return 0;
  }
  let version = latest?.version ?? 0;
  if (latest?.digest === digest) console.log('golden set: unchanged; no new version recorded');
  else {
    version += 1;
    const header =
      versions.length === 0
        ? '# The golden set\'s versions, append-only (test/golden/README.md "Freezing"): the version, the SHA-256 of\n# MANIFEST.json\'s tables as canonical JSON, and why it changed. Never edit or delete a line.\n'
        : '';
    const prev = latest ? ` prev=${sha256(latest.line).slice(0, 16)}` : '';
    const line = `${version} ${digest} kind=${bumpKind} approval=${approval ?? '-'}${prev} ${why}\n`;
    writeFileSync(
      join(M0, VERSIONS),
      `${header}${versions.length === 0 ? '' : readFileSync(join(M0, VERSIONS), 'utf8')}${line}`,
    );
  }
  writeFileSync(
    join(M0, MANIFEST),
    manifestText({ version, schemaHash: SCHEMA_HASH, files: table, external, contract }),
  );
  console.log(`golden set: wrote ${files.size} files, version ${version}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main();
