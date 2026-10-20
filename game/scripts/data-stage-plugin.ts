// Vite plugin: the data stage (10 §2.4 step 3: "as a Vite plugin with file watching").
// Dev: runs `scripts/data-stage.ts` at server start and after every change to the design data, the engine
// overlay, 09 §2.7's slice or 10 §12's manifests (debounced 200 ms, one run at a time, in a child process
// so the server stays responsive); requests under /data/ wait for a running stage; a failure shows Vite's
// error overlay, a success reloads the page. Build: runs it once before bundling and fails the build on
// any error, so dist/data/ is always fresh.
import { spawn, spawnSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

export interface DataStagePluginOptions {
  /** The game/ directory. */
  root: string;
}

const DEBOUNCE_MS = 200;

export function dataStagePlugin({ root }: DataStagePluginOptions): Plugin {
  const repo = join(root, '..');
  const script = join(root, 'scripts', 'data-stage.ts');
  const watched = [
    join(repo, 'design', 'spec', 'data'),
    join(repo, 'design', 'spec', '09-vertical-slice.md'),
    join(repo, 'design', 'spec', '10-architecture.md'),
    join(root, 'data', 'engine'),
    join(root, 'test', 'fixtures', 'expr', 'edge-cases.yaml'),
  ];
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
      const child = spawn(process.execPath, [script, '--quiet'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => {
        out += d;
      });
      child.stderr.on('data', (d) => {
        out += d;
      });
      child.on('close', (code) => {
        if (code === 0) {
          server?.config.logger.info(out.trim().split('\n').pop() ?? 'data stage: ok', { timestamp: true });
          server?.ws.send({ type: 'full-reload' });
        } else {
          server?.config.logger.error(out.trim(), { timestamp: true });
          server?.ws.send({
            type: 'error',
            err: { message: `data stage failed\n\n${out.trim()}`, stack: '' },
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
    name: 'paperwork:data-stage',
    configResolved(config) {
      mode = config.command;
    },
    buildStart() {
      if (mode !== 'build') return;
      const r = spawnSync(process.execPath, [script, '--quiet'], { cwd: root, encoding: 'utf8' });
      if (r.status !== 0) this.error(`data stage failed:\n${r.stderr}${r.stdout}`);
    },
    configureServer(s) {
      server = s;
      void run();
      s.watcher.add(watched);
      const onChange = (file: string): void => {
        const rel = relative(repo, file).split(sep).join('/');
        const hit = watched.some((w) => file === w || file.startsWith(w + sep));
        if (!hit || rel.endsWith('~')) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void run();
        }, DEBOUNCE_MS);
      };
      s.watcher.on('change', onChange);
      s.watcher.on('add', onChange);
      s.watcher.on('unlink', onChange);
      s.middlewares.use(async (req, _res, next) => {
        if (running && (req.url ?? '').startsWith('/data/')) await running;
        next();
      });
    },
  };
}
