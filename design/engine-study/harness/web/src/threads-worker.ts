// Coordinator ("sim") worker for the threads experiment. Control block in a SharedArrayBuffer:
// ctl[0] generation, ctl[1] arrivals, ctl[2] task, ctl[3] helpers, ctl[4] mode (0 wait, 1 spin), ctl[5] blocks.
// Work is split into fixed blocks (not per thread), so a reduction's order never depends on the thread count.
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
const N = 50_000; // consumers (electric pass 2) or machines (crafting progress)
const BLOCKS = 64;

self.onmessage = async (e: MessageEvent) => {
  if (e.data.t !== 'start') return;
  try {
    const maxHelpers: number = e.data.maxHelpers;
    const iters: number = e.data.iters;
    const sab = new SharedArrayBuffer(4096 + N * 8 * 4 + BLOCKS * 8);
    const ctl = new Int32Array(sab, 0, 64);
    const helpers: Worker[] = [];
    for (let k = 0; k < maxHelpers; k++) {
      const h = new Worker(new URL('./threads-helper.ts', import.meta.url), { type: 'module' });
      h.postMessage({ sab, id: k + 1, N, BLOCKS });
      helpers.push(h);
    }
    await new Promise((r) => setTimeout(r, 300));
    const buf = new Float64Array(sab, 4096, N);
    const cap = new Float64Array(sab, 4096 + N * 8, N);
    const prog = new Float64Array(sab, 4096 + N * 16, N);
    const speed = new Float64Array(sab, 4096 + N * 24, N);
    const partial = new Float64Array(sab, 4096 + N * 32, BLOCKS);
    for (let i = 0; i < N; i++) {
      cap[i] = 1000 + (i % 7);
      buf[i] = 500;
      speed[i] = 0.75 + (i % 3) * 0.25;
    }
    // the coordinator also works: it takes blocks like a helper (id 0)
    const work = (task: number, id: number, threads: number) => {
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
    };
    const results: Record<string, unknown>[] = [];
    for (const mode of [0, 1]) {
      for (const task of [0, 1, 2]) {
        for (let k = 0; k <= maxHelpers; k++) {
          Atomics.store(ctl, 3, k);
          Atomics.store(ctl, 4, mode);
          Atomics.store(ctl, 2, task);
          const times = new Float64Array(iters);
          let check = 0;
          for (let it = -50; it < iters; it++) {
            // the first 50 iterations are unmeasured (helpers settle into the new mode)
            const t0 = performance.now();
            if (k > 0) {
              Atomics.store(ctl, 1, 0);
              Atomics.add(ctl, 0, 1);
              if (mode === 0 || it < 0) Atomics.notify(ctl, 0);
            }
            work(task, 0, k + 1);
            if (k > 0) {
              if (mode === 0) {
                let a = Atomics.load(ctl, 1);
                while (a < k) {
                  Atomics.wait(ctl, 1, a);
                  a = Atomics.load(ctl, 1);
                }
              } else {
                while (Atomics.load(ctl, 1) < k) {
                  /* spin */
                }
              }
            }
            if (task === 1) {
              let s = 0;
              for (let b = 0; b < BLOCKS; b++) s += partial[b]; // fixed order: identical for any thread count
              check = s;
            }
            if (it >= 0) times[it] = performance.now() - t0;
          }
          const s = Float64Array.from(times).sort();
          results.push({ mode: mode ? 'spin' : 'wait', task: ['barrier', 'electric-pass', 'crafting-progress'][task], threads: k + 1, mean: times.reduce((a, b) => a + b, 0) / iters, p50: s[iters >> 1], p99: s[Math.floor(iters * 0.99)], check });
          post({ t: 'progress', msg: JSON.stringify(results[results.length - 1]) });
        }
      }
    }
    Atomics.store(ctl, 2, -1);
    Atomics.add(ctl, 0, 1);
    Atomics.notify(ctl, 0);
    post({ t: 'done', result: { N, BLOCKS, results, hardwareConcurrency: navigator.hardwareConcurrency, crossOriginIsolated: self.crossOriginIsolated, userAgent: navigator.userAgent } });
  } catch (err) {
    post({ t: 'error', error: String((err as Error)?.stack ?? err) });
  }
};
