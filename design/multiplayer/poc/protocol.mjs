// Wire format for the multiplayer proof of concept (design/multiplayer/DESIGN.md §3.1).
// Binary for everything per tick; JSON only for rare control messages.
// Runs unchanged in Node 24 and in a browser worker.

export const TICK_MS = 1000 / 60;
export const SYSTEM = 255; // player index of relay-injected system actions

// Message types: the first byte of every WebSocket message.
export const M = {
  JSON: 0x00, // control, both directions: u8 type | utf-8 JSON
  TICKS: 0x10, // relay -> client: closed ticks [first, last] and their actions
  ACT: 0x11, // client -> relay: actions stamped with target ticks
  ACTACK: 0x12, // relay -> sender: assigned tick and slack per action
  STATUS: 0x13, // client -> relay: sim tick, horizon, ms per tick, flags
  DIGEST: 0x14, // client -> relay: rolling state digest at a tick
  PING: 0x15, // client -> relay
  PONG: 0x16, // relay -> client
  SNAP: 0x20, // bulk channel, both directions: snapshot chunk
};

// Action kinds of the toy sim. Player actions < 100; system actions >= 100.
export const A = { WALK: 1, STOP: 2, BUILD: 3, MINE: 4, CRAFT: 5, JOIN: 100, LEAVE: 101, RELEASE: 102, SNAPMARK: 103 };

const enc = new TextEncoder();
const dec = new TextDecoder();

export function jsonMsg(obj) {
  const b = enc.encode(JSON.stringify(obj));
  const out = new Uint8Array(1 + b.length);
  out[0] = M.JSON;
  out.set(b, 1);
  return out;
}
export function readJson(u8) {
  return JSON.parse(dec.decode(u8.subarray(1)));
}

// TICKS: u8 type | u32 first | u32 last | u16 n | n × (u32 tick | u8 player | u16 seq | u16 len | bytes)
// "All ticks first..last are closed; these are all their actions, in execution order."
export function encodeTicks(first, last, entries) {
  let size = 11;
  for (const e of entries) size += 9 + e.bytes.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = M.TICKS;
  dv.setUint32(1, first, true);
  dv.setUint32(5, last, true);
  dv.setUint16(9, entries.length, true);
  let o = 11;
  for (const e of entries) {
    dv.setUint32(o, e.tick, true);
    out[o + 4] = e.player;
    dv.setUint16(o + 5, e.seq, true);
    dv.setUint16(o + 7, e.bytes.length, true);
    out.set(e.bytes, o + 9);
    o += 9 + e.bytes.length;
  }
  return out;
}
export function decodeTicks(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const first = dv.getUint32(1, true);
  const last = dv.getUint32(5, true);
  const n = dv.getUint16(9, true);
  const entries = [];
  let o = 11;
  for (let i = 0; i < n; i++) {
    const len = dv.getUint16(o + 7, true);
    entries.push({ tick: dv.getUint32(o, true), player: u8[o + 4], seq: dv.getUint16(o + 5, true), bytes: u8.slice(o + 9, o + 9 + len) });
    o += 9 + len;
  }
  return { first, last, entries };
}

// ACT: u8 type | u8 n | n × (u16 seq | u32 target | u16 len | bytes)
export function encodeAct(list) {
  let size = 2;
  for (const a of list) size += 8 + a.bytes.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = M.ACT;
  out[1] = list.length;
  let o = 2;
  for (const a of list) {
    dv.setUint16(o, a.seq, true);
    dv.setUint32(o + 2, a.target, true);
    dv.setUint16(o + 6, a.bytes.length, true);
    out.set(a.bytes, o + 8);
    o += 8 + a.bytes.length;
  }
  return out;
}
export function decodeAct(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8[1];
  const list = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    const len = dv.getUint16(o + 6, true);
    list.push({ seq: dv.getUint16(o, true), target: dv.getUint32(o + 2, true), bytes: u8.slice(o + 8, o + 8 + len) });
    o += 8 + len;
  }
  return list;
}

