// Relay load test: R rooms x C clients that behave like players on the wire (no simulation):
// consume the 60 Hz tick stream, send STATUS at 10 Hz, PING at 2 Hz, an action every 0.5 s, a digest per second.
// Reports the relay's CPU use from /proc. Usage: node loadgen.mjs --rooms 50 --clients 4 --duration-ms 20000
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './protocol.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const ROOMS = +arg('rooms', 10);
const CLIENTS = +arg('clients', 4);
const DURATION = +arg('duration-ms', 20000);
const PORT = +arg('port', 47400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cpu = (pid) => {
  const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  return (+f[11] + +f[12]) / 100; // utime + stime, seconds (CLK_TCK = 100)
};
const rss = (pid) => +fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1] / 1024;

const relay = spawn(process.execPath, ['relay.mjs', '--port', String(PORT)], { cwd: here, stdio: 'ignore' });
await sleep(400);
let ticksMsgs = 0;
let inBytes = 0;
const sockets = [];
function client(room, token, create) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/mp?room=${room}&token=${token}${create ? '&create=1' : ''}`);
  ws.binaryType = 'arraybuffer';
  let horizon = 0;
  let seq = 0;
  ws.onopen = () => ws.send(P.jsonMsg({ t: 'hello', name: token, resumeFrom: create ? undefined : 1 }));
  ws.onmessage = (ev) => {
    const u8 = new Uint8Array(ev.data);
    inBytes += u8.length;
    if (u8[0] === P.M.TICKS) {
      ticksMsgs++;
      horizon = new DataView(ev.data).getUint32(5, true);
      if (horizon % 60 === 0) ws.send(P.encodeDigest(horizon, 12345));
    }
  };
  const timers = [
    setInterval(() => ws.readyState === 1 && ws.send(P.encodeStatus(Math.max(0, horizon - 3), horizon, 0.3, 1)), 100),
    setInterval(() => ws.readyState === 1 && ws.send(P.encodePing(performance.now())), 500),
    setInterval(() => {
      if (ws.readyState !== 1) return;
      seq = (seq + 1) & 0xffff;
      ws.send(P.encodeAct([{ seq, target: horizon + 4, bytes: P.actWalk(seq & 7) }]));
    }, 500),
  ];
  sockets.push({ ws, timers });
}
for (let r = 0; r < ROOMS; r++) {
  client(`load${r}`, 'p0', true);
  await sleep(5);
}
await sleep(300);
for (let r = 0; r < ROOMS; r++) for (let c = 1; c < CLIENTS; c++) client(`load${r}`, `p${c}`, false);
await sleep(2000);
const c0 = cpu(relay.pid);
const t0 = performance.now();
const m0 = ticksMsgs;
const b0 = inBytes;
await sleep(DURATION);
const secs = (performance.now() - t0) / 1000;
const used = cpu(relay.pid) - c0;
const out = {
  rooms: ROOMS,
  clientsPerRoom: CLIENTS,
  sockets: ROOMS * CLIENTS,
  relayCpuPercentOfOneCore: +((used / secs) * 100).toFixed(1),
  relayCpuMsPerRoomSecond: +((used * 1000) / secs / ROOMS).toFixed(2),
  relayRssMB: +rss(relay.pid).toFixed(0),
  tickMsgsPerClientPerSec: +((ticksMsgs - m0) / secs / (ROOMS * CLIENTS)).toFixed(1),
  payloadBytesPerClientPerSec: Math.round((inBytes - b0) / secs / (ROOMS * CLIENTS)),
};
console.log(JSON.stringify(out));
for (const s of sockets) {
  for (const t of s.timers) clearInterval(t);
  s.ws.close();
}
relay.kill();
process.exit(0);
