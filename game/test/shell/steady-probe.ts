// The steady-state allocation probe (run by test/shell/steady.test.ts in a child `node --expose-gc`, so the shell
// runs as Node strips its types, close to the bundled worker, not through Vitest's module transform): the sim
// worker's shell on the stub module, driven by its clock: each frame time moves a tick on and the pending wake
// runs (the due tick, `sim_tick`, the digest, chunk requests, one extraction, the packet posted and acked with
// the same buffer). Prints JSON: bytes allocated per frame (heap growth without a collection) and retained
// (after one).
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
const clock = new Float64Array(1);
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
  now: () => clock[0] as number,
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
  clock[0] = (clock[0] as number) + 1000 / 60;
  const f = wake;
  wake = null;
  f?.();
};
const frames = Number(process.argv[2] ?? 6000);
for (let i = 0; i < 5000; i++) frame();
gc();
const t0 = shell.tick;
const p0 = packets;
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < frames; i++) frame();
const after = process.memoryUsage().heapUsed;
gc();
const retained = process.memoryUsage().heapUsed;
console.log(
  JSON.stringify({
    frames,
    ticks: shell.tick - t0,
    packets: packets - p0,
    allocatedPerFrame: (after - before) / frames,
    retainedPerFrame: (retained - before) / frames,
  }),
);
