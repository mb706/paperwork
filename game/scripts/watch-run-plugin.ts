// A Vite plugin that runs a build script in a child process at dev-server start and after every change to
// the paths it watches (debounced 200 ms, one run at a time, so the server stays responsive), and after
// the generators it follows succeed. Its runs join the shared registry of dev-generators.ts: requests
// under `holdPrefixes` wait for every generator, and while the last run of any generator those requests
// depend on has failed they get a 503 with the error, never the previous results (C1a-r1 findings 14, 15).
// With `beforeBuild`, `vite build` runs the script once first and fails on an error.
import { spawn, spawnSync } from 'node:child_process';
import { join, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import {
  announceFailures,
  failed,
  failures,
  follow,
  idle,
  overlay,
  succeeded,
  track,
} from './dev-generators.ts';

export interface WatchRunOptions {
  name: string;
  /** The game/ directory (the script's working directory). */
  root: string;
  /** The script and its arguments, relative to root. */
  script: string;
  args?: readonly string[];
  /** Absolute files or directories to watch. */
  watched: readonly string[];
  /** Request paths that wait for the generators and fail while a generator they need has failed. */
  holdPrefixes?: readonly string[];
  /** The generators whose failure makes held requests fail (default: every generator). */
  dependsOn?: readonly string[];
  /** Run again whenever one of these generators succeeds. */
  follows?: readonly string[];
  beforeBuild?: boolean;
}

const DEBOUNCE_MS = 200;

export function watchRunPlugin(o: WatchRunOptions): Plugin {
  const script = join(o.root, o.script);
  const args = [script, ...(o.args ?? [])];
  let mode: 'serve' | 'build' = 'serve';
  let server: ViteDevServer | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let timer: NodeJS.Timeout | null = null;
  let scheduled: { promise: Promise<void>; resolve: () => void } | null = null;

  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = track(
      new Promise<void>((resolve) => {
        const child = spawn(process.execPath, args, { cwd: o.root, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        child.stdout.on('data', (d) => {
          out += d;
        });
        child.stderr.on('data', (d) => {
          out += d;
        });
        child.on('close', (code) => {
          if (code === 0) {
            server?.config.logger.info(out.trim().split('\n').pop() ?? `${o.name}: ok`, { timestamp: true });
            succeeded(o.name);
            server?.ws.send({ type: 'full-reload' });
          } else {
            failed(o.name, out.trim() || `exit ${code}`);
            server?.config.logger.error(out.trim(), { timestamp: true });
            server?.ws.send(overlay(failures([o.name])));
          }
          resolve();
        });
      }).finally(() => {
        running = null;
        if (again) {
          again = false;
          void run();
        }
      }),
    );
    return running;
  };

  /** Debounces a run; the pending run counts as busy from now on. */
  const schedule = (): void => {
    if (!scheduled) {
      let resolve = () => {};
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      scheduled = { promise, resolve };
      track(promise);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const s = scheduled;
      scheduled = null;
      void run().finally(() => s?.resolve());
    }, DEBOUNCE_MS);
  };

  for (const leader of o.follows ?? []) follow(leader, schedule);

  return {
    name: `paperwork:${o.name}`,
    configResolved(config) {
      mode = config.command;
    },
    buildStart() {
      if (mode !== 'build' || !o.beforeBuild) return;
      const r = spawnSync(process.execPath, args, { cwd: o.root, encoding: 'utf8' });
      if (r.status !== 0) this.error(`${o.name} failed:\n${r.stderr}${r.stdout}`);
    },
    configureServer(s) {
      server = s;
      announceFailures(s);
      void run();
      s.watcher.add([...o.watched]);
      const onChange = (file: string): void => {
        if (o.watched.some((w) => file === w || file.startsWith(w + sep))) schedule();
      };
      s.watcher.on('change', onChange);
      s.watcher.on('add', onChange);
      s.watcher.on('unlink', onChange);
      const prefixes = o.holdPrefixes ?? [];
      if (prefixes.length > 0) {
        s.middlewares.use(async (req, res, next) => {
          const url = req.url ?? '';
          if (!prefixes.some((p) => url.startsWith(p))) return next();
          await idle();
          const list = failures(o.dependsOn);
          if (list.length === 0) return next();
          res.statusCode = 503;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(list.map((f) => `${f.name} failed:\n${f.failure}`).join('\n\n'));
        });
      }
    },
  };
}
