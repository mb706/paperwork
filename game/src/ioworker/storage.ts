// Where the IO worker keeps saves (10 §8.2 "Storage"): save blobs in the Origin Private File System where
// available, written with a sync access handle in the worker; otherwise in IndexedDB. IndexedDB (idb 8.0.3)
// holds database `game`, version 1, with the stores of §8.2: `saves` (name → metadata, plus the blob when OPFS
// is missing), `settings`, `blueprints`, `runHistory`, `bench` and `rooms`. The IO worker creates them all, so
// every package finds the schema of version 1 complete; only `saves` has a key path (`name`), the others take
// explicit keys.
//
// **A save is replaced atomically** (C3-r1 1). Its bytes go to a new, uniquely named version (an OPFS file, or
// the new record's blob); the write is checked (every byte written, the size, flushed) before the metadata is
// published in one IndexedDB transaction, and the previous version is removed only after that commit. A quota
// error, a short write, a crash or a failed commit therefore leaves the previous save as it was; a version that
// never got published is an orphan that `sweep` removes.
//
// **Writes are fenced** (C3-r1 10; §8.2 "One tab at a time"). The tab that owns the saves holds an epoch, and
// every commit checks it, in the same transaction, against the epoch in `settings` (`saves.owner`), which each
// new owner raises: a tab that lost the saves to another (taken over, or its lock stolen) cannot commit even a
// write that was already under way.
//
// **Versions can be pinned** (C3-r1 9). A closure log's base (§8.5) names one exact version (its file and
// SHA-256); while a sim worker pins it, overwriting the save keeps that version (OPFS: the file stays; IndexedDB:
// the blob moves to a pin record), so a bug bundle and a trap recovery read exactly the bytes the log starts from.
import { type IDBPDatabase, openDB } from 'idb';
import type { SaveInfo } from '../shared/io-protocol.ts';

export const DB_NAME = 'game';
export const DB_VERSION = 1;
export const STORES = ['saves', 'settings', 'blueprints', 'runHistory', 'bench', 'rooms'] as const;
/** `settings` key of the saves' owner epoch (§8.2 "One tab at a time"). */
export const OWNER_KEY = 'saves.owner';
/** `saves` names from this prefix are internal (pinned versions in IndexedDB), never listed. */
const INTERNAL = '\u0000';
const PIN_PREFIX = `${INTERNAL}pin:`;

/** The epoch a tab writes under: the one it set in `settings` when it became the owner. */
export interface Fence {
  readonly epoch: number;
}

/** A write by a tab that no longer owns the saves. */
export class NotOwnerError extends Error {
  constructor(message = 'another tab owns the saves (§8.2 "One tab at a time"): nothing was written') {
    super(message);
    this.name = 'NotOwnerError';
  }
}

/** A save's record in the `saves` store: its metadata, and its bytes when they live in IndexedDB. */
interface SaveRecord extends SaveInfo {
  blob?: Uint8Array;
  /** A pin record's save. */
  of?: string;
}

export interface Storage {
  readonly kind: 'opfs' | 'idb';
  /**
   * Replaces save `info.name` atomically with `bytes`, under `fence`: a new version, checked, then published.
   * Returns the stored info, with the version's `file`.
   */
  write(info: SaveInfo, bytes: Uint8Array, fence: Fence): Promise<SaveInfo>;
  /** The save's current version, or exactly version `file` (a pinned base) when given. */
  read(name: string, file?: string): Promise<{ info: SaveInfo; bytes: Uint8Array } | null>;
  info(name: string): Promise<SaveInfo | null>;
  list(): Promise<SaveInfo[]>;
  remove(name: string, fence: Fence): Promise<void>;
  /** Files of a bug bundle under `reports/<dir>/` (OPFS only). */
  report(dir: string, files: readonly { name: string; bytes: Uint8Array }[], fence: Fence): Promise<boolean>;
  /** `holder` (a sim worker's generation) pins version `file` of save `name`: it survives overwrites. */
  pin(name: string, file: string, holder: string): void;
  unpin(file: string, holder: string, fence: Fence | null): Promise<void>;
  /** Drops every pin of a holder (a retired sim worker). */
  unpinAll(holder: string, fence: Fence | null): Promise<void>;
  /** Removes versions that no record names and no pin holds; returns how many. Owner only. */
  sweep(fence: Fence): Promise<number>;
}

/** The game's database (idb reads the global `indexedDB`; tests install fake-indexeddb's). */
export function openGameDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const s of STORES)
        if (!db.objectStoreNames.contains(s))
          db.createObjectStore(s, s === 'saves' ? { keyPath: 'name' } : undefined);
    },
  });
}

