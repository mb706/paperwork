// bench.html (10 §10.6 "Calibration with the user's laptop"; C8): the page the user opens through the tunnel once per
// milestone (`http://127.0.0.1:5173/bench.html`, which the dev server redirects here). It measures, on that machine:
//   - the simulation: §10.6's M0 scenarios through sim.wasm in a module worker (src/dev/bench/worker.ts, the core the
//     Node runner shares), against the reference-machine thresholds (the user's laptop is the reference class);
//   - determinism: the golden set's log and the 10,000-tick session replayed in this browser, every d_t against the
//     natively recorded digests and the final state hash (D18 d on browsers this host cannot run, §13);
//   - render: §6.12's frame-cost scenes (C4's gallery bench scene in a 1920 × 1080 frame): the main thread's frame,
//     the GPU's time (EXT_disjoint_timer_query_webgl2 where offered, else a 1 × 1 readPixels drain), and the frame
//     rate under requestAnimationFrame;
//   - audio: §9.4's gate, Eras I and II with a factory's SFX rendered offline at 32 kHz (C7's engine);
//   - the GPU: the WebGL2 renderer, limits, extensions and §9.2's per-format probe.
// It POSTs everything to `/__bench` (bench/user-results/<date>.json); `node bench/calibrate.ts` turns it into the host
// factor. Query parameters: `?auto=all|sim,det,…` runs at load (Playwright's browser runner, e2e/bench.spec.ts);
// `quick=1` the quick plan; `post=0` keeps the results on the page; `module=dev` uses the dev server's module instead
// of the release one; `ab=1&pairs=N` is the paired A/B of two modules (/__ab/a.wasm, /__ab/b.wasm), interleaved in
// alternating order within this one session (IMPL-3).
import { type OfflineDeps, renderOffline } from '../audio/offline.ts';
import bankUrl from '../audio/worklet/bank.ts?worker&url';
import { FORMATS, probeFormats } from '../render/gl/formats.ts';
import { hexOf, sha256 } from '../shared/sha256.ts';
import {
  type BenchManifest,
  type BenchScenario,
  planProblem,
  type ScenarioResult,
  type Verdict,
  verdicts,
} from './bench/sim-core.ts';
import type { BenchJob } from './bench/worker.ts';

const params = new URLSearchParams(location.search);
const quick = params.get('quick') === '1';
const postResults = params.get('post') !== '0';
const abMode = params.get('ab') === '1';
const pairs = Math.max(1, Number(params.get('pairs') ?? 3));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status');
const say = (s: string) => {
  statusEl.textContent = s;
};

// ------------------------------------------------------------------------------------------------- results

interface SimRow {
  scenario: string;
  metrics: Record<string, number>;
  verdicts: Verdict[];
  seconds: number;
  memory_bytes: number;
  /** The ticks simulated, and why they are not the plan's (null: the plan ran whole; the M0 exit audit #8). */
  ticks: number;
  planProblem: string | null;
}
interface TraceRowOut {
  log: string;
  ticks: number;
  identical: boolean;
  firstDifferingTick: number | null;
  finalHash: string;
  expectedHash: string;
  finalR: string;
  expectedR: string;
  ms: number;
}
interface RenderRow {
  scene: string;
  sprites: number;
  beltItems: number;
  mainMs: { median: number; p95: number };
  gpuMs: { median: number; p95: number; method: 'timer-query' | 'readpixels-drain' };
  packetMs: number;
  raf: { fps: number; intervalMedianMs: number; intervalP95Ms: number; seconds: number };
  budget: { mainMs: number; gpuMs: number; fps: number };
  met: { main: boolean; gpu: boolean; fps: boolean };
}
interface AudioRow {
  piece: string;
  meanPercent: number;
  worstSecondPercent: number;
  seconds: number;
  met: boolean;
}
export interface BenchResults {
  version: 1;
  time: string;
  url: string;
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
  screen: { width: number; height: number; dpr: number };
  crossOriginIsolated: boolean;
  timerResolutionMs: number | null;
  module: { url: string; sha256: string; bytes: number } | null;
  sim?: { quick: boolean; rows: SimRow[] };
  determinism?: TraceRowOut[];
  render?: RenderRow[];
  audio?: AudioRow[];
  gpu?: Record<string, unknown>;
  ab?: Record<string, unknown>;
  errors: string[];
}

