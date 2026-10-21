// Free ports for the Playwright suites' servers (C8; playwright.config.ts, playwright.release.config.ts). Several
// worktrees share this host, so the fixed defaults (5191, 5193) made parallel runs collide. A config asks for a free
// port once, in Playwright's runner process, and publishes it in the environment variable it read, so the worker
// processes (which load the config again and inherit the runner's environment) use the same port. An explicit
// PW_PORT / PW_RELEASE_PORT wins.
//
// The reservation holds until the server binds (the M0 exit audit #9, C9): ports come from 21000–29999, below the
// kernel's ephemeral range (32768–60999 here), so no outgoing connection takes one meanwhile; and each is claimed with
// a lock file naming the claiming process (~/.cache/paperwork/ports/), so concurrent runs on this host never
// pick the same port. The lock goes when that process exits; a lock whose process is gone is taken over.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FIRST = 21000;
const LAST = 29999;
/** One place for every run of this user, whatever its TMPDIR. */
const LOCKS = join(homedir(), '.cache', 'paperwork', 'ports');

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The lock file of a port. */
export const lockOf = (port: number): string => join(LOCKS, String(port));

/** Claims `port` for this process; false when a live process holds it. */
function claim(port: number): boolean {
  mkdirSync(LOCKS, { recursive: true });
  const f = lockOf(port);
  try {
    writeFileSync(f, String(process.pid), { flag: 'wx' });
  } catch {
    let holder = Number.NaN;
    try {
      holder = Number(readFileSync(f, 'utf8'));
    } catch {
      return false;
    }
    if (alive(holder)) return false;
    writeFileSync(f, String(process.pid)); // its process is gone: take it over
  }
  process.once('exit', () => {
    try {
      if (readFileSync(f, 'utf8') === String(process.pid)) rmSync(f);
    } catch {
      // gone already
    }
  });
  return true;
}

/** Whether a server can listen on 127.0.0.1:`port` now (checked in a child: configs load synchronously). */
function bindable(port: number): boolean {
  const script =
    "const s=require('node:net').createServer();" +
    "s.once('error',()=>process.stdout.write('no'));" +
    `s.listen(${port},'127.0.0.1',()=>{process.stdout.write('ok');s.close();});`;
  return execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10_000 }) === 'ok';
}

/** A port free on 127.0.0.1 and claimed by this process until it exits (`prefer`: the first candidate; tests). */
export function freePort(prefer?: number): number {
  const span = LAST - FIRST + 1;
  const start = prefer === undefined ? (process.pid * 7919) % span : (prefer - FIRST + span) % span;
  for (let i = 0; i < 400; i++) {
    const port = FIRST + ((start + i * 97) % span);
    if (!claim(port)) continue;
    if (bindable(port)) return port;
    rmSync(lockOf(port), { force: true });
  }
  throw new Error(`no free port in ${FIRST}–${LAST}`);
}

/**
 * The port in `process.env[name]`, or a free one, written back to `process.env[name]` so every process of this
 * Playwright run (and every child it spawns) agrees on it.
 */
export function portFromEnv(name: string): number {
  const given = process.env[name];
  if (given !== undefined && given !== '') {
    const port = Number(given);
    if (!Number.isInteger(port) || port <= 0 || port > 65535)
      throw new Error(`${name}=${given} is not a port`);
    return port;
  }
  const port = freePort();
  process.env[name] = String(port);
  return port;
}
