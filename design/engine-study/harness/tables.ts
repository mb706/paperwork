// Print the study's tables (markdown, to stdout) from results/*.jsonl and results/freq.log.
//   node harness/tables.ts [section…]   sections: main ratio tail phases shares extract queries startup warm hashes clock
// Runs inside a turbo window (mean clock > 2.75 GHz in results/freq.log, or, for runs without timestamps,
// ≥ 15% faster than the median of their configuration) are listed by `clock` and excluded from absolute tables.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('results');
const want = new Set(process.argv.slice(2));
const show = (s: string) => want.size === 0 || want.has(s);
type Run = Record<string, any>;

function load(file: string): Run[] {
  const p = resolve(dir, file);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((r) => !r.error);
}

const freq: [number, number][] = existsSync(resolve(dir, 'freq.log'))
  ? readFileSync(resolve(dir, 'freq.log'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split(' ').map(Number) as [number, number])
  : [];
// the clock is package-wide; idle gaps inside a run (page load, the paced query phase) pull the mean down,
// so a run counts as turbo when any sample inside it exceeds 2.75 GHz
function mhz(a?: number, b?: number): number | null {
  if (!a || !b) return null;
  const xs = freq.filter(([t]) => t >= a && t <= b).map(([, f]) => f);
  return xs.length ? Math.max(...xs) : null;
}

// normalise every platform's runs to one shape
const runs: Run[] = [];
for (const [file, platform] of [['node.jsonl', 'node'], ['chrome.jsonl', 'chrome'], ['firefox.jsonl', 'firefox']] as const) {
  for (const r of load(file)) {
    runs.push({ platform, impl: r.cfg.impl, scale: r.cfg.scale, regime: r.cfg.regime, rep: r.rep, mean: r.tick.mean, p99: r.tick.p99, p999: r.tick.p999, max: r.tick.max, argmax: r.tick.argmax, hash: r.hash, phases: r.phases, stats: r.stats, extraction: r.extraction, queries: r.queries, startup: r.startup, warmCurve: r.warmCurve, load: r.load, mhzMax: mhz(r.startedAt, r.endedAt), loadMs: r.loadMs, genMs: r.genMs, blobBytes: r.blobBytes });
  }
}
for (const r of load('native.jsonl')) {
  runs.push({ platform: 'native', impl: 'native', scale: r.scale, regime: r.regime, rep: r.rep, mean: r.mean, p99: r.p99, max: r.max, hash: r.hash, phases: { timers: r.phases[0], electric: r.phases[1], machines: r.phases[2], belts: r.phases[3], inserters: r.phases[4] }, stats: null, mhzMax: mhz(r.startedAt, r.endedAt), loadMs: r.loadMs });
}
// turbo flag
const cfgKey = (r: Run) => `${r.platform}|${r.impl}|${r.scale}|${r.regime}`;
const byCfg = new Map<string, Run[]>();
for (const r of runs) (byCfg.get(cfgKey(r)) ?? byCfg.set(cfgKey(r), []).get(cfgKey(r)))?.push(r);
for (const g of byCfg.values()) {
  const med = g.map((r) => r.mean).sort((a, b) => a - b)[Math.floor((g.length - 1) / 2)];
  for (const r of g) r.turbo = r.mhzMax != null ? r.mhzMax > 2750 : r.mean < 0.85 * med;
}
const base = runs.filter((r) => !r.turbo);
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : Number.NaN);
const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const sel = (rs: Run[], q: Partial<Run>) => rs.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v));
const PLAT = ['node', 'chrome', 'firefox'];
const IMPL = ['ts', 'wasm', 'wasm-simd'];
const SCALES = ['mid', 'late', 'mega'].filter((s) => runs.some((r) => r.scale === s));
const REG = ['busy', 'typical', 'backed', 'starved'];

