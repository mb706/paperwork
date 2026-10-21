// Free ports for the Playwright suites' servers (C8; playwright.config.ts, playwright.release.config.ts). Several
// worktrees share this host, so the fixed defaults (5191, 5193) made parallel runs collide. A config asks the OS
// for a free port once, in Playwright's runner process, and publishes it in the environment variable it read, so
// the worker processes (which load the config again and inherit the runner's environment) use the same port. An
// explicit PW_PORT / PW_RELEASE_PORT wins.
import { execFileSync } from 'node:child_process';

/** A TCP port free on 127.0.0.1 right now (the OS's choice), found synchronously: configs load synchronously. */
export function freePort(): number {
  const script =
    "const s=require('node:net').createServer();" +
    "s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();});";
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10_000 });
  const port = Number(out.trim());
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`no free port: ${out}`);
  return port;
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
