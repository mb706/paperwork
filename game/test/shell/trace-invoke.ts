// Calls a sim export as the shell calls exports (test/golden/README.md "ABI traces"; build/traces.ts `invoke`, which
// every trace consumer reimplements over its own module): the input written into `sim_input`'s buffer, the raw
// status or envelope address, and on a failure the code `sim_last_error` reports, which must be the status.
// `out` is the envelope's payload. golden.test.ts runs it on the reference model, real.test.ts on sim.wasm.
import { expect } from 'vitest';
import { SimStatus } from '../../src/shared/gen/abi.ts';
import type { SimInstance } from '../../src/simworker/module.ts';

/** The sim exports a trace calls, by kind (abi.yaml `sim_exports`), and those taking parameters, not input. */
const STATUS_EXPORTS = new Set([
  'sim_init',
  'sim_new_world',
  'sim_load',
  'sim_tick',
  'sim_set_flags',
  'sim_blob_put',
  'sim_supply_chunk',
  'sim_subscribe',
  'sim_unsubscribe',
  'sim_query',
  'sim_query_cancel',
]);
const PARAM_EXPORTS = new Set(['sim_set_flags', 'sim_query_step', 'sim_query_cancel']);
const NO_INPUT = new Set([
  'sim_pending_chunks',
  'sim_digest',
  'sim_state_hash',
  'sim_meta',
  'sim_load_report',
]);

/**
 * Runs an indexed trace call as the shell calls exports (README "ABI traces"; build/traces.ts `invoke`): the
 * input written into `sim_input`'s buffer, the raw status or envelope address, and on a failure the code that
 * `sim_last_error` reports, which must be the status. `out` is the envelope's payload.
 */
export function invokeTrace(
  sim: SimInstance,
  call: string,
  input: Uint8Array,
  params: number[],
): { status: number; out?: Uint8Array } {
  const e = sim.e as unknown as Record<string, (...a: number[]) => number>;
  let args: number[] = [];
  if (PARAM_EXPORTS.has(call)) args = params;
  else if (!NO_INPUT.has(call)) {
    const p = sim.input(input.length);
    sim.lease.u8.set(input, p);
    args = [input.length];
  }
  const f = e[call];
  if (!f) throw new Error(`no export ${call}`);
  const ret = f(...args) >>> 0;
  sim.lease.check();
  if (STATUS_EXPORTS.has(call)) {
    if (ret !== SimStatus.ok) expect(sim.lastError().status, `${call}: sim_last_error`).toBe(ret);
    return { status: ret };
  }
  if (ret === 0) return { status: sim.lastError().status };
  expect(ret % 8, `${call}: an 8-aligned envelope`).toBe(0);
  const len = sim.lease.dv.getUint32(ret, true);
  return { status: SimStatus.ok, out: sim.lease.u8.slice(ret + 4, ret + 4 + len) };
}
