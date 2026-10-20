// Wire-level probes for review findings 2, 9 and 11 (DESIGN.md §12.9). Usage: node probes.mjs [--port 47700]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './protocol.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--port');
const PORT = i > 0 ? +process.argv[i + 1] : 47700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const relay = spawn(process.execPath, ['relay.mjs', '--port', String(PORT)], { cwd: here, stdio: 'ignore' });
await sleep(400);

function connect(room, token, extra = '') {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/mp?room=${room}&token=${token}${extra}`);
  ws.binaryType = 'arraybuffer';
  const inbox = [];
  ws.onmessage = (ev) => inbox.push(new Uint8Array(ev.data));
  const opened = new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  const closed = new Promise((r) => {
    ws.onclose = (ev) => r(ev.code);
  });
  return { ws, inbox, opened, closed };
}
const horizonOf = (inbox) => {
  let h = 0;
  for (const m of inbox) if (m[0] === P.M.TICKS) h = Math.max(h, P.decodeTicks(m).last);
  return h;
};

// Finding 2: a later action stamped earlier than its predecessor must not run before it.
{
  const a = connect('probe2', 'A', '&create=1');
  await a.opened;
  a.ws.send(P.jsonMsg({ t: 'hello', name: 'A' }));
  await sleep(300);
  const h = horizonOf(a.inbox);
  a.ws.send(P.encodeAct([{ seq: 1, target: h + 30, bytes: P.actWalk(0) }]));
  a.ws.send(P.encodeAct([{ seq: 2, target: h + 20, bytes: P.actStop() }]));
  await sleep(800);
  const acks = a.inbox.filter((m) => m[0] === P.M.ACTACK).map(P.decodeActAck);
  const s1 = acks.find((x) => x.seq === 1);
  const s2 = acks.find((x) => x.seq === 2);
  check('stamps: a later action is never assigned an earlier tick', s1 && s2 && s2.assigned >= s1.assigned, `start @${s1?.assigned}, stop requested @${h + 20}, assigned @${s2?.assigned}`);
  const order = [];
  for (const m of a.inbox) if (m[0] === P.M.TICKS) for (const e of P.decodeTicks(m).entries) if (e.player === 0 && e.seq) order.push(e.seq);
  check('stamps: execution order follows send order', order.join(',') === '1,2', `closure order ${order.join(',')}`);
  a.ws.close();
}

// Finding 9: field widths and malformed input.
{
  let threw = false;
  try {
    P.encodeAct([{ seq: 1, target: 1, bytes: new Uint8Array(65536) }]);
  } catch {
    threw = true;
  }
  check('limits: a 65,536-byte payload is refused, not wrapped to 0', threw);
  threw = false;
  try {
    P.encodeTicks(1, 1, Array.from({ length: 65536 }, () => ({ tick: 1, player: 0, seq: 0, bytes: new Uint8Array(1) })));
  } catch {
    threw = true;
  }
  check('limits: 65,536 entries are refused, not encoded as an empty batch', threw);
  const entries = Array.from({ length: 70000 }, (_, k) => ({ tick: 1 + Math.floor(k / 4), player: 0, seq: k & 0xffff, bytes: new Uint8Array(3) }));
  const parts = P.splitTicks(1, 20000, entries);
  const decoded = parts.map(P.decodeTicks);
  const contiguous = decoded.every((d, k) => k === 0 || d.first === decoded[k - 1].last + 1) && decoded[0].first === 1 && decoded.at(-1).last === 20000;
  check('limits: a large resume range splits into contiguous bounded messages', contiguous && decoded.reduce((n, d) => n + d.entries.length, 0) === 70000, `${parts.length} messages`);
  const good = P.encodeTicks(5, 6, [{ tick: 6, player: 0, seq: 1, bytes: Uint8Array.of(1, 2, 3) }]);
  threw = false;
  try {
    P.decodeTicks(good.subarray(0, good.length - 1));
  } catch {
    threw = true;
  }
  check('limits: a truncated TICKS message is rejected before the horizon moves', threw);
  const b = connect('probe9', 'B', '&create=1');
  await b.opened;
  b.ws.send(P.jsonMsg({ t: 'hello', name: 'B' }));
  await sleep(200);
  const bad = new Uint8Array(12);
  bad[0] = P.M.ACT;
  bad[1] = 1;
  new DataView(bad.buffer).setUint16(8, 5000, true); // declares 5,000 payload bytes, sends none
  b.ws.send(bad);
  const code = await Promise.race([b.closed, sleep(1500).then(() => 'open')]);
  const alive = await fetch(`http://127.0.0.1:${PORT}/stats`).then((r) => r.ok, () => false);
  check('limits: a malformed ACT closes that connection and the relay survives', code === 4002 && alive, `close code ${code}`);
}

// Finding 11: duplicates must not complete a snapshot.
{
  const a = connect('probe11', 'A', '&create=1');
  await a.opened;
  a.ws.send(P.jsonMsg({ t: 'hello', name: 'A' }));
  await sleep(200);
  a.ws.send(P.encodeStatus(horizonOf(a.inbox), horizonOf(a.inbox), 0.1, 1)); // live: a donor candidate
  await sleep(200);
  const j = connect('probe11', 'J');
  await j.opened;
  j.ws.send(P.jsonMsg({ t: 'hello', name: 'J' }));
  await sleep(300);
  const snaps = () => fetch(`http://127.0.0.1:${PORT}/stats`).then((r) => r.json()).then((s) => s.probe11.snaps);
  const snapId = (await snaps())[0]?.id;
  const bulk = connect('probe11', 'A', '&bulk=1');
  await bulk.opened;
  const chunk = (idx) => P.encodeSnapChunk(snapId, idx, 2, 100, new Uint8Array(50));
  bulk.ws.send(chunk(0));
  bulk.ws.send(chunk(0));
  await sleep(300);
  const afterDup = (await snaps())[0];
  check('snapshots: a duplicate chunk does not complete a two-chunk snapshot', afterDup && !afterDup.done, `done=${afterDup?.done}`);
  bulk.ws.send(P.encodeSnapChunk(snapId, 5, 2, 100, new Uint8Array(50)));
  await sleep(200);
  check('snapshots: an out-of-range chunk index is ignored', !(await snaps())[0].done);
  bulk.ws.send(chunk(1));
  await sleep(300);
  check('snapshots: the snapshot completes when every chunk has arrived once', (await snaps())[0].done);
  for (const c of [a, j, bulk]) c.ws.close();
}

relay.kill();
const failed = results.filter((r) => !r.ok).length;
console.log(JSON.stringify({ probes: results.length, failed }));
process.exit(failed ? 1 : 0);
