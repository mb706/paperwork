// Audio (C7) against the frozen golden set (10 §15.10; the golden README's "Audio" duties; the M0 exit audit #1, C9):
// the golden packets go through the audio consumer the game page uses (GenPacketView and the SFX system, with the
// engine's own sounds.yaml: its event map, rate limits and UI-sound rules, and the golden prototypes' facts), and
// every event's fate is checked against an independent reading of the same packets (the generated `readEvents`):
//   - packets/tick-0600.bin: 69 events of every M0 kind; the golden flow extracts at ticks 0, 1 and 600, so all but
//     the newest are older than 30 ticks and stay silent (§15.6, "a hidden page that kept running");
//   - the packet-transitions trace, every packet in order: tick 34's refusal carries HISTORICAL and stays silent;
//     the overflow packet (EVENTS_DROPPED, the newest 8,192 kept: malformed actions, a developer reason) plays
//     nothing and floods nothing; the packet after it is empty.
// AUDIO_WORKING is absent in M0's golden set (nothing works): the fake sim's packets carry it (src/audio tests).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { NoteRecord, VoiceEngine } from '../../src/audio/bank-client.ts';
import { makeRng } from '../../src/audio/core/rng.ts';
import { GenPacketView } from '../../src/audio/feed/gen.ts';
import { protoInfoOf } from '../../src/audio/feed/protos.ts';
import type { SoundEntry, SoundsManifest } from '../../src/audio/loading/manifest.ts';
import { HISTORY_TICKS, SfxSystem } from '../../src/audio/sfx/sfx.ts';
import { SoundTable } from '../../src/audio/sfx/sounds.ts';
import { readEvents } from '../../src/shared/gen/events.ts';
import { decodePacket } from '../../src/shared/gen/packet.ts';
import type { PrototypesJson } from '../../src/shared/gen/protos.ts';
import { FailReasonCodec } from '../../src/shared/gen/types.ts';
import { GAME } from '../helpers/paths.ts';

const GOLDEN = join(GAME, 'test', 'golden', 'm0');
const file = (rel: string) => new Uint8Array(readFileSync(join(GOLDEN, rel)));

/** sounds.yaml as the audio build writes sounds.json (scripts/assets/audio/build.py), with one stub file a sound. */
interface SoundsYaml {
  sounds: Record<string, Record<string, unknown>>;
  events: SoundsManifest['events'];
}
const YAML = parseYaml(readFileSync(join(GAME, 'data', 'engine', 'sounds.yaml'), 'utf8')) as SoundsYaml;
function manifest(): SoundsManifest {
  const sounds: Record<string, SoundEntry> = {};
  for (const [name, d] of Object.entries(YAML.sounds)) {
    const rate = d.rate as [number, number] | undefined;
    sounds[name] = {
      bus: d.bus as SoundEntry['bus'],
      gainDb: (d.gain_db as number | undefined) ?? 0,
      pitchJitter: (d.pitch_jitter as number | undefined) ?? 0.03,
      gainJitterDb: (d.gain_jitter_db as number | undefined) ?? 1.5,
      rate: rate ? { count: rate[0], windowMs: rate[1] } : null,
      voices: (d.voices as number | undefined) ?? 4,
      priority: (d.priority as number | undefined) ?? 1,
      positional: (d.positional as boolean | undefined) ?? true,
      loop: /-loop$/.test(name),
      licence: 'test',
      files: [{ file: name, len: 3200, channels: 1, fp: { at: 0, data: [] }, bytes: { ogg: 1, m4a: 1 } }],
    };
  }
  return {
    version: 1,
    rate: 32000,
    prototypesHash: null,
    sounds,
    events: YAML.events,
    working: {},
    music: { eras: [] },
  };
}

class Recorder implements VoiceEngine {
  notes: NoteRecord[] = [];
  onEnded: ((handles: readonly number[]) => void) | null = null;
  note(r: NoteRecord) {
    this.notes.push(r);
  }
  control() {}
  clear() {}
  poll() {}
  flush() {}
  buffer() {}
  free() {}
}

const protos = JSON.parse(readFileSync(join(GOLDEN, 'protos', 'prototypes.json'), 'utf8')) as PrototypesJson;
const proto = protoInfoOf(protos);

function system(clock: { t: number }) {
  const table = new SoundTable(manifest());
  let id = 1;
  for (const s of table.byName.values()) s.variants.push({ id: id++, len: 3200, loopStart: 0, loopEnd: 0 });
  table.loaded = true;
  const sfx = new SfxSystem(new Recorder(), table, () => clock.t, proto, makeRng(1));
  sfx.localPlayer = 0;
  sfx.view = { cx: 0, cy: 0, halfWidth: 32, zoom: 1, mapView: false };
  const played: string[] = [];
  sfx.onPlayed = (n) => played.push(n);
  return { sfx, table, played };
}

/**
 * An independent reading of what a packet must sound (§15.6 and sounds.yaml): fresh, non-historical events through
 * the event map; developer reasons and ghosts silent; UI sounds only for the local player's (or nobody's) events.
 */
