// Paths for tests: the game/ directory, the repository, and a scratch directory under game/.cache/.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GAME = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO = join(GAME, '..');
export const SPEC = join(REPO, 'design', 'spec');

/** A fresh scratch directory under game/.cache/test-tmp/ (gitignored). */
export function scratchDir(prefix: string): string {
  const base = join(GAME, '.cache', 'test-tmp');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${prefix}-`));
}
