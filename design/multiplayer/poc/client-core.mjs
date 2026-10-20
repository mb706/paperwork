// Lockstep client (DESIGN.md §3–§5): stamps its actions with target ticks from an estimate of the relay
// clock plus an adaptive margin, plays closed ticks out of an adaptive jitter buffer, catches up in time
// slices, donates snapshots, re-syncs in the background (shadow sim, then swap), and resumes after reconnects.
// Runs in Node 24 (global WebSocket) and in a browser dedicated worker.
import * as P from './protocol.mjs';
import { MAP, Sim } from './sim.mjs';

const TICK = P.TICK_MS;
const EMPTY = [];
const CHUNK = 64 << 10;

// A LEDBAT-like (RFC 6817) delay-based rate controller for snapshot transfers: keep the queueing delay the
// transfer adds on our own access link under TARGET ms, measured as control-channel RTT over its minimum.
class Pacer {
  constructor() {
    this.rate = 256 << 10; // bytes per second
    this.target = 25;
    this.at = 0;
  }
  update(now, rttRecent, rttBase) {
    if (now - this.at < 100 || !Number.isFinite(rttRecent)) return;
    this.at = now;
    const qd = rttRecent - rttBase;
    if (qd > this.target) this.rate = Math.max(32 << 10, this.rate * 0.7);
    else this.rate = Math.min(100 << 20, this.rate * 1.12 + (32 << 10));
  }
}

function pct(a, q) {
  if (!a.length) return null;
  const s = Float64Array.from(a).sort();
  return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2);
}

export class Client {
  constructor(o) {
    this.o = { stamp: 'client', pacing: 'both', bot: true, seed: 7, costMs: 0, padBytes: 0, ...o };
    this.now = o.now ?? (() => performance.now());
    this.sim = null;
    this.shadow = null; // background re-sync target
    this.closures = new Map(); // tick -> entries (non-empty ticks only)
    this.horizon = 0; // every tick <= horizon is closed and known
    this.retainFrom = Infinity; // keep closures from here on (a shadow sim still needs them)
    this.mode = 'connecting';
    this.index = -1;
    this.inGame = false;
    this.epoch = 0;
    this.seq = 0;
    this.margin = 2;
    this.needWin = []; // [time, ticks of margin each recent action needed]
    this.lastMarginDecay = 0;
    this.sent = new Map(); // seq -> { at, target, predicted, kind }
    this.clock = { best: null, samples: [] };
    this.minRtt = Infinity;
    this.pacer = new Pacer();
    this.play = { base: Infinity, baseSamples: [], late: [], delay: 2 * TICK, lastAdapt: 0 };
    this.timer = null;
    this.reconnects = 0;
    this.backoff = 0;
    this.lastHeard = 0;
    this.msPerTick = 0;
    this.rng = this.o.seed >>> 0 || 1;
    this.botState = { until: 0, walking: false, dir: 0 };
    this.st = {
      confirmMs: [], applyMs: [], inputDelayTicks: [], predErrTicks: [], lead: [], stalls: [], late: 0, acts: 0,
      ticksMsgs: 0, inBytes: 0, outBytes: 0, outMsgs: 0, catchups: [], resyncs: [], joins: [], margins: [], digests: 0,
      predSigned: [], clockErr: [], relayStale: [], transferRtt: [], idleRtt: [], checkpoints: {}, fullCheckpoints: {},
    };
  }

