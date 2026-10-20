// The lookup contracts of 10 §15.7: dense Int32Array tables from prototypes.json and the compiled manifest, built
// once at load, so drawing never looks up a string. Every join is by name (`<namespace>/<name>`), which is also
// what lets `?sim=fake` draw the fake's M1 prototypes with the M0 atlas (C1c open issue 4): a different
// prototypesHash is an error in dev builds except in fake mode, where the renderer joins by name and warns.

import type { PrototypesJson } from '../shared/gen/protos.ts';
import { type Atlas, KIND } from './manifest.ts';
import { iconFrame } from './programs.ts';

/** How the renderer draws an entity prototype (10 §6.2's layers, §15.7's programs). */
export const ROLE = {
  /** The `entity` program in the object layer. */
  entity: 0,
  /** The `entity` program in the ground layer: belts, undergrounds (floor entities, §6.2 step 2). */
  floor: 1,
  /** The `inserter` program: the platform in the object layer, arm and hand in the high layer. */
  inserter: 2,
  /** Not drawn from CHUNK_ENTITIES (the character is a mover). */
  none: 3,
} as const;

const FLOOR_TYPES: ReadonlySet<string> = new Set(['belt', 'underground-belt']);

export class Lookups {
  readonly entitySet: Int32Array;
  readonly greybox: Int32Array;
  readonly role: Uint8Array;
  /** 1 for transport belts (the fake-mode mask stand-in, fake-belts.ts). */
  readonly isBelt: Uint8Array;
  /** Footprint (w, h) in tiles as the prototype faces north. */
  readonly size: Float64Array;
  /** Collision and selection boxes (x0, y0, x1, y1) relative to the footprint centre, facing north. */
  readonly collision: Float64Array;
  readonly selection: Float64Array;
  /** Positions per tick (prototypes.bin's belt_speed), for the belt animation (10 §6.8). */
  readonly beltSpeed: Int32Array;
  /** Mover set per prototype (MOVERS.proto). */
  readonly moverSet: Int32Array;
  /** Item id → icon frame (ItemKey >> 3), fx/missing when the item has no set. */
  readonly itemIcon: Int32Array;
  /** prototypes.json's icon table → icon frame (EntityView.alt_icon). */
  readonly iconTable: Int32Array;
  readonly treeSet: Int32Array;
  readonly worldSet: Int32Array;
  readonly decorSet: Int32Array;
  readonly resourceSet: Int32Array;
  readonly missingIcon: number;
  readonly smokeSet: number;
  /** Names the data asks for that the atlas lacks (a dev build logs them once). */
  readonly missing: string[] = [];

  constructor(atlas: Atlas, protos: PrototypesJson, beltSpeed?: ArrayLike<number>) {
    const set = (name: string | null | undefined): number => {
      if (!name) return -1;
      const s = atlas.set(name);
      if (s === null) this.missing.push(name);
      return s?.index ?? -1;
    };
    const n = protos.entity.length;
    this.entitySet = new Int32Array(n);
    this.greybox = new Int32Array(n);
    this.role = new Uint8Array(n);
    this.isBelt = new Uint8Array(n);
    this.size = new Float64Array(n * 2);
    this.collision = new Float64Array(n * 4);
    this.selection = new Float64Array(n * 4);
    this.beltSpeed = new Int32Array(n);
    this.moverSet = new Int32Array(n).fill(-1);
    protos.entity.forEach((e, i) => {
      const isMover = e.sprite.startsWith('mover/') || e.type === 'character';
      this.role[i] = isMover
        ? ROLE.none
        : e.type === 'inserter'
          ? ROLE.inserter
          : FLOOR_TYPES.has(e.type)
            ? ROLE.floor
            : ROLE.entity;
      this.isBelt[i] = e.type === 'belt' ? 1 : 0;
      if (isMover) {
        this.entitySet[i] = -1;
        this.moverSet[i] = set(e.sprite);
      } else this.entitySet[i] = atlas.set(e.sprite)?.index ?? -1;
      this.greybox[i] = atlas.set(`greybox/${e.name}`)?.index ?? -1;
      if (!isMover && this.entitySet[i] === -1 && this.greybox[i] === -1) this.missing.push(e.sprite);
      this.size[i * 2] = e.size[0] ?? 1;
      this.size[i * 2 + 1] = e.size[1] ?? 1;
      for (let k = 0; k < 4; k++) {
        this.collision[i * 4 + k] = e.collisionBox[k] ?? 0;
        this.selection[i * 4 + k] = e.selectionBox[k] ?? 0;
      }
      this.beltSpeed[i] = beltSpeed?.[i] ?? 0;
    });
    const missingSet = atlas.set('fx/missing');
    this.missingIcon = iconFrame(atlas, missingSet);
    const icon = (name: string): number => {
      const s = atlas.set(name);
      const f = iconFrame(atlas, s);
      if (f < 0) this.missing.push(name);
      return f >= 0 ? f : this.missingIcon;
    };
    this.itemIcon = Int32Array.from(protos.item, (it) => icon(it.icon));
    this.iconTable = Int32Array.from(protos.icons, (name) => icon(name));
    this.treeSet = Int32Array.from(protos.treeSpecies, (name) => set(name));
    this.worldSet = Int32Array.from(protos.world, (w) => set(w.sprite));
    this.decorSet = Int32Array.from(protos.decoratives, (name) => set(name));
    this.resourceSet = Int32Array.from(protos.resource, (r) => set(r.sprite));
    this.smokeSet = atlas.set('fx/smoke')?.index ?? -1;
    // icons must come from the icon array (the icon program's P is per icon)
    if (this.missingIcon >= 0 && atlas.kindOf(this.missingIcon) !== KIND.icon)
      this.missing.push('fx/missing (not an icon)');
  }

  /** The icon frame of an ItemKey ((item id << 3) | quality), fx/missing for an unknown item. */
  itemFrame(key: number): number {
    const f = this.itemIcon[key >> 3];
    return f === undefined ? this.missingIcon : f;
  }
}