/** Raises the owner epoch (a new owner, §8.2): writes of every earlier owner fail their commit from now on. */
export async function claimEpoch(db: IDBPDatabase, now: number): Promise<Fence> {
  const tx = db.transaction('settings', 'readwrite');
  const cur = (await tx.store.get(OWNER_KEY)) as { epoch?: number } | undefined;
  const epoch = (cur?.epoch ?? 0) + 1;
  await tx.store.put({ epoch, at: now }, OWNER_KEY);
  await tx.done;
  return { epoch };
}

const strip = (r: SaveRecord): SaveInfo => {
  const { blob: _blob, of: _of, ...info } = r;
  return info;
};

/** The version file a record names (records of the first layout had one file per save). */
const fileOf = (r: SaveInfo): string => r.file ?? `${encodeURIComponent(r.name)}.save`;

/** The pins and the publishing transaction both storages share. */
abstract class SaveStore implements Storage {
  abstract readonly kind: 'opfs' | 'idb';
  protected readonly db: IDBPDatabase;
  /** file → its save's name and the holders pinning it. */
  protected readonly pins = new Map<string, { name: string; holders: Set<string> }>();
  /** Pinned versions whose save has a newer version: removed when their last pin goes. */
  protected readonly superseded = new Set<string>();
  private stamp = 0;

  constructor(db: IDBPDatabase) {
    this.db = db;
  }

  abstract write(info: SaveInfo, bytes: Uint8Array, fence: Fence): Promise<SaveInfo>;
  abstract read(name: string, file?: string): Promise<{ info: SaveInfo; bytes: Uint8Array } | null>;
  abstract report(
    dir: string,
    files: readonly { name: string; bytes: Uint8Array }[],
    fence: Fence,
  ): Promise<boolean>;
  /** Deletes a version's bytes (a superseded or orphaned file, or a pin record). */
  protected abstract drop(file: string): Promise<void>;
  abstract sweep(fence: Fence): Promise<number>;

  /** A version name no file or record has used: the content's hash, the time and a counter. */
  protected versionName(name: string, sha256: string): string {
    this.stamp += 1;
    return `${encodeURIComponent(name)}~${sha256.slice(0, 16)}~${Date.now().toString(36)}${this.stamp.toString(36)}.save`;
  }

  protected pinned(file: string): boolean {
    return (this.pins.get(file)?.holders.size ?? 0) > 0;
  }

  /**
   * Publishes `rec` in one transaction over `saves` and `settings`: the fence first (the epoch must still be
   * this owner's), then the previous record, kept as a pin record when IndexedDB holds a pinned version's blob.
   * Returns the previous record.
   */
  protected async publish(rec: SaveRecord, fence: Fence): Promise<SaveRecord | undefined> {
    const tx = this.db.transaction(['saves', 'settings'], 'readwrite');
    const owner = (await tx.objectStore('settings').get(OWNER_KEY)) as { epoch?: number } | undefined;
    if (owner?.epoch !== fence.epoch) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new NotOwnerError();
    }
    const saves = tx.objectStore('saves');
    const old = (await saves.get(rec.name)) as SaveRecord | undefined;
    if (old?.blob && fileOf(old) !== fileOf(rec) && this.pinned(fileOf(old)))
      await saves.put({ ...old, name: PIN_PREFIX + fileOf(old), of: old.name });
    await saves.put(rec);
    await tx.done;
    return old;
  }

  /** After a publish: the previous version goes, or waits for its last pin. */
  protected async retireVersion(old: SaveRecord | undefined, now: string): Promise<void> {
    if (!old) return;
    const f = fileOf(old);
    if (f === now) return;
    if (this.pinned(f)) this.superseded.add(f);
    else if (!old.blob) await this.drop(f).catch(() => {});
  }

  async info(name: string): Promise<SaveInfo | null> {
    if (name.startsWith(INTERNAL)) return null;
    const r = (await this.db.get('saves', name)) as SaveRecord | undefined;
    return r ? strip(r) : null;
  }

  async list(): Promise<SaveInfo[]> {
    return ((await this.db.getAll('saves')) as SaveRecord[])
      .filter((r) => !r.name.startsWith(INTERNAL))
      .map(strip);
  }

  async remove(name: string, fence: Fence): Promise<void> {
    const tx = this.db.transaction(['saves', 'settings'], 'readwrite');
    const owner = (await tx.objectStore('settings').get(OWNER_KEY)) as { epoch?: number } | undefined;
    if (owner?.epoch !== fence.epoch) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new NotOwnerError();
    }
    const saves = tx.objectStore('saves');
    const old = (await saves.get(name)) as SaveRecord | undefined;
    if (old?.blob && this.pinned(fileOf(old)))
      await saves.put({ ...old, name: PIN_PREFIX + fileOf(old), of: old.name });
    await saves.delete(name);
    await tx.done;
    await this.retireVersion(old, '');
  }

  pin(name: string, file: string, holder: string): void {
    let p = this.pins.get(file);
    if (!p) {
      p = { name, holders: new Set() };
      this.pins.set(file, p);
    }
    p.holders.add(holder);
  }

  async unpin(file: string, holder: string, fence: Fence | null): Promise<void> {
    const p = this.pins.get(file);
    if (!p) return;
    p.holders.delete(holder);
    if (p.holders.size > 0) return;
    this.pins.delete(file);
    if (this.superseded.delete(file) && fence) await this.drop(file).catch(() => {});
  }

  async unpinAll(holder: string, fence: Fence | null): Promise<void> {
    for (const [file, p] of [...this.pins]) if (p.holders.has(holder)) await this.unpin(file, holder, fence);
  }

  /** The names every record gives its version. */
  protected async referenced(): Promise<Set<string>> {
    const out = new Set<string>();
    for (const r of (await this.db.getAll('saves')) as SaveRecord[])
      if (!r.name.startsWith(INTERNAL)) out.add(fileOf(r));
    return out;
  }

  /** Pin records nobody pins any more (a tab that crashed or was taken over). */
  protected async sweepPinRecords(): Promise<number> {
    let n = 0;
    for (const key of (await this.db.getAllKeys('saves')) as string[])
      if (key.startsWith(PIN_PREFIX) && !this.pinned(key.slice(PIN_PREFIX.length))) {
        await this.db.delete('saves', key);
        n += 1;
      }
    return n;
  }
}

