// The feed's stand-in decoder (10 §15.4, §15.6) and the activity normalisation (§15.6).
import { describe, expect, test } from 'vitest';
import { DEFAULT_ERAS } from '../music/conductor.ts';
import { ACTIVITY_TAU, Activity, rawActivity } from './activity.ts';
import { encodePacket, PACKET_MAGIC, StandinPacket } from './standin.ts';
import { EVENT, newEventRecord, newWorkingRecord } from './types.ts';

describe('the stand-in packet decoder', () => {
  test('events and working records round-trip through the §15.4/§15.6 layouts', () => {
    const buf = encodePacket(
      7,
      12345,
      [
        { type: EVENT.entity_built, tick: 12340, proto: 17, ghost: true, x: 10.5, y: -3, player: 1 },
        { type: EVENT.action_failed, tick: 12344, reason: 4, x: 1.25, y: 2.5 },
        { type: EVENT.alert_raised, tick: 12345, reason: 2, x: -8, y: 9.5, historical: true },
      ],
      [{ sound: 3, n: 40, cx: -12.5, cy: 3.25, wsum: 17.5 }],
    );
    const p = new StandinPacket(buf);
    expect([p.generation, p.tick, p.eventCount, p.workingCount]).toEqual([7, 12345, 3, 1]);
    const e = newEventRecord();
    p.readEvent(0, e);
    expect(e).toMatchObject({
      type: EVENT.entity_built,
      tick: 12340,
      player: 1,
      proto: 17,
      entityFlags: 1,
      x: 10.5,
      y: -3,
      flags: 0,
    });
    p.readEvent(1, e);
    expect(e).toMatchObject({
      type: EVENT.action_failed,
      reason: 4,
      x: 1.25,
      y: 2.5,
      player: 0xffff,
      proto: -1,
    });
    p.readEvent(2, e);
    expect(e).toMatchObject({ type: EVENT.alert_raised, reason: 2, x: -8, y: 9.5, flags: 1 });
    const w = newWorkingRecord();
    p.readWorking(0, w);
    expect(w).toEqual({ sound: 3, n: 40, cx: -12.5, cy: 3.25, wsum: 17.5 });
    // an absent AUDIO_WORKING section means none
    expect(new StandinPacket(encodePacket(1, 1, [], null)).workingCount).toBe(0);
  });

  test('a malformed packet is refused, never misread', () => {
    expect(() => new StandinPacket(new ArrayBuffer(8))).toThrow();
    const buf = encodePacket(1, 1, [{ type: EVENT.entity_built, tick: 1 }], []);
    new DataView(buf).setUint32(0, PACKET_MAGIC + 1, true);
    expect(() => new StandinPacket(buf)).toThrow(/not a render packet/);
    const buf2 = encodePacket(1, 1, [{ type: EVENT.entity_built, tick: 1 }], []);
    new DataView(buf2).setUint32(32 + 8, 1 << 20, true); // the EVENTS section's length beyond the packet
    expect(() => new StandinPacket(buf2)).toThrow(/out of bounds/);
  });
});

describe('activity (10 §15.6)', () => {
  test('a = clamp(0.5 + 0.25 · log10(P / P_era), 0, 1)', () => {
    expect(rawActivity(1e6, 1e6)).toBeCloseTo(0.5);
    expect(rawActivity(1e4, 1e6)).toBeCloseTo(0);
    expect(rawActivity(1e8, 1e6)).toBeCloseTo(1);
    expect(rawActivity(1e3, 1e6)).toBe(0);
    expect(rawActivity(0, 1e6)).toBe(0);
    expect(rawActivity(1e7, 1e6)).toBeCloseTo(0.75);
  });

  test('smoothed with a 120-s time constant; the era by the Literature year picks P_era', () => {
    const a = new Activity(DEFAULT_ERAS);
    expect(a.update(1, 1e6, 1945)).toBeCloseTo(0.5); // the first reading sets the level
    // a step to 100× the era's typical draw: 63 % of the way after one time constant
    let v = 0;
    for (let t = 0; t < ACTIVITY_TAU; t++) v = a.update(1, 1e8, 1945);
    expect(v).toBeCloseTo(0.5 + 0.5 * (1 - Math.exp(-1)), 2);
    // in Era II (from 1957) the same 10 MW is only typical
    const b = new Activity(DEFAULT_ERAS);
    expect(b.update(1, 1e7, 1960)).toBeCloseTo(0.5);
  });
});
