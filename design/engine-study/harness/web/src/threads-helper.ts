// Helper worker: waits for the generation counter to change, does its share of the blocks, arrives.
self.onmessage = (e: MessageEvent) => {
  const { sab, id, N, BLOCKS } = e.data as { sab: SharedArrayBuffer; id: number; N: number; BLOCKS: number };
  const ctl = new Int32Array(sab, 0, 64);
  const buf = new Float64Array(sab, 4096, N);
  const cap = new Float64Array(sab, 4096 + N * 8, N);
  const prog = new Float64Array(sab, 4096 + N * 16, N);
  const speed = new Float64Array(sab, 4096 + N * 24, N);
  const partial = new Float64Array(sab, 4096 + N * 32, BLOCKS);
  let gen = Atomics.load(ctl, 0);
  for (;;) {
    if (Atomics.load(ctl, 4) === 0) {
      while (Atomics.load(ctl, 0) === gen) Atomics.wait(ctl, 0, gen, 50);
    } else {
      while (Atomics.load(ctl, 0) === gen) {
        /* spin */
      }
    }
    gen = Atomics.load(ctl, 0);
    const task = Atomics.load(ctl, 2);
    if (task < 0) return;
    const helpers = Atomics.load(ctl, 3);
    if (id > helpers) continue; // not used in this round
    const threads = helpers + 1;
    for (let b = id; b < BLOCKS; b += threads) {
      const lo = Math.floor((b * N) / BLOCKS);
      const hi = Math.floor(((b + 1) * N) / BLOCKS);
      if (task === 1) {
        let s = 0;
        for (let i = lo; i < hi; i++) {
          const d = cap[i] - buf[i];
          s += d;
          buf[i] += d * 0.9 - 30;
        }
        partial[b] = s;
      } else if (task === 2) {
        for (let i = lo; i < hi; i++) {
          let p = prog[i] + speed[i] * (1 / 24);
          if (p >= 1) p -= 1;
          prog[i] = p;
        }
      }
    }
    Atomics.add(ctl, 1, 1);
    if (Atomics.load(ctl, 4) === 0) Atomics.notify(ctl, 1);
  }
};
