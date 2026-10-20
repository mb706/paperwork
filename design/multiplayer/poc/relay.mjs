// Relay and sequencer (DESIGN.md §2, §6): it owns the tick clock, accepts client-stamped actions into
// open ticks (moving late ones to the open tick), broadcasts closed ticks, keeps a short log for resumes,
// coordinates donor snapshots for joins and re-syncs, compares digests, and never runs the simulation.
// Usage: node relay.mjs [--port 47100] [--hz 60] [--stamp client|relay] [--grace 10000] [--silence 1000]
//                       [--cache-ticks 600] [--static DIR]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import * as P from './protocol.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = +arg('port', 47100);
const HZ = +arg('hz', 60);
const STAMP = arg('stamp', 'client');
const GRACE = +arg('grace', 10000);
const SILENCE = +arg('silence', 1000);
const CACHE_TICKS = +arg('cache-ticks', 600);
const STATIC = arg('static', null);
const DEBUG = process.argv.includes('--debug');
const TICK = P.TICK_MS;
const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map(); // token -> player record
    this.byIndex = [];
    this.started = false;
    this.t0 = 0;
    this.closed = 0; // last closed tick; the world starts at tick 0
    this.pending = new Map(); // tick -> entries
    this.log = []; // entries of closed ticks >= logStart, for resumes and cached joins
    this.logStart = 1;
    this.snaps = new Map();
    this.nextSnap = 1;
    this.lastSnap = null;
    this.digests = new Map(); // tick -> Map(index -> digest)
    this.events = [];
    this.k = Math.max(1, Math.round(60 / HZ)); // ticks per broadcast
    this.timer = null;
  }
  open() {
    return this.closed + 1;
  }
  start() {
    if (this.timer) return;
    this.started = true;
    this.t0 = performance.now() - this.closed * TICK;
    this.wake();
  }
  wake() {
    const due = Math.floor((performance.now() - this.t0) / TICK);
    if (due > this.closed) this.closeThrough(due);
    const next = this.t0 + (this.closed + this.k) * TICK;
    this.timer = setTimeout(() => this.wake(), Math.max(0, next - performance.now()));
  }
  closeThrough(due) {
    const first = this.closed + 1;
    const entries = [];
    for (let t = first; t <= due; t++) {
      const list = this.pending.get(t);
      if (!list) continue;
      for (const en of list) entries.push(en);
      this.pending.delete(t);
    }
    this.closed = due;
    for (const en of entries) this.log.push(en);
    const msg = P.encodeTicks(first, due, entries);
    for (const pl of this.byIndex) if (pl?.conn && pl.streaming) send(pl, msg);
  }
  inject(kind, idx, extra = 0) {
    const tick = this.open();
    const en = { tick, player: P.SYSTEM, seq: 0, bytes: P.sysAct(kind, idx, extra) };
    if (!this.pending.has(tick)) this.pending.set(tick, []);
    this.pending.get(tick).push(en);
    this.events.push({ at: Date.now(), tick, kind, idx, extra });
    return tick;
  }
  backlog(from) {
    return P.encodeTicks(from, this.closed, this.log.filter((en) => en.tick >= from));
  }
  trimLog() {
    // Keep the log back to the newest complete snapshot, so cached joins and resumes can replay it.
    const keepFrom = Math.min(this.lastSnap ? this.lastSnap.tick + 1 : 1, this.closed - 3600);
    if (keepFrom > this.logStart) {
      this.log = this.log.filter((en) => en.tick >= keepFrom);
      this.logStart = keepFrom;
    }
  }
}

function send(pl, msg) {
  if (pl.conn?.readyState !== 1) return;
  pl.conn.send(msg);
  pl.stats.outMsgs++;
  pl.stats.outBytes += msg.length;
}
function sendBulk(pl, msg) {
  pl.bulkQueue.push(msg);
  pumpBulk(pl);
}
function pumpBulk(pl) {
  const now = performance.now();
  if (pl.bulkRate > 0) pl.bulkTokens = Math.min(pl.bulkRate * 0.1, (pl.bulkTokens ?? 0) + ((now - (pl.bulkAt ?? now)) / 1000) * pl.bulkRate);
  pl.bulkAt = now;
  while (pl.bulk && pl.bulk.readyState === 1 && pl.bulkQueue.length && pl.bulk.bufferedAmount < (pl.bulkRate > 0 ? 64 << 10 : 4 << 20)) {
    const m = pl.bulkQueue[0];
    if (pl.bulkRate > 0) {
      if (pl.bulkTokens < m.length) break; // paced: the client is playing and asked for a gentler rate
      pl.bulkTokens -= m.length;
    }
    pl.bulkQueue.shift();
    pl.bulk.send(m);
    pl.stats.bulkOutBytes += m.length;
  }
}

