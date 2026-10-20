// A toy deterministic simulation standing in for the real World (DESIGN.md §5, §7).
// Integer-only state in typed arrays; per-player state; order-dependent interactions (two furnaces
// competing for one drill, players collecting in index order); a saved LIFO free list; counter-based RNG;
// a per-tick digest folded into a rolling digest, plus a rotating slice hash of the bulk state.
import { A } from './protocol.mjs';

export const MAP = 64;
export const MAXP = 16;
export const MAXE = 2048;
export const NITEM = 4; // 0 drill, 1 furnace, 2 ore, 3 plate
const PF = 8; // player fields: state (0 never joined, 1 online, 2 offline), x, y (1/256 tile), dir (-1 idle), inv[4]
const EF = 6; // entity fields: alive, type (1 drill, 2 furnace), x, y, progress, out
const SPEED = 38; // 0.15 tiles per tick in 1/256 tile (I §2.1)
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const NX = [1, 0, -1, 0]; // fixed neighbour order E, S, W, N
const NY = [0, 1, 0, -1];
const SLICES = 8;

export function mix(h, v) {
  h = Math.imul(h ^ v, 0x01000193);
  return (h ^ (h >>> 15)) | 0;
}
function rand(seed, a, b) {
  // counter-based: depends only on its keys, never on update order (10 §4.3)
  let h = mix(mix(mix(seed, a), b), 0x5bd1e995);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function hashWords(arr, from, to, h) {
  for (let i = from; i < to; i++) h = mix(h, arr[i]);
  return h;
}

export class Sim {
  constructor(seed = 1) {
    this.seed = seed;
    this.tick = 0; // state after this tick
    this.p = new Int32Array(MAXP * PF);
    this.grid = new Int32Array(MAP * MAP).fill(-1);
    this.e = new Int32Array(MAXE * EF);
    this.top = 0;
    this.free = []; // LIFO; saved, because allocation order must survive save/load
    this.stock = new Int32Array(NITEM);
    this.prod = new Int32Array(NITEM);
    this.rolling = 0x12345678;
    this.closureSum = 0;
    this.padBytes = 0; // emulated extra snapshot size (opaque, not state)
    this.costMs = 0; // emulated tick cost
    this.sleep = null; // host-provided blocking sleep (Atomics.wait in Node)
  }

  step(entries) {
    const t = this.tick + 1;
    this.prod.fill(0);
    let cs = mix(0, t);
    for (const en of entries) {
      cs = mix(cs, en.player);
      for (let i = 0; i < en.bytes.length; i++) cs = mix(cs, en.bytes[i]);
      this.apply(en.player, en.bytes);
    }
    this.closureSum = cs;
    this.move();
    this.machines(t);
    this.collect();
    for (let i = 0; i < NITEM; i++) this.stock[i] += this.prod[i];
    this.tick = t;
    this.digest();
    if (this.costMs > 0 && this.sleep) this.sleep(this.costMs);
  }

  apply(player, b) {
    const p = this.p;
    const k = b[0];
    if (k >= 100) {
      const i = b[1];
      const o = i * PF;
      if (k === A.JOIN) {
        if (p[o] === 0) {
          p[o + 1] = (8 + 4 * (i % 8)) * 256 + 128;
          p[o + 2] = (8 + 4 * (i >> 3)) * 256 + 128;
          p[o + 4] = 6;
          p[o + 5] = 6;
        }
        p[o] = 1;
        p[o + 3] = -1;
      } else if (k === A.LEAVE) {
        p[o] = 2;
        p[o + 3] = -1;
      } else if (k === A.RELEASE) {
        p[o + 3] = -1;
      }
      return; // SNAPMARK changes nothing in the world
    }
    const o = player * PF;
    if (p[o] !== 1) return; // offline players' late actions are ignored, deterministically
    if (k === A.WALK) p[o + 3] = b[1] & 7;
    else if (k === A.STOP) p[o + 3] = -1;
    else if (k === A.BUILD || k === A.MINE) {
      const x = b[1];
      const y = b[2];
      if (x >= MAP || y >= MAP) return;
      if (Math.abs(x - (p[o + 1] >> 8)) > 10 || Math.abs(y - (p[o + 2] >> 8)) > 10) return; // reach
      const g = y * MAP + x;
      if (k === A.BUILD) {
        const type = b[3];
        if ((type !== 1 && type !== 2) || this.grid[g] >= 0 || p[o + 3 + type] <= 0) return;
        if (x === p[o + 1] >> 8 && y === p[o + 2] >> 8) return; // not under the character
        const id = this.free.length > 0 ? this.free.pop() : this.top++;
        if (id >= MAXE) return;
        const eo = id * EF;
        this.e.set([1, type, x, y, 0, 0], eo);
        this.grid[g] = id;
        p[o + 3 + type]--;
      } else {
        const id = this.grid[g];
        if (id < 0) return;
        const eo = id * EF;
        const type = this.e[eo + 1];
        p[o + 3 + type]++;
        p[o + 4 + (type === 1 ? 2 : 3)] += this.e[eo + 5];
        this.e.fill(0, eo, eo + EF);
        this.grid[g] = -1;
        this.free.push(id);
      }
    } else if (k === A.CRAFT) {
      for (let n = b[1]; n > 0 && p[o + 7] >= 3; n--) {
        p[o + 7] -= 3;
        p[o + 4]++;
      }
    }
  }

  move() {
    const p = this.p;
    for (let i = 0; i < MAXP; i++) {
      const o = i * PF;
      if (p[o] !== 1 || p[o + 3] < 0) continue;
      const d = p[o + 3];
      const nx = Math.max(0, Math.min(MAP * 256 - 1, p[o + 1] + DX[d] * SPEED));
      const ny = Math.max(0, Math.min(MAP * 256 - 1, p[o + 2] + DY[d] * SPEED));
      if (this.grid[(p[o + 2] >> 8) * MAP + (nx >> 8)] < 0) p[o + 1] = nx; // blocked per axis
      if (this.grid[(ny >> 8) * MAP + (p[o + 1] >> 8)] < 0) p[o + 2] = ny;
    }
  }

  machines(t) {
    const e = this.e;
    for (let id = 0; id < this.top; id++) {
      // canonical order: ascending slot index (DESIGN.md §5.4 rule D3)
      const eo = id * EF;
      if (e[eo] !== 1) continue;
      if (e[eo + 1] === 1) {
        if (e[eo + 5] >= 20) continue; // output full
        if (++e[eo + 4] >= 30) {
          e[eo + 4] = 0;
          e[eo + 5]++;
          this.prod[2]++;
          if ((rand(this.seed, t, id) & 63) === 0 && e[eo + 5] < 20) {
            e[eo + 5]++;
            this.prod[2]++;
          }
        }
      } else if (e[eo + 1] === 2) {
        if (e[eo + 4] === 0) {
          if (e[eo + 5] >= 20) continue;
          for (let n = 0; n < 4; n++) {
            const x = e[eo + 2] + NX[n];
            const y = e[eo + 3] + NY[n];
            if (x < 0 || y < 0 || x >= MAP || y >= MAP) continue;
            const src = this.grid[y * MAP + x];
            if (src >= 0 && e[src * EF + 1] === 1 && e[src * EF + 5] > 0) {
              e[src * EF + 5]--; // competing furnaces: whoever comes first in slot order wins
              this.prod[2]--;
              e[eo + 4] = 1;
              break;
            }
          }
        } else if (++e[eo + 4] >= 48) {
          e[eo + 4] = 0;
          e[eo + 5]++;
          this.prod[3]++;
        }
      }
    }
  }

  collect() {
    const p = this.p;
    const e = this.e;
    for (let i = 0; i < MAXP; i++) {
      const o = i * PF;
      if (p[o] !== 1) continue;
      const tx = p[o + 1] >> 8;
      const ty = p[o + 2] >> 8;
      for (let n = 0; n < 4; n++) {
        const x = tx + NX[n];
        const y = ty + NY[n];
        if (x < 0 || y < 0 || x >= MAP || y >= MAP) continue;
        const id = this.grid[y * MAP + x];
        if (id >= 0 && e[id * EF + 1] === 2 && e[id * EF + 5] > 0) {
          p[o + 7] += e[id * EF + 5];
          e[id * EF + 5] = 0;
        }
      }
    }
  }

  // Per-tick digest (cheap, like Factorio's heuristic CRC, FFF-55) folded into a rolling digest;
  // every 60 ticks one of 8 slices of the bulk state is hashed in, so all state is covered every 8 s.
  digest() {
    let h = mix(this.tick, this.closureSum);
    for (let i = 0; i < NITEM; i++) h = mix(h, this.prod[i]);
    h = mix(h, this.top - this.free.length);
    for (let i = 0; i < MAXP; i++) {
      const o = i * PF;
      if (this.p[o] === 0) continue;
      h = hashWords(this.p, o, o + PF, h);
    }
    if (this.tick % 60 === 0) {
      const s = (this.tick / 60) % SLICES;
      const el = (MAXE * EF) / SLICES;
      const gl = (MAP * MAP) / SLICES;
      h = hashWords(this.e, s * el, (s + 1) * el, h);
      h = hashWords(this.grid, s * gl, (s + 1) * gl, h);
      h = hashWords(this.stock, 0, NITEM, h);
    }
    this.rolling = mix(this.rolling, h);
  }

  fullHash() {
    // canonical state only: independent of the digest's history, so a re-synced client must match exactly
    let h = mix(this.tick, 0);
    h = hashWords(this.p, 0, this.p.length, h);
    h = hashWords(this.grid, 0, this.grid.length, h);
    h = hashWords(this.e, 0, this.top * EF, h);
    h = hashWords(this.stock, 0, NITEM, h);
    for (const f of this.free) h = mix(h, f);
    return h;
  }

  serialize() {
    const head = [0x504d5031, this.tick, this.top, this.free.length, this.rolling, this.padBytes, this.seed];
    const words = head.length + this.free.length + this.p.length + this.grid.length + this.e.length + NITEM;
    const out = new Uint8Array(words * 4 + this.padBytes);
    const i32 = new Int32Array(out.buffer, 0, words);
    let o = 0;
    for (const v of head) i32[o++] = v;
    for (const v of this.free) i32[o++] = v;
    i32.set(this.p, o);
    o += this.p.length;
    i32.set(this.grid, o);
    o += this.grid.length;
    i32.set(this.e, o);
    o += this.e.length;
    i32.set(this.stock, o);
    // Opaque padding emulates a late-game save's size; xorshift bytes do not compress.
    let x = this.tick | 1;
    for (let j = words * 4; j < out.length; j++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      out[j] = x & 255;
    }
    return out;
  }

  static deserialize(u8) {
    const buf = u8.byteOffset % 4 === 0 ? u8 : u8.slice();
    const i32 = new Int32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
    if (i32[0] !== 0x504d5031) throw new Error('bad snapshot magic');
    const s = new Sim(i32[6]);
    s.tick = i32[1];
    s.top = i32[2];
    const nf = i32[3];
    s.rolling = i32[4];
    s.padBytes = i32[5];
    let o = 7;
    s.free = Array.from(i32.subarray(o, o + nf));
    o += nf;
    s.p.set(i32.subarray(o, o + s.p.length));
    o += s.p.length;
    s.grid.set(i32.subarray(o, o + s.grid.length));
    o += s.grid.length;
    s.e.set(i32.subarray(o, o + s.e.length));
    o += s.e.length;
    s.stock.set(i32.subarray(o, o + NITEM));
    return s;
  }

  playerPos(i) {
    const o = i * PF;
    return { state: this.p[o], x: this.p[o + 1], y: this.p[o + 2], dir: this.p[o + 3] };
  }
  entityCount() {
    return this.top - this.free.length;
  }
  corrupt() {
    this.p[1] += 1; // a one-bit-ish divergence in player 0's x
  }
}
