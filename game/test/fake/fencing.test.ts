// Input fencing in the fake, as the real contract has it (10 §15.3, D22; GATE-r2 finding 3): the LocalSequencer
// writes the input generation it tracks into every held input as it stamps it, whatever the main thread wrote;
// the tick fences a held input of another generation: its seq is consumed, an `input_fenced` event names it, and
// nothing else changes. Generations change only with release_inputs and player_left in the closure stream.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Action } from '../../src/shared/gen/actions.ts';
import { readEvents } from '../../src/shared/gen/events.ts';
import { decodePacket } from '../../src/shared/gen/packet.ts';
import type { FakeWorld } from '../../src/simworker/fake/world.ts';
import { fakeProtos, Harness } from './harness.ts';

beforeAll(() => {
  fakeProtos();
}, 60_000);

const p0 = (h: Harness) =>
  (h.sim as unknown as { world: FakeWorld }).world.chars[0] as FakeWorld['chars'][number];
const release: Action = { type: 'release_inputs', player: 0 };

/** The events of every packet so far. */
function events(h: Harness) {
  return h.packets.flatMap((b) => {
    const s = decodePacket(b).sections.find((x) => x.name === 'EVENTS');
    return s ? readEvents(s.bytes, s.count) : [];
  });
}
const fenced = (h: Harness) =>
  events(h)
    .filter((e) => e.payload.type === 'input_fenced')
    .map((e) => e.header.seq);

async function started(): Promise<Harness> {
  const h = new Harness();
  await h.start();
  await h.step(1);
  return h;
}

describe('input fencing in the fake (§15.3, D22)', () => {
  it("stamps held inputs with the sequencer's generation: the main thread's value does not matter", async () => {
    const h = await started();
    const x = p0(h).x;
    await h.act(1, { type: 'start_walking', input_gen: 123, dir: 4 });
    await h.step(1);
    expect(p0(h).x).toBeGreaterThan(x);
    expect(fenced(h)).toEqual([]);
  });

  it('fences a start stamped before a release: the character stays, the seq is consumed', async () => {
    const h = await started();
    const x = p0(h).x;
    await h.act(1, { type: 'start_walking', input_gen: 0, dir: 4 }); // seq 1, stamped with generation 0
    h.sim.injectSystem(release); // generation 1 from the next tick on
    await h.step(1);
    expect(fenced(h)).toEqual([1]);
    expect(p0(h).x).toBe(x);
    expect(p0(h).walking).toBe(false);
    expect(p0(h).inputGen).toBe(1);
    expect(p0(h).lastSeq).toBe(1);
    await h.act(1, { type: 'start_walking', input_gen: 0, dir: 4 }); // seq 2, stamped with generation 1
    await h.step(1);
    expect(p0(h).x).toBeGreaterThan(x);
  });

  it('fences a stop stamped before a release: a fresh start keeps the character walking', async () => {
    const h = await started();
    await h.act(1, { type: 'stop_walking', input_gen: 0 }); // seq 1, generation 0: stale once released
    h.sim.injectSystem(release);
    await h.act(1, { type: 'start_walking', input_gen: 0, dir: 4 }); // seq 2, stamped after the release
    const x = p0(h).x;
    await h.step(1);
    expect(fenced(h)).toEqual([1]);
    expect(p0(h).walking).toBe(true);
    expect(p0(h).x).toBeGreaterThan(x);
    await h.step(1);
    expect(p0(h).walking).toBe(true);
  });

  it('fences a mining begin stamped before a release', async () => {
    const h = await started();
    await h.act(1, { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: { x: 0, y: 0 } });
    h.sim.injectSystem(release);
    await h.step(1);
    expect(fenced(h)).toEqual([1]);
    expect(p0(h).mining).toBe(null);
    expect(events(h).filter((e) => e.payload.type === 'action_failed')).toEqual([]);
  });
});
