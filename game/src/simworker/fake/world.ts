// The fake sim's world (10 §15.10): generated terrain, a small factory that runs, and characters driven by
// actions. Not a simulation: it animates what the renderer, the UI and audio consume, at the rates the real
// game produces them, deterministically from its seed and the actions it is given. The player's M0 actions
// follow the golden set's reference model (rules.ts); the factory around them is scenery with real rates.

import { Writer } from '../../shared/gen/codec.ts';
import type { EventMeta, EventPayload } from '../../shared/gen/events.ts';
import { EVENT_QUEUE_MAX_EVENTS, writeEvent } from '../../shared/gen/events.ts';
import type { BeltSegment, ObjectView } from '../../shared/gen/packet.ts';
import { emptySlots, type Slot, sortSlots } from './inventory.ts';
import { fractal, hash, unit } from './noise.ts';
import type { FakeProtos } from './protos.ts';
import { characterTick, entityBox, finishEntityMining, overlaps, protoBox } from './rules.ts';
import { type StatRecord, Stats } from './stats.ts';

export type { Slot } from './inventory.ts';

export interface FakeOptions {
  /** Ticks per day (Factorio: 25,000); the dev page can shorten it to see the night. */
  dayTicks?: number;
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
  /** A chest's limit bar (set_inventory_bar): slots from it on are limited; `inv.length` when unlimited. */
  bar: number;
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
  /** The serials of the belts it runs over. */
  belts: number[];
  /** A belt of the line was mined: the line is gone (retired at the next packet, never sent again). */
  removed: boolean;
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
  /** Hand mining (§5.1): a resource tile (with the position the action named) or an entity, by serial. */
  mining:
    | { kind: 'tile'; tx: number; ty: number; pos: { x: number; y: number } }
    | { kind: 'entity'; serial: number }
    | null;
  miningProgress: number;
  main: Slot[];
  /** The cursor stack (I §3.2): a stack with its origin slot (0xFFFF none), or a ghost cursor (count 0). */
  hand: { key: number; count: number; origin: number; ghost: boolean };
  queue: { recipe: number; count: number; progress: number }[];
  inputGen: number;
  lastSeq: number;
  lastActionTick: number;
  autoSort: boolean;
  pickGhost: boolean;
  /** The creation ring (§4.3): the entities this player's recent actions created, by the action's seq. */
  creation: { seq: number; serial: number }[];
  /** Player 1 walks a fixed loop around the factory (a puppet: it walks through buildings). */
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
  /** Changed since it was generated (its entities, resources or tiles): saved; a pristine chunk regenerates. */
  modified: boolean;
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

/** The fake world's state as plain data (the fake's own save format, fake.ts): everything but the protos. */
export interface FakeSnapshot {
  seed: number;
  dayTicks: number;
  tick: number;
  nextSerial: number;
  geomCounter: number;
  demoChest: number;
  literature: number;
  trimmedCollision: boolean;
  chunks: ChunkData[];
  entities: Ent[];
  lines: Line[];
  inserters: Ins[];
  chars: Char[];
  stats: StatRecord[];
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
  /** This tick's production and consumption counters (§5.20), by stat key. */
  readonly produced = new Map<number, number>();
  readonly consumed = new Map<number, number>();
  /** Every key's totals and rings (phase 15). */
  readonly stats = new Stats();
  private geomCounter = 0;
  /** The serial of the chest the build-and-mine demo keeps rebuilding, 0 while it is mined. */
  private demoChest = 0;
  literature = 1945;
  /** The game setting `trimmed_collision` (set_game_setting); the fake's characters do not read it. */
  trimmedCollision = false;

  /** A new world from its seed, or, with `snap`, the world a fake save holds. */
  constructor(protos: FakeProtos, seed: number, opts: FakeOptions = {}, snap?: FakeSnapshot) {
    this.p = protos;
    if (snap) {
      this.seed = snap.seed;
      this.dayTicks = snap.dayTicks;
      this.tick = snap.tick;
      this.nextSerial = snap.nextSerial;
      this.geomCounter = snap.geomCounter;
      this.demoChest = snap.demoChest;
      this.literature = snap.literature;
      this.trimmedCollision = snap.trimmedCollision;
      for (const c of snap.chunks) this.chunks.set(c.key, c);
      this.entities.push(...snap.entities);
      this.lines.push(...snap.lines);
      this.inserters.push(...snap.inserters);
      this.chars.push(...snap.chars);
      for (const r of snap.stats) this.stats.records.set(r.key, r);
      return;
    }
    this.seed = seed >>> 0;
    this.dayTicks = opts.dayTicks ?? 25000;
    this.layout();
  }

