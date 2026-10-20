// The SFX system (10 §9.4, §15.6; A4 §7.3): variants, jitter, rate limits, positional mixing, the event map,
// historical silence and the working loops, with deterministic seeds and a recording voice engine.
import { describe, expect, test } from 'vitest';
import type { NoteRecord, VoiceEngine } from '../bank-client.ts';
import { makeRng } from '../core/rng.ts';
import { type EventSpec, encodePacket, StandinPacket } from '../feed/standin.ts';
import { EVENT, type ProtoInfo, type WorkingRecord } from '../feed/types.ts';
import type { SoundEntry, SoundsManifest } from '../loading/manifest.ts';
import { SFX_DEST } from '../worklet/protocol.ts';
import { FootstepClock, HISTORY_TICKS, LOOP_FADE, MAX_LOOPS, SfxSystem, STALE_AFTER } from './sfx.ts';
import { SoundTable } from './sounds.ts';
import { distanceGain, panFor, placeAt, workingMix, zoomGain } from './spatial.ts';

class Recorder implements VoiceEngine {
  notes: NoteRecord[] = [];
  controls: { handle: number; gain: number; pan: number; release: boolean; tau: number }[] = [];
  note(r: NoteRecord) {
    this.notes.push(r);
  }
  control(handle: number, gain: number, pan: number, release = false, tau = 0.3) {
    this.controls.push({ handle, gain, pan, release, tau });
  }
  flush() {}
  buffer() {}
  free() {}
}

const file = {
  file: 'x',
  len: 32000,
  channels: 1 as const,
  fp: { at: 0, data: [] },
  bytes: { ogg: 1, m4a: 1 },
};
function sound(p: Omit<Partial<SoundEntry>, 'files'> & { files?: number; loop?: boolean }): SoundEntry {
  return {
    bus: 'effects',
    gainDb: 0,
    pitchJitter: 0.03,
    gainJitterDb: 1.5,
    rate: null,
    voices: 4,
    priority: 1,
    positional: true,
    licence: 'test',
    ...p,
    loop: p.loop ?? false,
    files: Array.from({ length: typeof p.files === 'number' ? p.files : 3 }, () => ({
      ...file,
      loopStart: 1600,
      loopEnd: 30400,
    })),
  };
}

const MANIFEST: SoundsManifest = {
  version: 1,
  rate: 32000,
  prototypesHash: null,
  sounds: {
    'ui-click': sound({
      bus: 'gui',
      positional: false,
      pitchJitter: 0.015,
      rate: { count: 1, windowMs: 30 },
    }),
    error: sound({ bus: 'gui', positional: false, rate: { count: 1, windowMs: 100 }, files: 2 }),
    'build-small': sound({ rate: { count: 3, windowMs: 100 } }),
    'build-large': sound({ rate: { count: 3, windowMs: 100 }, files: 2 }),
    'mine-ore': sound({ rate: { count: 2, windowMs: 100 }, files: 4 }),
    deconstruct: sound({}),
    alert: sound({ bus: 'alerts', positional: false, files: 1, priority: 3 }),
    ...Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [
        `loop-${String(i).padStart(2, '0')}`,
        sound({ bus: 'environment', loop: true, files: 1, voices: 1 }),
      ]),
    ),
  },
  events: {
    action_failed: 'error',
    entity_built: {
      bySize: { small: 'build-small', medium: 'build-small', large: 'build-large' },
      smallMax: 1,
      mediumMax: 3,
    },
    entity_mined: { byKind: { resource: 'mine-ore', entity: 'deconstruct' } },
    alert_raised: 'alert',
  },
  working: {},
  music: { eras: [] },
};

const PROTO: ProtoInfo = {
  entitySize: (p) => (p === 9 ? 5 : 1),
  minedKind: (p) => (p === 50 ? 'resource' : 'entity'),
  isDeveloperReason: (r) => r >= 100,
};

function setup() {
  const table = new SoundTable(MANIFEST);
  let id = 1;
  for (const s of table.byName.values())
    for (const f of s.def.files)
      s.variants.push({ id: id++, len: f.len, loopStart: f.loopStart ?? 0, loopEnd: f.loopEnd ?? 0 });
  const rec = new Recorder();
  const clock = { t: 10 };
  const sfx = new SfxSystem(rec, table, () => clock.t, PROTO, makeRng(1));
  sfx.view = { cx: 0, cy: 0, halfWidth: 32, zoom: 1, mapView: false };
  return { table, rec, clock, sfx };
}

const packet = (gen: number, tick: number, events: EventSpec[], working: WorkingRecord[] | null) =>
  new StandinPacket(encodePacket(gen, tick, events, working));

