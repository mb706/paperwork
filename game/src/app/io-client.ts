// The main thread's handle on the page's IO worker (10 §3.1, §8.2; src/shared/io-protocol.ts): requests with
// ids, the ports it attaches for each sim worker, and the saves' ownership (§8.2 "One tab at a time"): whether
// this tab owns them, a takeover request from another tab (save, then `release`), and *Take over*.
import type { IoReply, IoRequest, IoToMain, MainToIo } from '../shared/io-protocol.ts';
import type { WorkerLike } from './sim-host.ts';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export class IoClient {
  private readonly worker: WorkerLike;
  private next = 1;
  private readonly waiting = new Map<number, (r: IoReply) => void>();
  /** Where saves live: known once the worker answers `ready`. */
  readonly store: Promise<'opfs' | 'idb'>;
  /** Whether this tab owns the saves (null until the worker knows). */
  owner: boolean | null = null;
  onLog: ((level: 'info' | 'warn' | 'error', msg: string) => void) | null = null;
  /** The saves' owner changed (SimHost listens). */
  onOwner: ((owner: boolean, reason: string | undefined) => void) | null = null;
  /** Another tab asks for the saves: save, then call `release()`. Without a handler, the tab lets go at once. */
  onTakeover: (() => void) | null = null;

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
      if (m.t === 'owner') {
        this.owner = m.owner;
        return this.onOwner?.(m.owner, m.reason);
      }
      if (m.t === 'takeover') {
        if (this.onTakeover) return this.onTakeover();
        return this.release();
      }
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

  /** *Take over* (§8.2): the tab that owns the saves saves its game and lets go; `onOwner` reports the result. */
  takeOver(): void {
    const m: MainToIo = { t: 'takeover' };
    this.worker.postMessage(m);
  }

  /** This tab's answer to `onTakeover`, after its last save: it lets go of the saves (read-only from now). */
  release(): void {
    const m: MainToIo = { t: 'release' };
    this.worker.postMessage(m);
  }

  terminate(): void {
    this.worker.terminate();
  }
}
