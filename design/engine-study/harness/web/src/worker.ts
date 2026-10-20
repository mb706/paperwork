// The sim Worker of the browser benchmark. Runs harness/bench-core.ts exactly as Node does, transfers
// extraction buffers to the main thread, then serves UI queries while pacing itself at 60 UPS.
import simUrl from '../../../target/wasm/sim.wasm?url';
import simdUrl from '../../../target/wasm/sim-simd.wasm?url';
import { type BenchCfg, makeSim, runBench } from '../../bench-core.ts';
import { generate, params } from '../../../gen/generate.ts';
import type { SimLike } from '../../../ts/wasm-world.ts';

const scriptReadyMs = performance.now(); // fetch + parse + evaluate of this bundle (generator, TS kernel, harness)
const post = (m: unknown, t?: Transferable[]) => (self as unknown as Worker).postMessage(m, t ?? []);
let back: ((b: ArrayBuffer) => void) | null = null;
let sim: SimLike | null = null;
let pacing = false;
let ticksRun = 0;
let lateTicks = 0;
let tickMsMax = 0;

const wasmCache = new Map<boolean, Promise<WebAssembly.Module>>();
const wasm = (simd: boolean) => {
  let m = wasmCache.get(simd);
  if (!m) {
    m = WebAssembly.compileStreaming(fetch(simd ? simdUrl : simUrl));
    wasmCache.set(simd, m);
  }
  return m;
};

function timerResolution(): number {
  let min = Infinity;
  for (let k = 0; k < 200; k++) {
    const a = performance.now();
    let b = performance.now();
    while (b === a) b = performance.now();
    if (b - a < min) min = b - a;
  }
  return min;
}

// 60 UPS pacing as in spec 10 §3.3: setTimeout when the next tick is far, a MessageChannel self-post otherwise
const chan = new MessageChannel();
let t0 = 0;
let done = 0;
chan.port1.onmessage = () => loop();
function schedule(): void {
  const next = t0 + (done + 1) * (1000 / 60);
  const wait = next - performance.now();
  if (wait > 4) setTimeout(loop, wait - 2);
  else chan.port2.postMessage(0);
}
function loop(): void {
  if (!pacing || !sim) return;
  const due = Math.floor((performance.now() - t0) / (1000 / 60));
  let n = 0;
  while (done < due && n < 3) {
    const a = performance.now();
    sim.step();
    const dt = performance.now() - a;
    if (dt > tickMsMax) tickMsMax = dt;
    done++;
    n++;
    ticksRun++;
  }
  if (due - done > 6) {
    lateTicks += due - done;
    t0 += (due - done) * (1000 / 60);
  }
  schedule();
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.t === 'start') {
      const cfg = m.cfg as BenchCfg;
      const res = timerResolution();
      // cold WebAssembly start-up: streaming compile, then instantiate (no world loaded)
      let a = performance.now();
      const modCold = await WebAssembly.compileStreaming(fetch(cfg.impl === 'wasm-simd' ? simdUrl : simUrl));
      const compileMs = performance.now() - a;
      a = performance.now();
      await WebAssembly.instantiate(modCold, { env: { now: () => performance.now() } });
      const instantiateMs = performance.now() - a;
      const result = await runBench(cfg, {
        now: () => performance.now(),
        wasm,
        transfer: (buf, n) =>
          new Promise<ArrayBuffer>((resolve) => {
            back = resolve;
            post({ t: 'xfer', buf, n }, [buf]);
          }),
        onProgress: (msg) => post({ t: 'progress', msg }),
      });
      // keep a loaded world for the query-latency phase
      sim = await makeSim(cfg, { now: () => performance.now(), wasm }, generate(params(cfg.scale, cfg.regime, cfg.seed)));
      sim.run(600);
      post({
        t: 'done',
        result: {
          ...result,
          startup: { workerScriptMs: scriptReadyMs, wasmCompileMs: compileMs, wasmInstantiateMs: instantiateMs },
          timerResolutionMs: res,
          userAgent: navigator.userAgent,
          crossOriginIsolated: self.crossOriginIsolated,
        },
      });
    } else if (m.t === 'back') {
      const b = back;
      back = null;
      b?.(m.buf);
    } else if (m.t === 'pace') {
      pacing = m.on;
      if (pacing) {
        t0 = performance.now();
        done = 0;
        schedule();
      }
    } else if (m.t === 'query') {
      if (!sim) return;
      let value: unknown;
      if (m.kind === 'inventory') {
        // one entity's live panel: what an open machine GUI needs every tick
        const s = sim.stats();
        value = { entity: m.arg, slots: [[2, 37], [4, 12], [6, 0]], progress: 0.5, status: 1, tick: s.tick };
      } else if (m.kind === 'tech') {
        // the technology screen: ~300 technologies, progress and state
        const techs = new Array(300);
        for (let k = 0; k < 300; k++) techs[k] = [k, (k * 7) % 3, (k % 10) / 10];
        value = { techs };
      } else {
        value = { ticksRun, lateTicks, tickMsMax };
      }
      post({ t: 'res', id: m.id, value });
    }
  } catch (err) {
    post({ t: 'error', error: String((err as Error)?.stack ?? err) });
  }
};
