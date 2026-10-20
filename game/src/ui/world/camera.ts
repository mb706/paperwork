// The camera the input layer reads (10 §15.7's projection in CSS pixels; I §3.15): the cursor's world position,
// flying text and the view request come from it. The renderer (C4) owns the real camera and zoom; until it is
// wired this one follows the character, zooms by notches (about ×1.1 each, closest 3×) and resets with F9 and
// Shift+F9. Anything that implements `WorldCamera` can replace it.

/** CSS pixels per tile at zoom 1 (I §0: 1 tile = 32 px at zoom 1.0). */
export const PX_PER_TILE = 32;
export const ZOOM_MAX = 3;
/** About 200 tiles across a 1920-px view (I §3.15); the map view beyond it is the renderer's. */
export const ZOOM_MIN = 0.3;
export const ZOOM_STEP = 1.1;

export interface WorldCamera {
  readonly cx: number;
  readonly cy: number;
  readonly zoom: number;
  /** The viewport in CSS px (the canvas's client rectangle). */
  readonly width: number;
  readonly height: number;
  toWorld(px: number, py: number): { x: number; y: number };
  toScreen(wx: number, wy: number): { x: number; y: number };
}

export class FollowCamera implements WorldCamera {
  cx = 0;
  cy = 0;
  zoom = 1;
  width = 1;
  height = 1;
  left = 0;
  top = 0;

  setViewport(left: number, top: number, width: number, height: number): void {
    this.left = left;
    this.top = top;
    this.width = width > 0 ? width : 1;
    this.height = height > 0 ? height : 1;
  }

  follow(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
  }

  /** Pixels per tile now. */
  get scale(): number {
    return PX_PER_TILE * this.zoom;
  }

  zoomBy(notches: number): void {
    let z = this.zoom * ZOOM_STEP ** notches;
    if (z > ZOOM_MAX) z = ZOOM_MAX;
    if (z < ZOOM_MIN) z = ZOOM_MIN;
    this.zoom = z;
  }

  setZoom(z: number): void {
    this.zoom = z;
  }

  toWorld(px: number, py: number): { x: number; y: number } {
    const s = this.scale;
    return {
      x: this.cx + (px - this.left - this.width / 2) / s,
      y: this.cy + (py - this.top - this.height / 2) / s,
    };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    const s = this.scale;
    return {
      x: this.left + this.width / 2 + (wx - this.cx) * s,
      y: this.top + this.height / 2 + (wy - this.cy) * s,
    };
  }

  /** The visible rectangle in tiles, upper bounds exclusive (the view request's x0 … y1, §15.4). */
  visible(): { x0: number; y0: number; x1: number; y1: number } {
    const s = this.scale;
    const hw = this.width / 2 / s;
    const hh = this.height / 2 / s;
    return {
      x0: Math.floor(this.cx - hw),
      y0: Math.floor(this.cy - hh),
      x1: Math.ceil(this.cx + hw),
      y1: Math.ceil(this.cy + hh),
    };
  }
}
