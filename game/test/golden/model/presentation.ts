// What the module remembers for its outputs (10 §3.6 `PresentationState`): the event queue the tick writes
// through its sink, and the per-character motion extraction reads. Never saved, hashed or read by a rule.
import { Writer } from '../../../src/shared/gen/codec.ts';
import {
  EVENT_QUEUE_MAX_BYTES,
  EVENT_QUEUE_MAX_EVENTS,
  type EventMeta,
  type EventPayload,
  writeEvent,
} from '../../../src/shared/gen/events.ts';

export interface QueuedEvent {
  meta: EventMeta;
  payload: EventPayload;
  /** The record's bytes in the EVENTS section (16-byte header, payload, padding to 4). */
  bytes: Uint8Array;
}

/**
 * The event queue (§15.6): events accumulate from the tick that produced them until an extraction drains
 * them, at most 8,192 events or 512 KiB of records; on overflow the oldest are dropped and the next packet
 * carries EVENTS_DROPPED.
 */
export class EventSink {
  queue: QueuedEvent[] = [];
  dropped = false;
  /** The module's HISTORICAL flag (§15.8 `sim_set_flags` bit 1): marks events of catch-up and replay. */
  historical = false;
  private size = 0;

  push(meta: Omit<EventMeta, 'flags'>, payload: EventPayload): void {
    const full: EventMeta = { ...meta, flags: this.historical ? 1 : 0 };
    const w = new Writer();
    writeEvent(w, full, payload);
    const bytes = w.finish();
    this.queue.push({ meta: full, payload, bytes });
    this.size += bytes.length;
    while (this.queue.length > EVENT_QUEUE_MAX_EVENTS || this.size > EVENT_QUEUE_MAX_BYTES) {
      const old = this.queue.shift() as QueuedEvent;
      this.size -= old.bytes.length;
      this.dropped = true;
    }
  }

  drain(): { events: QueuedEvent[]; dropped: boolean } {
    const out = { events: this.queue, dropped: this.dropped };
    this.queue = [];
    this.size = 0;
    this.dropped = false;
    return out;
  }
}

export class Presentation {
  readonly events = new EventSink();
  /**
   * Each character's displacement in the last tick it was updated, in tiles (MOVERS' velocity, §15.4):
   * written by the tick, read by extraction; (0, 0) after a load until the character next moves.
   */
  readonly lastMove = new Map<number, { dx: number; dy: number }>();
}
