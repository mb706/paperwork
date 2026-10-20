// Packets and pooling with transferables (10 §3.2, §15.4 "Pooling and transfer"). The shell keeps three packet
// buffers, starting at 256 KiB and doubling on demand. It copies the module's packet out of linear memory into
// a free buffer, fills `state_gen` and `view_seq` in the header (the module leaves them zero), and transfers
// it; the main thread transfers it back with `ack`. With no free buffer, extraction is skipped (backpressure):
// the module's presentation state advances only when a packet is written, so nothing is lost.
//
// No allocation per packet: the copy runs over cached 32-bit word views (the envelope's bytes start 4-aligned,
// §15.8), and the views of a buffer are made once, when it comes back.
import { PACKET_BUFFER_INITIAL_BYTES, PACKET_BUFFERS } from '../shared/gen/packet.ts';
import { PACKET_STATE_GEN_OFFSET, PACKET_VIEW_SEQ_OFFSET } from '../shared/protocol.ts';

/** A pooled buffer with its views. */
export interface PacketSlot {
  buf: ArrayBuffer;
  u8: Uint8Array;
  u32: Uint32Array;
  dv: DataView;
}

const slot = (buf: ArrayBuffer): PacketSlot => ({
  buf,
  u8: new Uint8Array(buf),
  u32: new Uint32Array(buf, 0, buf.byteLength >>> 2),
  dv: new DataView(buf),
});

export class PacketPool {
  private readonly free: PacketSlot[] = [];
  private readonly count: number;
  /** Buffers out with the main thread. */
  out = 0;
  /** Buffers ever grown past their size (a packet larger than any free buffer). */
  grown = 0;

  constructor(count = PACKET_BUFFERS, bytes = PACKET_BUFFER_INITIAL_BYTES) {
    this.count = count;
    for (let i = 0; i < count; i++) this.free.push(slot(new ArrayBuffer(bytes)));
  }

  get available(): number {
    return this.free.length;
  }

  /** A free buffer of at least `bytes`, or null (backpressure). A small free buffer is replaced by one twice as large until it fits. */
  take(bytes: number): PacketSlot | null {
    const s = this.free.pop();
    if (!s) return null;
    this.out += 1;
    if (s.buf.byteLength >= bytes) return s;
    let size = s.buf.byteLength;
    while (size < bytes) size *= 2;
    this.grown += 1;
    return slot(new ArrayBuffer(size));
  }

  /** A buffer beyond the pool, for a packet that must go out (a world's first, §3.4); it joins the pool on `ack`. */
  extra(bytes: number): PacketSlot {
    let size = PACKET_BUFFER_INITIAL_BYTES;
    while (size < bytes) size *= 2;
    this.out += 1;
    return slot(new ArrayBuffer(size));
  }

  /** A buffer back from the main thread (`ack`). */
  release(buf: ArrayBuffer): void {
    if (buf.byteLength === 0) return; // detached or foreign: nothing to reuse
    this.out = Math.max(0, this.out - 1);
    if (this.free.length < this.count) this.free.push(slot(buf));
  }

  /** Returns a buffer that was taken but not sent. */
  putBack(s: PacketSlot): void {
    this.out = Math.max(0, this.out - 1);
    this.free.push(s);
  }
}

/**
 * Copies `len` bytes of linear memory at `at` (4-aligned) into the slot, word by word, and fills the header's
 * state generation and view sequence.
 */
export function fillPacket(
  s: PacketSlot,
  memU32: Uint32Array,
  memU8: Uint8Array,
  at: number,
  len: number,
  stateGen: number,
  viewSeq: number,
): void {
  const words = len >>> 2;
  const base = at >>> 2;
  const dst = s.u32;
  for (let i = 0; i < words; i++) dst[i] = memU32[base + i] as number;
  for (let i = words << 2; i < len; i++) s.u8[i] = memU8[at + i] as number;
  s.dv.setUint32(PACKET_STATE_GEN_OFFSET, stateGen >>> 0, true);
  s.dv.setUint32(PACKET_VIEW_SEQ_OFFSET, viewSeq >>> 0, true);
}
