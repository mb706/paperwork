// The sim worker's entry (10 §3.1). M0 scaffold: it instantiates the module the main thread compiled and
// reports the ABI version. The Shell work package replaces it with the real shell and protocol (§3.2).
import { instantiateScaffold } from '../../simworker/scaffold.ts';

self.addEventListener('message', (e: MessageEvent<{ t: string; module?: WebAssembly.Module }>) => {
  if (e.data.t !== 'boot' || !e.data.module) return;
  instantiateScaffold(e.data.module).then(
    (abi) => postMessage({ t: 'ready', abi }),
    (err: unknown) => postMessage({ t: 'error', message: err instanceof Error ? err.message : String(err) }),
  );
});
