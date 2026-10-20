// Conservative sprite bounds (C4-r1 2). Per set, the box in tiles around its anchor that covers every frame of every
// part and pose: base, idle, layers, lights, shadows, clips and their shadows, an inserter's arm and hand anywhere in
// their sweep, the smoke a chimney sends east and up. The scene chooses chunks and entities by these boxes, and only
// then culls each quad exactly, so a sprite or a shadow that reaches far from its anchor is never dropped: the big
// pole's greybox stands 8 tiles tall and throws its shadow 11.25 tiles east.

import { type Atlas, type Part, SET_KIND, type SpriteSet } from './manifest.ts';
import { SMOKE } from './style.ts';

/** An inserter's hand never reaches farther than this from its shoulder (tiles; long-handed inserters reach 2). */
export const INSERTER_REACH_TILES = 3;

/** Four numbers per set: x0, y0, x1, y1 in tiles from the anchor (x east, y south). */
export function setBounds(atlas: Atlas): Float64Array {
  const out = new Float64Array(atlas.sets.length * 4);
  for (const s of atlas.sets) {
    const b = boundsOf(atlas, s);
    out.set(b, s.index * 4);
  }
  return out;
}

function boundsOf(atlas: Atlas, s: SpriteSet): [number, number, number, number] {
  const fr = atlas.frames;
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  let any = false;
  const box = (a: number, b: number, c: number, d: number) => {
    if (!any) {
      x0 = a;
      y0 = b;
      x1 = c;
      y1 = d;
      any = true;
      return;
    }
    if (a < x0) x0 = a;
    if (b < y0) y0 = b;
    if (c > x1) x1 = c;
    if (d > y1) y1 = d;
  };
  /** Every frame of a part's entries, placed by its anchor. */
  const placed = (p: Part | null) => {
    if (p === null) return;
    for (let e = 0; e < p.entries.length; e += 2) {
      const start = p.entries[e] as number;
      const count = p.entries[e + 1] as number;
      for (let i = 0; i < count; i++) {
        const f = atlas.entryFrames[start + i] as number;
        const o = f * 8;
        const P = atlas.pxPerTile[fr[o] as number] as number;
        const ax = fr[o + 6] as number;
        const ay = fr[o + 7] as number;
        box(-ax / P, -ay / P, ((fr[o + 4] as number) - ax) / P, ((fr[o + 5] as number) - ay) / P);
      }
    }
  };
  /** The largest extent (tiles) of a part's frames from any point of the frame (rotated parts). */
  const diagonal = (p: Part | null): number => {
    let d = 0;
    if (p === null) return d;
    for (let e = 0; e < p.entries.length; e += 2) {
      const start = p.entries[e] as number;
      const count = p.entries[e + 1] as number;
      for (let i = 0; i < count; i++) {
        const o = (atlas.entryFrames[start + i] as number) * 8;
        const P = atlas.pxPerTile[fr[o] as number] as number;
        d = Math.max(d, Math.hypot(fr[o + 4] as number, fr[o + 5] as number) / P);
      }
    }
    return d;
  };
  if (s.kind === SET_KIND.inserter) {
    placed(s.platform);
    placed(s.platformShadow);
    const Pc = atlas.pxPerTile[atlas.arrayOfKind[0] as number] as number;
    const shoulder = Math.max(
      Math.abs(s.shoulderX),
      Math.abs(s.shoulderY),
      Math.abs(s.shadowShoulderX),
      Math.abs(s.shadowShoulderY),
    );
    const parts = [s.arm, s.armShadow, s.handOpen, s.handOpenShadow, s.handClosed, s.handClosedShadow];
    let d = 0;
    for (const p of parts) d = Math.max(d, diagonal(p));
    const armTiles = s.arm !== null ? s.arm.length / Pc : 0;
    // the hand at up to the reach from the shoulder (the arm stretches to it), each frame around its pivot
    const R = shoulder / Pc + Math.max(INSERTER_REACH_TILES, Math.ceil(armTiles) + 1) + d;
    box(-R, -R, R, R);
  } else for (const p of s.parts.values()) placed(p);
  // smoke drifts east and rises from each chimney point over its life, growing to its last size
  const Pc = atlas.pxPerTile[atlas.arrayOfKind[0] as number] as number;
  for (let i = 0; i + 1 < s.smoke.length; i += 2) {
    const px = (s.smoke[i] as number) / Pc;
    const py = (s.smoke[i + 1] as number) / Pc;
    const r = SMOKE.sizeTo;
    box(px - r - 0.1, py - SMOKE.rise - r, px + SMOKE.driftEast + 0.1 + r, py + r);
  }
  return [x0, y0, x1, y1];
}

/** The farthest any set reaches from its anchor (tiles): the margin around the view for choosing chunks. */
export function maxReach(b: Float64Array): number {
  let r = 0;
  for (let i = 0; i < b.length; i++) r = Math.max(r, Math.abs(b[i] as number));
  return r;
}
