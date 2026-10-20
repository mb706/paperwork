// The drawing programs of 10 §15.7 (a set's `kind`): entity, inserter, object, resource, mover and icon. Each turns
// one packet-shaped input into draws on a SpriteSink, so the same code feeds the WebGL batcher and the tests that run
// test/fixtures/sprites/cases.json (whose expectations come from scripts/assets/manifest.py, the Python twin).
// Nothing here allocates: inputs are reused scratch objects, lookups write into typed arrays.
//
// Readings that 10 §15.7 leaves open are the ones manifest.py's docstring fixes (C6, pm/reports/C6.md), notably:
// an impossible combination of the picture drawn first draws `greybox/<prototype>` (base and shadow, marked as a
// fallback); a part P's shadow is `P_shadow` except base's, `shadow`; a frame axis follows the set's clock wherever it
// is; inserter shadows turn about Q′ = anchor + shadowShoulder · k′; orientation rounds half up.

import { type Atlas, AXIS, axisValues, KIND, lookup, type Part, type SpriteSet } from './manifest.ts';
import { type Camera, POS_ONE, posHash, scaleOf } from './projection.ts';
import { BELT_ITEM_SIZE } from './style.ts';

/** Where a draw goes: the layer of 10 §6.2 and, through its frames, the texture array. */
export const STREAM = {
  /** Ground layer, colour array: decoratives, resources, floor entities (belts). */
  ground: 0,
  /** Ground layer, icon array: ground items and belt items. */
  groundIcon: 1,
  /** The shadow pass (MAX into the half-resolution target). */
  shadow: 2,
  /** Objects, y-sorted: buildings, trees, poles, chests, inserter platforms, characters. */
  object: 3,
  /** Higher objects: inserter arms and hands. */
  high: 4,
  /** Held items (icons over the hands). */
  highIcon: 5,
  /** The light pass (additive into the light target). */
  light: 6,
} as const;
export const STREAM_COUNT = 7;

/** Part codes for the tests' recorder (the GL sink ignores them). */
export const PART = {
  base: 0,
  idle: 1,
  layer: 2,
  light: 3,
  shadow: 4,
  platform: 5,
  platformShadow: 6,
  arm: 7,
  armShadow: 8,
  handOpen: 9,
  handOpenShadow: 10,
  handClosed: 11,
  handClosedShadow: 12,
  clip: 13,
  clipShadow: 14,
  icon: 15,
  held: 16,
} as const;

export interface SpriteSink {
  /** Frame f axis-aligned at [left, top, w, h] device px from the canvas centre; alpha scales it (lights). */
  quad(stream: number, f: number, left: number, top: number, w: number, h: number, alpha: number): void;
  /**
   * Frame f rotated by `turns` (clockwise) about its pivot (frame px) placed at (atX, atY) device px, k device px
   * per frame px, stretched by `stretch` along the frame's vertical (the arm's length).
   */
  rotated(
    stream: number,
    f: number,
    pivotX: number,
    pivotY: number,
    atX: number,
    atY: number,
    turns: number,
    k: number,
    stretch: number,
  ): void;
  /** The draws that follow belong to part `code` (index: a layer's or a clip's), of set `set`. */
  part(code: number, index: number, set: SpriteSet | null): void;
  /** The draws that follow are the greybox `set` drawn for an impossible combination or a missing set. */
  fallback(set: SpriteSet): void;
  /** An item held by an inserter's hand, at (atX, atY) device px. */
  held(item: number, atX: number, atY: number, sizeTiles: number): void;
}

/** One entity, as the mirror and DYN give it (a reused scratch object). */
export interface EntityInput {
  x2: number;
  y2: number;
  dir: number;
  /** EntityView.variant: the connection mask. */
  variant: number;
  status: number;
  /** A DYN record exists. */
  hasDyn: boolean;
  state: number;
  phase: number;
  light: number;
  /** The tick, for belts (10 §6.8). */
  tick: number;
  /** Positions per tick, for belts (prototypes.bin's belt_speed). */
  beltSpeed: number;
}
export function entityInput(): EntityInput {
  return {
    x2: 0,
    y2: 0,
    dir: 0,
    variant: 0,
    status: 0,
    hasDyn: false,
    state: 0,
    phase: 0,
    light: 0,
    tick: 0,
    beltSpeed: 0,
  };
}

