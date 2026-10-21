// The dev server's endpoints (10 §3.5; scripts/dev-endpoints-plugin.ts, C8; the M0 exit audit's #5 and #6, C9),
// through a real HTTP server.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scratchDir } from '../test/helpers/paths.ts';
import { type DevEndpointsOptions, devEndpoints } from './dev-endpoints-plugin.ts';

interface Running {
  server: Server;
  base: string;
  port: number;
}

async function serve(o: DevEndpointsOptions): Promise<Running> {
  const mw = devEndpoints(o);
  const server = createServer((req, res) =>
    mw(req, res, () => {
      res.statusCode = 404;
      res.end('next');
    }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://127.0.0.1:${port}`, port };
}

/** A request with headers fetch will not send (Host, Sec-Fetch-Site): its status and body. */
function raw(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: Uint8Array,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (c) => {
        text += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

let root = '';
let main: Running;
let writes = 0;
let key = 'aaaa';

beforeAll(async () => {
  root = scratchDir('endpoints');
  mkdirSync(join(root, 'target', 'wasm-release'), { recursive: true });
  writeFileSync(
    join(root, 'target', 'wasm-release', 'sim.wasm'),
    new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
  );
  main = await serve({
    root,
    scenarioKey: async () => key,
    writeScenarios: async (dir) => {
      writes += 1;
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'prototypes.bin'), new Uint8Array([writes]));
      // a slow writer: a reader that came early must never see a half-written set
      await new Promise((r) => setTimeout(r, 50));
      writeFileSync(join(dir, 'scenarios.json'), JSON.stringify({ scenarios: [], key }));
    },
  });
});

afterAll(() => {
  main.server.close();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('the dev endpoints', () => {
  const base = () => main.base;

  it('POST /__bench keeps the results under bench/user-results/<date>.json, never overwriting', async () => {
    const a = await (
      await fetch(`${base()}/__bench`, { method: 'POST', body: '{"ua":"x","sim":[1]}' })
    ).json();
    const b = await (await fetch(`${base()}/__bench`, { method: 'POST', body: '{"ua":"y"}' })).json();
    expect(a.ok && b.ok).toBe(true);
    expect(a.file).toMatch(/^bench\/user-results\/\d{4}-\d\d-\d\d\.json$/);
    expect(b.file).toMatch(/^bench\/user-results\/\d{4}-\d\d-\d\d-2\.json$/);
    expect(JSON.parse(readFileSync(join(root, a.file), 'utf8'))).toEqual({ ua: 'x', sim: [1] });
    const bad = await fetch(`${base()}/__bench`, { method: 'POST', body: 'not json' });
    expect(bad.status).toBe(400);
  });

  it('POST /__report/<id>/<file> writes the bundle file by file; names are checked', async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const r = await fetch(`${base()}/__report/2026-10-21T02-00-00/closures.pwlog`, { method: 'POST', body });
    expect(r.status).toBe(200);
    expect(
      new Uint8Array(readFileSync(join(root, 'bench/reports/2026-10-21T02-00-00/closures.pwlog'))),
    ).toEqual(body);
    for (const p of ['/__report/..%2Fx/a', '/__report/a/b.part', '/__report/.hidden/a'])
      expect((await fetch(`${base()}${p}`, { method: 'POST', body })).status, p).toBe(400);
    // Dot segments never reach the handler as names: the URL is normalised first, and nothing is written.
    expect((await fetch(`${base()}/__report/a/..`, { method: 'POST', body })).status).not.toBe(200);
    // no temporary file is left behind
    expect(readdirSync(join(root, 'bench/reports/2026-10-21T02-00-00'))).toEqual(['closures.pwlog']);
  });

  it('POST /__shot keeps PNGs only', async () => {
    const r = await (await fetch(`${base()}/__shot?name=night`, { method: 'POST', body: PNG })).json();
    expect(r.file).toMatch(/^bench\/shots\/.*-night\.png$/);
    expect(new Uint8Array(readFileSync(join(root, r.file)))).toEqual(PNG);
    expect((await fetch(`${base()}/__shot`, { method: 'POST', body: 'GIF89a' })).status).toBe(400);
    expect((await fetch(`${base()}/__shot?name=../x`, { method: 'POST', body: PNG })).status).toBe(400);
  });

  it('takes writes only from its own pages: a loopback Host, a same-origin Origin and Sec-Fetch-Site', async () => {
    const body = new Uint8Array([7]);
    const host = `127.0.0.1:${main.port}`;
    const at = (id: string) => join(root, 'bench', 'reports', id);
    const ok = await raw(main.port, 'POST', '/__report/origin-ok/a', { origin: `http://${host}` }, body);
    expect(ok.status).toBe(200);
    expect(
      (await raw(main.port, 'POST', '/__report/origin-other/a', { origin: 'http://evil.example' }, body))
        .status,
    ).toBe(403);
    // DNS rebinding: a page of another name that resolves here sends its own Host (and its own Origin)
    expect(
      (
        await raw(
          main.port,
          'POST',
          '/__report/origin-rebound/a',
          { host: `evil.example:${main.port}`, origin: `http://evil.example:${main.port}` },
          body,
        )
      ).status,
    ).toBe(403);
    expect(
      (await raw(main.port, 'POST', '/__report/origin-site/a', { 'sec-fetch-site': 'cross-site' }, body))
        .status,
    ).toBe(403);
    expect((await raw(main.port, 'POST', '/__shot', { origin: 'null' }, PNG)).status).toBe(403);
    expect((await raw(main.port, 'POST', '/__bench', { origin: 'http://evil.example' }, body)).status).toBe(
      403,
    );
    for (const id of ['origin-other', 'origin-rebound', 'origin-site'])
      expect(existsSync(at(id)), id).toBe(false);
    // reads stay open (the trace page's release module)
    expect(
      (await raw(main.port, 'GET', '/__dev/release/sim.wasm', { origin: 'http://evil.example' })).status,
    ).toBe(200);
  });

  it('serves the release modules and one complete scenario set per input key (audit #6)', async () => {
    const w = await fetch(`${base()}/__dev/release/sim.wasm`);
    expect(w.headers.get('content-type')).toBe('application/wasm');
    expect(new Uint8Array(await w.arrayBuffer())[1]).toBe(0x61);
    expect((await fetch(`${base()}/__dev/release/gen.wasm`)).status).toBe(404);
    // two requests at once: one write, both answered from the complete set
    const [a, b] = await Promise.all([
      fetch(`${base()}/__bench/scenarios/scenarios.json`),
      fetch(`${base()}/__bench/scenarios/scenarios.json`),
    ]);
    expect(await a.json()).toEqual({ scenarios: [], key: 'aaaa' });
    expect(await b.json()).toEqual({ scenarios: [], key: 'aaaa' });
    expect(writes).toBe(1);
    const p = await fetch(`${base()}/__bench/scenarios/prototypes.bin`);
    expect(new Uint8Array(await p.arrayBuffer())).toEqual(new Uint8Array([1]));
    expect((await fetch(`${base()}/__bench/scenarios/missing.bin`)).status).toBe(404);
    // the same inputs again: no write
    await fetch(`${base()}/__bench/scenarios/scenarios.json`);
    expect(writes).toBe(1);
    // changed inputs (a rebuilt simtool, new prototypes): a new set, never the stale one
    key = 'bbbb';
    expect(await (await fetch(`${base()}/__bench/scenarios/scenarios.json`)).json()).toEqual({
      scenarios: [],
      key: 'bbbb',
    });
    expect(writes).toBe(2);
    const q = await fetch(`${base()}/__bench/scenarios/prototypes.bin`);
    expect(new Uint8Array(await q.arrayBuffer())).toEqual(new Uint8Array([2]));
    // a second server (another process) on the same directory reuses the published set
    const other = await serve({
      root,
      scenarioKey: async () => key,
      writeScenarios: async () => {
        throw new Error('must not write: the set exists');
      },
    });
    expect(await (await fetch(`${other.base}/__bench/scenarios/scenarios.json`)).json()).toMatchObject({
      key: 'bbbb',
    });
    other.server.close();
    // only complete sets are published: no private directories are left
    const sets = readdirSync(join(root, 'target', 'bench'));
    expect(sets.sort()).toEqual(['scenarios-aaaa', 'scenarios-bbbb']);
  });

  it('passes everything else on', async () => {
    expect(await (await fetch(`${base()}/index.html`)).text()).toBe('next');
    expect((await fetch(`${base()}/__bench`)).status).toBe(404);
  });
});

describe('the upload limits (audit #5)', () => {
  let small: Running;
  let dir = '';
  beforeAll(async () => {
    dir = scratchDir('endpoints-limits');
    small = await serve({
      root: dir,
      limits: { file: 1000, reportFiles: 3, reportBytes: 1500, reports: 2, reportsBytes: 2600, uploads: 1 },
    });
  });
  afterAll(() => small.server.close());
  const post = (path: string, body: BodyInit, init: RequestInit = {}) =>
    fetch(`${small.base}${path}`, { method: 'POST', body, ...init });
  const reports = () => join(dir, 'bench', 'reports');

  it('refuses a file over its limit with 413, declared or streamed, and stores nothing', async () => {
    const declared = await post('/__report/r1/big', new Uint8Array(1001));
    expect(declared.status).toBe(413);
    expect((await declared.json()).error).toMatch(/exceeds 1000 bytes/);
    // a chunked body that grows past the limit
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 12; i++) c.enqueue(new Uint8Array(100));
        c.close();
      },
    });
    const streamed = await post('/__report/r1/streamed', stream, { duplex: 'half' } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(existsSync(join(reports(), 'r1', 'big'))).toBe(false);
    expect(existsSync(join(reports(), 'r1', 'streamed'))).toBe(false);
    expect(readdirSync(join(reports(), 'r1')).filter((f) => f.endsWith('.part'))).toEqual([]);
  });

  it("limits a report's files and bytes; a retry replaces its own file", async () => {
    for (const f of ['a', 'b', 'c'])
      expect((await post(`/__report/r1/${f}`, new Uint8Array(400))).status).toBe(200);
    expect((await post('/__report/r1/d', new Uint8Array(10))).status).toBe(413);
    // a retry of b: its own 400 bytes are free again, so up to 700 fit (1500 − a − c)
    expect((await post('/__report/r1/b', new Uint8Array(700))).status).toBe(200);
    expect((await post('/__report/r1/c', new Uint8Array(500))).status).toBe(413);
    expect(readFileSync(join(reports(), 'r1', 'c')).length).toBe(400);
  });

  it('limits all reports together: their count and their bytes (507)', async () => {
    expect((await post('/__report/r2/a', new Uint8Array(900))).status).toBe(200);
    // 1,500 in r1 and 900 in r2: 200 left in all
    expect((await post('/__report/r2/b', new Uint8Array(300))).status).toBe(413);
    expect((await post('/__report/r2/b', new Uint8Array(100))).status).toBe(200);
    expect((await post('/__report/r3/a', new Uint8Array(10))).status).toBe(507);
  });

  it('runs one upload at a time here and answers another with 503 and Retry-After', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(new Uint8Array(10));
        await gate;
        c.close();
      },
    });
    const first = post('/__shot', slow, { duplex: 'half' } as RequestInit);
    await new Promise((r) => setTimeout(r, 100));
    const second = await post('/__shot', new Uint8Array(PNG));
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('1');
    release();
    expect((await first).status).toBe(400); // not a PNG, but it was the one let in
  });
});
