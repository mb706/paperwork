// The steady-state allocation probe (run by test/shell/steady.test.ts in a child `node --expose-gc`, so the shell
// runs as Node strips its types, close to the bundled worker, not through Vitest's module transform and beside
// its other tests): the sim worker's shell on the stub module.
// - `frames N`: driven by its clock: each frame time moves a tick on and the pending wake runs (the due tick,
//   `sim_tick`, the digest, chunk requests, one extraction, the packet posted and acked with the same buffer).
// - `step N`: the tick path alone, `seq step N` (test mode: N ticks, then one extraction).
// After a warm-up long enough for V8's tiers to settle, three windows of N ticks each: per window the bytes
// allocated per tick (heap growth without a collection) and retained (after one). A window in which V8 is still
// compiling, or boxes a double in an optimized caller, can show transient garbage; the steady state is the
// quietest window. Prints JSON.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import { type ShellHost, SimShell } from '../../src/simworker/shell.ts';

const game = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error('run with --expose-gc');
const protos = new Uint8Array(readFileSync(join(game, 'test/golden/m0/protos/prototypes.bin')));
const mod = await WebAssembly.compile(
  readFileSync(join(game, 'target/stubs/wasm32-unknown-unknown/release/stubsim.wasm')),
);
let shell: SimShell | null = null;
const ack: { t: 'ack'; buf: ArrayBuffer } = { t: 'ack', buf: new ArrayBuffer(0) };
// The clock is a frame count (a small integer), so the probe's own loop does no double arithmetic, which V8
// boxes in unoptimized code: the time in ms is computed where the shell reads it.
let frameNo = 0;
let wake: (() => void) | null = null;
let packets = 0;
const host: ShellHost = {
  post: (m) => {
    if (m.t === 'pkt') {
      packets += 1;
      ack.buf = m.buf;
      shell?.handle(ack);
    }
  },
  now: () => (frameNo * 1000) / 60,
  wake: (_ms, f) => {
    wake = f;
    return 1;
  },
  cancel: () => {
    wake = null;
  },
  protos: async () => protos,
  sha256: async (b) => new Uint8Array(createHash('sha256').update(b).digest()),
};
shell = new SimShell(host);
const prototypesHash = createHash('sha256').update(protos).digest('hex');
await shell.handle({
  t: 'boot',
  build: { build: 'm0', buildHash: '0'.repeat(64), dev: true, prototypesHash },
  module: mod,
  ioPort: null,
  genPorts: [],
});
await shell.handle({ t: 'world', gen: 1, op: 'new', settings: { ...NewWorldCodec.defaults(), seed: 1 } });
const frame = () => {
  frameNo += 1;
  const f = wake;
  wake = null;
  f?.();
};
const mode = process.argv[2] ?? 'frames';
const n = Number(process.argv[3] ?? 20000);
let run: () => void;
if (mode === 'frames') {
  for (let i = 0; i < 20000; i++) frame();
  run = () => {
    for (let i = 0; i < n; i++) frame();
  };
} else if (mode === 'step') {
  await shell.handle({ t: 'seq', op: 'pause' });
  await shell.handle({ t: 'seq', op: { step: 30000 } });
  const step = { t: 'seq', op: { step: n } } as const;
  // `seq` is a hot message: handled synchronously (an undefined result, no promise).
  run = () => {
    if (shell?.handle(step) !== undefined) throw new Error('seq step returned a promise');
  };
} else throw new Error(`steady-probe: unknown mode ${mode}`);
const windows: { ticks: number; packets: number; allocatedPerTick: number; retainedPerTick: number }[] = [];
for (let w = 0; w < 3; w++) {
  gc();
  const t0 = shell.tick;
  const p0 = packets;
  const before = process.memoryUsage().heapUsed;
  run();
  const after = process.memoryUsage().heapUsed;
  gc();
  const retained = process.memoryUsage().heapUsed;
  const ticks = shell.tick - t0;
  windows.push({
    ticks,
    packets: packets - p0,
    allocatedPerTick: (after - before) / ticks,
    retainedPerTick: (retained - before) / ticks,
  });
}
console.log(JSON.stringify({ mode, windows }));
