// The cross-engine trace (10 §10.4 #6, §10.5; D18 d; C8): the same closure logs replayed natively (`simtool replay
// --trace --full`), in Node (test/trace/core.ts in-process: the shell's module layer, and the real SimShell in its
// replay mode) and in this project's browser (the trace page test/trace.html: the same code in a module worker).
// All must be identical: d_t and r_t after every tick, the full state hash after every tick of a short log (the
// golden set's 3,600) and on D18 a's cadence for a long one, the final state hash and r; and the shells' replays
// must find every d_t the log recorded natively.
//
// `ci` (@smoke) runs the golden set and the 10,000-tick session `m0-cross-engine-10k`; `npm run test:slow` runs
// every session in test/logs/ (TRACE_SET=all), on the dev module and on the release module (TRACE_MODULE=release).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import {
  firstDifference,
  type ModuleTrace,
  moduleTrace,
  nativeRows,
  type ShellReplay,
  scheduleFor,
  shellReplay,
  type TraceRow,
  traceText,
} from '../src/dev/trace/core.ts';
import type { TraceResult } from '../test/trace/page.ts';
import { watchConsole } from './console.ts';

const GAME = join(import.meta.dirname, '..');
const PROTOS = join(GAME, 'test', 'golden', 'm0', 'protos', 'prototypes.bin');
const RELEASE = process.env.TRACE_MODULE === 'release';
const MODULE = RELEASE
  ? join(GAME, 'target', 'wasm-release', 'sim.wasm')
  : join(GAME, 'target', 'wasm32-unknown-unknown', 'wasmdev', 'simabi.wasm');
const SIMTOOL = join(GAME, 'target', 'wasmdev', 'simtool');

/** The logs: the golden set, then the recorded sessions. */
function files(name: string): { start: string; log: string } {
  return name === 'golden'
    ? { start: join(GAME, 'test/golden/m0/start.save'), log: join(GAME, 'test/golden/m0/closure-log.pwlog') }
    : { start: join(GAME, `test/logs/${name}.start`), log: join(GAME, `test/logs/${name}.pwlog`) };
}
const SET =
  process.env.TRACE_SET === 'all'
    ? [
        'golden',
        ...readdirSync(join(GAME, 'test', 'logs'))
          .filter((f) => f.endsWith('.pwlog'))
          .map((f) => f.slice(0, -'.pwlog'.length))
          .sort(),
      ]
    : ['golden', 'm0-cross-engine-10k'];

/** The newest modification time under the crates `simtool` is built from. */
function newestSource(): number {
  let newest = 0;
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.rs') || e.name === 'Cargo.toml')
        newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  for (const c of ['det', 'schema', 'worldgen', 'sim', 'simtool']) walk(join(GAME, 'crates', c));
  return newest;
}

/** `simtool` (wasmdev profile, as `ci` builds it); built here when missing or older than its sources. */
function simtool(): string {
  if (!existsSync(SIMTOOL) || statSync(SIMTOOL).mtimeMs < newestSource())
    execFileSync('cargo', ['build', '--locked', '--quiet', '--profile', 'wasmdev', '-p', 'simtool'], {
      cwd: GAME,
      stdio: 'inherit',
    });
  return SIMTOOL;
}

