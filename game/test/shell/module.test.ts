// The module wrapper (src/simworker/module.ts; 10 §3.6, §15.1, §15.8): the handshake refuses a stale module and
// the scaffold, the lease reacquires its views after memory moves and guards long-lived ones in dev builds, and
// a trap ends the instance for good.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABI_VERSION, InitInputCodec, NewWorldCodec, SimError, SimStatus } from '../../src/shared/gen/abi.ts';
import { ACTION_SCHEMA_VERSION, actionBytes, encodeClosure } from '../../src/shared/gen/actions.ts';
import { SCHEMA_HASH } from '../../src/shared/gen/schema.ts';
import { StaleViewError } from '../../src/simworker/lease.ts';
import {
  HandshakeError,
  handshake,
  instantiateSim,
  type SimInstance,
  TrapError,
} from '../../src/simworker/module.ts';
import { modelExports } from '../helpers/model-module.ts';
import { GAME } from '../helpers/paths.ts';
import { realSimBytes, STUB_COMMAND, scaffold, stubSim } from '../helpers/stubs.ts';

const golden = (p: string) => new Uint8Array(readFileSync(join(GAME, 'test', 'golden', 'm0', p)));
const protosBin = () => golden('protos/prototypes.bin');
const quiet = { log: () => {}, now: () => 0 };

async function stubWithWorld(logs: string[] = []): Promise<SimInstance> {
  const sim = await instantiateSim(await stubSim(), { log: (_l, m) => logs.push(m), now: () => 0 }, true);
  sim.cold((m) => m.init(InitInputCodec.encode({ protos: protosBin(), flags: 0 })));
  sim.cold((m) => m.newWorld(NewWorldCodec.encode({ ...NewWorldCodec.defaults(), seed: 7 })));
  return sim;
}

function tickWith(sim: SimInstance, closure: Uint8Array): number {
  const p = sim.input(closure.length);
  sim.lease.u8.set(closure, p);
  return sim.tick(closure.length);
}

const debugDump = (tick: number, seq: number, dumpId: number): Uint8Array =>
  encodeClosure([
    {
      player: 0xffff,
      system: true,
      tick,
      firstSeq: seq,
      actions: [actionBytes({ type: 'debug_dump', dump_id: dumpId })],
    },
  ]);

describe('the handshake (§15.1)', () => {
  it('accepts a module of this ABI and schema', async () => {
    const sim = await instantiateSim(await stubSim(), quiet, true);
    expect(sim.cold((m) => m.abiVersion())).toBeGreaterThan(0);
  });

  it('refuses the golden stale module, naming both hashes', async () => {
    const bytes = golden('negative/module/stale-schema.wasm');
    const err = await instantiateSim(await WebAssembly.compile(bytes), quiet, true).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HandshakeError);
    const h = err as HandshakeError;
    expect(h.reason).toBe('schema');
    expect(h.message).toContain(SCHEMA_HASH);
    expect(h.message).toContain(h.schemaHash);
    expect(h.schemaHash).not.toBe(SCHEMA_HASH);
  });

  it('refuses the M0 scaffold (ABI 0) as such, and accepts the real module', async () => {
    const err = await instantiateSim(await scaffold(), quiet, true).then(
      () => null,
      (e: unknown) => e as HandshakeError,
    );
    expect(err?.reason).toBe('scaffold');
    const real = await WebAssembly.compile(realSimBytes() as Uint8Array<ArrayBuffer>);
    const sim = await instantiateSim(real, quiet, true);
    expect(sim.cold((s) => s.abiVersion())).toBe(ABI_VERSION);
  });

  it('refuses a module that lacks exports', () => {
    const ex = modelExports() as unknown as Record<string, unknown>;
    delete ex.sim_query_step;
    expect(() => handshake(ex, null, true)).toThrow(/lacks the exports sim_query_step/);
  });
});

describe('the memory lease (§3.6 rule 4)', () => {
  it('reacquires views after memory growth and an epoch change; stale views throw in dev builds', async () => {
    const sim = await stubWithWorld();
    const before = sim.lease.generation;
    const views = sim.lease.views(() => sim.cold((m) => m.poolDir()));
    const serial = views.entity_table?.serial as Uint32Array;
    expect(Array.from(serial)).toEqual([1, 2, 3, 4]);
    const bytes = sim.lease.bytes;
    expect(tickWith(sim, debugDump(1, 1, STUB_COMMAND.grow))).toBe(SimStatus.ok);
    expect(sim.lease.generation).toBeGreaterThan(before);
    expect(sim.lease.bytes).toBeGreaterThan(bytes);
    expect(() => serial[0]).toThrow(StaleViewError);
    const again = sim.lease.views(() => sim.cold((m) => m.poolDir()));
    expect(Array.from(again.entity_table?.serial as Uint32Array)).toEqual([1, 2, 3, 4]);
  });

  it('release builds hand out plain views', async () => {
    const sim = await instantiateSim(await stubSim(), quiet, false);
    sim.cold((m) => m.init(InitInputCodec.encode({ protos: protosBin(), flags: 0 })));
    const v = sim.lease.views(() => sim.cold((m) => m.poolDir()));
    expect(v.entity_table?.serial).toBeInstanceOf(Uint32Array);
  });
});

describe('traps (§3.6)', () => {
  it('a panic is a trap with the panic hook message, and the instance is never called again', async () => {
    const logs: string[] = [];
    const sim = await stubWithWorld(logs);
    let err: unknown = null;
    try {
      tickWith(sim, debugDump(1, 1, STUB_COMMAND.panic));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TrapError);
    expect((err as TrapError).panic).toMatch(/dev panic requested by debug_dump at tick 1/);
    expect(logs.some((l) => l.startsWith('sim.wasm panicked:'))).toBe(true);
    expect(sim.dead).toBe(err);
    expect(() => sim.input(0)).toThrow(TrapError);
    expect(() => sim.cold((m) => m.meta())).toThrow(TrapError);
  });

  it('a trap without a panic carries the runtime error', async () => {
    const sim = await stubWithWorld();
    expect(() => tickWith(sim, debugDump(1, 1, STUB_COMMAND.unreachable))).toThrow(/trap: RuntimeError/);
    expect(sim.dead?.panic).toBeNull();
  });

  it('a failed status is not a trap', async () => {
    const sim = await stubWithWorld();
    const bad = debugDump(2, 1, 1); // stamped for tick 2 while tick 1 is next: ERR_FRAMING
    expect(tickWith(sim, bad)).toBe(SimStatus.err_framing);
    const e = sim.lastError();
    expect(e).toBeInstanceOf(SimError);
    expect(e.status).toBe(SimStatus.err_framing);
    expect(sim.dead).toBeNull();
    expect(ACTION_SCHEMA_VERSION).toBe(1);
  });
});
