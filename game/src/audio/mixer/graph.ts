// The native half of the mixer (10 §9.4): what follows the voice bank.
//
//   bank ─ slot dry ───────────────────────► slot sum ─► air shelf ─► era gain ─┐
//        └ slot send ─► FDN (worklet) ─► wet ─┘                                 ├► music bus ─► HP 30 Hz ─► glue
//   recorded music (media element) ─────────────────────────────────────────────┘   ─► music gate ─► Music fader ─┐
//   bank ─ SFX bus (gui, effects, alerts, environment, walking, ambient) ─► its fader ─┬─(world buses) world gate ─┤
//                                                                                      └─(gui, alerts) ────────────┤
//                                                                              Master fader ─► limiter ─► output
//
// Two era slots crossfade (≤ 2 eras alive). Era gains are calibrated so a piece measures −18 LUFS
// integrated at 100 % music volume (A4 §8). The glue compressor acts on music only; the SFX are not
// compressed; the master is limited near −1 dBTP (A4 §8). The same graph serves the reduced path, whose
// native SFX voices connect to `sfxInput()` and whose recorded music connects to `recordedInput()`.
import { dbToGain } from '../core/units.ts';
import { MAX_SLOTS, OUT_SFX, OUT_SLOT, SFX_BUSES, type SfxBus } from '../worklet/protocol.ts';
import { type AudioSettings, BUS_CATEGORY, categoryGain, WORLD_BUSES } from './volumes.ts';

interface SlotNodes {
  sum: GainNode;
  wet: GainNode;
  air: BiquadFilterNode;
  gain: GainNode;
  fdn: AudioWorkletNode | null;
}

/** Fader moves ramp over 20 ms, so a slider never zips. */
const FADER_TAU = 0.02;

export class MixerGraph {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly musicBus: GainNode;
  readonly musicGate: GainNode;
  readonly musicFader: GainNode;
  readonly worldGate: GainNode;
  private readonly hp: BiquadFilterNode;
  private readonly glue: DynamicsCompressorNode;
  private readonly recorded: GainNode;
  private readonly slots: SlotNodes[] = [];
  private readonly sfxIn: GainNode[] = [];
  private readonly sfxFader: GainNode[] = [];

  readonly ctx: BaseAudioContext;
  constructor(ctx: BaseAudioContext, settings: AudioSettings, out: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter);
    this.limiter.connect(out);
    // music: bus, low cut, glue, gate (hidden tab, pause-resume-music), fader
    this.musicBus = ctx.createGain();
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
    this.musicBus.connect(this.hp);
    this.hp.connect(this.glue);
    this.glue.connect(this.musicGate);
    this.musicGate.connect(this.musicFader);
    this.musicFader.connect(this.master);
    this.recorded = ctx.createGain();
    this.recorded.connect(this.musicBus);
    for (let s = 0; s < MAX_SLOTS; s++) {
      const sum = ctx.createGain();
      const wet = ctx.createGain();
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 7000;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      wet.connect(sum);
      sum.connect(air);
      air.connect(gain);
      gain.connect(this.musicBus);
      this.slots.push({ sum, wet, air, gain, fdn: null });
    }
    // SFX buses
    this.worldGate = ctx.createGain();
    this.worldGate.connect(this.master);
    for (const bus of SFX_BUSES) {
      const input = ctx.createGain();
      const fader = ctx.createGain();
      input.connect(fader);
      fader.connect(WORLD_BUSES.includes(bus) ? this.worldGate : this.master);
      this.sfxIn.push(input);
      this.sfxFader.push(fader);
    }
    this.apply(settings, true);
  }

  /** Connects the voice bank's outputs: per slot dry and send, then the SFX buses. */
  attachBank(node: AudioNode): void {
    for (let s = 0; s < MAX_SLOTS; s++) {
      const sl = this.slots[s] as SlotNodes;
      node.connect(sl.sum, OUT_SLOT(s, false));
      if (sl.fdn) node.connect(sl.fdn, OUT_SLOT(s, true));
    }
    SFX_BUSES.forEach((_, b) => {
      node.connect(this.sfxIn[b] as GainNode, OUT_SFX(b));
    });
  }

  attachReverb(slot: number, fdn: AudioWorkletNode): void {
    const sl = this.slots[slot] as SlotNodes;
    sl.fdn = fdn;
    fdn.connect(sl.wet);
  }

  /** Era settings for a slot: its air shelf, reverb return and calibrated bus gain (dB). */
  configureSlot(slot: number, airDb: number, wetDb: number): void {
    const sl = this.slots[slot] as SlotNodes;
    sl.air.gain.value = airDb;
    sl.wet.gain.value = dbToGain(wetDb);
  }

  /** Ramps a slot's era gain to `db` (−Infinity: silent) over `seconds`, from audio time `at`. */
  fadeSlot(slot: number, db: number, seconds: number, at = this.ctx.currentTime): void {
    const g = (this.slots[slot] as SlotNodes).gain.gain;
    const target = Number.isFinite(db) ? dbToGain(db) : 0;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    if (seconds <= 0) g.setValueAtTime(target, at);
    else g.setTargetAtTime(target, at, seconds / 4);
  }

  /** The inputs of the reduced path. */
  sfxInput(bus: SfxBus): GainNode {
    return this.sfxIn[SFX_BUSES.indexOf(bus)] as GainNode;
  }

  recordedInput(): GainNode {
    return this.recorded;
  }

  /** Applies the volume sliders and mutes (I §4.20). */
  apply(s: AudioSettings, instant = false): void {
    const set = (p: AudioParam, v: number) => {
      if (instant) p.value = v;
      else p.setTargetAtTime(v, this.ctx.currentTime, FADER_TAU);
    };
    set(this.master.gain, categoryGain(s, 'master'));
    set(this.musicFader.gain, categoryGain(s, 'music'));
    SFX_BUSES.forEach((bus, b) => {
      set((this.sfxFader[b] as GainNode).gain, categoryGain(s, BUS_CATEGORY[bus]));
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

  /** Taps for stems renders: a slot's sum (post-fader dry) and its reverb return. */
  slotNodes(slot: number): { sum: GainNode; wet: GainNode; gain: GainNode } {
    return this.slots[slot] as SlotNodes;
  }
}