  /** The state as plain data, deep-copied (the fake's save; events are presentation and are not kept). */
  snapshot(): FakeSnapshot {
    const snap: FakeSnapshot = {
      seed: this.seed,
      dayTicks: this.dayTicks,
      tick: this.tick,
      nextSerial: this.nextSerial,
      geomCounter: this.geomCounter,
      demoChest: this.demoChest,
      literature: this.literature,
      trimmedCollision: this.trimmedCollision,
      // Pristine chunks are a pure function of the seed (§4.4): only modified ones are kept.
      chunks: [...this.chunks.values()].filter((c) => c.modified),
      entities: this.entities,
      lines: this.lines,
      inserters: this.inserters,
      chars: this.chars,
      stats: [...this.stats.records.values()],
    };
    return JSON.parse(JSON.stringify(snap)) as FakeSnapshot;
  }

  /** A part of the chunk holding tile (tx, ty) changed: its view version rises and it is no longer pristine. */
  changed(tx: number, ty: number, part: 'tiles' | 'entities' | 'objects' | 'resources'): void {
    const c = this.chunk(toChunk(tx), toChunk(ty));
    c.version[part]++;
    c.modified = true;
  }

  entityBySerial(serial: number): Ent | null {
    return serial === 0 ? null : (this.entities.find((e) => e.serial === serial) ?? null);
  }

  /** Removes a mined entity, with what animates it: an inserter's hand, the transport lines over a belt. */
  removeEntity(e: Ent): void {
    const i = this.entities.indexOf(e);
    if (i < 0) return;
    this.entities.splice(i, 1);
    this.changed(e.x2 >> 1, e.y2 >> 1, 'entities');
    const k = this.inserters.findIndex((x) => x.serial === e.serial);
    if (k >= 0) this.inserters.splice(k, 1);
    if (e.role === 'belt')
      for (const l of this.lines)
        if (!l.removed && l.belts.includes(e.serial)) {
          l.removed = true;
          l.items = [];
        }
    if (e.serial === this.demoChest) this.demoChest = 0;
  }