/** One inserter: HANDS, or the rest pose the renderer gives one that is not in HANDS. */
export interface InserterInput {
  x2: number;
  y2: number;
  dir: number;
  /** Turns × 65,536 from north, clockwise. */
  theta: number;
  /** Tiles × 4,096. */
  ext: number;
  /** ItemKey, 0xFFFF none. */
  held: number;
}
export function inserterInput(): InserterInput {
  return { x2: 0, y2: 0, dir: 0, theta: 0, ext: 4096, held: 0xffff };
}

/** One mover (MOVERS), extrapolated: position in 1/256 tile, the clip clock's inputs. */
export interface MoverInput {
  x: number;
  y: number;
  vx: number;
  vy: number;
  flags: number;
  orientation: number;
  /** Tiles integrated along the extrapolated path (the run clip). */
  distance: number;
  /** Seconds of the idle and mine clips' clock. */
  seconds: number;
}
export function moverInput(): MoverInput {
  return { x: 0, y: 0, vx: 0, vy: 0, flags: 0, orientation: 0, distance: 0, seconds: 0 };
}

const vals = axisValues();

/** Emits every frame of `p`'s entry `e` as axis-aligned quads at (ex, ey) tiles. */
function emitEntry(
  atlas: Atlas,
  sink: SpriteSink,
  cam: Camera,
  stream: number,
  p: Part,
  e: number,
  ex: number,
  ey: number,
  alpha: number,
): void {
  const start = p.entries[e * 2] as number;
  const count = p.entries[e * 2 + 1] as number;
  const S = scaleOf(cam);
  const fr = atlas.frames;
  for (let i = 0; i < count; i++) {
    const f = atlas.entryFrames[start + i] as number;
    const o = f * 8;
    const k = S / (atlas.pxPerTile[fr[o] as number] as number);
    sink.quad(
      stream,
      f,
      (ex - cam.cx) * S - (fr[o + 6] as number) * k,
      (ey - cam.cy) * S - (fr[o + 7] as number) * k,
      (fr[o + 4] as number) * k,
      (fr[o + 5] as number) * k,
      alpha,
    );
  }
}

const entryEmpty = (p: Part, e: number) => e < 0 || p.entries[e * 2 + 1] === 0;

/** The greybox drawn instead (manifest.py `draw_greybox`): base and shadow at dir, mask, frame 0, light 0. */
export function drawGreybox(
  atlas: Atlas,
  sink: SpriteSink,
  cam: Camera,
  g: SpriteSet,
  x2: number,
  y2: number,
  dir: number,
  variant: number,
  colourStream: number,
): boolean {
  vals[AXIS.dir] = dir;
  vals[AXIS.mask] = variant;
  vals[AXIS.frame] = 0;
  vals[AXIS.light] = 0;
  const ex = x2 / 2;
  const ey = y2 / 2;
  sink.fallback(g);
  if (g.base === null) return false;
  const eb = lookup(g.base, vals, 0);
  if (entryEmpty(g.base, eb)) return false;
  sink.part(PART.base, 0, g);
  emitEntry(atlas, sink, cam, colourStream, g.base, eb, ex, ey, 1);
  if (g.shadow !== null) {
    const es = lookup(g.shadow, vals, 0);
    sink.part(PART.shadow, 0, g);
    if (es >= 0) emitEntry(atlas, sink, cam, STREAM.shadow, g.shadow, es, ex, ey, 1);
  }
  return true;
}

/**
 * The `entity` program. While DYN.state is 1 draw `base` and every layer at its frame; otherwise `idle` if the set has
 * one, else the same at the frozen phase; without DYN, base and layers at frame 0. Then `light` (scaled by
 * DYN.light) and `shadow`. An empty first entry or a missing set draws `greybox`. Returns false when nothing could be
 * drawn (no set and no greybox).
 */
