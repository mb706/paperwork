// Seeded synthetic factory generator (WP A1). Output: the binary world of ts/format.ts, which both
// kernels load. Only integer PRNG and + − × ÷ are used, so every JS engine produces the same bytes.
//
// One production cell is 96×32 tiles (3×1 chunks):
//   drills (16) → ORE belt → furnaces (12) → PLATE belt → station 1 (4 chests, 24 bulk inserters)
//   → BUF belt → assemblers: gear, wire → circuit (direct insertion), pack-1 ×3, pack-2 ×4 → INT / PK belts
//   → station 2 (4 chests, 24 bulk inserters) → SCI belt (pack-1 lane, pack-2 lane) → labs (5)
// Every lane carries one item type, as players build it: a dead-end lane that mixes two packs jams
// (the front items are not the one a lab needs and nothing moves), exactly as it does in Factorio.
// Per cell: 288 belt tiles (6 belts × 48 tiles, 36 transport lines of 16 tiles), 109 inserters,
// 27 machines + 16 drills, 8 chests, 40 poles, plus `decor` static entities (pipes, walls, lamps).
// Every belt ends in a dead end, so surplus backs up as in a real base.
//
// Knobs that set the share of sleeping, output-blocked and input-starved entities:
//   sink   – fraction of cells whose labs research; the others back up completely (an over-built base)
//   mining – drill speed multiplier (mining productivity); < 1 starves the chain
//   fill   – initial belt fill of researching cells
//   stock  – initial fill of the station chests of researching cells
//   power  – generation relative to nominal demand; < 1 gives brownouts
// A cell that does not research starts saturated (full belts, chests and machine slots), as it would be
// after running for a while; it falls asleep within a few hundred ticks and then costs almost nothing.

import { H, HEADER_LEN, MAGIC, SEC, VERSION, Writer } from '../ts/format.ts';

export interface GenParams {
  cells: number;
  seed: number;
  sink: number;
  mining: number;
  fill: number;
  stock: number;
  power: number;
  decor: number;
  cellsPerNet: number;
}

// §11 rows: Mid = 40k entities, 20k belt tiles, 6k inserters, 1.5k machines;
// Late = 150k entities, 60k belt tiles, 250k belt items, 25k inserters, 6k machines.
export const SCALES: Record<string, { cells: number; decor: number }> = {
  tiny: { cells: 4, decor: 20 },
  mid: { cells: 64, decor: 137 },
  late: { cells: 222, decor: 188 },
  mega: { cells: 592, decor: 188 }, // the 400k-entity megabase stretch row
};

// regimes: the sweep of the sleeping share (see README)
export const REGIMES: Record<string, Partial<GenParams>> = {
  busy: { sink: 1.0, mining: 1.0, fill: 0.5, stock: 0.25 },
  typical: { sink: 0.6, mining: 1.0, fill: 0.5, stock: 0.25 },
  backed: { sink: 0.2, mining: 1.0, fill: 0.5, stock: 0.25 },
  starved: { sink: 1.0, mining: 0.4, fill: 0.2, stock: 0.02 },
};

export function params(scale: string, regime: string, seed = 1): GenParams {
  const s = SCALES[scale];
  if (!s) throw new Error(`unknown scale ${scale}`);
  const r = REGIMES[regime];
  if (!r) throw new Error(`unknown regime ${regime}`);
  return { cells: s.cells, decor: s.decor, seed, sink: 0.6, mining: 1, fill: 0.5, stock: 0.25, power: 1.6, cellsPerNet: 16, ...r };
}

// items
const ORE_A = 0;
const ORE_B = 1;
const PLATE_A = 2;
const PLATE_B = 3;
const GEAR = 4;
const WIRE = 5;
const CIRCUIT = 6;
const PACK1 = 7;
const PACK2 = 8;
const STACK = [50, 50, 100, 100, 100, 200, 200, 200, 200];

