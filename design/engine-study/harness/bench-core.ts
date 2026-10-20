// The benchmark procedure, shared by the Node runner (harness/bench-node.ts) and the browser Worker
// (harness/web/src/worker.ts), so that every platform measures exactly the same thing.
import { generate, params, viewRect } from '../gen/generate.ts';
import { World, xxh32Bytes } from '../ts/kernel.ts';
import { type SimLike, WasmWorld } from '../ts/wasm-world.ts';

export type Impl = 'ts' | 'wasm' | 'wasm-simd';

export interface BenchCfg {
  impl: Impl;
  scale: string;
  regime: string;
  seed: number;
  warmup: number; // ticks before measuring (the regime reaches its steady state by ~6,000)
  ticks: number; // measured ticks, timed one by one
  phaseTicks: number; // second window with per-phase timers on
  frames: number; // render-extraction frames per (zoom, full) case
  noSleep?: boolean;
}

export interface Env {
  now: () => number;
  wasm?: (simd: boolean) => Promise<WebAssembly.Module>;
  // Worker only: post the buffer (transferred) to the main thread and resolve when it comes back
  transfer?: (buf: ArrayBuffer, n: number) => Promise<ArrayBuffer>;
  onProgress?: (msg: string) => void;
}

const POOL_BYTES = 8 << 20;

function summary(a: Float64Array): Record<string, number> {
  const n = a.length;
  const s = Float64Array.from(a).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i];
  const mean = sum / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (a[i] - mean) * (a[i] - mean);
  const q = (p: number) => s[Math.min(n - 1, Math.round((n - 1) * p))];
  const med = q(0.5);
  let spikes = 0;
  for (let i = 0; i < n; i++) if (a[i] > 2 * med) spikes++;
  let argmax = 0;
  for (let i = 1; i < n; i++) if (a[i] > a[argmax]) argmax = i;
  return { n, mean, sd: Math.sqrt(v / n), p50: med, p90: q(0.9), p99: q(0.99), p999: q(0.999), max: s[n - 1], argmax, spikes2x: spikes };
}

export async function makeSim(cfg: BenchCfg, env: Env, blob: ArrayBuffer): Promise<SimLike> {
  if (cfg.impl === 'ts') {
    const w = new World(blob);
    w.now = env.now;
    return w;
  }
  if (!env.wasm) throw new Error('no wasm loader');
  const mod = await env.wasm(cfg.impl === 'wasm-simd');
  return WasmWorld.create(mod, blob, env.now);
}

export async function runBench(cfg: BenchCfg, env: Env): Promise<Record<string, unknown>> {
  const now = env.now;
  const p = params(cfg.scale, cfg.regime, cfg.seed);
  let t = now();
  const blob = generate(p);
  const genMs = now() - t;
  const blobHash = xxh32Bytes(new Uint8Array(blob), blob.byteLength);
  t = now();
  const sim = await makeSim(cfg, env, blob);
  const loadMs = now() - t;
  if (cfg.noSleep) sim.setNoSleep(true);
  env.onProgress?.(`loaded ${cfg.impl} ${cfg.scale}/${cfg.regime} in ${loadMs.toFixed(0)} ms`);

  // warm-up curve: the first ticks after a load, while the JIT (or wasm tier-up) is still cold
  const curve = new Float64Array(600);
  t = now();
  for (let k = 0; k < curve.length; k++) {
    const a = now();
    sim.step();
    curve[k] = now() - a;
  }
  sim.run(cfg.warmup - curve.length);
  const warmMs = now() - t;
  const bucket = (lo: number, hi: number) => {
    let s = 0;
    for (let k = lo; k < hi; k++) s += curve[k];
    return s / (hi - lo);
  };
  const warmCurve = { t1: curve[0], t2to10: bucket(1, 10), t11to100: bucket(10, 100), t101to600: bucket(100, 600), worst: Math.max(...curve) };
  const times = new Float64Array(cfg.ticks);
  for (let k = 0; k < cfg.ticks; k++) {
    const a = now();
    sim.step();
    times[k] = now() - a;
  }
  const hash = sim.hash();
  const stats = sim.stats();
  env.onProgress?.(`measured ${cfg.ticks} ticks, hash ${hash.toString(16)}`);

  sim.resetPhaseMs();
  sim.setTiming(true);
  sim.run(cfg.phaseTicks);
  sim.setTiming(false);
  const phases = sim.phaseMs().map((v) => v / cfg.phaseTicks);

  // render extraction (§3.2 dyn, §6.2): 1920×1080 at zoom 1 and 0.3, dynamic-only and full sprite lists
  const pool = [new ArrayBuffer(POOL_BYTES), new ArrayBuffer(POOL_BYTES), new ArrayBuffer(POOL_BYTES)];
  const extraction: Record<string, unknown>[] = [];
  for (const zoom of [1, 0.3]) {
    for (const full of [false, true]) {
      const [x0, y0, x1, y1] = viewRect(p, zoom);
      const ex = new Float64Array(cfg.frames);
      const pack = new Float64Array(cfg.frames);
      const rt = new Float64Array(cfg.frames);
      let n = 0;
      let outHash = 0;
      for (let f = 0; f < 20; f++) {
        // unmeasured warm-up frames: JIT tiers, first-use growth of the output buffers
        sim.step();
        if (sim instanceof World) sim.setOut(pool[0]);
        n = sim.extract(x0, y0, x1, y1, full);
        if (!(sim instanceof World)) new Uint8Array(pool[0], 0, n * 16).set(sim.outBytes(n));
      }
      for (let f = 0; f < cfg.frames; f++) {
        sim.step();
        let buf = pool.pop() as ArrayBuffer;
        let a = now();
        if (sim instanceof World) {
          // TS: the kernel writes straight into the pooled, transferable buffer
          sim.setOut(buf);
          n = sim.extract(x0, y0, x1, y1, full);
          ex[f] = now() - a;
          buf = sim.out; // may have grown
          pack[f] = 0;
        } else {
          // WASM: the kernel writes into linear memory; JS copies the records into a transferable buffer
          n = sim.extract(x0, y0, x1, y1, full);
          ex[f] = now() - a;
          a = now();
          new Uint8Array(buf, 0, n * 16).set(sim.outBytes(n));
          pack[f] = now() - a;
        }
        if (f === cfg.frames - 1) outHash = xxh32Bytes(new Uint8Array(buf), n * 16);
        if (env.transfer) {
          a = now();
          buf = await env.transfer(buf, n);
          rt[f] = now() - a;
        }
        pool.push(buf);
      }
      extraction.push({
        zoom,
        full,
        sprites: n,
        bytes: n * 16,
        extract: summary(ex),
        pack: summary(pack),
        roundTrip: env.transfer ? summary(rt) : null,
        outHash: outHash.toString(16).padStart(8, '0'),
      });
    }
  }
  return {
    cfg,
    blobBytes: blob.byteLength,
    blobHash: blobHash.toString(16).padStart(8, '0'),
    genMs,
    loadMs,
    warmMs,
    warmCurve,
    tick: summary(times),
    hash: hash.toString(16).padStart(8, '0'),
    hashTick: cfg.warmup + cfg.ticks,
    stats,
    phases: { timers: phases[0], electric: phases[1], machines: phases[2], belts: phases[3], inserters: phases[4] },
    extraction,
  };
}
