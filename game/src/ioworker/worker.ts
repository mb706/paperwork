// The IO worker (10 §3.1, §8.2): one per page. It serves the main thread on its own channel and every sim worker
// on a port the main thread attaches (`port`). Requests are served in arrival order per channel; a save that is
// still being written does not hold up the sim worker, which only waits for the answer.
import type { IoReply, IoRequest, IoToMain, MainToIo } from '../shared/io-protocol.ts';
import { type IoEnv, IoService } from './io.ts';
import { IdbStorage, OpfsStorage, openGameDb, type Storage } from './storage.ts';

export interface IoHost {
  post(msg: IoToMain, transfer?: Transferable[]): void;
}

/** Opens the storage: OPFS where this worker can use sync access handles, otherwise IndexedDB (§8.2). */
export async function openStorage(): Promise<Storage> {
  const db = await openGameDb();
  const root = await OpfsStorage.probe();
  return root ? new OpfsStorage(db, root) : new IdbStorage(db);
}

export class IoWorker {
  private readonly host: IoHost;
  private readonly service: Promise<IoService>;
  private queue: Promise<void> = Promise.resolve();

  constructor(host: IoHost, env: IoEnv, storage: Promise<Storage> = openStorage()) {
    this.host = host;
    this.service = storage.then((s) => {
      const svc = new IoService(s, env);
      host.post({ t: 'ready', store: s.kind });
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
}
