// Vite plugin: the dev server's endpoints of 10 §3.5 and the files the dev pages read (C8). They write into the
// project, so Claude reads what the user's machine sent directly:
//   POST /__bench                   bench.html's results (JSON) → bench/user-results/<date>[-n].json (§10.6)
//   POST /__report/<id>/<file>      one file of a bug report (raw bytes) → bench/reports/<id>/<file>; the client
//                                   (src/dev/report.ts: Ctrl+Alt+F12, `__game.report()`) sends the base save, the
//                                   closure log since it, the digest ring, report.json, console.txt and a screenshot;
//                                   `simtool replay bench/reports/<id>` reproduces it natively (§8.5)
//   POST /__shot[?name=label]       a PNG from the user's session → bench/shots/<time>[-label].png
//   GET  /__dev/release/<m>.wasm    the release modules (target/wasm-release/{sim,gen}.wasm), for the trace page
//                                   (`?module=release`) and bench.html's calibration runs
//   GET  /__bench/scenarios/<file>  the M0 benchmark scenarios (`simtool bench --write-scenarios`), written on the
//                                   first request when missing (target/bench/scenarios)
//   GET  /bench.html                redirects to the benchmark page, src/dev/bench.html (§10.6's URL)
// The benchmark page, the gallery it frames and their workers are served cross-origin isolated (COOP and COEP), so
// that `performance.now()` keeps its fine resolution (browsers coarsen it to 0.1–1 ms otherwise). A worker of an
// isolated page must itself carry COEP, so every response requested from those pages carries it.
// Dev server only (`apply: 'serve'`): a production build has none of them.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export interface DevEndpointsOptions {
  /** The game/ directory. */
  root: string;
  /** Tests: where the files go (default `<root>/bench`), and the scenarios directory. */
  benchDir?: string;
  scenariosDir?: string;
  /** Tests: the command that writes the scenarios when they are missing. */
  writeScenarios?: (dir: string) => Promise<void>;
}

/** The largest body accepted: a late game's save and log fit with room to spare. */
export const MAX_BODY = 256 << 20;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
/** Requests from these pages and their workers are served cross-origin isolated (the benchmark's clocks). */
const ISOLATED_FROM = /\/src\/dev\/(bench\.html|bench\/|gallery\.html)|\/src\/assets\/worker/;

type Next = (err?: unknown) => void;

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const text = typeof body === 'string' ? body : `${JSON.stringify(body)}\n`;
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', 'no-store');
  res.end(text);
}

function sendBytes(res: ServerResponse, bytes: Uint8Array, type: string): void {
  res.statusCode = 200;
  res.setHeader('content-type', type);
  res.setHeader('content-length', String(bytes.length));
  res.setHeader('cache-control', 'no-store');
  res.end(bytes);
}

