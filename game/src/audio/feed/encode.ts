// Render packets for tests and the dev page's load generator, written with the schema package's generated
// writer (10 §15.4, §15.6), so they are byte for byte what extraction sends: an EVENTS section and, unless
// `working` is null, an AUDIO_WORKING section.
import { Writer } from '../../shared/gen/codec.ts';
import {
  EntityBuiltFlags,
  EventFlags,
  type EventPayload,
  EventType,
  ItemCraftedEventCodec,
  MilestoneEventCodec,
  ResearchCompletedEventCodec,
  writeEvent,
} from '../../shared/gen/events.ts';
import {
  AudioWorkingCodec,
  PacketHeaderCodec,
  PacketSection,
  PacketWriter,
} from '../../shared/gen/packet.ts';
import { AlertType, FailReason } from '../../shared/gen/types.ts';
import type { WorkingRecord } from './types.ts';

/** An event as a test or the load generator describes it; positions in tiles. */
export interface EventSpec {
  type: number;
  tick: number;
  /** 0xFFFF (none) by default. */
  player?: number;
  historical?: boolean;
  proto?: number;
  ghost?: boolean;
  /** action_failed: a FailReason; alert_raised: an AlertType. */
  reason?: number;
  x?: number;
  y?: number;
}

function payload(e: EventSpec): EventPayload {
  const pos = { x2: Math.round((e.x ?? 0) * 2), y2: Math.round((e.y ?? 0) * 2) };
  switch (e.type) {
    case EventType.action_failed:
      return {
        type: 'action_failed',
        reason: e.reason ?? FailReason.out_of_reach,
        pos: { x: Math.round((e.x ?? 0) * 256), y: Math.round((e.y ?? 0) * 256) },
        serial: 0,
      };
    case EventType.entity_built:
      return {
        type: 'entity_built',
        serial: 1,
        proto: e.proto ?? 0,
        dir: 0,
        flags: e.ghost ? EntityBuiltFlags.ghost : 0,
        pos,
      };
    case EventType.entity_mined:
      return { type: 'entity_mined', serial: 1, proto: e.proto ?? 0, pos };
    case EventType.entity_rotated:
      return { type: 'entity_rotated', serial: 1, dir: 0, pos };
    case EventType.alert_raised:
      return { type: 'alert_raised', alert: e.reason ?? AlertType.entity_destroyed, serial: 0, pos };
    case EventType.research_completed:
      return { type: 'research_completed', ...ResearchCompletedEventCodec.defaults() };
    case EventType.item_crafted:
      return { type: 'item_crafted', ...ItemCraftedEventCodec.defaults() };
    case EventType.milestone:
      return { type: 'milestone', ...MilestoneEventCodec.defaults() };
    case EventType.player_joined:
      return { type: 'player_joined' };
    case EventType.player_left:
      return { type: 'player_left' };
    case EventType.input_fenced:
      return { type: 'input_fenced' };
    case EventType.loop_closed:
      return { type: 'loop_closed' };
    case EventType.victory:
      return { type: 'victory' };
    default:
      throw new Error(`encodePacket: no payload for event type ${e.type}`);
  }
}

/** One render packet's bytes, as the simulation's extraction writes them. */
export function encodePacket(
  generation: number,
  tick: number,
  events: readonly EventSpec[],
  working: readonly WorkingRecord[] | null,
): Uint8Array {
  const w = new Writer();
  const pw = new PacketWriter(w, working === null ? 1 : 2, tick, 0, 0);
  pw.section(PacketSection.events);
  for (const e of events)
    writeEvent(
      w,
      {
        tick: e.tick,
        seq: 0,
        player: e.player ?? 0xffff,
        flags: e.historical ? EventFlags.historical : 0,
        surface: 0,
      },
      payload(e),
    );
  pw.end(events.length);
  if (working) {
    pw.section(PacketSection.audio_working);
    for (const r of working) AudioWorkingCodec.write(w, r);
    pw.end(working.length);
  }
  pw.finish();
  const bytes = w.finish();
  // the writer leaves the state generation at 0 (the worker stamps it, 10 §3.4); tests need others
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    PacketHeaderCodec.OFFSET.state_gen,
    generation,
    true,
  );
  return bytes;
}