const results: BenchResults = {
  version: 1,
  time: new Date().toISOString(),
  url: location.href,
  userAgent: navigator.userAgent,
  platform:
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform,
  hardwareConcurrency: navigator.hardwareConcurrency,
  deviceMemoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
  screen: { width: screen.width, height: screen.height, dpr: devicePixelRatio },
  crossOriginIsolated: globalThis.crossOriginIsolated === true,
  timerResolutionMs: null,
  module: null,
  errors: [],
};

function showJson(): void {
  $('json').textContent = JSON.stringify(results, null, 1);
}

function table(head: string[], rows: (string | number)[][], cls?: (r: number, c: number) => string): string {
  const cell = (v: string | number, r: number, c: number) =>
    `<td class="${typeof v === 'number' ? 'num' : ''} ${cls?.(r, c) ?? ''}">${typeof v === 'number' ? fmt(v) : v}</td>`;
  return `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows
    .map((row, r) => `<tr>${row.map((v, c) => cell(v, r, c)).join('')}</tr>`)
    .join('')}</table>`;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 0.1) return v.toFixed(3);
  return v.toPrecision(3);
}

// ------------------------------------------------------------------------------------------------- helpers

async function bytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * The module the benchmarks run: the release build (what players get), else the dev server's (simcheck, slower);
 * the results name the one that ran, so `bench/calibrate.ts` compares like with like.
 */
async function benchModule(
  url?: string,
): Promise<{ module: WebAssembly.Module; url: string; sha: string; n: number }> {
  const tryUrls = url
    ? [url]
    : params.get('module') === 'dev'
      ? ['/__wasm/sim.wasm']
      : ['/__dev/release/sim.wasm', '/__wasm/sim.wasm'];
  let lastErr: unknown = null;
  for (const u of tryUrls) {
    try {
      const b = await bytes(u);
      return { module: await WebAssembly.compile(b), url: u, sha: hexOf(sha256(b)), n: b.length };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function job<T>(j: BenchJob): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./bench/worker.ts', import.meta.url), { type: 'module', name: 'bench' });
    w.onmessage = (e: MessageEvent<{ ok: boolean; error?: string } & T>) => {
      w.terminate();
      if (e.data.ok) resolve(e.data);
      else reject(new Error(e.data.error ?? 'the worker failed'));
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(`worker: ${e.message}`));
    };
    w.postMessage(j);
  });
}

async function scenarioFiles(sc: BenchScenario): Promise<Record<string, Uint8Array>> {
  const names = ['prototypes.bin', sc.state, sc.log, sc.subs, sc.view].filter((x): x is string => !!x);
  const out: Record<string, Uint8Array> = {};
  for (const n of names) out[n] = await bytes(`/__bench/scenarios/${n}`);
  return out;
}

async function manifest(): Promise<BenchManifest> {
  return JSON.parse(
    new TextDecoder().decode(await bytes('/__bench/scenarios/scenarios.json')),
  ) as BenchManifest;
}

interface SimReply {
  result: ScenarioResult;
  seconds: number;
  timerResolutionMs: number;
  isolated: boolean;
}

// ------------------------------------------------------------------------------------------------- sections

