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
//   GET  /__bench/scenarios/<file>  the M0 benchmark scenarios (`simtool bench --write-scenarios`) for the current
//                                   inputs: a directory per key (the SHA-256 of a fresh simtool and of the prototypes
//                                   it reads), target/bench/scenarios-<key>/, written when missing into a private
//                                   directory and published whole by one rename, so a stale or half-written set is
//                                   never served, whichever server or process wrote it (the M0 exit audit #6, C9)
//   GET  /bench.html                redirects to the benchmark page, src/dev/bench.html (§10.6's URL)
// The benchmark page, the gallery it frames and their workers are served cross-origin isolated (COOP and COEP), so
// that `performance.now()` keeps its fine resolution (browsers coarsen it to 0.1–1 ms otherwise). A worker of an
// isolated page must itself carry COEP, so every response requested from those pages carries it.
// Writes (the POSTs) are taken only from this server's own pages (M0 exit audit #5, C9): the Host must be this
// machine (no DNS rebinding) and a browser's Origin and Sec-Fetch-Site must say same-origin. Bodies stream to disk
// within per-file, per-report and total limits (413 or 507, answered cleanly), at most MAX_UPLOADS at once (503).
// Dev server only (`apply: 'serve'`): a production build has none of them.
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export interface DevEndpointsOptions {
  /** The game/ directory. */
  root: string;
  /** Tests: where the files go (default `<root>/bench`), and where the scenario sets live (`<root>/target/bench`). */
  benchDir?: string;
  scenariosDir?: string;
  /** Tests: the command that writes the scenarios into a directory. */
  writeScenarios?: (dir: string) => Promise<void>;
  /** Tests: the scenarios' input key (default: build simtool, then hash it and the prototypes it reads). */
  scenarioKey?: () => Promise<string>;
  /** Tests: smaller limits. */
  limits?: Partial<Limits>;
}

/** What the endpoints accept (M0 exit audit #5). */
export interface Limits {
  /** One file of a report, a shot or a bench result: a late game's save and log fit with room to spare. */
  file: number;
  /** One report: its files and their bytes together. */
  reportFiles: number;
  reportBytes: number;
  /** Every report kept under bench/reports/: how many, and their bytes together (the user's evidence is never
   * deleted here: past these, new reports are refused with 507 until old ones are cleared). */
  reports: number;
  reportsBytes: number;
  /** Uploads at once. */
  uploads: number;
}

export const LIMITS: Limits = {
  file: 256 << 20,
  reportFiles: 32,
  reportBytes: 512 << 20,
  reports: 500,
  reportsBytes: 4 * 1024 ** 3,
  uploads: 4,
};

/** The largest body accepted (LIMITS.file). */
export const MAX_BODY = LIMITS.file;
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

/** A refusal with its HTTP status (answered as JSON; a 413 also closes the connection after the answer). */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const tooLarge = (limit: number) => new HttpError(413, `the body exceeds ${limit} bytes`);

/** The declared length, when the request declares one. */
function declared(req: IncomingMessage): number | null {
  const v = req.headers['content-length'];
  const n = v === undefined ? Number.NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A small body (JSON, a PNG) in memory, at most `limit` bytes. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const n0 = declared(req);
    if (n0 !== null && n0 > limit) {
      reject(tooLarge(limit));
      return;
    }
    const chunks: Buffer[] = [];
    let n = 0;
    let failed = false;
    const onData = (c: Buffer) => {
      n += c.length;
      if (n > limit) {
        failed = true;
        req.off('data', onData);
        chunks.length = 0;
        reject(tooLarge(limit));
        return;
      }
      chunks.push(c);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', (e) => {
      if (!failed) reject(e);
    });
  });
}

/**
 * Streams the body to `path` through a private `.part` file and one rename, at most `limit` bytes; resolves with the
 * byte count. Past the limit nothing is written and nothing more is read (413).
 */
