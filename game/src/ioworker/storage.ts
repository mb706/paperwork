// Where the IO worker keeps saves (10 §8.2 "Storage"): save blobs in the Origin Private File System where
// available, written with a sync access handle in the worker; otherwise in IndexedDB. IndexedDB (idb 8.0.3)
// holds database `game`, version 1, with the stores of §8.2: `saves` (name → metadata, plus the blob when OPFS
// is missing), `settings`, `blueprints`, `runHistory`, `bench` and `rooms`. The IO worker creates them all, so
// every package finds the schema of version 1 complete; only `saves` has a key path (`name`), the others take
// explicit keys.
import { type IDBPDatabase, openDB } from 'idb';
import type { SaveInfo } from '../shared/io-protocol.ts';

export const DB_NAME = 'game';
export const DB_VERSION = 1;
export const STORES = ['saves', 'settings', 'blueprints', 'runHistory', 'bench', 'rooms'] as const;

/** A save's record in the `saves` store: its metadata, and its bytes when they live in IndexedDB. */
interface SaveRecord extends SaveInfo {
  blob?: Uint8Array;
}

export interface Storage {
  readonly kind: 'opfs' | 'idb';
  write(info: SaveInfo, bytes: Uint8Array): Promise<void>;
  read(name: string): Promise<{ info: SaveInfo; bytes: Uint8Array } | null>;
  info(name: string): Promise<SaveInfo | null>;
  list(): Promise<SaveInfo[]>;
  remove(name: string): Promise<void>;
  /** Files of a bug bundle under `reports/<dir>/` (OPFS only). */
  report(dir: string, files: readonly { name: string; bytes: Uint8Array }[]): Promise<boolean>;
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

const strip = (r: SaveRecord): SaveInfo => {
  const { blob: _blob, ...info } = r;
  return info;
};

/** Saves in IndexedDB: metadata and bytes in one record. */
export class IdbStorage implements Storage {
  readonly kind = 'idb' as const;
  private readonly db: IDBPDatabase;
  constructor(db: IDBPDatabase) {
    this.db = db;
  }
  async write(info: SaveInfo, bytes: Uint8Array): Promise<void> {
    const rec: SaveRecord = { ...info, store: 'idb', blob: bytes };
    await this.db.put('saves', rec);
  }
  async read(name: string): Promise<{ info: SaveInfo; bytes: Uint8Array } | null> {
    const r = (await this.db.get('saves', name)) as SaveRecord | undefined;
    if (!r?.blob) return null;
    return { info: strip(r), bytes: new Uint8Array(r.blob) };
  }
  async info(name: string): Promise<SaveInfo | null> {
    const r = (await this.db.get('saves', name)) as SaveRecord | undefined;
    return r ? strip(r) : null;
  }
  async list(): Promise<SaveInfo[]> {
    return ((await this.db.getAll('saves')) as SaveRecord[]).map(strip);
  }
  async remove(name: string): Promise<void> {
    await this.db.delete('saves', name);
  }
  async report(): Promise<boolean> {
    return false;
  }
}

/** The OPFS API the worker uses (FileSystemSyncAccessHandle exists only in dedicated workers). */
interface SyncHandle {
  getSize(): number;
  read(buf: Uint8Array, opts: { at: number }): number;
  write(buf: Uint8Array, opts: { at: number }): number;
  truncate(n: number): void;
  flush(): void;
  close(): void;
}
interface FileHandle {
  createSyncAccessHandle(): Promise<SyncHandle>;
}
interface DirHandle {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
}

/** Saves in OPFS (`saves/<name>.save`), metadata in IndexedDB. */
export class OpfsStorage implements Storage {
  readonly kind = 'opfs' as const;
  private readonly db: IDBPDatabase;
  private readonly root: DirHandle;
  constructor(db: IDBPDatabase, root: DirHandle) {
    this.db = db;
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

  private async file(dir: string, name: string): Promise<SyncHandle> {
    const d = await this.root.getDirectoryHandle(dir, { create: true });
    return (await d.getFileHandle(name, { create: true })).createSyncAccessHandle();
  }

  async write(info: SaveInfo, bytes: Uint8Array): Promise<void> {
    const h = await this.file('saves', `${info.name}.save`);
    try {
      h.truncate(0);
      h.write(bytes, { at: 0 });
      h.flush();
    } finally {
      h.close();
    }
    const rec: SaveRecord = { ...info, store: 'opfs' };
    await this.db.put('saves', rec);
  }

  async read(name: string): Promise<{ info: SaveInfo; bytes: Uint8Array } | null> {
    const info = await this.info(name);
    if (!info) return null;
    if (info.store === 'idb') {
      const r = (await this.db.get('saves', name)) as SaveRecord | undefined;
      return r?.blob ? { info, bytes: new Uint8Array(r.blob) } : null;
    }
    const h = await this.file('saves', `${name}.save`);
    try {
      const bytes = new Uint8Array(h.getSize());
      h.read(bytes, { at: 0 });
      return { info, bytes };
    } finally {
      h.close();
    }
  }

  async info(name: string): Promise<SaveInfo | null> {
    const r = (await this.db.get('saves', name)) as SaveRecord | undefined;
    return r ? strip(r) : null;
  }

  async list(): Promise<SaveInfo[]> {
    return ((await this.db.getAll('saves')) as SaveRecord[]).map(strip);
  }

  async remove(name: string): Promise<void> {
    try {
      const d = await this.root.getDirectoryHandle('saves', { create: true });
      await d.removeEntry(`${name}.save`);
    } catch {
      // not there: the metadata goes anyway
    }
    await this.db.delete('saves', name);
  }

  async report(dir: string, files: readonly { name: string; bytes: Uint8Array }[]): Promise<boolean> {
    const reports = await this.root.getDirectoryHandle('reports', { create: true });
    const d = await reports.getDirectoryHandle(dir, { create: true });
    for (const f of files) {
      const h = await (await d.getFileHandle(f.name, { create: true })).createSyncAccessHandle();
      try {
        h.truncate(0);
        h.write(f.bytes, { at: 0 });
        h.flush();
      } finally {
        h.close();
      }
    }
    return true;
  }
}
