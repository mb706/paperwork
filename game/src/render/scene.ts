// One frame's sprites (10 §6.2 steps 2–6, §6.6, §6.8): the mirror's visible chunks walked in row order within the
// view plus a 6-tile margin, ground layers first (resources, floor entities, decoratives, ground items, belt items
// expanded from gap arrays), then the objects sorted by (bottom y, x, serial) with a counting sort by tile row,
// each drawn by its program; shadows and lights go to their own streams as the programs meet them. Sprites are
// culled by their quads. A set whose pages are not resident draws its greybox and is reported, so the asset
// worker fetches it first (10 §9.7). The Scene is the programs' SpriteSink: it turns frames into batcher quads.
// In steady state nothing here allocates: buffers grow and are kept, and doubles travel in typed blocks (the sink's
// args, the programs' AT, the batcher's QUAD), never as call arguments, which V8 would box.

import { beltOut, expandLine } from './belts.ts';
import { ALPHA_TINT, QUAD, rgba8, Stream, WHITE } from './gl/batcher.ts';
import { type Lookups, ROLE } from './lookups.ts';
import type { Atlas, SpriteSet } from './manifest.ts';
import { AXIS, axisValues, KIND, lookup } from './manifest.ts';
import { type ChunkView, chunkId, DY, EV, HA, type Mirror, MO, OV, RV } from './mirror.ts';
import {
  AT,
  drawEntity,
  drawIcon,
  drawInserter,
  drawMover,
  drawObject,
  drawResource,
  entityInput,
  inserterInput,
  moverInput,
  SINK_ARGS,
  type SpriteSink,
  STREAM,
} from './programs.ts';
import { type Camera, CHUNK_TILES, CULL_MARGIN_TILES, POS_ONE, posHashInto, scaleOf } from './projection.ts';
import { BELT_ITEM_SIZE, DEBUG_COLOURS, SMOKE } from './style.ts';

/** The overlay streams (10 §6.2 step 8: after the grade): ghosts (colour array, tinted) and solid debug quads. */
export const OVERLAY = { ghost: 7, solid: 8 } as const;
export const STREAMS = 9;

/** The texture array each stream samples (KIND codes; −1: solid colour). */
export const STREAM_KIND: readonly number[] = [
  KIND.colour,
  KIND.icon,
  KIND.shadow,
  KIND.colour,
  KIND.colour,
  KIND.icon,
  KIND.light,
  KIND.colour,
  -1,
];

/** F4's checklist (I §4.21): what the debug overlay draws. */
export interface DebugFlags {
  tileGrid: boolean;
  chunkGrid: boolean;
  collision: boolean;
  selection: boolean;
  positions: boolean;
}
export const NO_DEBUG: DebugFlags = {
  tileGrid: false,
  chunkGrid: false,
  collision: false,
  selection: false,
  positions: false,
};

/** A ghost's hologram tint (premultiplied): a pale blueprint blue. */
const GHOST_TINT = rgba8(0.42 * 0.62, 0.6 * 0.62, 0.78 * 0.62, 0.62);
const ITEM = { entity: 0, inserter: 1, object: 2, mover: 3 } as const;
/** The deconstruction mark's red (premultiplied). */
const DECON_TINT = rgba8(
  DEBUG_COLOURS.chunkGrid[0] * 0.9,
  DEBUG_COLOURS.chunkGrid[1] * 0.9,
  DEBUG_COLOURS.chunkGrid[2] * 0.9,
  0.9,
);

interface MoverState {
  x: number;
  y: number;
  dist: number;
  packet: number;
}

export interface SceneStats {
  chunks: number;
  entities: number;
  objects: number;
  beltItems: number;
  movers: number;
  greyboxed: number;
}

export class Scene implements SpriteSink {
  readonly streams: Stream[] = Array.from({ length: STREAMS }, () => new Stream());
  readonly atlas: Atlas;
  readonly look: Lookups;
  /** Per set: 1 when its pages are resident (null: everything is, as in the tests). */
  resident: Uint8Array | null = null;
  /** Per set: drawn this frame without a resident page (the loader fetches those first, 10 §9.7). */
  readonly missed: Uint8Array;
  /** Per colour page: drawn this frame with more than one source px per device px (wants level 0). */
  readonly wantLevel0: Uint8Array;
  /** Receives every draw too (tests record the frame's draw list with it). */
  tap: SpriteSink | null = null;
  readonly stats: SceneStats = { chunks: 0, entities: 0, objects: 0, beltItems: 0, movers: 0, greyboxed: 0 };
  /** Extrapolate movers from their base tick (off in on-demand rendering, so screenshots are exact). */
  extrapolate = true;
  /** The programs' argument block (SpriteSink). */
  readonly args = new Float64Array(SINK_ARGS);

