// SEAM (C7 → C1b): a stand-in for the schema package's generated packet decoders, so the audio layer can be
// built and tested before `src/shared/gen/` has them. It reads the render packet of 10 §15.4 (the header,
// the section directory) and the EVENTS and AUDIO_WORKING sections of §15.6, little-endian, and offers them
// through `AudioPacketView`. `encodePacket` writes the same layout for tests and the dev page's load
// generator. Replace with the generated decoders at merge time (feed/types.ts explains the seam).
import { type AudioEventRecord, type AudioPacketView, EVENT, type WorkingRecord } from './types.ts';

export const PACKET_MAGIC = 0x4b505750; // "PWPK"
export const SECTION = { EVENTS: 11, AUDIO_WORKING: 13 } as const;
const HEADER = 32;
const DIR = 16;

/** A view over one packet's bytes. Throws on a malformed packet (bad magic, sections out of bounds). */
export class StandinPacket implements AudioPacketView {
  readonly generation: number;
  readonly tick: number;
  readonly eventCount: number;
  readonly workingCount: number;
  private readonly dv: DataView;
  /** Byte offsets of each event record, filled once per packet. */
  private readonly eventAt: number[] = [];
  private readonly workAt: number;

  constructor(bytes: ArrayBuffer | ArrayBufferView) {
    this.dv =
      bytes instanceof ArrayBuffer
        ? new DataView(bytes)
        : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dv = this.dv;
    if (dv.byteLength < HEADER || dv.getUint32(0, true) !== PACKET_MAGIC)
      throw new Error('not a render packet');
    this.generation = dv.getUint32(8, true);
    this.tick = dv.getUint32(12, true);
    const sections = dv.getUint16(22, true);
    let events: [number, number, number] | null = null;
    let working: [number, number] | null = null;
    for (let s = 0; s < sections; s++) {
      const d = HEADER + s * DIR;
      if (d + DIR > dv.byteLength) throw new Error('section directory out of bounds');
      const type = dv.getUint16(d, true);
      const off = dv.getUint32(d + 4, true);
      const len = dv.getUint32(d + 8, true);
      const count = dv.getUint32(d + 12, true);
      if (off + len > dv.byteLength) throw new Error(`section ${type} out of bounds`);
      if (type === SECTION.EVENTS) events = [off, len, count];
      else if (type === SECTION.AUDIO_WORKING) working = [off, count];
    }
    if (events) {
      let p = events[0];
      const end = events[0] + events[1];
      for (let i = 0; i < events[2] && p + 16 <= end; i++) {
        this.eventAt.push(p);
        const len = dv.getUint16(p + 2, true);
        p += 16 + ((len + 3) & ~3);
      }
    }
    this.eventCount = this.eventAt.length;
    this.workAt = working ? working[0] : 0;
    this.workingCount = working ? working[1] : 0;
  }

  readEvent(i: number, out: AudioEventRecord): void {
    const dv = this.dv;
    const p = this.eventAt[i] as number;
    const type = dv.getUint16(p, true);
    const len = dv.getUint16(p + 2, true);
    out.type = type;
    out.tick = dv.getUint32(p + 4, true);
    out.player = dv.getUint16(p + 12, true);
    out.flags = dv.getUint8(p + 14);
    out.proto = -1;
    out.entityFlags = 0;
    out.reason = -1;
    out.x = Number.NaN;
    out.y = Number.NaN;
    const q = p + 16;
    const fine = (o: number) => {
      out.x = dv.getInt32(q + o, true) / 256;
      out.y = dv.getInt32(q + o + 4, true) / 256;
    };
    const tile2 = (o: number) => {
      out.x = dv.getInt32(q + o, true) / 2;
      out.y = dv.getInt32(q + o + 4, true) / 2;
    };
    switch (type) {
      case EVENT.action_failed:
        if (len >= 12) {
          out.reason = dv.getUint16(q, true);
          fine(4);
        }
        break;
      case EVENT.entity_built:
        if (len >= 16) {
          out.proto = dv.getUint16(q + 4, true);
          out.entityFlags = dv.getUint8(q + 7);
          tile2(8);
        }
        break;
      case EVENT.entity_mined:
        if (len >= 16) {
          out.proto = dv.getUint16(q + 4, true);
          tile2(8);
        }
        break;
      case EVENT.entity_rotated:
        if (len >= 16) tile2(8);
        break;
      case EVENT.alert_raised:
        if (len >= 16) {
          out.reason = dv.getUint16(q, true);
          tile2(8);
        }
        break;
    }
  }

