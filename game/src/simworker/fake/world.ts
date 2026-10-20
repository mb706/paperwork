// The fake sim's world (10 §15.10): generated terrain, a small factory that runs, and characters driven by
// actions. Not a simulation: it animates what the renderer, the UI and audio consume, at the rates the real
// game produces them, deterministically from its seed and the actions it is given. M0's real rules live in the
// sim and in the golden set's reference model; here only their shapes matter.

import { Writer } from '../../shared/gen/codec.ts';
import type { EventMeta, EventPayload } from '../../shared/gen/events.ts';
import { EVENT_QUEUE_MAX_EVENTS, writeEvent } from '../../shared/gen/events.ts';
import type { BeltSegment, ObjectView } from '../../shared/gen/packet.ts';
import { fractal, hash, unit } from './noise.ts';
import type { FakeProtos } from './protos.ts';

export interface FakeOptions {
  /** Ticks per day (Factorio: 25,000); the dev page can shorten it to see the night. */
  dayTicks?: number;
}

export interface Slot {
  key: number;
  count: number;
}

export interface Ent {
  serial: number;
  proto: number;
  name: string;
  x2: number;
  y2: number;
  dir: number;
  /** EntityView flags: bit 0 ghost, 1 marked for deconstruction. */
  flags: number;
  altIcon: number;
  /** How the entity animates: machines craft in cycles, lamps follow the night, belts always run. */
  role: 'chest' | 'machine' | 'belt' | 'lamp' | 'radar' | 'static' | 'inserter';
  working: boolean;
  /** No power: DYN state 2 (an assembler the fake leaves unpowered). */
  unpowered: boolean;
  phase: number;
  /** Ticks per animation loop. */
  loop: number;
  /** Ticks per craft, and what one craft produces and consumes (statistics, audio). */
  craftTicks: number;
  progress: number;
  produces: Slot[];
  consumes: Slot[];
  recipe: number;
  inv: Slot[];
  energyW: number;
}

export interface Line {
  id: number;
  geomGen: number;
  lane: number;
  speed: number;
  length: number;
  segments: BeltSegment[];
  /** Items by distance from the downstream end, ascending (§15.4's gap arrays are derived from it). */
  items: { key: number; d: number }[];
  sourceKey: number;
  sourceEvery: number;
  sinkEvery: number;
  /** The chunks its segments touch (for the held set). */
  chunks: number[];
}

export interface Ins {
  serial: number;
  proto: number;
  x2: number;
  y2: number;
  dir: number;
  /** Turns per tick of the arm (Factorio's rotation_speed). */
  turnRate: number;
  pickExt: number;
  dropExt: number;
  item: number;
  /** 0 … 1 over a full swing out and back. */
  cycle: number;
}

export interface Char {
  player: number;
  serial: number;
  x: number;
  y: number;
  online: boolean;
  walking: boolean;
  dir: number;
  vx: number;
  vy: number;
  mining: { x: number; y: number } | null;
  miningProgress: number;
  main: Slot[];
  hand: { key: number; count: number; origin: number };
  queue: { recipe: number; count: number; progress: number }[];
  inputGen: number;
  lastSeq: number;
  autoSort: boolean;
  /** Player 1 walks a fixed loop around the factory; player 0 follows its actions. */
  scripted: boolean;
}

export interface ChunkData {
  key: number;
  cx: number;
  cy: number;
  tiles: number[];
  resources: { tile: number; resource: number; amount: number }[];
  objects: ObjectView[];
  version: { tiles: number; entities: number; objects: number; resources: number };
}

export const chunkKeyOf = (cx: number, cy: number): number =>
  (((cx + 32768) << 16) | ((cy + 32768) & 0xffff)) >>> 0;
export const toChunk = (t: number): number => Math.floor(t / 32);
const EMPTY = 0xffff;

/** Factorio's day (I §4.0, §5.7): full light from dawn (0.75) to dusk (0.25), dark from 0.45 to 0.55. */
export function daylight(tick: number, dayTicks: number): number {
  const t = (tick % dayTicks) / dayTicks;
  if (t < 0.25 || t >= 0.75) return 1;
  if (t < 0.45) return 1 - (t - 0.25) / 0.2;
  if (t < 0.55) return 0;
  return (t - 0.55) / 0.2;
}

export class FakeWorld {
  readonly p: FakeProtos;
  readonly seed: number;
  readonly dayTicks: number;
  tick = 0;
  private nextSerial = 1;
  readonly chunks = new Map<number, ChunkData>();
  readonly entities: Ent[] = [];
  readonly lines: Line[] = [];
  readonly inserters: Ins[] = [];
  readonly chars: Char[] = [];
  /** Events since the last extraction (§15.6): at most 8,192, oldest dropped. */
  events: Uint8Array[] = [];
  eventsDropped = false;
  /** Production statistics (§5.20): per stat key, the produced and consumed counts per tick. */
  readonly produced = new Map<number, number>();
  readonly consumed = new Map<number, number>();
  readonly totals = new Map<number, { produced: number; consumed: number }>();
  /** Per stat key and precision: 300 points (see stats in extract.ts). */
  readonly rings = new Map<
    number,
    { produced: Float32Array; consumed: Float32Array; points: number; acc: [number, number] }[]
  >();
  private geomCounter = 0;
  /** The serial of the chest the build-and-mine demo keeps rebuilding, 0 while it is mined. */
  private demoChest = 0;
  literature = 1945;

