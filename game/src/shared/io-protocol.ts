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
  /**
   * The stored version (C3-r1 1, 9): every write makes a new one, published atomically. A closure log's base
   * names its version (file and SHA-256), so it reads exactly the bytes the log starts from.
   */
  file?: string;
  manifest?: CheckpointManifest;
}

/** One exact stored version of a save (§8.5: a closure log's base, pinned while a sim worker uses it). */
export interface SaveVersion {
  name: string;
  file: string;
  /** SHA-256 of the container (hex). */
  sha256: string;
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
      /**
       * (C3-r1 9) The stored version becomes `holder`'s closure-log base: pinned, so overwriting the save keeps
       * it; and the holder's previous base (`unpin`) is let go, both only once the write is committed.
       */
      pin?: { holder: string; unpin: string | null };
    }
  /**
   * Reads a save: its validated header and its sections decompressed, as `sim_load` takes them. With `file`
   * and `sha256`, exactly that version, checked against that hash (a pinned base).
   */
  | { t: 'read'; id: number; name: string; file?: string; sha256?: string }
  /** As `read`, for container bytes that are not stored (an imported file, a bug bundle's save). */
  | { t: 'unpack'; id: number; bytes: ArrayBuffer }
  | { t: 'list'; id: number }
  | { t: 'delete'; id: number; name: string }
  /** The container's bytes, for an export (§8.2 "Export and import"); `file`/`sha256` as in `read`. */
  | { t: 'export'; id: number; name: string; file?: string; sha256?: string }
  /** Checks a container (format, header, frames) and stores it under `name`. */
  | { t: 'import'; id: number; name: string; bytes: ArrayBuffer }
  /** `navigator.storage.estimate()` and `persist()` (§8.2 "Persistence and quota"). */
  | { t: 'estimate'; id: number }
  | { t: 'persist'; id: number }
  /** A bug bundle's files (§8.5), kept under `reports/<name>/` (OPFS only). */
  | { t: 'report'; id: number; name: string; files: { name: string; bytes: ArrayBuffer }[] }
  /** (C3-r1 9) Pins a stored version for `holder` (a world loaded from it), or lets it go. */
  | { t: 'pin'; id: number; version: SaveVersion; holder: string }
  | { t: 'unpin'; id: number; file: string; holder: string }
  /** Lets go of every pin of `holder` (its sim worker was retired). */
  | { t: 'unpinAll'; id: number; holder: string }
  /**
   * (C3-r1 14) A bug bundle (§8.5) assembled here, off the main thread: the base's container (a stored version
   * read and checked, or the world's start written as a container), the closure log and the digest ring, and a
   * report (`meta`, UTF-8 JSON). `store`: kept under `reports/<name>/`; `want`: the bytes come back.
   */
  | {
      t: 'bundle';
      id: number;
      name: string;
      base: BundleBase;
      log: ArrayBuffer;
      digests: ArrayBuffer;
      meta: ArrayBuffer;
      store: boolean;
      want: boolean;
    };

/** A bundle's base for the IO worker: a stored version, or the world's start (`sim_save`'s output) and header. */
export type BundleBase =
  | { kind: 'save'; version: SaveVersion }
  | { kind: 'start'; save: ArrayBuffer; header: SaveHeader };

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
  | { t: 'pinned'; id: number }
  /** A bundle: whether it was stored, and its files when wanted (the base container, log, digests). */
  | {
      t: 'bundled';
      id: number;
      stored: boolean;
      save: ArrayBuffer | null;
      log: ArrayBuffer | null;
      digests: ArrayBuffer | null;
    }
  /** `notOwner`: refused because another tab owns the saves (§8.2), so nothing was written. */
  | { t: 'failed'; id: number; message: string; notOwner?: boolean };

/**
 * The main thread's own channel to the IO worker: requests, the ports of sim workers, and the saves' ownership
 * (§8.2 "One tab at a time"; C3-r1 10): `takeover` asks the tab that owns the saves to let go (*Take over*);
 * `release` is this tab's answer to `takeover` after its last save.
 */
export type MainToIo = IoRequest | { t: 'port'; port: MessagePort } | { t: 'takeover' } | { t: 'release' };
export type IoToMain =
  | IoReply
  | { t: 'ready'; store: 'opfs' | 'idb' }
  /** Whether this tab owns the saves: at start, after a takeover, or when another tab took them. */
  | { t: 'owner'; owner: boolean; reason?: string }
  /** Another tab asks for the saves: save now, then send `release` (the tab drops to a read-only notice). */
  | { t: 'takeover' }
  | { t: 'log'; level: 'info' | 'warn' | 'error'; msg: string };

/** The autosave slots' names (Factorio's, §8.4). */
export const autosaveName = (slot: number): string => `_autosave${slot}`;
export const CHECKPOINT_NAME = '_checkpoint';
