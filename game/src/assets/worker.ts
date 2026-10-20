// The asset worker (10 §9.7, a module worker beside those of §3.1): fetches atlas pages and terrain materials by
// priority (fetch with a priority hint, at most six in flight), checks their bytes and SHA-256, transcodes every KTX2
// level to the GPU format the main thread chose (Basis Universal 2.50, basis.ts), and transfers the result. It keeps
// the compressed bytes of what it delivered, at most 64 MB, so a lost WebGL context re-transcodes without refetching
// (§6.13); beyond that the HTTP cache serves. Uploads stay on the main thread. Audio decoding joins it later (§9.4).

import { loadBasis, TRANSCODER } from './worker/basis.ts';
import type { AssetRequest, FromWorker, TargetFormat, ToWorker } from './worker/protocol.ts';
import { FetchQueue, type Job } from './worker/queue.ts';
import { type BasisModule, transcodable, transcodeFile } from './worker/transcode.ts';

const CACHE_LIMIT = 64 * 1024 * 1024;

const queue = new FetchQueue();
const cache = new Map<number, Uint8Array>();
let cacheBytes = 0;
let colour: TargetFormat = 'rgba8';
let shadow: TargetFormat = 'r8';
let base = '';
let basis: Promise<BasisModule> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const post = (m: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);

function remember(id: number, bytes: Uint8Array): void {
  const old = cache.get(id);
  if (old) {
    cacheBytes -= old.byteLength;
    cache.delete(id);
  }
  cache.set(id, bytes);
  cacheBytes += bytes.byteLength;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_LIMIT) break;
    cache.delete(k);
    cacheBytes -= v.byteLength;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

function targetOf(r: AssetRequest): TargetFormat {
  if (r.codec === 'rgba8') return r.kind === 'shadow' ? 'r8' : 'rgba8';
  return r.kind === 'shadow' ? shadow : colour;
}

async function run(j: Job): Promise<void> {
  const r = j.req;
  const t0 = performance.now();
  try {
    let bytes = cache.get(r.id) ?? null;
    if (bytes === null) {
      const res = await fetch(new URL(r.url, base), {
        priority: r.priority <= 3 ? 'high' : 'low',
      } as RequestInit);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
      if (r.bytes !== undefined && bytes.byteLength !== r.bytes)
        throw new Error(`${bytes.byteLength} bytes, the manifest says ${r.bytes} (truncated?)`);
      if (r.sha256 !== undefined && (await sha256Hex(bytes)) !== r.sha256)
        throw new Error('SHA-256 mismatch');
      remember(r.id, bytes);
    }
    const t1 = performance.now();
    if (r.codec !== 'rgba8' && basis === null) basis = loadBasis();
    const b = r.codec === 'rgba8' || basis === null ? null : await basis;
    const levels = transcodeFile(b, bytes, r.codec, targetOf(r), r.fromLevel);
    const t2 = performance.now();
    queue.done(j);
    post(
      {
        t: 'file',
        id: r.id,
        format: targetOf(r),
        levels: levels.map((l) => ({ width: l.width, height: l.height, data: l.data.buffer as ArrayBuffer })),
        fromLevel: r.fromLevel,
        bytes: bytes.byteLength,
        fetchMs: t1 - t0,
        transcodeMs: t2 - t1,
      },
      levels.map((l) => l.data.buffer as ArrayBuffer),
    );
  } catch (e) {
    cache.delete(r.id);
    const delay = queue.failed(j, performance.now());
    post({
      t: 'retry',
      id: r.id,
      attempt: j.attempt,
      error: e instanceof Error ? e.message : String(e),
      delayMs: delay,
    });
  }
  pump();
}

function pump(): void {
  for (;;) {
    const j = queue.next(performance.now());
    if (j === null) break;
    void run(j);
  }
  const wake = queue.nextWake();
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (Number.isFinite(wake)) timer = setTimeout(pump, Math.max(0, wake - performance.now()) + 5);
}

// The transcoder loads at once, in parallel with the main thread's start-up; 'ready' says what it can make, so the
// renderer allocates its arrays in formats both the GPU and the transcoder support.
const t0 = performance.now();
basis = loadBasis();
basis.then(
  (B) => post({ t: 'ready', ms: performance.now() - t0, transcoder: TRANSCODER, supports: transcodable(B) }),
  (err: unknown) => {
    basis = null;
    post({ t: 'error', message: `transcoder: ${err instanceof Error ? err.message : String(err)}` });
    post({ t: 'ready', ms: performance.now() - t0, transcoder: 'none', supports: { xubc7: [], etc1s: [] } });
  },
);

self.addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.t === 'init') {
    colour = m.colour;
    shadow = m.shadow;
    base = m.base;
  } else if (m.t === 'want') {
    queue.want(m.reqs);
    pump();
  } else if (m.t === 'replay') {
    queue.again(m.ids);
    pump();
  }
});
