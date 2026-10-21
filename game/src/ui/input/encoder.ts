// The action encoder (10 §7.5, §15.3; I §8.2): the resolver's sim actions, encoded with the generated encoder and
// handed to the host (`act`), which allocates their seqs (§3.2: nextSeq = max(loaded, accepted, pending) + 1; a
// single-player replacement discards what was pending for the old world). Actions of one event (a WASD change, a
// sweep step) leave together, in one message with consecutive seqs, at the end of the current task: no frame of
// latency is added. With no world shown, actions are dropped.
import { type Action, actionBytes } from '../../shared/gen/actions.ts';

/** Where actions go (the host's `act`): returns the first action's seq. */
export interface ActSink {
  act(actions: Uint8Array): number;
}

export interface SentAction {
  seq: number;
  action: Action;
  /** performance.now() when it was posted. */
  at: number;
}

const LOG_MAX = 1024;

export class ActionEncoder {
  private sink: ActSink | null = null;
  private queue: { bytes: Uint8Array; action: Action }[] = [];
  private scheduled = false;
  /** The last actions sent, newest last (tests and the dev log read it). */
  readonly log: SentAction[] = [];

  /** A world is shown (the host), or none (null): queued actions of the old world are dropped. */
  bind(sink: ActSink | null): void {
    this.queue = [];
    this.sink = sink;
  }

  get bound(): boolean {
    return this.sink !== null;
  }

  /** Queues an action for this task's `act` message; false when no world is shown. */
  send(action: Action): boolean {
    if (!this.sink) return false;
    this.queue.push({ bytes: actionBytes(action), action });
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.flush());
    }
    return true;
  }

  /** Posts the queued actions now. */
  flush(): void {
    this.scheduled = false;
    const q = this.queue;
    this.queue = [];
    if (q.length === 0 || !this.sink) return;
    let len = 0;
    for (const x of q) len += x.bytes.length;
    const out = new Uint8Array(len);
    let at = 0;
    for (const x of q) {
      out.set(x.bytes, at);
      at += x.bytes.length;
    }
    let first: number;
    try {
      first = this.sink.act(out);
    } catch {
      return; // the world went between the input and the end of the task
    }
    const now = performance.now();
    q.forEach((x, i) => {
      this.log.push({ seq: first + i, action: x.action, at: now });
      if (this.log.length > LOG_MAX) this.log.shift();
    });
  }
}