describe('spatial', () => {
  test("Factorio's attenuation: −6 dB at half a screen, ±0.7 pan at the edges, −9 dB at 0.25× zoom", () => {
    expect(20 * Math.log10(distanceGain(32, 32))).toBeCloseTo(-6.02, 2);
    expect(panFor(32, 32)).toBeCloseTo(0.7);
    expect(panFor(-100, 32)).toBeCloseTo(-0.7);
    expect(20 * Math.log10(zoomGain(0.25))).toBeCloseTo(-9, 6);
    expect(zoomGain(1)).toBe(1);
    expect(zoomGain(2)).toBe(1);
    const [g, p] = placeAt({ cx: 10, cy: 10, halfWidth: 20, zoom: 1, mapView: false }, 30, 10);
    expect(20 * Math.log10(g)).toBeCloseTo(-6.02, 2);
    expect(p).toBeCloseTo(0.7);
    // working sounds: min(1, 0.5 · log2(1 + n)) × wsum / n × zoom
    const [wg] = workingMix({ cx: 0, cy: 0, halfWidth: 32, zoom: 1, mapView: false }, 1, 0, 1);
    expect(wg).toBeCloseTo(0.5);
    const [wg3] = workingMix({ cx: 0, cy: 0, halfWidth: 32, zoom: 1, mapView: false }, 100, 0, 50);
    expect(wg3).toBeCloseTo(0.5);
  });
});

describe('one-shots', () => {
  test('never the same variant twice in a row; jitter within ±pitch and ±1.5 dB', () => {
    const { sfx, rec, clock } = setup();
    let last = -1;
    for (let i = 0; i < 500; i++) {
      clock.t += 1;
      expect(sfx.play('build-small', 0, 0)).toBe(true);
      const n = rec.notes[rec.notes.length - 1] as NoteRecord;
      expect(n.SRC).not.toBe(last);
      last = n.SRC as number;
      expect(Math.abs((n.RATE as number) - 1)).toBeLessThanOrEqual(0.03);
      expect(Math.abs(20 * Math.log10(n.GAIN as number))).toBeLessThanOrEqual(1.5 + 1e-9);
      expect(n.DEST).toBe(SFX_DEST + 1); // the effects bus
    }
    expect(new Set(rec.notes.map((n) => n.SRC)).size).toBe(3);
  });

  test('rate limits drop, never queue: error 1 per 100 ms, build 3, mine 2, UI click 1 per 30 ms', () => {
    const { sfx, clock, rec } = setup();
    const burst = (name: string, n: number) =>
      Array.from({ length: n }, () => sfx.play(name, 0, 0)).filter(Boolean).length;
    expect(burst('error', 5)).toBe(1);
    expect(burst('build-small', 10)).toBe(3);
    expect(burst('mine-ore', 10)).toBe(2);
    expect(burst('ui-click', 10)).toBe(1);
    clock.t += 0.031;
    expect(burst('ui-click', 10)).toBe(1);
    expect(burst('error', 1)).toBe(0); // still within error's 100 ms
    clock.t += 0.07;
    expect(burst('error', 1)).toBe(1);
    expect(sfx.stats.limited).toBeGreaterThan(20);
    expect(rec.notes.length).toBe(1 + 3 + 2 + 2 + 1 + 3 * 0);
  });

  test('UI sounds are not placed; world sounds fall off and pan', () => {
    const { sfx, rec } = setup();
    sfx.play('alert');
    expect(rec.notes[0]?.PAN).toBe(0);
    sfx.play('deconstruct', 32, 0);
    const n = rec.notes[1] as NoteRecord;
    expect(n.PAN).toBeCloseTo(0.7);
    expect(20 * Math.log10(n.GAIN as number)).toBeLessThan(-6 + 1.5 + 1e-9);
    expect(20 * Math.log10(n.GAIN as number)).toBeGreaterThan(-6 - 1.5 - 1e-9);
  });
});

describe('events', () => {
  test('the map, history and ownership', () => {
    const { sfx, rec } = setup();
    sfx.localPlayer = 2;
    sfx.onPacket(
      packet(
        1,
        1000,
        [
          { type: EVENT.entity_built, tick: 1000, proto: 1, x: 0, y: 0 }, // small
          { type: EVENT.entity_built, tick: 1000, proto: 9, x: 0, y: 0 }, // large
          { type: EVENT.entity_built, tick: 1000, proto: 1, ghost: true }, // a ghost: silent
          { type: EVENT.entity_mined, tick: 1000, proto: 50 }, // a resource
          { type: EVENT.entity_mined, tick: 1000, proto: 3 }, // an entity
          { type: EVENT.entity_built, tick: 1000, proto: 1, historical: true }, // catch-up: silent
          { type: EVENT.entity_built, tick: 1000 - HISTORY_TICKS - 1, proto: 1 }, // stale: silent
          { type: EVENT.action_failed, tick: 1000, reason: 5, player: 2 }, // own error
          { type: EVENT.action_failed, tick: 1000, reason: 5, player: 7 }, // another player's: silent
          { type: EVENT.action_failed, tick: 1000, reason: 100, player: 2 }, // a developer reason: silent
          { type: EVENT.entity_built, tick: 1000, proto: 1, player: 7, x: 1, y: 1 }, // others' world sounds play
          { type: EVENT.alert_raised, tick: 1000, reason: 3 },
          { type: EVENT.research_completed, tick: 1000 }, // unmapped here: silent
        ],
        null,
      ),
    );
    const byId = (id: number) =>
      [...sfx.table.byName.values()].find((s) => s.variants.some((v) => v.id === id))?.name;
    expect(rec.notes.map((n) => byId(n.SRC as number))).toEqual([
      'build-small',
      'build-large',
      'mine-ore',
      'deconstruct',
      'error',
      'build-small',
      'alert',
    ]);
    expect(sfx.stats.historical).toBe(2);
  });
});

