// What `npm run ci` depends on, as one key (C9): a lane, or the whole gate, is skipped only when its key equals the
// one its last green run recorded (.cache/ci/green.json), so re-running the gate after a change that cannot affect it
// (a report, a brief, CLAUDE.md) costs seconds, and any change to its inputs runs everything again.
//
// A key covers, for the paths given (relative to the repository):
//   - every tracked file as the index has it (`git ls-files -s`: mode, blob hash, path);
//   - every file the working tree changed or added there, not ignored (`git status`): its content's hash, or that
//     it was deleted;
//   - extra facts: the tools' versions, the environment that changes cargo's output, the published art's and
//     audio's provenance (gitignored outputs that are not derived from tracked files alone).
// Ignored outputs (target/, .cache/, public/data/, dist/, test-results/) are not inputs: the lanes derive or check
// them when they run.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { relevantEnv } from './ci-release-cache.ts';

const git = (repo: string, args: string[]): Buffer =>
  execFileSync('git', args, { cwd: repo, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

/** The key of `paths` (relative to `repo`) and `extra` facts. */
export function treeKey(repo: string, paths: readonly string[], extra: readonly string[] = []): string {
  const h = createHash('sha256');
  h.update(git(repo, ['ls-files', '-s', '-z', '--', ...paths]));
  const status = git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths])
    .toString('utf8')
    .split('\0');
  const changed = new Set<string>();
  for (let i = 0; i < status.length; i++) {
    const line = status[i] as string;
    if (line.length < 4) continue;
    // "XY path"; a rename or copy is followed by its source path as an entry of its own
    changed.add(line.slice(3));
    if (/[RC]/.test(line.slice(0, 2))) changed.add(status[++i] ?? '');
  }
  changed.delete('');
  for (const f of [...changed].sort()) {
    const at = join(repo, f);
    h.update(`\0${f}\0`);
    h.update(existsSync(at) ? createHash('sha256').update(readFileSync(at)).digest('hex') : 'deleted');
  }
  for (const x of extra) h.update(`\0${x}`);
  return h.digest('hex');
}

const tryRun = (cmd: string, args: string[]): string => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return `${cmd}: none`;
  }
};
const fileSha = (path: string): string =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : `${path}: none`;

/**
 * The facts outside the tracked tree that change what the gate sees: Node, the browsers, the Rust toolchain and
 * optimizer, cargo's environment, the installed npm packages, and the published art's and audio's provenance.
 */
export function environmentFacts(game: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const chrome = join(homedir(), '.local', 'opt', 'chrome-current');
  return [
    `node ${process.version}`,
    `chrome ${existsSync(chrome) ? realpathSync(chrome) : 'none'}`,
    `playwright ${fileSha(join(game, 'node_modules', '@playwright', 'test', 'package.json'))}`,
    `npm ${fileSha(join(game, 'node_modules', '.package-lock.json'))}`,
    `rustc ${tryRun('rustc', ['-vV'])}`,
    `wasm-opt ${tryRun('wasm-opt', ['--version'])}`,
    ...relevantEnv(env),
    `art ${fileSha(join(game, 'public', 'atlases', 'provenance.json'))}`,
    ...['inventory.json', 'sounds.json', 'music.json'].map(
      (f) => `audio ${fileSha(join(game, 'public', 'audio', f))}`,
    ),
  ];
}
