// The dev server's generators (C1a-r1 findings 14, 15): requests wait for every running generator; a
// failed run makes the requests it affects fail with its error, and new connections get the overlay,
// until a run succeeds; a generator re-runs after the one it follows; the data stage watches its code.
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { GAME, scratchDir } from '../test/helpers/paths.ts';
import { dataStageWatched } from './data-stage-plugin.ts';
import { idle, resetGenerators } from './dev-generators.ts';
import { watchRunPlugin } from './watch-run-plugin.ts';

type Middleware = (req: { url: string }, res: FakeRes, next: () => void) => unknown;

class FakeRes {
  statusCode = 200;
  body = '';
  headers: Record<string, string> = {};
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  end(b?: string) {
    this.body = b ?? '';
  }
}

function fakeServer() {
  const watcher = Object.assign(new EventEmitter(), { add: () => {} });
  const middlewares: Middleware[] = [];
  const sent: { type: string; err?: { message: string } }[] = [];
  const handlers = new Map<string, () => void>();
  const server = {
    watcher,
    middlewares: { use: (m: Middleware) => middlewares.push(m) },
    ws: {
      send: (p: { type: string }) => sent.push(p),
      on: (e: string, cb: () => void) => handlers.set(e, cb),
    },
    config: { logger: { info: () => {}, error: () => {} } },
    moduleGraph: { getModuleById: () => undefined, invalidateModule: () => {} },
  };
  const request = async (url: string) => {
    const res = new FakeRes();
    let passed = false;
    for (const m of middlewares) {
      let next = false;
      await m({ url }, res, () => {
        next = true;
      });
      if (!next) return { res, passed };
    }
    passed = true;
    return { res, passed };
  };
  return { server, sent, handlers, watcher, request };
}

const configure = (plugin: ReturnType<typeof watchRunPlugin>, server: unknown) =>
  (plugin.configureServer as (s: unknown) => void).call({}, server);
const settle = async () => {
  await new Promise((r) => setTimeout(r, 300));
  await idle();
};

describe('the dev generators', () => {
  beforeEach(() => resetGenerators());

  it('fail held requests with the error after a failed run, until a run succeeds', async () => {
    const dir = scratchDir('gen');
    const script = join(dir, 'gen.mjs');
    const input = join(dir, 'input.yaml');
    writeFileSync(script, 'process.stderr.write("boom: bad data"); process.exit(1);\n');
    const plugin = watchRunPlugin({
      name: 'data-stage',
      root: dir,
      script: 'gen.mjs',
      watched: [input],
      holdPrefixes: ['/data/'],
    });
    const f = fakeServer();
    configure(plugin, f.server);
    await idle();
    const failedRun = await f.request('/data/prototypes.json');
    expect(failedRun.res.statusCode).toBe(503);
    expect(failedRun.res.body).toMatch('boom: bad data');
    expect((await f.request('/other')).passed).toBe(true);
    f.sent.length = 0;
    f.handlers.get('connection')?.();
    expect(f.sent[0]?.err?.message).toMatch('boom: bad data');
    writeFileSync(script, 'process.exit(0);\n');
    f.watcher.emit('change', input);
    await settle();
    expect((await f.request('/data/prototypes.json')).passed).toBe(true);
    f.sent.length = 0;
    f.handlers.get('connection')?.();
    expect(f.sent).toEqual([]);
  });

  it('runs a follower after its leader succeeds, and holds requests meanwhile', async () => {
    const dir = scratchDir('gen');
    writeFileSync(join(dir, 'leader.mjs'), 'process.exit(0);\n');
    writeFileSync(
      join(dir, 'follower.mjs'),
      'import { appendFileSync } from "node:fs"; appendFileSync("runs.txt", "x"); await new Promise((r) => setTimeout(r, 200));\n',
    );
    const leader = watchRunPlugin({
      name: 'schema-gen',
      root: dir,
      script: 'leader.mjs',
      watched: [join(dir, 'schema')],
    });
    const follower = watchRunPlugin({
      name: 'data-stage',
      root: dir,
      script: 'follower.mjs',
      watched: [],
      holdPrefixes: ['/data/'],
      follows: ['schema-gen'],
    });
    const f = fakeServer();
    configure(follower, f.server);
    configure(leader, f.server);
    await settle();
    const { readFileSync } = await import('node:fs');
    // Once at start, once more after the leader's success.
    expect(readFileSync(join(dir, 'runs.txt'), 'utf8')).toBe('xx');
    expect((await f.request('/data/x')).passed).toBe(true);
  });

  it('watches the data stage’s own code and the schema identity', () => {
    const w = dataStageWatched(GAME);
    for (const p of [
      'scripts/data-stage',
      'scripts/data-stage.ts',
      'scripts/lib',
      'scripts/build-manifest.ts',
      'src/shared/gen/schema.ts',
      'data/engine',
    ])
      expect(w).toContain(join(GAME, p));
  });
});
