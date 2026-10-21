// The trace page's module worker (10 §10.5, D18 d; C8): the module trace and the shell's replay of test/trace/core.ts,
// on this browser's WebAssembly engine, posted back to the page.
import { moduleTrace, shellReplay, type TraceInput } from '../../src/dev/trace/core.ts';

interface WorkerScope {
  onmessage: ((e: MessageEvent<TraceInput>) => void) | null;
  postMessage(m: unknown): void;
}
const scope = self as unknown as WorkerScope;
const webSha256 = async (b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', b.slice()));

scope.onmessage = async (e) => {
  try {
    const module = await moduleTrace(e.data);
    const shell = await shellReplay(e.data, webSha256);
    scope.postMessage({ ok: true, module, shell });
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
};
