// Vite plugin: the simulation's WebAssembly modules (10 §2.3, "Vite and cargo").
//
// Dev: builds both cdylibs with the `wasmdev` profile and `--features simcheck` at server start and on
// every change under crates/, schema/, Cargo.toml or Cargo.lock (debounced 200 ms, one build at a time),
// serves them at /__wasm/{sim,gen}.wasm, and sends a full page reload after each build: there is no hot
// reload for the simulation. Builds join the generators' registry (dev-generators.ts): requests wait for
// every generator, and after a failed build /__wasm/* and /data/build-manifest.json answer 503 with
// cargo's message, and new connections get the overlay, until a build succeeds (C1a-r1 finding 15).
// Build: emits both target/wasm-release/{sim,gen}.wasm (scripts/wasm-release.sh: release profile,
// wasm-opt -O3, the feature gate) as content-hashed assets, whether or not code imports them yet
// (C1a-r1 finding 12).
// Either way, `import url from 'virtual:sim-wasm'` (or 'virtual:gen-wasm') yields the module's URL.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { type BuildManifest, devBuildHash, MANIFEST_PATH, manifestText } from './build-manifest.ts';
import { announceFailures, failed, failures, idle, overlay, succeeded, track } from './dev-generators.ts';
import { sha256Hex } from './lib/hash.ts';

export interface WasmModule {
  /** `sim` or `gen`. */
  name: 'sim' | 'gen';
  crate: 'simabi' | 'genabi';
}

export const WASM_MODULES: readonly WasmModule[] = [
  { name: 'sim', crate: 'simabi' },
  { name: 'gen', crate: 'genabi' },
];

export interface BuiltModules {
  /** SHA-256 hex of each module's bytes. */
  hashes: Record<string, string>;
  bytes: Record<string, Uint8Array>;
}

export interface CargoPluginOptions {
  /** The game/ directory. */
  root: string;
  /** Tests: the build command (default cargo's wasmdev build) and where its modules land. */
  command?: readonly string[];
  modulePath?: (m: WasmModule) => string;
}

const VIRTUAL = new Map(WASM_MODULES.map((m) => [`virtual:${m.name}-wasm`, m]));
const DEBOUNCE_MS = 200;
const NAME = 'cargo';

export function wasmdevPath(root: string, m: WasmModule): string {
  return join(root, 'target', 'wasm32-unknown-unknown', 'wasmdev', `${m.crate}.wasm`);
}

export function releasePath(root: string, m: WasmModule): string {
  return join(root, 'target', 'wasm-release', `${m.name}.wasm`);
}

const CARGO_WASMDEV = [
  'cargo',
  'build',
  '--profile',
  'wasmdev',
  '--features',
  'simcheck',
  '--target',
  'wasm32-unknown-unknown',
  ...WASM_MODULES.flatMap((m) => ['-p', m.crate]),
  '--locked',
  '--color',
  'never',
];

/** Runs a build command; resolves with its combined output, rejects with it on failure. */
function runCommand(root: string, command: readonly string[]): Promise<string> {
  const [cmd, ...args] = command as [string, ...string[]];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(out.trim() || `${cmd} exited ${code}`)),
    );
  });
}

function readModules(paths: Record<string, string>): BuiltModules {
  const built: BuiltModules = { hashes: {}, bytes: {} };
  for (const [name, path] of Object.entries(paths)) {
    const bytes = new Uint8Array(readFileSync(path));
    built.bytes[name] = bytes;
    built.hashes[name] = sha256Hex(bytes);
  }
  return built;
}