  /** An entity a player builds (§5.2): a chest gets an empty inventory; machines stand idle. */
  addBuilt(proto: number, x2: number, y2: number, dir: number): Ent {
    const j = this.p.json.entity[proto] as {
      type: string;
      inventorySlots: number | null;
      energyUsageW: number;
    };
    const role: Ent['role'] =
      j.type === 'chest'
        ? 'chest'
        : j.type === 'belt' || j.type === 'splitter'
          ? 'belt'
          : j.type === 'lamp'
            ? 'lamp'
            : j.type === 'inserter' ||
                j.type === 'electric-pole' ||
                j.type === 'pipe' ||
                j.type === 'pipe-to-ground'
              ? 'static'
              : j.type === 'underground-belt' || j.type === 'solar-panel'
                ? 'static'
                : 'machine';
    const slots = role === 'chest' ? (j.inventorySlots ?? 16) : 0;
    const e: Ent = {
      serial: this.serial(),
      proto,
      name: (this.p.json.entity[proto] as { name: string }).name,
      x2,
      y2,
      dir,
      flags: 0,
      altIcon: 0xffff,
      role,
      working: role === 'belt',
      unpowered: false,
      phase: hash(this.seed, x2, y2, 5) & 0xffff,
      loop: role === 'belt' ? 16 : 60,
      craftTicks: 0,
      progress: 0,
      produces: [],
      consumes: [],
      recipe: 0xffff,
      inv: emptySlots(slots),
      bar: slots,
      energyW: j.energyUsageW,
    };
    this.entities.push(e);
    this.changed(x2 >> 1, y2 >> 1, 'entities');
    return e;
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
          const species = this.p.json.treeSpecies.length;
          if (forest > 0.62 && unit(h) < 0.35) {
            // Trees (kind 0): the species indexes prototypes.json's treeSpecies (none without the table);
            // every leaf stage appears (§4.4, §15.7).
            if (species > 0)
              objects.push({
                id: h % species,
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
      modified: false,
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
      bar: 0,
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
    return this.place(name, tx, ty, 0, 'chest', { inv, bar: size });
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
    const belts: number[] = [];
    for (let i = 0; i < n; i++) {
      const b = this.place(name, from[0] + dx * i, from[1] + dy * i, dir, 'belt', { loop: 16 });
      if (b) belts.push(b.serial);
    }
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
      this.addLine([seg], lane, speedPos, item, sourceEvery, sinkEvery, from, to, belts);
    }
  }

  /** A belt that runs east, then turns right (south) through a quarter arc: §15.4's arcs. */
  private beltCorner(name: string, x0: number, y: number, cornerX: number, y1: number, item: string): void {
    const proto = this.p.id('entity', name);
    if (proto === null) return;
    const belts: number[] = [];
    const add = (b: Ent | null) => {
      if (b) belts.push(b.serial);
    };
    for (let x = x0; x < cornerX; x++) add(this.place(name, x, y, 4, 'belt', { loop: 16 }));
    add(this.place(name, cornerX, y, 8, 'belt', { loop: 16 }));
    for (let yy = y + 1; yy <= y1; yy++) add(this.place(name, cornerX, yy, 8, 'belt', { loop: 16 }));
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
      this.addLine(segs, lane, 8, item, 26, 30, [x0, y], [cornerX, y1], belts);
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
    belts: number[],
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
      belts,
      removed: false,
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
    const main = emptySlots(this.p.char.mainSlots);
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
      while (left > 0 && slot < main.length) {
        const k = left < this.p.stack(key) ? left : this.p.stack(key);
        main[slot++] = { key, count: k };
        left -= k;
      }
    }
    // Auto-sort is on (D11): the main inventory starts sorted.
    sortSlots({ slots: main, bar: main.length, origin: -1 }, (k) => this.p.stack(k));
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
      hand: { key: EMPTY, count: 0, origin: EMPTY, ghost: false },
      queue: [],
      inputGen: 0,
      lastSeq: 0,
      lastActionTick: 0,
      autoSort: true,
      pickGhost: false,
      creation: [],
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

  count(m: Map<number, number>, itemKey: number, n: number): void {
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

  /**
   * Every 10 s player 1 builds a chest by the spawn point (unless something stands there), and 5 s later mines
   * it again by the rules of a player's mining: its item and its seven plates go to player 1's inventory.
   */
  private demo(): void {
    const t = this.tick % 600;
    const p1 = this.chars[1];
    const proto = this.p.id('entity', 'wooden-chest');
    if (!p1 || proto === null) return;
    if (t === 0 && this.demoChest === 0) {
      const box = protoBox(this, proto, -5, 7, 0);
      if (this.entities.some((e) => overlaps(box, entityBox(this, e)))) return;
      const e = this.chest('wooden-chest', -3, 3, [['iron-plate', 7]]);
      if (!e) return;
      this.demoChest = e.serial;
      this.changed(-3, 3, 'entities');
      this.emit(
        { seq: 0, player: 1 },
        { type: 'entity_built', serial: e.serial, proto, dir: 0, flags: 0, pos: { x2: e.x2, y2: e.y2 } },
      );
    } else if (t === 300 && this.demoChest !== 0) {
      const e = this.entityBySerial(this.demoChest);
      if (e) finishEntityMining(this, p1, e);
    }
  }

  private charTick(c: Char): void {
    if (c.scripted && c.online) {
      // Player 1 walks a rectangle around the factory's south side, turning every 3 s.
      const leg = Math.floor(this.tick / 180) % 4;
      c.dir = [4, 0, 12, 8][leg] as number;
      c.walking = Math.floor(this.tick / 90) % 6 !== 5; // and pauses now and then (the idle clip)
    }
    characterTick(this, c);
  }

  /** Phase 15: this tick's counters into every key's totals and rings (stats.ts). */
  private flushStats(): void {
    this.stats.flush(this.tick, this.produced, this.consumed);
  }

  /** The animated entities' electric draw, for the HUD's music feed (§15.6: activity in W). */
  activityW(): number {
    let w = 0;
    for (const e of this.entities) if (e.working && !e.unpowered && e.role === 'machine') w += e.energyW;
    return w;
  }
}