// ACTACK: u8 type | u16 seq | i16 slack | u32 assigned | f32 relay tick at arrival (fractional; diagnostics)
// (slack = target - open tick on arrival; < 0 means late)
export function encodeActAck(seq, slack, assigned, arrivalTick = 0) {
  const out = new Uint8Array(13);
  const dv = new DataView(out.buffer);
  out[0] = M.ACTACK;
  dv.setUint16(1, seq, true);
  dv.setInt16(3, Math.max(-32768, Math.min(32767, slack)), true);
  dv.setUint32(5, assigned, true);
  dv.setFloat32(9, arrivalTick, true);
  return out;
}
export function decodeActAck(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { seq: dv.getUint16(1, true), slack: dv.getInt16(3, true), assigned: dv.getUint32(5, true), arrivalTick: dv.getFloat32(9, true) };
}

// STATUS: u8 type | u32 simTick | u32 horizon | u16 centi-ms per tick | u8 flags (1 = live, 2 = hidden page)
//         | u16 bulk rate the client accepts while playing (KiB/s, 0 = unlimited)
export function encodeStatus(simTick, horizon, msPerTick, flags, bulkKiBps = 0) {
  const out = new Uint8Array(14);
  const dv = new DataView(out.buffer);
  out[0] = M.STATUS;
  dv.setUint32(1, Math.max(0, simTick), true);
  dv.setUint32(5, Math.max(0, horizon), true);
  dv.setUint16(9, Math.min(65535, Math.round(msPerTick * 100)), true);
  out[11] = flags;
  dv.setUint16(12, Math.min(65535, Math.round(bulkKiBps)), true);
  return out;
}
export function decodeStatus(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { simTick: dv.getUint32(1, true), horizon: dv.getUint32(5, true), msPerTick: dv.getUint16(9, true) / 100, flags: u8[11], bulkKiBps: u8.length >= 14 ? dv.getUint16(12, true) : 0 };
}

// DIGEST: u8 type | u32 tick | i32 digest
export function encodeDigest(tick, digest) {
  const out = new Uint8Array(9);
  const dv = new DataView(out.buffer);
  out[0] = M.DIGEST;
  dv.setUint32(1, tick, true);
  dv.setInt32(5, digest, true);
  return out;
}
export function decodeDigest(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { tick: dv.getUint32(1, true), digest: dv.getInt32(5, true) };
}

// PING: u8 type | f64 client time.  PONG: u8 type | f64 client time | f64 relay tick (fractional)
export function encodePing(t) {
  const out = new Uint8Array(9);
  new DataView(out.buffer).setFloat64(1, t, true);
  out[0] = M.PING;
  return out;
}
export function encodePong(t, relayTick) {
  const out = new Uint8Array(17);
  const dv = new DataView(out.buffer);
  out[0] = M.PONG;
  dv.setFloat64(1, t, true);
  dv.setFloat64(9, relayTick, true);
  return out;
}
export function decodePong(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { t: dv.getFloat64(1, true), relayTick: dv.getFloat64(9, true) };
}

// SNAP chunk: u8 type | u32 snapId | u32 index | u32 count | u32 totalBytes | bytes
export function encodeSnapChunk(snapId, index, count, total, bytes) {
  const out = new Uint8Array(17 + bytes.length);
  const dv = new DataView(out.buffer);
  out[0] = M.SNAP;
  dv.setUint32(1, snapId, true);
  dv.setUint32(5, index, true);
  dv.setUint32(9, count, true);
  dv.setUint32(13, total, true);
  out.set(bytes, 17);
  return out;
}
export function decodeSnapChunk(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { snapId: dv.getUint32(1, true), index: dv.getUint32(5, true), count: dv.getUint32(9, true), total: dv.getUint32(13, true), bytes: u8.subarray(17) };
}

// Action payloads (toy sim). Positions are integer tiles.
export function actWalk(dir) {
  return Uint8Array.of(A.WALK, dir);
}
export function actStop() {
  return Uint8Array.of(A.STOP);
}
export function actBuild(x, y, type) {
  return Uint8Array.of(A.BUILD, x & 255, y & 255, type);
}
export function actMine(x, y) {
  return Uint8Array.of(A.MINE, x & 255, y & 255);
}
export function actCraft(n) {
  return Uint8Array.of(A.CRAFT, n);
}
export function sysAct(kind, idx, extra = 0) {
  return Uint8Array.of(kind, idx, extra & 255, (extra >>> 8) & 255, (extra >>> 16) & 255, (extra >>> 24) & 255);
}
