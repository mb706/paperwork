// The SFX system (10 §9.4, §15.6; A4 §7.3): events to sounds through the data's map, variation, rate
// limits, positional attenuation, working sounds by proximity and count, and silence for history.
//
// - Variation: 3–4 variants, never the same twice in a row; ±pitch and ±1.5 dB jitter per play.
// - Rate limits per sound and window (error 1 per 100 ms, build 3, mine 2, UI click 1 per 30 ms): over the
//   limit a sound is dropped, never queued. Voice caps (24, at most 4 per sound) are the bank's.
// - Positional: distance from the view centre, pan by screen x, zoom; map view mutes world buses.
//   Other players' world events sound like one's own; UI sounds play only for one's own events.
// - Working sounds (AUDIO_WORKING): one looping voice per sound id, gain from count and distance, pan by
//   the centroid, a random start offset, 0.3 s fades, at most 12 at once (the loudest). The section is a
//   snapshot: an absent sound fades out; no packet for 0.5 s fades every loop.
// - History: events flagged HISTORICAL (catch-up, replay, fast-forward) and events more than 30 ticks older
//   than their packet never sound. A new state generation resets everything.

import { EventFlags } from '../../shared/gen/events.ts';
import type { VoiceEngine } from '../bank-client.ts';
import type { Rng } from '../core/rng.ts';
import { dbToGain } from '../core/units.ts';
import {
  type AudioEventRecord,
  type AudioPacketView,
  eventName,
  newEventRecord,
  newWorkingRecord,
  type ProtoInfo,
  type WorkingRecord,
} from '../feed/types.ts';
import type { EventRule } from '../loading/manifest.ts';
import { GROUP, KIND, SFX_DEST } from '../worklet/protocol.ts';
import type { Sound, SoundTable } from './sounds.ts';
import { defaultView, type ListenerView, placeAt, workingMix } from './spatial.ts';

export const MAX_LOOPS = 12;
export const LOOP_FADE = 0.3;
export const STALE_AFTER = 0.5;
export const HISTORY_TICKS = 30;

interface Loop {
  sound: Sound;
  handle: number;
  gain: number;
  pan: number;
  sentGain: number;
  sentPan: number;
}

export interface SfxStats {
  played: number;
  limited: number;
  historical: number;
  unmapped: number;
  loops: number;
  /** Working loops whose voices ended unasked and were started again. */
  lost: number;
}

export class SfxSystem {
  view: ListenerView = defaultView();
  /** The local player's index (UI sounds play only for one's own events). */
  localPlayer = 0;
  readonly stats: SfxStats = { played: 0, limited: 0, historical: 0, unmapped: 0, loops: 0, lost: 0 };
  /** Every one-shot that sounded, by name (dev builds and tests: which event or gesture played what). */
  onPlayed: ((name: string) => void) | null = null;
  private generation = -1;
  private lastPacket = Number.NEGATIVE_INFINITY;
  private readonly loops = new Map<number, Loop>();
  private nextHandle = 1;
  private readonly ev: AudioEventRecord = newEventRecord();
  private readonly wr: WorkingRecord = newWorkingRecord();
  private readonly present: { sound: Sound; gain: number; pan: number }[] = [];

  private bank: VoiceEngine;
  table: SoundTable;
  private readonly now: () => number;
  private readonly proto: ProtoInfo;
  private readonly rng: Rng;
  constructor(bank: VoiceEngine, table: SoundTable, now: () => number, proto: ProtoInfo, rng: Rng) {
    this.bank = bank;
    this.table = table;
    this.now = now;
    this.proto = proto;
    this.rng = rng;
    bank.onEnded = (h) => this.lost(h);
  }

  /**
   * Moves to another voice engine (reduced audio after a processor failure) with the table its files were
   * loaded into. The loops lived on the old engine: they start again from the next snapshot.
   */
  rebind(bank: VoiceEngine, table: SoundTable): void {
    this.bank = bank;
    this.table = table;
    bank.onEnded = (h) => this.lost(h);
    this.loops.clear();
    this.stats.loops = 0;
  }

  /**
   * Working loops whose voices ended unasked (stolen, dropped, their buffer freed): forgotten, so the next
   * snapshot starts them again (codex C7-r1 finding 2).
   */
  private lost(handles: readonly number[]): void {
    for (const [id, loop] of this.loops)
      if (handles.includes(loop.handle)) {
        this.loops.delete(id);
        this.stats.lost++;
      }
    this.stats.loops = this.loops.size;
  }

  // ---------------------------------------------------------------- one-shots

