// The main thread's side of subscriptions (10 §7.3, §15.5): a window that opens subscribes to the projections it
// shows and unsubscribes when it closes. The host allocates sub_ids (never reused) and sends every live
// subscription again to a new world (§3.4 step 3), so an open entity window rebinds by serial, and closes on the
// `gone` that follows when its entity does not exist there. sub_id 0 is the hover projection, driven by the view
// request's `hovered_serial`. Records are routed to their owner by sub_id; a gone or invalid subscription is
// dropped by the sim (§15.5), and here too, so the host stops re-sending it.
import { ProjectionKind, type SubRequest, type UiRecord } from '../../shared/gen/projections.ts';
import { type RecordOutcome, readRecord } from './records.ts';

export type RecordHandler = (outcome: RecordOutcome, record: UiRecord) => void;

/** Where subscriptions go (the host). */
export interface SubSink {
  subscribe(req: Omit<SubRequest, 'sub_id'>): number;
  resubscribe(id: number, req: Omit<SubRequest, 'sub_id'>): void;
  unsubscribe(ids: number[]): void;
}

export interface SubParams {
  target?: number;
  p0?: number;
  p1?: number;
  p2?: number;
  p3?: number;
  tail?: Uint8Array;
}

const request = (kind: number, params: SubParams): Omit<SubRequest, 'sub_id'> => ({
  kind,
  flags: params.tail ? 1 : 0,
  target: params.target ?? 0,
  p0: params.p0 ?? 0,
  p1: params.p1 ?? 0,
  p2: params.p2 ?? 0,
  p3: params.p3 ?? 0,
  ...(params.tail ? { tail: params.tail } : {}),
});

export class Subscriptions {
  private readonly sink: SubSink;
  private readonly live = new Map<number, { kind: number; params: SubParams; handler: RecordHandler }>();
  private hover: RecordHandler | null = null;
  /** Developer reasons and decode failures, for the dev log and tests. */
  readonly problems: string[] = [];

  constructor(sink: SubSink) {
    this.sink = sink;
  }

  subscribe(kind: number, params: SubParams, handler: RecordHandler): number {
    const id = this.sink.subscribe(request(kind, params));
    this.live.set(id, { kind, params, handler });
    return id;
  }

  /** Replaces a subscription's parameters (§15.5: sending an existing sub_id replaces it). */
  replace(id: number, params: SubParams): void {
    const s = this.live.get(id);
    if (!s) return;
    s.params = { ...s.params, ...params };
    if (!params.tail) delete s.params.tail;
    this.sink.resubscribe(id, request(s.kind, s.params));
  }

  unsubscribe(id: number): void {
    if (!this.live.delete(id)) return;
    this.sink.unsubscribe([id]);
  }

  /** Every subscription goes (back to the menu). */
  clear(): void {
    const ids = [...this.live.keys()];
    this.live.clear();
    if (ids.length > 0) this.sink.unsubscribe(ids);
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
      if (outcome.status !== 'ok' && r.sub_id !== 0 && this.live.delete(r.sub_id))
        this.sink.unsubscribe([r.sub_id]);
      handler(outcome, r);
    }
  }
}
