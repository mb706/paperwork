// The WebAssembly runners' shared core (src/dev/bench/sim-core.ts) against the M0 exit audit's #3 and #8 (C9): a gate
// whose metric is missing fails unless it is native only, and a result that did not simulate its plan's ticks is
// named; the walk's full plan is its 10 minutes.
import { describe, expect, it } from 'vitest';
import {
  type BenchScenario,
  type Gate,
  NATIVE_ONLY,
  planProblem,
  type ScenarioResult,
  verdicts,
} from '../../src/dev/bench/sim-core.ts';

const gate = (metric: string, floor = false): Gate => ({ metric, limit: 1, unit: 'ms', floor, scales: true });
const result = (metrics: Record<string, number>, ticks: number): ScenarioResult => ({
  metrics,
  allocs: null,
  memory_bytes: 0,
  ticks,
});

describe('the benchmark gates', () => {
  it('judge a missing metric as failed unless it is native only', () => {
    expect([...NATIVE_ONLY].sort()).toEqual(['actions_per_s', 'max_regenerations_per_tick']);
    const v = verdicts(
      [gate('tick_p99_ms'), gate('actions_per_s', true), gate('extract_p99_ms')],
      result({ tick_p99_ms: 2 }, 0),
      2.4,
    );
    expect(v.map((x) => [x.metric, x.met])).toEqual([
      ['tick_p99_ms', true],
      ['actions_per_s', null],
      ['extract_p99_ms', false],
    ]);
  });

  it("name a run that did not simulate its plan's ticks, and a plan without them", () => {
    const plan = { warmup: 6600, timed: 3600, profiled: 600, reps: 7, ticks: 36_000 };
    const sc = {
      name: 'm0-walk',
      full: plan,
      quick: { ...plan, warmup: 600, reps: 1, ticks: 4800 },
    } as BenchScenario;
    expect(planProblem(sc, result({}, 36_000), false)).toBeNull();
    expect(planProblem(sc, result({}, 31_200), false)).toBe('m0-walk: simulated 31200 ticks, the plan 36000');
    expect(planProblem(sc, result({}, 4800), true)).toBeNull();
    // the walk's full plan is §10.6's 10 minutes at 60 UPS
    expect(plan.warmup + plan.reps * (plan.timed + plan.profiled)).toBe(10 * 60 * 60);
    const stale = {
      name: 'm0-walk',
      full: { warmup: 6000, timed: 3600, reps: 7 },
      quick: plan,
    } as BenchScenario;
    expect(planProblem(stale, result({}, 31_200), false)).toMatch(/no ticks for its plan/);
  });
});