async function runSim(): Promise<void> {
  say('simulation: preparing the scenarios (the dev server writes them on first use)…');
  const m = await manifest();
  const mod = await benchModule();
  results.module = { url: mod.url, sha256: mod.sha, bytes: mod.n };
  const rows: SimRow[] = [];
  for (const sc of m.scenarios) {
    say(`simulation: ${sc.name}…`);
    const files = await scenarioFiles(sc);
    const r = await job<SimReply>({ kind: 'sim', module: mod.module, files, scenario: sc, quick });
    results.timerResolutionMs = r.timerResolutionMs;
    const problem = planProblem(sc, r.result, quick);
    if (problem) results.errors.push(problem);
    rows.push({
      scenario: sc.name,
      metrics: r.result.metrics,
      verdicts: verdicts(quick ? sc.budgets : sc.thresholds, r.result, 1),
      seconds: r.seconds,
      memory_bytes: r.result.memory_bytes,
      ticks: r.result.ticks,
      planProblem: problem,
    });
    results.sim = { quick, rows };
    renderSim();
  }
}

function renderSim(): void {
  const rows = results.sim?.rows ?? [];
  const out: (string | number)[][] = [];
  const cls: string[] = [];
  for (const r of rows)
    for (const v of r.verdicts) {
      out.push([
        r.scenario,
        v.metric,
        v.value ?? 'native only',
        `${v.floor ? '≥' : '≤'} ${v.limit} ${v.unit}`,
        v.met === null ? '' : v.met ? 'met' : 'MISSED',
      ]);
      cls.push(v.met === false ? 'missed' : 'met');
    }
  $('out-sim').innerHTML =
    `${table(['scenario', 'metric', 'measured', 'reference', ''], out, (r, c) => (c === 4 ? (cls[r] ?? '') : ''))}` +
    `<div>timer resolution ${results.timerResolutionMs ?? '?'} ms; module ${results.module?.url ?? '?'} (${results.module?.sha256.slice(0, 12) ?? ''})</div>`;
}

/** The logs whose natively recorded digests this browser must reproduce. */
const TRACE_LOGS = [
  {
    log: 'golden',
    start: '/test/golden/m0/start.save',
    pwlog: '/test/golden/m0/closure-log.pwlog',
    expect: '/test/golden/m0/states/hashes.txt',
  },
  {
    log: 'm0-cross-engine-10k',
    start: '/test/logs/m0-cross-engine-10k.start',
    pwlog: '/test/logs/m0-cross-engine-10k.pwlog',
    expect: '/test/logs/m0-cross-engine-10k.txt',
  },
];

async function runDeterminism(): Promise<void> {
  const mod = await benchModule();
  const protos = await bytes('/test/golden/m0/protos/prototypes.bin');
  const rows: TraceRowOut[] = [];
  for (const t of TRACE_LOGS) {
    say(`determinism: ${t.log}…`);
    const [start, log, expectText] = await Promise.all([
      bytes(t.start),
      bytes(t.pwlog),
      bytes(t.expect).then((b) => new TextDecoder().decode(b)),
    ]);
    // golden: `tick 3600 <hash> r <r> …` (states/hashes.txt); a session: `… state <hash> r <r>`
    const m =
      /tick 3600 ([0-9a-f]{16}) r ([0-9a-f]{16})/.exec(expectText) ??
      /state ([0-9a-f]{16}) r ([0-9a-f]{16})/.exec(expectText);
    const r = await job<{
      trace: { ticks: number; logMismatch: number | null; finalHash: string; finalR: string; ms: number };
    }>({ kind: 'trace', module: mod.module, protos, start, log });
    const want = { hash: m?.[1] ?? '?', r: m?.[2] ?? '?' };
    rows.push({
      log: t.log,
      ticks: r.trace.ticks,
      identical: r.trace.logMismatch === null && r.trace.finalHash === want.hash && r.trace.finalR === want.r,
      firstDifferingTick: r.trace.logMismatch,
      finalHash: r.trace.finalHash,
      expectedHash: want.hash,
      finalR: r.trace.finalR,
      expectedR: want.r,
      ms: r.trace.ms,
    });
    results.determinism = rows;
    $('out-det').innerHTML = table(
      ['log', 'ticks', 'identical to native', 'state hash', 'ms'],
      rows.map((x) => [
        x.log,
        x.ticks,
        x.identical ? 'yes' : `NO (tick ${x.firstDifferingTick ?? 'end'})`,
        x.finalHash,
        x.ms,
      ]),
      (row, c) => (c === 2 ? (rows[row]?.identical ? 'met' : 'missed') : ''),
    );
  }
}

