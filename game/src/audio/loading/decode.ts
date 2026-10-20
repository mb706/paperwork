// One decode path everywhere (10 §9.4, "Decoding"): `decodeAudioData` on an OfflineAudioContext created at
// 32 kHz, which resamples to 32 kHz itself and decodes off the main thread; the main thread converts to
// Int16 in slices of at most 1 ms and yields between them; the result is aligned to the manifest's
// canonical timeline (priming that a browser's AAC decoder left in is found by the start fingerprint and
// trimmed). The temporary Float32 audio is bounded: a file holds its permit from its decode until its
// conversion ends, at most two files at once and at most `maxBytes` of decoded audio between them (codex
// C7-r1 finding 9).
import type { Fingerprint } from './manifest.ts';

export interface Expect {
  len: number;
  fp: Fingerprint;
  /** The file's channels, for the memory estimate (2 when unknown). */
  channels?: number;
}

/** Decoded Float32 bytes a file will need: its canonical length (or, unknown, 32× its compressed size). */
export function decodedEstimate(bytes: ArrayBuffer, expect: Expect | null): number {
  if (expect) return (expect.len + 4096) * (expect.channels ?? 2) * 4;
  return bytes.byteLength * 32;
}

/** Yields to the event loop without the timer throttling of hidden pages. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

/**
 * The offset of the canonical signal within a decoded channel: where the fingerprint matches best, searched
 * over [−64, extra + 64] samples, extra being how much longer the decoded signal is.
 */
export function alignOffset(x: Float32Array, len: number, fp: Fingerprint): number {
  const extra = Math.max(0, x.length - len);
  let best = 0;
  let bestErr = Number.POSITIVE_INFINITY;
  let energy = 0;
  for (const v of fp.data) energy += v * v;
  if (energy === 0) return extra > 0 ? extra : 0;
  for (let o = -64; o <= extra + 64; o++) {
    let err = 0;
    for (let i = 0; i < fp.data.length; i++) {
      const j = fp.at + o + i;
      const s = j >= 0 && j < x.length ? (x[j] as number) * 32768 : 0;
      const d = s - (fp.data[i] as number);
      err += d * d;
      if (err >= bestErr) break;
    }
    if (err < bestErr) {
      bestErr = err;
      best = o;
    }
  }
  // a match no better than silence means the fingerprint is unusable: keep the decoder's alignment
  return bestErr < energy ? best : 0;
}

export class Decoder {
  private ctx: BaseAudioContext | null = null;
  private running = 0;
  /** Estimated decoded bytes of the files holding permits. */
  private held = 0;
  /** The most decoded audio held at once so far (the tests read it). */
  maxHeld = 0;
  private readonly queue: { bytes: number; go: () => void }[] = [];
  /** Offsets found (priming left in by this browser's decoder), for the log. */
  readonly misaligned: number[] = [];

  readonly rate: number;
  private readonly maxConcurrent: number;
  private readonly sliceMs: number;
  private readonly makeContext: (rate: number) => BaseAudioContext;
  /** Decoded audio held at once, at most (one file larger than this still decodes, alone). */
  readonly maxBytes: number;
  constructor(
    rate: number = 32000,
    maxConcurrent: number = 2,
    sliceMs: number = 1,
    makeContext: (rate: number) => BaseAudioContext = (r) => new OfflineAudioContext(1, 1, r),
    maxBytes: number = 16 << 20,
  ) {
    this.rate = rate;
    this.maxConcurrent = maxConcurrent;
    this.sliceMs = sliceMs;
    this.makeContext = makeContext;
    this.maxBytes = maxBytes;
  }

  private context(): BaseAudioContext {
    this.ctx ??= this.makeContext(this.rate);
    return this.ctx;
  }

  private fits(bytes: number): boolean {
    return this.running < this.maxConcurrent && (this.running === 0 || this.held + bytes <= this.maxBytes);
  }

  /** A permit for `bytes` of decoded audio; first come, first served. */
  private acquire(bytes: number): Promise<void> {
    if (this.queue.length === 0 && this.fits(bytes)) {
      this.take(bytes);
      return Promise.resolve();
    }
    return new Promise<void>((go) => this.queue.push({ bytes, go }));
  }

  private take(bytes: number): void {
    this.running++;
    this.held += bytes;
    if (this.held > this.maxHeld) this.maxHeld = this.held;
  }

  private release(bytes: number): void {
    this.running--;
    this.held -= bytes;
    while (this.queue.length > 0 && this.fits((this.queue[0] as { bytes: number }).bytes)) {
      const next = this.queue.shift() as { bytes: number; go: () => void };
      this.take(next.bytes);
      next.go();
    }
  }

  /** Decodes, aligns and converts one file. Throws if the browser cannot decode it. */
  async decode(bytes: ArrayBuffer, expect: Expect | null): Promise<Int16Array[]> {
    const need = decodedEstimate(bytes, expect);
    await this.acquire(need);
    try {
      return await this.convert(await this.context().decodeAudioData(bytes), expect);
    } finally {
      this.release(need);
    }
  }

  private async convert(buf: AudioBuffer, expect: Expect | null): Promise<Int16Array[]> {
    const chans: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    const len = expect?.len ?? buf.length;
    let off = 0;
    if (expect && chans[0]) {
      off = alignOffset(chans[0], expect.len, expect.fp);
      if (off !== 0) this.misaligned.push(off);
    }
    const out: Int16Array[] = [];
    for (const x of chans) {
      const y = new Int16Array(len);
      let i = 0;
      while (i < len) {
        const t0 = performance.now();
        // convert in chunks, checking the clock every 4096 samples
        while (i < len && performance.now() - t0 < this.sliceMs) {
          const end = Math.min(len, i + 4096);
          for (; i < end; i++) {
            const j = i + off;
            const v = j >= 0 && j < x.length ? (x[j] as number) : 0;
            // Int16 = round(x · 32768), clamped; the bank scales back by 1 / 32768
            const q = Math.round(v * 32768);
            y[i] = q > 32767 ? 32767 : q < -32768 ? -32768 : q;
          }
        }
        if (i < len) await yieldToMain();
      }
      out.push(y);
    }
    return out;
  }
}
