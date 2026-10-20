// Page side of the browser PoC: owns a dedicated worker that runs the lockstep client and its socket.
// Also probes main-thread timer cadence, so hidden-tab throttling can be compared with the worker's.
const q = new URLSearchParams(location.search);
const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
const cfg = { url: `ws://${location.host}/mp`, room: q.get('room') ?? 'h', token: q.get('token') ?? 'W', pacing: q.get('pacing') ?? 'both', create: q.has('create') };
worker.postMessage({ t: 'start', cfg, hidden: document.visibilityState === 'hidden' });
document.addEventListener('visibilitychange', () => worker.postMessage({ t: 'vis', hidden: document.visibilityState === 'hidden' }));
const probe = { wakes: 0, windows: [] };
let w0 = performance.now();
(function tick() {
  probe.wakes++;
  const now = performance.now();
  if (now - w0 >= 10000) {
    probe.windows.push({ at: Math.round(now / 1000), hidden: document.visibilityState === 'hidden', wakesPerSec: +(probe.wakes / ((now - w0) / 1000)).toFixed(1) });
    probe.wakes = 0;
    w0 = now;
  }
  setTimeout(tick, 16);
})();
window.__stats = { main: probe, worker: null };
worker.onmessage = (ev) => {
  window.__stats.worker = ev.data;
  document.getElementById('out').textContent = JSON.stringify(ev.data, null, 1);
};
