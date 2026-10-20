// The golden start save (10 §15.10): a bounded map around the origin, stored entirely as modified chunks
// (so no worldgen runs and nothing is pristine), with a pond, two iron-ore patches, two chests and one
// player. Written with the generated section writers (World.frames) and the generated container writer.
import { createHash } from 'node:crypto';
import { MapSettingsCodec, WorldSettingsCodec } from '../../../src/shared/gen/abi.ts';
import { type SaveHeader, writeSaveContainer } from '../../../src/shared/gen/container.ts';
import { PROTOCOL_VERSION, SCHEMA_HASH } from '../../../src/shared/gen/schema.ts';
import type { Chunk, Player } from '../../../src/shared/gen/state.ts';
import { MiningMode } from '../../../src/shared/gen/state.ts';
import { emptyHand, insert, mainInv } from '../model/inventory.ts';
import type { Protos } from '../model/protos.ts';
import { lineage0 } from '../model/sim.ts';
import { chunkKey, NO_INV, SURFACE, tileIndex, World } from '../model/world.ts';
import { hex64 } from '../model/xxh64.ts';
import { worldgenDataHash } from './protos.ts';

/** The golden world's constants (README.md, "The start save"). */
export const START = {
  seed: 1945,
  /** 96 × 96 tiles, Factorio's centred map: x and y in [−48, 48) (model decision on the map's bounds). */
  width: 96,
  height: 96,
  /** Chunks −2 … 1 in x and y cover the map; their tiles outside it are the out-of-map tile. */
  chunks: [-2, -1, 0, 1],
  /** worldgen v0 (§4.4: raised by hand; the sim's constant must equal it to load this save). */
  worldgenVersion: 1,
  player0: { x: 38.5, y: -0.5 },
  chestA: { x2: 73, y2: -5 }, // tile (36, −3), serial 2
  chestB: { x2: 5, y2: -3 }, // tile (2, −2), serial 3
  /** The ore tile with 2 ore left, which the scenario depletes. */
  lowOre: { tx: 40, ty: -2, amount: 2 },
  savedAt: '2026-10-20T00:00:00Z',
  gameVersion: 'golden-m0',
} as const;

type TileName = 'deep-water' | 'dirt' | 'grass' | 'out-of-map' | 'sand' | 'water';

/** The terrain: a pure function of the tile, drawn so the renderer has every M0 tile and shoreline to show. */
export function terrain(tx: number, ty: number): TileName {
  const half = START.width / 2;
  if (tx < -half || tx >= half || ty < -half || ty >= half) return 'out-of-map';
  const pond = (tx - 33.5) ** 2 + (ty - 6.5) ** 2;
  if (pond <= 3) return 'deep-water';
  if (pond <= 10.5) return 'water';
  if (pond <= 17) return 'sand';
  const lake = (tx + 29.5) ** 2 / 1.6 + (ty + 21.5) ** 2;
  if (lake <= 9) return 'deep-water';
  if (lake <= 30) return 'water';
  if (lake <= 40) return 'sand';
  if (tx >= 43 && ty >= 3 && ty <= 10) return 'sand';
  if (tx >= 39 && tx <= 46 && ty >= -7 && ty <= -1) return 'dirt';
  if (ty === 1 && tx >= -8 && tx <= 36) return 'dirt';
  if ((tx * 7 + ty * 13 + 4096) % 29 === 0) return 'dirt';
  return 'grass';
}

/** Iron ore amounts: patch A east of the player, patch B by the spawn point. */
export function ore(tx: number, ty: number): number {
  if (tx === START.lowOre.tx && ty === START.lowOre.ty) return START.lowOre.amount;
  if (tx >= 40 && tx <= 45 && ty >= -6 && ty <= -2) return 60 + ((tx * 37 + ty * 101 + 1000) % 89) * 190;
  if (tx >= 1 && tx <= 2 && ty >= 1 && ty <= 2)
    return [500, 800, 1200, 2000][(tx - 1) * 2 + (ty - 1)] as number;
  return 0;
}

export interface StartSave {
  world: World;
  bytes: Uint8Array;
  header: SaveHeader;
  lineage: bigint;
}

/** snake_case record fields to the save header's camelCase JSON (sections.yaml `record:<name>`). */
function camel(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(camel);
  if (v !== null && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        camel(x),
      ]),
    );
  return v;
}

