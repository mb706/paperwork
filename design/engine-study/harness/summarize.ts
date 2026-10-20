// Aggregate results/*.jsonl into the tables of REPORT.md: node harness/summarize.ts [results dir] [--md]
// For each (platform, impl, scale, regime): mean over repetitions of the per-run mean / p99 / max ms per tick,
// the spread (min–max of the run means, as % of their mean), and the per-phase means.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'results');
const md = process.argv.includes('--md');
type Row = Record<string, any>;
const rows: Row[] = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.jsonl')) continue;
  for (const line of readFileSync(resolve(dir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.error) continue;
    if (r.platform === 'native') {
      rows.push({ platform: 'native', impl: 'native', scale: r.scale, regime: r.regime, mean: r.mean, p99: r.p99, max: r.max, hash: r.hash, phases: r.phases, stats: r.stats });
    } else if (r.tick) {
      rows.push({
        platform: r.platform,
        impl: r.cfg.impl,
        scale: r.cfg.scale,
        regime: r.cfg.regime,
        noSleep: r.cfg.noSleep,
        mean: r.tick.mean,
        p99: r.tick.p99,
        max: r.tick.max,
        hash: r.hash,
        phases: [r.phases.timers, r.phases.electric, r.phases.machines, r.phases.belts, r.phases.inserters],
        stats: r.stats,
        extraction: r.extraction,
        queries: r.queries,
        startup: r.startup,
        load: r.load,
        loadMs: r.loadMs,
        warmMs: r.warmMs,
      });
    }
  }
}

const groups = new Map<string, Row[]>();
for (const r of rows) {
  const k = [r.platform, r.impl, r.scale, r.regime, r.noSleep ? 'nosleep' : ''].join('|');
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)?.push(r);
}
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const f3 = (x: number) => x.toFixed(3);
const out: Row[] = [];
for (const [k, g] of groups) {
  const [platform, impl, scale, regime, ns] = k.split('|');
  const means = g.map((r) => r.mean);
  const m = avg(means);
  const hashes = [...new Set(g.map((r) => r.hash))];
  out.push({
    platform,
    impl,
    scale,
    regime: ns ? `${regime} (no sleep)` : regime,
    n: g.length,
    mean: m,
    spreadPct: (100 * (Math.max(...means) - Math.min(...means))) / m,
    p99: avg(g.map((r) => r.p99)),
    max: Math.max(...g.map((r) => r.max)),
    phases: [0, 1, 2, 3, 4].map((i) => avg(g.map((r) => r.phases[i]))),
    hashes,
    s1: g[0].load ? avg(g.map((r) => r.load.s1)) : null,
    s0: g[0].load ? avg(g.map((r) => r.load.s0)) : null,
    stats: g[0].stats,
    extraction: g[0].extraction ? g[0].extraction.map((_: unknown, i: number) => ({
      zoom: g[0].extraction[i].zoom,
      full: g[0].extraction[i].full,
      sprites: g[0].extraction[i].sprites,
      extract: avg(g.map((r) => r.extraction[i].extract.mean)),
      extractP99: avg(g.map((r) => r.extraction[i].extract.p99)),
      pack: avg(g.map((r) => r.extraction[i].pack.mean)),
      roundTrip: g[0].extraction[i].roundTrip ? avg(g.map((r) => r.extraction[i].roundTrip.mean)) : null,
      outHash: [...new Set(g.map((r) => r.extraction[i].outHash))].join(','),
    })) : null,
    queries: g[0].queries ? { inventoryP50: avg(g.map((r) => r.queries.inventory.p50)), inventoryP99: avg(g.map((r) => r.queries.inventory.p99)), techP50: avg(g.map((r) => r.queries.tech.p50)), techP99: avg(g.map((r) => r.queries.tech.p99)) } : null,
    startup: g[0].startup ? { workerScriptMs: avg(g.map((r) => r.startup.workerScriptMs)), wasmCompileMs: avg(g.map((r) => r.startup.wasmCompileMs)), wasmInstantiateMs: avg(g.map((r) => r.startup.wasmInstantiateMs)) } : null,
    loadMs: g[0].loadMs !== undefined ? avg(g.map((r) => r.loadMs)) : null,
  });
}
const order = { node: 0, chrome: 1, firefox: 2, native: 3 } as Record<string, number>;
const iorder = { ts: 0, wasm: 1, 'wasm-simd': 2, native: 3 } as Record<string, number>;
const sorder = { tiny: 0, mid: 1, late: 2, mega: 3 } as Record<string, number>;
const rorder = { busy: 0, typical: 1, backed: 2, starved: 3 } as Record<string, number>;
out.sort((a, b) => sorder[a.scale] - sorder[b.scale] || (rorder[a.regime.split(' ')[0]] ?? 9) - (rorder[b.regime.split(' ')[0]] ?? 9) || order[a.platform] - order[b.platform] || iorder[a.impl] - iorder[b.impl]);

if (md) {
  console.log('| scale | regime | platform | impl | runs | mean ms/tick | spread | p99 | max | electric | machines | belts | inserters | hash |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of out) {
    console.log(`| ${r.scale} | ${r.regime} | ${r.platform} | ${r.impl} | ${r.n} | ${f3(r.mean)} | ${r.spreadPct.toFixed(1)}% | ${f3(r.p99)} | ${f3(r.max)} | ${f3(r.phases[1])} | ${f3(r.phases[2])} | ${f3(r.phases[3])} | ${f3(r.phases[4])} | ${r.hashes.join(',')} |`);
  }
} else {
  console.log(JSON.stringify(out, null, 1));
}
if (existsSync(resolve(dir, 'threads.jsonl'))) {
  // threads results are summarised separately (harness/summarize-threads.ts)
}
