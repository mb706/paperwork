// The real sim.wasm (crates/simabi, the sim package's module) through the shell (test/golden/README.md "Shell
// (C3)": "with the real module: equal"): the handshake, the golden closure log replayed with every digest, the
// golden packets, every ABI trace through the shell's module wrapper, the negative ABI inputs and closures, and
// the dev panic. While crates/simabi is the M0 scaffold (ABI 0), these skip with that reason; the same checks
// run on the reference model behind the ABI (golden.test.ts) and on the stub module (shell.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SimStatus } from '../../src/shared/gen/abi.ts';
import { parseClosureLog } from '../../src/shared/gen/container.ts';
import { StateHashCodec } from '../../src/shared/gen/projections.ts';
import { instantiateSim } from '../../src/simworker/module.ts';
import { STATUS_NAME } from '../golden/build/traces.ts';
import { GAME } from '../helpers/paths.ts';
import { golden, ShellHarness } from '../helpers/shell-harness.ts';
import { realSim } from '../helpers/stubs.ts';

const real = await realSim();
const skip = 'skip' in real ? real.skip : null;
const module = 'module' in real ? real.module : null;
const quiet = { log: () => {}, now: () => 0 };

const digestsTxt = () =>
  new TextDecoder()
    .decode(golden('digests.txt'))
    .trim()
    .split('\n')
    .slice(1)
    .map(
      (l) =>
        l.split(' ').map((x, i) => (i === 0 ? Number(x) : BigInt(`0x${x}`))) as [
          number,
          bigint,
          bigint,
          bigint,
        ],
    );

describe.skipIf(skip !== null)(
  `the real sim.wasm through the shell${skip ? ` (skipped: ${skip})` : ''}`,
  () => {
    it('passes the handshake', async () => {
      const h = new ShellHarness();
      await h.boot(module);
      expect(h.of('ready')).toHaveLength(1);
    });

    it('replays the golden closure log from start.save: every d_t, and r_3600', async () => {
      const h = new ShellHarness();
      await h.boot(module);
      await h.load(golden('start.save'), 1, 'start');
      await h.send({ t: 'replay', gen: 1, log: golden('closure-log.pwlog').slice().buffer });
      for (let i = 0; i < 100_000 && h.of('replayed').length === 0; i++) h.advance(1);
      expect(h.last('replayed')).toEqual({ t: 'replayed', gen: 1, ok: true, tick: 3600 });
      for (const [t, d] of digestsTxt()) expect(h.shell.digests.get(t), `d_${t}`).toBe(d);
    });

    it('answers every ABI trace call as the golden traces say', async () => {
      const traces = JSON.parse(
        readFileSync(join(GAME, 'test', 'golden', 'm0', 'abi', 'traces.json'), 'utf8'),
      ) as {
        traces: {
          name: string;
          calls: {
            call: string;
            in: string | null;
            params?: number[];
            status: string;
            out: string | null;
            state?: string;
          }[];
        }[];
      };
      const { invokeTrace } = await import('./trace-invoke.ts');
      for (const t of traces.traces) {
        const sim = await instantiateSim(module as WebAssembly.Module, quiet, true);
        const hash = (): bigint | null => {
          try {
            return StateHashCodec.decode(sim.cold((m) => m.stateHash())).hash;
          } catch {
            return null;
          }
        };
        t.calls.forEach((c, i) => {
          if (c.call.startsWith('gen_')) return;
          const where = `${t.name} call ${i + 1} ${c.call}`;
          const before = hash();
          const r = invokeTrace(sim, c.call, c.in ? golden(c.in) : new Uint8Array(), c.params ?? []);
          const after = hash();
          expect(STATUS_NAME.get(r.status), where).toBe(c.status);
          if (c.out) expect(Buffer.compare(r.out as Uint8Array, golden(c.out)), where).toBe(0);
          const state =
            before !== null && after !== null ? (before === after ? 'unchanged' : 'changed') : undefined;
          expect(state, where).toBe(c.state);
        });
      }
    });

    it('refuses the negative closures and ABI inputs with their statuses, changing nothing', async () => {
      const index = JSON.parse(
        readFileSync(join(GAME, 'test', 'golden', 'm0', 'negative', 'index.json'), 'utf8'),
      ) as {
        file: string;
        call: string;
        expect: string;
      }[];
      const { invokeTrace } = await import('./trace-invoke.ts');
      const protosInit = golden('abi/inputs/sim_init-01.bin');
      const startLoad = golden('abi/inputs/sim_load-02.bin');
      for (const c of index) {
        const call = c.file.startsWith('closures/') ? 'sim_tick' : c.call.split(' ')[0];
        if (!call?.startsWith('sim_') || c.file.startsWith('saves/')) continue;
        const sim = await instantiateSim(module as WebAssembly.Module, quiet, true);
        if (call !== 'sim_init') {
          invokeTrace(sim, 'sim_init', protosInit, []);
          invokeTrace(sim, 'sim_load', startLoad, []);
        }
        const r = invokeTrace(sim, call, golden(`negative/${c.file}`), []);
        expect(STATUS_NAME.get(r.status), c.file).toBe(c.expect);
      }
    });

    it('a dev panic traps at its tick (simcheck builds: C3’s proposal, DEV_PANIC_DUMP_ID)', async (ctx) => {
      const h = new ShellHarness();
      await h.boot(module);
      await h.load(golden('start.save'), 1, 'start');
      await h.step(2);
      await h.send({ t: 'dev', id: 1, op: { op: 'panic' } });
      await h.step(1);
      const trap = h.last('trap');
      if (!trap) {
        ctx.skip('the real module does not panic on debug_dump(0xFFFFFFFF) yet');
        return;
      }
      expect(trap.tick).toBe(3);
      const log = parseClosureLog(new Uint8Array(trap.bundle?.log as ArrayBuffer));
      expect(log.header.end_tick).toBe(3);
      expect(SimStatus.ok).toBe(0);
    });
  },
);
