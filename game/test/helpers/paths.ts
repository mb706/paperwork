// Paths for tests: the game/ directory, the repository, and a scratch directory under game/.cache/.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GAME = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO = join(GAME, '..');
export const SPEC = join(REPO, 'design', 'spec');

/** Where every run's scratch directory lives (gitignored). */
export const TEST_TMP = join(GAME, '.cache', 'test-tmp');
/** The environment variable that hands a Vitest run's own scratch root to its workers (global-setup.ts). */
export const TEST_TMP_ENV = 'PAPERWORK_TEST_TMP';

let own: string | null = null;

/**
 * This run's scratch root. A Vitest run gets its own from global-setup.ts (`run-<pid>-…`, removed at teardown), so
 * two runs in one tree never delete each other's files (C9). Anything else that calls `scratchDir` (a script, a
 * Playwright helper) gets one per process (`proc-<pid>-…`), removed when the process exits.
 */
export function testTmpRoot(): string {
  const env = process.env[TEST_TMP_ENV];
  if (env) {
    mkdirSync(env, { recursive: true });
    return env;
  }
  if (own === null) {
    mkdirSync(TEST_TMP, { recursive: true });
    const dir = mkdtempSync(join(TEST_TMP, `proc-${process.pid}-`));
    own = dir;
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  }
  return own;
}

/** A fresh scratch directory under this run's root in game/.cache/test-tmp/ (gitignored). */
export function scratchDir(prefix: string): string {
  return mkdtempSync(join(testTmpRoot(), `${prefix}-`));
}
