// One packet of the shown world, as the UI reads it (10 §15.4–§15.6): the UI section's records go to their
// subscriptions; events are state first and presentation second. State, whatever the event's age: a
// `player_joined` brings the player's CHARACTER subscription back (a new world's character exists from its first
// tick), an `input_fenced` of the local player sends the inputs still held again (10 §15.3, D22; 11 §2.6; C5-r1 10).
// Presentation (flying text, refusals, messages) only for fresh events of this session: none for historical ones
// (§15.6) or ones older than EVENT_STALE_TICKS. The world's chunks and movers are the world view's (C4).
import { EVENT_STALE_TICKS, type EventHeader, type EventPayload, readEvents } from '../shared/gen/events.ts';
import { decodePacket } from '../shared/gen/packet.ts';
import { readUiRecords } from '../shared/gen/projections.ts';
import type { GameStore } from './store/game.ts';

export interface PacketDeps {
  game: GameStore;
  /** The local player (single player: 0). */
  player: number;
  /** Sends the held inputs again (the resolver). */
  reassertHeld(): void;
  /** A fresh event's flying text, refusal or message. */
  present(h: EventHeader, e: EventPayload): void;
}

/** Applies one packet; the bytes are valid only during the call (the host acks the buffer after its listeners). */
export function applyPacket(bytes: Uint8Array, d: PacketDeps): void {
  let p: ReturnType<typeof decodePacket>;
  try {
    p = decodePacket(bytes);
  } catch (err) {
    d.game.subs.problems.push(`packet: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const tick = p.header.tick;
  for (const s of p.sections) {
    if (s.name === 'UI') d.game.applyUi(readUiRecords(s.bytes, s.count));
    else if (s.name === 'EVENTS')
      for (const { header, payload } of readEvents(s.bytes, s.count)) {
        if (payload.type === 'player_joined') d.game.playerJoined(header.player);
        else if (payload.type === 'input_fenced' && header.player === d.player) d.reassertHeld();
        if ((header.flags & 1) !== 0 || header.tick + EVENT_STALE_TICKS < tick) continue;
        d.present(header, payload);
      }
  }
}