interface Native {
  rows: TraceRow[];
  startTick: number;
}
const natives = new Map<string, Native>();
function native(name: string): Native {
  const hit = natives.get(name);
  if (hit) return hit;
  const f = files(name);
  const text = execFileSync(simtool(), ['replay', f.start, f.log, '--protos', PROTOS, '--trace', '--full'], {
    cwd: GAME,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const first = Number(/^(\d+) /m.exec(text)?.[1] ?? 1);
  const lines = text.split('\n').filter((l) => /^\d+ /.test(l)).length;
  const out = { rows: nativeRows(text, first - 1, scheduleFor(lines)), startTick: first - 1 };
  natives.set(name, out);
  return out;
}

const nodes = new Map<string, { module: ModuleTrace; shell: ShellReplay }>();
async function node(name: string): Promise<{ module: ModuleTrace; shell: ShellReplay }> {
  const hit = nodes.get(name);
  if (hit) return hit;
  const f = files(name);
  const input = {
    // Read after the page loaded: the dev server builds this very file at its start (the cargo plugin).
    module: new WebAssembly.Module(readFileSync(MODULE)),
    protos: new Uint8Array(readFileSync(PROTOS)),
    start: new Uint8Array(readFileSync(f.start)),
    log: new Uint8Array(readFileSync(f.log)),
  };
  const out = {
    module: await moduleTrace(input),
    shell: await shellReplay(input, async (b) => new Uint8Array(createHash('sha256').update(b).digest())),
  };
  nodes.set(name, out);
  return out;
}

/** Opens the trace page once the dev server's generators are idle (each run reloads open pages). */
async function trace(page: Page, name: string): Promise<TraceResult> {
  await page.request.get('/data/build-manifest.json');
  await page.goto(`/test/trace.html?log=${name}${RELEASE ? '&module=release' : ''}`);
  await page.waitForFunction(() => window.__trace !== undefined, null, { timeout: 180_000 });
  return (await page.evaluate(() => window.__trace)) as TraceResult;
}

test.describe.configure({ mode: 'serial' });

for (const name of SET) {
  test(`${name}: the same trace natively, in Node and in this browser @smoke`, async ({ page }, info) => {
    test.setTimeout(300_000);
    const problems = watchConsole(page);
    const b = await trace(page, name);
    expect(b.ok, b.error).toBe(true);
    const bm = b.module as ModuleTrace;
    const bs = b.shell as ShellReplay;
    const nat = native(name);
    const n = await node(name);
    const engine = info.project.name;
    // The module traces: every tick's d and r, and the scheduled full state hashes, natively, in Node and here.
    expect(nat.rows.length, 'native ticks').toBe(bm.rows.length);
    expect(firstDifference(nat.rows, n.module.rows), 'native vs Node').toBeNull();
    expect(firstDifference(nat.rows, bm.rows), `native vs ${engine}`).toBeNull();
    expect(bm.logMismatch, `${engine}: a d_t differs from the log's`).toBeNull();
    expect(n.module.logMismatch, "Node: a d_t differs from the log's").toBeNull();
    const last = nat.rows[nat.rows.length - 1] as TraceRow;
    expect(bm.finalR).toBe(last.r);
    expect(bm.finalHash).toBe(n.module.finalHash);
    // The real shell's replay: every d_t equal to the log's (checked by the shell), the ring equal to the native
    // trace, the final state and r equal to the native run's.
    for (const [who, s] of [
      ['Node', n.shell],
      [engine, bs],
    ] as const) {
      expect(s.ok, `${who}: ${s.message ?? ''} ${JSON.stringify(s.mismatch ?? '')}`).toBe(true);
      expect(s.tick, who).toBe(last.tick);
      expect(s.digests, `${who}: the shell's digest ring`).toEqual(nat.rows.map((r) => r.d));
      expect(s.finalHash, who).toBe(bm.finalHash);
      expect(s.finalR, who).toBe(last.r);
    }
    // A session's summary (test/logs/<name>.txt) names the final hash and r its recording run reached.
    if (name !== 'golden') {
      const summary = readFileSync(join(GAME, `test/logs/${name}.txt`), 'utf8');
      expect(summary).toContain(`state ${bm.finalHash} r ${bm.finalR}`);
    }
    const hashes = nat.rows.filter((r) => r.hash !== null).length;
    const sha = createHash('sha256').update(traceText(nat.rows)).digest('hex');
    const evidence = {
      log: name,
      module: RELEASE ? 'release' : 'dev',
      engine,
      userAgent: b.userAgent,
      ticks: nat.rows.length,
      fullStateHashes: hashes,
      traceSha256: sha,
      finalHash: bm.finalHash,
      finalR: bm.finalR,
      ms: { node: Math.round(n.module.ms), browser: Math.round(bm.ms), browserShell: Math.round(bs.ms) },
    };
    writeFileSync(info.outputPath('trace.json'), `${JSON.stringify(evidence, null, 1)}\n`);
    console.log(
      `trace ${name} (${evidence.module}): ${evidence.ticks} ticks, ${hashes} full hashes, identical natively, in Node and in ${engine}; sha256 ${sha.slice(0, 16)}; state ${bm.finalHash} r ${bm.finalR}`,
    );
    expect(problems).toEqual([]);
  });
}
