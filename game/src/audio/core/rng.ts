// Seeded random numbers for the music and SFX (A4 `engine/rng.js`, ported exactly: the same seed gives
// the same numbers, so a piece reproduces from its seed and a port can be checked note for note against
// the prototype's renders).
//
// Audio is presentation, not simulation: it need not be bit-identical across browsers (A4 §6.6), and the
// determinism rules of 10 §4.1 do not apply here. A seeded generator still makes every piece and every
// test reproducible.

/** FNV-1a over UTF-16 code units (the prototype's `hashString`). */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** splitmix32: small, fast and good enough for musical choices. */
export class Rng {
  /** The seed this stream was made from; `fork` derives from it, not from the state. */
  readonly seed: number;
  private s: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.s = this.seed;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x9e3779b9) >>> 0;
    let z = this.s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Uniform integer in [a, b], both inclusive. */
  int(a: number, b: number): number {
    return a + Math.floor((b - a + 1) * this.next());
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }

  /** A weighted pick from `[value, weight]` pairs. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let tot = 0;
    for (const [, w] of items) tot += w;
    let r = this.next() * tot;
    for (const [v, w] of items) {
      r -= w;
      if (r <= 0) return v;
    }
    return (items[items.length - 1] as readonly [T, number])[0];
  }

  /** Approximately normal (Irwin–Hall, four terms): mean 0, standard deviation 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = a[i] as T;
      a[i] = a[j] as T;
      a[j] = t;
    }
    return a;
  }

  /** An independent stream for one layer of a piece, derived from the seed and a tag. */
  fork(tag: string | number): Rng {
    return new Rng((this.seed ^ hashString(String(tag))) >>> 0);
  }
}

export const makeRng = (seed: number): Rng => new Rng(seed);
