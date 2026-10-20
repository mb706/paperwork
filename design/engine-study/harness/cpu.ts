// Per-socket CPU utilisation between two /proc/stat snapshots (this host: socket 0 = CPUs 0-7,16-23).
import { readFileSync } from 'node:fs';

type Snap = Map<number, [number, number]>; // cpu → [total, idle]
const S0 = [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23];
const S1 = [8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 29, 30, 31];

export function cpuSnap(): Snap {
  const m: Snap = new Map();
  for (const line of readFileSync('/proc/stat', 'utf8').split('\n')) {
    const r = /^cpu(\d+) (.*)$/.exec(line);
    if (!r) continue;
    const v = r[2].trim().split(/\s+/).map(Number);
    const total = v.reduce((a, b) => a + b, 0);
    m.set(Number(r[1]), [total, v[3] + v[4]]);
  }
  return m;
}

export function cpuDelta(a: Snap, b: Snap): { s0: number; s1: number; s0max: number; loadavg: string } {
  const busy = (c: number) => {
    const x = a.get(c);
    const y = b.get(c);
    if (!x || !y) return 0;
    const dt = y[0] - x[0];
    return dt > 0 ? (100 * (dt - (y[1] - x[1]))) / dt : 0;
  };
  const avg = (cs: number[]) => cs.reduce((s, c) => s + busy(c), 0) / cs.length;
  return {
    s0: +avg(S0).toFixed(1), // includes the benchmark itself (one to three busy threads ≈ 6–19%)
    s1: +avg(S1).toFixed(1), // other agents' socket
    s0max: +Math.max(...S0.map(busy)).toFixed(0),
    loadavg: readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' '),
  };
}

// Pages of this process per NUMA node (from /proc/self/numa_maps): remote memory explains slow runs on this
// 2-socket host, where node 0's free memory is often low and the kernel (zone_reclaim_mode = 0) falls back to node 1.
export function numaPages(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (const line of readFileSync('/proc/self/numa_maps', 'utf8').split('\n')) {
      for (const f of line.split(' ')) {
        const m = /^N(\d+)=(\d+)$/.exec(f);
        if (m) out[`N${m[1]}`] = (out[`N${m[1]}`] ?? 0) + Number(m[2]);
      }
    }
  } catch {
    /* not Linux */
  }
  return out;
}

// Transparent huge pages backing this process (kB). THP availability varies with memory fragmentation and
// shifts this memory-latency-bound benchmark by up to ~25% between otherwise identical runs.
export function hugePagesKb(): number {
  try {
    const m = /AnonHugePages:\s+(\d+) kB/.exec(readFileSync('/proc/self/smaps_rollup', 'utf8'));
    return m ? Number(m[1]) : -1;
  } catch {
    return -1;
  }
}