function expected(bytes: Uint8Array, table: SoundTable): string[] {
  const p = decodePacket(bytes);
  const s = p.sections.find((x) => x.name === 'EVENTS');
  const out: string[] = [];
  for (const { header, payload } of s ? readEvents(s.bytes, s.count) : []) {
    if ((header.flags & 1) !== 0 || p.header.tick - header.tick > HISTORY_TICKS) continue;
    const rule = (YAML.events as Record<string, unknown>)[payload.type];
    if (rule === undefined) continue;
    let name: string;
    if (typeof rule === 'string') name = rule;
    else if ('bySize' in (rule as object)) {
      const r = rule as { bySize: Record<string, string>; smallMax: number; mediumMax: number };
      const size = proto.entitySize((payload as { proto: number }).proto);
      name =
        size <= r.smallMax
          ? (r.bySize.small as string)
          : size <= r.mediumMax
            ? (r.bySize.medium as string)
            : (r.bySize.large as string);
    } else name = (rule as { byKind: Record<string, string> }).byKind.entity as string;
    if (payload.type === 'action_failed' && FailReasonCodec.isDeveloper(payload.reason)) continue;
    if (payload.type === 'entity_built' && (payload.flags & 1) !== 0) continue;
    const def = table.byName.get(name)?.def;
    if (def && !def.positional && header.player !== 0xffff && header.player !== 0) continue;
    out.push(name);
  }
  return out;
}

/** The rate limits applied to one packet's sounds, all at one clock time: the first `count` of each sound play. */
function limited(names: string[], table: SoundTable): { played: string[]; dropped: number } {
  const seen = new Map<string, number>();
  const played: string[] = [];
  let dropped = 0;
  for (const n of names) {
    const k = seen.get(n) ?? 0;
    const cap = table.byName.get(n)?.def.rate?.count ?? Number.POSITIVE_INFINITY;
    if (k < cap) played.push(n);
    else dropped++;
    seen.set(n, k + 1);
  }
  return { played, dropped };
}

describe('audio on the golden set (10 §15.10; README "Audio")', () => {
  it('packets/tick-0600.bin: every event of every M0 kind read, the stale ones silent', () => {
    const clock = { t: 10 };
    const { sfx, table, played } = system(clock);
    const bytes = file('packets/tick-0600.bin');
    const p = decodePacket(bytes);
    const events = readEvents(
      p.sections.find((x) => x.name === 'EVENTS')?.bytes ?? new Uint8Array(0),
      p.sections.find((x) => x.name === 'EVENTS')?.count ?? 0,
    );
    expect(new Set(events.map((e) => e.payload.type))).toEqual(
      new Set([
        'action_failed',
        'entity_built',
        'flying_text',
        'player_joined',
        'player_left',
        'item_crafted',
        'input_fenced',
        'entity_mined',
      ]),
    );
    sfx.onPacket(new GenPacketView().set(p));
    const want = limited(expected(bytes, table), table);
    expect(played).toEqual(want.played);
    expect(sfx.stats.limited).toBe(want.dropped);
    // the three fresh events: two flying texts (silent) and a hand-craft's completion (the GUI click)
    expect(played).toEqual(['ui-click']);
    // the stale events counted as historical, as §15.6 asks: everything older than 30 ticks
    const stale = events.filter((e) => p.header.tick - e.header.tick > HISTORY_TICKS).length;
    expect(sfx.stats.historical).toBe(stale);
    expect(stale).toBeGreaterThan(60);
  });

  it('the packet-transitions trace: HISTORICAL silent, the overflow silent, every packet in order', () => {
    interface Trace {
      traces: { name: string; calls: { call: string; out: string | null; note?: string }[] }[];
    }
    const trace = (JSON.parse(readFileSync(join(GOLDEN, 'abi', 'traces.json'), 'utf8')) as Trace).traces.find(
      (t) => t.name === 'packet-transitions',
    );
    expect(trace).toBeDefined();
    const clock = { t: 0 };
    const { sfx, table, played } = system(clock);
    const view = new GenPacketView();
    let notes = 0;
    for (const c of trace?.calls ?? []) {
      if (c.call !== 'sim_extract' || !c.out) continue;
      const bytes = file(c.out);
      const p = decodePacket(bytes);
      // the audio clock follows game time; one packet's events share its time
      clock.t = 10 + p.header.tick / 60;
      const before = { played: played.length, historical: sfx.stats.historical, limited: sfx.stats.limited };
      sfx.onPacket(view.set(p));
      const want = limited(expected(bytes, table), table);
      expect(played.slice(before.played), c.note).toEqual(want.played);
      expect(sfx.stats.limited - before.limited, c.note).toBe(want.dropped);
      const note = c.note ?? '';
      if (note.startsWith('chest C appears')) expect(played.slice(before.played)).toEqual(['build-small']);
      if (note.startsWith('chest C is mined')) expect(played.slice(before.played)).toEqual(['deconstruct']);
      if (note.includes('HISTORICAL')) {
        expect(sfx.stats.historical - before.historical, note).toBe(1);
        expect(played.length - before.played, note).toBe(0);
      }
      if (note.includes('EVENTS_DROPPED')) {
        expect(p.header.flags & 2, 'the packet says events were dropped').toBe(2);
        // the newest 8,192 kept: the local player's malformed actions, a developer reason, so none sounds and none
        // even reaches the rate limiter (an overflow never floods the SFX)
        const evs = p.sections.find((x) => x.name === 'EVENTS');
        const kept = readEvents(evs?.bytes ?? new Uint8Array(0), evs?.count ?? 0);
        expect(kept.length).toBe(8192);
        expect(
          kept.every(
            (e) => e.payload.type === 'action_failed' && FailReasonCodec.isDeveloper(e.payload.reason),
          ),
        ).toBe(true);
        expect(played.length - before.played).toBe(0);
        expect(sfx.stats.limited - before.limited).toBe(0);
      }
      notes++;
    }
    expect(notes).toBeGreaterThan(8);
  });
});