if (show('main')) {
  console.log('\n### Mean ms per tick (base clock; mean over repetitions)\n');
  console.log(`| scale | regime | ${PLAT.flatMap((p) => IMPL.map((i) => `${p} ${i}`)).join(' | ')} | native |`);
  console.log(`|---|---|${PLAT.flatMap(() => IMPL.map(() => '---')).join('|')}|---|`);
  for (const s of SCALES) for (const g of REG) {
    const cells = PLAT.flatMap((p) => IMPL.map((i) => f(avg(sel(base, { platform: p, impl: i, scale: s, regime: g }).map((r) => r.mean)))));
    const nat = f(avg(sel(base, { platform: 'native', scale: s, regime: g }).map((r) => r.mean)));
    if (cells.every((c) => c === '–') && nat === '–') continue;
    console.log(`| ${s} | ${g} | ${cells.join(' | ')} | ${nat} |`);
  }
}

if (show('ratio')) {
  console.log('\n### TS ÷ WASM, paired within each repetition (all runs, turbo included: the drift cancels)\n');
  console.log(`| scale | regime | ${PLAT.join(' | ')} | WASM ÷ native (Chrome) | Firefox ÷ Chrome (TS) | Firefox ÷ Chrome (WASM) |`);
  console.log(`|---|---|${PLAT.map(() => '---').join('|')}|---|---|---|`);
  for (const s of SCALES) for (const g of REG) {
    const ratio = (p: string) => {
      const rs: number[] = [];
      for (const t of sel(runs, { platform: p, impl: 'ts', scale: s, regime: g })) {
        const w = sel(runs, { platform: p, impl: 'wasm', scale: s, regime: g, rep: t.rep })[0];
        if (w) rs.push(t.mean / w.mean);
      }
      return rs.length ? `${f(avg(rs), 2)} (${f(Math.min(...rs), 2)}–${f(Math.max(...rs), 2)})` : '–';
    };
    const nat = avg(sel(base, { platform: 'native', scale: s, regime: g }).map((r) => r.mean));
    const cw = avg(sel(base, { platform: 'chrome', impl: 'wasm', scale: s, regime: g }).map((r) => r.mean));
    const ffc = (i: string) => avg(sel(base, { platform: 'firefox', impl: i, scale: s, regime: g }).map((r) => r.mean)) / avg(sel(base, { platform: 'chrome', impl: i, scale: s, regime: g }).map((r) => r.mean));
    const row = PLAT.map(ratio);
    if (row.every((c) => c === '–')) continue;
    console.log(`| ${s} | ${g} | ${row.join(' | ')} | ${f(cw / nat, 2)} | ${f(ffc('ts'), 2)} | ${f(ffc('wasm'), 2)} |`);
  }
}

if (show('tail')) {
  console.log('\n### Tail: p99 / p99.9 / worst tick (ms; base clock; worst over repetitions)\n');
  console.log('| scale | regime | platform | ts p99 | ts p99.9 | ts max | wasm p99 | wasm p99.9 | wasm max | worst-tick index (ts / wasm) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const s of SCALES) for (const g of REG) for (const p of PLAT) {
    const t = sel(base, { platform: p, impl: 'ts', scale: s, regime: g });
    const w = sel(base, { platform: p, impl: 'wasm', scale: s, regime: g });
    if (!t.length && !w.length) continue;
    console.log(`| ${s} | ${g} | ${p} | ${f(avg(t.map((r) => r.p99)))} | ${f(avg(t.map((r) => r.p999)))} | ${f(Math.max(...t.map((r) => r.max)))} | ${f(avg(w.map((r) => r.p99)))} | ${f(avg(w.map((r) => r.p999)))} | ${f(Math.max(...w.map((r) => r.max)))} | ${t.map((r) => r.argmax).join(',')} / ${w.map((r) => r.argmax).join(',')} |`);
  }
}

