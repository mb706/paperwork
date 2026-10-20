// Summarise results/threads.jsonl: per platform, mode (wait | spin) and task, time per iteration by thread count.
import { readFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2] ?? 'results/threads.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
for (const r of rows) {
  if (r.error) {
    console.log(r.platform, 'ERROR', r.error);
    continue;
  }
  console.log(`\n### ${r.platform} ${r.browserVersion} (N = ${r.N} elements, ${r.BLOCKS} fixed blocks; socket-0 load ${r.load?.s0}%)`);
  const by = new Map<string, Record<number, { mean: number; p99: number }>>();
  for (const x of r.results) {
    const k = `${x.mode} ${x.task}`;
    if (!by.has(k)) by.set(k, {});
    (by.get(k) as Record<number, { mean: number; p99: number }>)[x.threads] = { mean: x.mean, p99: x.p99 };
  }
  const threads = [...new Set(r.results.map((x: { threads: number }) => x.threads))] as number[];
  console.log(`| mode / task | ${threads.map((t) => `${t} thr`).join(' | ')} |`);
  console.log(`|---|${threads.map(() => '---').join('|')}|`);
  for (const [k, v] of by) {
    console.log(`| ${k} (µs mean / p99) | ${threads.map((t) => `${(v[t].mean * 1000).toFixed(1)} / ${(v[t].p99 * 1000).toFixed(0)}`).join(' | ')} |`);
  }
}
