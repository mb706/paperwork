// Vitest global setup: start from an empty scratch directory (test/helpers/paths.ts scratchDir).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { GAME } from './paths.ts';

export default function setup(): void {
  rmSync(join(GAME, '.cache', 'test-tmp'), { recursive: true, force: true });
}
