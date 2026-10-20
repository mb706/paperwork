// The prototype tables the reference model reads (10 §15.2): the golden set's frozen prototypes.bin, read
// with the generated reader, which refuses what Rust's `Protos::load` refuses. The model never hard-codes an
// id: it resolves names through the NAMES tables, as the sim does with `well_known` (§2.4 step 4).
import { createHash } from 'node:crypto';
import {
  type EntityRow,
  type ItemRow,
  type ProtosRead,
  type RecipeRow,
  type ResourceRow,
  readPrototypesBin,
  type TileRow,
} from '../../../src/shared/gen/protos.ts';
import { EntityType } from '../../../src/shared/gen/types.ts';

export interface Protos {
  readonly raw: ProtosRead;
  readonly item: readonly ItemRow[];
  readonly recipe: readonly RecipeRow[];
  readonly entity: readonly EntityRow[];
  readonly resource: readonly ResourceRow[];
  readonly tile: readonly TileRow[];
  /** The engine's character: the last PROTO_ENTITY row, type `character` (C1b decision 5). */
  readonly character: number;
  /** meta.start.inventory, by item id (§5.1: what a new player starts with). */
  readonly startInventory: readonly { item: number; count: number }[];
  readonly names: ProtosRead['names'];
  /** Ids by name, per kind. */
  id(kind: 'item' | 'recipe' | 'entity' | 'resource' | 'tile', name: string): number;
}

export function loadProtos(bytes: Uint8Array): Protos {
  const raw = readPrototypesBin(bytes);
  const character = raw.entity.findIndex((e) => e.type === EntityType.character);
  if (character < 0) throw new Error('prototypes.bin has no character row (C1b decision 5)');
  return {
    raw,
    item: raw.item,
    recipe: raw.recipe,
    entity: raw.entity,
    resource: raw.resource,
    tile: raw.tile,
    character,
    startInventory: raw.meta.start.inventory,
    names: raw.names,
    id(kind, name) {
      const i = raw.names[kind].indexOf(name);
      if (i < 0) throw new Error(`no ${kind} named ${name}`);
      return i;
    },
  };
}

/** The worldgen version this model (and M0's sim) implements (§4.4: raised by hand). */
export const WORLDGEN_VERSION = 1;

/**
 * The worldgen data hash in GLOBALS (§4.4: "the hash of the worldgen-relevant tables of prototypes.bin").
 * Model decision: SHA-256 of prototypes.bin's PROTO_RESOURCE, PROTO_TILE and PROTO_WORLD section frames
 * (ids 6–8, consecutive in the file), from the first frame's header to the last frame's padding.
 */
export function worldgenDataHash(bin: Uint8Array): Uint8Array {
  const v = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const count = v.getUint32(48, true);
  let at = 56;
  let start = -1;
  let end = -1;
  for (let i = 0; i < count; i++) {
    const id = v.getUint32(at, true);
    const stored = v.getUint32(at + 12, true);
    const next = at + 16 + stored + ((8 - (stored % 8)) % 8);
    if (id === 6) start = at;
    if (id === 8) end = next;
    at = next;
  }
  if (start < 0 || end < 0) throw new Error('prototypes.bin lacks a worldgen table');
  return new Uint8Array(createHash('sha256').update(bin.subarray(start, end)).digest());
}
