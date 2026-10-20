// Headless Node client for the PoC. Prints one JSON summary line on exit.
// Usage: node client.mjs --url ws://127.0.0.1:47101/mp --room R --token A [--create] [--stamp client|relay]
//        [--start-after-ms 0] [--duration-ms 60000] [--cost-ms 0] [--pad-bytes 0] [--corrupt-at TICK] [--seed 7]
import { Worker } from 'node:worker_threads';
import { Client } from './client-core.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const sab = new Int32Array(new SharedArrayBuffer(4));

const c = new Client({
  url: arg('url', 'ws://127.0.0.1:47100/mp'),
  room: arg('room', 'r1'),
  token: arg('token', 'A'),
  name: arg('name', arg('token', 'A')),
  create: has('create'),
  stamp: arg('stamp', 'client'),
  pacing: arg('pacing', 'both'),
  costMs: +arg('cost-ms', 0),
  padBytes: +arg('pad-bytes', 0),
  corruptAt: arg('corrupt-at') ? +arg('corrupt-at') : undefined,
  seed: +arg('seed', 7),
  bulkPace: arg('bulk-pace', 'off'),
  sleep: (ms) => Atomics.wait(sab, 0, 0, ms), // emulated tick cost without burning CPU
  yield: (f) => setImmediate(f),
  // background re-sync in a second thread, as the design's shadow simulation worker
  makeShadow: () => {
    const w = new Worker(new URL('./shadow-worker.mjs', import.meta.url));
    const h = { post: (m, tr) => w.postMessage(m, tr), terminate: () => w.terminate(), onmessage: null };
    w.on('message', (m) => h.onmessage?.(m));
    return h;
  },
});
c.log = (o) => process.stderr.write(`${JSON.stringify({ c: arg('token', 'A'), ...o })}\n`);

setTimeout(() => c.start(), +arg('start-after-ms', 0));
setTimeout(
  () => {
    const s = c.summary();
    c.stop();
    process.stdout.write(`${JSON.stringify({ client: arg('token', 'A'), ...s })}\n`);
    setTimeout(() => process.exit(0), 100);
  },
  +arg('start-after-ms', 0) + +arg('duration-ms', 60000),
);