  // ---------- connection ----------
  start() {
    this.connect();
    this.statusTimer = setInterval(() => this.status(), 100);
    this.pingTimer = setInterval(() => {
      if (this.transferring() || ++this.pingN % 5 === 0) this.ping(); // 10 Hz during transfers, else 2 Hz
    }, 100);
    this.pingN = 0;
    this.botTimer = setInterval(() => this.botStep(), 100);
    this.watchdog = setInterval(() => {
      if (this.ws?.readyState === 1 && this.now() - this.lastHeard > 1500) this.replaceSocket(); // silent link
    }, 250);
  }
  stop() {
    for (const t of [this.statusTimer, this.pingTimer, this.botTimer, this.watchdog]) clearInterval(t);
    clearTimeout(this.timer);
    this.stopped = true;
    this.stopShadow();
    this.ws?.close();
    this.bulk?.close();
  }
  // A silent or broken link is replaced at once: close() would first drain queued sends and can take minutes
  // to report onclose on a black-holed path (review finding 3).
  replaceSocket() {
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      try {
        old.close();
      } catch {}
    }
    this.reconnects++;
    this.connect();
  }
  url(extra = '') {
    return `${this.o.url}?room=${encodeURIComponent(this.o.room)}&token=${encodeURIComponent(this.o.token)}${extra}`;
  }
  connect() {
    if (this.stopped) return;
    const ws = new WebSocket(this.url(this.o.create ? '&create=1' : ''));
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.lastHeard = this.now();
      this.backoff = 0;
      const resumeFrom = this.sim && this.mode !== 'loading' ? this.horizon + 1 : undefined;
      this.sendCtl(P.jsonMsg({ t: 'hello', name: this.o.name, resumeFrom }));
      for (let i = 0; i < 4; i++) setTimeout(() => this.ping(), 50 * i);
    };
    ws.onmessage = (ev) => this.onMessage(new Uint8Array(ev.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      this.reconnects++;
      this.backoff = Math.min(2000, this.backoff ? this.backoff * 2 : 100);
      setTimeout(() => this.connect(), this.backoff);
    };
  }
  sendCtl(msg) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(msg);
    this.st.outMsgs++;
    this.st.outBytes += msg.length;
    return true;
  }
  openBulk() {
    if (this.bulk && this.bulk.readyState <= 1) return;
    const b = new WebSocket(this.url('&bulk=1'));
    b.binaryType = 'arraybuffer';
    b.onmessage = (ev) => this.onSnapChunk(P.decodeSnapChunk(new Uint8Array(ev.data)));
    b.onclose = () => {
      if (this.bulk === b) this.bulk = null;
      if (this.snapWait && !this.stopped) setTimeout(() => this.openBulk(), 200);
    };
    this.bulk = b;
  }

  // ---------- messages ----------
  onMessage(u8) {
    this.lastHeard = this.now();
    this.st.inBytes += u8.length;
    switch (u8[0]) {
      case P.M.JSON:
        return this.onJson(P.readJson(u8));
      case P.M.TICKS: {
        let msg;
        try {
          msg = P.decodeTicks(u8);
        } catch (e) {
          this.log?.({ malformed: String(e.message) });
          this.replaceSocket();
          return;
        }
        return this.onTicks(msg);
      }
      case P.M.ACTACK:
        return this.onActAck(P.decodeActAck(u8));
      case P.M.PONG:
        return this.onPong(P.decodePong(u8));
    }
  }
  onJson(m) {
    if (m.t === 'welcome') {
      this.index = m.index;
      if (m.epoch !== undefined && m.mode !== 'snapshot') this.epoch = m.epoch;
      if (m.mode === 'snapshot') this.pendingEpoch = m.epoch;
      if (m.mode === 'new') {
        this.sim = this.makeSim(new Sim(1));
        this.mode = 'live';
        this.schedule(0);
      } else if (m.mode === 'snapshot') {
        this.sim = null;
        this.mode = 'loading';
        this.helloAt = this.now();
        this.snapWait = { id: m.snapId, tick: m.snapTick, chunks: [], got: 0, bytes: 0, shadow: false, t0: this.now() };
        this.openBulk();
      }
      this.log?.({ welcome: m });
    } else if (m.t === 'resync') {
      // Background re-sync: keep playing the divergent sim, load the donor's state beside it, then swap.
      this.st.resyncs.push({ desyncTick: m.desyncTick, snapTick: m.snapTick, startedAt: this.now() });
      this.pendingEpoch = m.epoch; // adopted when the re-synced state is swapped in
      this.snapWait = { id: m.snapId, tick: m.snapTick, chunks: [], got: 0, bytes: 0, shadow: true, t0: this.now() };
      this.retainFrom = Math.min(this.retainFrom, m.snapTick + 1);
      this.openBulk();
    } else if (m.t === 'error') {
      this.log?.({ error: m });
    }
  }
  onTicks(msg) {
    const now = this.now();
    this.st.ticksMsgs++;
    if (msg.first > this.horizon + 1 && this.horizon > 0) {
      this.log?.({ gap: [this.horizon, msg.first] }); // never advance the horizon over a gap (review finding 9)
      this.replaceSocket();
      return;
    }
    for (const en of msg.entries) {
      if (en.tick <= this.horizon) continue; // duplicate after a resume
      let list = this.closures.get(en.tick);
      if (!list) {
        list = [];
        this.closures.set(en.tick, list);
      }
      list.push(en);
      if (en.player === this.index) {
        const s = this.sent.get(en.seq);
        if (s) s.confirmedAt = now;
        if (s) this.st.confirmMs.push(now - s.at);
      }
    }
    if (this.sw && msg.last > this.horizon) {
      const list = [];
      for (let t = Math.max(msg.first, this.swFrom + 1); t <= msg.last; t++) if (this.closures.has(t)) list.push([t, this.closures.get(t)]);
      this.sw.post({ t: 'closures', list, horizon: msg.last });
    }
    if (msg.last > this.horizon) {
      this.horizon = msg.last;
      // Playout schedule: base = earliest observed (arrival - tick*TICK); lateness = how much later this one is.
      const b = now - msg.last * TICK;
      this.play.baseSamples.push([now, b]);
      if (b < this.play.base) this.play.base = b;
      this.play.late.push([now, b - this.play.base]);
    }
    if (this.o.pacing !== 'timer') this.pump();
  }
  onActAck(a) {
    const s = this.sent.get(a.seq);
    if (!s) return;
    // need = the margin that would have made this action exactly on time (one-way delay plus clock error, in ticks)
    const need = s.margin - a.slack;
    this.needWin.push([this.now(), need]);
    if (a.slack < 0) {
      this.st.late++;
      if (this.needWin.length < 5) this.margin = Math.min(60, Math.max(this.margin, need)); // first calibration only
    }
    this.st.inputDelayTicks.push(a.assigned - s.estOpenAtSend);
    if (s.kind === P.A.WALK || s.kind === P.A.STOP) {
      this.st.predErrTicks.push(Math.abs(a.assigned - s.predicted));
      this.st.predSigned.push(a.assigned - s.predicted);
      // split the error: clock estimate (predicted vs. the relay's true open tick) and relay staleness
      this.st.clockErr.push(Math.floor(a.arrivalTick) + 1 - s.predicted);
      this.st.relayStale.push(a.assigned - (Math.floor(a.arrivalTick) + 1));
    }
    s.assigned = a.assigned;
  }
  ping() {
    const m = P.encodePing(this.now());
    this.sendCtl(m);
  }
  onPong(p) {
    const now = this.now();
    const rtt = now - p.t;
    // relay's fractional tick at our "now", assuming a symmetric path
    const sample = { at: now, rtt, tickAt: p.relayTick + rtt / 2 / TICK };
    this.clock.samples = this.clock.samples.filter((s) => now - s.at < 10000);
    this.clock.samples.push(sample);
    this.clock.best = this.clock.samples.reduce((a, s) => (s.rtt < a.rtt ? s : a));
    this.rtt = rtt;
    this.minRtt = Math.min(this.minRtt, rtt);
    const recent = this.clock.samples.slice(-3).map((s) => s.rtt);
    if (this.transferring()) {
      this.pacer.update(now, Math.min(...recent), this.minRtt);
      this.st.transferRtt.push(rtt);
    } else this.st.idleRtt.push(rtt);
  }
  transferring() {
    return !!this.uploading || (!!this.snapWait && this.snapWait.shadow);
  }
  stopShadow() {
    this.sw?.terminate();
  }
  relayTickNow() {
    const b = this.clock.best;
    if (!b) return this.horizon + 1;
    return b.tickAt + (this.now() - b.at) / TICK;
  }

  // ---------- actions ----------
  act(bytes) {
    if (!this.inGame || this.ws?.readyState !== 1) return;
    this.seq = (this.seq + 1) & 0xffff;
    const seq = this.seq;
    const estOpen = Math.floor(this.relayTickNow()) + 1;
    // Targets never decrease, even when the margin shrinks or the clock estimate moves back (finding 2).
    const target = Math.max(this.o.stamp === 'client' ? estOpen + this.margin : estOpen, this.lastTarget ?? 0);
    this.lastTarget = target;
    // What the client would predict: its own stamp, or (relay stamping) the tick it expects on arrival.
    const predicted = this.o.stamp === 'client' ? target : Math.floor(this.relayTickNow() + (this.clock.best?.rtt ?? 0) / 2 / TICK) + 1;
    this.sent.set(seq, { at: this.now(), target, predicted, estOpenAtSend: estOpen, kind: bytes[0], margin: this.margin });
    if (this.sent.size > 4096) this.sent.delete(this.sent.keys().next().value);
    this.st.acts++;
    this.sendCtl(P.encodeAct([{ seq, target, bytes }]));
  }
  rand() {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }
  botStep() {
    if (!this.o.bot || !this.inGame || !this.sim) return;
    const now = this.now();
    const b = this.botState;
    if (now < b.until) return;
    const me = this.sim.playerPos(this.index);
    const tx = me.x >> 8;
    const ty = me.y >> 8;
    if (b.walking) {
      this.act(P.actStop());
      b.walking = false;
      b.until = now + 200 + this.rand() * 600;
      return;
    }
    const r = this.rand();
    if (r < 0.5) {
      // walk toward the map centre-ish so players stay on the map
      b.dir = Math.floor(this.rand() * 8);
      if (tx < 6) b.dir = 0;
      if (tx > MAP - 7) b.dir = 4;
      if (ty < 6) b.dir = 2;
      if (ty > MAP - 7) b.dir = 6;
      this.act(P.actWalk(b.dir));
      b.walking = true;
      b.until = now + 300 + this.rand() * 1200;
    } else if (r < 0.75) {
      this.act(P.actBuild(tx + Math.floor(this.rand() * 7) - 3, ty + Math.floor(this.rand() * 7) - 3, this.rand() < 0.5 ? 1 : 2));
      b.until = now + 150 + this.rand() * 400;
    } else if (r < 0.9) {
      this.act(P.actMine(tx + Math.floor(this.rand() * 5) - 2, ty + Math.floor(this.rand() * 5) - 2));
      b.until = now + 150 + this.rand() * 400;
    } else {
      this.act(P.actCraft(1 + Math.floor(this.rand() * 3)));
      b.until = now + 300;
    }
  }

  // ---------- simulation and pacing ----------
  makeSim(s) {
    s.costMs = this.o.costMs;
    s.sleep = this.o.sleep ?? null;
    s.padBytes = this.o.padBytes;
    return s;
  }
  due(t) {
    return this.play.base + t * TICK + this.play.delay + (this.o.extraDelayMs ?? 0);
  }
  adaptPlayout(now) {
    if (now - this.play.lastAdapt < 1000) return;
    this.play.lastAdapt = now;
    this.play.baseSamples = this.play.baseSamples.filter(([at]) => now - at < 20000);
    if (this.play.baseSamples.length) this.play.base = Math.min(...this.play.baseSamples.map(([, b]) => b)); // tracks drift
    // Playout delay: grow at once to the 99th percentile of lateness over 30 s, shrink by 1 ms per second.
    // (Recomputing from scratch every second undid the widening after each underrun.)
    this.play.late = this.play.late.filter(([at]) => now - at < 30000);
    const p99 = pct(
      this.play.late.map(([, l]) => l),
      0.99,
    );
    if (p99 !== null) {
      const target = Math.min(30 * TICK, Math.max(0.5 * TICK, p99 + 4));
      this.play.delay = target > this.play.delay ? target : Math.max(target, this.play.delay - 1);
    }
    // Margin = the 95th percentile of what recent actions needed: rare loss stalls make a few actions late
    // (the relay moves them) instead of inflating everybody's input delay for a minute.
    this.needWin = this.needWin.filter(([at]) => now - at < 30000);
    if (this.needWin.length >= 5) {
      const p95 = pct(
        this.needWin.map(([, n]) => n),
        0.95,
      );
      this.margin = Math.min(60, Math.max(1, Math.ceil(p95)));
    }
    if (now - this.lastMarginDecay > 5000) {
      this.lastMarginDecay = now;
      this.st.margins.push(this.margin);
    }
  }
  schedule(ms) {
    clearTimeout(this.timer);
    if (this.o.pacing === 'net') return;
    this.timer = setTimeout(() => this.pump(), Math.max(0, ms));
  }
  pump() {
    if (!this.sim || this.mode === 'loading' || !Number.isFinite(this.play.base)) return; // no tick stream yet
    const now = this.now();
    this.adaptPlayout(now);
    if (this.mode === 'catchup') return;
    const lead = this.horizon - this.sim.tick;
    if (lead > Math.ceil((this.play.delay + (this.o.extraDelayMs ?? 0)) / TICK) + 30) {
      this.beginCatchup('behind');
      return;
    }
    let ran = 0;
    while (this.sim.tick < this.horizon && this.due(this.sim.tick + 1) <= now && ran < 3) {
      this.applyNext();
      ran++;
    }
    this.st.lead.push(this.horizon - this.sim.tick);
    if (this.sim.tick >= this.horizon && this.due(this.sim.tick + 1) <= now - TICK) {
      if (!this.stallAt) this.stallAt = this.due(this.sim.tick + 1);
    } else if (this.stallAt) {
      this.st.stalls.push(now - this.stallAt);
      this.play.delay = Math.min(30 * TICK, this.play.delay + TICK); // an underrun widens the buffer at once
      this.stallAt = 0;
    }
    this.schedule(this.due(this.sim.tick + 1) - now - 1);
    this.maybeShadow();
  }
  beginCatchup(reason) {
    this.mode = 'catchup';
    this.catchStart = this.now();
    this.catchFrom = this.sim.tick;
    this.catchReason = reason;
    this.catchSlice();
  }
  catchSlice() {
    if (this.mode !== 'catchup' || this.stopped) return;
    const t0 = this.now();
    while (this.sim.tick < this.horizon && this.now() - t0 < 12) this.applyNext();
    if (this.horizon - this.sim.tick <= Math.ceil((this.play.delay + (this.o.extraDelayMs ?? 0)) / TICK) + 2) {
      const ms = this.now() - this.catchStart;
      this.st.catchups.push({ reason: this.catchReason, ticks: this.sim.tick - this.catchFrom, ms: +ms.toFixed(0), msPerTick: +this.msPerTick.toFixed(3) });
      this.mode = 'live';
      this.status();
      this.schedule(0);
      return;
    }
    (this.o.yield ?? ((f) => setTimeout(f, 0)))(() => this.catchSlice());
  }
  applyNext() {
    const t = this.sim.tick + 1;
    const entries = this.closures.get(t) ?? EMPTY;
    const t0 = this.now();
    this.sim.step(entries);
    const dt = this.now() - t0;
    this.msPerTick = this.msPerTick ? this.msPerTick * 0.98 + dt * 0.02 : dt;
    for (const en of entries) this.afterEntry(en, t);
    if (this.o.corruptAt === t) this.sim.corrupt();
    if (t % 60 === 0 && this.mode !== 'loading') {
      this.sendCtl(P.encodeDigest(t, this.sim.rolling, this.epoch));
      this.st.digests++;
    }
    if (t % 600 === 0) {
      this.st.checkpoints[t] = this.sim.rolling;
      this.st.fullCheckpoints[t] = this.sim.fullHash(); // canonical state, independent of digest history (finding 15)
    }
    if (t < this.retainFrom) this.closures.delete(t);
    if (this.pendingSwap) this.swapIfReady();
  }
  afterEntry(en, t) {
    if (en.player === this.index) {
      const s = this.sent.get(en.seq);
      if (s && !s.appliedAt) {
        s.appliedAt = this.now();
        this.st.applyMs.push(s.appliedAt - s.at);
      }
      return;
    }
    if (en.player !== P.SYSTEM) return;
    const [kind, idx] = en.bytes;
    const extra = en.bytes[2] | (en.bytes[3] << 8) | (en.bytes[4] << 16) | (en.bytes[5] << 24);
    if (idx !== this.index) return;
    if (kind === P.A.JOIN) {
      this.inGame = true;
      if (this.helloAt) this.st.joins.push({ toInGameMs: +(this.now() - this.helloAt).toFixed(0) });
    } else if (kind === P.A.LEAVE) this.inGame = false;
    else if (kind === P.A.RELEASE && this.botState.walking) this.act(P.actWalk(this.botState.dir)); // re-send held input
    else if (kind === P.A.SNAPMARK && t === this.sim.tick) this.donate(extra);
  }

  // ---------- snapshots ----------
  donate(snapId) {
    const t0 = this.now();
    const bytes = this.sim.serialize(); // the real engine copies pools here and compresses in the IO worker
    const paced = this.o.bulkPace === 'ledbat';
    // Paced uploads use 16 KiB chunks: one 64 KiB chunk alone holds a 2 Mbit/s uplink for 262 ms (finding 10).
    const size = paced ? 16 << 10 : CHUNK;
    const count = Math.max(1, Math.ceil(bytes.length / size));
    this.openBulk();
    let i = 0;
    let tokens = 0;
    let last = this.now();
    this.uploading = { snapId, t0, bytes: bytes.length };
    const pumpUp = () => {
      if (this.stopped) return;
      if (this.bulk?.readyState !== 1) return setTimeout(pumpUp, 20);
      const now = this.now();
      tokens = Math.min(Math.max(this.pacer.rate * 0.1, size), tokens + ((now - last) / 1000) * this.pacer.rate); // >= one chunk (finding 10)
      last = now;
      while (i < count && this.bulk.bufferedAmount < (paced ? size : 2 << 20)) {
        if (paced && tokens < size) break;
        tokens -= size;
        this.bulk.send(P.encodeSnapChunk(snapId, i, count, bytes.length, bytes.subarray(i * size, (i + 1) * size)));
        i++;
      }
      if (i < count || this.bulk.bufferedAmount > 0) return setTimeout(pumpUp, 10);
      this.st.uploads = [...(this.st.uploads ?? []), { bytes: bytes.length, ms: Math.round(this.now() - t0), paced }];
      this.uploading = null;
    };
    pumpUp();
    this.st.donations = (this.st.donations ?? 0) + 1;
    this.st.serializeMs = +(this.now() - t0).toFixed(1);
  }
  onSnapChunk(c) {
    const w = this.snapWait;
    if (!w || c.snapId !== w.id || w.chunks[c.index]) return; // duplicates count once
    w.count ??= c.count;
    w.total ??= c.total;
    if (c.count !== w.count || c.total !== w.total || c.index >= c.count || c.bytes.length > CHUNK) return; // bounds (finding 11)
    w.chunks[c.index] = c.bytes.slice();
    w.got++;
    w.bytes += c.bytes.length;
    if (w.got < c.count) return;
    if (w.bytes !== c.total) return; // the manifest's size must match exactly
    const all = new Uint8Array(c.total);
    let o = 0;
    for (const ch of w.chunks) {
      all.set(ch, o);
      o += ch.length;
    }
    const downloadMs = this.now() - w.t0;
    const t1 = this.now();
    const s = this.makeSim(Sim.deserialize(all));
    const loadMs = this.now() - t1;
    this.snapWait = null;
    this.bulk?.close();
    for (const t of this.closures.keys()) if (t <= w.tick) this.closures.delete(t);
    if (w.shadow) {
      this.st.resyncs.at(-1).downloadMs = +downloadMs.toFixed(0);
      this.st.resyncs.at(-1).bytes = c.total;
      if (this.o.makeShadow) {
        // A second thread loads the donor's state and catches up while this one keeps playing.
        this.sw = this.o.makeShadow();
        this.sw.onmessage = (m) => this.onShadowMsg(m);
        this.sw.post({ t: 'load', bytes: all.buffer, costMs: this.o.costMs, padBytes: this.o.padBytes }, [all.buffer]);
        this.sw.post({ t: 'closures', list: [...this.closures].filter(([t]) => t > w.tick), horizon: this.horizon });
        this.swFrom = w.tick;
      } else {
        this.shadow = s;
        this.maybeShadow();
      }
    } else {
      this.sim = s;
      this.epoch = this.pendingEpoch ?? this.epoch;
      this.st.lastSnap = { bytes: c.total, downloadMs: +downloadMs.toFixed(0), loadMs: +loadMs.toFixed(1), tick: w.tick };
      this.beginCatchup('join');
    }
  }
  onShadowMsg(m) {
    if (m.t === 'progress' && !this.swHandover && m.tick >= this.sim.tick - 10) {
      this.swHandover = this.sim.tick + 30; // half a second ahead of the live sim
      this.sw.post({ t: 'handover', tick: this.swHandover });
    } else if (m.t === 'state') {
      this.pendingSwap = { tick: m.tick, sim: this.makeSim(Sim.deserialize(new Uint8Array(m.bytes))) };
      this.sw.terminate();
      this.sw = null;
    }
  }
  swapIfReady() {
    const p = this.pendingSwap;
    if (!p || this.sim.tick < p.tick) return;
    while (p.sim.tick < this.sim.tick) p.sim.step(this.closures.get(p.sim.tick + 1) ?? EMPTY); // late state: catch up the last ticks
    const r = this.st.resyncs.at(-1);
    r.swappedAfterMs = +(this.now() - r.startedAt).toFixed(0);
    r.divergedBeforeSwap = p.sim.rolling !== this.sim.rolling;
    r.viaWorker = true;
    this.sim = p.sim;
    this.epoch = this.pendingEpoch ?? this.epoch;
    this.pendingSwap = null;
    this.swHandover = 0;
    this.retainFrom = Infinity;
    for (const t of this.closures.keys()) if (t <= this.sim.tick) this.closures.delete(t);
  }
  maybeShadow() {
    // Bring the shadow sim up to the live one in slices, then swap it in (the "background re-sync").
    if (!this.shadow || this.mode === 'catchup') return;
    // Fallback without a shadow worker: time-slice the shadow on the live sim's thread (4 ms per wake).
    // That saturates the thread at late-game tick costs (DESIGN.md §12.6); the design uses a second worker.
    const t0 = this.now();
    while (this.shadow.tick < this.sim.tick && this.now() - t0 < 4) {
      const t = this.shadow.tick + 1;
      this.shadow.step(this.closures.get(t) ?? EMPTY);
    }
    if (this.shadow.tick === this.sim.tick) {
      const r = this.st.resyncs.at(-1);
      r.swappedAfterMs = +(this.now() - r.startedAt).toFixed(0);
      r.divergedBeforeSwap = this.shadow.rolling !== this.sim.rolling;
      this.sim = this.shadow;
      this.shadow = null;
      this.epoch = this.pendingEpoch ?? this.epoch;
      this.retainFrom = Infinity;
      for (const t of this.closures.keys()) if (t <= this.sim.tick) this.closures.delete(t);
    }
  }

  status() {
    if (!this.sim && this.mode !== 'loading') return;
    const live = this.mode === 'live' && !this.snapWait && !this.shadow && !this.sw && !this.pendingSwap ? 1 : 0;
    const hidden = this.o.hidden?.() ? 2 : 0;
    const pace = this.o.bulkPace === 'ledbat' && this.snapWait?.shadow ? this.pacer.rate / 1024 : 0;
    this.sendCtl(P.encodeStatus(this.sim?.tick ?? 0, this.horizon, this.msPerTick, live | hidden, pace));
  }

  summary() {
    const st = this.st;
    return {
      index: this.index,
      mode: this.mode,
      tick: this.sim?.tick,
      horizon: this.horizon,
      rolling: this.sim?.rolling,
      fullHash: this.sim?.fullHash(),
      acts: st.acts,
      late: st.late,
      reconnects: this.reconnects,
      margin: this.margin,
      marginTrace: st.margins,
      playoutDelayMs: +this.play.delay.toFixed(1),
      rttMs: this.clock.best ? +this.clock.best.rtt.toFixed(1) : null,
      confirmMs: { p50: pct(st.confirmMs, 0.5), p95: pct(st.confirmMs, 0.95), p99: pct(st.confirmMs, 0.99) },
      applyMs: { p50: pct(st.applyMs, 0.5), p95: pct(st.applyMs, 0.95), p99: pct(st.applyMs, 0.99) },
      inputDelayTicks: { p50: pct(st.inputDelayTicks, 0.5), p95: pct(st.inputDelayTicks, 0.95) },
      predErrTicks: { mean: st.predErrTicks.length ? +(st.predErrTicks.reduce((a, b) => a + b, 0) / st.predErrTicks.length).toFixed(3) : null, p95: pct(st.predErrTicks, 0.95), nonzeroShare: st.predErrTicks.length ? +(st.predErrTicks.filter((x) => x > 0).length / st.predErrTicks.length).toFixed(3) : null },
      predSigned: st.predSigned.length ? { mean: +(st.predSigned.reduce((a, b) => a + b, 0) / st.predSigned.length).toFixed(3), min: Math.min(...st.predSigned), max: Math.max(...st.predSigned) } : null,
      clockErr: st.clockErr.length ? { mean: +(st.clockErr.reduce((a, b) => a + b, 0) / st.clockErr.length).toFixed(3), nonzero: st.clockErr.filter((x) => x).length, n: st.clockErr.length } : null,
      relayStale: st.relayStale.length ? { mean: +(st.relayStale.reduce((a, b) => a + b, 0) / st.relayStale.length).toFixed(3), nonzero: st.relayStale.filter((x) => x).length } : null,
      leadTicks: { p50: pct(st.lead, 0.5), p95: pct(st.lead, 0.95) },
      stalls: { n: st.stalls.length, totalMs: +st.stalls.reduce((a, b) => a + b, 0).toFixed(0), maxMs: st.stalls.length ? +Math.max(...st.stalls).toFixed(0) : 0 },
      catchups: st.catchups,
      joins: st.joins,
      lastSnap: st.lastSnap ?? null,
      donations: st.donations ?? 0,
      resyncs: st.resyncs,
      msPerTick: +this.msPerTick.toFixed(3),
      checkpoints: st.checkpoints,
      fullCheckpoints: st.fullCheckpoints,
      inGame: this.inGame,
      epoch: this.epoch,
      bytes: { in: st.inBytes, out: st.outBytes, outMsgs: st.outMsgs, ticksMsgs: st.ticksMsgs, digests: st.digests },
      uploads: st.uploads ?? [],
      rttIdle: { p50: pct(st.idleRtt, 0.5), p95: pct(st.idleRtt, 0.95) },
      rttDuringTransfer: { p50: pct(st.transferRtt, 0.5), p95: pct(st.transferRtt, 0.95), n: st.transferRtt.length },
    };
  }
}
