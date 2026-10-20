// The closure log the shell records (10 §8.5 "Recording", S8): every closure since the last autosave (or since
// the world's start), with the blobs they name and the per-tick digests, in the `*.pwlog` format of §8.5. It is
// the bug bundle's replay input and the trap's reproduction (§3.6 step 3): the shell records each closure
// before `sim_tick` runs it, so the closure of a trapping tick is in the log. Its cost is the closures
// themselves, a few kilobytes per minute of play; records are kept in the log's own record format, so writing
// the log is one copy. Ticks without actions are not recorded (§8.5).

import { ACTION_SCHEMA_VERSION } from '../shared/gen/actions.ts';
import {
  CLOSURE_LOG_FORMAT_VERSION,
  CLOSURE_LOG_MAGIC,
  ClosureLogHeaderCodec,
} from '../shared/gen/container.ts';
import type { LogBase } from '../shared/protocol.ts';
import type { DigestRing } from './digests.ts';
import { closureBlobs } from './sequencer.ts';

/** The recorder stops recording beyond this (an autosave that never succeeds), with a warning. */
export const CLOSURE_LOG_MAX_BYTES = 64 << 20;

const hexBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
};

export class ClosureLogRecorder {
  base: LogBase | null = null;
  /** The base state's full state hash (§4.8) and its tick. */
  baseTick = 0;
  baseStateHash = 0n;
  private buf = new Uint8Array(65536);
  private top = 0;
  private count = 0;
  /** Blobs the recorded closures name: hex SHA-256 → bytes, and the last tick that names each. */
  private readonly blobs = new Map<string, { bytes: Uint8Array; tick: number }>();
  /** Recording stopped: the log grew past CLOSURE_LOG_MAX_BYTES. */
  full = false;

  /** Starts a log at a base state. */
  start(base: LogBase, tick: number, stateHash: bigint): void {
    this.base = base;
    this.baseTick = tick;
    this.baseStateHash = stateHash;
    this.top = 0;
    this.count = 0;
    this.blobs.clear();
    this.full = false;
  }

  /** Records tick `tick`'s closure: `len` bytes of `src` from `at` (linear memory, just written). */
  record(tick: number, src: Uint8Array, at: number, len: number): void {
    if (len === 0 || this.full || !this.base) return;
    if (this.top + 8 + len > CLOSURE_LOG_MAX_BYTES) {
      this.full = true;
      return;
    }
    if (this.top + 8 + len > this.buf.length) {
      let size = this.buf.length * 2;
      while (size < this.top + 8 + len) size *= 2;
      const b = new Uint8Array(size);
      b.set(this.buf.subarray(0, this.top));
      this.buf = b;
    }
    const b = this.buf;
    const o = this.top;
    b[o] = tick & 0xff;
    b[o + 1] = (tick >>> 8) & 0xff;
    b[o + 2] = (tick >>> 16) & 0xff;
    b[o + 3] = tick >>> 24;
    b[o + 4] = len & 0xff;
    b[o + 5] = (len >>> 8) & 0xff;
    b[o + 6] = (len >>> 16) & 0xff;
    b[o + 7] = len >>> 24;
    for (let i = 0; i < len; i++) b[o + 8 + i] = src[at + i] as number;
    this.top = o + 8 + len;
    this.count += 1;
  }

  /** Keeps a blob a recorded tick names (`sim_blob_put`'s input: sha256 ‖ bytes). */
  recordBlob(tick: number, put: Uint8Array): void {
    let hex = '';
    for (let i = 0; i < 32; i++)
      hex += ((put[i] as number) < 16 ? '0' : '') + (put[i] as number).toString(16);
    this.blobs.set(hex, { bytes: put.slice(32), tick });
  }

  get records(): number {
    return this.count;
  }

  get bytes(): number {
    return this.top;
  }

