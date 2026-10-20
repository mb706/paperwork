// Checks that every reference a fake packet makes resolves in the fake's own build (GATE-r1 finding 12):
// prototype ids, item keys, icons, recipes, tiles, resources, world objects, tree species and sound ids,
// and serials against the entities the packets themselves have listed. A contract-correct consumer resolves
// all of them; the fake must never make one fail.
import type { EventPayload } from '../../src/shared/gen/events.ts';
import {
  type AudioWorking,
  type BeltGeom,
  type BeltItems,
  type ChunkEntities,
  type ChunkObjects,
  type ChunkResources,
  type ChunkTiles,
  type Dyn,
  heldChunks,
  type InserterHand,
  type Mover,
  type ViewRequest,
} from '../../src/shared/gen/packet.ts';
import {
  type Character,
  CharacterCodec,
  type EntityPanel,
  EntityPanelCodec,
  type Hover,
  HoverCodec,
  type Inventory,
  InventoryCodec,
  ProjectionKind,
  type Stats,
  StatsCodec,
  type UiRecord,
} from '../../src/shared/gen/projections.ts';
import type { PrototypesJson } from '../../src/shared/gen/protos.ts';
import { decodeAll } from '../helpers/packets.ts';

const NONE = 0xffff;

/** What the main thread holds after each packet, as far as references need it. */
export class ReferenceChecker {
  readonly problems: string[] = [];
  private readonly p: PrototypesJson;
  private readonly character: number;
  /** chunk key → the serials its last CHUNK_ENTITIES listed. */
  private readonly chunkSerials = new Map<number, Set<number>>();
  private readonly characters = new Set<number>();
  private readonly geometry = new Set<string>();
  /** How many references of each kind were checked. */
  readonly checked = new Map<string, number>();
  /** The view requests sent, by view_seq: a packet's held set is its view's (§15.4). */
  readonly views = new Map<number, ViewRequest>();
  private held: { cx0: number; cy0: number; cx1: number; cy1: number } | null = null;

  constructor(p: PrototypesJson) {
    this.p = p;
    this.character = p.entity.findIndex((e) => e.type === 'character');
  }

  private ok(kind: string, good: boolean, what: () => string): void {
    this.checked.set(kind, (this.checked.get(kind) ?? 0) + 1);
    if (!good && this.problems.length < 50) this.problems.push(`${kind}: ${what()}`);
  }

  private item(kind: string, key: number, noneAllowed = true): void {
    if (key === NONE && noneAllowed) return;
    this.ok(kind, (key & 7) === 0 && key >> 3 < this.p.item.length, () => `item key ${key}`);
  }

  private entityProto(kind: string, proto: number): void {
    this.ok(kind, proto < this.p.entity.length && proto !== this.character, () => `entity proto ${proto}`);
  }

  private live(): Set<number> {
    const s = new Set<number>();
    for (const x of this.chunkSerials.values()) for (const v of x) s.add(v);
    return s;
  }

  private isHeld(key: number): boolean {
    const h = this.held;
    if (!h) return false;
    const cx = (key >>> 16) - 32768;
    const cy = (key & 0xffff) - 32768;
    return cx >= h.cx0 && cx <= h.cx1 && cy >= h.cy0 && cy <= h.cy1;
  }

