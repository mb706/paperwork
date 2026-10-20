// Packets and pooling with transferables (10 §3.2, §15.4 "Pooling and transfer"). The shell keeps three packet
// buffers, starting at 256 KiB and doubling on demand. It copies the module's packet out of linear memory into
// a free buffer, fills `state_gen` and `view_seq` in the header (the module leaves them zero), and transfers
// it; the main thread transfers it back with `ack`. With no free buffer, extraction is skipped (backpressure):
// the module's presentation state advances only when a packet is written, so nothing is lost.
//
// No allocation per packet in the shell: the copy runs over cached 32-bit word views (the envelope's bytes start
// 4-aligned, §15.8), and the slot objects are kept for good. A buffer that comes back across threads is a new
// ArrayBuffer object (the structured clone makes it, with the `ack` message); the slot it returns to is re-pointed
// at it, which costs its two views (C3-r1 15). In-process (`?sim=inline`, the tests) the same buffer object comes
// back and keeps its views.
import { PACKET_BUFFER_INITIAL_BYTES, PACKET_BUFFERS } from '../shared/gen/packet.ts';
import { PACKET_STATE_GEN_OFFSET, PACKET_VIEW_SEQ_OFFSET } from '../shared/protocol.ts';

/** A pooled buffer with its views (re-pointed when its buffer comes back as another object). */
export interface PacketSlot {
  buf: ArrayBuffer;
  u8: Uint8Array;
  u32: Uint32Array;
}

const point = (s: PacketSlot, buf: ArrayBuffer): PacketSlot => {
  s.buf = buf;
  s.u8 = new Uint8Array(buf);
  s.u32 = new Uint32Array(buf, 0, buf.byteLength >>> 2);
  return s;
};
const slot = (buf: ArrayBuffer): PacketSlot =>
  point({ buf, u8: new Uint8Array(0), u32: new Uint32Array(0) }, buf);

/** How many posted slots the pool remembers (more than it ever has out). */
const SENT = 8;

export class PacketPool {
  private readonly free: PacketSlot[] = [];
  private readonly count: number;
  /** Buffers out with the main thread. */
  out = 0;
  /** Buffers ever grown past their size (a packet larger than any free buffer). */
  grown = 0;
  /** Slot objects made after the pool's own (a buffer grown, a packet beyond the pool), for tests. */
  made = 0;

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
    return point(s, new ArrayBuffer(size));
  }

  /** A buffer beyond the pool, for a packet that must go out (a world's first, §3.4); it joins the pool on `ack`. */
  extra(bytes: number): PacketSlot {
    let size = PACKET_BUFFER_INITIAL_BYTES;
    while (size < bytes) size *= 2;
    this.out += 1;
    this.made += 1;
    return slot(new ArrayBuffer(size));
  }

  /** The slots posted and not yet back (a fixed ring). */
  private readonly sent: (PacketSlot | null)[] = new Array<PacketSlot | null>(SENT).fill(null);
  private sentAt = 0;

  /** A slot was posted. */
  posted(s: PacketSlot): void {
    this.sent[this.sentAt] = s;
    this.sentAt = (this.sentAt + 1) & (SENT - 1);
  }

  /**
   * A buffer back from the main thread (`ack`). The same object (in-process) returns to its slot with its views;
   * a transferred one (another object) takes over a posted slot, any one: they are interchangeable.
   */
  release(buf: ArrayBuffer): void {
    if (buf.byteLength === 0) return; // detached or foreign: nothing to reuse
    this.out = Math.max(0, this.out - 1);
    let other = -1;
    for (let i = 0; i < SENT; i++) {
      const s = this.sent[i];
      if (!s) continue;
      if (s.buf === buf) {
        this.sent[i] = null;
        if (this.free.length < this.count) this.free.push(s);
        return;
      }
      if (other < 0) other = i;
    }
    if (this.free.length >= this.count) return;
    if (other >= 0) {
      const s = this.sent[other] as PacketSlot;
      this.sent[other] = null;
      this.free.push(point(s, buf));
      return;
    }
    this.made += 1;
    this.free.push(slot(buf));
  }

  /** Returns a buffer that was taken but not sent. */
  putBack(s: PacketSlot): void {
    this.out = Math.max(0, this.out - 1);
    this.free.push(s);
  }
}

const STATE_GEN_WORD = PACKET_STATE_GEN_OFFSET >>> 2;
const VIEW_SEQ_WORD = PACKET_VIEW_SEQ_OFFSET >>> 2;

/**
 * Copies `len` bytes of linear memory at `at` (4-aligned) into the slot, word by word, and fills the header's
 * state generation and view sequence (little-endian words, as WebAssembly's memory and §15.4's packets are).
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
  dst[STATE_GEN_WORD] = stateGen >>> 0;
  dst[VIEW_SEQ_WORD] = viewSeq >>> 0;
}