  /**
   * A new base (an autosave stored at `tick`): records up to `tick` go, later ones stay, so the log keeps
   * starting where its base does.
   */
  rebase(base: LogBase, tick: number, stateHash: bigint): void {
    let at = 0;
    let kept = 0;
    while (at < this.top) {
      const t = this.u32(at);
      const len = this.u32(at + 4);
      if (t > tick) break;
      at += 8 + len;
      kept += 1;
    }
    this.buf.copyWithin(0, at, this.top);
    this.top -= at;
    this.count -= kept;
    for (const [h, b] of this.blobs) if (b.tick <= tick) this.blobs.delete(h);
    this.base = base;
    this.baseTick = tick;
    this.baseStateHash = stateHash;
    this.full = false;
  }

  private u32(at: number): number {
    const b = this.buf;
    return (
      ((b[at] as number) |
        ((b[at + 1] as number) << 8) |
        ((b[at + 2] as number) << 16) |
        ((b[at + 3] as number) << 24)) >>>
      0
    );
  }

  /**
   * The log from the base to `endTick` (§8.5): records in (base tick, endTick], the digests the ring holds for
   * (base tick, `digestsThrough`], and the blobs the records name, ascending by hash. `buildHash` and
   * `prototypesHash` are hex.
   */
  write(
    endTick: number,
    ring: DigestRing,
    digestsThrough: number,
    buildHash: string,
    prototypesHash: string,
  ): Uint8Array {
    // Records past endTick (never, in practice) are left out.
    let recBytes = 0;
    let recCount = 0;
    const names = new Set<string>();
    for (let at = 0; at < this.top; ) {
      const t = this.u32(at);
      const len = this.u32(at + 4);
      if (t > endTick) break;
      for (const h of closureBlobs(this.buf.subarray(at + 8, at + 8 + len))) names.add(h);
      recBytes += 8 + len;
      recCount += 1;
      at += 8 + len;
    }
    // The digests the ring still holds within (base tick, min(digestsThrough, endTick)].
    let digestCount = 0;
    let first = this.baseTick + 1;
    if (ring.count > 0) {
      first = Math.max(first, ring.first);
      const last = Math.min(digestsThrough, endTick, ring.last);
      digestCount = last >= first ? last - first + 1 : 0;
    }
    const blobs = [...names]
      .sort()
      .map((h) => ({ h, b: this.blobs.get(h)?.bytes }))
      .filter((x): x is { h: string; b: Uint8Array } => x.b !== undefined);
    const blobBytes = blobs.reduce((n, x) => n + 36 + x.b.length, 0);
    const out = new Uint8Array(ClosureLogHeaderCodec.SIZE + recBytes + 8 * digestCount + blobBytes);
    const v = new DataView(out.buffer);
    const O = ClosureLogHeaderCodec.OFFSET;
    v.setUint32(O.magic, CLOSURE_LOG_MAGIC, true);
    v.setUint16(O.format_version, CLOSURE_LOG_FORMAT_VERSION, true);
    v.setUint8(O.action_schema_version, ACTION_SCHEMA_VERSION);
    v.setUint8(O.flags, digestCount > 0 ? 1 : 0);
    v.setUint32(O.start_tick, this.baseTick, true);
    v.setUint32(O.end_tick, Math.max(endTick, this.baseTick), true);
    out.set(hexBytes(buildHash), O.build_hash);
    out.set(hexBytes(prototypesHash), O.prototypes_hash);
    v.setBigUint64(O.start_state_hash, this.baseStateHash, true);
    v.setUint32(O.record_count, recCount, true);
    v.setUint32(O.record_bytes, recBytes, true);
    v.setUint32(O.digest_first_tick, digestCount > 0 ? first : 0, true);
    v.setUint32(O.digest_count, digestCount, true);
    v.setUint32(O.blob_count, blobs.length, true);
    v.setUint32(O.blob_bytes, blobBytes, true);
    let o = ClosureLogHeaderCodec.SIZE;
    out.set(this.buf.subarray(0, recBytes), o);
    o += recBytes;
    for (let t = first; t < first + digestCount; t++) {
      v.setUint32(o, ring.lo(t), true);
      v.setUint32(o + 4, ring.hi(t), true);
      o += 8;
    }
    for (const x of blobs) {
      out.set(hexBytes(x.h), o);
      v.setUint32(o + 32, x.b.length, true);
      out.set(x.b, o + 36);
      o += 36 + x.b.length;
    }
    return out;
  }
}