  /**
   * Plays a sound once: at a world position (x, y in tiles) for world sounds, or unplaced for UI sounds.
   * Returns false when the rate limit dropped it or it has no files.
   */
  play(name: string, x = Number.NaN, y = Number.NaN): boolean {
    const s = this.table.get(name);
    if (!s) return false;
    const ok = this.trigger(s, x, y);
    this.bank.flush();
    return ok;
  }

  private trigger(s: Sound, x: number, y: number): boolean {
    const n = s.variants.length;
    if (n === 0) {
      // still decoding (the first gesture's clicks): dropped quietly; after the load, a sound without files is a fault
      if (this.table.loaded)
        this.table.warnOnce(`nofiles:${s.name}`, `audio: ${s.name} has no decoded files`);
      return false;
    }
    const now = this.now();
    const lim = s.def.rate;
    if (lim) {
      const w = lim.windowMs / 1000;
      while (s.recent.length > 0 && (s.recent[0] as number) <= now - w) s.recent.shift();
      if (s.recent.length >= lim.count) {
        this.stats.limited++;
        return false;
      }
      s.recent.push(now);
    }
    // never the same variant twice in a row
    let k = 0;
    if (n > 1) {
      k = this.rng.int(0, n - 2);
      if (k >= s.last) k++;
    }
    s.last = k;
    const v = s.variants[k] as (typeof s.variants)[number];
    let gain = dbToGain(s.def.gainDb + (this.rng.next() * 2 - 1) * s.def.gainJitterDb);
    const rate = 1 + (this.rng.next() * 2 - 1) * s.def.pitchJitter;
    let pan = 0;
    if (s.def.positional && Number.isFinite(x) && Number.isFinite(y)) {
      const [g, p] = placeAt(this.view, x, y);
      gain *= g;
      pan = p;
    }
    this.bank.note({
      TIME: now,
      KIND: KIND.SAMPLE,
      SRC: v.id,
      DEST: SFX_DEST + s.bus,
      GROUP: GROUP.SFX,
      RATE: rate,
      GAIN: gain,
      PAN: pan,
      TYPE: s.id,
      CAP: s.def.voices,
      PRIO: s.def.priority,
    });
    this.stats.played++;
    this.onPlayed?.(s.name);
    return true;
  }

  // ---------------------------------------------------------------- packets

  /** Everything a packet asks of audio: its events, then its working sounds. */
  onPacket(p: AudioPacketView): void {
    if (p.generation !== this.generation) {
      // a new world (10 §3.4): nothing of the old one goes on sounding, one-shots included
      if (this.generation >= 0) this.reset(0.05, true);
      this.generation = p.generation;
    }
    this.lastPacket = this.now();
    const ev = this.ev;
    for (let i = 0; i < p.eventCount; i++) {
      p.readEvent(i, ev);
      if ((ev.flags & EventFlags.historical) !== 0 || p.tick - ev.tick > HISTORY_TICKS) {
        this.stats.historical++;
        continue;
      }
      this.onEvent(ev);
    }
    this.working(p);
    this.bank.flush();
  }

  private onEvent(e: AudioEventRecord): void {
    const typeName = eventName(e.type);
    const rule = typeName ? this.table.manifest.events[typeName] : undefined;
    if (rule === undefined) return;
    if (typeName === 'action_failed' && this.proto.isDeveloperReason(e.reason)) return;
    if (typeName === 'entity_built' && (e.entityFlags & 1) !== 0) return; // a ghost is placed silently
    const name = this.resolve(rule, e);
    const s = name ? this.table.byName.get(name) : undefined;
    if (!s) {
      this.stats.unmapped++;
      this.table.warnOnce(`ev:${typeName}:${name}`, `audio: ${typeName} maps to ${name}, which has no files`);
      return;
    }
    // UI sounds answer one's own events; world sounds are heard from everyone, by position
    if (!s.def.positional && e.player !== 0xffff && e.player !== this.localPlayer) return;
    this.trigger(s, e.x, e.y);
  }

  private resolve(rule: EventRule, e: AudioEventRecord): string | null {
    if (typeof rule === 'string') return rule;
    if ('bySize' in rule) {
      const size = e.proto >= 0 ? this.proto.entitySize(e.proto) : 1;
      return size <= rule.smallMax
        ? rule.bySize.small
        : size <= rule.mediumMax
          ? rule.bySize.medium
          : rule.bySize.large;
    }
    return e.proto >= 0 && this.proto.minedKind(e.proto) === 'resource'
      ? rule.byKind.resource
      : rule.byKind.entity;
  }

  // ---------------------------------------------------------------- working sounds

