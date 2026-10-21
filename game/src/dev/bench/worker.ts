// bench.html's module worker (10 §10.6; C8): one job per worker, as the game runs sim.wasm in a worker. `sim` runs
// one M0 benchmark scenario (sim-core.ts); `trace` replays a closure log through the shell's module layer and reports
// whether every d_t equals the natively recorded one (the determinism check of the user's browsers, §13).
import { moduleTrace } from '../trace/core.ts';
import { type BenchScenario, runScenario, timerResolutionMs } from './sim-core.ts';

export type BenchJob =
  | {
      kind: 'sim';
      module: WebAssembly.Module;
      files: Record<string, Uint8Array>;
      scenario: BenchScenario;
      quick: boolean;
    }
  | { kind: 'trace'; module: WebAssembly.Module; protos: Uint8Array; start: Uint8Array; log: Uint8Array };

interface WorkerScope {
  onmessage: ((e: MessageEvent<BenchJob>) => void) | null;
  postMessage(m: unknown): void;
  crossOriginIsolated?: boolean;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
  const job = e.data;
  try {
    if (job.kind === 'sim') {
      const files = (name: string) => {
        const f = job.files[name];
        if (!f) throw new Error(`no file ${name}`);
        return f;
      };
      const t0 = performance.now();
      const result = runScenario(job.module, files, job.scenario, job.quick);
      scope.postMessage({
        ok: true,
        result,
        seconds: (performance.now() - t0) / 1000,
        timerResolutionMs: timerResolutionMs(() => performance.now()),
        isolated: scope.crossOriginIsolated === true,
      });
    } else {
      const t = await moduleTrace({
        module: job.module,
        protos: job.protos,
        start: job.start,
        log: job.log,
        // d_t, r_t every tick; the full state hash at the end only (the page compares the natively recorded ones)
        schedule: { everyUntil: 0, thenEvery: 0 },
      });
      scope.postMessage({
        ok: true,
        trace: {
          ticks: t.rows.length,
          logMismatch: t.logMismatch,
          finalHash: t.finalHash,
          finalR: t.finalR,
          ms: t.ms,
        },
      });
    }
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
};
