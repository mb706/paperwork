// Vitest global setup: this run's own scratch root for `scratchDir` (test/helpers/paths.ts), unique per process and
// removed at teardown, so two Vitest runs in one tree never delete each other's files (C9). The workers find it in
// PAPERWORK_TEST_TMP. Roots left by runs that died (their process is gone) are swept here.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_TMP, TEST_TMP_ENV } from './paths.ts';

/** Whether a process with this pid still runs (EPERM: it does, as another user's). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Removes the roots of runs whose process has gone, and scratch directories of the old shared layout after an hour. */
function sweep(): void {
  let names: string[];
  try {
    names = readdirSync(TEST_TMP);
  } catch {
    return;
  }
  const hourAgo = Date.now() - 3_600_000;
  for (const name of names) {
    const m = /^(?:run|proc)-(\d+)-/.exec(name);
    const path = join(TEST_TMP, name);
    try {
      if (m ? !alive(Number(m[1])) : statSync(path).mtimeMs < hourAgo)
        rmSync(path, { recursive: true, force: true });
    } catch {
      // another run removed it first
    }
  }
}

export default function setup(): () => void {
  mkdirSync(TEST_TMP, { recursive: true });
  sweep();
  const root = mkdtempSync(join(TEST_TMP, `run-${process.pid}-`));
  process.env[TEST_TMP_ENV] = root;
  return () => {
    rmSync(root, { recursive: true, force: true });
    delete process.env[TEST_TMP_ENV];
  };
}
