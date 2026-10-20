// Belt items from gap arrays (10 §15.4, §6.8). A line's items arrive as the line holds them: d₀ = front_gap from the
// downstream end, dᵢ = dᵢ₋₁ + 64 + gap[i]. The main thread walks the line's cached segments from the front and maps
// each distance to a point on the lane's centreline: straight runs linearly against their direction of travel, arcs
// by angle about the centre that `dir`, `turn` and `radius` fix. The sim supplies every length and shape, so the
// renderer does no gameplay arithmetic.

import { BeltItemsCodec } from '../shared/gen/packet.ts';
import type { BeltLine } from './mirror.ts';
import { DIR_X, DIR_Y } from './projection.ts';

/** Output buffers for one line's item positions (tiles) and keys; grown by the caller. */
export interface BeltOut {
  x: Float64Array;
  y: Float64Array;
  key: Int32Array;
}

export function beltOut(n = 1024): BeltOut {
  return { x: new Float64Array(n), y: new Float64Array(n), key: new Int32Array(n) };
}

/** Positions of the items of the BELT_ITEMS record at byte `o` of `v` on `line`; returns how many were placed. */
export function expandLine(line: BeltLine, v: DataView, o: number, out: BeltOut): number {
  const count = v.getUint16(o + BeltItemsCodec.OFFSET.count, true);
  if (count > out.x.length) return -count;
  const keys = o + BeltItemsCodec.PREFIX;
  const gaps = keys + count * 2;
  const segs = line.segs;
  let s = 0;
  let segStart = 0;
  let segLen = segs[2] as number;
  let d = v.getInt32(o + BeltItemsCodec.OFFSET.front_gap, true);
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) d += 64 + v.getInt16(gaps + (i - 1) * 2, true);
    while (s < line.segCount && d > segStart + segLen) {
      segStart += segLen;
      s++;
      segLen = s < line.segCount ? (segs[s * 6 + 2] as number) : 0;
    }
    if (s >= line.segCount) break;
    const local = Math.max(0, d - segStart);
    const ex = segs[s * 6] as number;
    const ey = segs[s * 6 + 1] as number;
    const dir = (segs[s * 6 + 3] as number) & 15;
    const turn = segs[s * 6 + 4] as number;
    const tx = DIR_X[dir] as number;
    const ty = DIR_Y[dir] as number;
    let px: number;
    let py: number;
    if (turn === 0) {
      px = ex - tx * local;
      py = ey - ty * local;
    } else {
      const r = segs[s * 6 + 5] as number;
      // the centre lies `radius` to the turn's side of the downstream end: right of travel is (−ty, tx)
      const cx = ex + turn * r * -ty;
      const cy = ey + turn * r * tx;
      const vx = ex - cx;
      const vy = ey - cy;
      // upstream along the arc: rotate back by the angle travelled, φ = local ÷ radius (same units)
      const a = (-turn * local) / r;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      px = cx + vx * c - vy * sn;
      py = cy + vx * sn + vy * c;
    }
    out.x[n] = px / 256;
    out.y[n] = py / 256;
    out.key[n] = v.getUint16(keys + i * 2, true);
    n++;
  }
  return n;
}