  private cam: Camera = { cx: 0, cy: 0, zoom: 1, dpr: 1 };
  private S = 32;
  private halfW = 0;
  private halfH = 0;
  private ghost = false;
  private readonly ev = entityInput();
  private readonly hi = inserterInput();
  private readonly mi = moverInput();
  private readonly vals = axisValues();
  private belts = beltOut();
  /** posHashInto's output for smoke (uint32). */
  private readonly hash = new Uint32Array(2);
  /** line()'s block: [x0, y0, x1, y1] tiles, [4] width in device px. */
  private readonly ln = new Float64Array(5);
  private readonly smokeRadius: number;
  // the object items of a frame, sorted by (bottom y, x, serial); keys in 1/256 tile
  private cap = 0;
  private keyY = new Int32Array(0);
  private keyX = new Int32Array(0);
  private serial = new Uint32Array(0);
  private kind = new Uint8Array(0);
  private refA = new Int32Array(0);
  private refB = new Int32Array(0);
  private sorted = new Int32Array(0);
  private buckets = new Int32Array(64);
  private n = 0;
  private chunkRefs: ChunkView[] = [];
  /** How many of chunkRefs this frame visits (the array is never shrunk, so it never regrows). */
  private nChunks = 0;
  private readonly movers = new Map<number, MoverState>();
  private readonly pagesColour: number;
  /** Icon frame → its set (icons are single-frame sets), for residency checks. */
  private readonly iconSetOf: Int32Array;
  /** Per frame: its four corners' packed uv words (u | v << 16, u16 normalised), its array, its layer. */
  private readonly uvWords: Uint32Array;
  private readonly frameArray: Int32Array;
  private readonly frameLayer: Uint32Array;
  private readonly colourArray: number;
  /** This frame's colour pages are drawn with k > 0.5 (they want High level 0, 10 §15.7). */
  private colourWantsLevel0 = false;

  constructor(atlas: Atlas, look: Lookups) {
    this.atlas = atlas;
    this.look = look;
    this.missed = new Uint8Array(atlas.sets.length);
    this.pagesColour = Math.max(1, atlas.json.pages[atlas.arrayOfKind[KIND.colour] as number]?.length ?? 1);
    this.wantLevel0 = new Uint8Array(this.pagesColour);
    // the uv words of every frame, once: a quad then only copies them (10 §6.3's u16 normalised uv)
    const n = atlas.frameCount;
    this.uvWords = new Uint32Array(n * 4);
    this.frameArray = new Int32Array(n);
    this.frameLayer = new Uint32Array(n);
    for (let f = 0; f < n; f++) {
      const o = f * 8;
      const a = atlas.frames[o] as number;
      const k = 65535 / (atlas.pageSize[a] as number);
      const x = atlas.frames[o + 2] as number;
      const y = atlas.frames[o + 3] as number;
      const u0 = Math.round(x * k);
      const v0 = Math.round(y * k);
      const u1 = Math.round((x + (atlas.frames[o + 4] as number)) * k);
      const v1 = Math.round((y + (atlas.frames[o + 5] as number)) * k);
      this.uvWords[f * 4] = (u0 | (v0 << 16)) >>> 0;
      this.uvWords[f * 4 + 1] = (u1 | (v0 << 16)) >>> 0;
      this.uvWords[f * 4 + 2] = (u0 | (v1 << 16)) >>> 0;
      this.uvWords[f * 4 + 3] = (u1 | (v1 << 16)) >>> 0;
      this.frameArray[f] = a;
      this.frameLayer[f] = atlas.frames[o + 1] as number;
    }
    this.colourArray = atlas.arrayOfKind[KIND.colour] as number;
    const smoke = look.smokeSet >= 0 ? atlas.sets[look.smokeSet] : undefined;
    this.smokeRadius = (smoke && (atlas.json.sets[smoke.name]?.radiusTiles as number | undefined)) ?? 0.34;
    this.iconSetOf = new Int32Array(atlas.frameCount).fill(-1);
    for (const s of atlas.sets)
      if (s.icon !== null && (s.icon.entries[1] as number) > 0)
        this.iconSetOf[atlas.entryFrames[s.icon.entries[0] as number] as number] = s.index;
    this.grow(1024);
  }

  private grow(n: number): void {
    const cap = Math.max(n, this.cap * 2);
    const keep = <T extends Float64Array | Uint32Array | Uint8Array | Int32Array>(a: T, b: T): T => {
      b.set(a.subarray(0, Math.min(a.length, this.n)));
      return b;
    };
    this.keyY = keep(this.keyY, new Int32Array(cap));
    this.keyX = keep(this.keyX, new Int32Array(cap));
    this.serial = keep(this.serial, new Uint32Array(cap));
    this.kind = keep(this.kind, new Uint8Array(cap));
    this.refA = keep(this.refA, new Int32Array(cap));
    this.refB = keep(this.refB, new Int32Array(cap));
    this.sorted = new Int32Array(cap);
    this.cap = cap;
  }

  private ok(set: SpriteSet | null): boolean {
    return set !== null && (this.resident === null || this.resident[set.index] === 1);
  }

  /** A set if its pages are resident, else null (reported as missed). */
  private usable(index: number): SpriteSet | null {
    if (index < 0) return null;
    const s = this.atlas.sets[index] as SpriteSet;
    if (this.ok(s)) return s;
    this.missed[index] = 1;
    this.stats.greyboxed++;
    return null;
  }

  // ------------------------------------------------------------------------------------------- SpriteSink

