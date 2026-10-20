// Shared types and helpers of check-arch.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The game/ directory. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Violation {
  file: string;
  line: number;
  col: number;
  rule: string;
  message: string;
}

export function lineCol(src: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset; i++) {
    if (src.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last };
}