  private working(p: AudioPacketView): void {
    const present = this.present;
    present.length = 0;
    const w = this.wr;
    for (let i = 0; i < p.workingCount; i++) {
      p.readWorking(i, w);
      const s = this.table.byId[w.sound];
      if (!s || s.variants.length === 0 || !s.def.loop) continue;
      const [g, pan] = workingMix(this.view, w.n, w.cx, w.wsum);
      present.push({ sound: s, gain: g * dbToGain(s.def.gainDb), pan });
    }
    // at most 12 loops: the loudest
    present.sort((a, b) => b.gain - a.gain);
    if (present.length > MAX_LOOPS) present.length = MAX_LOOPS;
    for (const [id, loop] of this.loops)
      if (!present.some((x) => x.sound.id === id)) {
        this.bank.control(loop.handle, 0, loop.pan, true, LOOP_FADE);
        this.loops.delete(id);
      }
    for (const x of present) {
      const loop = this.loops.get(x.sound.id);
      if (loop) {
        loop.gain = x.gain;
        loop.pan = x.pan;
        if (
          Math.abs(loop.gain - loop.sentGain) > 0.02 * Math.max(loop.sentGain, 1e-3) ||
          Math.abs(loop.pan - loop.sentPan) > 0.01
        ) {
          this.bank.control(loop.handle, loop.gain, loop.pan);
          loop.sentGain = loop.gain;
          loop.sentPan = loop.pan;
        }
      } else this.startLoop(x.sound, x.gain, x.pan);
    }
    this.stats.loops = this.loops.size;
  }

  private startLoop(s: Sound, gain: number, pan: number): void {
    const v = s.variants[this.rng.int(0, s.variants.length - 1)] as (typeof s.variants)[number];
    const handle = this.nextHandle++;
    const span = Math.max(1, v.loopEnd - v.loopStart);
    // a random offset, so many entities never phase-lock audibly (A4 §7.3 rule 4)
    const offset = (v.loopStart + this.rng.next() * span) / this.table.manifest.rate;
    this.bank.note({
      TIME: this.now(),
      KIND: KIND.SAMPLE,
      SRC: v.id,
      DEST: SFX_DEST + s.bus,
      GROUP: GROUP.SFX,
      GAIN: gain,
      PAN: pan,
      ATTACK: LOOP_FADE,
      OFFSET: offset,
      LOOP_S: v.loopStart,
      LOOP_E: v.loopEnd,
      OFF: Number.POSITIVE_INFINITY,
      STOP: Number.POSITIVE_INFINITY,
      TYPE: s.id,
      CAP: Math.max(1, s.def.voices),
      PRIO: s.def.priority,
      HANDLE: handle,
      SMOOTH: 1,
    });
    this.loops.set(s.id, { sound: s, handle, gain, pan, sentGain: gain, sentPan: pan });
  }

  /**
   * Called on the scheduler's tick: no packet for 0.5 s (catch-up, a hidden page) fades every loop. While
   * loops play, it asks the engine which of them ended unasked.
   */
  tick(): void {
    if (this.loops.size > 0 && this.now() - this.lastPacket > STALE_AFTER) {
      this.reset(LOOP_FADE);
      this.bank.flush();
    }
    if (this.loops.size > 0) this.bank.poll();
  }

  /**
   * Fades every loop out (staleness, leaving a game) and forgets the rate limits; `hard` (a new world) also
   * fades every one-shot and drops the SFX notes not yet started.
   */
  reset(fade = LOOP_FADE, hard = false): void {
    if (hard) this.bank.clear('sfx', fade);
    else for (const loop of this.loops.values()) this.bank.control(loop.handle, 0, loop.pan, true, fade);
    this.loops.clear();
    for (const s of this.table.byName.values()) s.recent.length = 0;
    this.stats.loops = 0;
  }
}

/** Footsteps follow the walk cycle (10 §9.4): one step per half cycle of the character's run clip. */
export class FootstepClock {
  private acc = 0;
  /** `stepTiles`: tiles per step: running at 8.9 tiles/s (Factorio's 0.15 per tick), 3.7 steps per second. */
  private readonly stepTiles: number;
  constructor(stepTiles: number = 8.9 / 3.7) {
    this.stepTiles = stepTiles;
  }

  /** Adds the distance walked; returns how many steps fall in it. */
  advance(tiles: number): number {
    this.acc += Math.max(0, tiles);
    let n = 0;
    while (this.acc >= this.stepTiles) {
      this.acc -= this.stepTiles;
      n++;
    }
    return n;
  }
}
