// Threads experiment (WP A1 question 6): SharedArrayBuffer + Atomics between the sim Worker and helpers.
const logEl = document.getElementById('log') as HTMLElement;
const w = new Worker(new URL('./threads-worker.ts', import.meta.url), { type: 'module' });
w.onmessage = (e: MessageEvent) => {
  if (e.data.t === 'progress') {
    logEl.textContent += `\n${e.data.msg}`;
  } else if (e.data.t === 'done') {
    (window as unknown as { __result: unknown }).__result = e.data.result;
  } else if (e.data.t === 'error') {
    (window as unknown as { __result: unknown }).__result = { error: e.data.error };
  }
};
const q = new URLSearchParams(location.search);
w.postMessage({ t: 'start', maxHelpers: Number(q.get('helpers') ?? 7), iters: Number(q.get('iters') ?? 2000) });
