// The action encoder (10 §7.5, §15.3; I §8.2): the resolver's sim actions, encoded with the generated encoder and
// sent to the sequencer port as `act` messages. The main thread is the only allocator of its player's seqs
// (§3.2): when a world is bound, nextSeq = max(loaded, accepted, pending) + 1; a single-player replacement
// discards what was pending for the old world; the counter never moves backwards within a world. Actions of one
// event (a WASD change, a sweep step) leave together, in one message with consecutive seqs, at the end of the
// current task: no frame of latency is added.
import { type Action, actionBytes } from '../../shared/gen/actions.ts';

export interface ActPort {
  act(firstSeq: number, actions: ArrayBuffer): void;
}

export interface SentAction {
  seq: number;
  action: Action;
  /** performance.now() when it was posted. */
  at: number;
}

const LOG_MAX = 1024;

export class ActionEncoder {
  private port: ActPort | null = null;
  private nextSeq = 1;
  private queue: { seq: number; bytes: Uint8Array; action: Action }[] = [];
  private scheduled = false;
  /** The last actions sent, newest last (tests and the dev log read it). */
  readonly log: SentAction[] = [];

  /** Binds a world (`bound`'s lastSeq for this player); with null, actions are dropped until the next bind. */
  bind(port: ActPort | null, loadedSeq = 0, accepted = 0): void {
    this.queue = [];
    this.port = port;
    // A fresh world: nothing of the old one is pending (single player discards it, §3.2).
    this.nextSeq = Math.max(loadedSeq, accepted) + 1;
  }

  get bound(): boolean {
    return this.port !== null;
  }

  /** Queues an action for this task's `act` message; returns its seq, or 0 when no world is bound. */
  send(action: Action): number {
    if (!this.port) return 0;
    const seq = this.nextSeq++;
    this.queue.push({ seq, bytes: actionBytes(action), action });
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.flush());
    }
    return seq;
  }

  /** Posts the queued actions now. */
  flush(): void {
    this.scheduled = false;
    const q = this.queue;
    if (q.length === 0 || !this.port) {
      this.queue = [];
      return;
    }
    this.queue = [];
    let len = 0;
    for (const x of q) len += x.bytes.length;
    const out = new Uint8Array(len);
    let at = 0;
    for (const x of q) {
      out.set(x.bytes, at);
      at += x.bytes.length;
    }
    const now = performance.now();
    for (const x of q) {
      this.log.push({ seq: x.seq, action: x.action, at: now });
      if (this.log.length > LOG_MAX) this.log.shift();
    }
    this.port.act((q[0] as { seq: number }).seq, out.buffer);
  }
}
