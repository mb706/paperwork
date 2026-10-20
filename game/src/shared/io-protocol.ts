// The IO worker's messages (10 §3.1, §8.2, §8.4, §8.6; C3). One IO worker serves the page: the main thread
// talks to it on the worker's own channel, and each sim worker on a MessagePort the main thread hands to both
// (`boot.ioPort`; the main thread sends the IO worker the other end in `port`). Every request carries an id that
// its answer echoes. The IO worker compresses (fflate, deflate level 6), hashes (WebCrypto SHA-256) and stores
// (OPFS where available, otherwise IndexedDB) the §8.1 container; the sim worker only copies sections out of
// linear memory.
import type { SaveHeader } from './gen/container.ts';

export type SaveReason = 'manual' | 'auto' | 'exit' | 'checkpoint';

/** A checkpoint's manifest (§8.6): kept beside the container, never in it (it holds the container's SHA-256). */
export interface CheckpointManifest {
  id: string;
  tick: number;
  buildHash: string;
  protocolVersion: number;
  schemaHash: string;
  prototypesHash: string;
  /** The rolling digest at the tick (16 hex digits). */
  lineage: string;
  /** The full state hash (§4.8, 16 hex digits). */
  stateHash: string;
  bytes: number;
  chunkSize: number;
  chunkCount: number;
  /** SHA-256 of the compressed container. */
  sha256: string;
}

/** What the IO worker keeps about a stored save (IndexedDB `saves`, 10 §8.2). */
export interface SaveInfo {
  name: string;
  reason: SaveReason;
  /** The container's size and SHA-256 (§8.2 "Integrity"). */
  bytes: number;
  sha256: string;
  tick: number;
  seed: number;
  playTimeTicks: number;
  /** The wall-clock save time (UTC, ISO 8601). */
  savedAt: string;
  prototypesHash: string;
  /** Where the bytes live. */
  store: 'opfs' | 'idb';
  manifest?: CheckpointManifest;
}

export type IoRequest =
  /**
   * Stores `sim_save`'s output (§15.8 SaveOutput: the sections, codec raw, then the lineage) as a container
   * with `header` (its `lineage` is replaced by the output's). `name` null: an autosave or exit save picks the
   * oldest of `slots` rotating `_autosave<n>` slots (§8.4); a checkpoint is `_checkpoint`.
   */
  | {
      t: 'store';
      id: number;
      name: string | null;
      reason: SaveReason;
      save: ArrayBuffer;
      header: SaveHeader;
      slots?: number;
      /** The full state hash at the tick (16 hex digits), for a checkpoint's manifest. */
      stateHash?: string;
    }
  /** Reads a save: its validated header and its sections decompressed, as `sim_load` takes them. */
  | { t: 'read'; id: number; name: string }
  /** As `read`, for container bytes that are not stored (an imported file, a bug bundle's save). */
  | { t: 'unpack'; id: number; bytes: ArrayBuffer }
  | { t: 'list'; id: number }
  | { t: 'delete'; id: number; name: string }
  /** The container's bytes, for an export (§8.2 "Export and import"). */
  | { t: 'export'; id: number; name: string }
  /** Checks a container (format, header, frames) and stores it under `name`. */
  | { t: 'import'; id: number; name: string; bytes: ArrayBuffer }
  /** `navigator.storage.estimate()` and `persist()` (§8.2 "Persistence and quota"). */
  | { t: 'estimate'; id: number }
  | { t: 'persist'; id: number }
  /** A bug bundle's files (§8.5), kept under `reports/<name>/` (OPFS only). */
  | { t: 'report'; id: number; name: string; files: { name: string; bytes: ArrayBuffer }[] };

export type IoReply =
  | { t: 'stored'; id: number; info: SaveInfo; ms: number }
  | { t: 'read'; id: number; info: SaveInfo; header: SaveHeader; sections: ArrayBuffer }
  | { t: 'list'; id: number; saves: SaveInfo[] }
  | { t: 'deleted'; id: number }
  | { t: 'exported'; id: number; bytes: ArrayBuffer }
  | { t: 'imported'; id: number; info: SaveInfo }
  | { t: 'estimate'; id: number; usage: number; quota: number; persisted: boolean }
  | { t: 'persisted'; id: number; persisted: boolean }
  | { t: 'reported'; id: number; stored: boolean }
  | { t: 'failed'; id: number; message: string };

/** The main thread's own channel to the IO worker: requests, and the ports of sim workers. */
export type MainToIo = IoRequest | { t: 'port'; port: MessagePort };
export type IoToMain =
  | IoReply
  | { t: 'ready'; store: 'opfs' | 'idb' }
  | { t: 'log'; level: 'info' | 'warn' | 'error'; msg: string };

/** The autosave slots' names (Factorio's, §8.4). */
export const autosaveName = (slot: number): string => `_autosave${slot}`;
export const CHECKPOINT_NAME = '_checkpoint';