if (show('phases')) {
  console.log('\n### Per-system ms per tick and ns per active entity (Late; base clock)\n');
  for (const g of ['busy', 'typical']) {
    console.log(`\n**late/${g}**\n`);
    console.log('| platform | impl | electric | machines | belts | inserters | ns/consumer (2 passes) | ns/active machine | ns/active line | ns/active inserter |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const p of [...PLAT, 'native']) for (const i of p === 'native' ? ['native'] : IMPL) {
      const rs = sel(base, { platform: p, impl: i, scale: 'late', regime: g });
      if (!rs.length) continue;
      const ph = (k: string) => avg(rs.map((r) => r.phases[k]));
      const st = sel(runs, { platform: 'node', impl: 'ts', scale: 'late', regime: g })[0]?.stats;
      const cons = st ? st.inserters + st.machines : Number.NaN;
      console.log(`| ${p} | ${i} | ${f(ph('electric'))} | ${f(ph('machines'))} | ${f(ph('belts'))} | ${f(ph('inserters'))} | ${f((ph('electric') * 1e6) / cons, 1)} | ${f((ph('machines') * 1e6) / st?.machActive, 1)} | ${f((ph('belts') * 1e6) / st?.linesActive, 1)} | ${f((ph('inserters') * 1e6) / st?.insActive, 1)} |`);
    }
  }
}

if (show('shares')) {
  console.log('\n### Active shares at the end of the measured window (identical on every platform: same state)\n');
  console.log('| scale | regime | lines active | inserters active | inserters swinging | machines active | machines crafting | belt items | research units |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const s of SCALES) for (const g of REG) {
    const st = sel(runs, { scale: s, regime: g }).find((r) => r.stats)?.stats;
    if (!st) continue;
    const pc = (a: number, b: number) => `${((100 * a) / b).toFixed(0)}%`;
    console.log(`| ${s} | ${g} | ${pc(st.linesActive, st.lines)} | ${pc(st.insActive, st.inserters)} | ${pc(st.insMoving, st.inserters)} | ${pc(st.machActive, st.machines)} | ${pc(st.machCrafting, st.machines)} | ${st.beltItems} | ${st.research} |`);
  }
}

if (show('extract')) {
  console.log('\n### Render extraction per frame, 1920×1080 (Late, busy; ms; base clock)\n');
  console.log('| platform | impl | zoom | sprites | bytes | extract | extract p99 | copy out of wasm | worker→main→worker round trip |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const p of PLAT) for (const i of IMPL) {
    const rs = sel(base, { platform: p, impl: i, scale: 'late', regime: 'busy' });
    if (!rs.length) continue;
    rs[0].extraction.forEach((e: Run, k: number) => {
      const xs = rs.map((r) => r.extraction[k]);
      console.log(`| ${p} | ${i} | ${e.zoom}${e.full ? ' full' : ' dyn'} | ${e.sprites} | ${e.bytes} | ${f(avg(xs.map((x) => x.extract.mean)))} | ${f(avg(xs.map((x) => x.extract.p99)))} | ${f(avg(xs.map((x) => x.pack.mean)))} | ${e.roundTrip ? f(avg(xs.map((x) => x.roundTrip.mean))) : '–'} |`);
    });
  }
}

if (show('queries')) {
  console.log('\n### UI query latency against a worker paced at 60 UPS (ms; all scales and regimes pooled per platform/impl)\n');
  console.log('| platform | impl | scale | inventory p50 | inventory p99 | tech (300 entries) p50 | tech p99 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const p of ['chrome', 'firefox']) for (const i of IMPL) for (const s of SCALES) {
    const rs = sel(base, { platform: p, impl: i, scale: s }).filter((r) => r.queries);
    if (!rs.length) continue;
    const q = (k: string, m: string) => avg(rs.map((r) => r.queries[k][m]));
    console.log(`| ${p} | ${i} | ${s} | ${f(q('inventory', 'p50'))} | ${f(q('inventory', 'p99'))} | ${f(q('tech', 'p50'))} | ${f(q('tech', 'p99'))} |`);
  }
}

