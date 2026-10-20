// `simtool replay` on the bug bundles the browser makes (C2c-r1 finding 7): the shell (SimHost) runs the real
// sim.wasm with the IO worker, which keeps a trap's bundle under OPFS `reports/<time>/` with its base save as a
// §8.1 container whose sections it deflated (codec 1). The bundle's files go to a directory, and simtool, built
// with simcheck as the dev module is, reproduces the trap at its tick natively. The reviewed simtool refused the
// deflated sections before replaying anything.
import 'fake-indexeddb/auto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inlineSim } from '../../src/app/inline.ts';
import { SimHost } from '../../src/app/sim-host.ts';
import { NewWorldCodec } from '../../src/shared/gen/abi.ts';
import { readSaveContainer } from '../../src/shared/gen/container.ts';
import { MemoryOpfs, sha256, testIo } from '../helpers/io.ts';
import { GAME } from '../helpers/paths.ts';
import { goldenProtos, manifest } from '../helpers/shell-harness.ts';
import { realSim } from '../helpers/stubs.ts';

const real = await realSim();
const module = 'module' in real ? real.module : null;

/** simtool as the dev module is built: with simcheck, so `debug_dump(0xFFFFFFFF)` traps natively too. */
function simtool(): string {
  const r = spawnSync('cargo', ['build', '--locked', '--quiet', '-p', 'simtool', '--features', 'simcheck'], {
    cwd: GAME,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`cargo build of simtool failed:\n${r.stderr}`);
  return join(GAME, 'target', 'debug', 'simtool');
}

async function until(cond: () => boolean, what: string, n = 4000): Promise<void> {
  for (let i = 0; i < n && !cond(); i++) await new Promise((r) => setTimeout(r, 2));
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

describe.skipIf(module === null)('simtool replay on a browser bug bundle', () => {
  it('reproduces the trap of a bundle the IO worker kept, its save deflated', async () => {
    const bin = simtool();
    const protos = goldenProtos();
    const opfs = new MemoryOpfs();
    const { io } = await testIo({ opfs });
    const traps: { tick: number; report: string | null }[] = [];
    const h = new SimHost({
      build: manifest(protos),
      sim: module as WebAssembly.Module,
      createSim: () => inlineSim({ protos: async () => protos, sha256 }),
      io,
      test: true,
      events: { trap: (t) => traps.push(t) },
    });
    await h.newGame({ ...NewWorldCodec.defaults(), seed: 7 });
    expect(await h.step(10)).toBe(10);
    await h.save('auto');
    expect(await h.step(5)).toBe(15);
    await h.dev({ op: 'panic' });
    await h.step(1).catch(() => {});
    await until(() => traps.length > 0 && traps[0]?.report !== undefined, 'the trap');
    const report = traps[0]?.report;
    expect(report).toBeTruthy();
    const files = opfs.names(`reports/${report}`).sort();
    expect(files).toEqual(['closures.pwlog', 'digests.bin', 'report.json', 'save.save']);
    const save = opfs.files.get(`reports/${report}/save.save`) as Uint8Array;
    // The IO worker deflated the save's sections (§8.1): the reviewed simtool refused this container.
    expect(readSaveContainer(save).frames.some((f) => f.codec === 1)).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    mkdirSync(dir, { recursive: true });
    for (const f of files)
      writeFileSync(join(dir, f), opfs.files.get(`reports/${report}/${f}`) as Uint8Array);
    const protosPath = join(GAME, 'test', 'golden', 'm0', 'protos', 'prototypes.bin');
    const r = spawnSync(bin, ['replay', dir, '--protos', protosPath], { encoding: 'utf8' });
    expect(r.status, r.stderr).not.toBe(0);
    expect(r.stderr).toContain(`simtool: trap at tick ${traps[0]?.tick}`);
    expect(r.stderr).toContain('the dev panic');
    // Up to the tick before the trap, the replay checks the bundle's digests: `--to` stops short of it.
    const ok = spawnSync(
      bin,
      ['replay', dir, '--protos', protosPath, '--to', String((traps[0]?.tick ?? 1) - 1)],
      {
        encoding: 'utf8',
      },
    );
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stderr).toMatch(/\d+ recorded digests match/);
    rmSync(dir, { recursive: true, force: true });
    h.close();
  }, 300_000);
});
