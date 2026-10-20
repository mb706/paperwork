// The fake sim's view of its prototype build (10 §15.2): prototypes.json for names, ids and the set-name
// tables, and the same build's prototypes.bin for the numbers the rules use (reach, speeds, mining times,
// stack sizes) and the working-sound table (§15.6). It names everything it places by prototype name and
// resolves the ids of whatever build it is given (the dev server serves the M1 build at /data/fake/).
import {
  type EntityRow,
  type ItemRow,
  type PrototypesJson,
  type ResourceRow,
  readPrototypesBin,
  type TileRow,
} from '../../shared/gen/protos.ts';
import { SoundIdCodec } from '../../shared/gen/types.ts';

/** The character's numbers (prototypes.bin's character row; I §3.1, §5.1). */
export interface CharacterNumbers {
  runningSpeed: number;
  reach: number;
  build: number;
  resourceReach: number;
  miningSpeed: number;
  craftingSpeed: number;
  mainSlots: number;
  /** The collision box around the character's position, tiles. */
  box: [number, number, number, number];
}

export class FakeProtos {
  readonly json: PrototypesJson;
  private readonly ids = new Map<string, number>();
  private readonly entityRows: EntityRow[] | null;
  private readonly tileRows: TileRow[] | null;
  private readonly itemRows: ItemRow[] | null;
  private readonly resourceRows: ResourceRow[] | null;
  /** Whether the build carries a working-sound table (prototypes.json `sounds`). */
  readonly hasSounds: boolean;
  readonly characterId: number;
  readonly char: CharacterNumbers;

  /** `bin` is the same build's prototypes.bin; without it the numbers fall back to Factorio's defaults. */
  constructor(json: PrototypesJson, bin: Uint8Array | null = null) {
    this.json = json;
    const rows = bin ? readPrototypesBin(bin, undefined, []) : null;
    this.entityRows = rows?.entity ?? null;
    this.tileRows = rows?.tile ?? null;
    this.itemRows = rows?.item ?? null;
    this.resourceRows = rows?.resource ?? null;
    this.hasSounds =
      json.sounds.length > 0 && (rows?.entity.some((e) => e.working_sound !== SoundIdCodec.NONE) ?? false);
    const add = (kind: string, list: readonly { name: string }[]) => {
      list.forEach((x, i) => {
        this.ids.set(`${kind}:${x.name}`, i);
      });
    };
    add('item', json.item);
    add('recipe', json.recipe);
    add('entity', json.entity);
    add('resource', json.resource);
    add('tile', json.tile);
    add('world', json.world);
    this.characterId = json.entity.findIndex((e) => e.type === 'character');
    if (this.characterId < 0) throw new Error('the build has no character');
    const c = this.entityRows?.[this.characterId];
    const box = json.entity[this.characterId]?.collisionBox ?? [-0.2, -0.2, 0.2, 0.2];
    this.char = {
      runningSpeed: c?.running_speed || 0.15,
      reach: c?.reach_distance || 10,
      build: c?.build_distance || 10,
      resourceReach: c?.resource_reach_distance || 2.7,
      miningSpeed: c?.mining_speed || 0.5,
      craftingSpeed: c?.crafting_speed || 1,
      mainSlots: c?.inventory_slots || 80,
      box: [box[0] ?? -0.2, box[1] ?? -0.2, box[2] ?? 0.2, box[3] ?? 0.2],
    };
  }

  /** A prototype's id by name, or null when this build lacks it. */
  id(kind: 'item' | 'recipe' | 'entity' | 'resource' | 'tile' | 'world', name: string): number | null {
    return this.ids.get(`${kind}:${name}`) ?? null;
  }

  /** An item's key (§4.3: (id << 3) | quality), standard quality. */
  key(name: string): number | null {
    const id = this.id('item', name);
    return id === null ? null : id * 8;
  }

  /** An item's index in the icon table (`EntityView.alt_icon`, §15.7), or none. */
  icon(item: string): number {
    const i = this.json.icons.indexOf(`item/${item}`);
    return i < 0 ? 0xffff : i;
  }

  /** The engine's character: the entity of type `character` (C1b decision 5). */
  character(): number {
    return this.characterId;
  }

  /** The working sound of an entity prototype (§15.6, prototypes.bin `working_sound`), or null for none. */
  sound(entity: number): number | null {
    if (!this.hasSounds) return null;
    const s = this.entityRows?.[entity]?.working_sound;
    return s === undefined || s === SoundIdCodec.NONE || s >= this.json.sounds.length ? null : s;
  }

  /** A crafting machine's speed (§5.3), 1 when unknown. */
  craftingSpeed(entity: number): number {
    const v = this.entityRows?.[entity]?.crafting_speed ?? 0;
    return v > 0 ? v : 1;
  }

  /** An entity's hand-mining time (s at mining speed 1), 0 when it is not minable. */
  miningTime(entity: number): number {
    const v = this.entityRows?.[entity]?.mining_time;
    if (v !== undefined) return v;
    return this.json.entity[entity]?.item !== null ? 0.2 : 0;
  }

  /** A tile's walking speed (0: not walkable). */
  walkingSpeed(tile: number): number {
    const r = this.tileRows?.[tile];
    if (r) return r.walkable ? r.walking_speed : 0;
    return this.json.tile[tile]?.walkable ? 1 : 0;
  }

  buildable(tile: number): boolean {
    return this.json.tile[tile]?.buildable ?? false;
  }

  /** A resource's hand-mining time and its item yield's id, or null when it cannot be mined by hand. */
  resource(id: number): { miningTime: number; yieldItem: number } | null {
    const j = this.json.resource[id];
    if (j?.kind !== 'solid' || j.yields?.kind !== 'item') return null;
    const r = this.resourceRows?.[id];
    return { miningTime: r?.mining_time ?? j.miningTime ?? 1, yieldItem: j.yields.id };
  }

  /** The entity an item places, or null. */
  places(itemKey: number): number | null {
    const v = this.itemRows?.[itemKey >> 3]?.places_entity ?? this.json.item[itemKey >> 3]?.places ?? null;
    return v === null || v === 0xffff ? null : v;
  }

  /** An item key's stack size. */
  stack(key: number): number {
    return this.itemRows?.[key >> 3]?.stack_size ?? this.json.item[key >> 3]?.stack ?? 1;
  }

  /** Whether an item key names an item of this build at standard quality (the fake has no quality). */
  validKey(key: number): boolean {
    return (key & 7) === 0 && key >> 3 < this.json.item.length;
  }
}
