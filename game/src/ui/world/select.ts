// Hover selection (I §3.1): every frame the object under the cursor becomes the selection, by selection box
// and selection priority (an entity or a ghost, else a resource tile, else the tile), and reach is measured from
// the character to the target's collision box (golden rule 21). Characters are not entities.
import type { EntityView, Mover } from '../../shared/gen/packet.ts';
import type { Protos } from '../store/protos.ts';
import type { Mirror } from './mirror.ts';

export type Selection =
  | { kind: 'entity'; serial: number; proto: number; x2: number; y2: number; dir: number; flags: number }
  | { kind: 'resource'; tx: number; ty: number; resource: number; band: number }
  | { kind: 'tile'; tx: number; ty: number };

export const sameSelection = (a: Selection | null, b: Selection | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind === 'entity') return b.kind === 'entity' && a.serial === b.serial;
  return a.kind === b.kind && a.tx === (b as { tx: number }).tx && a.ty === (b as { ty: number }).ty;
};

export const ENTITY_FLAG = { ghost: 1, deconstruct: 2 } as const;

export function entityBox(
  protos: Protos,
  e: { proto: number; x2: number; y2: number; dir: number },
  sel = true,
) {
  const [x0, y0, x1, y1] = sel ? protos.selectionBox(e.proto, e.dir) : protos.collisionBox(e.proto, e.dir);
  const cx = e.x2 / 2;
  const cy = e.y2 / 2;
  return { x0: cx + x0, y0: cy + y0, x1: cx + x1, y1: cy + y1 };
}

/** The object under world position (wx, wy) in tiles. */
export function pick(mirror: Mirror, protos: Protos, wx: number, wy: number): Selection {
  let best: EntityView | null = null;
  let bestPri = -1;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const e of mirror.entities()) {
    const b = entityBox(protos, e);
    if (wx < b.x0 || wx >= b.x1 || wy < b.y0 || wy >= b.y1) continue;
    const pri = protos.entity(e.proto)?.selectionPriority ?? 50;
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (pri > bestPri || (pri === bestPri && area < bestArea)) {
      best = e;
      bestPri = pri;
      bestArea = area;
    }
  }
  if (best)
    return {
      kind: 'entity',
      serial: best.serial,
      proto: best.proto,
      x2: best.x2,
      y2: best.y2,
      dir: best.dir,
      flags: best.flags,
    };
  const tx = Math.floor(wx);
  const ty = Math.floor(wy);
  const r = mirror.resourceAt(tx, ty);
  if (r) return { kind: 'resource', tx, ty, resource: r.resource, band: r.band };
  return { kind: 'tile', tx, ty };
}

/** Squared distance from a point to a box (0 inside). */
export function dist2(px: number, py: number, b: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = px < b.x0 ? b.x0 - px : px > b.x1 ? px - b.x1 : 0;
  const dy = py < b.y0 ? b.y0 - py : py > b.y1 ? py - b.y1 : 0;
  return dx * dx + dy * dy;
}

/** The character's position in tiles, from its mover record. */
export function moverPos(m: Mover): { x: number; y: number } {
  return { x: m.x / 256, y: m.y / 256 };
}

/** Whether a selection is within `reach` tiles of (cx, cy), measured to its collision box or tile square. */
export function inReach(protos: Protos, s: Selection, cx: number, cy: number, reach: number): boolean {
  const b =
    s.kind === 'entity' ? entityBox(protos, s, false) : { x0: s.tx, y0: s.ty, x1: s.tx + 1, y1: s.ty + 1 };
  return dist2(cx, cy, b) <= reach * reach;
}