  constructor(protos: FakeProtos, seed: number, opts: FakeOptions = {}) {
    this.p = protos;
    this.seed = seed >>> 0;
    this.dayTicks = opts.dayTicks ?? 25000;
    this.layout();
  }

  serial(): number {
    return this.nextSerial++;
  }

  // ------------------------------------------------------------------------------------------ terrain

  private tileName(tx: number, ty: number): string {
    if (tx >= 4 && tx < 36 && ty >= -12 && ty < 12) {
      const edge = tx === 4 || tx === 35 || ty === -12 || ty === 11;
      return edge ? 'hazard-concrete' : 'concrete';
    }
    // A town: streets two tiles wide every eight tiles, building blocks between (01 §5.3).
    if (tx >= -72 && tx < -40 && ty >= -48 && ty < -16) {
      const sx = (((tx + 72) % 8) + 8) % 8;
      const sy = (((ty + 48) % 8) + 8) % 8;
      return sx < 2 || sy < 2 ? 'town-street' : 'town-block';
    }
    const lake = (tx + 30) * (tx + 30) + (ty - 18) * (ty - 18);
    if (lake < 40) return 'deep-water';
    if (lake < 110) return 'water';
    if (lake < 150) return 'sand';
    const e = fractal(this.seed, tx, ty, 48);
    const m = fractal(this.seed + 7, tx, ty, 64);
    if (e < 0.18) return 'water';
    if (e < 0.22) return 'sand';
    if (m < 0.3) return 'dry-dirt';
    if (m < 0.38) return 'dirt';
    if (m > 0.78) return 'red-desert';
    return 'grass';
  }

