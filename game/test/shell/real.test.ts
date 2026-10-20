// The real modules (crates/simabi and crates/genabi, the sim package's sim.wasm and gen.wasm, the full ABI by
// default since C3-r1) through the shell (test/golden/README.md "Shell (C3)": "with the real module: equal"):
// - the handshake;
// - the golden closure log replayed from start.save in replay mode, every d_t and r_3600 equal;
// - every ABI trace through the shell's module wrapper, and the negative closures refused, changing nothing;
// - SimHost on the real modules: a new game with a worldgen pool of real gen.wasm, test-mode steps, an
//   autosave, a load into a fresh worker with the same state hash, and the trap recovery;
// - the dev panic, once the module implements C3's proposal (DEV_PANIC_DUMP_ID).
// C2b's module has no extraction, subscriptions or queries yet (they answer ERR_ORDER until C2c): the shell runs
// its worlds without packets and sends a header-only FULL packet as a world's first, and the trace calls of
// those exports are skipped here as in test/sim-wasm.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineGen, inlineSim } from '../../src/app/inline.ts';
import { SimHost } from '../../src/app/sim-host.ts';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import { parseClosureLog } from '../../src/shared/gen/container.ts';
import { decodePacket } from '../../src/shared/gen/packet.ts';
import { StateHashCodec } from '../../src/shared/gen/projections.ts';
import { instantiateSim } from '../../src/simworker/module.ts';
import { STATUS_NAME } from '../golden/build/traces.ts';
import { sha256, testIo } from '../helpers/io.ts';
import { GAME } from '../helpers/paths.ts';
import { golden, goldenProtos, manifest, ShellHarness, settle } from '../helpers/shell-harness.ts';
import { realGen, realSim } from '../helpers/stubs.ts';
import { invokeTrace } from './trace-invoke.ts';

const real = await realSim();
const skip = 'skip' in real ? real.skip : null;
const module = 'module' in real ? real.module : null;
const quiet = { log: () => {}, now: () => 0 };

/** Extraction, subscriptions and queries arrive with C2c (they change no world state, D9). */
const C2C = [
  'sim_extract',
  'sim_subscribe',
  'sim_unsubscribe',
  'sim_query',
  'sim_query_step',
  'sim_query_cancel',
];

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

