// The asset loader and worker (10 §9.2, §9.7): the request queue's rules, KTX2 parsing, transcoding with the
// vendored Basis Universal 2.50 transcoder (which runs in Node as in the worker), and the loader's requests, levels and
// readiness against a stand-in worker.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssetLoader, type LoadedFile, type LoaderManifest } from '../../src/assets/loader.ts';
import { readKtx2Header, rgba8Levels } from '../../src/assets/worker/ktx2.ts';
import {
  type AssetRequest,
  type FromWorker,
  PRIORITY,
  type ToWorker,
} from '../../src/assets/worker/protocol.ts';
import { FetchQueue, MAX_IN_FLIGHT } from '../../src/assets/worker/queue.ts';
import { type BasisModule, transcodable, transcodeFile } from '../../src/assets/worker/transcode.ts';
import { GAME } from '../helpers/paths.ts';

const SPRITES = join(GAME, 'test', 'fixtures', 'sprites');
const ATLASES = join(GAME, 'public', 'atlases');
const req = (id: number, priority: number, level0 = false): AssetRequest => ({
  id,
  url: `f${id}`,
  priority,
  kind: 'colour',
  codec: 'xubc7',
  fromLevel: 0,
  level0,
});

describe('the request queue (10 §9.7 "Priorities", "Retries")', () => {
  it('starts the lowest class first, in arrival order, at most six at once', () => {
    const q = new FetchQueue();
    q.want([
      req(1, PRIORITY.prefetch),
      req(2, PRIORITY.core),
      req(3, PRIORITY.core),
      req(4, PRIORITY.groups),
    ]);
    const order: number[] = [];
    for (let j = q.next(0); j; j = q.next(0)) order.push(j.req.id);
    expect(order).toEqual([2, 3, 4, 1]);
    const q2 = new FetchQueue();
    q2.want(Array.from({ length: 10 }, (_, i) => req(i + 1, PRIORITY.core)));
    let n = 0;
    while (q2.next(0)) n++;
    expect(n).toBe(MAX_IN_FLIGHT);
  });

  it('starts nothing of a lower class while a missing page (class 1) waits', () => {
    const q = new FetchQueue();
    q.want([req(1, PRIORITY.core), req(2, PRIORITY.missing)]);
    expect(q.next(0)?.req.id).toBe(2);
    q.want([req(3, PRIORITY.missing)]);
    expect(q.next(0)?.req.id).toBe(3);
    expect(q.next(0)?.req.id).toBe(1);
  });

  it('gives High level 0 at most two connections while any Normal file is missing', () => {
    const q = new FetchQueue();
    q.want([
      req(1, PRIORITY.level0, true),
      req(2, PRIORITY.level0, true),
      req(3, PRIORITY.level0, true),
      req(9, PRIORITY.idle),
    ]);
    const started = [q.next(0), q.next(0), q.next(0)].map((j) => j?.req.id);
    expect(started).toEqual([1, 2, 9]);
    expect(q.next(0)).toBeNull();
  });

  it('retries after 1, 2, 4 and 8 s, then every 30 s, keeping the priority', () => {
    const q = new FetchQueue();
    q.want([req(1, PRIORITY.core)]);
    const delays: number[] = [];
    let now = 0;
    for (let i = 0; i < 6; i++) {
      const j = q.next(now);
      expect(j?.req.id).toBe(1);
      const d = q.failed(j as NonNullable<typeof j>, now);
      delays.push(d);
      expect(q.next(now + d - 1)).toBeNull();
      now += d;
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 30000, 30000]);
    expect(q.jobs.get(1)?.req.priority).toBe(PRIORITY.core);
  });
});