if (show('startup')) {
  console.log('\n### Start-up (ms)\n');
  console.log('| platform | impl | worker script (incl. TS kernel) | wasm compileStreaming | wasm instantiate | world load (Mid) | world load (Late) | generate (Late) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const p of PLAT) for (const i of IMPL) {
    const rs = sel(runs, { platform: p, impl: i });
    if (!rs.length) continue;
    const su = rs.filter((r) => r.startup);
    console.log(`| ${p} | ${i} | ${su.length ? f(avg(su.map((r) => r.startup.workerScriptMs)), 1) : '–'} | ${su.length ? f(avg(su.map((r) => r.startup.wasmCompileMs)), 1) : '–'} | ${su.length ? f(avg(su.map((r) => r.startup.wasmInstantiateMs)), 2) : '–'} | ${f(avg(sel(rs, { scale: 'mid' }).map((r) => r.loadMs)), 1)} | ${f(avg(sel(rs, { scale: 'late' }).map((r) => r.loadMs)), 1)} | ${f(avg(sel(rs, { scale: 'late' }).map((r) => r.genMs)), 0)} |`);
  }
}

if (show('warm')) {
  console.log('\n### First ticks after a load (Late; ms per tick)\n');
  console.log('| platform | impl | regime | tick 1 | ticks 2–10 | ticks 11–100 | ticks 101–600 | steady (measured window) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const p of PLAT) for (const i of IMPL) for (const g of ['busy']) {
    const rs = sel(base, { platform: p, impl: i, scale: 'late', regime: g }).filter((r) => r.warmCurve);
    if (!rs.length) continue;
    const w = (k: string) => avg(rs.map((r) => r.warmCurve[k]));
    console.log(`| ${p} | ${i} | ${g} | ${f(w('t1'), 2)} | ${f(w('t2to10'), 2)} | ${f(w('t11to100'), 2)} | ${f(w('t101to600'), 2)} | ${f(avg(rs.map((r) => r.mean)), 2)} |`);
  }
}

if (show('hashes')) {
  console.log('\n### Determinism: distinct state hashes per (scale, regime) across all platforms and implementations\n');
  console.log('| scale | regime | runs | distinct state hashes | distinct sprite-buffer hashes (per extraction case) |');
  console.log('|---|---|---|---|---|');
  for (const s of SCALES) for (const g of REG) {
    const rs = sel(runs, { scale: s, regime: g });
    if (!rs.length) continue;
    const hs = [...new Set(rs.map((r) => r.hash))];
    const ex = rs.filter((r) => r.extraction);
    const eh = ex.length ? ex[0].extraction.map((_: unknown, k: number) => new Set(ex.map((r) => r.extraction[k].outHash)).size).join(' / ') : '–';
    console.log(`| ${s} | ${g} | ${rs.length} (${[...new Set(rs.map((r) => `${r.platform}-${r.impl}`))].length} platform×impl) | ${hs.length} (${hs.join(', ')}) | ${eh} |`);
  }
}

if (show('clock')) {
  console.log('\n### Clock: runs flagged as turbo (excluded from absolute tables)\n');
  for (const r of runs.filter((x) => x.turbo)) console.log(`- ${r.platform} ${r.impl} ${r.scale}/${r.regime} rep ${r.rep}: mean ${f(r.mean)} ms, clock ${r.mhzMax ? `max ${r.mhzMax.toFixed(0)} MHz` : 'not logged (inferred from paired speed)'}`);
  const logged = runs.filter((r) => r.mhzMax != null);
  if (logged.length) console.log(`\nRuns with a clock log: ${logged.length}; highest sample per run: min ${Math.min(...logged.map((r) => r.mhzMax)).toFixed(0)}, max ${Math.max(...logged.map((r) => r.mhzMax)).toFixed(0)} MHz`);
}