function receive(req: IncomingMessage, path: string, limit: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const n0 = declared(req);
    if (n0 !== null && n0 > limit) {
      reject(tooLarge(limit));
      return;
    }
    const tmp = `${path}.${process.pid}-${randomBytes(4).toString('hex')}.part`;
    const out = createWriteStream(tmp);
    let n = 0;
    let done = false;
    const fail = (e: Error) => {
      if (done) return;
      done = true;
      req.unpipe(out);
      out.destroy();
      rmSync(tmp, { force: true });
      reject(e);
    };
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > limit) fail(tooLarge(limit));
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (done) return;
      try {
        renameSync(tmp, path);
        done = true;
        resolve(n);
      } catch (e) {
        fail(e as Error);
      }
    });
    req.pipe(out);
  });
}

const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d{1,5})?$/i;

/**
 * Why a write is refused, or null: it must come from this server's own pages. The Host must name this machine (a
 * page elsewhere that rebinds its DNS to 127.0.0.1 still sends its own name), and when a browser says where the
 * request comes from (Origin, Sec-Fetch-Site) it must be this origin. A request without them is a local program's.
 */
export function refusedOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host ?? '';
  if (!LOOPBACK.test(host)) return `the host ${JSON.stringify(host)} is not this machine`;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return `a request from ${origin}`;
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return `a ${site} request`;
  return null;
}

/** The files of a report directory (no temporary files) with their sizes. */
function filesOf(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.part')) continue;
    try {
      out.set(f, statSync(join(dir, f)).size);
    } catch {
      // removed meanwhile
    }
  }
  return out;
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

const run = (cmd: string, args: string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, maxBuffer: 1 << 24 }, (e, _o, err) =>
      e ? reject(new Error(`${e.message}\n${err}`)) : resolve(),
    ),
  );

const SIMTOOL = (root: string) => join(root, 'target', 'wasmdev', 'simtool');
const PROTOS = (root: string) => join(root, 'public', 'data', 'prototypes.bin');

/** `simtool bench --write-scenarios DIR` with the dev build's prototypes. */
const scenariosCmd = (root: string) => (dir: string) =>
  run(
    SIMTOOL(root),
    ['bench', '--scenario', 'none', '--protos', PROTOS(root), '--write-scenarios', dir],
    root,
  );

/** A file's SHA-256, remembered by its size and modification time. */
const hashes = new Map<string, { size: number; mtime: number; hash: string }>();
function fileHash(path: string): string {
  const st = statSync(path);
  const known = hashes.get(path);
  if (known && known.size === st.size && known.mtime === st.mtimeMs) return known.hash;
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  hashes.set(path, { size: st.size, mtime: st.mtimeMs, hash });
  return hash;
}

/**
 * The scenarios' inputs: simtool (the simulation and the bench factories; built first, so a changed source never
 * serves the old scenarios) and the prototypes it reads. The cached 30,000-chunk state is keyed by simtool itself.
 */
const scenarioKeyCmd = (root: string) => async (): Promise<string> => {
  await run('cargo', ['build', '--locked', '--profile', 'wasmdev', '-p', 'simtool'], root);
  return createHash('sha256')
    .update(fileHash(SIMTOOL(root)))
    .update(fileHash(PROTOS(root)))
    .digest('hex')
    .slice(0, 16);
};