describe('KTX2 and transcoding (10 §9.2)', () => {
  it('reads the fixture pages: uncompressed RGBA8 and R8, linear transfer, premultiplied except shadows', () => {
    const colour = new Uint8Array(readFileSync(join(SPRITES, 'colour-core-0.h.ktx2')));
    const h = readKtx2Header(colour);
    expect([h.vkFormat, h.width, h.levels, h.supercompression, h.transfer, h.flags]).toEqual([
      37, 512, 1, 0, 1, 1,
    ]);
    const lv = rgba8Levels(colour, 0);
    expect(lv[0]?.data.length).toBe(512 * 512 * 4);
    const shadow = readKtx2Header(new Uint8Array(readFileSync(join(SPRITES, 'shadow-core-0.ktx2'))));
    expect([shadow.vkFormat, shadow.flags]).toEqual([9, 0]);
    expect(() => readKtx2Header(colour.slice(0, 50))).toThrow();
  });

  it('passes rgba8 files through for RGBA8 and R8 targets', () => {
    const shadow = new Uint8Array(readFileSync(join(SPRITES, 'shadow-core-0.ktx2')));
    const lv = transcodeFile(null, shadow, 'rgba8', 'r8', 0);
    expect(lv[0]?.width).toBe(256);
    expect(lv[0]?.data.length).toBe(256 * 256);
  });

  // the glue is a classic script, evaluated as the worker does (game/ is "type": "module", so require() would
  // load it as an ES module without exports); in Node it reads the .wasm beside it with fs
  const basis = (() => {
    try {
      const dir = join(GAME, 'src', 'assets', 'worker', 'basis');
      const glue = readFileSync(join(dir, 'basis_transcoder.js'), 'utf8');
      const factory = new Function('require', '__dirname', `${glue}\nreturn BASIS;`);
      return factory(createRequire(import.meta.url), dir) as (a?: object) => Promise<BasisModule>;
    } catch {
      return null;
    }
  })();
  const page = (prefix: string, suffix: string) => {
    try {
      const m = JSON.parse(readFileSync(join(ATLASES, 'sprites.json'), 'utf8')) as LoaderManifest;
      for (const a of m.pages)
        for (const p of a) for (const f of p.files) if (f.includes(prefix) && f.endsWith(suffix)) return f;
    } catch {
      /* no build */
    }
    return null;
  };

  it('transcodes the real atlas: XUBC7 to BC7, ASTC, BC3, ETC2, RGBA8; ETC1S to BC4 and R8 (not EAC R11)', async () => {
    const n = page('colour-core-0', '.n.ktx2');
    const s = page('shadow-core-0', '.ktx2');
    if (!basis || !n || !s) return; // `npm run assets` has not run
    const B = await basis();
    B.initializeBasis();
    const colour = new Uint8Array(readFileSync(join(GAME, 'public', n)));
    for (const [f, bytes] of [
      ['bc7', 1],
      ['astc', 1],
      ['bc3', 1],
      ['etc2', 1],
      ['rgba8', 4],
    ] as const) {
      const lv = transcodeFile(B, colour, 'xubc7', f, 0);
      expect(lv.map((l) => l.width)).toEqual([1024, 512, 256]);
      expect(lv[0]?.data.length).toBe(1024 * 1024 * bytes);
    }
    // a mode without the Normal page's first level skips it
    expect(transcodeFile(B, colour, 'xubc7', 'bc7', 1).map((l) => l.width)).toEqual([512, 256]);
    const shadow = new Uint8Array(readFileSync(join(GAME, 'public', s)));
    for (const [f, bytes] of [
      ['bc4', 0.5],
      ['r8', 1],
    ] as const)
      expect(transcodeFile(B, shadow, 'etc1s', f, 0)[0]?.data.length).toBe(1024 * 1024 * bytes);
    expect(() => transcodeFile(B, shadow, 'xubc7', 'bc7', 0)).toThrow(/XUBC7/);
    // the stock 2.50 build cannot make EAC R11 from ETC1S: the worker says so, and the renderer skips it
    const can = transcodable(B);
    expect(can.xubc7).toEqual(expect.arrayContaining(['bc7', 'astc', 'bc3', 'etc2', 'rgba8']));
    expect(can.etc1s).toContain('bc4');
    expect(can.etc1s).not.toContain('eac_r11');
    expect(() => transcodeFile(B, shadow, 'etc1s', 'eac_r11', 0)).toThrow();
  }, 60_000);
});