export function drawEntity(
  atlas: Atlas,
  sink: SpriteSink,
  cam: Camera,
  s: SpriteSet | null,
  greybox: SpriteSet | null,
  e: EntityInput,
  colourStream: number,
): boolean {
  if (s === null)
    return (
      greybox !== null && drawGreybox(atlas, sink, cam, greybox, e.x2, e.y2, e.dir, e.variant, colourStream)
    );
  const ex = e.x2 / 2;
  const ey = e.y2 / 2;
  let fidx = -1;
  if (s.framesPerTile > 0)
    // belts (10 §6.8): frame = (tick × speed × framesPerTile ÷ 256) mod frames
    fidx = Math.floor((e.tick * e.beltSpeed * s.framesPerTile) / 256);
  const lit = s.lightFromStatus ? e.status : e.hasDyn && e.light > 0 ? 1 : 0;
  vals[AXIS.dir] = e.dir;
  vals[AXIS.mask] = e.variant;
  vals[AXIS.frame] = e.hasDyn ? e.phase : 0;
  vals[AXIS.light] = lit;
  const working = e.hasDyn && e.state === 1;
  const useIdle = !working && s.idle !== null && e.hasDyn;
  const first = useIdle ? s.idle : s.base;
  const ef = first === null ? -1 : lookup(first, vals, useIdle ? -1 : fidx);
  if (first === null || entryEmpty(first, ef)) {
    if (s.name.startsWith('greybox/') || greybox === null) return false;
    return drawGreybox(atlas, sink, cam, greybox, e.x2, e.y2, e.dir, e.variant, colourStream);
  }
  sink.part(useIdle ? PART.idle : PART.base, 0, s);
  emitEntry(atlas, sink, cam, colourStream, first, ef, ex, ey, 1);
  if (!useIdle)
    for (let i = 0; i < s.layers.length; i++) {
      const L = s.layers[i] as Part;
      const el = lookup(L, vals, fidx);
      sink.part(PART.layer, i, s);
      if (el >= 0) emitEntry(atlas, sink, cam, colourStream, L, el, ex, ey, 1);
    }
  if (s.light !== null) {
    const el = lookup(s.light, vals, fidx);
    sink.part(PART.light, 0, s);
    if (el >= 0) emitEntry(atlas, sink, cam, STREAM.light, s.light, el, ex, ey, e.hasDyn ? e.light / 255 : 0);
  }
  if (s.shadow !== null) {
    const es = lookup(s.shadow, vals, fidx);
    sink.part(PART.shadow, 0, s);
    if (es >= 0) emitEntry(atlas, sink, cam, STREAM.shadow, s.shadow, es, ex, ey, 1);
  }
  return true;
}

/** The first frame of a part's only entry (inserter arms and hands have no axes). */
function onlyFrame(atlas: Atlas, p: Part): number {
  return (p.entries[1] as number) > 0 ? (atlas.entryFrames[p.entries[0] as number] as number) : -1;
}

/**
 * The `inserter` program: `platform` [dir] and its shadow placed like any frame; the arm rotated by θ about its pivot
 * placed at the shoulder Q = anchor + shoulder · k and stretched to |Hp − Q|; the hand (closed while holding) rotated
 * about its pivot at Hp = Q + r · S · (sin 2πθ, −cos 2πθ), the held item's icon at Hp; their shadows likewise about
 * Q′ = anchor + shadowShoulder · k′ (manifest.py). An impossible direction draws the greybox, without an arm.
 */
