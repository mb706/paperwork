// D18 (g) in WebAssembly (10 §10.4 #9, §15.3, §15.11: "fuzzed closures that must never trap"; C8): real closures
// from the golden log and the 10,000-tick session, mutated by fast-check (bit flips, truncations, insertions,
// header fields at their limits, concatenations, random bytes), fed to sim.wasm's `sim_tick`. None may trap. A
// closure the preflight refuses must leave the state and the tick as they were; one it accepts runs its tick (its
// malformed actions are refused one by one, as events). The native fuzz (crates/sim/tests/rules/fuzz.rs) fuzzes
// typed actions inside well-framed batches; this one fuzzes the framing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseClosureLog } from '../../src/shared/gen/container.ts';
import { ReplaySource } from '../../src/simworker/sequencer.ts';
import { GAME } from '../helpers/paths.ts';
import { buildModule, initInput, stateInput, WasmSim } from '../sim-wasm/module.ts';

const file = (p: string) => new Uint8Array(readFileSync(join(GAME, p)));
const module = buildModule('simabi');
const protos = file('test/golden/m0/protos/prototypes.bin');
const golden = parseClosureLog(file('test/golden/m0/closure-log.pwlog'));
/** The log's blobs, as the shell supplies them before their tick (`sim_blob_put`). */
const replay = new ReplaySource(golden);
const start = file('test/golden/m0/states/tick-0000.sections');

/** Corpus: the golden log's closures, by tick (the world runs them at their own ticks). */
const corpus = golden.records.filter((r) => r.closure.length > 0);

function fresh(): WasmSim {
  const s = new WasmSim(module);
  expect(s.status('sim_init', initInput(protos))).toBe('ok');
  expect(s.status('sim_load', stateInput(start))).toBe('ok');
  return s;
}

/** The tick the world last ran (`sim_digest`'s first field). */
function tickOf(s: WasmSim): number {
  const r = s.envelope('sim_digest');
  return r.out ? new DataView(r.out.buffer).getUint32(0, true) : -1;
}

/** Supplies the blobs the log's closure of tick `t` names (§15.3: before the tick). */
function blobs(s: WasmSim, t: number): void {
  for (const b of replay.blobs(t) ?? []) expect(s.status('sim_blob_put', b)).toBe('ok');
}

/**
 * Runs the world to just before `t` with the golden log's closures, so a mutated closure of tick t is on time, and
 * supplies tick t's blobs.
 */
function advance(s: WasmSim, t: number): void {
  for (let k = tickOf(s) + 1; k < t; k++) {
    blobs(s, k);
    const c = golden.records.find((r) => r.tick === k)?.closure ?? new Uint8Array();
    expect(s.status('sim_tick', c)).toBe('ok');
  }
  blobs(s, t);
}

const mutation = fc.oneof(
  fc.record({ kind: fc.constant('flip' as const), at: fc.array(fc.nat(), { minLength: 1, maxLength: 8 }) }),
  fc.record({ kind: fc.constant('truncate' as const), at: fc.nat() }),
  fc.record({
    kind: fc.constant('insert' as const),
    at: fc.nat(),
    bytes: fc.uint8Array({ minLength: 1, maxLength: 9 }),
  }),
  fc.record({
    kind: fc.constant('field' as const),
    // the batch header's fields and the first action's header (§15.3)
    at: fc.constantFrom(0, 1, 2, 4, 8, 12, 16, 18),
    value: fc.constantFrom(0, 1, 0x7f, 0xff, 0x100, 0xfffe, 0xffff, 0x10000, 0x7fffffff, 0xffffffff),
  }),
  fc.record({ kind: fc.constant('twice' as const) }),
  fc.record({ kind: fc.constant('random' as const), bytes: fc.uint8Array({ maxLength: 200 }) }),
);
type Mutation = typeof mutation extends fc.Arbitrary<infer T> ? T : never;

function mutate(c: Uint8Array, m: Mutation): Uint8Array {
  switch (m.kind) {
    case 'flip': {
      const out = c.slice();
      for (const a of m.at) {
        const bit = a % (out.length * 8);
        out[bit >> 3] = (out[bit >> 3] as number) ^ (1 << (bit & 7));
      }
      return out;
    }
    case 'truncate':
      return c.slice(0, m.at % c.length);
    case 'insert': {
      const at = m.at % (c.length + 1);
      const out = new Uint8Array(c.length + m.bytes.length);
      out.set(c.subarray(0, at), 0);
      out.set(m.bytes, at);
      out.set(c.subarray(at), at + m.bytes.length);
      return out;
    }
    case 'field': {
      const out = c.slice();
      const v = new DataView(out.buffer);
      if (m.at + 4 <= out.length && (m.at === 4 || m.at === 8)) v.setUint32(m.at, m.value >>> 0, true);
      else if (m.at + 2 <= out.length && m.at !== 0 && m.at !== 1) v.setUint16(m.at, m.value & 0xffff, true);
      else if (m.at < out.length) out[m.at] = m.value & 0xff;
      return out;
    }
    case 'twice': {
      const out = new Uint8Array(c.length * 2);
      out.set(c, 0);
      out.set(c, c.length);
      return out;
    }
    case 'random':
      return m.bytes;
  }
}

describe('fuzzed closures in sim.wasm (D18 g)', () => {
  it('never trap; a refused closure changes nothing, an accepted one runs its tick', () => {
    const counts = { refused: 0, accepted: 0 };
    fc.assert(
      fc.property(fc.nat(corpus.length - 1), mutation, (k, m) => {
        const rec = corpus[k] as { tick: number; closure: Uint8Array };
        const s = fresh();
        advance(s, rec.tick);
        const before = s.stateHash();
        const tick = tickOf(s);
        const bad = mutate(rec.closure, m);
        let status = '';
        expect(
          () => {
            status = s.status('sim_tick', bad);
          },
          `${m.kind}: a trap (${s.panics.join('; ')})`,
        ).not.toThrow();
        if (status === 'ok') {
          counts.accepted += 1;
          expect(tickOf(s)).toBe(tick + 1);
        } else {
          counts.refused += 1;
          expect(s.stateHash(), `${m.kind}: a refused closure changed the state`).toBe(before);
          expect(tickOf(s)).toBe(tick);
          // and the world goes on with the real closure of that tick. A refused tick drops the blobs supplied for
          // it (the module holds them "until that tick ends", §15.3; the shell stops after any preflight failure
          // anyway, so nothing retries in the game): they are supplied again.
          blobs(s, rec.tick);
          expect(s.status('sim_tick', rec.closure)).toBe('ok');
        }
        expect(s.panics).toEqual([]);
      }),
      { numRuns: 300, seed: 2026 },
    );
    // Both outcomes were exercised: the preflight's refusals and accepted closures with refused actions.
    expect(counts.refused).toBeGreaterThan(30);
    expect(counts.accepted).toBeGreaterThan(30);
  });
});
