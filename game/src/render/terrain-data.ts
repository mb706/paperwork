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

/** Scratch for `buildShore` (one per renderer; nothing allocates per chunk). */
export class ShoreScratch {
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

function w4(a: number, f: number): number {
  if (a === -1) return (1 - f) * G1;
  if (a === 0) return (1 - f) * G0 + f * G1;
  if (a === 1) return (1 - f) * G1 + f * G0;
  return f * G1;
}

/**
 * Builds the 152² RG8 shore texture into `out` (2 bytes per texel) from the 38² ids. `isWater[id]` is 1 for water
 * types; `trees` holds tree positions in tiles relative to the chunk's origin (x, y pairs, `treeCount` of them).
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
  const idAt = (x: number, y: number) => {
    const cx = x < 0 ? 0 : x >= ID_SIZE ? ID_SIZE - 1 : x;
    const cy = y < 0 ? 0 : y >= ID_SIZE ? ID_SIZE - 1 : y;
    return ids[cy * ID_SIZE + cx] as number;
  };
  // the blended water mask at texel centres (tile coordinates −3 + (i + 0.5) / 4), as the shader blends masks
  let anyWater = false;
  let anyLand = false;
  for (let j = 0; j < N; j++) {
    const y = (j + 0.5) / SHORE_TEXELS - SHORE_BORDER;
    const qy = y - 0.5;
    const j0 = Math.floor(qy);
    const fy = qy - j0;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / SHORE_TEXELS - SHORE_BORDER;
      const qx = x - 0.5;
      const i0 = Math.floor(qx);
      const fx = qx - i0;
      let m = 0;
      for (let b = -1; b <= 2; b++) {
        const wy = w4(b, fy);
        const ry = j0 + b + ID_BORDER;
        for (let a = -1; a <= 2; a++) if (isWater[idAt(i0 + a + ID_BORDER, ry)] === 1) m += w4(a, fx) * wy;
      }
      s.mask[j * N + i] = m;
      if (m > 0.5) anyWater = true;
      else anyLand = true;
    }
  }
  // seeds: the 0.5 crossing between each pair of neighbouring texels, located linearly
  const INF = 1e9;
  s.d2.fill(INF);
  const seed = (k: number, px: number, py: number, tx: number, ty: number) => {
    const dx = px - tx;
    const dy = py - ty;
    const d = dx * dx + dy * dy;
    if (d < (s.d2[k] as number)) {
      s.d2[k] = d;
      s.sx[k] = px;
      s.sy[k] = py;
    }
  };
  if (anyWater && anyLand)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const m = s.mask[k] as number;
        const w = m > 0.5;
        if (i + 1 < N) {
          const m2 = s.mask[k + 1] as number;
          if (m2 > 0.5 !== w) {
            const t = (m - 0.5) / (m - m2);
            const px = i + t;
            seed(k, px, j, i, j);
            seed(k + 1, px, j, i + 1, j);
          }
        }
        if (j + 1 < N) {
          const m2 = s.mask[k + N] as number;
          if (m2 > 0.5 !== w) {
            const t = (m - 0.5) / (m - m2);
            const py = j + t;
            seed(k, i, py, i, j);
            seed(k + N, i, py, i, j + 1);
          }
        }
      }
  // two passes carrying the nearest seed point (8 neighbours)
  const relax = (k: number, n: number, i: number, j: number) => {
    if ((s.d2[n] as number) >= INF) return;
    const px = s.sx[n] as number;
    const py = s.sy[n] as number;
    const dx = px - i;
    const dy = py - j;
    const d = dx * dx + dy * dy;
    if (d < (s.d2[k] as number)) {
      s.d2[k] = d;
      s.sx[k] = px;
      s.sy[k] = py;
    }
  };
  if (anyWater && anyLand) {
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (i > 0) relax(k, k - 1, i, j);
        if (j > 0) {
          relax(k, k - N, i, j);
          if (i > 0) relax(k, k - N - 1, i, j);
          if (i + 1 < N) relax(k, k - N + 1, i, j);
        }
      }
    for (let j = N - 1; j >= 0; j--)
      for (let i = N - 1; i >= 0; i--) {
        const k = j * N + i;
        if (i + 1 < N) relax(k, k + 1, i, j);
        if (j + 1 < N) {
          relax(k, k + N, i, j);
          if (i + 1 < N) relax(k, k + N + 1, i, j);
          if (i > 0) relax(k, k + N - 1, i, j);
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
    const water = (s.mask[k] as number) > 0.5;
    let d: number;
    if (!(anyWater && anyLand)) d = water ? -4 : 4;
    else {
      const dist = Math.sqrt(s.d2[k] as number) / SHORE_TEXELS;
      d = water ? -dist : dist;
    }
    const v = Math.round(128 + d * 32);
    out[k * 2] = v < 0 ? 0 : v > 255 ? 255 : v;
    out[k * 2 + 1] = Math.round((s.wood[k] as number) * 255);
  }
}