export function cargoPlugin({ root, command = CARGO_WASMDEV, modulePath }: CargoPluginOptions): Plugin {
  let mode: 'serve' | 'build' = 'serve';
  let current: BuiltModules | null = null;
  let building: Promise<void> | null = null;
  let again = false;
  let timer: NodeJS.Timeout | null = null;
  let scheduled: (() => void) | null = null;
  let server: ViteDevServer | null = null;
  const refs = new Map<string, string>();
  const where = modulePath ?? ((m: WasmModule) => wasmdevPath(root, m));

  const relevant = (file: string): boolean => {
    const rel = relative(root, file).split(sep).join('/');
    return (
      rel.startsWith('crates/') || rel.startsWith('schema/') || rel === 'Cargo.toml' || rel === 'Cargo.lock'
    );
  };

  const build = (): Promise<void> => {
    if (building) {
      again = true;
      return building;
    }
    const started = Date.now();
    building = track(
      runCommand(root, command)
        .then(() => {
          current = readModules(Object.fromEntries(WASM_MODULES.map((m) => [m.name, where(m)])));
          succeeded(NAME);
          for (const m of WASM_MODULES) {
            const mod = server?.moduleGraph.getModuleById(`\0virtual:${m.name}-wasm`);
            if (mod) server?.moduleGraph.invalidateModule(mod);
          }
          server?.config.logger.info(`cargo: wasmdev modules built in ${Date.now() - started} ms`, {
            timestamp: true,
          });
          server?.ws.send({ type: 'full-reload' });
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          failed(NAME, message);
          server?.config.logger.error(`cargo: wasmdev build failed\n${message}`, { timestamp: true });
          server?.ws.send(overlay(failures([NAME])));
        })
        .finally(() => {
          building = null;
          if (again) {
            again = false;
            void build();
          }
        }),
    );
    return building;
  };

  const schedule = (): void => {
    if (!scheduled) track(new Promise<void>((r) => (scheduled = r)));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const done = scheduled;
      scheduled = null;
      void build().finally(() => done?.());
    }, DEBOUNCE_MS);
  };

  /** A 503 with the failures that make a response stale, or false. */
  const refuse = (res: import('node:http').ServerResponse): boolean => {
    const list = failures();
    if (list.length === 0) return false;
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(list.map((f) => `${f.name} failed:\n${f.failure}`).join('\n\n'));
    return true;
  };

  return {
    name: 'paperwork:cargo',
    configResolved(config) {
      mode = config.command;
    },
    buildStart() {
      if (mode !== 'build') return;
      for (const m of WASM_MODULES) {
        const path = releasePath(root, m);
        if (!existsSync(path))
          this.error(`${path} is missing: run scripts/wasm-release.sh first (npm run build does)`);
        refs.set(
          m.name,
          this.emitFile({ type: 'asset', name: `${m.name}.wasm`, source: readFileSync(path) }),
        );
      }
    },
    configureServer(s) {
      server = s;
      announceFailures(s);
      void build();
      const onChange = (file: string): void => {
        if (relevant(file)) schedule();
      };
      s.watcher.on('change', onChange);
      s.watcher.on('add', onChange);
      s.watcher.on('unlink', onChange);
      // The dev build-manifest.json: the data stage's, completed with the modules' hashes (10 §2.3).
      s.middlewares.use(async (req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== `/${MANIFEST_PATH}`) return next();
        await idle();
        if (refuse(res)) return;
        const path = join(root, 'public', MANIFEST_PATH);
        if (!existsSync(path)) return next();
        const m = JSON.parse(readFileSync(path, 'utf8')) as BuildManifest;
        const modules = current?.hashes ?? {};
        const full: BuildManifest = {
          ...m,
          modules,
          buildHash: devBuildHash(modules, m.prototypesHash, m.schemaHash),
        };
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(manifestText(full));
      });
      s.middlewares.use(async (req, res, next) => {
        const m = /^\/__wasm\/(sim|gen)\.wasm(?:\?.*)?$/.exec(req.url ?? '');
        if (!m) return next();
        await idle();
        if (refuse(res)) return;
        const bytes = current?.bytes[m[1] ?? ''];
        if (!bytes) {
          res.statusCode = 503;
          res.end('no wasmdev build yet; see the dev server log');
          return;
        }
        res.setHeader('Content-Type', 'application/wasm');
        res.setHeader('Cache-Control', 'no-store');
        res.end(bytes);
      });
    },
    resolveId(id) {
      return VIRTUAL.has(id) ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith('\0virtual:')) return null;
      const m = VIRTUAL.get(id.slice(1));
      if (!m) return null;
      if (mode === 'serve') {
        const v = current?.hashes[m.name]?.slice(0, 12) ?? 'pending';
        return `export default ${JSON.stringify(`/__wasm/${m.name}.wasm?v=${v}`)};\n`;
      }
      const ref = refs.get(m.name);
      if (!ref) this.error(`${m.name}.wasm was not emitted at buildStart`);
      return `export default import.meta.ROLLUP_FILE_URL_${ref};\n`;
    },
  };
}