  quad(stream: number, f: number): void {
    const a = this.args;
    if (this.tap) {
      this.tap.args.set(a);
      this.tap.quad(stream, f);
    }
    const left = a[0] as number;
    const top = a[1] as number;
    const w = a[2] as number;
    const h = a[3] as number;
    const alpha = a[4] as number;
    const q = QUAD;
    let st = stream;
    // the tint goes straight into the block: a local mixing the WHITE constant with a table word would be boxed
    if (alpha < 1) {
      const ai = Math.round(alpha * 255);
      q[4] = ALPHA_TINT[ai < 0 ? 0 : ai] as number;
    } else q[4] = WHITE;
    if (this.ghost) {
      if (stream === STREAM.shadow || stream === STREAM.light) return;
      if (stream === STREAM.groundIcon || stream === STREAM.highIcon) return;
      st = OVERLAY.ghost;
      q[4] = GHOST_TINT;
    }
    if (alpha <= 0 && stream === STREAM.light) return;
    if (left > this.halfW || top > this.halfH || left + w < -this.halfW || top + h < -this.halfH) return;
    const layer = this.frameLayer[f] as number;
    if (this.colourWantsLevel0 && this.frameArray[f] === this.colourArray && layer < this.pagesColour)
      this.wantLevel0[layer] = 1;
    q[0] = left;
    q[1] = top;
    q[2] = w;
    q[3] = h;
    (this.streams[st] as Stream).rect(this.uvWords, f * 4, layer);
  }

  rotated(stream: number, f: number): void {
    const a = this.args;
    if (this.tap) {
      this.tap.args.set(a);
      this.tap.rotated(stream, f);
    }
    let st = stream;
    let tint = WHITE;
    if (this.ghost) {
      if (stream === STREAM.shadow) return;
      st = OVERLAY.ghost;
      tint = GHOST_TINT;
    }
    const pivotX = a[0] as number;
    const pivotY = a[1] as number;
    const atX = a[2] as number;
    const atY = a[3] as number;
    const turns = a[4] as number;
    const k = a[5] as number;
    const stretch = a[6] as number;
    const fr = this.atlas.frames;
    const o = f * 8;
    const layer = fr[o + 1] as number;
    const P = this.atlas.pageSize[fr[o] as number] as number;
    const x = fr[o + 2] as number;
    const y = fr[o + 3] as number;
    const fw = fr[o + 4] as number;
    const fh = fr[o + 5] as number;
    const reach = (Math.max(fw, fh * stretch) + Math.max(pivotX, pivotY)) * k;
    if (
      atX - reach > this.halfW ||
      atX + reach < -this.halfW ||
      atY - reach > this.halfH ||
      atY + reach < -this.halfH
    )
      return;
    const ang = 2 * Math.PI * turns;
    const c = Math.cos(ang) * k;
    const s = Math.sin(ang) * k;
    // corners relative to the pivot (frame px), stretched along the frame's vertical, rotated clockwise, scaled
    const u0 = -pivotX;
    const u1 = fw - pivotX;
    const v0 = -pivotY * stretch;
    const v1 = (fh - pivotY) * stretch;
    const uk = 65535 / P;
    const q = QUAD;
    q[0] = atX + u0 * c - v0 * s;
    q[1] = atY + u0 * s + v0 * c;
    q[2] = atX + u1 * c - v0 * s;
    q[3] = atY + u1 * s + v0 * c;
    q[4] = atX + u0 * c - v1 * s;
    q[5] = atY + u0 * s + v1 * c;
    q[6] = atX + u1 * c - v1 * s;
    q[7] = atY + u1 * s + v1 * c;
    q[8] = tint;
    (this.streams[st] as Stream).quad(
      Math.round(x * uk),
      Math.round(y * uk),
      Math.round((x + fw) * uk),
      Math.round((y + fh) * uk),
      layer,
    );
  }

  part(code: number, index: number, set: SpriteSet | null): void {
    if (this.tap) this.tap.part(code, index, set);
  }

  fallback(set: SpriteSet): void {
    if (this.tap) this.tap.fallback(set);
  }

  held(item: number): void {
    const a = this.args;
    if (this.tap) {
      this.tap.args.set(a);
      this.tap.held(item);
    }
    if (this.ghost) return;
    const f = this.iconFrame(this.look.itemFrame(item));
    if (f < 0) return;
    // args [atX, atY] are device px from the canvas centre: back to tiles for the icon program
    AT[0] = this.cam.cx + (a[0] as number) / this.S;
    AT[1] = this.cam.cy + (a[1] as number) / this.S;
    AT[3] = a[2] as number;
    drawIcon(this.atlas, this, this.cam, f, STREAM.highIcon);
  }

  /** The icon frame if its page is resident, else fx/missing's if that is, else −1. */
  private iconFrame(f: number): number {
    if (f < 0 || this.resident === null) return f;
    return this.pageResident(f) ? f : this.pageResident(this.look.missingIcon) ? this.look.missingIcon : -1;
  }

  private pageResident(f: number): boolean {
    if (f < 0) return false;
    const si = this.iconSetOf[f] as number;
    if (si < 0) return true;
    if (this.resident === null || this.resident[si] === 1) return true;
    this.missed[si] = 1;
    return false;
  }

  /** A set if its pages are resident, else null, without reporting it (greyboxes are drawn only when needed). */
  private peek(index: number): SpriteSet | null {
    if (index < 0) return null;
    const s = this.atlas.sets[index] as SpriteSet;
    return this.ok(s) ? s : null;
  }