describe('working sounds', () => {
  const ids = (t: SoundTable) => [...t.byName.values()].filter((s) => s.def.loop).map((s) => s.id);

  test('one loop per sound id, a random offset inside the loop, gain from count and distance', () => {
    const { sfx, rec, table } = setup();
    const [a, b] = ids(table) as [number, number];
    sfx.onPacket(
      packet(
        1,
        1,
        [],
        [
          { sound: a, n: 30, cx: -16, cy: 0, wsum: 15 },
          { sound: b, n: 1, cx: 32, cy: 0, wsum: 0.5 },
        ],
      ),
    );
    expect(rec.notes.length).toBe(2);
    const na = rec.notes[0] as NoteRecord;
    expect(na.SMOOTH).toBe(1);
    expect(na.LOOP_S).toBe(1600);
    expect(na.LOOP_E).toBe(30400);
    expect((na.OFFSET as number) * 32000).toBeGreaterThanOrEqual(1600);
    expect((na.OFFSET as number) * 32000).toBeLessThan(30400);
    expect(na.ATTACK).toBe(LOOP_FADE);
    expect(na.GAIN).toBeCloseTo(1 * (15 / 30));
    expect(na.PAN).toBeCloseTo(-0.35);
    const nb = rec.notes[1] as NoteRecord;
    expect(nb.GAIN).toBeCloseTo(0.5 * 0.5);
    // the same records again: nothing new; a moved centroid: one control
    sfx.onPacket(
      packet(
        1,
        2,
        [],
        [
          { sound: a, n: 30, cx: -16, cy: 0, wsum: 15 },
          { sound: b, n: 1, cx: 0, cy: 0, wsum: 1 },
        ],
      ),
    );
    expect(rec.notes.length).toBe(2);
    expect(rec.controls.length).toBe(1);
    // the section is a snapshot: an absent sound fades out over 0.3 s
    sfx.onPacket(packet(1, 3, [], [{ sound: a, n: 30, cx: -16, cy: 0, wsum: 15 }]));
    expect(rec.controls.at(-1)).toMatchObject({ handle: nb.HANDLE, release: true, tau: LOOP_FADE });
    // no section at all: none
    sfx.onPacket(packet(1, 4, [], null));
    expect(rec.controls.at(-1)).toMatchObject({ handle: na.HANDLE, release: true });
    expect(sfx.stats.loops).toBe(0);
  });

  test('at most 12 loops, the loudest; staleness and a new generation fade everything', () => {
    const { sfx, rec, table, clock } = setup();
    const all = ids(table);
    const recs = all.map((id, i) => ({ sound: id, n: 4, cx: 0, cy: 0, wsum: 0.2 + i * 0.25 }));
    sfx.onPacket(packet(1, 1, [], recs));
    expect(rec.notes.length).toBe(MAX_LOOPS);
    // the two quietest are the ones left out
    const started = new Set(rec.notes.map((n) => n.TYPE));
    expect(started.has(all[0])).toBe(false);
    expect(started.has(all[1])).toBe(false);
    clock.t += STALE_AFTER + 0.01;
    sfx.tick();
    expect(rec.controls.filter((c) => c.release).length).toBe(MAX_LOOPS);
    sfx.onPacket(packet(1, 2, [], recs.slice(0, 3)));
    const before = rec.controls.length;
    sfx.onPacket(packet(2, 3, [], recs.slice(0, 3)));
    expect(rec.controls.length - before).toBe(3); // a new generation: the old loops fade, new ones start
  });
});

test('footsteps follow the walk cycle: about 3.7 a second at running speed', () => {
  const f = new FootstepClock();
  let steps = 0;
  for (let i = 0; i < 600; i++) steps += f.advance(0.15); // 10 s of running at 0.15 tiles per tick
  expect(steps).toBeGreaterThanOrEqual(36);
  expect(steps).toBeLessThanOrEqual(38);
});
