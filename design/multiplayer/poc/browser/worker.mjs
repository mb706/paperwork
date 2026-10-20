// Worker side of the browser PoC: the lockstep client owns its WebSocket here (DESIGN.md §8.3).
import { Client } from '../client-core.mjs';

let client = null;
let hidden = false;
const ch = new MessageChannel();
const queue = [];
ch.port1.onmessage = () => queue.shift()?.();
const yieldFn = (f) => {
  queue.push(f);
  ch.port2.postMessage(0);
};
const probe = { wakes: 0, windows: [] };
let w0 = performance.now();
(function tick() {
  probe.wakes++;
  const now = performance.now();
  if (now - w0 >= 10000) {
    probe.windows.push({ at: Math.round(now / 1000), hidden, wakesPerSec: +(probe.wakes / ((now - w0) / 1000)).toFixed(1) });
    probe.wakes = 0;
    w0 = now;
  }
  setTimeout(tick, 16);
})();
self.onmessage = (ev) => {
  const m = ev.data;
  if (m.t === 'vis') hidden = m.hidden;
  if (m.t === 'start') {
    hidden = m.hidden;
    client = new Client({ ...m.cfg, yield: yieldFn, hidden: () => hidden, bot: true });
    client.start();
  }
};
setInterval(() => {
  if (!client) return;
  postMessage({ tick: client.sim?.tick ?? 0, horizon: client.horizon, lag: client.horizon - (client.sim?.tick ?? 0), mode: client.mode, hidden, inGame: client.inGame, reconnects: client.reconnects, workerTimer: probe, catchups: client.st.catchups, stalls: client.st.stalls.length });
}, 1000);
