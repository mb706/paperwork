// Positional attenuation and mixing, as in Factorio (10 §9.4, "The SFX system"; A4 §7.3 rule 5): the camera
// is the listener, world sounds fall off with distance from the view centre, pan by screen x, and lose
// level when zoomed out; map view mutes them (a bus gate, mixer/graph.ts).
import { clamp } from '../core/units.ts';

/** What the audio module knows of the view (the renderer's camera; 10 §15.4's view request). */
export interface ListenerView {
  /** The view centre in tiles. */
  cx: number;
  cy: number;
  /** Half the view's width in tiles. */
  halfWidth: number;
  /** The renderer's zoom (1 = normal; 0.25 = zoomed out four times). */
  zoom: number;
  mapView: boolean;
}

export const defaultView = (): ListenerView => ({ cx: 0, cy: 0, halfWidth: 32, zoom: 1, mapView: false });

/** R = `audio_half_range`: half the view width in tiles, at most 64 (10 §15.6). */
export const halfRange = (v: ListenerView): number => Math.min(64, Math.max(1, v.halfWidth));

/** Distance weighting: 1 ÷ (1 + (d ÷ R)²), so half a screen away is −6 dB. */
export const distanceGain = (d: number, R: number): number => 1 / (1 + (d / R) * (d / R));

/** Pan by screen x: ±0.7 at the edges. `dx` is tiles from the view centre. */
export const panFor = (dx: number, halfWidth: number): number =>
  0.7 * clamp(dx / Math.max(1e-6, halfWidth), -1, 1);

/** Zooming out lowers entity sounds: 9 dB × clamp(log₂(1 ÷ zoom) ÷ 2, 0, 1), so −9 dB at 0.25×. */
export const zoomGain = (zoom: number): number => {
  const k = clamp(Math.log2(1 / Math.max(1e-6, zoom)) / 2, 0, 1);
  return 10 ** ((-9 * k) / 20);
};

/** A one-shot at world position (x, y): [gain, pan]. */
export function placeAt(v: ListenerView, x: number, y: number): [number, number] {
  const dx = x - v.cx;
  const dy = y - v.cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  return [distanceGain(d, halfRange(v)) * zoomGain(v.zoom), panFor(dx, v.halfWidth)];
}

/**
 * A working sound from its AUDIO_WORKING record (10 §15.6): gain = min(1, 0.5 · log₂(1 + n)) × (wsum ÷ n)
 * × the zoom factor; pan by the centroid (cx is relative to the view centre).
 */
export function workingMix(v: ListenerView, n: number, cx: number, wsum: number): [number, number] {
  if (n <= 0) return [0, 0];
  const count = Math.min(1, 0.5 * Math.log2(1 + n));
  return [count * (wsum / n) * zoomGain(v.zoom), panFor(cx, v.halfWidth)];
}
