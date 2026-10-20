// Runs the PoC scenarios: relay + one impairment proxy per client + Node clients, all as child processes.
// Run pinned to socket 1:  taskset -c 8-15 node run-scenarios.mjs [name ...]
// Writes results/<scenario>.json and prints a summary table.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Network profiles (one-way, applied in both directions by the proxy).
const NET = {
  lan: { delay: 1, jitter: 1 },
  home: { delay: 12, jitter: 6, stallP: 0.003, stallMs: 150 }, // ~25 ms RTT, rare retransmissions
  far: { delay: 45, jitter: 20, stallP: 0.01, stallMs: 250 }, // ~90-130 ms RTT, 1% loss stalls
  wifi: { delay: 15, jitter: 20, stallP: 0.005, stallMs: 200 }, // ~30-70 ms RTT, airtime jitter
  mobile: { delay: 30, jitter: 40, stallP: 0.01, stallMs: 300 }, // 4G/5G: ~60-140 ms RTT, handover stalls
  harsh: { delay: 40, jitter: 60, stallP: 0.03, stallMs: 400 }, // stress case: bursty and lossy
};

const S = {
  // Three players: host on a LAN-like link, one at home, one far away who joins at 20 s.
  // B's link drops at 30 s (resume), A's link black-holes 3 s at 38 s (silence, release, reconnect),
  // C corrupts its state at tick 2700 (desync, detection, background re-sync).
  base: {
    relay: ['--hz', '60', '--stamp', 'client'],
    clients: [
      { token: 'A', create: true, net: { ...NET.lan, holeAt: 38000, holeMs: 3000 }, start: 0 },
      { token: 'B', net: { ...NET.home, drops: [30000] }, start: 1500 },
      { token: 'C', net: NET.far, start: 20000, corruptAt: 2700 },
    ],
    pad: 2 << 20,
    duration: 60000,
  },
  relaystamp: { from: 'base', relay: ['--hz', '60', '--stamp', 'relay'] },
  hz30: { from: 'base', relay: ['--hz', '30', '--stamp', 'client'] },
  // A late-game join: a 20 MB snapshot, donor uplink 10 Mbit/s, joiner downlink 50 Mbit/s,
  // every client spends 4 ms per tick (late game on the reference machine, 10 §4.7).
  bigjoin: {
    relay: ['--hz', '60', '--stamp', 'client', '--cache-ticks', '0'],
    clients: [
      { token: 'A', create: true, net: { ...NET.home, upKbps: 10000, downKbps: 50000 }, start: 0 },
      { token: 'B', net: { ...NET.home, downKbps: 50000, upKbps: 10000 }, start: 15000 },
    ],
    pad: 20 << 20,
    costMs: 4,
    duration: 75000,
  },
  'bigjoin-paced': { from: 'bigjoin', bulkPace: 'ledbat' },
  // A late-game desync: B (playing) re-syncs from a 20 MB snapshot that A uploads at 10 Mbit/s.
  bigresync: {
    relay: ['--hz', '60', '--stamp', 'client'],
    clients: [
      { token: 'A', create: true, net: { ...NET.home, upKbps: 10000, downKbps: 50000 }, start: 0 },
      { token: 'B', net: { ...NET.home, downKbps: 50000, upKbps: 10000 }, start: 1500, corruptAt: 1500 },
    ],
    pad: 20 << 20,
    costMs: 4,
    duration: 90000,
  },
  'bigresync-paced': { from: 'bigresync', bulkPace: 'ledbat' },
  // Review finding 4: B runs 6 s behind the relay on purpose and corrupts its state; A and C reach a verdict
  // first, so B's digests arrive late and must still be compared.
  lagreport: {
    relay: ['--hz', '60', '--stamp', 'client'],
    clients: [
      { token: 'A', create: true, net: NET.home, start: 0 },
      { token: 'B', net: NET.home, start: 1500, extraDelayMs: 6000, corruptAt: 1500 },
      { token: 'C', net: NET.home, start: 1500 },
    ],
    pad: 1 << 20,
    duration: 60000,
  },
  // Review finding 10: a paced 4 MB join over a 2 Mbit/s donor uplink must keep making progress.
  'slowlink-paced': {
    relay: ['--hz', '60', '--stamp', 'client', '--cache-ticks', '0'],
    clients: [
      { token: 'A', create: true, net: { ...NET.home, upKbps: 2000, downKbps: 16000 }, start: 0 },
      { token: 'B', net: { ...NET.home, upKbps: 2000, downKbps: 16000 }, start: 10000 },
    ],
    pad: 4 << 20,
    costMs: 1,
    bulkPace: 'ledbat',
    duration: 75000,
  },
  // A client whose machine needs 20 ms per tick cannot hold 60 UPS: it falls behind, the others do not wait.
  slow: {
    relay: ['--hz', '60', '--stamp', 'client'],
    clients: [
      { token: 'A', create: true, net: NET.home, start: 0 },
      { token: 'B', net: NET.home, start: 1500, costMs: 20 },
      { token: 'C', net: NET.home, start: 1500 },
    ],
    pad: 1 << 20,
    duration: 45000,
  },
  // Four players on four kinds of access network.
  mixed: {
    relay: ['--hz', '60', '--stamp', 'client'],
    clients: [
      { token: 'A', create: true, net: NET.home, start: 0 },
      { token: 'B', net: NET.wifi, start: 1500 },
      { token: 'C', net: NET.mobile, start: 3000 },
      { token: 'D', net: NET.far, start: 4500 },
    ],
    pad: 1 << 20,
    duration: 60000,
  },
  harsh: {
    relay: ['--hz', '60', '--stamp', 'client'],
    clients: [
      { token: 'A', create: true, net: NET.home, start: 0 },
      { token: 'B', net: NET.harsh, start: 1500 },
    ],
    pad: 1 << 20,
    duration: 60000,
  },
};