export function drawInserter(
  atlas: Atlas,
  sink: SpriteSink,
  cam: Camera,
  s: SpriteSet | null,
  greybox: SpriteSet | null,
  h: InserterInput,
  platformStream: number,
): boolean {
  const gb = () =>
    greybox !== null && drawGreybox(atlas, sink, cam, greybox, h.x2, h.y2, h.dir, 0, platformStream);
  if (s === null || s.platform === null) return gb();
  vals[AXIS.dir] = h.dir;
  const ep = lookup(s.platform, vals);
  if (entryEmpty(s.platform, ep)) return gb();
  const S = scaleOf(cam);
  const ex = h.x2 / 2;
  const ey = h.y2 / 2;
  sink.part(PART.platform, 0, s);
  emitEntry(atlas, sink, cam, platformStream, s.platform, ep, ex, ey, 1);
  if (s.platformShadow !== null) {
    const es = lookup(s.platformShadow, vals);
    sink.part(PART.platformShadow, 0, s);
    if (es >= 0) emitEntry(atlas, sink, cam, STREAM.shadow, s.platformShadow, es, ex, ey, 1);
  }
  const arm = s.arm;
  if (arm === null) return true;
  const th = h.theta / 65536;
  const r = h.ext / 4096;
  const ang = 2 * Math.PI * th;
  const sin = Math.sin(ang);
  const cos = Math.cos(ang);
  const ax0 = (ex - cam.cx) * S;
  const ay0 = (ey - cam.cy) * S;
  const kc = S / (atlas.pxPerTile[atlas.arrayOfKind[KIND.colour] as number] as number);
  const ks = S / (atlas.pxPerTile[atlas.arrayOfKind[KIND.shadow] as number] as number);
  const holding = h.held !== 0xffff;
  // The arm's stretch is the same in both passes: |Hp − Q| ÷ (length · k), with |Hp − Q| = r · S.
  const stretch = (r * S) / (arm.length * kc);
  for (let pass = 0; pass < 2; pass++) {
    const shadow = pass === 1;
    const k = shadow ? ks : kc;
    const qx = ax0 + (shadow ? s.shadowShoulderX : s.shoulderX) * k;
    const qy = ay0 + (shadow ? s.shadowShoulderY : s.shoulderY) * k;
    const hx = qx + r * S * sin;
    const hy = qy - r * S * cos;
    const armP = shadow ? s.armShadow : arm;
    const stream = shadow ? STREAM.shadow : STREAM.high;
    if (armP !== null) {
      const f = onlyFrame(atlas, armP);
      sink.part(shadow ? PART.armShadow : PART.arm, 0, s);
      if (f >= 0) sink.rotated(stream, f, armP.pivotX, armP.pivotY, qx, qy, th, k, stretch);
    }
    const handP = shadow
      ? holding
        ? s.handClosedShadow
        : s.handOpenShadow
      : holding
        ? s.handClosed
        : s.handOpen;
    if (handP !== null) {
      const f = onlyFrame(atlas, handP);
      const code = shadow
        ? holding
          ? PART.handClosedShadow
          : PART.handOpenShadow
        : holding
          ? PART.handClosed
          : PART.handOpen;
      sink.part(code, 0, s);
      if (f >= 0) sink.rotated(stream, f, handP.pivotX, handP.pivotY, hx, hy, th, k, 1);
    }
    if (!shadow && holding) {
      sink.part(PART.held, 0, s);
      sink.held(h.held, hx, hy, BELT_ITEM_SIZE);
    }
  }
  return true;
}

/** The `object` program: trees [shape, stage], other objects [shape], shadows [shape]; shape from posHash(x, y). */
export function drawObject(
  atlas: Atlas,
  sink: SpriteSink,
  cam: Camera,
  s: SpriteSet,
  x: number,
  y: number,
  variant: number,
  colourStream: number,
): boolean {
  if (s.base === null) return false;
  vals[AXIS.shape] = posHash(x, y) | 0;
  vals[AXIS.stage] = variant;
  const eb = lookup(s.base, vals);
  if (entryEmpty(s.base, eb)) return false;
  const ex = x / POS_ONE;
  const ey = y / POS_ONE;
  sink.part(PART.base, 0, s);
  emitEntry(atlas, sink, cam, colourStream, s.base, eb, ex, ey, 1);
  if (s.shadow !== null) {
    const es = lookup(s.shadow, vals);
    sink.part(PART.shadow, 0, s);
    if (es >= 0) emitEntry(atlas, sink, cam, STREAM.shadow, s.shadow, es, ex, ey, 1);
  }
  return true;
}

/** The `resource` program: [shape, band], anchored at the tile's centre; shape from posHash(tx, ty). */
export function drawResource(
  atlas: Atlas,
  sink: SpriteSink,
  cam: Camera,
  s: SpriteSet,
  tx: number,
  ty: number,
  band: number,
): boolean {
  if (s.base === null) return false;
  vals[AXIS.shape] = posHash(tx, ty) | 0;
  vals[AXIS.band] = band;
  const eb = lookup(s.base, vals);
  if (entryEmpty(s.base, eb)) return false;
  sink.part(PART.base, 0, s);
  emitEntry(atlas, sink, cam, STREAM.ground, s.base, eb, tx + 0.5, ty + 0.5, 1);
  if (s.shadow !== null) {
    const es = lookup(s.shadow, vals);
    sink.part(PART.shadow, 0, s);
    if (es >= 0) emitEntry(atlas, sink, cam, STREAM.shadow, s.shadow, es, tx + 0.5, ty + 0.5, 1);
  }
  return true;
}