// recipes: [time s, inputs [key, amount][], outputs [key, amount][]]
const RECIPES: [number, number[][], number[][]][] = [
  [1, [], [[ORE_A, 1]]], // 0 mine A
  [1, [], [[ORE_B, 1]]], // 1 mine B
  [3.2, [[ORE_A, 1]], [[PLATE_A, 1]]], // 2 smelt A
  [3.2, [[ORE_B, 1]], [[PLATE_B, 1]]], // 3 smelt B
  [0.5, [[PLATE_A, 2]], [[GEAR, 1]]], // 4 gear
  [0.5, [[PLATE_B, 1]], [[WIRE, 2]]], // 5 wire
  [0.5, [[PLATE_A, 1], [WIRE, 3]], [[CIRCUIT, 1]]], // 6 circuit
  [5, [[PLATE_B, 1], [GEAR, 1]], [[PACK1, 1]]], // 7 pack 1
  [6, [[GEAR, 1], [CIRCUIT, 1]], [[PACK2, 1]]], // 8 pack 2
  [15, [[PACK1, 1], [PACK2, 1]], []], // 9 research unit
];
const R_MINE_A = 0;
const R_SMELT_A = 2;
const R_GEAR = 4;
const R_WIRE = 5;
const R_CIRCUIT = 6;
const R_PACK1 = 7;
const R_PACK2 = 8;
const R_RESEARCH = 9;

// machine prototypes: kind, work J/tick, speed, consumer proto
const MP = [
  { kind: 0, work: 1500, speed: 0.5, ep: 0 }, // electric mining drill, 90 kW
  { kind: 1, work: 3000, speed: 2, ep: 1 }, // electric furnace, 180 kW
  { kind: 2, work: 6250, speed: 1.25, ep: 2 }, // assembler 3, 375 kW
  { kind: 3, work: 1000, speed: 2.5, ep: 3 }, // lab, 60 kW, with lab-speed research
];
// inserter prototypes: rotation turns/tick, extension tiles/tick, move J/tick, hand, pick/drop extension, consumer proto
const IP = [
  { rot: 0.04, ext: 0.1, move: 46000 / 60, hand: 3, pick: 1, drop: 1.2, ep: 4 }, // fast
  { rot: 0.02, ext: 0.05, move: 20000 / 60, hand: 3, pick: 2, drop: 2.2, ep: 5 }, // long-handed
  { rot: 0.04, ext: 0.1, move: 80000 / 60, hand: 12, pick: 1, drop: 1.2, ep: 6 }, // bulk
];
// consumer prototypes: work J/tick, drain J/tick, class (labs are interruptible load)
const EP = [
  { work: 1500, drain: 25, cls: 0 },
  { work: 3000, drain: 100, cls: 0 },
  { work: 6250, drain: 12500 / 60, cls: 0 },
  { work: 1000, drain: 2000 / 60, cls: 1 },
  { work: 46000 / 60, drain: 500 / 60, cls: 0 },
  { work: 20000 / 60, drain: 400 / 60, cls: 0 },
  { work: 80000 / 60, drain: 1000 / 60, cls: 0 },
];

const E_BELT = 1;
const E_INS = 2;
const E_MACH = 3;
const E_CHEST = 4;
const E_POLE = 5;
const E_DECOR = 6;
const T_BELT = 0;
const T_CHEST = 1;
const T_MACH = 2;

const LINE_TILES = 16;
const BELT_TILES = 48;
const LANE_OFF = 64; // 1/4 tile

class Rng {
  private s = new Uint32Array(4);
  constructor(seed: number) {
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      this.s[i] = (z ^ (z >>> 16)) >>> 0;
    }
  }
  u32(): number {
    const s = this.s;
    const r = Math.imul(((Math.imul(s[1], 5) << 7) | (Math.imul(s[1], 5) >>> 25)) >>> 0, 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = ((s[3] << 11) | (s[3] >>> 21)) >>> 0;
    return r;
  }
  // integer in [0, n)
  int(n: number): number {
    return this.u32() % n;
  }
  // true with probability p (p in 1/65536 steps)
  chance(p: number): boolean {
    return (this.u32() >>> 16) < Math.floor(p * 65536);
  }
}

