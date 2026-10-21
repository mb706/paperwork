// Where windows and tooltips go (I §4.0, §4.8): plain geometry, kept apart from the components so Vitest runs it.

/** Keeps a window inside the viewport: its top left at least 0, its far edge inside when it fits (C5-r1 19). */
export function clampPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, vw - w)),
    y: Math.max(0, Math.min(y, vh - h)),
  };
}

const EDGE = 10;

/**
 * Where a tooltip goes (GUI px): right of its anchor, flipped left at the screen's right edge, kept 10 px inside
 * the viewport. `anchor` is in viewport px (measured on hover), `size` in GUI px.
 */
export function placeTooltip(
  anchor: { x: number; y: number; w: number; h: number },
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  scale: number,
): { x: number; y: number } {
  const vw = viewport.w / scale;
  const vh = viewport.h / scale;
  const ax = anchor.x / scale;
  const ay = anchor.y / scale;
  let x = ax + anchor.w / scale + 6;
  if (x + size.w > vw - EDGE) x = ax - size.w - 6;
  if (x < EDGE) x = EDGE;
  let y = ay;
  if (y + size.h > vh - EDGE) y = vh - EDGE - size.h;
  if (y < EDGE) y = EDGE;
  return { x, y };
}
