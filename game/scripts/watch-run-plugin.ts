// A Vite plugin that runs a build script in a child process at dev-server start and after every change
// to the paths it watches (debounced 200 ms, one run at a time, so the server stays responsive): a failure
// shows Vite's error overlay, a success reloads the page. Requests under `holdPrefix` wait for a running
// script. With `beforeBuild`, `vite build` runs it once first and fails on an error. The data stage and
// the schema generator use it (10 §2.3: `npm run dev` runs both in watch mode).
import { spawn, spawnSync } from 'node:child_process';
import { join, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

export interface WatchRunOptions {
  name: string;
  /** The game/ directory (the script's working directory). */
  root: string;
  /** The script and its arguments, relative to root. */
  script: string;
  args?: readonly string[];
  /** Absolute files or directories to watch. */
  watched: readonly string[];
  holdPrefix?: string;
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

  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = new Promise<void>((resolve) => {
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
          server?.ws.send({ type: 'full-reload' });
        } else {
          server?.config.logger.error(out.trim(), { timestamp: true });
          server?.ws.send({
            type: 'error',
            err: { message: `${o.name} failed\n\n${out.trim()}`, stack: '' },
          });
        }
        resolve();
      });
    }).finally(() => {
      running = null;
      if (again) {
        again = false;
        void run();
      }
    });
    return running;
  };

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
      void run();
      s.watcher.add([...o.watched]);
      const onChange = (file: string): void => {
        if (!o.watched.some((w) => file === w || file.startsWith(w + sep))) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void run();
        }, DEBOUNCE_MS);
      };
      s.watcher.on('change', onChange);
      s.watcher.on('add', onChange);
      s.watcher.on('unlink', onChange);
      if (o.holdPrefix) {
        const prefix = o.holdPrefix;
        s.middlewares.use(async (req, _res, next) => {
          if (running && (req.url ?? '').startsWith(prefix)) await running;
          next();
        });
      }
    },
  };
}