  // ------------------------------------------------------------------------------------------- the frame

  /**
   * Builds the frame's streams from the mirror. W, H: the canvas in device px; `renderTick` the sim tick with the
   * fraction since the last packet (movers extrapolate from it, idle clips and smoke run on it).
   */
  build(
    mirror: Mirror,
    cam: Camera,
    W: number,
    H: number,
    renderTick: number,
    debug: DebugFlags = NO_DEBUG,
  ): void {
    for (let i = 0; i < this.streams.length; i++) (this.streams[i] as Stream).reset();
    this.missed.fill(0);
    this.wantLevel0.fill(0);
    const st = this.stats;
    st.chunks = 0;
    st.entities = 0;
    st.objects = 0;
    st.beltItems = 0;
    st.movers = 0;
    st.greyboxed = 0;
    this.cam = cam;
    this.lastTick = renderTick;
    const S = scaleOf(cam);
    this.S = S;
    this.colourWantsLevel0 = S / (this.atlas.pxPerTile[this.colourArray] as number) > 0.5;
    this.halfW = W / 2;
    this.halfH = H / 2;
    const vx0 = cam.cx - W / 2 / S - CULL_MARGIN_TILES;
    const vy0 = cam.cy - H / 2 / S - CULL_MARGIN_TILES;
    const vx1 = cam.cx + W / 2 / S + CULL_MARGIN_TILES;
    const vy1 = cam.cy + H / 2 / S + CULL_MARGIN_TILES;
    const cx0 = Math.floor(vx0 / CHUNK_TILES);
    const cy0 = Math.floor(vy0 / CHUNK_TILES);
    const cx1 = Math.floor(vx1 / CHUNK_TILES);
    const cy1 = Math.floor(vy1 / CHUNK_TILES);
    // the chunks to visit, in row order
    let nc = 0;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = mirror.chunks.get(chunkId(cx, cy));
        if (c === undefined) continue;
        this.chunkRefs[nc++] = c;
      }
    this.nChunks = nc;
    st.chunks = nc;
    this.n = 0;
    const tick = mirror.tick;
    const look = this.look;
    const dynV = mirror.dyn.view;
    const decorOk = cam.zoom >= 0.5;

    // ground layers: resources, floor entities, decoratives; ground items as icons
    for (let ci = 0; ci < nc; ci++) {
      const c = this.chunkRefs[ci] as ChunkView;
      const ox = c.cx * CHUNK_TILES;
      const oy = c.cy * CHUNK_TILES;
      if (c.resourceCount > 0) {
        const v = c.resourceView;
        for (let i = 0; i < c.resourceCount; i++) {
          const o = i * 8;
          const tile = v.getUint16(o + RV.tile, true);
          const s = this.usable(look.resourceSet[v.getUint16(o + RV.resource, true)] ?? -1);
          if (s === null) continue;
          drawResource(this.atlas, this, cam, s, ox + (tile & 31), oy + (tile >> 5), v.getUint8(o + RV.band));
        }
      }
      if (c.entityCount > 0) {
        const v = c.entityView;
        for (let i = 0; i < c.entityCount; i++) {
          const o = i * 24;
          const proto = v.getUint16(o + EV.proto, true);
          const role = look.role[proto] ?? ROLE.none;
          const x2 = v.getInt32(o + EV.x2, true);
          const y2 = v.getInt32(o + EV.y2, true);
          if (x2 / 2 < vx0 || x2 / 2 > vx1 || y2 / 2 < vy0 || y2 / 2 > vy1) continue;
          if (role === ROLE.floor) {
            this.entity(v, o, proto, mirror, dynV, tick, STREAM.ground);
            continue;
          }
          if (role === ROLE.none) continue;
          const dir = v.getUint8(o + EV.dir);
          const turned = dir === 4 || dir === 12;
          const h = (turned ? look.size[proto * 2] : look.size[proto * 2 + 1]) as number;
          // keys in 1/256 tile: integers, so the call boxes nothing
          this.push(
            role === ROLE.inserter ? ITEM.inserter : ITEM.entity,
            Math.round((y2 + h) * 128),
            x2 * 128,
            v.getUint32(o + EV.serial, true),
            ci,
            i,
          );
        }
      }
      if (c.objectCount > 0) {
        const v = c.objectView;
        for (let i = 0; i < c.objectCount; i++) {
          const o = i * 16;
          const kind = v.getUint8(o + OV.kind);
          const x = v.getInt32(o + OV.x, true);
          const y = v.getInt32(o + OV.y, true);
          if (x / POS_ONE < vx0 || x / POS_ONE > vx1 || y / POS_ONE < vy0 || y / POS_ONE > vy1) continue;
          if (kind === 0 || kind === 1) this.push(ITEM.object, y, x, 0, ci, i);
          else if (kind === 4 && decorOk) {
            const s = this.usable(look.decorSet[v.getUint16(o + OV.id, true)] ?? -1);
            if (s !== null)
              drawObject(this.atlas, this, cam, s, x, y, v.getUint8(o + OV.variant), STREAM.ground);
          } else if (kind === 3) {
            const f = this.iconFrame(look.itemFrame(v.getUint16(o + OV.id, true)));
            if (f >= 0) {
              AT[0] = x / POS_ONE;
              AT[1] = y / POS_ONE;
              AT[3] = BELT_ITEM_SIZE;
              drawIcon(this.atlas, this, cam, f, STREAM.groundIcon);
            }
          }
        }
      }
    }

