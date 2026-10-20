// Seeded random numbers for the music engine.
// Audio is presentation, not simulation, so it need not be bit-identical across browsers;
// a seeded generator still makes a piece reproducible from (seed, game-state history),
// which is what offline renders and bug reports need.

/** splitmix32: small, fast, good enough for musical choices. */
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    /** uniform in [a, b) */
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor((b - a + 1) * next()), // inclusive
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** weighted pick: items [[value, weight], ...] */
    weighted: (items) => {
      let tot = 0;
      for (const [, w] of items) tot += w;
      let r = next() * tot;
      for (const [v, w] of items) {
        r -= w;
        if (r <= 0) return v;
      }
      return items[items.length - 1][0];
    },
    /** approximately normal (Irwin-Hall, 4 terms), mean 0, sd 1 */
    gauss: () => (next() + next() + next() + next() - 2) * 1.7320508,
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** derive an independent stream (for one layer of a piece) */
    fork: (tag) => makeRng((seed ^ hashString(String(tag))) >>> 0),
  };
  return rng;
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