/** Saves in IndexedDB: metadata and bytes in one record, replaced in one transaction. */
export class IdbStorage extends SaveStore {
  readonly kind = 'idb' as const;

  async write(info: SaveInfo, bytes: Uint8Array, fence: Fence): Promise<SaveInfo> {
    const file = this.versionName(info.name, info.sha256);
    const stored: SaveInfo = { ...info, store: 'idb', file };
    const old = await this.publish({ ...stored, blob: bytes }, fence);
    await this.retireVersion(old, file);
    return stored;
  }

  async read(name: string, file?: string): Promise<{ info: SaveInfo; bytes: Uint8Array } | null> {
    if (name.startsWith(INTERNAL)) return null;
    let r = (await this.db.get('saves', name)) as SaveRecord | undefined;
    if (file !== undefined && (!r || fileOf(r) !== file))
      r = (await this.db.get('saves', PIN_PREFIX + file)) as SaveRecord | undefined;
    if (!r?.blob) return null;
    const info = r.of !== undefined ? { ...strip(r), name: r.of } : strip(r);
    return { info, bytes: new Uint8Array(r.blob) };
  }

  protected async drop(file: string): Promise<void> {
    await this.db.delete('saves', PIN_PREFIX + file);
  }

  async report(): Promise<boolean> {
    return false;
  }

  async sweep(_fence: Fence): Promise<number> {
    return this.sweepPinRecords();
  }
}

/** The OPFS API the worker uses (FileSystemSyncAccessHandle exists only in dedicated workers). */
export interface SyncHandle {
  getSize(): number;
  read(buf: Uint8Array, opts: { at: number }): number;
  write(buf: Uint8Array, opts: { at: number }): number;
  truncate(n: number): void;
  flush(): void;
  close(): void;
}
export interface FileHandle {
  createSyncAccessHandle(): Promise<SyncHandle>;
}
export interface DirHandle {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}

/** Writes `bytes` to a new file and checks them: every byte written, the size, flushed. */
async function writeChecked(dir: DirHandle, name: string, bytes: Uint8Array): Promise<void> {
  const h = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
  try {
    if (h.getSize() !== 0) throw new Error(`${name} exists`);
    const n = h.write(bytes, { at: 0 });
    if (n !== bytes.length) throw new Error(`a short write: ${n} of ${bytes.length} bytes`);
    h.flush();
    const size = h.getSize();
    if (size !== bytes.length) throw new Error(`${name} holds ${size} bytes, not ${bytes.length}`);
  } finally {
    h.close();
  }
}

/** Saves in OPFS (`saves/<version>.save`), metadata in IndexedDB. */
export class OpfsStorage extends SaveStore {
  readonly kind = 'opfs' as const;
  private readonly root: DirHandle;

