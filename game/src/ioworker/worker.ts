// The IO worker (10 §3.1, §8.2): one per page. It serves the main thread on its own channel and every sim worker
// on a port the main thread attaches (`port`). Requests are served in arrival order per channel; a save that is
// still being written does not hold up the sim worker, which only waits for the answer. It also keeps the saves'
// ownership for its tab (ownership.ts, §8.2 "One tab at a time"): writes only while this tab owns them.
import type { IoReply, IoRequest, IoToMain, MainToIo } from '../shared/io-protocol.ts';
import { type IoEnv, IoService } from './io.ts';
import { MemorySaveLock, Ownership, type SaveLock, type TabChannel, WebSaveLock } from './ownership.ts';
import { IdbStorage, OpfsStorage, openGameDb, type Storage } from './storage.ts';

export interface IoHost {
  post(msg: IoToMain, transfer?: Transferable[]): void;
}

/** Opens the storage: OPFS where this worker can use sync access handles, otherwise IndexedDB (§8.2). */
export async function openStorage(): Promise<{
  storage: Storage;
  db: Awaited<ReturnType<typeof openGameDb>>;
}> {
  const db = await openGameDb();
  const root = await OpfsStorage.probe();
  return { storage: root ? new OpfsStorage(db, root) : new IdbStorage(db), db };
}

/** The tabs' channel (a BroadcastChannel where the platform has one). */
export function tabChannel(): TabChannel | null {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel('paperwork:saves') : null;
}

export interface IoWorkerOptions {
  storage?: Promise<{ storage: Storage; db: Awaited<ReturnType<typeof openGameDb>> }>;
  /** The lock the tabs share: Web Locks in browsers; tests pass MemorySaveLock siblings. */
  lock?: SaveLock;
  channel?: TabChannel | null;
  /** How long a takeover waits for the owner's answer. */
  takeoverWaitMs?: number;
}

export class IoWorker {
  private readonly host: IoHost;
  private readonly service: Promise<IoService>;
  private ownership: Ownership | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(host: IoHost, env: IoEnv, o: IoWorkerOptions = {}) {
    this.host = host;
    const opened = o.storage ?? openStorage();
    this.service = opened.then(async ({ storage, db }) => {
      const own = new Ownership({
        db,
        lock: o.lock ?? WebSaveLock.available() ?? new MemorySaveLock(),
        channel: o.channel === undefined ? tabChannel() : o.channel,
        notify: (m) => host.post(m),
        owned: async (fence) => {
          const n = await storage.sweep(fence);
          if (n > 0)
            host.post({ t: 'log', level: 'info', msg: `IO worker: removed ${n} orphaned save versions` });
        },
        ...(o.takeoverWaitMs !== undefined ? { waitMs: o.takeoverWaitMs } : {}),
      });
      this.ownership = own;
      const svc = new IoService(storage, env, () => own.fence);
      host.post({ t: 'ready', store: storage.kind });
      await own.start();
      return svc;
    });
    this.service.catch((e: unknown) =>
      host.post({ t: 'log', level: 'error', msg: `IO worker: no storage: ${String(e)}` }),
    );
  }

  /** A message on the worker's own channel. */
  handle(m: MainToIo): void {
    if (m.t === 'port') {
      const port = m.port;
      port.onmessage = (e: MessageEvent<IoRequest>) => this.serve(e.data, (r, t) => port.postMessage(r, t));
      return;
    }
    if (m.t === 'takeover') {
      void this.service.then(() => this.ownership?.takeOver());
      return;
    }
    if (m.t === 'release') {
      void this.service.then(() => this.ownership?.release());
      return;
    }
    this.serve(m, (r, t) => this.host.post(r, t));
  }

  private serve(req: IoRequest, reply: (r: IoReply, transfer: Transferable[]) => void): void {
    this.queue = this.queue
      .then(async () => {
        const svc = await this.service;
        const { reply: r, transfer } = await svc.handle(req);
        reply(r, transfer);
      })
      .catch((e: unknown) => reply({ t: 'failed', id: req.id, message: String(e) }, []));
  }

  close(): void {
    this.ownership?.close();
  }
}
