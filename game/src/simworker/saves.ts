// What a save's container header holds besides the state (10 §8.1 "The header", S12): the build's identity, the
// world's settings (copies for the load screen; the originals are in GLOBALS), the name tables (§8.3), the
// roster and the digest lineage. The shell assembles it from what it knows (the build manifest, the world's
// `new_world` settings or the loaded save's header, prototypes.bin's names); the IO worker writes the container.
import { GameSettingsCodec, type NewWorld } from '../shared/gen/abi.ts';
import type { SaveHeader } from '../shared/gen/container.ts';
import { PROTOCOL_VERSION, SCHEMA_HASH } from '../shared/gen/schema.ts';
import type { BuildManifest } from '../shared/protocol.ts';
import type { NameTables } from './remap.ts';

/** The world's settings and identity, as the header copies them. */
export interface WorldInfo {
  seed: number;
  mapSettings: SaveHeader['mapSettings'];
  worldSettings: SaveHeader['worldSettings'];
  roster: SaveHeader['roster'];
  /** Play time at `tickBase` (a loaded save's `playTimeTicks`). */
  playTimeBase: number;
  tickBase: number;
}

const camel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const snake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** A record's JSON form (sections.yaml `record:<name>`: its fields in camelCase), or back. */
function rekey(v: unknown, f: (k: string) => string): unknown {
  if (Array.isArray(v)) return v.map((x) => rekey(x, f));
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[f(k)] = rekey(x, f);
    return out;
  }
  return v;
}

export function worldFromNew(s: NewWorld, tick = 0): WorldInfo {
  return {
    seed: s.seed,
    mapSettings: rekey(s.map, camel) as SaveHeader['mapSettings'],
    worldSettings: rekey(s.world, camel) as SaveHeader['worldSettings'],
    roster: [],
    playTimeBase: 0,
    tickBase: tick,
  };
}

export function worldFromHeader(h: SaveHeader): WorldInfo {
  return {
    seed: h.seed,
    mapSettings: h.mapSettings,
    worldSettings: h.worldSettings,
    roster: h.roster,
    playTimeBase: h.playTimeTicks,
    tickBase: h.tick,
  };
}

/** A loaded world's `new_world` record (`gen_init`'s tail, §15.9): its seed and settings from the header. */
export function newWorldOf(w: WorldInfo): NewWorld {
  return {
    seed: w.seed,
    map: rekey(w.mapSettings, snake) as NewWorld['map'],
    world: rekey(w.worldSettings, snake) as NewWorld['world'],
    game: GameSettingsCodec.defaults(),
  };
}

const hex16 = (r: bigint): string => r.toString(16).padStart(16, '0');

/** The container header of a save of this world at `tick` with lineage `r`. */
export function saveHeader(
  w: WorldInfo,
  build: BuildManifest,
  prototypesHash: string,
  names: NameTables,
  tick: number,
  r: bigint,
  savedAt: string,
): SaveHeader {
  const buildHash = /^[0-9a-f]{64}$/.test(build.buildHash) ? build.buildHash : '0'.repeat(64);
  return {
    buildHash,
    formatVersion: 2,
    gameVersion: typeof build.gameVersion === 'string' ? build.gameVersion : build.build || 'dev',
    lineage: hex16(r),
    mapSettings: w.mapSettings,
    nameTables: {
      item: [...names.item],
      fluid: [...names.fluid],
      recipe: [...names.recipe],
      entity: [...names.entity],
      technology: [...names.technology],
      resource: [...names.resource],
      tile: [...names.tile],
      world_object: [...names.world_object],
      signal: [...names.signal],
    },
    playTimeTicks: w.playTimeBase + Math.max(0, tick - w.tickBase),
    protocolVersion: PROTOCOL_VERSION,
    prototypesHash,
    roster: w.roster,
    savedAt,
    schemaHash: SCHEMA_HASH,
    seed: w.seed,
    thumbnailSection: 0,
    tick,
    worldSettings: w.worldSettings,
  };
}
