// World-to-screen projection (10 §15.7) and the renderer's format constants. Everything is in device pixels, so one
// formula serves dpr 1 and 2: S = PX_PER_TILE · zoom · dpr device pixels per tile, positions relative to the
// canvas centre, and a frame [array, layer, x, y, w, h, ax, ay] placed with k = S ÷ the array's pxPerTile.
// The camera, not each sprite, is rounded to whole device pixels (`snapCamera`), so a still scene never shimmers;
// positions are subtracted from the camera in f64 before they become f32 vertices (10 §6.3).

/** CSS pixels per tile at zoom 1 (I §3.15). */
export const PX_PER_TILE = 32;
/** The closest zoom (I §3.15: 3×). */
export const ZOOM_MAX = 3;
/** The furthest world zoom (10 §6.10: about 200 tiles across at 1920 px). */
export const ZOOM_MIN_WORLD = 0.3;
/** The furthest chart zoom (10 §6.10); the chart renderer arrives with M1's map view. */
export const ZOOM_MIN_CHART = 1 / 64;
/** One wheel notch in the world (I §3.15: about ×1.1). */
export const ZOOM_STEP_WORLD = 1.1;
/** Source pixels per tile at level 0 (10 §15.7): colour 64 (High; level 1 is Normal, 32), shadows 32, lights 16. */
export const SOURCE_PX_PER_TILE = { colour: 64, shadow: 32, light: 16 } as const;
/** Heights render 1:1 (10 §9.1's calibration). */
export const HEIGHT_SCALE = 1;
/** Chunk-level culling margin in tiles (10 §6.6). */
export const CULL_MARGIN_TILES = 6;
/** Tiles per chunk side (10 §4.4). */
export const CHUNK_TILES = 32;
/** A ground position's fixed point: 1/256 tile (§15.4's ObjectView, MOVERS, BELT_GEOM). */
export const POS_ONE = 256;

/** The camera: centre in tiles (f64), zoom, and the canvas's device pixel ratio (10 §6.10: ≤ 2 × render scale). */
export interface Camera {
  cx: number;
  cy: number;
  zoom: number;
  dpr: number;
}

/** Device pixels per tile. */
export function scaleOf(cam: Camera): number {
  return PX_PER_TILE * cam.zoom * cam.dpr;
}

/** The camera moved to the nearest whole device pixel at its scale (10 §15.7: "the camera, not each sprite"). */
export function snapCamera(cam: Camera, out: Camera): Camera {
  const S = scaleOf(cam);
  out.zoom = cam.zoom;
  out.dpr = cam.dpr;
  out.cx = Math.round(cam.cx * S) / S;
  out.cy = Math.round(cam.cy * S) / S;
  return out;
}

/** World x (tiles) → device px right of the canvas centre. */
export function screenX(cam: Camera, x: number): number {
  return (x - cam.cx) * scaleOf(cam);
}

/** World y (tiles) at height h (tiles) → device px below the canvas centre. */
export function screenY(cam: Camera, y: number, h = 0): number {
  const S = scaleOf(cam);
  return (y - cam.cy) * S - HEIGHT_SCALE * h * S;
}

/** The world rectangle a canvas of `w` × `h` device pixels shows, in tiles: [x0, y0, x1, y1]. */
export function visibleRect(cam: Camera, w: number, h: number, out: Float64Array): Float64Array {
  const S = scaleOf(cam);
  out[0] = cam.cx - w / 2 / S;
  out[1] = cam.cy - h / 2 / S;
  out[2] = cam.cx + w / 2 / S;
  out[3] = cam.cy + h / 2 / S;
  return out;
}

/** A frame as the manifest lists it: [array, layer, x, y, w, h, ax, ay], level-0 pixels of its array. */
export const FRAME_STRIDE = 8;

/**
 * Places frame `f` (offset `f · FRAME_STRIDE` into `frames`) whose array has `pxPerTile` with its anchor at world
 * (ex, ey): writes [left, top, w, h] in device px from the canvas centre into `out` (10 §15.7's formula).
 */
export function placeFrame(
  frames: Float64Array,
  f: number,
  pxPerTile: number,
  cam: Camera,
  ex: number,
  ey: number,
  out: Float64Array,
): Float64Array {
  const o = f * FRAME_STRIDE;
  const S = scaleOf(cam);
  const k = S / pxPerTile;
  out[0] = (ex - cam.cx) * S - (frames[o + 6] as number) * k;
  out[1] = (ey - cam.cy) * S - (frames[o + 7] as number) * k;
  out[2] = (frames[o + 4] as number) * k;
  out[3] = (frames[o + 5] as number) * k;
  return out;
}

/**
 * The level of detail a page needs: k > 0.5 device px per level-0 source px needs level 0 (High), else level 1
 * (Normal) is enough (10 §15.7 "Levels"; the renderer requests level 0 for pages drawn with k > 0.5).
 */
export function needsLevel0(k: number): boolean {
  return k > 0.5;
}

/** 10 §15.7's position hash, for shapes the packet does not carry (trees, rocks, resource tiles, decoratives). */
export function posHash(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Direction 0–15 (north 0, east 4, south 8, west 12; 10 §4.2) as a unit vector in world (x east, y south). */
export const DIR_X = new Float64Array(16);
export const DIR_Y = new Float64Array(16);
for (let d = 0; d < 16; d++) {
  const a = (d / 16) * 2 * Math.PI;
  DIR_X[d] = Math.round(Math.sin(a) * 1e12) / 1e12;
  DIR_Y[d] = Math.round(-Math.cos(a) * 1e12) / 1e12;
}
