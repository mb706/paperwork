// scripts/ci-inputs.ts: the gate's key follows every tracked and working-tree change in its paths, and nothing
// outside them (C9).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scratchDir } from '../test/helpers/paths.ts';
import { treeKey } from './ci-inputs.ts';

function repo(): string {
  const dir = scratchDir('ci-inputs');
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  mkdirSync(join(dir, 'game'), { recursive: true });
  mkdirSync(join(dir, 'pm'), { recursive: true });
  writeFileSync(join(dir, 'game', 'a.ts'), 'a');
  writeFileSync(join(dir, 'game', '.gitignore'), 'out/\n');
  writeFileSync(join(dir, 'pm', 'report.md'), 'r');
  g('add', '-A');
  g('commit', '-q', '-m', 'one');
  return dir;
}

describe("the gate's input key", () => {
  it('changes with a tracked edit, an untracked file, a deletion and the extra facts; not outside its paths', () => {
    const dir = repo();
    const key = () => treeKey(dir, ['game']);
    const k0 = key();
    expect(key()).toBe(k0);
    // outside the paths, and ignored outputs inside them: no change
    writeFileSync(join(dir, 'pm', 'report.md'), 'r2');
    mkdirSync(join(dir, 'game', 'out'), { recursive: true });
    writeFileSync(join(dir, 'game', 'out', 'x.bin'), 'x');
    expect(key()).toBe(k0);
    // a working-tree edit, then the same content again
    writeFileSync(join(dir, 'game', 'a.ts'), 'b');
    const k1 = key();
    expect(k1).not.toBe(k0);
    writeFileSync(join(dir, 'game', 'a.ts'), 'a');
    expect(key()).toBe(k0);
    // an untracked file, and a deletion
    writeFileSync(join(dir, 'game', 'new.ts'), 'n');
    expect(key()).not.toBe(k0);
    rmSync(join(dir, 'game', 'new.ts'));
    rmSync(join(dir, 'game', 'a.ts'));
    expect(key()).not.toBe(k0);
    writeFileSync(join(dir, 'game', 'a.ts'), 'a');
    expect(key()).toBe(k0);
    // a committed change of content
    writeFileSync(join(dir, 'game', 'a.ts'), 'c');
    execFileSync('git', ['commit', '-q', '-am', 'two'], { cwd: dir });
    expect(key()).not.toBe(k0);
    // the extra facts count
    expect(treeKey(dir, ['game'], ['node v24'])).not.toBe(treeKey(dir, ['game'], ['node v25']));
  });
});
