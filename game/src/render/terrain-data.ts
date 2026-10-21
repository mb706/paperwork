// The terrain shader's per-chunk inputs (10 §6.5, §9.9), built on the main thread when a chunk enters the held set
// or its tiles (or a neighbour's) change:
//   * the tile ids with a 3-tile border from the neighbouring held chunks (38 × 38 R8UI). §6.5 says a one-tile
//     border; the 0.32-tile warp plus the 0.55-tile blend reads up to three tiles out, so a one-tile border would
//     seam at chunk edges (a deviation, recorded in pm/reports/C4.md);
//   * the shore texture (RG8, 4 texels per tile, 3-tile border = 152²): red is the signed distance to the shore in
//     tiles (negative in water; 128 + 32 d), green the woodland tint. The shore is the 0.5 level of the same blended
//     water mask the shader's material choice uses, located to a fraction of a texel and propagated by nearest-seed
//     transforms (a two-pass chamfer that carries the nearest boundary point, so distances are Euclidean). Chunks
//     with neither water nor trees within reach skip it.
// The tile-id texture's high bit marks a resource tile (`markDeposits`): the shader draws the deposit's ground under a
// patch (TERRAIN.depositTile, A3's mocks; C9). Tile ids are dense and fewer than 128, so the bit is free.

import { CHUNK_TILES } from './projection.ts';
import { TERRAIN } from './style.ts';

export const ID_BORDER = 3;
export const ID_SIZE = CHUNK_TILES + 2 * ID_BORDER;
export const SHORE_TEXELS = 4;
export const SHORE_BORDER = 3;
export const SHORE_SIZE = (CHUNK_TILES + 2 * SHORE_BORDER) * SHORE_TEXELS;
/** 0.55-tile Gaussian over the tile lattice, normalised (the shader's G0, G1). */
const G0 = 0.72329;
const G1 = 0.13835;

/** A chunk's tiles by chunk coordinates (null: not held or not received). */
export type TileSource = (cx: number, cy: number) => Uint8Array | null;

/**
 * Fills `out` (38 × 38) with chunk (cx, cy)'s tile ids and a 3-tile border from its neighbours; a missing neighbour
 * repeats the chunk's own edge. Returns whether every neighbour the border reads was present.
 */
export function buildIds(src: TileSource, cx: number, cy: number, out: Uint8Array): boolean {
  const own = src(cx, cy);
  if (own === null) return false;
  let complete = true;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (src(cx + dx, cy + dy) === null) complete = false;
    }
  for (let y = 0; y < ID_SIZE; y++) {
    const ty = y - ID_BORDER;
    for (let x = 0; x < ID_SIZE; x++) {
      const tx = x - ID_BORDER;
      const ncx = tx < 0 ? -1 : tx >= CHUNK_TILES ? 1 : 0;
      const ncy = ty < 0 ? -1 : ty >= CHUNK_TILES ? 1 : 0;
      let t = (ncx === 0 && ncy === 0 ? own : src(cx + ncx, cy + ncy)) ?? null;
      let lx = tx - ncx * CHUNK_TILES;
      let ly = ty - ncy * CHUNK_TILES;
      if (t === null) {
        t = own;
        lx = tx < 0 ? 0 : tx >= CHUNK_TILES ? CHUNK_TILES - 1 : tx;
        ly = ty < 0 ? 0 : ty >= CHUNK_TILES ? CHUNK_TILES - 1 : ty;
      }
      out[y * ID_SIZE + x] = t[ly * CHUNK_TILES + lx] as number;
    }
  }
  return complete;
}

/** The bit of a tile-id texel that marks a resource tile (the deposit's ground, `markDeposits`). */
export const DEPOSIT_BIT = 0x80;

/** A chunk's resource tiles: `count` records of `size` bytes, each with its tile index (u16, y · 32 + x) at `tileAt`. */
export interface ResourceTiles {
  readonly resourceView: DataView;
  readonly resourceCount: number;
}
/** A held chunk's resources by chunk coordinates (null: not held). */
export type ResourceSource = (cx: number, cy: number) => ResourceTiles | null;

/**
 * Sets DEPOSIT_BIT on every texel of `ids` (38 × 38, from `buildIds`) whose tile holds a resource, the chunk's own
 * and its neighbours' within the border. `size` and `tileAt` are the resource record's size and its tile field's
 * offset (§15.4 CHUNK_RESOURCES).
 */