/** A stand-in for the worker: records what the loader posts and lets the test answer. */
class FakeWorker extends EventTarget {
  readonly sent: ToWorker[] = [];
  postMessage(m: ToWorker): void {
    this.sent.push(m);
  }
  answer(m: FromWorker): void {
    this.dispatchEvent(new MessageEvent('message', { data: m }));
  }
  wanted(): AssetRequest[] {
    return this.sent.flatMap((m) => (m.t === 'want' ? m.reqs : []));
  }
}

describe('the asset loader (10 §9.7)', () => {
  const manifest = JSON.parse(readFileSync(join(SPRITES, 'manifest.json'), 'utf8')) as LoaderManifest;
  const make = (offsets = [0, 0, 0, 0]) => {
    const w = new FakeWorker();
    const files: LoadedFile[] = [];
    const loader = new AssetLoader({
      worker: w as unknown as Worker,
      manifest,
      base: 'http://x/',
      colour: 'rgba8',
      shadow: 'r8',
      levelOffset: offsets,
      terrainOffset: 0,
      terrainTiles: [],
      onFile: (f) => files.push(f),
    });
    return { w, files, loader };
  };

  it('asks for every Normal file at start (core first), and for no High level 0', () => {
    const { w, loader } = make();
    loader.start();
    expect(w.sent[0]).toMatchObject({ t: 'init', colour: 'rgba8', shadow: 'r8' });
    const reqs = w.wanted();
    expect(reqs.map((r) => r.url).sort()).toEqual(
      ['colour-core-0.n.ktx2', 'icon-core-0.ktx2', 'light-core-0.ktx2', 'shadow-core-0.ktx2'].sort(),
    );
    expect(reqs.every((r) => r.priority === PRIORITY.core && !r.level0)).toBe(true);
  });

  it('moves missed pages to the front and asks for level 0 of pages drawn at k > 0.5', () => {
    const { w, loader } = make();
    loader.start();
    w.sent.length = 0;
    loader.update([1 << 16], [0]);
    const reqs = w.wanted();
    expect(reqs.find((r) => r.url === 'shadow-core-0.ktx2')?.priority).toBe(PRIORITY.missing);
    const h = reqs.find((r) => r.url === 'colour-core-0.h.ktx2');
    expect(h).toMatchObject({ priority: PRIORITY.level0, level0: true });
    // asked once
    w.sent.length = 0;
    loader.update([], [0]);
    expect(w.wanted()).toEqual([]);
  });

  it('hands files to the renderer at their page level, and is ready when core is delivered', async () => {
    const { w, files, loader } = make([1, 1, 0, 0]);
    loader.start();
    const reqs = w.wanted();
    // a Normal mode: the colour page's Normal file starts at level 1, the shadow skips its level 0
    expect(reqs.find((r) => r.url === 'shadow-core-0.ktx2')?.fromLevel).toBe(1);
    let ready = false;
    void loader.ready().then(() => {
      ready = true;
    });
    for (const r of reqs) {
      w.answer({
        t: 'file',
        id: r.id,
        format: 'rgba8',
        levels: [{ width: 4, height: 4, data: new ArrayBuffer(64) }],
        fromLevel: r.fromLevel,
        bytes: 10,
        fetchMs: 1,
        transcodeMs: 1,
      });
      await Promise.resolve();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(ready).toBe(true);
    const colour = files.find((f) => f.array === 0);
    expect(colour?.firstLevel).toBe(1);
    expect(files.find((f) => f.array === 1)?.firstLevel).toBe(1);
    // after a lost context: every delivered file again
    w.sent.length = 0;
    loader.replay();
    expect(w.sent[0]).toMatchObject({ t: 'replay' });
    expect((w.sent[0] as { ids: number[] }).ids.length).toBe(reqs.length);
  });
});