/** The clip a mover draws (10 §15.7): `mine` while mining, `run` while moving, else `idle`. */
export function moverClip(m: MoverInput): number {
  if ((m.flags & 1) !== 0) return 2;
  if (m.vx !== 0 || m.vy !== 0) return 1;
  return 0;
}

/**
 * The `mover` program. The character's clips: `run` advances with distance (floor(d ÷ cycleTiles × n) mod n),
 * `idle` and `mine` with time at the part's fps; other movers draw `base` [orientation] and `shadow`.
 */
export function drawMover(
  atlas: Atlas,
  sink: SpriteSink,
  cam: Camera,
  s: SpriteSet,
  m: MoverInput,
  colourStream: number,
): boolean {
  const ex = m.x / POS_ONE;
  const ey = m.y / POS_ONE;
  vals[AXIS.orientation] = m.orientation;
  if (s.clipIdle !== null) {
    const clip = moverClip(m);
    const p = clip === 2 ? s.clipMine : clip === 1 ? s.clipRun : s.clipIdle;
    const ps = clip === 2 ? s.clipMineShadow : clip === 1 ? s.clipRunShadow : s.clipIdleShadow;
    if (p === null) return false;
    const n = p.frameCount > 0 ? p.frameCount : 1;
    const f =
      clip === 1 ? Math.floor((m.distance / p.cycleTiles) * n) % n : Math.floor(m.seconds * p.fps) % n;
    const ef = lookup(p, vals, f < 0 ? f + n : f);
    if (entryEmpty(p, ef)) return false;
    sink.part(PART.clip, clip, s);
    emitEntry(atlas, sink, cam, colourStream, p, ef, ex, ey, 1);
    if (ps !== null) {
      const es = lookup(ps, vals, f < 0 ? f + n : f);
      sink.part(PART.clipShadow, clip, s);
      if (es >= 0) emitEntry(atlas, sink, cam, STREAM.shadow, ps, es, ex, ey, 1);
    }
    return true;
  }
  if (s.base === null) return false;
  const eb = lookup(s.base, vals);
  if (entryEmpty(s.base, eb)) return false;
  sink.part(PART.base, 0, s);
  emitEntry(atlas, sink, cam, colourStream, s.base, eb, ex, ey, 1);
  if (s.shadow !== null) {
    const es = lookup(s.shadow, vals);
    sink.part(PART.shadow, 0, s);
    if (es >= 0) emitEntry(atlas, sink, cam, STREAM.shadow, s.shadow, es, ex, ey, 1);
  }
  return true;
}

/**
 * The `icon` program: frame id of a set's icon (the icon array's 64 px per icon: P is per icon, not per tile), drawn
 * centred-by-anchor at (x, y) tiles at `sizeTiles` (10 §15.7 "Icons").
 */
export function drawIcon(
  atlas: Atlas,
  sink: SpriteSink,
  cam: Camera,
  f: number,
  x: number,
  y: number,
  sizeTiles: number,
  stream: number,
): void {
  if (f < 0) return;
  const o = f * 8;
  const fr = atlas.frames;
  const S = scaleOf(cam);
  const k = (S * sizeTiles) / (atlas.pxPerTile[fr[o] as number] as number);
  sink.part(PART.icon, 0, null);
  sink.quad(
    stream,
    f,
    (x - cam.cx) * S - (fr[o + 6] as number) * k,
    (y - cam.cy) * S - (fr[o + 7] as number) * k,
    (fr[o + 4] as number) * k,
    (fr[o + 5] as number) * k,
    1,
  );
}

/** An icon set's frame (its only entry's first frame), or −1. */
export function iconFrame(atlas: Atlas, s: SpriteSet | null): number {
  if (s === null || s.icon === null) return -1;
  return onlyFrame(atlas, s.icon);
}