export function markDeposits(
  src: ResourceSource,
  cx: number,
  cy: number,
  ids: Uint8Array,
  size: number,
  tileAt: number,
): void {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const c = src(cx + dx, cy + dy);
      if (c === null || c.resourceCount === 0) continue;
      const v = c.resourceView;
      for (let i = 0; i < c.resourceCount; i++) {
        const tile = v.getUint16(i * size + tileAt, true);
        const x = dx * CHUNK_TILES + (tile & 31) + ID_BORDER;
        const y = dy * CHUNK_TILES + (tile >> 5) + ID_BORDER;
        if (x < 0 || y < 0 || x >= ID_SIZE || y >= ID_SIZE) continue;
        ids[y * ID_SIZE + x] = (ids[y * ID_SIZE + x] as number) | DEPOSIT_BIT;
      }
    }
}

/** Scratch for `buildShore` (one per renderer; nothing allocates per chunk). */
export class ShoreScratch {
  /** The water mask blurred over the tile lattice (38²). */
  readonly blur = new Float32Array(ID_SIZE * ID_SIZE);
  readonly mask = new Float32Array(SHORE_SIZE * SHORE_SIZE);
  readonly sx = new Float32Array(SHORE_SIZE * SHORE_SIZE);
  readonly sy = new Float32Array(SHORE_SIZE * SHORE_SIZE);
  readonly d2 = new Float32Array(SHORE_SIZE * SHORE_SIZE);
  readonly wood = new Float32Array(SHORE_SIZE * SHORE_SIZE);
}

/** Whether the chunk needs a shore texture: water in its 38² grid, or trees near it. */
export function needsShore(ids: Uint8Array, isWater: Uint8Array, trees: number): boolean {
  if (trees > 0) return true;
  for (let i = 0; i < ids.length; i++) if (isWater[ids[i] as number] === 1) return true;
  return false;
}

/**
 * Builds the 152² RG8 shore texture into `out` (2 bytes per texel) from the 38² ids. `isWater[id]` is 1 for water
 * types; `trees` holds tree positions in tiles relative to the chunk's origin (x, y pairs, `treeCount` of them).
 * About 1–2 ms here: the water mask is blurred once per tile (the 0.55-tile Gaussian over the lattice) and read
 * bilinearly per texel, which is the shader's blend; the distance carries the nearest boundary point.
 */