async function until(cond: () => boolean, what: string, n = 4000): Promise<void> {
  for (let i = 0; i < n && !cond(); i++) await settle();
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

describe.skipIf(skip !== null)(
  `the real sim.wasm through the shell${skip ? ` (skipped: ${skip})` : ''}`,
  () => {
    it('passes the handshake', async () => {
      const h = new ShellHarness();
      await h.boot(module);
      expect(h.of('ready')).toHaveLength(1);
      expect(h.of('refused')).toEqual([]);
    });

    it('replays the golden closure log from start.save: every d_t, and r_3600', async () => {
      const h = new ShellHarness();
      await h.boot(module);
      await h.load(golden('start.save'), 1, 'start');
      expect(h.errors()).toEqual([]);
      await h.send({ t: 'replay', gen: 1, log: golden('closure-log.pwlog').slice().buffer });
      for (let i = 0; i < 100_000 && h.of('replayed').length === 0; i++) h.advance(1);
      expect(h.last('replayed')).toEqual({ t: 'replayed', gen: 1, ok: true, tick: 3600 });
      for (const [t, d] of digestsTxt()) expect(h.shell.digests.get(t), `d_${t}`).toBe(d);
    });

    it('answers every ABI trace call as the golden traces say (C2c’s exports skipped)', async () => {
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
      let calls = 0;
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
          if (c.call.startsWith('gen_') || C2C.includes(c.call)) return;
          const where = `${t.name} call ${i + 1} ${c.call}`;
          const before = hash();
          const r = invokeTrace(sim, c.call, c.in ? golden(c.in) : new Uint8Array(), c.params ?? []);
          const after = hash();
          expect(STATUS_NAME.get(r.status), where).toBe(c.status);
          if (c.out) expect(Buffer.compare(r.out as Uint8Array, golden(c.out)), where).toBe(0);
          if (c.state === 'unchanged') expect(after, where).toBe(before);
          if (c.state === 'changed') expect(after, where).not.toBe(before);
          calls += 1;
        });
      }
      expect(calls).toBeGreaterThan(30);
    });

    it('refuses the negative closures with their statuses, changing nothing', async () => {
      const index = JSON.parse(
        readFileSync(join(GAME, 'test', 'golden', 'm0', 'negative', 'index.json'), 'utf8'),
      ) as {
        file: string;
        expect: string;
      }[];
      let n = 0;
      for (const c of index) {
        if (!c.file.startsWith('closures/')) continue;
        const h = new ShellHarness();
        await h.boot(module);
        await h.load(golden('start.save'), 1, 'start');
        const sim = h.shell.instance;
        if (!sim) throw new Error('no module');
        const before = StateHashCodec.decode(sim.cold((m) => m.stateHash())).hash;
        const r = invokeTrace(sim, 'sim_tick', golden(`negative/${c.file}`), []);
        expect(STATUS_NAME.get(r.status), c.file).toBe(c.expect);
        expect(StateHashCodec.decode(sim.cold((m) => m.stateHash())).hash, c.file).toBe(before);
        n += 1;
      }
      expect(n).toBeGreaterThanOrEqual(19);
    });

    it('SimHost on sim.wasm and a pool of gen.wasm: a new game, steps, an autosave, a load, the same state', async () => {
      const protos = goldenProtos();
      const { io } = await testIo();
      const packets: { gen: number; tick: number; flags: number; sections: number }[] = [];
      const h = new SimHost({
        build: manifest(protos),
        sim: module,
        gen: await realGen(),
        createSim: () => inlineSim({ protos: async () => protos, sha256 }),
        createGen: () => inlineGen(),
        genWorkers: 2,
        io,
        test: true,
        events: {
          packet: (bytes, gen) => {
            const p = decodePacket(bytes);
            packets.push({ gen, tick: p.header.tick, flags: p.header.flags, sections: p.sections.length });
          },
        },
      });
      const b = await h.newGame({ ...NewWorldCodec.defaults(), seed: 1945 });
      expect(b.gen).toBe(1);
      // C2b's module cannot extract: the world's first packet is the header alone, FULL, so the switch happens.
      expect(packets[0]).toMatchObject({ gen: 1, tick: 0, flags: 1 });
      expect(await h.step(30)).toBe(30);
      expect(await h.step(30)).toBe(60);
      const saved = await h.save('auto');
      expect(saved).toMatchObject({ t: 'saved' });
      const hash = await h.dev({ op: 'hash' });
      expect(hash.t).toBe('res');
      const before = StateHashCodec.decode(new Uint8Array((hash as { value: ArrayBuffer }).value)).hash;
      const loaded = await h.loadSave('_autosave1');
      expect(loaded).toMatchObject({ gen: 2, tick: 60 });
      const after = await h.dev({ op: 'hash' });
      expect(StateHashCodec.decode(new Uint8Array((after as { value: ArrayBuffer }).value)).hash).toBe(
        before,
      );
      expect(await h.step(5)).toBe(65);
      h.close();
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
    });

    it('the trap recovery on the real module: a world that traps reloads its last autosave', async (ctx) => {
      const protos = goldenProtos();
      const { io } = await testIo();
      const gens: number[] = [];
      const h = new SimHost({
        build: manifest(protos),
        sim: module,
        createSim: () => inlineSim({ protos: async () => protos, sha256 }),
        io,
        test: true,
        events: { generation: (g) => gens.push(g) },
      });
      await h.newGame({ ...NewWorldCodec.defaults(), seed: 7 });
      expect(await h.step(10)).toBe(10);
      await h.save('auto');
      expect(await h.step(5)).toBe(15);
      await h.dev({ op: 'panic' });
      const step = h.step(1).catch((e: unknown) => e);
      const r = await step;
      if (!(r instanceof Error)) {
        ctx.skip('the real module does not panic on debug_dump(0xFFFFFFFF) yet');
        h.close();
        return;
      }
      await until(() => gens.length >= 2, 'the recovered world');
      expect(h.lastTick).toBe(10);
      h.close();
    });
  },
);