  /** A chunk, generated on first use (a pure function of the seed). */
  chunk(cx: number, cy: number): ChunkData {
    const key = chunkKeyOf(cx, cy);
    const have = this.chunks.get(key);
    if (have) return have;
    const tiles: number[] = [];
    const resources: ChunkData['resources'] = [];
    const objects: ObjectView[] = [];
    const tileId = (n: string) => this.p.id('tile', n) ?? 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const tx = cx * 32 + x;
        const ty = cy * 32 + y;
        const name = this.tileName(tx, ty);
        tiles.push(tileId(name));
        const r = this.ore(tx, ty);
        if (r) resources.push({ tile: y * 32 + x, ...r });
        const water = name === 'water' || name === 'deep-water';
        const busy = name.includes('concrete') || name.startsWith('town') || r !== null;
        if (!water && !busy) {
          const h = hash(this.seed, tx, ty, 3);
          const forest = fractal(this.seed + 11, tx, ty, 40);
          if (forest > 0.62 && unit(h) < 0.35) {
            // Trees (kind 0): the species indexes prototypes.json's treeSpecies, empty until the engine overlay
            // fills it; the fake uses species 0–3 and every leaf stage (§4.4, §15.7).
            objects.push({
              id: h % 4,
              kind: 0,
              variant: (h >>> 8) % 5,
              x: tx * 256 + 64 + ((h >>> 16) % 128),
              y: ty * 256 + 64 + ((h >>> 24) % 128),
              count: 0,
            });
          } else if (unit(h) > 0.997) {
            const rock = ['big-rock', 'huge-rock', 'big-sand-rock'][h % 3] as string;
            const id = this.p.id('world', rock);
            if (id !== null)
              objects.push({
                id,
                kind: 1,
                variant: (h >>> 8) % 4,
                x: tx * 256 + 128,
                y: ty * 256 + 128,
                count: 0,
              });
          }
        }
      }
    const c: ChunkData = {
      key,
      cx,
      cy,
      tiles,
      resources,
      objects,
      version: { tiles: 1, entities: 1, objects: 1, resources: 1 },
    };
    this.chunks.set(key, c);
    return c;
  }

  /** Resource patches: iron, copper, coal and quartz near the spawn point, an archive by the town. */
  private ore(tx: number, ty: number): { resource: number; amount: number } | null {
    const patch = (name: string, cx: number, cy: number, r: number, rich: number) => {
      const d2 = (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy);
      if (d2 > r * r) return null;
      const id = this.p.id('resource', name);
      if (id === null) return null;
      // Richer in the middle: every band of §15.7 appears across a patch.
      const amount = Math.floor(rich * (1 - d2 / (r * r)) + 40 + (hash(this.seed, tx, ty, 9) % 60));
      return { resource: id, amount };
    };
    return (
      patch('iron-ore-patch', -14, -10, 7, 18000) ??
      patch('copper-ore-patch', -14, 6, 5, 12000) ??
      patch('coal-patch', -2, -22, 5, 9000) ??
      patch('quartz-patch', 12, -24, 4, 6000) ??
      patch('archive', -36, -12, 4, 3000)
    );
  }

  tileAt(tx: number, ty: number): number {
    const c = this.chunk(toChunk(tx), toChunk(ty));
    return c.tiles[(ty - c.cy * 32) * 32 + (tx - c.cx * 32)] as number;
  }

  walkable(tx: number, ty: number): boolean {
    return this.p.json.tile[this.tileAt(tx, ty)]?.walkable ?? false;
  }

  // ------------------------------------------------------------------------------------------ layout

  private place(
    name: string,
    tx: number,
    ty: number,
    dir = 0,
    role: Ent['role'] = 'static',
    extra: Partial<Ent> = {},
  ): Ent | null {
    const proto = this.p.id('entity', name);
    if (proto === null) return null;
    const e = this.p.json.entity[proto] as { size: number[]; energyUsageW: number };
    const [w0, h0] = e.size as [number, number];
    const turned = dir === 4 || dir === 12;
    const w = turned ? h0 : w0;
    const h = turned ? w0 : h0;
    const ent: Ent = {
      serial: this.serial(),
      proto,
      name,
      x2: 2 * tx + w,
      y2: 2 * ty + h,
      dir,
      flags: 0,
      altIcon: 0xffff,
      role,
      working: role !== 'chest' && role !== 'static',
      unpowered: false,
      phase: hash(this.seed, tx, ty, 5) & 0xffff,
      loop: 60,
      craftTicks: 0,
      progress: 0,
      produces: [],
      consumes: [],
      recipe: 0xffff,
      inv: [],
      energyW: e.energyUsageW,
      ...extra,
    };
    this.entities.push(ent);
    return ent;
  }

  /**
   * A crafting machine set to `recipe`: the build's ingredients, products and time, at the machine's crafting
   * speed (§5.3), so the panels, statistics and audio see Factorio's rates. A build without the recipe gets
   * the machine without one.
   */
  private machine(name: string, tx: number, ty: number, recipeName: string, dir = 0): Ent | null {
    const proto = this.p.id('entity', name);
    const recipe = this.p.id('recipe', recipeName);
    const r = recipe === null ? undefined : this.p.json.recipe[recipe];
    if (proto === null || recipe === null || !r)
      return this.place(name, tx, ty, dir, 'machine', { loop: 48 });
    const items = (list: readonly { id: number; amount: number; kind: string }[]): Slot[] =>
      list.filter((x) => x.kind === 'item').map((x) => ({ key: x.id * 8, count: x.amount }));
    const product = r.products.find((x) => x.kind === 'item');
    const ticks = Math.round((r.time / this.p.craftingSpeed(proto)) * 60);
    return this.place(name, tx, ty, dir, 'machine', {
      altIcon: product ? this.p.icon(this.p.json.item[product.id]?.name ?? '') : EMPTY,
      recipe,
      craftTicks: ticks > 0 ? ticks : 1,
      loop: 48,
      produces: items(r.products),
      consumes: items(r.ingredients),
    });
  }

  private chest(name: string, tx: number, ty: number, items: [string, number][]): Ent | null {
    const proto = this.p.id('entity', name);
    if (proto === null) return null;
    const size = this.p.json.entity[proto]?.inventorySlots ?? 16;
    const inv: Slot[] = Array.from({ length: size }, () => ({ key: EMPTY, count: 0 }));
    items.forEach(([item, n], i) => {
      const key = this.p.key(item);
      if (key !== null && i < size) inv[i] = { key, count: n };
    });
    return this.place(name, tx, ty, 0, 'chest', { inv });
  }

  /** A straight run of belts and its two lanes as transport lines (§5.3: one line per lane). */
  private beltRun(
    name: string,
    from: [number, number],
    to: [number, number],
    dir: number,
    item: string,
    sourceEvery: number,
    sinkEvery: number,
  ): void {
    const proto = this.p.id('entity', name);
    if (proto === null) return;
    const [dx, dy] = dir === 0 ? [0, -1] : dir === 4 ? [1, 0] : dir === 8 ? [0, 1] : [-1, 0];
    const n = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]) + 1;
    for (let i = 0; i < n; i++)
      this.place(name, from[0] + dx * i, from[1] + dy * i, dir, 'belt', { loop: 16 });
    const speedPos = (this.p.json.entity[proto] as { name: string }).name.startsWith('fast') ? 16 : 8;
    for (const lane of [0, 1]) {
      // The lane's centreline lies a quarter tile left (lane 0) or right (lane 1) of the belt's.
      const side = lane === 0 ? -0.25 : 0.25;
      const [lx, ly] = [-dy * side, dx * side];
      const endX = to[0] + 0.5 + dx * 0.5 + lx;
      const endY = to[1] + 0.5 + dy * 0.5 + ly;
      const length = n * 256;
      const seg: BeltSegment = {
        x: Math.round(endX * 256),
        y: Math.round(endY * 256),
        len: length,
        dir,
        turn: 0,
        radius: 0,
      };
      this.addLine([seg], lane, speedPos, item, sourceEvery, sinkEvery, from, to);
    }
  }

  /** A belt that runs east, then turns right (south) through a quarter arc: §15.4's arcs. */
  private beltCorner(name: string, x0: number, y: number, cornerX: number, y1: number, item: string): void {
    const proto = this.p.id('entity', name);
    if (proto === null) return;
    for (let x = x0; x < cornerX; x++) this.place(name, x, y, 4, 'belt', { loop: 16 });
    this.place(name, cornerX, y, 8, 'belt', { loop: 16 });
    for (let yy = y + 1; yy <= y1; yy++) this.place(name, cornerX, yy, 8, 'belt', { loop: 16 });
    for (const lane of [0, 1]) {
      // Lane 0 is on the left of travel: the outside of a right turn (radius 0.75 tile), lane 1 the inside (0.25).
      const offset = lane === 0 ? -0.25 : 0.25;
      const radius = 0.5 - offset;
      // From the downstream end: the southward straight run, the arc, the eastward run.
      const southEnd = { x: cornerX + 0.5 - offset, y: y1 + 1 };
      const southLen = (y1 - y) * 256;
      const arcLen = Math.round(radius * 402.1238596594935); // radius × π/2 × 256 positions
      const eastEnd = { x: cornerX, y: y + 0.5 + offset };
      const eastLen = (cornerX - x0) * 256;
      const segs: BeltSegment[] = [
        {
          x: Math.round(southEnd.x * 256),
          y: Math.round(southEnd.y * 256),
          len: southLen,
          dir: 8,
          turn: 0,
          radius: 0,
        },
        {
          x: Math.round((cornerX + 0.5 - offset) * 256),
          y: (y + 1) * 256,
          len: arcLen,
          dir: 8,
          turn: 1,
          radius: Math.round(radius * 256),
        },
        {
          x: Math.round(eastEnd.x * 256),
          y: Math.round(eastEnd.y * 256),
          len: eastLen,
          dir: 4,
          turn: 0,
          radius: 0,
        },
      ];
      this.addLine(segs, lane, 8, item, 26, 30, [x0, y], [cornerX, y1]);
    }
  }

  private addLine(
    segments: BeltSegment[],
    lane: number,
    speed: number,
    item: string,
    sourceEvery: number,
    sinkEvery: number,
    a: [number, number],
    b: [number, number],
  ): void {
    const length = segments.reduce((s, x) => s + x.len, 0);
    const chunks = new Set<number>();
    for (let cx = toChunk(Math.min(a[0], b[0])); cx <= toChunk(Math.max(a[0], b[0])); cx++)
      for (let cy = toChunk(Math.min(a[1], b[1])); cy <= toChunk(Math.max(a[1], b[1])); cy++)
        chunks.add(chunkKeyOf(cx, cy));
    const line: Line = {
      id: this.lines.length,
      geomGen: ++this.geomCounter,
      lane,
      speed,
      length,
      segments,
      items: [],
      sourceKey: this.p.key(item) ?? 0,
      sourceEvery,
      sinkEvery,
      chunks: [...chunks].sort((x, y) => x - y),
    };
    // Start full: items every 64 to 128 positions (a partly compressed belt).
    for (let d = 32; d < length; d += 64 + (hash(this.seed, line.id, d) % 3) * 32)
      line.items.push({ key: line.sourceKey, d });
    this.lines.push(line);
  }

  private inserter(name: string, tx: number, ty: number, dir: number, item: string, long = false): void {
    const proto = this.p.id('entity', name);
    if (proto === null) return;
    const rates: Record<string, number> = {
      'burner-inserter': 0.01,
      inserter: 0.014,
      'long-handed-inserter': 0.02,
      'fast-inserter': 0.04,
    };
    const e = this.place(name, tx, ty, dir, 'inserter');
    if (!e) return;
    this.inserters.push({
      serial: e.serial,
      proto,
      x2: e.x2,
      y2: e.y2,
      dir,
      turnRate: rates[name] ?? 0.014,
      pickExt: long ? 2 : 1,
      dropExt: long ? 2 : 1,
      item: this.p.key(item) ?? EMPTY,
      cycle: unit(hash(this.seed, tx, ty, 77)),
    });
  }

  /** The demo factory east of the spawn point; every part is optional (a build without it skips it). */
  private layout(): void {
    this.chars.push(this.newChar(0, 0.5, 0.5, false), this.newChar(1, 8.5, 13.5, true));
    // Ore → a belt with a corner → inserters → stone furnaces → inserters → a plate belt → assemblers → chests.
    // Drills mine at Factorio's rates: 0.5 ore/s electric, 0.25 ore/s burner.
    const ore = this.p.key('iron-ore');
    const mined = ore === null ? [] : [{ key: ore, count: 1 }];
    this.place('electric-mining-drill', -18, -12, 4, 'machine', {
      loop: 64,
      craftTicks: 120,
      produces: mined,
    });
    this.place('electric-mining-drill', -18, -8, 4, 'machine', {
      loop: 64,
      craftTicks: 120,
      produces: mined,
    });
    this.place('burner-mining-drill', -14, -14, 4, 'machine', { loop: 32, craftTicks: 240, produces: mined });
    this.beltCorner('transport-belt', -15, -6, 13, 3, 'iron-ore');
    for (let i = 0; i < 4; i++) {
      this.inserter(i % 2 === 0 ? 'inserter' : 'burner-inserter', 14, -4 + 2 * i, 4, 'iron-ore');
      this.machine('stone-furnace', 15, -5 + 2 * i, 'iron-plate');
      this.inserter('fast-inserter', 17, -4 + 2 * i, 4, 'iron-plate');
    }
    this.beltRun('fast-transport-belt', [18, -5], [18, 8], 8, 'iron-plate', 20, 24);
    this.inserter('long-handed-inserter', 19, 0, 4, 'iron-plate', true);
    this.machine('assembling-machine-1', 21, -1, 'iron-gear-wheel');
    this.inserter('inserter', 24, 0, 4, 'iron-gear-wheel');
    this.chest('iron-chest', 25, 0, [['iron-gear-wheel', 37]]);
    this.inserter('inserter', 19, 5, 4, 'iron-plate');
    const asm2 = this.machine('assembling-machine-1', 20, 4, 'copper-cable');
    if (asm2) asm2.unpowered = true; // DYN state 2, status no_power
    const asm3 = this.machine('assembling-machine-2', 26, -6, 'logic-board');
    if (asm3) asm3.working = false; // idle: no ingredients
    this.machine('keypunch', 8, 5, 'token'); // transcription: archive → tokens
    // A Seminar researches: it consumes a memo per 30 s research unit and produces nothing.
    const memo = this.p.key('memo');
    this.place('seminar', 29, 4, 0, 'machine', {
      loop: 48,
      craftTicks: 1800,
      consumes: memo === null ? [] : [{ key: memo, count: 1 }],
    });
    this.place('radar', 30, -2, 0, 'radar', { loop: 240 });
    for (let x = 6; x < 34; x += 7) this.place('small-lamp', x, 10, 0, 'lamp');
    for (let x = 6; x < 34; x += 7) this.place('small-electric-pole', x, -11, 0, 'static');
    this.place('solar-panel', 31, -11, 0, 'static');
    this.place('boiler', -27, 8, 0, 'machine', { loop: 30 });
    this.place('steam-engine', -27, 3, 0, 'machine', { loop: 24 });
    this.place('offshore-pump', -26, 11, 8, 'machine', { loop: 30 });
    // Chests with inventories for the UI, a ghost and a building marked for deconstruction.
    this.chest('wooden-chest', 2, -3, [
      ['iron-plate', 50],
      ['iron-ore', 30],
      ['coal', 12],
    ]);
    this.chest('steel-chest', 3, -3, [
      ['copper-plate', 100],
      ['iron-gear-wheel', 20],
    ]);
    const ghost = this.place('assembling-machine-1', 21, 8, 0, 'static');
    if (ghost) ghost.flags = 1;
    const marked = this.chest('iron-chest', 4, -3, [['transport-belt', 12]]);
    if (marked) marked.flags = 2;
    this.place('underground-belt', 10, 8, 4, 'static');
    this.place('underground-belt', 14, 8, 4, 'static');
    this.place('splitter', 6, 7, 4, 'belt', { loop: 16 });
  }

  private newChar(player: number, x: number, y: number, scripted: boolean): Char {
    const main: Slot[] = Array.from({ length: 80 }, () => ({ key: EMPTY, count: 0 }));
    const kit: [string, number][] = [
      ['iron-chest', 10],
      ['transport-belt', 100],
      ['inserter', 20],
      ['stone-furnace', 8],
      ['iron-ore', 34],
      ['coal', 50],
      ['iron-plate', 192],
      ['copper-plate', 80],
      ['iron-gear-wheel', 15],
    ];
    let slot = 0;
    for (const [name, n] of kit) {
      const key = this.p.key(name);
      if (key === null) continue;
      let left = n;
      while (left > 0 && slot < 80) {
        const k = left < this.p.stack(key) ? left : this.p.stack(key);
        main[slot++] = { key, count: k };
        left -= k;
      }
    }
    return {
      player,
      serial: this.serial(),
      x,
      y,
      online: true,
      walking: scripted,
      dir: 4,
      vx: 0,
      vy: 0,
      mining: null,
      miningProgress: 0,
      main,
      hand: { key: EMPTY, count: 0, origin: EMPTY },
      queue: [],
      inputGen: 0,
      lastSeq: 0,
      autoSort: true,
      scripted,
    };
  }

  // ------------------------------------------------------------------------------------------ events and stats

  emit(meta: Omit<EventMeta, 'tick' | 'flags' | 'surface'>, payload: EventPayload): void {
    const w = new Writer(32);
    writeEvent(w, { ...meta, tick: this.tick, flags: 0, surface: 0 }, payload);
    this.events.push(w.finish());
    if (this.events.length > EVENT_QUEUE_MAX_EVENTS) {
      this.events.shift();
      this.eventsDropped = true;
    }
  }

  private count(m: Map<number, number>, itemKey: number, n: number): void {
    const k = (1 << 24) + itemKey; // StatKey: (StatKind.item << 24) | item key
    m.set(k, (m.get(k) ?? 0) + n);
  }

  // ------------------------------------------------------------------------------------------ the tick

  /** Starts a tick: actions apply between `begin` and `end` (phase 1, §4.6). */
  begin(): void {
    this.tick++;
    this.produced.clear();
    this.consumed.clear();
  }

  /** One tick without actions. */
  step(): void {
    this.begin();
    this.end();
  }

  /** Ends a tick: the characters, the machines, the belts, the inserters, the demo, the statistics. */
  end(): void {
    const light = daylight(this.tick, this.dayTicks);
    for (const c of this.chars) this.charTick(c);
    for (const e of this.entities) this.entTick(e, light);
    for (const l of this.lines) this.lineTick(l);
    for (const i of this.inserters) i.cycle = (i.cycle + i.turnRate) % 1;
    this.demo();
    // Every 30 s the corner belt is "rebuilt": its two lanes get new geometry generations, so the renderer sees
    // BELT_RETIRE for the old pairs and BELT_GEOM for the new ones (§15.4).
    if (this.tick % 1800 === 0) for (const l of this.lines.slice(0, 2)) l.geomGen = ++this.geomCounter;
    this.literature += 1 / 3600; // one Literature year per game minute: fast enough to hear the eras change
    this.flushStats();
  }

  private entTick(e: Ent, light: number): void {
    if (e.role === 'lamp') {
      e.working = light < 0.7;
      return;
    }
    if (!e.working || e.unpowered) return;
    e.phase = (e.phase + Math.floor(65536 / e.loop)) & 0xffff;
    if (e.craftTicks > 0) {
      e.progress += 1;
      if (e.progress >= e.craftTicks) {
        e.progress = 0;
        for (const s of e.produces) this.count(this.produced, s.key, s.count);
        for (const s of e.consumes) this.count(this.consumed, s.key, s.count);
      }
    }
  }

  /** Items move toward the downstream end at the belt's speed, keeping 64 positions apart (§15.4, §5.3). */
  private lineTick(l: Line): void {
    if (l.sinkEvery > 0 && this.tick % l.sinkEvery === 0 && (l.items[0]?.d ?? 1) <= 0) l.items.shift();
    let limit = 0;
    for (const it of l.items) {
      const want = it.d - l.speed;
      it.d = want > limit ? want : limit;
      limit = it.d + 64;
    }
    const last = l.items[l.items.length - 1];
    if (this.tick % l.sourceEvery === 0 && (!last || last.d + 64 <= l.length - 32))
      l.items.push({ key: l.sourceKey, d: l.length - 32 });
  }

  /** Every 10 s player 1 builds a chest by the spawn point; 5 s later it mines it again. */
  private demo(): void {
    const t = this.tick % 600;
    const p1 = this.chars[1];
    const name = 'wooden-chest';
    const proto = this.p.id('entity', name);
    if (!p1 || proto === null) return;
    if (t === 0 && this.demoChest === 0) {
      const e = this.chest(name, -3, 3, [['iron-plate', 7]]);
      if (!e) return;
      this.demoChest = e.serial;
      this.chunk(toChunk(-3), toChunk(3)).version.entities++;
      this.emit(
        { seq: 0, player: 1 },
        { type: 'entity_built', serial: e.serial, proto, dir: 0, flags: 0, pos: { x2: e.x2, y2: e.y2 } },
      );
    } else if (t === 300 && this.demoChest !== 0) {
      const i = this.entities.findIndex((e) => e.serial === this.demoChest);
      const e = this.entities[i];
      if (!e) return;
      this.entities.splice(i, 1);
      this.chunk(toChunk(-3), toChunk(3)).version.entities++;
      this.emit(
        { seq: 0, player: 1 },
        { type: 'entity_mined', serial: e.serial, proto, pos: { x2: e.x2, y2: e.y2 } },
      );
      this.emit(
        { seq: 0, player: 1 },
        {
          type: 'flying_text',
          text: 1,
          item: this.p.key('wooden-chest') ?? 0,
          count: 1,
          total: 1,
          pos: { x: Math.round(p1.x * 256), y: Math.round(p1.y * 256) },
        },
      );
      this.demoChest = 0;
    }
  }

  private charTick(c: Char): void {
    if (!c.online) {
      c.vx = 0;
      c.vy = 0;
      return;
    }
    if (c.scripted) {
      // Player 1 walks a rectangle around the factory's south side, turning every 3 s.
      const leg = Math.floor(this.tick / 180) % 4;
      c.dir = [4, 0, 12, 8][leg] as number;
      c.walking = Math.floor(this.tick / 90) % 6 !== 5; // and pauses now and then (the idle clip)
    }
    c.vx = 0;
    c.vy = 0;
    if (c.walking) {
      const s = Math.SQRT1_2;
      const dirs: [number, number][] = [
        [0, -1],
        [s, -s],
        [1, 0],
        [s, s],
        [0, 1],
        [-s, s],
        [-1, 0],
        [-s, -s],
      ];
      const [ux, uy] = dirs[c.dir >> 1] as [number, number];
      const nx = c.x + 0.15 * ux;
      const ny = c.y + 0.15 * uy;
      if (this.walkable(Math.floor(nx), Math.floor(ny))) {
        c.vx = nx - c.x;
        c.vy = ny - c.y;
        c.x = nx;
        c.y = ny;
      }
    }
    if (c.mining) {
      c.miningProgress += 0.5 / 60;
      if (c.miningProgress >= 1 - 1e-9) {
        c.miningProgress = 0;
        const tx = Math.floor(c.mining.x);
        const ty = Math.floor(c.mining.y);
        const ch = this.chunk(toChunk(tx), toChunk(ty));
        const r = ch.resources.find((x) => x.tile === (ty - ch.cy * 32) * 32 + (tx - ch.cx * 32));
        const yieldName = r ? this.p.json.resource[r.resource]?.yields : null;
        if (r && yieldName && yieldName.kind === 'item') {
          r.amount -= 1;
          const key = yieldName.id * 8;
          this.add(c, key, 1);
          this.count(this.produced, key, 1);
          this.emit(
            { seq: 0, player: c.player },
            {
              type: 'flying_text',
              text: 1,
              item: key,
              count: 1,
              total: this.total(c, key),
              pos: { x: Math.round(c.x * 256), y: Math.round(c.y * 256) },
            },
          );
        } else c.mining = null;
      }
    }
    const q = c.queue[0];
    if (q) {
      const r = this.p.json.recipe[q.recipe];
      if (r) {
        q.progress += 1 / (r.time * 60);
        if (q.progress >= 1 - 1e-9) {
          q.progress = 0;
          q.count -= 1;
          for (const prod of r.products) {
            const key = prod.id * 8;
            this.add(c, key, prod.amount);
            this.count(this.produced, key, prod.amount);
            this.emit(
              { seq: 0, player: c.player },
              {
                type: 'flying_text',
                text: 1,
                item: key,
                count: prod.amount,
                total: this.total(c, key),
                pos: { x: Math.round(c.x * 256), y: Math.round(c.y * 256) },
              },
            );
          }
          for (const ing of r.ingredients) this.count(this.consumed, ing.id * 8, ing.amount);
          this.emit({ seq: 0, player: c.player }, { type: 'item_crafted', recipe: q.recipe, count: 1 });
          if (q.count === 0) c.queue.shift();
        }
      }
    }
  }

  /** Adds items to a character's main inventory: partial stacks, then empty slots. */
  add(c: Char, key: number, n: number): number {
    let left = n;
    const stack = this.p.stack(key);
    for (const s of c.main)
      if (left > 0 && s.key === key && s.count < stack) {
        const k = left < stack - s.count ? left : stack - s.count;
        s.count += k;
        left -= k;
      }
    for (const s of c.main)
      if (left > 0 && s.count === 0) {
        const k = left < stack ? left : stack;
        s.key = key;
        s.count = k;
        left -= k;
      }
    return n - left;
  }

  total(c: Char, key: number): number {
    return c.main.reduce((n, s) => (s.key === key ? n + s.count : n), 0);
  }

  /** The statistics rings (§5.20): every key, every tick; points of 1, 12, 120 … ticks, as the golden model's. */
  private flushStats(): void {
    const keys = new Set<number>([...this.produced.keys(), ...this.consumed.keys(), ...this.rings.keys()]);
    const spans = [1, 12, 120, 720, 7200, 36000, 180000, 720000, 60];
    for (const k of [...keys].sort((a, b) => a - b)) {
      const p = this.produced.get(k) ?? 0;
      const q = this.consumed.get(k) ?? 0;
      const t = this.totals.get(k) ?? { produced: 0, consumed: 0 };
      t.produced += p;
      t.consumed += q;
      this.totals.set(k, t);
      let rings = this.rings.get(k);
      if (!rings) {
        rings = spans.map((T) => ({
          produced: new Float32Array(300),
          consumed: new Float32Array(300),
          points: Math.floor((this.tick - 1) / T),
          acc: [0, 0] as [number, number],
        }));
        this.rings.set(k, rings);
      }
      rings.forEach((r, i) => {
        r.acc[0] += p;
        r.acc[1] += q;
        if (this.tick % (spans[i] as number) === 0) {
          r.produced[r.points % 300] = r.acc[0];
          r.consumed[r.points % 300] = r.acc[1];
          r.points++;
          r.acc = [0, 0];
        }
      });
    }
  }

  /** The animated entities' electric draw, for the HUD's music feed (§15.6: activity in W). */
  activityW(): number {
    let w = 0;
    for (const e of this.entities) if (e.working && !e.unpowered && e.role === 'machine') w += e.energyW;
    return w;
  }
}

