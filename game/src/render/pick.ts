// Picking (I §3.1; C4-r1 12): the object under a world position, as the UI's hover and clicks need it. An entity by
// its selection box turned to its direction and its selection priority (the higher wins, then the smaller box), else
// a resource tile, else the tile; null where the view model holds no chunk. From prototypes.json alone, so it works
// without WebGL (the view model fills from packets either way).

import type { PrototypesJson } from '../shared/gen/protos.ts';
import { chunkId, type ViewModel, type WorldPick } from '../shared/world-view.ts';
import { EV, RV } from './mirror.ts';

/** Selection boxes (x0, y0, x1, y1 facing north, from the footprint's centre) and priorities, per prototype. */
export interface SelectionTable {
  box: Float64Array;
  priority: Uint8Array;
}

export function selectionTable(protos: PrototypesJson): SelectionTable {
  const n = protos.entity.length;
  const box = new Float64Array(n * 4);
  protos.entity.forEach((e, i) => {
    for (let k = 0; k < 4; k++) box[i * 4 + k] = e.selectionBox[k] ?? 0;
  });
  return { box, priority: Uint8Array.from(protos.entity, (e) => e.selectionPriority ?? 50) };
}

/** A box (x0, y0, x1, y1) facing north turned to direction `dir` (16-way; east 4, south 8, west 12). */
export function turnBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dir: number,
): [number, number, number, number] {
  switch (dir & 15) {
    case 4:
      return [-y1, x0, -y0, x1];
    case 8:
      return [-x1, -y1, -x0, -y0];
    case 12:
      return [y0, -x1, y1, -x0];
    default:
      return [x0, y0, x1, y1];
  }
}

export function pick(model: ViewModel, sel: SelectionTable, wx: number, wy: number): WorldPick | null {
  const tx = Math.floor(wx);
  const ty = Math.floor(wy);
  const cx = tx >> 5;
  const cy = ty >> 5;
  const home = model.chunks.get(chunkId(cx, cy));
  if (home === undefined) return null;
  let best: WorldPick | null = null;
  let bestPri = -1;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const c = model.chunks.get(chunkId(cx + dx, cy + dy));
      if (c === undefined) continue;
      const v = c.entityView;
      for (let i = 0; i < c.entityCount; i++) {
        const o = i * 24;
        const proto = v.getUint16(o + EV.proto, true);
        const x2 = v.getInt32(o + EV.x2, true);
        const y2 = v.getInt32(o + EV.y2, true);
        const dir = v.getUint8(o + EV.dir);
        const b = proto * 4;
        const [x0, y0, x1, y1] = turnBox(
          sel.box[b] ?? 0,
          sel.box[b + 1] ?? 0,
          sel.box[b + 2] ?? 0,
          sel.box[b + 3] ?? 0,
          dir,
        );
        const ex = x2 / 2;
        const ey = y2 / 2;
        if (wx < ex + x0 || wx >= ex + x1 || wy < ey + y0 || wy >= ey + y1) continue;
        const pri = sel.priority[proto] ?? 50;
        const area = (x1 - x0) * (y1 - y0);
        if (pri > bestPri || (pri === bestPri && area < bestArea)) {
          bestPri = pri;
          bestArea = area;
          best = {
            kind: 'entity',
            serial: v.getUint32(o + EV.serial, true),
            proto,
            x2,
            y2,
            dir,
            flags: v.getUint8(o + EV.flags),
          };
        }
      }
    }
  if (best !== null) return best;
  const tile = (ty - cy * 32) * 32 + (tx - cx * 32);
  const r = home.resourceView;
  for (let i = 0; i < home.resourceCount; i++) {
    const o = i * 8;
    if (r.getUint16(o + RV.tile, true) !== tile) continue;
    return {
      kind: 'resource',
      tx,
      ty,
      resource: r.getUint16(o + RV.resource, true),
      band: r.getUint8(o + RV.band),
    };
  }
  return { kind: 'tile', tx, ty };
}
