// The trace page (10 §10.5 "The trace page", D18 d; C8): loads a closure log and its start state, compiles sim.wasm
// on the page (as the game does, §9.7) and replays the log in a module worker with extraction off: the module trace
// (d_t, r_t per tick, the full state hash on the scheduled ticks) and the real shell's replay (every d_t checked
// against the log's natively recorded digests). The result goes to `window.__trace`, which e2e/trace.spec.ts reads
// and compares with the native trace (`simtool replay --trace --full`) and the same code in Node.
//
//   /test/trace.html?log=golden                 the golden set's 3,600-tick log from start.save
//   /test/trace.html?log=<name>                 test/logs/<name>.pwlog from <name>.start
//   &module=release                             the release sim.wasm (target/wasm-release, served by the dev server)
import type { ModuleTrace, ShellReplay } from '../../src/dev/trace/core.ts';

export interface TraceResult {
  ok: boolean;
  error?: string;
  log: string;
  module?: ModuleTrace;
  shell?: ShellReplay;
  moduleUrl: string;
  userAgent: string;
}

declare global {
  interface Window {
    __trace?: TraceResult;
  }
}

const params = new URLSearchParams(location.search);
const name = params.get('log') ?? 'golden';
const moduleUrl = params.get('module') === 'release' ? '/__dev/release/sim.wasm' : '/__wasm/sim.wasm';
const files =
  name === 'golden'
    ? { start: '/test/golden/m0/start.save', log: '/test/golden/m0/closure-log.pwlog' }
    : { start: `/test/logs/${name}.start`, log: `/test/logs/${name}.pwlog` };
const status = document.querySelector('[data-testid="trace-status"]') as HTMLElement;

async function bytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function main(): Promise<TraceResult> {
  status.textContent = `loading ${name}`;
  const [wasm, protos, start, log] = await Promise.all([
    bytes(moduleUrl),
    bytes('/test/golden/m0/protos/prototypes.bin'),
    bytes(files.start),
    bytes(files.log),
  ]);
  const module = await WebAssembly.compile(wasm);
  status.textContent = `replaying ${name}`;
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'trace' });
  const out = await new Promise<{ ok: boolean; error?: string; module?: ModuleTrace; shell?: ShellReplay }>(
    (resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => resolve({ ok: false, error: `worker: ${e.message}` });
      worker.postMessage({ module, protos, start, log });
    },
  );
  worker.terminate();
  return { ...out, log: name, moduleUrl, userAgent: navigator.userAgent };
}

main()
  .catch((e: unknown) => ({
    ok: false,
    error: e instanceof Error ? e.message : String(e),
    log: name,
    moduleUrl,
    userAgent: navigator.userAgent,
  }))
  .then((r: TraceResult) => {
    window.__trace = r;
    status.textContent = r.ok
      ? `${name}: ${r.module?.rows.length ?? 0} ticks, state ${r.module?.finalHash} r ${r.module?.finalR}; shell ${r.shell?.ok ? 'ok' : 'FAILED'}`
      : `${name}: failed: ${r.error}`;
  });
