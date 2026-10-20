// The audio module's view of the simulation's output, over the schema package's generated decoders
// (10 §15.4–§15.6; C1b's `src/shared/gen/`). The app decodes each render packet once (`decodePacket`) for
// every consumer and hands it to `AudioSystem.onRenderPacket`; audio reads its two sections, EVENTS and
// AUDIO_WORKING, through the generated field offsets and accessors, allocating nothing per record. The HUD
// projection gives the music feed.
import {
  ActionFailedEventCodec,
  AlertRaisedEventCodec,
  EntityBuiltEventCodec,
  EntityMinedEventCodec,
  EntityRotatedEventCodec,
  EventHeaderCodec,
  EventType,
} from '../../shared/gen/events.ts';
import { AudioWorkingCodec, type Packet, PacketSection } from '../../shared/gen/packet.ts';
import { type Hud, HudFlags } from '../../shared/gen/projections.ts';
import { FinePosCodec, TilePos2Codec } from '../../shared/gen/types.ts';
import type { AudioEventRecord, AudioPacketView, MusicFeed, WorkingRecord } from './types.ts';

const HEADER = EventHeaderCodec.SIZE;

/** A reusable view of decoded packets: `set()` points it at the next one. */
export class GenPacketView implements AudioPacketView {
  generation = 0;
  tick = 0;
  eventCount = 0;
  workingCount = 0;
  private events: DataView | null = null;
  /** Byte offsets of the event records in the EVENTS section. */
  private readonly at: number[] = [];
  private working: DataView | null = null;

  set(p: Packet): this {
    this.generation = p.header.state_gen;
    this.tick = p.header.tick;
    this.events = null;
    this.working = null;
    this.at.length = 0;
    this.workingCount = 0;
    for (const s of p.sections) {
      if (s.type === PacketSection.events) {
        const dv = new DataView(s.bytes.buffer, s.bytes.byteOffset, s.bytes.byteLength);
        this.events = dv;
        // records: a 16-byte header, `len` bytes of payload, padding to 4
        let o = 0;
        for (let i = 0; i < s.count && o + HEADER <= dv.byteLength; i++) {
          this.at.push(o);
          o += HEADER + ((EventHeaderCodec.get.len(dv, o) + 3) & ~3);
        }
      } else if (s.type === PacketSection.audio_working) {
        this.working = new DataView(s.bytes.buffer, s.bytes.byteOffset, s.bytes.byteLength);
        this.workingCount = s.count;
      }
    }
    this.eventCount = this.at.length;
    return this;
  }

  readEvent(i: number, out: AudioEventRecord): void {
    const dv = this.events as DataView;
    const o = this.at[i] as number;
    const type = EventHeaderCodec.get.type(dv, o);
    const len = EventHeaderCodec.get.len(dv, o);
    out.type = type;
    out.tick = EventHeaderCodec.get.tick(dv, o);
    out.player = EventHeaderCodec.get.player(dv, o);
    out.flags = EventHeaderCodec.get.flags(dv, o);
    out.proto = -1;
    out.entityFlags = 0;
    out.reason = -1;
    out.x = Number.NaN;
    out.y = Number.NaN;
    const q = o + HEADER;
    switch (type) {
      case EventType.action_failed:
        if (len < ActionFailedEventCodec.PREFIX) return;
        out.reason = ActionFailedEventCodec.get.reason(dv, q);
        fine(dv, q + ActionFailedEventCodec.OFFSET.pos, out);
        return;
      case EventType.entity_built:
        if (len < EntityBuiltEventCodec.PREFIX) return;
        out.proto = EntityBuiltEventCodec.get.proto(dv, q);
        out.entityFlags = EntityBuiltEventCodec.get.flags(dv, q);
        tile2(dv, q + EntityBuiltEventCodec.OFFSET.pos, out);
        return;
      case EventType.entity_mined:
        if (len < EntityMinedEventCodec.PREFIX) return;
        out.proto = EntityMinedEventCodec.get.proto(dv, q);
        tile2(dv, q + EntityMinedEventCodec.OFFSET.pos, out);
        return;
      case EventType.entity_rotated:
        if (len < EntityRotatedEventCodec.PREFIX) return;
        tile2(dv, q + EntityRotatedEventCodec.OFFSET.pos, out);
        return;
      case EventType.alert_raised:
        if (len < AlertRaisedEventCodec.PREFIX) return;
        out.reason = AlertRaisedEventCodec.get.alert(dv, q);
        tile2(dv, q + AlertRaisedEventCodec.OFFSET.pos, out);
        return;
    }
  }

  readWorking(i: number, out: WorkingRecord): void {
    const dv = this.working as DataView;
    const o = i * AudioWorkingCodec.SIZE;
    out.sound = AudioWorkingCodec.get.sound(dv, o);
    out.n = AudioWorkingCodec.get.n(dv, o);
    out.cx = AudioWorkingCodec.get.cx(dv, o);
    out.cy = AudioWorkingCodec.get.cy(dv, o);
    out.wsum = AudioWorkingCodec.get.wsum(dv, o);
  }
}

/** FinePos: 1/256 tile. */
function fine(dv: DataView, o: number, out: AudioEventRecord): void {
  out.x = FinePosCodec.get.x(dv, o) / 256;
  out.y = FinePosCodec.get.y(dv, o) / 256;
}

/** TilePos2: half tiles. */
function tile2(dv: DataView, o: number, out: AudioEventRecord): void {
  out.x = TilePos2Codec.get.x2(dv, o) / 2;
  out.y = TilePos2Codec.get.y2(dv, o) / 2;
}

/** The music feed from the HUD projection (10 §15.5–§15.6), into a reused object. */
export function musicFeedOf(h: Hud, out: MusicFeed): MusicFeed {
  out.literatureYear = h.literature;
  out.consumptionW = h.activity_w;
  out.doublingTime = h.doubling_time_s;
  out.closed = (h.flags & HudFlags.closed) !== 0;
  out.victory = (h.flags & HudFlags.victory) !== 0;
  return out;
}