  readWorking(i: number, out: WorkingRecord): void {
    const dv = this.dv;
    const p = this.workAt + i * 16;
    out.sound = dv.getUint16(p, true);
    out.n = dv.getUint16(p + 2, true);
    out.cx = dv.getFloat32(p + 4, true);
    out.cy = dv.getFloat32(p + 8, true);
    out.wsum = dv.getFloat32(p + 12, true);
  }
}

export interface EventSpec {
  type: number;
  tick: number;
  player?: number;
  historical?: boolean;
  proto?: number;
  ghost?: boolean;
  reason?: number;
  x?: number;
  y?: number;
}

/** Writes a packet with an EVENTS section and, unless `working` is null, an AUDIO_WORKING section. */
export function encodePacket(
  generation: number,
  tick: number,
  events: readonly EventSpec[],
  working: readonly WorkingRecord[] | null,
): ArrayBuffer {
  const evBytes = events.length * 32;
  const sections = working === null ? 1 : 2;
  const dirEnd = HEADER + sections * DIR;
  const evOff = (dirEnd + 7) & ~7;
  const wOff = (evOff + evBytes + 7) & ~7;
  const total = wOff + (working?.length ?? 0) * 16;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  dv.setUint32(0, PACKET_MAGIC, true);
  dv.setUint16(4, 1, true);
  dv.setUint32(8, generation, true);
  dv.setUint32(12, tick, true);
  dv.setUint16(22, sections, true);
  dv.setUint32(24, total, true);
  dv.setUint16(HEADER, SECTION.EVENTS, true);
  dv.setUint32(HEADER + 4, evOff, true);
  dv.setUint32(HEADER + 8, evBytes, true);
  dv.setUint32(HEADER + 12, events.length, true);
  if (working) {
    dv.setUint16(HEADER + DIR, SECTION.AUDIO_WORKING, true);
    dv.setUint32(HEADER + DIR + 4, wOff, true);
    dv.setUint32(HEADER + DIR + 8, working.length * 16, true);
    dv.setUint32(HEADER + DIR + 12, working.length, true);
  }
  events.forEach((e, i) => {
    const p = evOff + i * 32;
    dv.setUint16(p, e.type, true);
    dv.setUint16(p + 2, 16, true);
    dv.setUint32(p + 4, e.tick, true);
    dv.setUint16(p + 12, e.player ?? 0xffff, true);
    dv.setUint8(p + 14, e.historical ? 1 : 0);
    const q = p + 16;
    const x = e.x ?? 0;
    const y = e.y ?? 0;
    if (e.type === EVENT.action_failed) {
      dv.setUint16(q, e.reason ?? 0, true);
      dv.setInt32(q + 4, Math.round(x * 256), true);
      dv.setInt32(q + 8, Math.round(y * 256), true);
    } else {
      if (e.type === EVENT.alert_raised) dv.setUint16(q, e.reason ?? 0, true);
      else dv.setUint16(q + 4, e.proto ?? 0, true);
      dv.setUint8(q + 7, e.ghost ? 1 : 0);
      dv.setInt32(q + 8, Math.round(x * 2), true);
      dv.setInt32(q + 12, Math.round(y * 2), true);
    }
  });
  working?.forEach((w, i) => {
    const p = wOff + i * 16;
    dv.setUint16(p, w.sound, true);
    dv.setUint16(p + 2, w.n, true);
    dv.setFloat32(p + 4, w.cx, true);
    dv.setFloat32(p + 8, w.cy, true);
    dv.setFloat32(p + 12, w.wsum, true);
  });
  return buf;
}