  check(bytes: Uint8Array): void {
    const p = decodeAll(bytes);
    const tick = p.header.tick;
    // Chunks that left the held set are dropped, as the main thread drops them.
    const v = this.views.get(p.header.view_seq);
    this.held = v ? heldChunks(v) : null;
    for (const k of [...this.chunkSerials.keys()]) if (!this.isHeld(k)) this.chunkSerials.delete(k);
    for (const s of p.sections) {
      if (s.name === 'CHUNK_TILES')
        for (const r of s.records as ChunkTiles[])
          for (const t of r.tiles) this.ok('tile', t < this.p.tile.length, () => `tile ${t} at ${tick}`);
      if (s.name === 'CHUNK_ENTITIES')
        for (const r of s.records as ChunkEntities[]) {
          for (const e of r.entities) {
            this.entityProto('entity', e.proto);
            this.ok(
              'alt_icon',
              e.alt_icon === NONE || e.alt_icon < this.p.icons.length,
              () => `icon ${e.alt_icon}`,
            );
            this.ok('entity flags', e.flags <= 2, () => `flags ${e.flags}`);
          }
          this.chunkSerials.set(r.chunk_key, new Set(r.entities.map((e) => e.serial)));
        }
      if (s.name === 'CHUNK_OBJECTS')
        for (const r of s.records as ChunkObjects[])
          for (const o of r.objects) {
            if (o.kind === 0) {
              this.ok('tree species', o.id < this.p.treeSpecies.length, () => `species ${o.id}`);
              this.ok('tree stage', o.variant <= 4, () => `leaf stages ${o.variant}`);
            } else if (o.kind === 1)
              this.ok(
                'world object',
                o.id < this.p.world.length && this.p.world[o.id]?.kind !== 'tree',
                () => `world object ${o.id}`,
              );
            else this.ok('object kind', false, () => `object kind ${o.kind}`);
          }
      if (s.name === 'CHUNK_RESOURCES')
        for (const r of s.records as ChunkResources[])
          for (const x of r.resources) {
            this.ok('resource', x.resource < this.p.resource.length, () => `resource ${x.resource}`);
            this.ok('band', x.band <= 7 && x.tile < 1024, () => `band ${x.band} tile ${x.tile}`);
          }
      if (s.name === 'BELT_GEOM')
        for (const r of s.records as BeltGeom[]) this.geometry.add(`${r.line_id}/${r.geom_gen}`);
      if (s.name === 'BELT_RETIRE')
        for (const r of s.records as { line_id: number; geom_gen: number }[])
          this.ok('retire', this.geometry.delete(`${r.line_id}/${r.geom_gen}`), () => `retired ${r.line_id}`);
    }
    // Snapshot sections reference what the main thread holds after the per-chunk records above.
    const live = this.live();
    for (const s of p.sections) {
      if (s.name === 'DYN')
        for (const r of s.records as Dyn[]) {
          this.entityProto('dyn', r.proto);
          this.ok('dyn serial', live.has(r.serial), () => `DYN of serial ${r.serial} at ${tick}`);
        }
      if (s.name === 'HANDS')
        for (const r of s.records as InserterHand[]) {
          this.entityProto('hand', r.proto);
          this.item('hand item', r.held);
          this.ok('hand serial', live.has(r.serial), () => `hand of serial ${r.serial}`);
        }
      if (s.name === 'BELT_ITEMS')
        for (const r of s.records as BeltItems[]) {
          this.ok(
            'belt line',
            this.geometry.has(`${r.line_id}/${r.geom_gen}`),
            () => `items on ${r.line_id}`,
          );
          for (const k of r.keys) this.item('belt item', k, false);
        }
      if (s.name === 'MOVERS')
        for (const r of s.records as Mover[]) {
          this.ok('mover proto', r.proto === this.character, () => `mover proto ${r.proto}`);
          this.characters.add(r.serial);
        }
      if (s.name === 'AUDIO_WORKING')
        for (const r of s.records as AudioWorking[])
          this.ok(
            'sound',
            r.sound < this.p.sounds.length,
            () => `sound ${r.sound} of ${this.p.sounds.length}`,
          );
      if (s.name === 'EVENTS') {
        // Events are history: an entity built and mined again between two packets is listed by neither.
        const mined = new Set<number>();
        for (const e of s.records as { payload: EventPayload }[])
          if (e.payload.type === 'entity_mined') mined.add(e.payload.serial);
        for (const e of s.records as { payload: EventPayload }[]) {
          const x = e.payload;
          if (x.type === 'flying_text') this.item('flying text item', x.item, false);
          else if (x.type === 'entity_built') {
            this.entityProto('built proto', x.proto);
            const key = (((x.pos.x2 >> 1) >> 5) + 32768) * 65536 + (((x.pos.y2 >> 1) >> 5) + 32768);
            if (this.isHeld(key))
              this.ok(
                'built serial',
                live.has(x.serial) || mined.has(x.serial),
                () => `built ${x.serial} not listed at ${tick}`,
              );
          } else if (x.type === 'entity_mined') {
            this.entityProto('mined proto', x.proto);
            this.ok('mined serial', !live.has(x.serial), () => `mined ${x.serial} still listed at ${tick}`);
          } else if (x.type === 'item_crafted')
            this.ok('crafted recipe', x.recipe < this.p.recipe.length, () => `recipe ${x.recipe}`);
          else if (x.type === 'action_failed' && x.serial !== 0)
            this.ok(
              'refusal serial',
              live.has(x.serial) || this.characters.has(x.serial),
              () => `refusal names ${x.serial}`,
            );
        }
      }
      if (s.name === 'UI') for (const r of s.records as UiRecord[]) if (r.status === 0) this.ui(r, live);
    }
  }

  private ui(r: UiRecord, live: Set<number>): void {
    if (r.kind === ProjectionKind.character) {
      const c: Character = CharacterCodec.decode(r.body);
      for (const s of c.main) if (s.count > 0) this.item('character slot', s.key, false);
      if (c.hand_count > 0) this.item('hand', c.hand_key, false);
      for (const q of c.queue)
        this.ok('queue recipe', q.recipe < this.p.recipe.length, () => `recipe ${q.recipe}`);
      this.characters.add(c.serial);
    } else if (r.kind === ProjectionKind.inventory) {
      const v: Inventory = InventoryCodec.decode(r.body);
      for (const s of v.view.slots) if (s.count > 0) this.item('inventory slot', s.key, false);
      this.ok('inventory serial', live.has(v.serial), () => `inventory of ${v.serial}`);
    } else if (r.kind === ProjectionKind.hover) {
      const h: Hover = HoverCodec.decode(r.body);
      this.entityProto('hover proto', h.proto);
      for (const x of h.contents) this.item('hover item', x.key, false);
    } else if (r.kind === ProjectionKind.entity_panel) {
      const e: EntityPanel = EntityPanelCodec.decode(r.body);
      this.entityProto('panel proto', e.proto);
      this.ok(
        'panel recipe',
        e.recipe === NONE || e.recipe < this.p.recipe.length,
        () => `recipe ${e.recipe}`,
      );
      for (const v of e.inventories)
        for (const s of v.slots) if (s.count > 0) this.item('panel slot', s.key, false);
    } else if (r.kind === ProjectionKind.stats) {
      const st: Stats = StatsCodec.decode(r.body);
      for (const x of st.entries) {
        this.ok('stat kind', Math.floor(x.key / 2 ** 24) === 1, () => `stat key ${x.key}`);
        this.item('stat item', x.key % 2 ** 24, false);
      }
    }
  }
}