interface Line {
  len: number;
  speed: number;
  next: number;
  prev: number;
  items: number[]; // keys front → back
  ds: number[]; // distances from the end
  endX: number;
  endY: number;
  dir: number;
  lane: number;
}
interface Ins {
  proto: number;
  theta: number;
  srcKind: number;
  src: number;
  srcPos: number;
  dstKind: number;
  dst: number;
  dstPos: number;
  ent: number;
  cons: number;
}
interface Mach {
  proto: number;
  crafting: number;
  progress: number;
  recipe: number;
  inv: number;
  nIn: number;
  nOut: number;
  outLine: number;
  outPos: number;
  speed: number;
  cons: number;
}
interface Cons {
  ep: number;
  net: number;
  order: number;
}

export function generate(p: GenParams): ArrayBuffer {
  const rng = new Rng(p.seed);
  const cellsX = Math.ceil(Math.sqrt(p.cells / 3));
  const cellsY = Math.ceil(p.cells / cellsX);
  const chunksX = cellsX * 3;
  const chunksY = cellsY;

  const lines: Line[] = [];
  const ins: Ins[] = [];
  const mach: Mach[] = [];
  const chests: { inv: number; ent: number }[] = [];
  const slots: number[][] = []; // [key, count, limit]
  const cons: Cons[] = [];
  const ents: number[][] = []; // [kind, sprite, x2, y2, ref]

  const ent = (kind: number, sprite: number, x2: number, y2: number, ref: number): number => {
    ents.push([kind, sprite, x2, y2, ref]);
    return ents.length - 1;
  };
  const consumer = (ep: number, net: number): number => {
    cons.push({ ep, net, order: cons.length });
    return cons.length - 1;
  };

  // A belt of 48 tiles from tile x0 (flowing +x) on row y: 3 lines per lane, indexed downstream first
  // so a compressed flow crosses line boundaries without opening gaps (lines update in index order).
  let fill = p.fill; // per cell
  const belt = (x0: number, y: number, speed: number, laneItems: (lane: number) => number): ((tx: number, lane: number) => [number, number]) => {
    const ids: number[][] = [[], []];
    for (let lane = 0; lane < 2; lane++) {
      for (let s = BELT_TILES / LINE_TILES - 1; s >= 0; s--) {
        const len = LINE_TILES * 256;
        const items: number[] = [];
        const ds: number[] = [];
        for (let j = 0; j < len / 64; j++) {
          if (rng.chance(fill)) {
            items.push(laneItems(lane));
            ds.push(j * 64);
          }
        }
        lines.push({
          len,
          speed,
          next: -1,
          prev: -1,
          items,
          ds,
          endX: (x0 + (s + 1) * LINE_TILES) * 256,
          endY: y * 256 + 128,
          dir: 0,
          lane: lane === 0 ? LANE_OFF : -LANE_OFF,
        });
        ids[lane][s] = lines.length - 1;
      }
      for (let s = 0; s < BELT_TILES / LINE_TILES; s++) {
        const l = ids[lane][s];
        if (s + 1 < BELT_TILES / LINE_TILES) lines[l].next = ids[lane][s + 1];
        if (s > 0) lines[l].prev = ids[lane][s - 1];
      }
    }
    for (let t = 0; t < BELT_TILES; t++) ent(E_BELT, 0, (x0 + t) * 2 + 1, y * 2 + 1, -1);
    // tile tx, lane → (line, distance of the tile centre from the line end)
    return (tx: number, lane: number): [number, number] => {
      const off = tx - x0;
      if (off < 0 || off >= BELT_TILES) throw new Error('tile outside belt');
      const s = Math.floor(off / LINE_TILES);
      const endT = x0 + (s + 1) * LINE_TILES;
      return [ids[lane][s], (endT - tx) * 256 - 128];
    };
  };

  let saturated = false; // per cell
  const machine = (proto: number, recipe: number, tx: number, ty: number, net: number, speedMul: number): number => {
    const r = RECIPES[recipe];
    const mp = MP[proto];
    const inv = slots.length;
    const speed = mp.speed * speedMul;
    const crafts = speed / r[0];
    let n = 1 + Math.ceil(1.166 * crafts);
    if (n < 2) n = 2;
    if (n > 100) n = 100;
    for (const [k, a] of r[1]) {
      const limit = a * n;
      slots.push([k, saturated ? limit : rng.int(limit + 1), limit]);
    }
    for (const [k] of r[2]) slots.push([k, saturated && proto !== 0 ? STACK[k] : 0, 0]);
    const m = mach.length;
    // a running cell starts mid-craft at a random phase, so cells do not tick in lockstep
    const crafting = saturated ? 0 : 1;
    const progress = saturated ? 0 : rng.int(1000) / 1000;
    mach.push({ proto, crafting, progress, recipe, inv, nIn: r[1].length, nOut: r[2].length, outLine: -1, outPos: 0, speed, cons: consumer(mp.ep, net) });
    ent(E_MACH, proto, tx * 2 + 3, ty * 2 + 3, m);
    return m;
  };

  const inserter = (proto: number, tx: number, ty: number, net: number, src: [number, number, number], dst: [number, number, number]): void => {
    const e = ent(E_INS, proto, tx * 2 + 1, ty * 2 + 1, ins.length);
    // every inserter starts empty, swinging back to its pickup from a random angle (desynchronised)
    const theta = rng.int(500) / 1000;
    ins.push({ proto, theta, srcKind: src[0], src: src[1], srcPos: src[2], dstKind: dst[0], dst: dst[1], dstPos: dst[2], ent: e, cons: consumer(IP[proto].ep, net) });
  };

  const chest = (tx: number, ty: number, key: number, fill: number): number => {
    const inv = slots.length;
    const full = Math.floor(16 * fill);
    for (let s = 0; s < 16; s++) slots.push(s < full ? [key, STACK[key], 0] : [-1, 0, 0]);
    const c = chests.length;
    chests.push({ inv, ent: ent(E_CHEST, 0, tx * 2 + 1, ty * 2 + 1, c) });
    return c;
  };

  const FAST = 0;
  const LONG = 1;
  const BULK = 2;
  const belt8 = 8;
  const belt16 = 16;

  for (let cell = 0; cell < p.cells; cell++) {
    const ox = (cell % cellsX) * 96;
    const oy = Math.floor(cell / cellsX) * 32;
    const net = Math.floor(cell / p.cellsPerNet);
    const research = rng.chance(p.sink);
    saturated = !research;
    fill = research ? p.fill : 1;
    const stock = research ? p.stock : 1;

    const ore = belt(ox, oy + 4, belt8, (lane) => (lane === 0 ? ORE_A : ORE_B));
    const plate = belt(ox + 48, oy + 4, belt16, (lane) => (lane === 0 ? PLATE_A : PLATE_B));
    const buf = belt(ox, oy + 15, belt16, (lane) => (lane === 0 ? PLATE_A : PLATE_B));
    const int = belt(ox + 48, oy + 15, belt16, (lane) => (lane === 0 ? GEAR : CIRCUIT));
    const pk = belt(ox, oy + 26, belt8, (lane) => (lane === 0 ? PACK1 : PACK2));
    const sci = belt(ox + 48, oy + 26, belt8, (lane) => (lane === 0 ? PACK1 : PACK2));

    // drills: 8 per side of the ore belt, each outputs onto the near lane
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < 8; k++) {
        const tx = ox + 3 * k;
        const m = machine(0, R_MINE_A + side, tx, oy + (side === 0 ? 1 : 5), net, p.mining);
        const [l, d] = ore(tx + 1, side);
        mach[m].outLine = l;
        mach[m].outPos = d;
      }
    }
    // furnaces: 6 per side; input from the ore lane, output onto the plate belt
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < 6; k++) {
        const tx = ox + 25 + 3 * k;
        const m = machine(1, R_SMELT_A + side, tx, oy + (side === 0 ? 0 : 6), net, 1);
        const [sl, sd] = ore(tx + 1, side);
        inserter(FAST, tx + 1, oy + (side === 0 ? 3 : 5), net, [T_BELT, sl, sd], [T_MACH, m, 0]);
        const [dl, dd] = plate(ox + 50 + 3 * k, side);
        inserter(FAST, tx + 2, oy + (side === 0 ? 3 : 5), net, [T_MACH, m, 0], [T_BELT, dl, dd]);
      }
    }
    // station 1: plate → chests → buf (train unloading)
    for (let k = 0; k < 4; k++) {
      const lane = k < 2 ? 0 : 1;
      const cx = ox + 72 + 6 * k;
      const c = chest(cx, oy + 7, lane === 0 ? PLATE_A : PLATE_B, stock);
      for (let j = -1; j <= 1; j++) {
        const [l, d] = plate(cx + j, lane);
        inserter(BULK, cx + j, oy + 6, net, [T_BELT, l, d], [T_CHEST, c, 0]);
      }
      for (let j = 0; j < 3; j++) {
        const [l, d] = buf(ox + 1 + 3 * k + j, lane);
        inserter(BULK, cx + j - 1, oy + 8, net, [T_CHEST, c, 0], [T_BELT, l, d]);
      }
    }
    // assemblers on buf (plates) and int (gears lane 0, circuits lane 1)
    const at = (tx: number) => [tx, oy + 17] as const;
    {
      const [gx, gy] = at(ox + 14);
      const g = machine(2, R_GEAR, gx, gy, net, 1);
      const [sl, sd] = buf(ox + 15, 0);
      inserter(FAST, ox + 15, oy + 16, net, [T_BELT, sl, sd], [T_MACH, g, 0]);
      const [dl, dd] = int(ox + 50, 0);
      inserter(FAST, ox + 16, oy + 16, net, [T_MACH, g, 0], [T_BELT, dl, dd]);

      const [wx, wy] = at(ox + 18);
      const w = machine(2, R_WIRE, wx, wy, net, 1);
      const [kx, ky] = at(ox + 21);
      const kc = machine(2, R_CIRCUIT, kx, ky, net, 1);
      const [wl, wd] = buf(ox + 19, 1);
      inserter(FAST, ox + 19, oy + 16, net, [T_BELT, wl, wd], [T_MACH, w, 0]);
      inserter(FAST, ox + 20, oy + 18, net, [T_MACH, w, 0], [T_MACH, kc, 0]);
      const [cl, cd] = buf(ox + 22, 0);
      inserter(FAST, ox + 22, oy + 16, net, [T_BELT, cl, cd], [T_MACH, kc, 0]);
      const [ol, od] = int(ox + 53, 1);
      inserter(FAST, ox + 23, oy + 16, net, [T_MACH, kc, 0], [T_BELT, ol, od]);

      for (let k = 0; k < 3; k++) {
        const [px, py] = at(ox + 25 + 3 * k);
        const m = machine(2, R_PACK1, px, py, net, 1);
        const [bl, bd] = buf(ox + 26 + 3 * k, 1);
        inserter(FAST, ox + 26 + 3 * k, oy + 16, net, [T_BELT, bl, bd], [T_MACH, m, 0]);
        const [il, id] = int(ox + 58 + 3 * k, 0);
        inserter(LONG, ox + 27 + 3 * k, oy + 16, net, [T_BELT, il, id], [T_MACH, m, 0]);
        const [ql, qd] = pk(ox + 2 + 3 * k, 0);
        inserter(FAST, ox + 26 + 3 * k, oy + 20, net, [T_MACH, m, 0], [T_BELT, ql, qd]);
      }
      for (let k = 0; k < 4; k++) {
        const [px, py] = at(ox + 34 + 3 * k);
        const m = machine(2, R_PACK2, px, py, net, 1);
        const [gl, gd] = int(ox + 67 + 3 * k, 0);
        inserter(FAST, ox + 35 + 3 * k, oy + 16, net, [T_BELT, gl, gd], [T_MACH, m, 0]);
        const [cl2, cd2] = int(ox + 68 + 3 * k, 1);
        inserter(FAST, ox + 36 + 3 * k, oy + 16, net, [T_BELT, cl2, cd2], [T_MACH, m, 0]);
        const [ql, qd] = pk(ox + 11 + 3 * k, 1);
        inserter(FAST, ox + 35 + 3 * k, oy + 20, net, [T_MACH, m, 0], [T_BELT, ql, qd]);
      }
    }
    // station 2: pk → chests → sci
    for (let k = 0; k < 4; k++) {
      const lane = k < 2 ? 0 : 1;
      const cx = ox + 26 + 6 * k;
      const c = chest(cx, oy + 29, lane === 0 ? PACK1 : PACK2, stock);
      for (let j = -1; j <= 1; j++) {
        const [l, d] = pk(cx + j, lane);
        inserter(BULK, cx + j, oy + 28, net, [T_BELT, l, d], [T_CHEST, c, 0]);
      }
      for (let j = 0; j < 3; j++) {
        const [l, d] = sci(ox + 49 + 3 * k + j, lane);
        inserter(BULK, cx + j - 1, oy + 30, net, [T_CHEST, c, 0], [T_BELT, l, d]);
      }
    }
    // labs: two inserters each, one per sci lane
    for (let k = 0; k < 5; k++) {
      const tx = ox + 64 + 6 * k;
      const m = machine(3, research ? R_RESEARCH : R_RESEARCH, tx, oy + 28, net, 1);
      if (!research) mach[m].recipe = -1;
      for (let lane = 0; lane < 2; lane++) {
        const [l, d] = sci(tx + lane, lane);
        inserter(FAST, tx + lane, oy + 27, net, [T_BELT, l, d], [T_MACH, m, 0]);
      }
    }
    // poles and decor (static, render only)
    for (let k = 0; k < 40; k++) ent(E_POLE, 0, (ox + 2 + 7 * (k % 13)) * 2 + 1, (oy + 2 + 8 * Math.floor(k / 13)) * 2 + 1, -1);
    for (let k = 0; k < p.decor; k++) ent(E_DECOR, k & 7, (ox + rng.int(96)) * 2 + 1, (oy + rng.int(32)) * 2 + 1, -1);
  }

  // consumers grouped by network, then prototype (FFF-209), then creation order
  const order = cons.map((_, i) => i);
  order.sort((a, b) => cons[a].net - cons[b].net || cons[a].ep - cons[b].ep || a - b);
  const consIndex = new Int32Array(cons.length);
  order.forEach((c, i) => {
    consIndex[c] = i;
  });
  const nNets = Math.ceil(p.cells / p.cellsPerNet);
  const netStart = new Array(nNets).fill(0);
  const netEnd = new Array(nNets).fill(0);
  const netNominal = new Array(nNets).fill(0);
  for (let i = 0; i < order.length; i++) {
    const c = cons[order[i]];
    if (i === 0 || cons[order[i - 1]].net !== c.net) netStart[c.net] = i;
    netEnd[c.net] = i + 1;
    const e = EP[c.ep];
    netNominal[c.net] += (c.ep >= 4 ? 0.3 : 0.75) * e.work + e.drain;
  }

  // ---- serialise
  const w = new Writer();
  let itemHeap = 0;
  const lineI: number[] = [];
  const lineG: number[] = [];
  const iKey: number[] = [];
  const iGap: number[] = [];
  for (const l of lines) {
    let cap = 1;
    while (cap < l.len / 64 + 2) cap *= 2;
    const n = l.items.length;
    const front = n > 0 ? l.ds[0] : 0;
    const back = n > 0 ? l.len - l.ds[n - 1] : 0x3fffffff;
    lineI.push(l.len, l.speed, l.next, l.prev, n, front, back, cap, itemHeap);
    lineG.push(l.endX, l.endY, l.dir, l.lane);
    for (let i = 0; i < cap; i++) {
      iKey.push(i < n ? l.items[i] : 0);
      iGap.push(i > 0 && i < n ? l.ds[i] - l.ds[i - 1] - 64 : 0);
    }
    itemHeap += cap;
  }
  const insI: number[] = [];
  const insF: number[] = [];
  for (const it of ins) {
    const ip = IP[it.proto];
    insI.push(it.proto, 3, 0, 0, ip.hand, it.srcKind, it.src, it.srcPos, it.dstKind, it.dst, it.dstPos, consIndex[it.cons], it.ent);
    insF.push(it.theta, ip.drop, 0.5, ip.pick, 0, ip.drop);
  }
  const machI: number[] = [];
  const machF: number[] = [];
  for (const m of mach) {
    machI.push(m.proto, MP[m.proto].kind, m.recipe, m.recipe < 0 ? 0 : m.crafting, m.inv, m.nIn, m.nOut, 0, consIndex[m.cons], m.outLine, m.outPos);
    machF.push(m.recipe < 0 ? 0 : m.progress, m.speed);
  }
  const consI: number[] = [];
  const consF: number[] = [];
  for (const c of order) {
    consI.push(cons[c].ep, cons[c].net);
    const e = EP[cons[c].ep];
    consF.push(2 * (e.work + e.drain));
  }
  const netI: number[] = [];
  const netF: number[] = [];
  for (let n = 0; n < nNets; n++) {
    netI.push(netStart[n], netEnd[n]);
    const gen = netNominal[n] * p.power;
    const accCap = gen * 60;
    netF.push(gen * 0.8, gen * 0.4, accCap * 0.5, accCap, gen * 0.5);
  }
  // chunk lists
  const nChunks = chunksX * chunksY;
  const dynL: number[][] = Array.from({ length: nChunks }, () => []);
  const staL: number[][] = Array.from({ length: nChunks }, () => []);
  const linL: number[][] = Array.from({ length: nChunks }, () => []);
  ents.forEach((e, id) => {
    const cx = Math.floor(e[2] / 2 / 32);
    const cy = Math.floor(e[3] / 2 / 32);
    const ch = cy * chunksX + cx;
    if (e[0] === E_INS || e[0] === E_MACH) dynL[ch].push(id);
    else staL[ch].push(id);
  });
  lines.forEach((l, id) => {
    const y = Math.floor(l.endY / 256);
    const xe = Math.floor((l.endX - 1) / 256);
    const xs = Math.floor((l.endX - l.len) / 256);
    const cy = Math.floor(y / 32);
    for (let cx = Math.floor(xs / 32); cx <= Math.floor(xe / 32); cx++) linL[cy * chunksX + cx].push(id);
  });
  const chunkI: number[] = [];
  const cDyn: number[] = [];
  const cSta: number[] = [];
  const cLin: number[] = [];
  for (let ch = 0; ch < nChunks; ch++) {
    chunkI.push(cDyn.length, dynL[ch].length, cSta.length, staL[ch].length, cLin.length, linL[ch].length);
    cDyn.push(...dynL[ch]);
    cSta.push(...staL[ch]);
    cLin.push(...linL[ch]);
  }

  const header = new Array(HEADER_LEN).fill(0);
  header[H.magic] = MAGIC;
  header[H.version] = VERSION;
  header[H.nItems] = STACK.length;
  header[H.nRecipes] = RECIPES.length;
  header[H.nIProtos] = IP.length;
  header[H.nMProtos] = MP.length;
  header[H.nEProtos] = EP.length;
  header[H.nLines] = lines.length;
  header[H.itemHeap] = itemHeap;
  header[H.nIns] = ins.length;
  header[H.nMach] = mach.length;
  header[H.nChests] = chests.length;
  header[H.nSlots] = slots.length;
  header[H.nCons] = cons.length;
  header[H.nNets] = nNets;
  header[H.nEnts] = ents.length;
  header[H.chunksX] = chunksX;
  header[H.chunksY] = chunksY;
  header[H.nChunkDyn] = cDyn.length;
  header[H.nChunkStatic] = cSta.length;
  header[H.nChunkLines] = cLin.length;
  header[H.nodeCap] = 4 * ins.length + 2 * mach.length + 4096;
  header[H.seed] = p.seed;

  w.i32(SEC.HEADER, header);
  w.i32(SEC.ITEM_STACK, STACK);
  const rI: number[] = [];
  for (const [, inp, out] of RECIPES) {
    const row = new Array(12).fill(0);
    row[0] = inp.length;
    inp.forEach(([k, a], j) => {
      row[1 + 2 * j] = k;
      row[2 + 2 * j] = a;
    });
    row[7] = out.length;
    out.forEach(([k, a], j) => {
      row[8 + 2 * j] = k;
      row[9 + 2 * j] = a;
    });
    rI.push(...row);
  }
  w.i32(SEC.RECIPE_I, rI);
  w.f64(SEC.RECIPE_F, RECIPES.map((r) => r[0]));
  w.f64(SEC.IPROTO_F, IP.flatMap((q) => [q.rot, q.ext, q.move]));
  w.f64(SEC.MPROTO_F, MP.map((q) => q.work));
  w.f64(SEC.EPROTO_F, EP.flatMap((q) => [2 * (q.work + q.drain), q.drain]));
  w.i32(SEC.EPROTO_I, EP.map((q) => q.cls));
  w.i32(SEC.LINE_I, lineI);
  w.i32(SEC.LINE_GEOM, lineG);
  w.i32(SEC.ITEM_KEY, iKey);
  w.i32(SEC.ITEM_GAP, iGap);
  w.i32(SEC.INS_I, insI);
  w.f64(SEC.INS_F, insF);
  w.i32(SEC.MACH_I, machI);
  w.f64(SEC.MACH_F, machF);
  w.i32(SEC.CHEST_I, chests.flatMap((c) => [c.inv, 16, c.ent]));
  w.i32(SEC.SLOT_I, slots.flatMap((s) => [s[0] < 0 ? 0 : s[0], s[1], s[2]]));
  w.i32(SEC.CONS_I, consI);
  w.f64(SEC.CONS_F, consF);
  w.i32(SEC.NET_I, netI);
  w.f64(SEC.NET_F, netF);
  w.i32(SEC.ENT_I, ents.flat());
  w.i32(SEC.CHUNK_I, chunkI);
  w.i32(SEC.CHUNK_DYN, cDyn);
  w.i32(SEC.CHUNK_STATIC, cSta);
  w.i32(SEC.CHUNK_LINES, cLin);
  return w.finish();
}

// summary counts for the report (from the generator's own lists)
export function describe(p: GenParams): Record<string, number> {
  const per = { beltTiles: 288, lines: 36, inserters: 109, machines: 27, drills: 16, chests: 8, poles: 40 };
  const ents = per.beltTiles + per.inserters + per.machines + per.drills + per.chests + per.poles + p.decor;
  return {
    cells: p.cells,
    entities: ents * p.cells,
    beltTiles: per.beltTiles * p.cells,
    lines: per.lines * p.cells,
    inserters: per.inserters * p.cells,
    machines: per.machines * p.cells,
    drills: per.drills * p.cells,
  };
}

// view rectangles (tiles) for render extraction: 1920×1080 at 32 px/tile × zoom, centred on the factory
export function viewRect(p: GenParams, zoom: number): [number, number, number, number] {
  const cellsX = Math.ceil(Math.sqrt(p.cells / 3));
  const cellsY = Math.ceil(p.cells / cellsX);
  const w = 1920 / (32 * zoom);
  const h = 1080 / (32 * zoom);
  const cx = (cellsX * 96) / 2;
  const cy = (cellsY * 32) / 2;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}