// ------------------------------------------------------------------------------------------ actions

/** What the fake does with an action: applies it, refuses it (an `action_failed` reason), or ignores it. */
export type ActionResult = 'applied' | { reason: number } | 'not modelled';

const FAIL = {
  malformed: 1,
  unsupported: 2,
  nothing_to_mine: 25,
  not_enough_ingredients: 19,
  invalid_index: 5,
  cannot_handcraft: 29,
};

/**
 * Applies one decoded action of player 0 or 1 (§15.3): walking, mining a resource tile, hand crafting and the
 * cursor's slot clicks on the main inventory are modelled; the other M0 actions are accepted and ignored; the
 * caller refuses malformed and unsupported ones before this.
 */
export function applyFakeAction(
  w: FakeWorld,
  c: Char,
  a: import('../../shared/gen/actions.ts').Action,
): ActionResult {
  switch (a.type) {
    case 'start_walking':
      c.walking = true;
      c.dir = a.dir;
      return 'applied';
    case 'stop_walking':
      c.walking = false;
      return 'applied';
    case 'begin_mining_terrain': {
      const tx = Math.floor(a.pos.x / 256);
      const ty = Math.floor(a.pos.y / 256);
      const ch = w.chunk(toChunk(tx), toChunk(ty));
      const r = ch.resources.find((x) => x.tile === (ty - ch.cy * 32) * 32 + (tx - ch.cx * 32));
      if (!r) return { reason: FAIL.nothing_to_mine };
      if (!c.mining || Math.floor(c.mining.x) !== tx || Math.floor(c.mining.y) !== ty) c.miningProgress = 0;
      c.mining = { x: tx + 0.5, y: ty + 0.5 };
      return 'applied';
    }
    case 'stop_mining':
      c.mining = null;
      c.miningProgress = 0;
      return 'applied';
    case 'craft': {
      const r = w.p.json.recipe[a.recipe];
      if (!r) return { reason: FAIL.invalid_index };
      if (!r.handcraft) return { reason: FAIL.cannot_handcraft };
      let can = 65535;
      for (const ing of r.ingredients) {
        const k = Math.floor(w.total(c, ing.id * 8) / ing.amount);
        if (k < can) can = k;
      }
      const n = a.count === 0 ? can : a.count < can ? a.count : can;
      if (n === 0) return { reason: FAIL.not_enough_ingredients };
      for (const ing of r.ingredients) {
        let left = n * ing.amount;
        for (let i = c.main.length - 1; i >= 0 && left > 0; i--) {
          const s = c.main[i] as Slot;
          if (s.key !== ing.id * 8) continue;
          const k = left < s.count ? left : s.count;
          s.count -= k;
          left -= k;
          if (s.count === 0) s.key = EMPTY;
        }
      }
      const last = c.queue[c.queue.length - 1];
      if (last && last.recipe === a.recipe) last.count += n;
      else c.queue.push({ recipe: a.recipe, count: n, progress: 0 });
      return 'applied';
    }
    case 'cancel_craft': {
      const q = c.queue[a.index];
      if (!q) return { reason: FAIL.invalid_index };
      const r = w.p.json.recipe[q.recipe];
      const m = a.count === 0 || a.count > q.count ? q.count : a.count;
      for (const ing of r?.ingredients ?? []) w.add(c, ing.id * 8, m * ing.amount);
      q.count -= m;
      if (q.count === 0) c.queue.splice(a.index, 1);
      return 'applied';
    }
    case 'cursor_transfer':
    case 'cursor_split': {
      if (a.slot.owner.tag !== 0) return 'not modelled';
      const s = c.main[a.slot.slot];
      if (!s) return { reason: FAIL.invalid_index };
      const split = a.type === 'cursor_split';
      if (c.hand.count === 0) {
        if (s.count === 0) return 'applied';
        const take = split ? Math.ceil(s.count / 2) : s.count;
        c.hand = { key: s.key, count: take, origin: a.slot.slot };
        s.count -= take;
        if (s.count === 0) s.key = EMPTY;
      } else if (s.count === 0) {
        const put = split ? 1 : c.hand.count;
        s.key = c.hand.key;
        s.count = put;
        c.hand.count -= put;
      } else if (s.key === c.hand.key) {
        const room = w.p.stack(s.key) - s.count;
        const put = split ? (room > 0 ? 1 : 0) : room < c.hand.count ? room : c.hand.count;
        s.count += put;
        c.hand.count -= put;
      } else if (!split) {
        const held = { ...c.hand };
        c.hand = { key: s.key, count: s.count, origin: a.slot.slot };
        s.key = held.key;
        s.count = held.count;
      }
      if (c.hand.count === 0) c.hand = { key: EMPTY, count: 0, origin: EMPTY };
      return 'applied';
    }
    case 'clear_cursor':
      if (c.hand.count > 0) {
        const left = c.hand.count - w.add(c, c.hand.key, c.hand.count);
        c.hand = left > 0 ? { ...c.hand, count: left } : { key: EMPTY, count: 0, origin: EMPTY };
      }
      return 'applied';
    case 'set_player_setting':
      if (a.setting === 1) c.autoSort = a.value === 1;
      return 'applied';
    default:
      return 'not modelled';
  }
}
