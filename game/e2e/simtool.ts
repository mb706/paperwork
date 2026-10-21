// `simtool` for the e2e specs that compare with the native build (C8): the wasmdev profile as `ci` builds it, or a
// simcheck build (the `dev` profile) where the dev panic must panic natively too. Built when missing or older than
// the crates it is built from.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GAME = join(import.meta.dirname, '..');

/** The newest modification time of the Rust sources simtool is built from. */
function newestSource(): number {
  let newest = 0;
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.rs') || e.name === 'Cargo.toml')
        newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  for (const c of ['det', 'schema', 'worldgen', 'sim', 'simtool']) walk(join(GAME, 'crates', c));
  return newest;
}

export function simtool(simcheck = false): string {
  const bin = join(GAME, 'target', simcheck ? 'debug' : 'wasmdev', 'simtool');
  const args = simcheck
    ? ['build', '--locked', '--quiet', '-p', 'simtool', '--features', 'simcheck']
    : ['build', '--locked', '--quiet', '--profile', 'wasmdev', '-p', 'simtool'];
  if (!existsSync(bin) || statSync(bin).mtimeMs < newestSource())
    execFileSync('cargo', args, { cwd: GAME, stdio: 'inherit' });
  return bin;
}