  constructor(db: IDBPDatabase, root: DirHandle) {
    super(db);
    this.root = root;
  }

  /** The OPFS root, if this worker can write files with sync access handles. */
  static async probe(): Promise<DirHandle | null> {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function')
      return null;
    try {
      const root = (await navigator.storage.getDirectory()) as unknown as DirHandle;
      const dir = await root.getDirectoryHandle('saves', { create: true });
      const f = await dir.getFileHandle('.probe', { create: true });
      const h = await f.createSyncAccessHandle();
      h.close();
      await dir.removeEntry('.probe');
      return root;
    } catch {
      return null;
    }
  }

  private dir(): Promise<DirHandle> {
    return this.root.getDirectoryHandle('saves', { create: true });
  }

  async write(info: SaveInfo, bytes: Uint8Array, fence: Fence): Promise<SaveInfo> {
    const dir = await this.dir();
    const file = this.versionName(info.name, info.sha256);
    try {
      await writeChecked(dir, file, bytes);
    } catch (e) {
      await dir.removeEntry(file).catch(() => {});
      throw e;
    }
    const stored: SaveInfo = { ...info, store: 'opfs', file };
    let old: SaveRecord | undefined;
    try {
      old = await this.publish(stored, fence);
    } catch (e) {
      // Never published: the previous version is still the save.
      await dir.removeEntry(file).catch(() => {});
      throw e;
    }
    await this.retireVersion(old, file);
    return stored;
  }

  async read(name: string, file?: string): Promise<{ info: SaveInfo; bytes: Uint8Array } | null> {
    if (name.startsWith(INTERNAL)) return null;
    const r = (await this.db.get('saves', name)) as SaveRecord | undefined;
    if (r?.blob) {
      // A record written while OPFS was missing: its bytes are in IndexedDB, and so are its pinned versions.
      if (file === undefined || fileOf(r) === file) return { info: strip(r), bytes: new Uint8Array(r.blob) };
      const p = (await this.db.get('saves', PIN_PREFIX + file)) as SaveRecord | undefined;
      return p?.blob ? { info: { ...strip(p), name }, bytes: new Uint8Array(p.blob) } : null;
    }
    if (!r && file === undefined) return null;
    const want = file ?? fileOf(r as SaveRecord);
    const bytes = await this.readFile(want);
    if (!bytes) return null;
    // A superseded version: the record describes the newer one, so the caller checks the hash it pinned.
    const info: SaveInfo =
      r && fileOf(r) === want
        ? strip(r)
        : { ...(r ? strip(r) : ({ name } as SaveInfo)), file: want, sha256: '', bytes: bytes.length };
    return { info, bytes };
  }

  /** A version's bytes, or null when that file is gone. */
  private async readFile(file: string): Promise<Uint8Array | null> {
    let h: SyncHandle;
    try {
      h = await (await (await this.dir()).getFileHandle(file)).createSyncAccessHandle();
    } catch {
      return null;
    }
    try {
      const bytes = new Uint8Array(h.getSize());
      const n = h.read(bytes, { at: 0 });
      if (n !== bytes.length) throw new Error(`a short read of ${file}: ${n} of ${bytes.length} bytes`);
      return bytes;
    } finally {
      h.close();
    }
  }

  protected async drop(file: string): Promise<void> {
    await (await this.dir()).removeEntry(file);
  }

  async report(
    dir: string,
    files: readonly { name: string; bytes: Uint8Array }[],
    fence: Fence,
  ): Promise<boolean> {
    const owner = (await this.db.get('settings', OWNER_KEY)) as { epoch?: number } | undefined;
    if (owner?.epoch !== fence.epoch) throw new NotOwnerError();
    const reports = await this.root.getDirectoryHandle('reports', { create: true });
    const d = await reports.getDirectoryHandle(dir, { create: true });
    for (const f of files) await writeChecked(d, f.name, f.bytes);
    return true;
  }

  async sweep(fence: Fence): Promise<number> {
    const owner = (await this.db.get('settings', OWNER_KEY)) as { epoch?: number } | undefined;
    if (owner?.epoch !== fence.epoch) throw new NotOwnerError();
    const keep = await this.referenced();
    const dir = await this.dir();
    const names: string[] = [];
    for await (const name of dir.keys()) names.push(name);
    let n = 0;
    for (const name of names)
      if (!keep.has(name) && !this.pinned(name) && name !== '.probe') {
        await dir.removeEntry(name).catch(() => {});
        n += 1;
      }
    return n + (await this.sweepPinRecords());
  }
}