    // belt items, expanded from the gap arrays over the cached line geometry
    const bi = mirror.beltItems;
    for (let li = 0; li < bi.count; li++) {
      const o = mirror.beltItemOffsets[li] as number;
      const id = bi.view.getUint32(o, true);
      const gen = bi.view.getUint32(o + 4, true);
      const line = mirror.lines.get(id);
      if (line === undefined || line.geomGen !== gen) continue;
      let n = expandLine(line, bi.view, o, this.belts);
      if (n < 0) {
        this.belts = beltOut(-n * 2);
        n = expandLine(line, bi.view, o, this.belts);
      }
      for (let k = 0; k < n; k++) {
        const x = this.belts.x[k] as number;
        const y = this.belts.y[k] as number;
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        const f = this.iconFrame(look.itemFrame(this.belts.key[k] as number));
        if (f >= 0) {
          AT[0] = x;
          AT[1] = y;
          AT[3] = BELT_ITEM_SIZE;
          drawIcon(this.atlas, this, cam, f, STREAM.groundIcon);
        }
        st.beltItems++;
      }
    }

    // movers (the character): extrapolated from base_tick; the run clip's distance integrates along the path
    const mv = mirror.movers;
    for (let i = 0; i < mv.count; i++) {
      const o = i * 32;
      const kind = mv.view.getUint8(o + MO.kind);
      if (kind !== 0) continue;
      const dt = this.extrapolate ? renderTick - mv.view.getUint32(o + MO.base_tick, true) : 0;
      const x = mv.view.getInt32(o + MO.x, true) + mv.view.getInt16(o + MO.vx, true) * dt;
      const y = mv.view.getInt32(o + MO.y, true) + mv.view.getInt16(o + MO.vy, true) * dt;
      if (x / POS_ONE < vx0 || x / POS_ONE > vx1 || y / POS_ONE < vy0 || y / POS_ONE > vy1) continue;
      this.push(ITEM.mover, Math.round(y), Math.round(x), mv.view.getUint32(o + MO.serial, true), i, 0);
    }
    this.trackMovers(mirror);

