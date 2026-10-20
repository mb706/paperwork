// A worldgen worker's entry (10 §3.1, §15.9): gen.wasm for one sim worker's pool.
import { GenWorker } from '../../genworker/worker.ts';

const worker = new GenWorker({ post: (m, transfer) => postMessage(m, { transfer: transfer ?? [] }) });

addEventListener('message', (e: MessageEvent) => {
  void worker.handle(e.data);
});
addEventListener('error', (e: ErrorEvent) =>
  postMessage({ t: 'log', level: 'error', msg: `worldgen worker: ${e.message}` }),
);
