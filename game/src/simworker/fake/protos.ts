// The fake sim's view of a prototypes.json (10 §15.2): it names everything it places by prototype name and
// resolves the ids of whatever build it is given (the dev server serves the M1 build at /data/fake/).
import { type PrototypesJson, readPrototypesBin } from '../../shared/gen/protos.ts';
import { SoundIdCodec } from '../../shared/gen/types.ts';

export class FakeProtos {
  readonly json: PrototypesJson;
  private readonly ids = new Map<string, number>();
  /** Entity id → its working sound (prototypes.bin's `working_sound` column, §15.6), when the build has one. */
  private readonly sounds: number[] | null;
  /** Entity id → its crafting speed (prototypes.bin), when the bin was given. */
  private readonly speeds: number[] | null;

  /** `bin` is the same build's prototypes.bin; without it (or without sounds in it) sound ids are stand-ins. */
  constructor(json: PrototypesJson, bin: Uint8Array | null = null) {
    this.json = json;
    const rows = bin ? readPrototypesBin(bin, undefined, []).entity : null;
    const table = rows ? rows.map((e) => e.working_sound) : null;
    this.sounds = table?.some((s) => s !== SoundIdCodec.NONE) ? table : null;
    this.speeds = rows ? rows.map((e) => e.crafting_speed) : null;
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
    const i = this.json.entity.findIndex((e) => e.type === 'character');
    if (i < 0) throw new Error('the build has no character');
    return i;
  }

  /**
   * The working sound of an entity prototype (§15.6), or null for none. Until the data stage reads sounds.yaml
   * (C1b decision 14) no build has one, and the fake uses the entity's prototype id as a stand-in sound id for
   * its machines, radars and belts, so that `AUDIO_WORKING` is exercised all the same.
   */
  sound(entity: number, standIn: boolean): number | null {
    if (this.sounds === null) return standIn ? entity : null;
    const s = this.sounds[entity];
    return s === undefined || s === SoundIdCodec.NONE ? null : s;
  }

  /** A crafting machine's speed (§5.3), 1 when unknown. */
  craftingSpeed(entity: number): number {
    const v = this.speeds?.[entity] ?? 0;
    return v > 0 ? v : 1;
  }

  /** Whether the sound ids are the build's own (true) or stand-ins (false). */
  get realSounds(): boolean {
    return this.sounds !== null;
  }

  stack(key: number): number {
    return this.json.item[key >> 3]?.stack ?? 100;
  }
}
