// The sim worker's entry (10 §3.1): the shell (src/simworker/shell.ts) on the worker's clock and timers, with
// short waits as self-posted messages (§3.3: no 4 ms timer clamp), prototypes.bin fetched by the worker and
// hashed with WebCrypto (§15.2), and every uncaught error forwarded as a `log` message (§3.2 "Logging").
import { type ShellHost, SimShell } from '../../simworker/shell.ts';
import { selfPostWaker } from '../../simworker/waker.ts';

const waker = selfPostWaker();

const host: ShellHost = {
  // The array form: the shell reuses its packet message and transfer list, so a packet allocates nothing here.
  post: (m, transfer) => (transfer ? postMessage(m, transfer) : postMessage(m)),
  now: () => performance.now(),
  wake: waker.wake,
  cancel: waker.cancel,
  protos: async () => {
    const r = await fetch('/data/prototypes.bin');
    if (!r.ok) throw new Error(`/data/prototypes.bin: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  },
  sha256: async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', b.slice())),
};

const shell = new SimShell(host);

addEventListener('message', (e: MessageEvent) => {
  void shell.handle(e.data);
});
addEventListener('error', (e: ErrorEvent) =>
  postMessage({ t: 'log', level: 'error', msg: `sim worker: ${e.message}` }),
);
addEventListener('unhandledrejection', (e: PromiseRejectionEvent) =>
  postMessage({ t: 'log', level: 'error', msg: `sim worker: ${String(e.reason)}` }),
);
