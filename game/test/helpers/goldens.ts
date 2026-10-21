// Frozen regression goldens for Vitest (10 §10.3 "Workflow"; C8), the twin of crates/sim/tests/rules/goldens.rs: a
// value is first asserted against its expected value within a tolerance, then against the frozen copy in
// test/goldens/<file>.json; `UPDATE_GOLDENS=1` rewrites the files (review the diff, and say why in the commit).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GAME } from './paths.ts';

export class Goldens {
  private readonly path: string;
  private readonly values: Record<string, number | string>;
  private readonly update = process.env.UPDATE_GOLDENS === '1';

  constructor(file: string) {
    this.path = join(GAME, 'test', 'goldens', `${file}.json`);
    this.values = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, number | string>)
      : {};
  }

  /** A number within `tolerance` of `expected`, then equal to its frozen value. */
  check(name: string, value: number, expected: number, tolerance: number): void {
    if (Math.abs(value - expected) > tolerance)
      throw new Error(`${name} = ${value}, the expected value is ${expected} ± ${tolerance}`);
    this.frozen(name, value);
  }

  /** Any value (a hash, a count) equal to its frozen value. */
  frozen(name: string, value: number | string): void {
    if (this.update) {
      this.values[name] = value;
      return;
    }
    if (!(name in this.values))
      throw new Error(`${name} = ${value} is not frozen yet: run with UPDATE_GOLDENS=1`);
    if (this.values[name] !== value)
      throw new Error(`${name} = ${value}, frozen at ${this.values[name]} (UPDATE_GOLDENS=1 after review)`);
  }

  /** Writes the file under UPDATE_GOLDENS=1 (call it last). */
  finish(): void {
    if (!this.update) return;
    const sorted = Object.fromEntries(
      Object.entries(this.values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}
