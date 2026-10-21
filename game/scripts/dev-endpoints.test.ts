// The dev server's endpoints (10 §3.5; scripts/dev-endpoints-plugin.ts, C8), through a real HTTP server.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devEndpoints } from './dev-endpoints-plugin.ts';

let server: Server;
let base = '';
let root = '';
let writes = 0;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'pw-endpoints-'));
  mkdirSync(join(root, 'target', 'wasm-release'), { recursive: true });
  writeFileSync(
    join(root, 'target', 'wasm-release', 'sim.wasm'),
    new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]),
  );
  const mw = devEndpoints({
    root,
    writeScenarios: async (dir) => {
      writes += 1;
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'scenarios.json'), '{"scenarios":[]}');
      writeFileSync(join(dir, 'prototypes.bin'), new Uint8Array([1, 2, 3]));
    },
  });
  server = createServer((req, res) =>
    mw(req, res, () => {
      res.statusCode = 404;
      res.end('next');
    }),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('the dev endpoints', () => {
  it('POST /__bench keeps the results under bench/user-results/<date>.json, never overwriting', async () => {
    const a = await (await fetch(`${base}/__bench`, { method: 'POST', body: '{"ua":"x","sim":[1]}' })).json();
    const b = await (await fetch(`${base}/__bench`, { method: 'POST', body: '{"ua":"y"}' })).json();
    expect(a.ok && b.ok).toBe(true);
    expect(a.file).toMatch(/^bench\/user-results\/\d{4}-\d\d-\d\d\.json$/);
    expect(b.file).toMatch(/^bench\/user-results\/\d{4}-\d\d-\d\d-2\.json$/);
    expect(JSON.parse(readFileSync(join(root, a.file), 'utf8'))).toEqual({ ua: 'x', sim: [1] });
    const bad = await fetch(`${base}/__bench`, { method: 'POST', body: 'not json' });
    expect(bad.status).toBe(400);
  });

  it('POST /__report/<id>/<file> writes the bundle file by file; names are checked', async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const r = await fetch(`${base}/__report/2026-10-21T02-00-00/closures.pwlog`, { method: 'POST', body });
    expect(r.status).toBe(200);
    expect(
      new Uint8Array(readFileSync(join(root, 'bench/reports/2026-10-21T02-00-00/closures.pwlog'))),
    ).toEqual(body);
    for (const p of ['/__report/..%2Fx/a', '/__report/a/b.part', '/__report/.hidden/a'])
      expect((await fetch(`${base}${p}`, { method: 'POST', body })).status, p).toBe(400);
    // Dot segments never reach the handler as names: the URL is normalised first, and nothing is written.
    expect((await fetch(`${base}/__report/a/..`, { method: 'POST', body })).status).not.toBe(200);
  });

  it('POST /__shot keeps PNGs only', async () => {
    const r = await (await fetch(`${base}/__shot?name=night`, { method: 'POST', body: PNG })).json();
    expect(r.file).toMatch(/^bench\/shots\/.*-night\.png$/);
    expect(new Uint8Array(readFileSync(join(root, r.file)))).toEqual(PNG);
    expect((await fetch(`${base}/__shot`, { method: 'POST', body: 'GIF89a' })).status).toBe(400);
    expect((await fetch(`${base}/__shot?name=../x`, { method: 'POST', body: PNG })).status).toBe(400);
  });

  it('serves the release modules and the bench scenarios (written once, on the first request)', async () => {
    const w = await fetch(`${base}/__dev/release/sim.wasm`);
    expect(w.headers.get('content-type')).toBe('application/wasm');
    expect(new Uint8Array(await w.arrayBuffer())[1]).toBe(0x61);
    expect((await fetch(`${base}/__dev/release/gen.wasm`)).status).toBe(404);
    const [a, b] = await Promise.all([
      fetch(`${base}/__bench/scenarios/scenarios.json`),
      fetch(`${base}/__bench/scenarios/prototypes.bin`),
    ]);
    expect(await a.json()).toEqual({ scenarios: [] });
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(writes).toBe(1);
    expect((await fetch(`${base}/__bench/scenarios/missing.bin`)).status).toBe(404);
  });

  it('passes everything else on', async () => {
    expect(await (await fetch(`${base}/index.html`)).text()).toBe('next');
    expect((await fetch(`${base}/__bench`)).status).toBe(404);
  });
});
