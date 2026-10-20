// The main thread's side of subscriptions (10 §7.3, §15.5): a window that opens subscribes to the projections it
// shows and unsubscribes when it closes. Sub ids are allocated from 1 and never reused within a state generation;
// sub_id 0 is the hover projection, driven by the view request's `hovered_serial`. After a new state generation
// every subscription is sent again (§3.4 step 3), keeping its id. Records are routed to their owner by sub_id.
import { ProjectionKind, type SubRequest, type UiRecord } from '../../shared/gen/projections.ts';
import { type RecordOutcome, readRecord } from './records.ts';

export type RecordHandler = (outcome: RecordOutcome, record: UiRecord) => void;

export interface SubPort {
  sub(subs: SubRequest[]): void;
  unsub(ids: number[]): void;
}

export interface SubParams {
  target?: number;
  p0?: number;
  p1?: number;
  p2?: number;
  p3?: number;
  tail?: Uint8Array;
}

export class Subscriptions {
  private next = 1;
  private readonly live = new Map<number, { req: SubRequest; handler: RecordHandler }>();
  private hover: RecordHandler | null = null;
  private port: SubPort | null = null;
  /** Developer reasons and decode failures, for the dev log and tests. */
  readonly problems: string[] = [];

  /** Attaches the port of the current world (or detaches with null); live subscriptions are sent again. */
  attach(port: SubPort | null): void {
    this.port = port;
    if (port && this.live.size > 0) port.sub([...this.live.values()].map((s) => s.req));
  }

  /** A new state generation: ids restart above every id used so far, and everything is re-sent. */
  resend(): void {
    if (this.port && this.live.size > 0) this.port.sub([...this.live.values()].map((s) => s.req));
  }

  subscribe(kind: number, params: SubParams, handler: RecordHandler): number {
    const id = this.next++;
    const req: SubRequest = {
      sub_id: id,
      kind,
      flags: params.tail ? 1 : 0,
      target: params.target ?? 0,
      p0: params.p0 ?? 0,
      p1: params.p1 ?? 0,
      p2: params.p2 ?? 0,
      p3: params.p3 ?? 0,
      ...(params.tail ? { tail: params.tail } : {}),
    };
    this.live.set(id, { req, handler });
    this.port?.sub([req]);
    return id;
  }

  /** Replaces a subscription's parameters (§15.5: sending an existing sub_id replaces it). */
  replace(id: number, params: SubParams): void {
    const s = this.live.get(id);
    if (!s) return;
    s.req = {
      ...s.req,
      flags: params.tail ? 1 : 0,
      target: params.target ?? s.req.target,
      p0: params.p0 ?? s.req.p0,
      p1: params.p1 ?? s.req.p1,
      p2: params.p2 ?? s.req.p2,
      p3: params.p3 ?? s.req.p3,
      ...(params.tail ? { tail: params.tail } : {}),
    };
    if (!params.tail) delete s.req.tail;
    this.port?.sub([s.req]);
  }

  unsubscribe(id: number): void {
    if (!this.live.delete(id)) return;
    this.port?.unsub([id]);
  }

  /** The hover projection (sub_id 0). */
  onHover(handler: RecordHandler | null): void {
    this.hover = handler;
  }

  has(id: number): boolean {
    return this.live.has(id);
  }

  get size(): number {
    return this.live.size;
  }

  /** Routes the records of one packet's UI section. */
  route(records: readonly UiRecord[]): void {
    for (const r of records) {
      const handler = r.sub_id === 0 ? this.hover : this.live.get(r.sub_id)?.handler;
      if (!handler) continue;
      let outcome: RecordOutcome;
      try {
        outcome = readRecord(r);
      } catch (e) {
        this.problems.push(`sub ${r.sub_id}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (outcome.status === 'invalid') {
        const name = Object.entries(ProjectionKind).find(([, v]) => v === r.kind)?.[0] ?? String(r.kind);
        this.problems.push(`sub ${r.sub_id} (${name}): invalid, reason ${outcome.reason}`);
      }
      // A gone or invalid subscription is dropped by the sim (§15.5); forget it here too.
      if (outcome.status !== 'ok' && r.sub_id !== 0) this.live.delete(r.sub_id);
      handler(outcome, r);
    }
  }
}