    // objects, sorted; each program sends its shadow and light to their streams as it goes
    this.sortItems();
    for (let k = 0; k < this.n; k++) {
      const it = this.sorted[k] as number;
      const kind = this.kind[it] as number;
      if (kind === ITEM.mover) {
        this.mover(mirror, this.refA[it] as number);
        continue;
      }
      const c = this.chunkRefs[this.refA[it] as number] as ChunkView;
      const ri = this.refB[it] as number;
      if (kind === ITEM.object) {
        const v = c.objectView;
        const o = ri * 16;
        const okind = v.getUint8(o + OV.kind);
        const id = v.getUint16(o + OV.id, true);
        const s = this.usable((okind === 0 ? look.treeSet[id] : look.worldSet[id]) ?? -1);
        if (s !== null)
          drawObject(
            this.atlas,
            this,
            cam,
            s,
            v.getInt32(o + OV.x, true),
            v.getInt32(o + OV.y, true),
            v.getUint8(o + OV.variant),
            STREAM.object,
          );
        st.objects++;
        continue;
      }
      const v = c.entityView;
      const o = ri * 24;
      const proto = v.getUint16(o + EV.proto, true);
      if (kind === ITEM.inserter) this.inserter(v, o, proto, mirror);
      else this.entity(v, o, proto, mirror, dynV, tick, STREAM.object);
    }
    this.ghost = false;
    if (debug.tileGrid || debug.chunkGrid || debug.collision || debug.selection || debug.positions)
      this.debugOverlay(debug, vx0, vy0, vx1, vy1);
  }

  private push(kind: number, y: number, x: number, serial: number, a: number, b: number): void {
    if (this.n >= this.cap) this.grow(this.n + 1);
    const i = this.n++;
    this.kind[i] = kind;
    this.keyY[i] = y;
    this.keyX[i] = x;
    this.serial[i] = serial;
    this.refA[i] = a;
    this.refB[i] = b;
  }

  /** Counting sort by tile row, then insertion sort within each row by (y, x, serial): O(n) per frame (§6.6). */
  private sortItems(): void {
    const n = this.n;
    if (n === 0) return;
    let r0 = 0x7fffffff;
    let r1 = -0x80000000;
    for (let i = 0; i < n; i++) {
      const r = (this.keyY[i] as number) >> 8;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }
    const rows = r1 - r0 + 1;
    if (this.buckets.length < rows + 1) this.buckets = new Int32Array(rows * 2 + 1);
    const b = this.buckets;
    b.fill(0, 0, rows + 1);
    for (let i = 0; i < n; i++) {
      const k = ((this.keyY[i] as number) >> 8) - r0 + 1;
      b[k] = (b[k] as number) + 1;
    }
    for (let r = 1; r <= rows; r++) b[r] = (b[r] as number) + (b[r - 1] as number);
    for (let i = 0; i < n; i++) {
      const r = ((this.keyY[i] as number) >> 8) - r0;
      const at = b[r] as number;
      this.sorted[at] = i;
      b[r] = at + 1;
    }
    // b[r] is now the end of row r; insertion-sort each row
    let start = 0;
    for (let r = 0; r < rows; r++) {
      const end = b[r] as number;
      for (let i = start + 1; i < end; i++) {
        const v = this.sorted[i] as number;
        let j = i - 1;
        while (j >= start && this.before(v, this.sorted[j] as number)) {
          this.sorted[j + 1] = this.sorted[j] as number;
          j--;
        }
        this.sorted[j + 1] = v;
      }
      start = end;
    }
  }

  private before(a: number, b: number): boolean {
    const ya = this.keyY[a] as number;
    const yb = this.keyY[b] as number;
    if (ya !== yb) return ya < yb;
    const xa = this.keyX[a] as number;
    const xb = this.keyX[b] as number;
    if (xa !== xb) return xa < xb;
    return (this.serial[a] as number) < (this.serial[b] as number);
  }

  private entity(
    v: DataView,
    o: number,
    proto: number,
    mirror: Mirror,
    dynV: DataView,
    tick: number,
    stream: number,
  ): void {
    const look = this.look;
    const e = this.ev;
    const serial = v.getUint32(o + EV.serial, true);
    e.x2 = v.getInt32(o + EV.x2, true);
    e.y2 = v.getInt32(o + EV.y2, true);
    e.dir = v.getUint8(o + EV.dir);
    e.variant = v.getUint8(o + EV.variant);
    e.status = v.getUint8(o + EV.status);
    const di = mirror.dynIndex.get(serial);
    e.hasDyn = di >= 0;
    if (di >= 0) {
      const d = di * 20;
      e.state = dynV.getUint8(d + DY.state);
      e.phase = dynV.getUint16(d + DY.phase, true);
      e.light = dynV.getUint8(d + DY.light);
    } else {
      e.state = 0;
      e.phase = 0;
      e.light = 0;
    }
    e.tick = tick;
    e.beltSpeed = look.beltSpeed[proto] ?? 0;
    const flags = v.getUint8(o + EV.flags);
    this.ghost = (flags & 1) !== 0;
    const s = this.usable(look.entitySet[proto] ?? -1);
    const g = this.peek(look.greybox[proto] ?? -1);
    if (s === null && g === null && (look.greybox[proto] ?? -1) >= 0)
      this.missed[look.greybox[proto] as number] = 1;
    drawEntity(this.atlas, this, this.cam, s, g, e, this.ghost ? OVERLAY.ghost : stream);
    if (!this.ghost && s !== null && s.smoke.length > 0 && e.hasDyn && e.state === 1)
      this.smoke(s, serial, e.x2, e.y2);
    if ((flags & 2) !== 0) this.deconstructMark(e.x2, e.y2, proto, e.dir);
    this.ghost = false;
    this.stats.entities++;
  }

  private inserter(v: DataView, o: number, proto: number, mirror: Mirror): void {
    const look = this.look;
    const h = this.hi;
    const serial = v.getUint32(o + EV.serial, true);
    h.x2 = v.getInt32(o + EV.x2, true);
    h.y2 = v.getInt32(o + EV.y2, true);
    h.dir = v.getUint8(o + EV.dir);
    const s = this.usable(look.entitySet[proto] ?? -1);
    const g = this.peek(look.greybox[proto] ?? -1);
    if (s === null && g === null && (look.greybox[proto] ?? -1) >= 0)
      this.missed[look.greybox[proto] as number] = 1;
    const hi = mirror.handsIndex.get(serial);
    if (hi >= 0) {
      const hv = mirror.hands.view;
      const ho = hi * 24;
      h.theta = hv.getUint16(ho + HA.theta, true);
      h.ext = hv.getUint16(ho + HA.ext, true);
      h.held = hv.getUint16(ho + HA.held, true);
    } else {
      // at rest (not in HANDS): the hand waits open over the pickup position, behind the inserter
      h.theta = Math.round(((h.dir / 16 + 0.5) % 1) * 65536) & 0xffff;
      const arm = s?.arm;
      const P = this.atlas.pxPerTile[this.atlas.arrayOfKind[KIND.colour] as number] as number;
      h.ext = Math.max(1, Math.round((arm?.length ?? P) / P)) * 4096;
      h.held = 0xffff;
    }
    const flags = v.getUint8(o + EV.flags);
    this.ghost = (flags & 1) !== 0;
    drawInserter(this.atlas, this, this.cam, s, g, h, this.ghost ? OVERLAY.ghost : STREAM.object);
    if ((flags & 2) !== 0) this.deconstructMark(h.x2, h.y2, proto, h.dir);
    this.ghost = false;
    this.stats.entities++;
  }

  private mover(mirror: Mirror, i: number): void {
    const renderTick = this.lastTick;
    const mv = mirror.movers.view;
    const o = i * 32;
    const proto = mv.getUint16(o + MO.proto, true);
    const s = this.usable(this.look.moverSet[proto] ?? -1);
    if (s === null) return;
    const m = this.mi;
    const serial = mv.getUint32(o + MO.serial, true);
    const dt = this.extrapolate ? renderTick - mv.getUint32(o + MO.base_tick, true) : 0;
    m.vx = mv.getInt16(o + MO.vx, true);
    m.vy = mv.getInt16(o + MO.vy, true);
    m.x = mv.getInt32(o + MO.x, true) + m.vx * dt;
    m.y = mv.getInt32(o + MO.y, true) + m.vy * dt;
    m.flags = mv.getUint8(o + MO.flags);
    m.orientation = mv.getUint16(o + MO.orientation, true);
    const state = this.movers.get(serial);
    m.distance = (state?.dist ?? 0) + (Math.hypot(m.vx, m.vy) * Math.max(0, dt)) / POS_ONE;
    // idle and mine run on the clock (MOVERS.base_tick is the packet's tick, so it cannot be the clip's origin)
    m.seconds = renderTick / 60;
    drawMover(this.atlas, this, this.cam, s, m, STREAM.object);
    this.stats.movers++;
  }

  /** The distance each mover has walked, integrated packet to packet (the run clip advances with distance). */
  private trackMovers(mirror: Mirror): void {
    const mv = mirror.movers;
    for (let i = 0; i < mv.count; i++) {
      const o = i * 32;
      const serial = mv.view.getUint32(o + MO.serial, true);
      const x = mv.view.getInt32(o + MO.x, true);
      const y = mv.view.getInt32(o + MO.y, true);
      let st = this.movers.get(serial);
      if (st === undefined) {
        st = { x, y, dist: 0, packet: mirror.packets };
        this.movers.set(serial, st);
      } else if (st.packet !== mirror.packets) {
        const d = Math.hypot(x - st.x, y - st.y) / POS_ONE;
        if (d < 2) st.dist += d;
        st.x = x;
        st.y = y;
        st.packet = mirror.packets;
      }
    }
    if (this.movers.size > mv.count)
      for (const [k, st] of this.movers) if (st.packet !== mirror.packets) this.movers.delete(k);
  }

  /** Smoke (A3 §8, 10 §9.8): three inked puffs per chimney, drifting east, fading over 2 s; render-only. */
  private smoke(s: SpriteSet, serial: number, x2: number, y2: number): void {
    const fx = this.look.smokeSet >= 0 ? this.usable(this.look.smokeSet) : null;
    if (fx === null || fx.base === null) return;
    const P = this.atlas.pxPerTile[this.atlas.arrayOfKind[KIND.colour] as number] as number;
    const radius = this.smokeRadius;
    const ex = x2 / 2;
    const ey = y2 / 2;
    const a = this.args;
    const life = SMOKE.lifeTicks;
    const t = this.lastTick;
    for (let c = 0; c < s.smoke.length / 2; c++) {
      const bx = ex + (s.smoke[c * 2] as number) / P;
      const by = ey + (s.smoke[c * 2 + 1] as number) / P;
      posHashInto(serial, c, this.hash, 0);
      const seed = (this.hash[0] as number) % life;
      for (let j = 0; j < SMOKE.puffs; j++) {
        const clock = t + seed + (j * life) / SMOKE.puffs;
        const age = (clock % life) / life;
        const cycle = Math.floor(clock / life);
        posHashInto(serial * 3 + j, cycle, this.hash, 1);
        const h = this.hash[1] as number;
        this.vals[AXIS.shape] = h | 0;
        const e = lookup(fx.base, this.vals);
        if (e < 0 || fx.base.entries[e * 2 + 1] === 0) continue;
        const f = this.atlas.entryFrames[fx.base.entries[e * 2] as number] as number;
        const jitter = ((h >>> 8) % 100) / 100 - 0.5;
        const px = bx + SMOKE.driftEast * age + jitter * 0.15;
        const py = by - SMOKE.rise * age;
        const size = SMOKE.sizeFrom + (SMOKE.sizeTo - SMOKE.sizeFrom) * age;
        const alpha = SMOKE.alpha * (1 - age) * Math.min(1, age * 6);
        const o = f * 8;
        const fr = this.atlas.frames;
        const k = (this.S / P) * (size / (2 * radius));
        a[0] = (px - this.cam.cx) * this.S - (fr[o + 6] as number) * k;
        a[1] = (py - this.cam.cy) * this.S - (fr[o + 7] as number) * k;
        a[2] = (fr[o + 4] as number) * k;
        a[3] = (fr[o + 5] as number) * k;
        a[4] = alpha;
        this.quad(STREAM.high, f);
      }
    }
  }

  /** The tick the smoke runs on (set by the renderer each frame, fractional). */
  lastTick = 0;

  /** Factorio's deconstruction mark: a red cross over the entity's footprint (an overlay, never graded). */
  private deconstructMark(x2: number, y2: number, proto: number, dir: number): void {
    const ex = x2 / 2;
    const ey = y2 / 2;
    const turned = dir === 4 || dir === 12;
    const w =
      Math.max(0.6, (turned ? this.look.size[proto * 2 + 1] : this.look.size[proto * 2]) as number) * 0.5;
    const h =
      Math.max(0.6, (turned ? this.look.size[proto * 2] : this.look.size[proto * 2 + 1]) as number) * 0.5;
    const L = this.ln;
    L[4] = Math.max(2, this.S / 12);
    L[0] = ex - w * 0.6;
    L[1] = ey - h * 0.6;
    L[2] = ex + w * 0.6;
    L[3] = ey + h * 0.6;
    this.line(DECON_TINT);
    L[0] = ex + w * 0.6;
    L[1] = ey - h * 0.6;
    L[2] = ex - w * 0.6;
    L[3] = ey + h * 0.6;
    this.line(DECON_TINT);
  }

  /** A solid line between two world points, ln [x0, y0, x1, y1] tiles, ln[4] device px wide. */
  private line(tint: number): void {
    const L = this.ln;
    const S = this.S;
    const ax = ((L[0] as number) - this.cam.cx) * S;
    const ay = ((L[1] as number) - this.cam.cy) * S;
    const bx = ((L[2] as number) - this.cam.cx) * S;
    const by = ((L[3] as number) - this.cam.cy) * S;
    const lw = L[4] as number;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * lw * 0.5;
    const ny = (dx / len) * lw * 0.5;
    const q = QUAD;
    q[0] = ax + nx;
    q[1] = ay + ny;
    q[2] = bx + nx;
    q[3] = by + ny;
    q[4] = ax - nx;
    q[5] = ay - ny;
    q[6] = bx - nx;
    q[7] = by - ny;
    q[8] = tint;
    (this.streams[OVERLAY.solid] as Stream).quad(0, 0, 0, 0, 0);
  }

  /** line() from arguments (only the debug overlays use it). */
  private lineAt(x0: number, y0: number, x1: number, y1: number, lw: number, tint: number): void {
    const L = this.ln;
    L[0] = x0;
    L[1] = y0;
    L[2] = x1;
    L[3] = y1;
    L[4] = lw;
    this.line(tint);
  }

  private rectOutline(x0: number, y0: number, x1: number, y1: number, lw: number, tint: number): void {
    this.lineAt(x0, y0, x1, y0, lw, tint);
    this.lineAt(x1, y0, x1, y1, lw, tint);
    this.lineAt(x1, y1, x0, y1, lw, tint);
    this.lineAt(x0, y1, x0, y0, lw, tint);
  }

  /** F4's overlays (I §4.21): tile and chunk grids, collision and selection rectangles, entity positions. */
  private debugOverlay(d: DebugFlags, vx0: number, vy0: number, vx1: number, vy1: number): void {
    const S = this.S;
    const px = 1 / S;
    const col = (c: readonly number[]) =>
      rgba8(
        (c[0] as number) * (c[3] as number),
        (c[1] as number) * (c[3] as number),
        (c[2] as number) * (c[3] as number),
        c[3] as number,
      );
    if (d.tileGrid && S >= 8) {
      const t = col(DEBUG_COLOURS.tileGrid);
      for (let x = Math.ceil(vx0); x <= vx1; x++) this.lineAt(x, vy0, x, vy1, 1, t);
      for (let y = Math.ceil(vy0); y <= vy1; y++) this.lineAt(vx0, y, vx1, y, 1, t);
    }
    if (d.chunkGrid) {
      const t = col(DEBUG_COLOURS.chunkGrid);
      for (let x = Math.ceil(vx0 / 32) * 32; x <= vx1; x += 32) this.lineAt(x, vy0, x, vy1, 2, t);
      for (let y = Math.ceil(vy0 / 32) * 32; y <= vy1; y += 32) this.lineAt(vx0, y, vx1, y, 2, t);
    }
    if (!(d.collision || d.selection || d.positions)) return;
    const cc = col(DEBUG_COLOURS.collision);
    const sc = col(DEBUG_COLOURS.selection);
    const pc = col(DEBUG_COLOURS.position);
    for (let ci = 0; ci < this.nChunks; ci++) {
      const c = this.chunkRefs[ci] as ChunkView;
      const v = c.entityView;
      for (let i = 0; i < c.entityCount; i++) {
        const o = i * 24;
        const proto = v.getUint16(o + EV.proto, true);
        const ex = v.getInt32(o + EV.x2, true) / 2;
        const ey = v.getInt32(o + EV.y2, true) / 2;
        const dir = v.getUint8(o + EV.dir);
        if (d.collision) this.box(this.look.collision, proto, dir, ex, ey, cc);
        if (d.selection) this.box(this.look.selection, proto, dir, ex, ey, sc);
        if (d.positions) this.lineAt(ex - 2 * px, ey, ex + 2 * px, ey, 4, pc);
      }
    }
  }

  /** A prototype's box (collision or selection, facing north) turned to `dir` and outlined at (ex, ey). */
  private box(b: Float64Array, proto: number, dir: number, ex: number, ey: number, tint: number): void {
    const x0 = b[proto * 4] as number;
    const y0 = b[proto * 4 + 1] as number;
    const x1 = b[proto * 4 + 2] as number;
    const y1 = b[proto * 4 + 3] as number;
    if (dir === 4 || dir === 12) this.rectOutline(ex - y1, ey + x0, ex - y0, ey + x1, 1, tint);
    else if (dir === 8) this.rectOutline(ex - x1, ey - y1, ex - x0, ey - y0, 1, tint);
    else this.rectOutline(ex + x0, ey + y0, ex + x1, ey + y1, 1, tint);
  }
}