/** §6.12's rows: the scene, its gallery query and its budgets (main thread, GPU, frame rate). */
const SCENES: { scene: string; query: string; mainMs: number; gpuMs: number; fps: number }[] = [
  { scene: '1× slice base', query: 'zoom=1&entities=700&items=2000&w=60&h=34', mainMs: 4, gpuMs: 6, fps: 60 },
  { scene: '1× mid base', query: 'zoom=1&entities=2040&items=8160&w=60&h=34', mainMs: 6, gpuMs: 10, fps: 60 },
  {
    scene: '0.3× late base',
    query: 'zoom=0.3&entities=8000&items=60000&w=200&h=113',
    mainMs: 12,
    gpuMs: 25,
    fps: 30,
  },
];

/** The gallery's window, as this page drives it (src/dev/gallery.ts, src/app/world-view.ts's `__render`). */
interface GalleryWindow {
  performance: Performance;
  requestAnimationFrame(cb: FrameRequestCallback): number;
  __gallery?: { ready: Promise<void>; error?: string; tick?: Uint8Array };
  __render?: {
    renderer: {
      frame(): boolean;
      gl: WebGL2RenderingContext | null;
      timing: boolean;
    };
    stats(): { frame: { total: number; build: number; submit: number; sprites: number; beltItems: number } };
    world: { applyPacket(b: Uint8Array): void };
  };
}

/** The median (the mean of the middle two of an even count). */
const med = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
};
const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0;
};

