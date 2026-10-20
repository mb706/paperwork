// Verifies that every determinism ban in clippy.toml fires (10 §4.1 rule 3: "each verified to fire").
// Runs clippy with game/clippy.toml on test/clippy-bans, a crate that breaks each ban once, and requires
// one diagnostic per banned path. A ban that stops firing (a misspelt path, a clippy change) fails here.
//
// Usage: node scripts/check-clippy-bans.ts
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The `path = "…"` entries of clippy.toml's disallowed-* tables. */
export function bannedPaths(toml: string): string[] {
  return [...toml.matchAll(/\{\s*path\s*=\s*"([^"]+)"/g)].map((m) => m[1] as string);
}

function main(): number {
  const banned = bannedPaths(readFileSync(join(ROOT, 'clippy.toml'), 'utf8'));
  const r = spawnSync(
    'cargo',
    [
      'clippy',
      '--locked',
      '--quiet',
      '--message-format=json',
      '--target-dir',
      join(ROOT, 'target', 'clippy-bans'),
      '--',
      '-W',
      'clippy::disallowed_methods',
      '-W',
      'clippy::disallowed_types',
      '-W',
      'clippy::disallowed_macros',
    ],
    {
      cwd: join(ROOT, 'test', 'clippy-bans'),
      encoding: 'utf8',
      env: { ...process.env, CLIPPY_CONF_DIR: ROOT },
      maxBuffer: 1 << 26,
    },
  );
  if (r.error) throw r.error;
  const fired = new Set<string>();
  const unknown: string[] = [];
  for (const line of r.stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    const msg = JSON.parse(line) as {
      reason?: string;
      message?: { code?: { code?: string } | null; message?: string };
    };
    if (msg.reason !== 'compiler-message' || !msg.message) continue;
    const code = msg.message.code?.code ?? '';
    const text = msg.message.message ?? '';
    if (/^clippy::disallowed_(methods|types|macros)$/.test(code)) {
      const m = /`([^`]+)`/.exec(text);
      if (m) fired.add(m[1] as string);
    } else if (/does not refer to|could not be resolved|unknown path/i.test(text)) unknown.push(text);
  }
  const silent = banned.filter((p) => !fired.has(p));
  for (const u of unknown) console.error(`check-clippy-bans: ${u}`);
  for (const p of silent)
    console.error(`check-clippy-bans: the ban on ${p} did not fire on test/clippy-bans`);
  if (r.status !== 0 && fired.size === 0) {
    console.error(r.stderr);
    return 1;
  }
  console.log(`check-clippy-bans: ${banned.length - silent.length} of ${banned.length} bans fire`);
  return silent.length === 0 && unknown.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
