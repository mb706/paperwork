// The IO worker's entry (10 §3.1, §8.2): one per page; saves in OPFS where available, otherwise IndexedDB.
// `navigator.storage.persist()` exists only on the main thread, so SimHost requests it at the first save.
import { IoWorker } from '../../ioworker/worker.ts';

const io = new IoWorker(
  { post: (m, transfer) => postMessage(m, { transfer: transfer ?? [] }) },
  {
    sha256: async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', b.slice())),
    now: () => performance.now(),
    estimate: async () => {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    },
    persisted: () => navigator.storage.persisted(),
  },
);

addEventListener('message', (e: MessageEvent) => io.handle(e.data));
addEventListener('error', (e: ErrorEvent) =>
  postMessage({ t: 'log', level: 'error', msg: `IO worker: ${e.message}` }),
);
