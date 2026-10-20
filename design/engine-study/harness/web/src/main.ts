// Main thread of the browser benchmark: starts the sim Worker (as the game will run it), returns
// transferred extraction buffers, measures UI-query latency against a 60 UPS paced worker, and
// publishes the result as window.__result for Playwright.
const q = new URLSearchParams(location.search);
const logEl = document.getElementById('log') as HTMLElement;
const log = (s: string) => {
  logEl.textContent += `\n${s}`;
  console.log(s);
};

const cfg = {
  impl: q.get('impl') ?? 'ts',
  scale: q.get('scale') ?? 'mid',
  regime: q.get('regime') ?? 'busy',
  seed: Number(q.get('seed') ?? 1),
  warmup: Number(q.get('warmup') ?? 6000),
  ticks: Number(q.get('ticks') ?? 3600),
  phaseTicks: Number(q.get('phaseTicks') ?? 600),
  frames: Number(q.get('frames') ?? 120),
  noSleep: q.get('nosleep') === '1',
};
const mode = q.get('mode') ?? 'bench'; // bench | threads

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let decodeSum = 0;
const pending = new Map<number, (v: unknown) => void>();
let qid = 0;

worker.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.t === 'xfer') {
    // a stand-in for the renderer's decode: walk the records once, then hand the buffer back
    const u = new Uint32Array(m.buf, 0, m.n * 4);
    let s = 0;
    for (let i = 2; i < u.length; i += 4) s = (s + u[i]) | 0;
    decodeSum ^= s;
    worker.postMessage({ t: 'back', buf: m.buf }, [m.buf]);
  } else if (m.t === 'progress') {
    log(m.msg);
  } else if (m.t === 'res') {
    pending.get(m.id)?.(m.value);
    pending.delete(m.id);
  } else if (m.t === 'done') {
    (window as unknown as { __result: unknown }).__result = m.result;
    log('done');
  } else if (m.t === 'error') {
    (window as unknown as { __result: unknown }).__result = { error: m.error };
    log(`error: ${m.error}`);
  }
};
worker.onerror = (e) => {
  (window as unknown as { __result: unknown }).__result = { error: String(e.message) };
};

function query(kind: string, arg: number): Promise<unknown> {
  const id = ++qid;
  return new Promise((res) => {
    pending.set(id, res);
    worker.postMessage({ t: 'query', id, kind, arg });
  });
}

async function queryLatency(): Promise<Record<string, unknown>> {
  // the worker paces itself at 60 UPS (spec 10 §3.3) while we ask; latency includes waiting for the tick
  worker.postMessage({ t: 'pace', on: true });
  await new Promise((r) => setTimeout(r, 500));
  const out: Record<string, unknown> = {};
  for (const kind of ['inventory', 'tech']) {
    const lat: number[] = [];
    let bytes = 0;
    for (let k = 0; k < 120; k++) {
      const a = performance.now();
      const v = await query(kind, k * 37);
      lat.push(performance.now() - a);
      bytes = JSON.stringify(v).length;
      await new Promise((r) => setTimeout(r, 7));
    }
    lat.sort((x, y) => x - y);
    out[kind] = { n: lat.length, p50: lat[60], p90: lat[108], p99: lat[118], max: lat[119], jsonBytes: bytes };
  }
  const paced = await query('pace-stats', 0);
  worker.postMessage({ t: 'pace', on: false });
  return { ...out, paced };
}

(window as unknown as { __queryLatency: unknown }).__queryLatency = queryLatency;
worker.postMessage({ t: 'start', cfg, mode, timerProbe: true });
log(`started ${JSON.stringify(cfg)} crossOriginIsolated=${self.crossOriginIsolated}`);