function startSnapshot(room, donor, subs, reason) {
  const snap = { id: room.nextSnap++, tick: room.open(), donor: donor.index, chunks: [], count: 0, total: 0, received: 0, done: false, subs, reason, startedAt: performance.now() };
  room.snaps.set(snap.id, snap);
  room.inject(P.A.SNAPMARK, donor.index, snap.id);
  return snap;
}
function feedSnap(snap, sub) {
  for (const c of snap.chunks) if (c) sendBulk(sub, c);
}

function chooseDonor(room, exclude) {
  let best = null;
  for (const pl of room.byIndex) {
    if (!pl || pl === exclude || !pl.conn || !pl.live || pl.resyncing) continue;
    const lag = room.closed - pl.simTick;
    if (!best || lag < room.closed - best.simTick) best = pl;
  }
  return best;
}

function onHello(room, pl, msg) {
  pl.name = msg.name ?? pl.name;
  const from = msg.resumeFrom;
  if (!room.started) {
    room.start();
    pl.streaming = true;
    pl.live = true;
    room.inject(P.A.JOIN, pl.index);
    pl.inSim = true;
    send(pl, P.jsonMsg({ t: 'welcome', mode: 'new', index: pl.index, startTick: 0 }));
    return;
  }
  if (from !== undefined && from >= room.logStart && from <= room.closed + 1) {
    send(pl, P.jsonMsg({ t: 'welcome', mode: 'resume', index: pl.index }));
    send(pl, room.backlog(from));
    pl.streaming = true;
    pl.live = true;
    if (!pl.inSim) {
      room.inject(P.A.JOIN, pl.index);
      pl.inSim = true;
    }
    return;
  }
  // Snapshot path: a cached snapshot if it is fresh enough, otherwise a donor serializes at the open tick.
  const cache = room.lastSnap;
  let snap;
  if (cache && room.closed - cache.tick <= CACHE_TICKS && cache.tick + 1 >= room.logStart) {
    snap = cache;
    send(pl, P.jsonMsg({ t: 'welcome', mode: 'snapshot', index: pl.index, snapId: snap.id, snapTick: snap.tick, cached: true }));
    send(pl, room.backlog(snap.tick + 1));
  } else {
    const donor = chooseDonor(room, pl);
    if (!donor) {
      send(pl, P.jsonMsg({ t: 'error', reason: 'no-donor' }));
      return;
    }
    snap = startSnapshot(room, donor, [], 'join');
    send(pl, P.jsonMsg({ t: 'welcome', mode: 'snapshot', index: pl.index, snapId: snap.id, snapTick: snap.tick, cached: false }));
  }
  pl.streaming = true;
  pl.live = false;
  pl.needsJoin = !pl.inSim;
  pl.snapSub = snap;
  snap.subs.push(pl);
  feedSnap(snap, pl);
}

function onDigest(room, pl, d) {
  if (!pl.live || pl.resyncing) return; // a re-syncing client's digests come from its divergent state
  if (!room.digests.has(d.tick)) room.digests.set(d.tick, { at: performance.now(), m: new Map() });
  room.digests.get(d.tick).m.set(pl.index, d.digest);
  evaluateDigests(room);
}

