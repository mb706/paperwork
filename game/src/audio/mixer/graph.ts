// The native half of the mixer (10 §9.4): what follows the voice bank.
//
//   bank ─ music (both era slots, each through its FDN reverb, air shelf and era gain) ─► HP 30 Hz ─► glue ─┐
//   recorded music (media element; mastered through the same chain, so it skips both) ────────────────────┤
//                                                                          music gate ─► Music fader ─┐
//   bank ─ world SFX (effects, environment, walking, ambient; each after its fader) ─► world gate ─────┤
//   bank ─ GUI and alert SFX (after their faders) ─────────────────────────────────────────────────────┤
//                                                                          Master fader ─► limiter ─► output
//
// The era slots, their reverbs and the SFX buses' faders run inside the bank: beside an AudioWorklet every
// native node renders on the worklet's thread at several times its usual cost (C7: about 0.1 % of a host
// core per GainNode, 0.9 % per further worklet node), so the graph keeps only what must be native: the
// compressors, the gates and the two faders the settings move. Two era slots crossfade (≤ 2 eras alive);
// era gains are calibrated so a piece measures −18 LUFS integrated at 100 % music volume (A4 §8). The glue
// compressor acts on music only; the SFX are not compressed; the master is limited near −1 dBTP (A4 §8).
// Reduced audio has no bank: its native SFX voices connect to `sfxInput()`, a GainNode per bus made on
// first use, and its recorded music to `recordedInput()`.
import type { BankClient } from '../bank-client.ts';
import { dbToGain } from '../core/units.ts';
import {
  type FdnConfig,
  OUT_MUSIC,
  OUT_UI,
  OUT_WORLD,
  SFX_BUSES,
  type SfxBus,
  WORLD_BUSES,
} from '../worklet/protocol.ts';
import { type AudioSettings, BUS_CATEGORY, categoryGain } from './volumes.ts';

/** Fader moves ramp over 20 ms, so a slider never zips. */
const FADER_TAU = 0.02;

export interface RoomSettings {
  reverb: FdnConfig;
  /** The reverb return (dB). */
  wetDb: number;
  /** The air shelf at 7 kHz (dB). */
  airDb: number;
}

export class MixerGraph {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly musicGate: GainNode;
  readonly musicFader: GainNode;
  readonly worldGate: GainNode;
  private readonly hp: BiquadFilterNode;
  private readonly glue: DynamicsCompressorNode;
  private recorded: GainNode | null = null;
  private readonly busNodes: (GainNode | null)[] = SFX_BUSES.map(() => null);
  private bank: BankClient | null = null;
  private settings: AudioSettings;

  readonly ctx: BaseAudioContext;
  constructor(ctx: BaseAudioContext, settings: AudioSettings, out: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.settings = settings;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter);
    this.limiter.connect(out);
    // music: low cut, glue, gate (hidden tab, pause-resume-music), fader
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 30;
    this.glue = ctx.createDynamicsCompressor();
    this.glue.threshold.value = -20;
    this.glue.knee.value = 12;
    this.glue.ratio.value = 1.8;
    this.glue.attack.value = 0.04;
    this.glue.release.value = 0.5;
    this.musicGate = ctx.createGain();
    this.musicFader = ctx.createGain();
    this.hp.connect(this.glue);
    this.glue.connect(this.musicGate);
    this.musicGate.connect(this.musicFader);
    this.musicFader.connect(this.master);
    this.worldGate = ctx.createGain();
    this.worldGate.connect(this.master);
    this.apply(settings, true);
  }

  /** Connects the voice bank's three outputs; the bank then carries the rooms and the bus faders. */
  attachBank(node: AudioNode, bank: BankClient): void {
    node.connect(this.hp, OUT_MUSIC);
    node.connect(this.worldGate, OUT_WORLD);
    node.connect(this.master, OUT_UI);
    this.bank = bank;
    this.apply(this.settings, true);
  }

  /** A slot's room for an era: its reverb (cleared), the return and the air shelf. */
  configureSlot(slot: number, room: RoomSettings): void {
    this.bank?.room(slot, room.reverb, dbToGain(room.wetDb), room.airDb);
  }

  /** Ramps a slot's era gain to `db` (−Infinity: silent) over `seconds`, from audio time `at`. */
  fadeSlot(slot: number, db: number, seconds: number, at = this.ctx.currentTime): void {
    this.bank?.fade(slot, Number.isFinite(db) ? dbToGain(db) : 0, at, seconds);
  }

  /** The input of a bus for reduced audio's native voices (made on first use). */
  sfxInput(bus: SfxBus): GainNode {
    const b = SFX_BUSES.indexOf(bus);
    let node = this.busNodes[b] ?? null;
    if (!node) {
      node = this.ctx.createGain();
      node.gain.value = categoryGain(this.settings, BUS_CATEGORY[bus]);
      node.connect(WORLD_BUSES.includes(bus) ? this.worldGate : this.master);
      this.busNodes[b] = node;
    }
    return node;
  }

  /** The input of recorded music: after the low cut and the glue, which its master already passed. */
  recordedInput(): GainNode {
    if (!this.recorded) {
      this.recorded = this.ctx.createGain();
      this.recorded.connect(this.musicGate);
    }
    return this.recorded;
  }

  /** Applies the volume sliders and mutes (I §4.20). */
  apply(s: AudioSettings, instant = false): void {
    this.settings = s;
    const now = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => {
      if (instant) p.value = v;
      else p.setTargetAtTime(v, now, FADER_TAU);
    };
    set(this.master.gain, categoryGain(s, 'master'));
    set(this.musicFader.gain, categoryGain(s, 'music'));
    const gains = SFX_BUSES.map((bus) => categoryGain(s, BUS_CATEGORY[bus]));
    this.bank?.buses(gains, now, instant ? 0 : FADER_TAU);
    this.busNodes.forEach((n, b) => {
      if (n) set(n.gain, gains[b] as number);
    });
  }

  /** World sounds on or off: map view mutes them, a paused game fades them (10 §9.4). */
  setWorld(on: boolean, seconds: number): void {
    const p = this.worldGate.gain;
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.setTargetAtTime(on ? 1 : 0, now, Math.max(0.005, seconds / 4));
  }

  /** The music gate: a hidden page fades the music over 1 s; pause-resume-music too (A4 §5.4). */
  setMusic(on: boolean, seconds: number): void {
    const p = this.musicGate.gain;
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.setTargetAtTime(on ? 1 : 0, now, Math.max(0.005, seconds / 4));
  }
}