async function measureScene(w: GalleryWindow): Promise<Omit<RenderRow, 'scene' | 'budget' | 'met'>> {
  const h = w.__render;
  if (!h) throw new Error('the gallery has no renderer');
  const r = h.renderer;
  const gl = r.gl;
  if (!gl) throw new Error('no WebGL2 in the gallery');
  const px = new Uint8Array(4);
  const drain = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  r.timing = true;
  for (let i = 0; i < 30; i++) {
    r.frame();
    drain();
  }
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  const main: number[] = [];
  const all: number[] = [];
  const queries: WebGLQuery[] = [];
  for (let i = 0; i < 60; i++) {
    const q = tq ? gl.createQuery() : null;
    if (q && tq) gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    const t0 = w.performance.now();
    r.frame();
    if (q && tq) gl.endQuery(tq.TIME_ELAPSED_EXT);
    main.push(h.stats().frame.total);
    drain();
    all.push(w.performance.now() - t0);
    if (q) queries.push(q);
  }
  let gpu: number[] = [];
  let method: 'timer-query' | 'readpixels-drain' = 'readpixels-drain';
  if (tq && queries.length > 0) {
    for (let k = 0; k < 120; k++) {
      const last = queries[queries.length - 1] as WebGLQuery;
      if (gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) break;
      await new Promise((res) => w.requestAnimationFrame(res));
    }
    const disjoint = gl.getParameter(tq.GPU_DISJOINT_EXT) as boolean;
    if (!disjoint) {
      gpu = queries
        .filter((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))
        .map((q) => (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
      if (gpu.length > 0) method = 'timer-query';
    }
    for (const q of queries) gl.deleteQuery(q);
  }
  if (method === 'readpixels-drain') gpu = all.map((t, i) => Math.max(0, t - (main[i] ?? 0)));
  // A steady tick's packet (the BELT_ITEMS snapshot) applied beside the frame (§6.12's main thread).
  const tick = w.__gallery?.tick;
  const packets: number[] = [];
  if (tick)
    for (let i = 0; i < 30; i++) {
      const t0 = w.performance.now();
      h.world.applyPacket(tick);
      packets.push(w.performance.now() - t0);
    }
  // Presented frames: requestAnimationFrame for 3 s, a frame drawn in each.
  r.timing = false;
  const intervals: number[] = [];
  const seconds = 3;
  await new Promise<void>((done) => {
    let prev = 0;
    let start = 0;
    const loop = (t: number) => {
      if (start === 0) start = t;
      else intervals.push(t - prev);
      prev = t;
      r.frame();
      if (t - start < seconds * 1000) w.requestAnimationFrame(loop);
      else done();
    };
    w.requestAnimationFrame(loop);
  });
  const s = h.stats().frame;
  const total = intervals.reduce((a, b) => a + b, 0);
  return {
    sprites: s.sprites,
    beltItems: s.beltItems,
    mainMs: { median: med(main), p95: p95(main) },
    gpuMs: { median: med(gpu), p95: p95(gpu), method },
    packetMs: packets.length ? med(packets) : 0,
    raf: {
      fps: intervals.length / (total / 1000),
      intervalMedianMs: med(intervals),
      intervalP95Ms: p95(intervals),
      seconds,
    },
  };
}

async function runRender(): Promise<void> {
  const rows: RenderRow[] = [];
  for (const sc of SCENES) {
    say(`render: ${sc.scene}…`);
    const frame = document.createElement('iframe');
    frame.id = 'stage';
    frame.src = `/src/dev/gallery.html?clean=1&scene=bench&${sc.query}`;
    document.body.append(frame);
    try {
      await new Promise<void>((res, rej) => {
        frame.onload = () => res();
        frame.onerror = () => rej(new Error('the gallery did not load'));
      });
      const w = frame.contentWindow as unknown as GalleryWindow;
      for (let k = 0; k < 200 && !w.__gallery; k++) await new Promise((res) => setTimeout(res, 50));
      await w.__gallery?.ready;
      if (w.__gallery?.error) throw new Error(w.__gallery.error);
      const m = await measureScene(w);
      const row: RenderRow = {
        scene: sc.scene,
        ...m,
        budget: { mainMs: sc.mainMs, gpuMs: sc.gpuMs, fps: sc.fps },
        met: {
          main: m.mainMs.median + m.packetMs <= sc.mainMs,
          gpu: m.gpuMs.median <= sc.gpuMs,
          fps: m.raf.fps >= sc.fps * 0.95,
        },
      };
      rows.push(row);
    } finally {
      frame.remove();
    }
    results.render = rows;
    $('out-render').innerHTML = table(
      [
        'scene',
        'sprites',
        'belt items',
        'main ms (median)',
        'packet ms',
        'GPU ms (median)',
        'GPU via',
        'FPS',
        'budget',
      ],
      rows.map((r) => [
        r.scene,
        r.sprites,
        r.beltItems,
        r.mainMs.median,
        r.packetMs,
        r.gpuMs.median,
        r.gpuMs.method,
        r.raf.fps,
        `≤ ${r.budget.mainMs} ms, ≤ ${r.budget.gpuMs} ms, ${r.budget.fps} FPS`,
      ]),
      (r, c) => {
        const m = rows[r]?.met;
        if (!m) return '';
        if (c === 3) return m.main ? 'met' : 'missed';
        if (c === 5) return m.gpu ? 'met' : 'missed';
        if (c === 7) return m.fps ? 'met' : 'missed';
        return '';
      },
    );
  }
}

/** §9.4's gate on the user's laptop: offline load ≤ 3.5 % on average and ≤ 6.5 % in the worst second. */
const AUDIO_GATE = { mean: 3.5, worst: 6.5 };
/** A busy factory's SFX, as C7's audio page benchmarks it (src/dev/audio.ts FACTORY). */
const FACTORY = { loops: 12, machines: 100, shotsPerSec: 6, burst: 20, burstEvery: 5 };

async function runAudio(): Promise<void> {
  const get = async <T>(n: string) => {
    const r = await fetch(`/audio/${n}`);
    return r.ok ? ((await r.json()) as T) : null;
  };
  const deps: OfflineDeps = {
    worklets: { bank: bankUrl },
    baseUrl: '/audio/',
    music: await get('music.json'),
    sounds: await get('sounds.json'),
  };
  if (!deps.music) throw new Error('no audio assets (/audio/music.json): build them first');
  const rows: AudioRow[] = [];
  for (const [label, piece, seed] of [
    ['Era I', 'era1', 1945],
    ['Era II', 'era2', 1962],
  ] as const) {
    say(`audio: rendering ${label} with a factory's SFX…`);
    const r = await renderOffline(deps, {
      piece,
      params: { seed },
      duration: 150,
      activity: 0.8,
      sampleRate: 32000,
      sfx: FACTORY,
    });
    const seconds = r.buffer.duration;
    const mean = (100 * r.ms) / 1000 / seconds;
    const worst = Math.max(...r.perSecondMs) / 10;
    rows.push({
      piece: label,
      meanPercent: mean,
      worstSecondPercent: worst,
      seconds,
      met: mean <= AUDIO_GATE.mean && worst <= AUDIO_GATE.worst,
    });
    results.audio = rows;
    $('out-audio').innerHTML = table(
      ['piece', 'mean %', 'worst second %', 'gate'],
      rows.map((x) => [
        x.piece,
        x.meanPercent,
        x.worstSecondPercent,
        `≤ ${AUDIO_GATE.mean} %, ≤ ${AUDIO_GATE.worst} %`,
      ]),
      (row, c) => (c === 1 || c === 2 ? (rows[row]?.met ? 'met' : 'missed') : ''),
    );
  }
}

function runGpu(): void {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) {
    results.gpu = { webgl2: false };
    $('out-gpu').textContent = 'no WebGL2';
    return;
  }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const probe = probeFormats(gl);
  results.gpu = {
    webgl2: true,
    vendor: String(gl.getParameter(gl.VENDOR)),
    renderer: String(gl.getParameter(gl.RENDERER)),
    unmaskedVendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : null,
    unmaskedRenderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : null,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxArrayLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    extensions: gl.getSupportedExtensions(),
    formats: probe.results,
    colour: probe.colour,
    shadow: probe.shadow,
  };
  $('out-gpu').innerHTML =
    `<div>${results.gpu.unmaskedRenderer ?? results.gpu.renderer}; colour ${probe.colour}, shadow ${probe.shadow}</div>` +
    table(
      ['format', 'extension', 'probe'],
      Object.entries(probe.results).map(([f, v]) => [
        f,
        FORMATS[f as keyof typeof FORMATS].ext ?? '(core)',
        v,
      ]),
    );
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

// ------------------------------------------------------------------------------------------------- A/B

/** The paired A/B (IMPL-3): every scenario of both modules, in alternating order within each pair. */
async function runAb(): Promise<void> {
  const m = await manifest();
  const a = await benchModule('/__ab/a.wasm');
  const b = await benchModule('/__ab/b.wasm');
  const runs: Record<'A' | 'B', Record<string, Record<string, number>[]>> = { A: {}, B: {} };
  for (let k = 0; k < pairs; k++) {
    const order: ('A' | 'B')[] = k % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
    for (const sc of m.scenarios)
      for (const which of order) {
        say(`A/B: pair ${k + 1} of ${pairs}, ${sc.name}, ${which}…`);
        const files = await scenarioFiles(sc);
        const mod = which === 'A' ? a : b;
        const r = await job<SimReply>({ kind: 'sim', module: mod.module, files, scenario: sc, quick });
        const list = runs[which][sc.name] ?? [];
        list.push(r.result.metrics);
        runs[which][sc.name] = list;
      }
  }
  const ratios: Record<
    string,
    Record<string, { a: number; b: number; ratio: number; min: number; max: number }>
  > = {};
  for (const sc of m.scenarios) {
    const as = runs.A[sc.name] ?? [];
    const bs = runs.B[sc.name] ?? [];
    const keys = Object.keys(bs[0] ?? {}).filter((x) => x.endsWith('_ms') || x.endsWith('_per_s'));
    const per: Record<string, { a: number; b: number; ratio: number; min: number; max: number }> = {};
    for (const key of keys) {
      const rs: number[] = [];
      for (let k = 0; k < pairs; k++) {
        const x = as[k]?.[key];
        const y = bs[k]?.[key];
        if (x !== undefined && y !== undefined && x > 0) rs.push(y / x);
      }
      if (rs.length === 0) continue;
      per[key] = {
        a: med(as.map((r) => r[key] ?? 0)),
        b: med(bs.map((r) => r[key] ?? 0)),
        ratio: med(rs),
        min: Math.min(...rs),
        max: Math.max(...rs),
      };
    }
    ratios[sc.name] = per;
  }
  results.ab = { pairs, a: a.sha, b: b.sha, ratios };
  $('out-sim').innerHTML = table(
    ['scenario', 'metric', 'A', 'B', 'B ÷ A', 'spread'],
    Object.entries(ratios).flatMap(([s, per]) =>
      Object.entries(per).map(([k, v]) => [s, k, v.a, v.b, v.ratio, `${fmt(v.min)}–${fmt(v.max)}`]),
    ),
  );
}

// ------------------------------------------------------------------------------------------------- driver

const SECTIONS: Record<string, () => Promise<void> | void> = {
  sim: runSim,
  det: runDeterminism,
  render: runRender,
  audio: runAudio,
  gpu: runGpu,
};

async function send(): Promise<void> {
  if (!postResults) return;
  const r = await fetch('/__bench', { method: 'POST', body: JSON.stringify(results) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; file?: string; error?: string };
  say(j.ok ? `results sent to ${j.file}` : `the results were not sent: ${j.error ?? r.status}`);
}

let busy = false;
async function run(names: string[]): Promise<void> {
  if (busy) return;
  busy = true;
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  const t0 = performance.now();
  try {
    for (const n of names) {
      try {
        await SECTIONS[n]?.();
      } catch (e) {
        const msg = `${n}: ${e instanceof Error ? e.message : String(e)}`;
        results.errors.push(msg);
        console.warn(`bench: ${msg}`);
      }
      showJson();
    }
    say(
      `done in ${((performance.now() - t0) / 1000).toFixed(0)} s${results.errors.length ? ` (${results.errors.length} errors)` : ''}`,
    );
    await send();
  } finally {
    busy = false;
    for (const b of document.querySelectorAll('button')) b.disabled = false;
    showJson();
    (window as unknown as { __bench?: BenchResults }).__bench = results;
  }
}

$('machine').innerHTML = table(
  ['browser', 'cores', 'memory', 'screen', 'isolated'],
  [
    [
      results.userAgent,
      results.hardwareConcurrency,
      results.deviceMemoryGb === null ? '?' : `${results.deviceMemoryGb} GB`,
      `${results.screen.width} × ${results.screen.height} @ ${results.screen.dpr}`,
      results.crossOriginIsolated ? 'yes' : 'no',
    ],
  ],
);
$('all').addEventListener('click', () => void run(['gpu', 'sim', 'det', 'render', 'audio']));
for (const n of Object.keys(SECTIONS)) $(n).addEventListener('click', () => void run([n]));
$('send').addEventListener('click', () => void send());
showJson();

const auto = params.get('auto');
if (abMode)
  void (async () => {
    busy = true;
    try {
      await runAb();
      say('A/B done');
    } catch (e) {
      results.errors.push(`ab: ${e instanceof Error ? e.message : String(e)}`);
      say(`A/B failed: ${results.errors[results.errors.length - 1]}`);
    } finally {
      busy = false;
      showJson();
      (window as unknown as { __bench?: BenchResults }).__bench = results;
    }
  })();
else if (auto) void run(auto === 'all' ? ['gpu', 'sim', 'det', 'render', 'audio'] : auto.split(','));