// Compare once every live player has reported a tick, or after 5 s with whoever has (a laggard is skipped).
function evaluateDigests(room) {
  const now = performance.now();
  const expected = room.byIndex.filter((p) => p?.conn && p.live && !p.resyncing);
  for (const [tick, rec] of room.digests) {
    const complete = expected.every((p) => rec.m.has(p.index));
    if (!complete && now - rec.at < 5000) continue;
    room.digests.delete(tick);
    if (DEBUG) console.error(JSON.stringify({ cmp: tick, closed: room.closed, complete, ageMs: Math.round(now - rec.at), got: [...rec.m.entries()] }));
    if (rec.m.size < 2) continue;
    const votes = new Map();
    for (const v of rec.m.values()) votes.set(v, (votes.get(v) ?? 0) + 1);
    let win = null;
    let best = -1;
    const anchor = Math.min(...rec.m.keys()); // tie-break: the lowest index (the longest-standing player)
    for (const [v, n] of votes) if (n > best || (n === best && rec.m.get(anchor) === v)) [win, best] = [v, n];
    room.stats.compared++;
    for (const [idx, v] of rec.m) {
      if (v === win) continue;
      const bad = room.byIndex[idx];
      if (!bad || bad.resyncing) continue;
      const donor = chooseDonor(room, bad);
      room.stats.desyncs.push({ tick, player: idx, detectedAtTick: room.closed, donor: donor?.index ?? null });
      if (!donor) continue; // nobody to copy from: keep playing, the next comparison will retry
      const snap = startSnapshot(room, donor, [bad], 'resync');
      bad.resyncing = snap;
      bad.snapSub = snap;
      for (const r of room.digests.values()) r.m.delete(bad.index); // queued digests are from the divergent state
      send(bad, P.jsonMsg({ t: 'resync', snapId: snap.id, snapTick: snap.tick, desyncTick: tick }));
    }
  }
}

function onSnapChunk(room, pl, c) {
  const snap = room.snaps.get(c.snapId);
  if (!snap || snap.donor !== pl.index) return;
  const msg = P.encodeSnapChunk(c.snapId, c.index, c.count, c.total, c.bytes);
  snap.chunks[c.index] = msg;
  snap.count = c.count;
  snap.total = c.total;
  snap.received++;
  for (const sub of snap.subs) sendBulk(sub, msg);
  if (snap.received === snap.count) {
    snap.done = true;
    snap.uploadMs = performance.now() - snap.startedAt;
    room.lastSnap = snap;
    room.trimLog();
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/stats') {
    const out = {};
    for (const [id, room] of rooms) {
      out[id] = {
        closed: room.closed,
        compared: room.stats.compared,
        staleOpen: room.stats.staleOpen ?? 0,
        desyncs: room.stats.desyncs,
        snaps: [...room.snaps.values()].map((s) => ({ id: s.id, tick: s.tick, donor: s.donor, reason: s.reason, bytes: s.total, done: s.done, uploadMs: s.uploadMs })),
        players: room.byIndex.filter(Boolean).map((p) => ({ index: p.index, name: p.name, connected: !!p.conn, live: p.live, lag: room.closed - p.simTick, flags: p.flags, msPerTick: p.msPerTick, ...p.stats })),
        events: room.events.slice(-50),
      };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out, null, 1));
    return;
  }
  if (STATIC) {
    const f = path.join(STATIC, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (f.startsWith(path.resolve(STATIC)) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      const type = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript' }[path.extname(f)] ?? 'application/octet-stream';
      res.setHeader('content-type', type);
      res.end(fs.readFileSync(f));
      return;
    }
  }
  res.statusCode = 404;
  res.end();
});

