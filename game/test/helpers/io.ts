// The IO worker in the Node tests: fake-indexeddb (the test file imports 'fake-indexeddb/auto'), and OPFS as an
// in-memory directory tree with injectable faults (a quota error, a short write), so the save path's atomicity
// is tested against the failures a browser can produce (C3-r1 1). Each test IO worker takes its own lock unless
// a test makes two "tabs" share one (C3-r1 10).
import { createHash } from 'node:crypto';
import type { IDBPDatabase } from 'idb';
import { inlineIo } from '../../src/app/inline.ts';
import { IoClient } from '../../src/app/io-client.ts';
import type { IoEnv } from '../../src/ioworker/io.ts';
import { rawFrame } from '../../src/ioworker/io.ts';
import { MemorySaveLock, type SaveLock, type TabChannel } from '../../src/ioworker/ownership.ts';
import { claimEpoch, type Fence } from '../../src/ioworker/storage.ts';

export { claimEpoch, type Fence, MemorySaveLock };

import {
  type DirHandle,
  type FileHandle,
  IdbStorage,
  OpfsStorage,
  openGameDb,
  type Storage,
  type SyncHandle,
} from '../../src/ioworker/storage.ts';
import { SaveOutputCodec } from '../../src/shared/gen/abi.ts';
import { readSaveContainer, type SaveHeader } from '../../src/shared/gen/container.ts';
import { golden } from './shell-harness.ts';

export const sha256 = async (b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(createHash('sha256').update(b).digest());
export const ioEnv: IoEnv = { sha256, now: () => performance.now() };

/** The game database with its saves and settings (the owner epoch) cleared. */
export async function freshDb(): Promise<IDBPDatabase> {
  const db = await openGameDb();
  await db.clear('saves');
  await db.clear('settings');
  return db;
}

/** A fault for the next file write: throw after writing `after` bytes, or report a short write of `after`. */
export interface WriteFault {
  after: number;
  mode: 'throw' | 'short';
}

/** OPFS in memory: `saves/` and `reports/` directories of byte arrays. */
export class MemoryOpfs {
  readonly files = new Map<string, Uint8Array>();
  fault: WriteFault | null = null;
  readonly root: DirHandle;

  constructor() {
    this.root = this.dir('');
  }

  /** The names in one directory. */
  names(dir: string): string[] {
    const p = `${dir}/`;
    return [...this.files.keys()].filter((k) => k.startsWith(p)).map((k) => k.slice(p.length));
  }

  private dir(path: string): DirHandle {
    const fs = this.files;
    const self = this;
    const key = (name: string) => (path ? `${path}/${name}` : name);
    return {
      async getDirectoryHandle(name: string): Promise<DirHandle> {
        return self.dir(key(name));
      },
      async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle> {
        const k = key(name);
        if (!fs.has(k)) {
          if (!opts?.create) throw new DOMException(`${k} not found`, 'NotFoundError');
          fs.set(k, new Uint8Array(0));
        }
        return { createSyncAccessHandle: async () => self.handle(k) };
      },
      async removeEntry(name: string): Promise<void> {
        if (!fs.delete(key(name))) throw new DOMException(`${key(name)} not found`, 'NotFoundError');
      },
      async *keys(): AsyncIterable<string> {
        for (const n of self.names(path)) if (!n.includes('/')) yield n;
      },
    };
  }

  private handle(k: string): SyncHandle {
    const fs = this.files;
    const self = this;
    return {
      getSize: () => (fs.get(k) as Uint8Array).length,
      read(buf: Uint8Array, opts: { at: number }): number {
        const b = fs.get(k) as Uint8Array;
        const n = Math.max(0, Math.min(buf.length, b.length - opts.at));
        buf.set(b.subarray(opts.at, opts.at + n));
        return n;
      },
      write(buf: Uint8Array, opts: { at: number }): number {
        const f = self.fault;
        self.fault = null;
        const n = f ? Math.min(f.after, buf.length) : buf.length;
        const b = fs.get(k) as Uint8Array;
        const grown = new Uint8Array(Math.max(b.length, opts.at + n));
        grown.set(b);
        grown.set(buf.subarray(0, n), opts.at);
        fs.set(k, grown);
        if (f?.mode === 'throw') throw new DOMException('the quota is exceeded', 'QuotaExceededError');
        return n;
      },
      truncate(n: number): void {
        fs.set(k, (fs.get(k) as Uint8Array).slice(0, n));
      },
      flush(): void {},
      close(): void {},
    };
  }
}

/** An in-process IO worker over IndexedDB, or over `opfs`; it owns the saves unless its lock says otherwise. */
export async function testIo(
  o: {
    opfs?: MemoryOpfs;
    db?: IDBPDatabase;
    lock?: SaveLock;
    channel?: TabChannel | null;
    waitMs?: number;
  } = {},
): Promise<{ io: IoClient; db: IDBPDatabase; storage: Storage }> {
  const db = o.db ?? (await freshDb());
  const storage: Storage = o.opfs ? new OpfsStorage(db, o.opfs.root) : new IdbStorage(db);
  const io = new IoClient(
    inlineIo(ioEnv, {
      storage: Promise.resolve({ storage, db }),
      lock: o.lock ?? new MemorySaveLock(),
      channel: o.channel ?? null,
      ...(o.waitMs !== undefined ? { takeoverWaitMs: o.waitMs } : {}),
    }),
  );
  return { io, db, storage };
}

/** `sim_save`'s output for the golden start (the sections raw, then the lineage) and its header. */
export function startOutput(savedAt = '2026-01-01T00:00:00.000Z'): { save: ArrayBuffer; header: SaveHeader } {
  const c = readSaveContainer(golden('start.save'));
  const save = SaveOutputCodec.encode({
    sections: c.frames.map(rawFrame),
    r: BigInt(`0x${c.header.lineage}`),
  });
  return { save: save.slice().buffer as ArrayBuffer, header: { ...(c.header as SaveHeader), savedAt } };
}
