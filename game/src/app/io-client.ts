// The main thread's handle on the page's IO worker (10 §3.1, §8.2; src/shared/io-protocol.ts): requests with
// ids, and the ports it attaches for each sim worker.
import type { IoReply, IoRequest, IoToMain, MainToIo } from '../shared/io-protocol.ts';
import type { WorkerLike } from './sim-host.ts';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export class IoClient {
  private readonly worker: WorkerLike;
  private next = 1;
  private readonly waiting = new Map<number, (r: IoReply) => void>();
  /** Where saves live: known once the worker answers `ready`. */
  readonly store: Promise<'opfs' | 'idb'>;
  onLog: ((level: 'info' | 'warn' | 'error', msg: string) => void) | null = null;

  constructor(worker: WorkerLike) {
    this.worker = worker;
    let ready: (k: 'opfs' | 'idb') => void = () => {};
    this.store = new Promise((r) => {
      ready = r;
    });
    worker.onmessage = (e: MessageEvent<IoToMain>) => {
      const m = e.data;
      if (m.t === 'ready') return ready(m.store);
      if (m.t === 'log') return this.onLog?.(m.level, m.msg);
      const f = this.waiting.get(m.id);
      if (f) {
        this.waiting.delete(m.id);
        f(m);
      }
    };
  }

  request(req: WithoutId<IoRequest>, transfer: Transferable[] = []): Promise<IoReply> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      const m = { ...req, id } as MainToIo;
      this.worker.postMessage(m, transfer);
    });
  }

  /** A sim worker's port to the IO worker (`boot.ioPort` gets the other end). */
  attach(port: MessagePort): void {
    const m: MainToIo = { t: 'port', port };
    this.worker.postMessage(m, [port]);
  }

  terminate(): void {
    this.worker.terminate();
  }
}
