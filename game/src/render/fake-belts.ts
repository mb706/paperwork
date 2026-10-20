// A stand-in for `?sim=fake` only: the fake sim sends every belt's connection mask as 0 (EntityView.variant), which
// would draw each belt as a lone piece with both caps. The real sim sends the masks (10 §15.4; C6's bit proposal,
// pm/reports/C6.md deviation 8: bit 0 fed from behind, 1 from the left, 2 from the right, 3 the output connects).
// Until then the dev page derives them from the neighbouring belts as Factorio connects them. Never used with the
// real sim: the renderer does no gameplay arithmetic.

import type { Lookups } from './lookups.ts';
import { EV, type Mirror } from './mirror.ts';
import { DIR_X, DIR_Y } from './projection.ts';

let seen = -1;

export function deriveBeltMasks(mirror: Mirror, look: Lookups): void {
  // only when the chunk set or an entity list changed (the terrain revision moves with every chunk delta)
  let rev = mirror.chunks.size;
  for (const c of mirror.chunks.values())
    rev = (Math.imul(rev, 31) + c.entityCount + (c.versions[1] as number)) | 0;
  if (rev === seen) return;
  seen = rev;
  const belts = new Map<string, number>();
  for (const c of mirror.chunks.values()) {
    const v = c.entityView;
    for (let i = 0; i < c.entityCount; i++) {
      const o = i * 24;
      if (!look.isBelt[v.getUint16(o + EV.proto, true)]) continue;
      const x = v.getInt32(o + EV.x2, true) >> 1;
      const y = v.getInt32(o + EV.y2, true) >> 1;
      belts.set(`${x},${y}`, v.getUint8(o + EV.dir));
    }
  }
  const at = (x: number, y: number) => belts.get(`${x},${y}`);
  const feeds = (x: number, y: number, tx: number, ty: number) => {
    const d = at(x, y);
    return (
      d !== undefined &&
      x + Math.round(DIR_X[d] as number) === tx &&
      y + Math.round(DIR_Y[d] as number) === ty
    );
  };
  for (const c of mirror.chunks.values()) {
    const v = c.entityView;
    for (let i = 0; i < c.entityCount; i++) {
      const o = i * 24;
      if (!look.isBelt[v.getUint16(o + EV.proto, true)]) continue;
      const x = v.getInt32(o + EV.x2, true) >> 1;
      const y = v.getInt32(o + EV.y2, true) >> 1;
      const d = v.getUint8(o + EV.dir);
      const fx = Math.round(DIR_X[d] as number);
      const fy = Math.round(DIR_Y[d] as number);
      // left of travel is (fy, −fx) in x east, y south; right is (−fy, fx)
      let mask = 0;
      if (feeds(x - fx, y - fy, x, y)) mask |= 1;
      if (feeds(x + fy, y - fx, x, y)) mask |= 2;
      if (feeds(x - fy, y + fx, x, y)) mask |= 4;
      const ahead = at(x + fx, y + fy);
      if (ahead !== undefined && ahead !== ((d + 8) & 15)) mask |= 8;
      v.setUint8(o + EV.variant, mask);
    }
  }
}