function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > limit) {
        reject(new Error(`the body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Writes a file whole or not at all (a temporary name, then a rename). */
function writeAtomic(path: string, bytes: Uint8Array | string): void {
  const tmp = `${path}.part`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, path);
}

/** `<dir>/<base><ext>`, or `<base>-2<ext>`, `-3` … when taken. */
function freeName(dir: string, base: string, ext: string): string {
  for (let k = 1; ; k++) {
    const name = `${base}${k === 1 ? '' : `-${k}`}${ext}`;
    if (!existsSync(join(dir, name))) return name;
  }
}

/** A local time stamp for file names: 2026-10-21T02-15-07. */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

const scenariosCmd = (root: string) => (dir: string) =>
  new Promise<void>((resolve, reject) => {
    const tool = join(root, 'target', 'wasmdev', 'simtool');
    const run = () =>
      execFile(
        tool,
        ['bench', '--scenario', 'none', '--write-scenarios', dir],
        { cwd: root, maxBuffer: 1 << 24 },
        (e, _o, err) => (e ? reject(new Error(`${e.message}\n${err}`)) : resolve()),
      );
    if (existsSync(tool)) run();
    else
      execFile(
        'cargo',
        ['build', '--locked', '--profile', 'wasmdev', '-p', 'simtool'],
        { cwd: root, maxBuffer: 1 << 24 },
        (e, _o, err) => (e ? reject(new Error(`${e.message}\n${err}`)) : run()),
      );
  });

/** The middleware, exported for tests (an http server around it). */
export function devEndpoints(
  o: DevEndpointsOptions,
): (req: IncomingMessage, res: ServerResponse, next: Next) => void {
  const bench = o.benchDir ?? join(o.root, 'bench');
  const scenarios = o.scenariosDir ?? join(o.root, 'target', 'bench', 'scenarios');
  const writeScenarios = o.writeScenarios ?? scenariosCmd(o.root);
  let writing: Promise<void> | null = null;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    if (req.method === 'POST' && path === '/__bench') {
      const body = await readBody(req, 64 << 20);
      let json: unknown;
      try {
        json = JSON.parse(body.toString('utf8'));
      } catch {
        send(res, 400, { ok: false, error: 'the body is not JSON' });
        return true;
      }
      const dir = join(bench, 'user-results');
      mkdirSync(dir, { recursive: true });
      const name = freeName(dir, stamp().slice(0, 10), '.json');
      writeAtomic(join(dir, name), `${JSON.stringify(json, null, 1)}\n`);
      send(res, 200, { ok: true, file: `bench/user-results/${name}` });
      return true;
    }
    const report = /^\/__report\/([^/]+)\/([^/]+)$/.exec(path);
    if (req.method === 'POST' && report) {
      const [, id, file] = report as unknown as [string, string, string];
      if (!NAME.test(id) || !NAME.test(file) || file.endsWith('.part')) {
        send(res, 400, { ok: false, error: 'a report id and file name are [A-Za-z0-9_.-], at most 100' });
        return true;
      }
      const body = await readBody(req);
      const dir = join(bench, 'reports', id);
      mkdirSync(dir, { recursive: true });
      writeAtomic(join(dir, file), body);
      send(res, 200, { ok: true, file: `bench/reports/${id}/${file}`, bytes: body.length });
      return true;
    }
    if (req.method === 'POST' && path === '/__shot') {
      const label = url.searchParams.get('name') ?? '';
      if (label !== '' && !NAME.test(label)) {
        send(res, 400, { ok: false, error: 'a shot name is [A-Za-z0-9_.-], at most 100' });
        return true;
      }
      const body = await readBody(req, 64 << 20);
      const png = body.length >= 8 && body.readUInt32BE(0) === 0x89504e47;
      if (!png) {
        send(res, 400, { ok: false, error: 'the body is not a PNG' });
        return true;
      }
      const dir = join(bench, 'shots');
      mkdirSync(dir, { recursive: true });
      const name = freeName(dir, `${stamp()}${label ? `-${label}` : ''}`, '.png');
      writeAtomic(join(dir, name), body);
      send(res, 200, { ok: true, file: `bench/shots/${name}` });
      return true;
    }
    const referer = req.headers.referer ?? '';
    if (path === '/src/dev/bench.html' || ISOLATED_FROM.test(referer)) {
      res.setHeader('cross-origin-opener-policy', 'same-origin');
      res.setHeader('cross-origin-embedder-policy', 'require-corp');
    }
    if (req.method === 'GET' && path === '/bench.html') {
      res.statusCode = 302;
      res.setHeader('location', `/src/dev/bench.html${url.search}`);
      res.end();
      return true;
    }
    const release = /^\/__dev\/release\/(sim|gen)\.wasm$/.exec(path);
    if (req.method === 'GET' && release) {
      const file = join(o.root, 'target', 'wasm-release', `${release[1]}.wasm`);
      if (!existsSync(file)) {
        send(
          res,
          404,
          'no release module: run `sh scripts/wasm-release.sh` (or `npm run build`)\n',
          'text/plain',
        );
        return true;
      }
      sendBytes(res, readFileSync(file), 'application/wasm');
      return true;
    }
    const scenario = /^\/__bench\/scenarios\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && scenario) {
      const file = scenario[1] as string;
      if (!NAME.test(file)) {
        send(res, 400, { ok: false, error: 'a bad file name' });
        return true;
      }
      if (!existsSync(join(scenarios, 'scenarios.json'))) {
        writing ??= writeScenarios(scenarios).finally(() => {
          writing = null;
        });
        await writing;
      }
      const at = join(scenarios, file);
      if (!existsSync(at) || !statSync(at).isFile()) {
        send(res, 404, { ok: false, error: `no ${file}` });
        return true;
      }
      sendBytes(
        res,
        readFileSync(at),
        file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      );
      return true;
    }
    return false;
  };

  return (req, res, next) => {
    handle(req, res)
      .then((done) => {
        if (!done) next();
      })
      .catch((e: unknown) => {
        if (!res.headersSent)
          send(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      });
  };
}

export function devEndpointsPlugin(o: DevEndpointsOptions): Plugin {
  return {
    name: 'dev-endpoints',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(devEndpoints(o));
    },
  };
}
