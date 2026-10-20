// The world as the input layer reads it (I §3.1; 10 §3.4): the hover selection is the world view's pick (C4's
// `pickAt`: an entity by selection box and priority, else a resource tile, else the tile), and reach is measured
// from the character to the target's collision box (golden rule 21). The view model (`WorldViewApi.model`) is
// read here for what picking does not answer: an entity by serial (a refusal's "X in the way"), the tile under a
// point, and the footprint test of the build preview (I §3.3). Records are read in place with the generated
// codecs' field readers; nothing is kept past the call (the model is valid until the next packet).
import { EntityViewCodec } from '../../shared/gen/packet.ts';
import { chunkId, type ViewModel, type WorldPick } from '../../shared/world-view.ts';
import type { Protos } from '../store/protos.ts';

/** What is under the pointer (C4's WorldPick). */
export type Selection = WorldPick;

export const sameSelection = (a: Selection | null, b: Selection | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind === 'entity') return b.kind === 'entity' && a.serial === b.serial;
  return a.kind === b.kind && a.tx === (b as { tx: number }).tx && a.ty === (b as { ty: number }).ty;
};

export const ENTITY_FLAG = { ghost: 1, deconstruct: 2 } as const;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function entityBox(
  protos: Protos,
  e: { proto: number; x2: number; y2: number; dir: number },
  sel = true,
): Box {
  const [x0, y0, x1, y1] = sel ? protos.selectionBox(e.proto, e.dir) : protos.collisionBox(e.proto, e.dir);
  const cx = e.x2 / 2;
  const cy = e.y2 / 2;
  return { x0: cx + x0, y0: cy + y0, x1: cx + x1, y1: cy + y1 };
}

/** Squared distance from a point to a box (0 inside). */
export function dist2(px: number, py: number, b: Box): number {
  const dx = px < b.x0 ? b.x0 - px : px > b.x1 ? px - b.x1 : 0;
  const dy = py < b.y0 ? b.y0 - py : py > b.y1 ? py - b.y1 : 0;
  return dx * dx + dy * dy;
}

/** Whether a selection is within `reach` tiles of (cx, cy), measured to its collision box or tile square. */
export function inReach(protos: Protos, s: Selection, cx: number, cy: number, reach: number): boolean {
  const b =
    s.kind === 'entity' ? entityBox(protos, s, false) : { x0: s.tx, y0: s.ty, x1: s.tx + 1, y1: s.ty + 1 };
  return dist2(cx, cy, b) <= reach * reach;
}

/** An entity record of the view model. */
export interface ModelEntity {
  serial: number;
  proto: number;
  x2: number;
  y2: number;
  dir: number;
  flags: number;
}

const G = EntityViewCodec.get;
const SIZE = EntityViewCodec.SIZE;

/** Every entity the view model holds (tests and the dev hooks). */
export function* modelEntities(model: ViewModel): Generator<ModelEntity> {
  for (const c of model.chunks.values()) {
    const v = c.entityView;
    for (let i = 0; i < c.entityCount; i++) {
      const o = i * SIZE;
      yield {
        serial: G.serial(v, o),
        proto: G.proto(v, o),
        x2: G.x2(v, o),
        y2: G.y2(v, o),
        dir: G.dir(v, o),
        flags: G.flags(v, o),
      };
    }
  }
}

/** The entity with this serial, if a held chunk has it (a refusal names it, I §3.3). */
export function modelEntity(model: ViewModel, serial: number): ModelEntity | null {
  if (serial === 0) return null;
  for (const c of model.chunks.values()) {
    const v = c.entityView;
    for (let i = 0; i < c.entityCount; i++)
      if (G.serial(v, i * SIZE) === serial) {
        const o = i * SIZE;
        return {
          serial,
          proto: G.proto(v, o),
          x2: G.x2(v, o),
          y2: G.y2(v, o),
          dir: G.dir(v, o),
          flags: G.flags(v, o),
        };
      }
  }
  return null;
}

/** The tile id at (tx, ty), or null outside the held chunks. */
export function modelTile(model: ViewModel, tx: number, ty: number): number | null {
  const c = model.chunks.get(chunkId(Math.floor(tx / 32), Math.floor(ty / 32)));
  if (!c?.tiles) return null;
  return c.tiles[(ty & 31) * 32 + (tx & 31)] ?? null;
}

/** The build preview's state (I §3.3 `build_preview_tints`). */
export type PreviewState = 'buildable' | 'too-far' | 'blocked' | 'ghost';

/**
 * Whether the footprint `box` is free in the view model: no entity's collision box overlaps it and no tile under
 * it collides (water, the map's edge) or is outside the held chunks. A hint only: the sim decides (I §3.3).
 */
export function footprintFree(model: ViewModel, protos: Protos, box: Box): boolean {
  const eps = 1e-6;
  for (let ty = Math.floor(box.y0 + eps); ty < box.y1 - eps; ty++)
    for (let tx = Math.floor(box.x0 + eps); tx < box.x1 - eps; tx++) {
      const id = modelTile(model, tx, ty);
      if (id === null || protos.tileBlocks(id)) return false;
    }
  for (const c of model.chunks.values()) {
    const v = c.entityView;
    for (let i = 0; i < c.entityCount; i++) {
      const o = i * SIZE;
      const b = entityBox(
        protos,
        { proto: G.proto(v, o), x2: G.x2(v, o), y2: G.y2(v, o), dir: G.dir(v, o) },
        false,
      );
      if (b.x0 < box.x1 - eps && b.x1 > box.x0 + eps && b.y0 < box.y1 - eps && b.y1 > box.y0 + eps)
        return false;
    }
  }
  return true;
}