function resolve(name) {
  const s = S[name];
  return s.from ? { ...S[s.from], ...s, from: undefined } : s;
}

async function run(name, portBase) {
  const sc = resolve(name);
  const procs = [];
  const relayPort = portBase;
  const relay = spawn(node, ['relay.mjs', '--port', String(relayPort), ...sc.relay], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(relay);
  await sleep(300);
  const outputs = [];
  sc.clients.forEach((c, i) => {
    const port = relayPort + 1 + i;
    const n = c.net;
    const pa = ['netem.mjs', '--listen', String(port), '--target', String(relayPort), '--delay-ms', String(n.delay ?? 0), '--jitter-ms', String(n.jitter ?? 0), '--stall-p', String(n.stallP ?? 0), '--stall-ms', String(n.stallMs ?? 0)];
    if (n.queueMs) pa.push('--queue-ms', String(n.queueMs));
    if (n.downKbps) pa.push('--down-kbps', String(n.downKbps));
    if (n.upKbps) pa.push('--up-kbps', String(n.upKbps));
    const proxyStart = Math.max(0, c.start - 200);
    if (n.drops) pa.push('--drop-at-ms', n.drops.map((d) => d - proxyStart).join(','));
    if (n.holeAt) pa.push('--hole-at-ms', String(n.holeAt - proxyStart), '--hole-ms', String(n.holeMs));
    setTimeout(() => procs.push(spawn(node, pa, { cwd: here, stdio: ['ignore', 'ignore', 'inherit'] })), proxyStart);
    const ca = ['client.mjs', '--url', `ws://127.0.0.1:${port}/mp`, '--room', name, '--token', c.token, '--start-after-ms', String(c.start), '--duration-ms', String(sc.duration - c.start), '--pad-bytes', String(sc.pad ?? 0), '--cost-ms', String(c.costMs ?? sc.costMs ?? 0), '--seed', String(11 + i)];
    if (c.create) ca.push('--create');
    if (sc.bulkPace) ca.push('--bulk-pace', sc.bulkPace);
    const si = sc.relay.indexOf('--stamp');
    if (si >= 0) ca.push('--stamp', sc.relay[si + 1]); // clients must predict with the relay's stamping mode
    if (c.corruptAt) ca.push('--corrupt-at', String(c.corruptAt));
    if (c.extraDelayMs) ca.push('--extra-delay-ms', String(c.extraDelayMs));
    const p = spawn(node, ca, { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let buf = '';
    p.stdout.on('data', (d) => (buf += d));
    p.stderr.on('data', (d) => process.stderr.write(`[${name}/${c.token}] ${d}`));
    outputs.push(new Promise((r) => p.on('exit', () => r(buf.trim() ? JSON.parse(buf.trim().split('\n').pop()) : { client: c.token, error: 'no output' }))));
  });
  await sleep(sc.duration - 400);
  const relayStats = await fetch(`http://127.0.0.1:${relayPort}/stats`).then((r) => r.json());
  const clients = await Promise.all(outputs);
  for (const p of procs) p.kill();
  // Agreement: all clients must report the same rolling digest at their common checkpoint ticks.
  const common = Object.keys(clients[0].checkpoints ?? {}).filter((t) => clients.every((c) => c.checkpoints?.[t] !== undefined));
  const lastCommon = common.map(Number).sort((a, b) => a - b).slice(-2);
  const agree = lastCommon.length > 0 && lastCommon.every((t) => new Set(clients.map((c) => c.checkpoints[t])).size === 1);
  // Evidence must not overstate (review finding 15): also require the canonical full-state hash to agree, and
  // report whether every player actually got into the game.
  const fullAgree = lastCommon.length > 0 && lastCommon.every((t) => new Set(clients.map((c) => c.fullCheckpoints?.[t])).size === 1);
  const inGame = Object.fromEntries(clients.map((c) => [c.client, !!c.inGame]));
  const result = { scenario: name, config: sc, agreeAtTicks: lastCommon, agree, fullAgree, inGame, relay: relayStats[name], clients };
  fs.mkdirSync(path.join(here, 'results'), { recursive: true });
  fs.writeFileSync(path.join(here, 'results', `${name}.json`), JSON.stringify(result, null, 1));
  return result;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(S);
let port = 47200;
for (const name of names) {
  const r = await run(name, port);
  port += 10;
  console.log(`\n=== ${name}: at ticks ${r.agreeAtTicks} rolling digests agree: ${r.agree}, full state agrees: ${r.fullAgree}; in game: ${JSON.stringify(r.inGame)}; desyncs detected: ${r.relay?.desyncs?.length ?? 0}`);
  for (const c of r.clients) {
    console.log(
      `${c.client} idx=${c.index} rtt=${c.rttMs}ms margin=${c.margin} playout=${c.playoutDelayMs}ms confirm p50/p95=${c.confirmMs?.p50}/${c.confirmMs?.p95}ms apply p50/p95=${c.applyMs?.p50}/${c.applyMs?.p95}ms ` +
        `inputDelay p50=${c.inputDelayTicks?.p50}t late=${c.late}/${c.acts} predErr mean=${c.predErrTicks?.mean}t nz=${c.predErrTicks?.nonzeroShare} stalls=${c.stalls?.n}/${c.stalls?.totalMs}ms reconnects=${c.reconnects} ` +
        `catchups=${JSON.stringify(c.catchups)} snap=${JSON.stringify(c.lastSnap)} resyncs=${JSON.stringify(c.resyncs?.map((x) => ({ d: x.desyncTick, ms: x.swappedAfterMs, dl: x.downloadMs })))} bytesIn=${c.bytes?.in} ` +
        `uploads=${JSON.stringify(c.uploads)} rttIdle=${JSON.stringify(c.rttIdle)} rttXfer=${JSON.stringify(c.rttDuringTransfer)}`,
    );
  }
}
