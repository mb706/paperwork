// scripts/free-port.ts: ports below the ephemeral range, claimed by a lock file until the claiming process exits, so
// concurrent Playwright runs on this host never pick the same port (the M0 exit audit #9, C9).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { freePort, lockOf } from './free-port.ts';

describe('free ports', () => {
  it('claims a bindable port below the ephemeral range, and never the same one twice while held', async () => {
    const a = freePort();
    const b = freePort();
    expect(a).toBeGreaterThanOrEqual(21000);
    expect(a).toBeLessThanOrEqual(29999);
    expect(b).not.toBe(a);
    expect(readFileSync(lockOf(a), 'utf8')).toBe(String(process.pid));
    // the claimed port is free to bind
    const s = createServer();
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(a, '127.0.0.1', () => resolve());
    });
    s.close();
  });

  it('another process skips a held port; its own locks go when it exits', () => {
    const mine = freePort();
    // a child asked to start at our port must pass over it
    const script = `import('${new URL('./free-port.ts', import.meta.url).href}').then((m) => {
      process.stdout.write(JSON.stringify([m.freePort(${mine}), m.freePort(${mine})]));
    });`;
    const theirs = JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }),
    ) as number[];
    expect(theirs).not.toContain(mine);
    expect(theirs[0]).not.toBe(theirs[1]);
    for (const p of theirs) expect(existsSync(lockOf(p)), String(p)).toBe(false);
    expect(readFileSync(lockOf(mine), 'utf8')).toBe(String(process.pid));
  });
});
