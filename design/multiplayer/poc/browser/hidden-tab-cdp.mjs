// Hidden-tab experiment in Chrome with its normal background policies (DESIGN.md §8.4).
// Playwright cannot be used: it launches Chromium with --disable-background-timer-throttling,
// --disable-backgrounding-occluded-windows and --disable-renderer-backgrounding, and enables focus emulation.
// So Chrome is launched directly and driven over raw CDP. Clients are tabs of one window; a blank tab in
// front hides them. One tab is also frozen through Page.setWebLifecycleState (as Energy Saver would).
//   xvfb-run -a taskset -c 8-15 node browser/hidden-tab-cdp.mjs [hideSeconds]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const poc = path.dirname(here);
const HIDE_S = +(process.argv[2] ?? 390);
const PORT = 47530;
const DBG = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const note = (o) => {
  const e = { t: Math.round(performance.now() / 1000), ...o };
  log.push(e);
  console.log(JSON.stringify(e));
};

const relay = spawn(process.execPath, ['relay.mjs', '--port', String(PORT), '--static', poc, '--grace', '900000'], { cwd: poc, stdio: 'ignore' });
await sleep(400);
const host = spawn(process.execPath, ['client.mjs', '--url', `ws://127.0.0.1:${PORT}/mp`, '--room', 'h', '--token', 'host', '--create', '--duration-ms', String((HIDE_S + 200) * 1000)], { cwd: poc, stdio: 'ignore' });
await sleep(1500);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-prof-'));
const chrome = spawn(path.join(process.env.HOME, '.local/opt/chrome-current/chrome'), [`--user-data-dir=${profile}`, `--remote-debugging-port=${DBG}`, '--no-first-run', '--no-default-browser-check', '--password-store=basic', 'about:blank'], { stdio: 'ignore' });
let ver = null;
for (let i = 0; i < 50 && !ver; i++) {
  await sleep(200);
  ver = await fetch(`http://127.0.0.1:${DBG}/json/version`)
    .then((r) => r.json())
    .catch(() => null);
}
note({ chrome: ver.Browser });
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const cdp = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const tabs = {};
for (const pacing of ['timer', 'net', 'both', 'freeze']) {
  const url = `http://127.0.0.1:${PORT}/browser/index.html?room=h&token=${pacing}&pacing=${pacing === 'freeze' ? 'both' : pacing}`;
  const { targetId } = await cdp('Target.createTarget', { url, newWindow: false });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  tabs[pacing] = { targetId, sessionId };
  await sleep(1000);
}
const { targetId: frontId } = await cdp('Target.createTarget', { url: 'about:blank', newWindow: false });
await sleep(12000);
const evalIn = async (k, expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }, tabs[k].sessionId)).result.value;
const relayLag = async () => {
  const s = await fetch(`http://127.0.0.1:${PORT}/stats`).then((r) => r.json());
  return Object.fromEntries(s.h.players.map((p) => [p.name, { lag: p.lag, connected: p.connected, flags: p.flags }]));
};
const snapshot = async (label) => {
  const out = { label, relay: await relayLag() };
  for (const k of Object.keys(tabs)) {
    try {
      out[k] = await Promise.race([evalIn(k, `({ vis: document.visibilityState, w: window.__stats.worker && { tick: window.__stats.worker.tick, lag: window.__stats.worker.lag, mode: window.__stats.worker.mode, reconnects: window.__stats.worker.reconnects, stalls: window.__stats.worker.stalls } })`), sleep(3000).then(() => 'no answer (frozen?)')]);
    } catch (e) {
      out[k] = { err: String(e).slice(0, 80) };
    }
  }
  note(out);
};
await cdp('Target.activateTarget', { targetId: frontId });
await sleep(1500);
await snapshot('hidden-start');
try {
  await cdp('Page.setWebLifecycleState', { state: 'frozen' }, tabs.freeze.sessionId);
  note({ froze: 'freeze' });
} catch (e) {
  note({ freezeError: String(e) });
}
for (let s = 0; s < HIDE_S; s += 30) {
  await sleep(30000);
  await snapshot(`hidden+${s + 30}s`);
  if (s + 30 === 90) {
    await cdp('Page.setWebLifecycleState', { state: 'active' }, tabs.freeze.sessionId).catch((e) => note({ unfreezeError: String(e) }));
    note({ unfroze: 'freeze', afterS: 90 });
  }
}
for (const k of ['timer', 'net', 'both']) {
  await cdp('Target.activateTarget', { targetId: tabs[k].targetId });
  await sleep(5000);
}
await sleep(5000);
await snapshot('visible-again');
const probes = {};
for (const k of Object.keys(tabs)) probes[k] = await evalIn(k, '({ main: window.__stats.main.windows, worker: window.__stats.worker?.workerTimer.windows, catchups: window.__stats.worker?.catchups })');
note({ probes });
fs.writeFileSync(path.join(poc, 'results', 'hidden-tab-chrome-cdp.json'), JSON.stringify(log, null, 1));
ws.close();
chrome.kill();
host.kill();
relay.kill();
fs.rmSync(profile, { recursive: true, force: true });
process.exit(0);
