// In-process workers (10 §3.1 "Debug and test mode": `?sim=inline` runs the same shell and module on the main
// thread through an in-process transport). Each looks like a Worker to SimHost: the same messages, structured
// clones and transfers over a MessageChannel, so the protocol and the shell are exercised exactly; only the
// thread differs. The Node tests drive SimHost with these.
import { GenWorker } from '../genworker/worker.ts';
import type { IoEnv } from '../ioworker/io.ts';
import type { Storage } from '../ioworker/storage.ts';
import { IoWorker } from '../ioworker/worker.ts';
import { type ShellHost, SimShell } from '../simworker/shell.ts';
import { selfPostWaker } from '../simworker/waker.ts';
import type { WorkerLike } from './sim-host.ts';

/** A WorkerLike whose other end is served in-process on a MessagePort; `serve` returns how to stop it. */
export function channelWorker(serve: (port: MessagePort) => () => void): WorkerLike {
  const ch = new MessageChannel();
  const stop = serve(ch.port2);
  let handler: ((e: MessageEvent) => void) | null = null;
  return {
    postMessage: (m: unknown, transfer?: Transferable[]) => ch.port1.postMessage(m, transfer ?? []),
    terminate: () => {
      stop();
      ch.port1.onmessage = null;
      ch.port1.close();
      ch.port2.close();
    },
    get onmessage() {
      return handler;
    },
    set onmessage(f: ((e: MessageEvent) => void) | null) {
      handler = f;
      ch.port1.onmessage = f;
    },
  };
}

const webSha256 = async (b: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', b.slice()));

export interface InlineSimOptions {
  protos(): Promise<Uint8Array>;
  sha256?(bytes: Uint8Array): Promise<Uint8Array>;
  /** Tests: the reference model in place of the module. */
  instantiate?: ShellHost['instantiate'];
  /** The clock (tests may substitute a manual one). */
  now?(): number;
}

/** The sim worker's shell, in-process (`?sim=inline`). */
export function inlineSim(o: InlineSimOptions): WorkerLike {
  return channelWorker((port) => {
    const waker = selfPostWaker();
    const host: ShellHost = {
      post: (m, transfer) => port.postMessage(m, transfer ?? []),
      now: o.now ?? (() => performance.now()),
      wake: waker.wake,
      cancel: waker.cancel,
      protos: o.protos,
      sha256: o.sha256 ?? webSha256,
    };
    if (o.instantiate) host.instantiate = o.instantiate;
    const shell = new SimShell(host);
    port.onmessage = (e: MessageEvent) => {
      void shell.handle(e.data);
    };
    return () => {
      shell.close();
      waker.close();
    };
  });
}

/** A worldgen worker, in-process. */
export function inlineGen(): WorkerLike {
  return channelWorker((port) => {
    const w = new GenWorker({ post: (m, transfer) => port.postMessage(m, transfer ?? []) });
    port.onmessage = (e: MessageEvent) => {
      void w.handle(e.data);
    };
    return () => {};
  });
}

/** The IO worker, in-process (tests pass their storage). */
export function inlineIo(env: IoEnv, storage?: Promise<Storage>): WorkerLike {
  return channelWorker((port) => {
    const io = storage
      ? new IoWorker({ post: (m, transfer) => port.postMessage(m, transfer ?? []) }, env, storage)
      : new IoWorker({ post: (m, transfer) => port.postMessage(m, transfer ?? []) }, env);
    port.onmessage = (e: MessageEvent) => io.handle(e.data);
    return () => {};
  });
}
