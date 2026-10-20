// The steady state of the shell's tick path (pm/wp/C3-shell.md quality bar; A1 open issue 7; 10 §2.5 "The sim
// worker's per-tick path allocates nothing") and the boundary audit (§3.6 rule 3: "the shell calls at most a
// fixed number of exports per tick", never per entity).
//
// Allocation is measured on V8's heap with the collector exposed: after a warm-up (so the JIT's own feedback is
// in place), a collection, then thousands of ticks with extraction, the heap may not grow by more than a few bytes
// per tick (a per-tick object of 16 bytes over 6,000 ticks would be 96 KB, far below a scavenge). The host here
// copies nothing and hands each packet buffer straight back, as the main thread's `ack` does.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import type { MainToSim, SimToMain } from '../../src/shared/protocol.ts';
import { handshake, type SimInstance } from '../../src/simworker/module.ts';
import { type ShellHost, SimShell } from '../../src/simworker/shell.ts';
import { modelExports } from '../helpers/model-module.ts';
import { GAME } from '../helpers/paths.ts';
import { golden, goldenProtos, loadMessage, manifest } from '../helpers/shell-harness.ts';
import { stubSim } from '../helpers/stubs.ts';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/**
 * A shell whose host keeps nothing: a manual clock whose one pending wake the test fires, and packets acked at
 * once with the same buffer (the slot's views are reused), as the main thread's `ack` does.
 */
function lean(instantiate?: ShellHost['instantiate']) {
  let shell: SimShell | null = null;
  const acks: { t: 'ack'; buf: ArrayBuffer } = { t: 'ack', buf: new ArrayBuffer(0) };
  let packets = 0;
  const clock = new Float64Array(1);
  let wake: (() => void) | null = null;
  const host: ShellHost = {
    post: (m: SimToMain) => {
      if (m.t === 'pkt') {
        packets += 1;
        acks.buf = m.buf;
        shell?.handle(acks);
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
    protos: async () => goldenProtos(),
    sha256: async (b) => new Uint8Array(createHash('sha256').update(b).digest()),
  };
  if (instantiate) host.instantiate = instantiate;
  shell = new SimShell(host);
  return {
    shell,
    packets: () => packets,
    /** One frame of the clock: time moves a tick on and the pending wake runs. */
    frame: () => {
      clock[0] = (clock[0] as number) + 1000 / 60;
      const f = wake;
      wake = null;
      f?.();
    },
  };
}

describe('the steady-state tick path allocates nothing (A1 open issue 7)', () => {
  it('the clock runs 20,000 frames, a tick and a packet each, acked: nothing retained, a timestamp at most', () => {
    // In a child Node process (test/shell/steady-probe.ts): Vitest's module transform would add its own garbage.
    const out = execFileSync(
      process.execPath,
      ['--expose-gc', join(GAME, 'test', 'shell', 'steady-probe.ts'), '20000'],
      {
        encoding: 'utf8',
      },
    );
    const r = JSON.parse(out.trim().split('\n').at(-1) as string) as {
      ticks: number;
      packets: number;
      allocatedPerFrame: number;
      retainedPerFrame: number;
    };
    expect(r.ticks).toBe(20000);
    expect(r.packets).toBeGreaterThanOrEqual(19990);
    // The clock's timestamps are doubles (performance.now()), which V8 may box: up to two 16-byte numbers per
    // wake; everything else of the wake allocates nothing, and nothing is retained.
    expect(r.allocatedPerFrame).toBeLessThan(48);
    expect(r.retainedPerFrame).toBeLessThan(4);
  });

  it('the tick path alone (one step of 6,000 ticks): no growth at all beyond noise', async () => {
    const { shell } = lean();
    await shell.handle({ t: 'boot', build: manifest(), module: await stubSim(), ioPort: null, genPorts: [] });
    await shell.handle({ t: 'seq', op: 'pause' });
    await shell.handle({ t: 'world', gen: 1, op: 'new', settings: { ...NewWorldCodec.defaults(), seed: 1 } });
    await shell.handle({ t: 'seq', op: { step: 3000 } });
    const big: MainToSim = { t: 'seq', op: { step: 6000 } };
    gc();
    const before = process.memoryUsage().heapUsed;
    await shell.handle(big);
    const grown = process.memoryUsage().heapUsed - before;
    expect(shell.tick).toBe(9000);
    expect(grown).toBeLessThan(32 * 1024);
  });
});

describe('the boundary audit (§3.6 rule 3)', () => {
  it('a tick calls a fixed set of exports, an extraction two more, whatever the world holds', async () => {
    let calls: Map<string, number> | null = null;
    const { shell } = lean(async (_m, _hooks, dev) => {
      const ex = modelExports();
      calls = ex.counts;
      return handshake(ex as unknown as Record<string, unknown>, null, dev) as SimInstance;
    });
    await shell.handle({ t: 'boot', build: manifest(), module: null, ioPort: null, genPorts: [] });
    await shell.handle({ t: 'seq', op: 'pause' });
    const { sections, meta } = loadMessage(golden('start.save'));
    await shell.handle({ t: 'world', gen: 1, op: 'load', sections, meta });
    const counts = calls as unknown as Map<string, number>;
    const snapshot = () => new Map(counts);
    const before = snapshot();
    await shell.handle({ t: 'seq', op: { step: 100 } });
    const per = (name: string) => ((counts.get(name) ?? 0) - (before.get(name) ?? 0)) / 100;
    // 100 ticks and one extraction: per tick an input buffer, the tick, its digest and its chunk requests.
    expect(per('sim_tick')).toBe(1);
    expect(per('sim_digest')).toBe(1);
    expect(per('sim_pending_chunks')).toBe(1);
    expect(per('sim_input')).toBeCloseTo(1.01, 5); // + the extraction's view request
    expect(per('sim_extract')).toBeCloseTo(0.01, 5);
    const other = [...counts.keys()].filter(
      (k) =>
        !['sim_tick', 'sim_digest', 'sim_pending_chunks', 'sim_input', 'sim_extract'].includes(k) &&
        per(k) > 0,
    );
    expect(other).toEqual([]);
  });
});