export function startWorld(protos: Protos, protosBin: Uint8Array): World {
  const tile = (n: TileName) => protos.id('tile', n);
  const iron = protos.id('resource', 'iron-ore-patch');
  const w = new World(protos, {
    tick: 0,
    seed: START.seed,
    map: { ...MapSettingsCodec.defaults(), width: START.width, height: START.height },
    // Model decision: the climate compass is off (θ = 14 °C, sunlight 1, §5.18), so no noise is needed.
    world: { ...WorldSettingsCodec.defaults(), climate_compass: false },
    game: { trimmed_collision: true },
    surfaces: [{ index: SURFACE }],
    worldgen_version: START.worldgenVersion,
    worldgen_data_hash: { bytes: worldgenDataHash(protosBin) },
    next_serial: 1,
    last_system_seq: 0,
  });
  for (const cx of START.chunks)
    for (const cy of START.chunks) {
      const tiles = new Array<number>(1024).fill(0);
      const resources: Chunk['resources'] = [];
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const tx = cx * 32 + x;
          const ty = cy * 32 + y;
          tiles[tileIndex(tx, ty)] = tile(terrain(tx, ty));
          const amount = ore(tx, ty);
          if (amount > 0) resources.push({ tile: tileIndex(tx, ty), resource: iron, amount });
        }
      resources.sort((a, b) => a.tile - b.tile);
      const key = chunkKey(cx, cy);
      w.chunks.set(key, {
        rec: {
          surface: SURFACE,
          key,
          tiles,
          hidden_tiles: [],
          resources,
          trees: [],
          objects: [],
          ground_items: [],
          leaf_timer: 0,
          rule_version: 0,
        },
        view: { tiles: 1, entities: 1, objects: 1, resources: 1 },
      });
      // GENERATED keeps κ, θ and sunlight (§4.4). Model decision: κ is the mean over the 1,024 tiles of
      // kappa_per_s (0 for a tile without one), summed in tile order; θ = 14 and s = 1 without the compass.
      let kappa = 0;
      for (const t of tiles) kappa += (protos.tile[t] as { kappa_per_s: number }).kappa_per_s;
      w.generated.push({ surface: SURFACE, key, kappa: kappa / 1024, theta: 14, sunlight: 1 });
    }
  w.generated.sort((a, b) => a.surface - b.surface || a.key - b.key);

  // Player 0, its character serial 1, then the two chests, serials 2 and 3.
  const p0: Player = {
    index: 0,
    online: true,
    character: w.nextSerial(),
    input_gen: 0,
    last_seq: 0,
    creation_ring: [],
    inventory_version: 0,
    main: NO_INV,
    hand: emptyHand(),
    surface: SURFACE,
    x: START.player0.x,
    y: START.player0.y,
    walking: false,
    walking_dir: 8,
    mining: { mode: MiningMode.none, serial: 0, pos: { x: 0, y: 0 }, progress: 0 },
    picking: false,
    crafting_queue: [],
    auto_sort: true,
    pick_ghost_cursor: false,
    hand_crafted: 0,
    last_action_tick: 0,
  };
  p0.main = w.heap.alloc(w.mainSize());
  w.players = [p0];
  const chest = protos.id('entity', 'iron-chest');
  const slots = (protos.entity[chest] as { inventory_slots: number }).inventory_slots;
  const key = (name: string) => protos.id('item', name) * 8;
  const main = mainInv(w, p0);
  insert(w, main, key('iron-chest'), 2);
  insert(w, main, key('iron-ore'), 10);
  insert(w, main, key('iron-plate'), 24);
  for (const [pos, contents] of [
    [
      START.chestA,
      [
        ['iron-plate', 30],
        ['iron-ore', 20],
      ],
    ],
    [START.chestB, [['iron-plate', 40]]],
  ] as const) {
    const e = w.allocEntity(
      {
        proto: chest,
        kind: 1,
        surface: SURFACE,
        dir: 0,
        flip: 0,
        quality: 0,
        built_by: 16,
        x2: pos.x2,
        y2: pos.y2,
        flags: 0,
        serial: w.nextSerial(),
        built_tick: 0,
      },
      slots,
    );
    const inv = { ref: w.container(e).inv, size: slots, bar: slots, origin: -1 };
    for (const [item, n] of contents) insert(w, inv, key(item), n);
  }
  return w;
}

export function startSave(protos: Protos, protosBin: Uint8Array): StartSave {
  const world = startWorld(protos, protosBin);
  const lineage = lineage0(START.seed);
  const n = protos.names;
  const header: SaveHeader = {
    buildHash: '0'.repeat(64),
    formatVersion: 2,
    gameVersion: START.gameVersion,
    lineage: hex64(lineage),
    mapSettings: camel(world.globals.map) as SaveHeader['mapSettings'],
    nameTables: {
      item: n.item,
      fluid: n.fluid,
      recipe: n.recipe,
      entity: n.entity,
      technology: n.technology,
      resource: n.resource,
      tile: n.tile,
      world_object: n.world_object,
      signal: n.signal,
    },
    playTimeTicks: 0,
    protocolVersion: PROTOCOL_VERSION,
    prototypesHash: createHash('sha256').update(protosBin).digest('hex'),
    roster: [{ index: 0, name: 'Player 0', color: '#2b2723' }],
    savedAt: START.savedAt,
    schemaHash: SCHEMA_HASH,
    seed: START.seed,
    thumbnailSection: 0,
    tick: 0,
    worldSettings: camel(world.globals.world) as SaveHeader['worldSettings'],
  };
  return { world, bytes: writeSaveContainer(header, world.frames()), header, lineage };
}
