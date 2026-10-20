// The digest ring (10 §4.8 item 6): the last 36,000 per-tick digests d_t (288 kB), kept by the shell for bug
// bundles (§8.5) and desync reports (11 §5.3). Words, not BigInts, so a tick allocates nothing.

export const DIGEST_RING_TICKS = 36000;

export class DigestRing {
  private readonly words = new Uint32Array(DIGEST_RING_TICKS * 2);
  /** The newest tick stored, and how many consecutive ticks up to it are held. */
  last = 0;
  count = 0;

  /** Stores d_t (its words signed or unsigned); a tick that does not follow the last starts the ring afresh. */
  push(tick: number, lo: number, hi: number): void {
    if (this.count > 0 && tick !== this.last + 1) this.count = 0;
    const i = (tick % DIGEST_RING_TICKS) * 2;
    this.words[i] = lo;
    this.words[i + 1] = hi;
    this.last = tick;
    if (this.count < DIGEST_RING_TICKS) this.count += 1;
  }

  /** The oldest tick held (meaningful when count > 0). */
  get first(): number {
    return this.last - this.count + 1;
  }

  has(tick: number): boolean {
    return this.count > 0 && tick <= this.last && tick >= this.first;
  }

  lo(tick: number): number {
    return this.words[(tick % DIGEST_RING_TICKS) * 2] as number;
  }

  hi(tick: number): number {
    return this.words[(tick % DIGEST_RING_TICKS) * 2 + 1] as number;
  }

  /** d_t as a u64. */
  get(tick: number): bigint {
    return (BigInt(this.hi(tick)) << 32n) | BigInt(this.lo(tick));
  }

  /** The ring's bytes for a bundle: `u32 first tick, u32 count`, then count × (u32 d low, u32 d high). */
  bytes(): ArrayBuffer {
    const out = new ArrayBuffer(8 + this.count * 8);
    const v = new DataView(out);
    v.setUint32(0, this.count > 0 ? this.first : 0, true);
    v.setUint32(4, this.count, true);
    for (let k = 0; k < this.count; k++) {
      const t = this.first + k;
      v.setUint32(8 + k * 8, this.lo(t), true);
      v.setUint32(12 + k * 8, this.hi(t), true);
    }
    return out;
  }
}