export function buildShore(
  ids: Uint8Array,
  isWater: Uint8Array,
  trees: Float64Array,
  treeCount: number,
  s: ShoreScratch,
  out: Uint8Array,
): void {
  const N = SHORE_SIZE;
  const M = ID_SIZE;
  // the blurred water mask at tile centres (edges clamped)
  const blur = s.blur;
  for (let y = 0; y < M; y++)
    for (let x = 0; x < M; x++) {
      let m = 0;
      for (let b = -1; b <= 1; b++) {
        const yy = y + b < 0 ? 0 : y + b >= M ? M - 1 : y + b;
        const wy = b === 0 ? G0 : G1;
        for (let a = -1; a <= 1; a++) {
          const xx = x + a < 0 ? 0 : x + a >= M ? M - 1 : x + a;
          if (isWater[ids[yy * M + xx] as number] === 1) m += (a === 0 ? G0 : G1) * wy;
        }
      }
      blur[y * M + x] = m;
    }
  // per texel: bilinear between tile centres (tile coordinates −3 + (i + 0.5) / 4, centres at t + 0.5)
  let anyWater = false;
  let anyLand = false;
  const mask = s.mask;
  for (let j = 0; j < N; j++) {
    const qy = (j + 0.5) / SHORE_TEXELS - SHORE_BORDER - 0.5 + ID_BORDER;
    const j0 = Math.floor(qy);
    const fy = qy - j0;
    const r0 = (j0 < 0 ? 0 : j0 >= M ? M - 1 : j0) * M;
    const r1 = (j0 + 1 < 0 ? 0 : j0 + 1 >= M ? M - 1 : j0 + 1) * M;
    for (let i = 0; i < N; i++) {
      const qx = (i + 0.5) / SHORE_TEXELS - SHORE_BORDER - 0.5 + ID_BORDER;
      const i0 = Math.floor(qx);
      const fx = qx - i0;
      const c0 = i0 < 0 ? 0 : i0 >= M ? M - 1 : i0;
      const c1 = i0 + 1 < 0 ? 0 : i0 + 1 >= M ? M - 1 : i0 + 1;
      const top = (blur[r0 + c0] as number) * (1 - fx) + (blur[r0 + c1] as number) * fx;
      const bot = (blur[r1 + c0] as number) * (1 - fx) + (blur[r1 + c1] as number) * fx;
      const m = top * (1 - fy) + bot * fy;
      mask[j * N + i] = m;
      if (m > 0.5) anyWater = true;
      else anyLand = true;
    }
  }
  const both = anyWater && anyLand;
  const INF = 1e9;
  const d2 = s.d2;
  const sx = s.sx;
  const sy = s.sy;
  d2.fill(INF);
  if (both) {
    // seeds: every texel beside the 0.5 crossing gets its foot point on the boundary, projected along the mask's
    // gradient (distance |m − 0.5| ÷ |∇m|), so the shore is smooth between texels rather than scalloped by points
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const m = mask[k] as number;
        const w = m > 0.5;
        const l = i > 0 ? (mask[k - 1] as number) : m;
        const r = i + 1 < N ? (mask[k + 1] as number) : m;
        const u = j > 0 ? (mask[k - N] as number) : m;
        const d = j + 1 < N ? (mask[k + N] as number) : m;
        if (l > 0.5 === w && r > 0.5 === w && u > 0.5 === w && d > 0.5 === w) continue;
        const gx = (r - l) / (i > 0 && i + 1 < N ? 2 : 1);
        const gy = (d - u) / (j > 0 && j + 1 < N ? 2 : 1);
        const g = Math.hypot(gx, gy);
        if (g < 1e-6) continue;
        const t = (m - 0.5) / g;
        const fx = i - (t * gx) / g;
        const fy = j - (t * gy) / g;
        const dd = t * t;
        if (dd < (d2[k] as number)) {
          d2[k] = dd;
          sx[k] = fx;
          sy[k] = fy;
        }
      }
    // two raster passes carrying the nearest seed point from the eight neighbours
    for (let pass = 0; pass < 2; pass++) {
      const fwd = pass === 0;
      for (let jj = 0; jj < N; jj++) {
        const j = fwd ? jj : N - 1 - jj;
        for (let ii = 0; ii < N; ii++) {
          const i = fwd ? ii : N - 1 - ii;
          const k = j * N + i;
          let best = d2[k] as number;
          let bx = sx[k] as number;
          let by = sy[k] as number;
          for (let n = 0; n < 4; n++) {
            // forward: west, north-west, north, north-east; backward: their mirror images
            const di = n === 0 ? -1 : n === 1 ? -1 : n === 2 ? 0 : 1;
            const dj = n === 0 ? 0 : -1;
            const ni = fwd ? i + di : i - di;
            const nj = fwd ? j + dj : j - dj;
            if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
            const nk = nj * N + ni;
            if ((d2[nk] as number) >= INF) continue;
            const px = sx[nk] as number;
            const py = sy[nk] as number;
            const d = (px - i) * (px - i) + (py - j) * (py - j);
            if (d < best) {
              best = d;
              bx = px;
              by = py;
            }
          }
          d2[k] = best;
          sx[k] = bx;
          sy[k] = by;
        }
      }
    }
  }
  // woodland: discs of radius 1.6 tiles, softened by the 0.6-tile blur
  s.wood.fill(0);
  const r = TERRAIN.woodlandRadiusTiles;
  const soft = TERRAIN.woodlandBlurTiles * 1.5;
  for (let t = 0; t < treeCount; t++) {
    const tx = trees[t * 2] as number;
    const ty = trees[t * 2 + 1] as number;
    const reach = r + soft;
    const i0 = Math.max(0, Math.floor((tx - reach + SHORE_BORDER) * SHORE_TEXELS));
    const i1 = Math.min(N - 1, Math.ceil((tx + reach + SHORE_BORDER) * SHORE_TEXELS));
    const j0 = Math.max(0, Math.floor((ty - reach + SHORE_BORDER) * SHORE_TEXELS));
    const j1 = Math.min(N - 1, Math.ceil((ty + reach + SHORE_BORDER) * SHORE_TEXELS));
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) / SHORE_TEXELS - SHORE_BORDER;
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) / SHORE_TEXELS - SHORE_BORDER;
        const d = Math.hypot(x - tx, y - ty);
        const e = Math.min(1, Math.max(0, (d - (r - soft)) / (2 * soft)));
        const w = 1 - e * e * (3 - 2 * e);
        const k = j * N + i;
        if (w > (s.wood[k] as number)) s.wood[k] = w;
      }
    }
  }
  for (let k = 0; k < N * N; k++) {
    const water = (mask[k] as number) > 0.5;
    let d: number;
    if (!both) d = water ? -4 : 4;
    else {
      const dist = Math.sqrt(d2[k] as number) / SHORE_TEXELS;
      d = water ? -dist : dist;
    }
    const v = Math.round(128 + d * 32);
    out[k * 2] = v < 0 ? 0 : v > 255 ? 255 : v;
    out[k * 2 + 1] = Math.round((s.wood[k] as number) * 255);
  }
}
