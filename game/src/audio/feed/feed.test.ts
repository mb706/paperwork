// The audio view of render packets over the schema package's generated decoders (10 §15.4, §15.6; C1b),
// the music feed from the HUD projection, and the activity normalisation (§15.6).
import { describe, expect, test } from 'vitest';
import { DecodeError } from '../../shared/gen/codec.ts';
import { readEvents } from '../../shared/gen/events.ts';
import { decodePacket, PACKET_MAGIC, PacketSection } from '../../shared/gen/packet.ts';
import { HudCodec, HudFlags } from '../../shared/gen/projections.ts';
import { AlertType, FailReason } from '../../shared/gen/types.ts';
import { DEFAULT_ERAS } from '../music/conductor.ts';
import { ACTIVITY_TAU, Activity, rawActivity } from './activity.ts';
import { encodePacket } from './encode.ts';
import { GenPacketView, musicFeedOf } from './gen.ts';
import { EVENT, type MusicFeed, newEventRecord, newWorkingRecord } from './types.ts';

describe('render packets through the generated decoders', () => {
  test('events and working records: what audio reads equals what was written', () => {
    const bytes = encodePacket(
      7,
      12345,
      [
        { type: EVENT.entity_built, tick: 12340, proto: 17, ghost: true, x: 10.5, y: -3, player: 1 },
        { type: EVENT.action_failed, tick: 12344, reason: FailReason.out_of_reach, x: 1.25, y: 2.5 },
        {
          type: EVENT.alert_raised,
          tick: 12345,
          reason: AlertType.entity_destroyed,
          x: -8,
          y: 9.5,
          historical: true,
        },
        { type: EVENT.research_completed, tick: 12345 },
        { type: EVENT.entity_mined, tick: 12345, proto: 40, x: 3, y: 4 },
      ],
      [{ sound: 3, n: 40, cx: -12.5, cy: 3.25, wsum: 17.5 }],
    );
    const packet = decodePacket(bytes);
    // the generated strict reader accepts every record the test encoder wrote
    const evs = packet.sections.find((x) => x.type === PacketSection.events);
    expect(readEvents(evs?.bytes ?? new Uint8Array(0), evs?.count ?? 0).map((e) => e.payload.type)).toEqual([
      'entity_built',
      'action_failed',
      'alert_raised',
      'research_completed',
      'entity_mined',
    ]);
    const p = new GenPacketView().set(packet);
    expect([p.generation, p.tick, p.eventCount, p.workingCount]).toEqual([7, 12345, 5, 1]);
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
      reason: FailReason.out_of_reach,
      x: 1.25,
      y: 2.5,
      player: 0xffff,
      proto: -1,
    });
    p.readEvent(2, e);
    expect(e).toMatchObject({
      type: EVENT.alert_raised,
      reason: AlertType.entity_destroyed,
      x: -8,
      y: 9.5,
      flags: 1,
    });
    p.readEvent(3, e);
    expect(e).toMatchObject({ type: EVENT.research_completed, proto: -1, reason: -1 });
    expect(Number.isNaN(e.x)).toBe(true);
    p.readEvent(4, e);
    expect(e).toMatchObject({ type: EVENT.entity_mined, proto: 40, x: 3, y: 4 });
    const w = newWorkingRecord();
    p.readWorking(0, w);
    expect(w).toEqual({ sound: 3, n: 40, cx: -12.5, cy: 3.25, wsum: 17.5 });
    // the view is reused: an absent AUDIO_WORKING section means none
    p.set(decodePacket(encodePacket(8, 1, [], null)));
    expect([p.generation, p.eventCount, p.workingCount]).toEqual([8, 0, 0]);
  });

  test('a malformed packet is refused by the generated decoder, never misread', () => {
    expect(() => decodePacket(new Uint8Array(8))).toThrow(DecodeError);
    const bad = encodePacket(1, 1, [{ type: EVENT.entity_built, tick: 1 }], []);
    new DataView(bad.buffer).setUint32(0, PACKET_MAGIC + 1, true);
    expect(() => decodePacket(bad)).toThrow(DecodeError);
    const long = encodePacket(1, 1, [{ type: EVENT.entity_built, tick: 1 }], []);
    new DataView(long.buffer).setUint32(32 + 8, 1 << 20, true); // the EVENTS section's length beyond the packet
    expect(() => decodePacket(long)).toThrow(DecodeError);
  });

  test('the music feed comes from the HUD projection', () => {
    const hud = {
      ...HudCodec.defaults(),
      literature: 1961.5,
      activity_w: 2.5e7,
      doubling_time_s: 0,
      flags: HudFlags.closed,
    };
    const f: MusicFeed = {
      literatureYear: 0,
      consumptionW: 0,
      doublingTime: 0,
      closed: false,
      victory: false,
    };
    expect(musicFeedOf(hud, f)).toEqual({
      literatureYear: 1961.5,
      consumptionW: 2.5e7,
      doublingTime: 0,
      closed: true,
      victory: false,
    });
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