/** The middleware, exported for tests (an http server around it). */
export function devEndpoints(
  o: DevEndpointsOptions,
): (req: IncomingMessage, res: ServerResponse, next: Next) => void {
  const bench = o.benchDir ?? join(o.root, 'bench');
  const sets = o.scenariosDir ?? join(o.root, 'target', 'bench');
  const writeScenarios = o.writeScenarios ?? scenariosCmd(o.root);
  const scenarioKey = o.scenarioKey ?? scenarioKeyCmd(o.root);
  const limits: Limits = { ...LIMITS, ...o.limits };
  let uploads = 0;
  /** The scenario set of the last `scenarios.json` request: its files come from the same set. */
  let current: string | null = null;
  const making = new Map<string, Promise<string>>();

  /** The scenario set for the current inputs, written and published whole when missing (audit #6). */
  const scenarios = async (): Promise<string> => {
    const key = await scenarioKey();
    const dir = join(sets, `scenarios-${key}`);
    if (existsSync(join(dir, 'scenarios.json'))) return dir;
    let p = making.get(key);
    if (!p) {
      p = (async () => {
        mkdirSync(sets, { recursive: true });
        const tmp = join(sets, `.scenarios-${key}-${process.pid}-${randomBytes(4).toString('hex')}`);
        try {
          await writeScenarios(tmp);
          if (!existsSync(join(tmp, 'scenarios.json'))) throw new Error('the scenarios were not written');
          try {
            renameSync(tmp, dir);
          } catch (e) {
            // another process published the same inputs' set first: theirs is as good
            if (!existsSync(join(dir, 'scenarios.json'))) throw e;
          }
          return dir;
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      })().finally(() => making.delete(key));
      making.set(key, p);
    }
    return p;
  };

  /** One write, counted against MAX uploads at once. */
  const upload = async <T>(f: () => Promise<T>): Promise<T> => {
    if (uploads >= limits.uploads)
      throw new HttpError(503, `${limits.uploads} uploads are running; try again`);
    uploads++;
    try {
      return await f();
    } finally {
      uploads--;
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const writes =
      req.method === 'POST' && (path === '/__bench' || path === '/__shot' || path.startsWith('/__report/'));
    if (writes) {
      const why = refusedOrigin(req);
      if (why !== null) throw new HttpError(403, `refused: ${why}`);
    }
    if (req.method === 'POST' && path === '/__bench') {
      const body = await upload(() => readBody(req, Math.min(64 << 20, limits.file)));
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
      const reports = join(bench, 'reports');
      const dir = join(reports, id);
      // the limits: this report's files and bytes, and every report's (a retry replaces its own file)
      const mine = filesOf(dir);
      const others = existsSync(reports)
        ? readdirSync(reports).filter((d) => d !== id && !d.startsWith('.'))
        : [];
      if (!existsSync(dir) && others.length >= limits.reports)
        throw new HttpError(
          507,
          `${limits.reports} reports are kept in bench/reports/: clear old ones first`,
        );
      if (!mine.has(file) && mine.size >= limits.reportFiles)
        throw new HttpError(413, `a report holds at most ${limits.reportFiles} files`);
      let total = 0;
      for (const d of others) for (const n of filesOf(join(reports, d)).values()) total += n;
      let own = 0;
      for (const [f, n] of mine) if (f !== file) own += n;
      const room = Math.min(limits.file, limits.reportBytes - own, limits.reportsBytes - total - own);
      if (room <= 0) throw new HttpError(507, 'bench/reports/ is full: clear old reports first');
      mkdirSync(dir, { recursive: true });
      const bytes = await upload(() => receive(req, join(dir, file), room));
      send(res, 200, { ok: true, file: `bench/reports/${id}/${file}`, bytes });
      return true;
    }
    if (req.method === 'POST' && path === '/__shot') {
      const label = url.searchParams.get('name') ?? '';
      if (label !== '' && !NAME.test(label)) {
        send(res, 400, { ok: false, error: 'a shot name is [A-Za-z0-9_.-], at most 100' });
        return true;
      }
      const body = await upload(() => readBody(req, Math.min(64 << 20, limits.file)));
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
      // the manifest decides the set (fresh for the current inputs); the files that follow come from that set
      if (file === 'scenarios.json' || current === null) current = await scenarios();
      const at = join(current, file);
      if (!existsSync(at) || !statSync(at).isFile()) {
        send(res, 404, { ok: false, error: `no ${file}` });
        return true;
      }
      res.setHeader('x-scenarios', current.slice(current.lastIndexOf('scenarios-') + 10));
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
        const status = e instanceof HttpError ? e.status : 500;
        if (res.headersSent) {
          req.destroy();
          return;
        }
        // a refused write is answered at once; the rest of its body is read and dropped (never stored), so the
        // client gets the answer on a healthy connection, which then closes
        if (req.method === 'POST') {
          res.setHeader('connection', 'close');
          req.resume();
        }
        if (status === 503) res.setHeader('retry-after', '1');
        send(res, status, { ok: false, error: e instanceof Error ? e.message : String(e) });
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