const wss = new WebSocketServer({ server, path: '/mp', maxPayload: 64 << 20 });
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const roomId = q.get('room');
  const token = q.get('token');
  if (!roomId || !token) return ws.close(4000, 'missing room or token');
  if (!rooms.has(roomId)) {
    if (q.get('create') !== '1') return ws.close(4004, 'no such room');
    const r = new Room(roomId);
    r.stats = { compared: 0, desyncs: [] };
    rooms.set(roomId, r);
  }
  const room = rooms.get(roomId);
  let pl = room.players.get(token);
  if (!pl) {
    let index = 0;
    while (room.byIndex[index]) index++;
    pl = { index, token, name: token, conn: null, bulk: null, bulkQueue: [], live: false, streaming: false, inSim: false, simTick: 0, lastHeard: performance.now(), released: false, stats: { inMsgs: 0, inBytes: 0, outMsgs: 0, outBytes: 0, bulkInBytes: 0, bulkOutBytes: 0, late: 0, acts: 0 } };
    room.players.set(token, pl);
    room.byIndex[index] = pl;
  }
  ws.binaryType = 'nodebuffer';
  if (q.get('bulk') === '1') {
    pl.bulk = ws;
    ws.on('message', (data) => {
      const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      pl.stats.bulkInBytes += u8.length;
      if (u8[0] === P.M.SNAP) onSnapChunk(room, pl, P.decodeSnapChunk(u8));
    });
    ws.on('close', () => {
      if (pl.bulk === ws) pl.bulk = null;
    });
    pumpBulk(pl);
    return;
  }
  if (pl.conn) pl.conn.close(4001, 'replaced');
  pl.conn = ws;
  pl.lastHeard = performance.now();
  clearTimeout(pl.graceTimer);
  ws.on('message', (data) => {
    const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    pl.stats.inMsgs++;
    pl.stats.inBytes += u8.length;
    pl.lastHeard = performance.now();
    if (pl.released && pl.live) pl.released = false;
    switch (u8[0]) {
      case P.M.JSON: {
        const msg = P.readJson(u8);
        if (msg.t === 'hello') onHello(room, pl, msg);
        break;
      }
      case P.M.ACT: {
        const wallOpen = Math.floor((performance.now() - room.t0) / TICK) + 1;
        if (wallOpen > room.open()) room.stats.staleOpen = (room.stats.staleOpen ?? 0) + 1; // the clock timer is late
        const open = room.open();
        for (const a of P.decodeAct(u8)) {
          const slack = a.target - open;
          let tick = STAMP === 'relay' ? open : Math.min(Math.max(a.target, open), open + 600);
          if (!pl.inSim) tick = Math.max(tick, open); // nothing special: the sim ignores offline players
          if (!room.pending.has(tick)) room.pending.set(tick, []);
          room.pending.get(tick).push({ tick, player: pl.index, seq: a.seq, bytes: a.bytes });
          pl.stats.acts++;
          if (slack < 0) pl.stats.late++;
          send(pl, P.encodeActAck(a.seq, slack, tick, (performance.now() - room.t0) / TICK));
        }
        break;
      }
      case P.M.STATUS: {
        const s = P.decodeStatus(u8);
        pl.simTick = s.simTick;
        pl.msPerTick = s.msPerTick;
        pl.flags = s.flags;
        pl.bulkRate = s.bulkKiBps * 1024;
        if (s.flags & 1) {
          if (pl.snapSub && !pl.resyncing) pl.snapSub = null;
          if (pl.resyncing && s.simTick > pl.resyncing.tick) {
            pl.resyncing = null;
            pl.snapSub = null;
          }
          if (!pl.live && !pl.resyncing) pl.live = true;
          if (pl.needsJoin) {
            pl.needsJoin = false;
            room.inject(P.A.JOIN, pl.index);
            pl.inSim = true;
          }
        }
        break;
      }
      case P.M.DIGEST:
        onDigest(room, pl, P.decodeDigest(u8));
        break;
      case P.M.PING: {
        const t = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getFloat64(1, true);
        send(pl, P.encodePong(t, (performance.now() - room.t0) / TICK));
        break;
      }
    }
  });
  ws.on('close', () => {
    if (pl.conn !== ws) return;
    pl.conn = null;
    pl.streaming = false;
    if (pl.inSim && !pl.released) {
      room.inject(P.A.RELEASE, pl.index); // stop a walking character at once (FFF-302's StopMovementInTheNextTick)
      pl.released = true;
    }
    pl.graceTimer = setTimeout(() => {
      if (pl.conn || !pl.inSim) return;
      room.inject(P.A.LEAVE, pl.index);
      pl.inSim = false;
      pl.live = false;
    }, GRACE);
  });
});

// Silence detection: a connection that is open but quiet gets its held inputs released.
setInterval(() => {
  for (const room of rooms.values()) for (const pl of room.byIndex) if (pl?.bulkQueue.length) pumpBulk(pl);
}, 10);
setInterval(() => {
  const now = performance.now();
  for (const room of rooms.values()) {
    for (const pl of room.byIndex) {
      if (pl?.conn && pl.inSim && !pl.released && now - pl.lastHeard > SILENCE) {
        room.inject(P.A.RELEASE, pl.index);
        pl.released = true;
      }
      if (pl) pumpBulk(pl);
    }
    evaluateDigests(room);
  }
}, 100);

server.listen(PORT, '127.0.0.1', () => console.log(JSON.stringify({ relay: 'listening', port: PORT, hz: HZ, stamp: STAMP })));
