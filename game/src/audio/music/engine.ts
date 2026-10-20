// The music engine (A4 `engine/engine.js`, 10 §9.4): it lays an era's channel strips into a slot of the
// voice bank, binds the era's instruments to them, and is the host its pieces play through. A note in the
// past (a main-thread stall, a piece joined in the middle) plays at once if it is at most 50 ms late and is
// otherwise dropped and counted; nothing is scheduled in the past.
import type { BankClient } from '../bank-client.ts';
import { dbToGain } from '../core/units.ts';
import type { ChannelConfig, EqConfig, FeedConfig, InsertConfig } from '../worklet/protocol.ts';
import { GROUP, KIND, MAX_CH } from '../worklet/protocol.ts';
import { harmonics, type LoadedPack, Sampler, Synth, type VoiceSpec } from './instruments.ts';
import {
  type ChannelParam,
  defaultMusicState,
  type EraLayout,
  type MusicState,
  type NoteEvent,
  type PieceHost,
} from './types.ts';

/** The note log of a render (A4's notes.json): the sounding pitch, for symbolic analysis. */
export interface LoggedNote {
  t: number;
  i: string;
  m: number;
  v: number;
  d: number;
}

export interface SlotInfo {
  layout: EraLayout;
  channels: Map<string, number>;
  instruments: Map<string, { channel: number; player: Sampler | Synth }>;
}

/** Provides each pack's zones once its buffers are in the bank. */
export interface PackSource {
  pack(name: string): LoadedPack | null;
  stereo(name: string): boolean;
}

const TAPE_DEFAULTS = {
  wowHz: 0.55,
  wowMs: 0.9,
  flutterHz: 7.3,
  flutterMs: 0.09,
  drive: 1.6,
  lowpass: 11000,
  highpass: 45,
} as const;

export class MusicEngine {
  readonly state: MusicState = defaultMusicState();
  /** Notes dropped for lateness (more than 50 ms in the past). */
  dropped = 0;
  /** Set to an array to record every note (offline analysis renders). */
  log: LoggedNote[] | null = null;
  private readonly slots: (SlotInfo | null)[] = [null, null];
  private nextWave = 1;

  /** null in reduced audio: the engine then only keeps the music state. */
  private readonly bank: BankClient | null;
  private readonly now: () => number;
  private readonly packs: PackSource;
  constructor(bank: BankClient | null, now: () => number, packs: PackSource) {
    this.bank = bank;
    this.now = now;
    this.packs = packs;
  }

  slot(i: number): SlotInfo | null {
    return this.slots[i] ?? null;
  }

  /** Lays an era into a slot of the bank. The slot must be silent (cleared) first. */
  prepare(slot: number, layout: EraLayout): SlotInfo {
    const bank = this.bank;
    if (!bank) throw new Error('the music engine has no voice bank (reduced audio)');
    const channels = new Map<string, number>();
    layout.channels.forEach((c, i) => {
      channels.set(c.name, i);
    });
    const instruments = new Map<string, { channel: number; player: Sampler | Synth }>();
    const stereo = new Set<string>();
    for (const inst of layout.instruments) {
      const ch = channels.get(inst.channel);
      if (ch === undefined)
        throw new Error(`${layout.id}: ${inst.name} routes to a missing channel ${inst.channel}`);
      let player: Sampler | Synth;
      const s = inst.source;
      if (s.kind === 'sampler') {
        const pack = this.packs.pack(s.pack);
        if (!pack) throw new Error(`${layout.id}: pack ${s.pack} is not loaded`);
        player = new Sampler(pack, s.xfade);
        if (this.packs.stereo(s.pack)) stereo.add(inst.channel);
      } else if (s.kind === 'organ') {
        const id = this.nextWave++;
        bank.wave(id, harmonics(s.drawbars));
        player = new Synth('organ', id);
      } else player = new Synth(s.kind);
      instruments.set(inst.name, { channel: ch, player });
    }
    const configs: ChannelConfig[] = layout.channels.map((c, i) => ({
      index: i,
      stereo: stereo.has(c.name),
      trim: dbToGain(c.trimDb),
      pan: c.pan,
      dry: dbToGain(c.dryDb ?? 0),
      send: c.sendDb == null ? 0 : dbToGain(c.sendDb),
      eq: (c.eq ?? []).map(
        (b): EqConfig => ({
          type: b.type,
          f: b.f,
          // BiquadFilterNode's default Q is 1 (dB for lowpass and highpass)
          q: b.q ?? 1,
          gain: b.gain ?? 0,
        }),
      ),
      inserts: (c.inserts ?? []).map(
        (ins): InsertConfig =>
          ins.kind === 'tape'
            ? { kind: 'tape', ...TAPE_DEFAULTS, ...ins.tape }
            : { kind: 'tremolo', rate: ins.rate, depth: ins.depth },
      ),
      feed: this.feed(c.feed, channels),
    }));
    if (layout.channels.length > MAX_CH) throw new Error(`${layout.id}: more than ${MAX_CH} channels`);
    bank.layout(slot, configs);
    const info: SlotInfo = { layout, channels, instruments };
    this.slots[slot] = info;
    return info;
  }

  private feed(f: EraLayout['channels'][number]['feed'], channels: Map<string, number>): FeedConfig | null {
    if (!f) return null;
    if (f.kind === 'noise') return { kind: 'noise', ...f.noise };
    const from = channels.get(f.from);
    if (from === undefined) throw new Error(`echo from a missing channel ${f.from}`);
    return { kind: 'echo', from, wowHz: 0.35, ...f.echo };
  }

  release(slot: number): void {
    this.slots[slot] = null;
  }

  /** The host a piece in `slot` plays through. */
  host(slot: number): PieceHost {
    const auto = (
      channel: string,
      param: ChannelParam,
      kind: 0 | 1,
      t: number,
      value: number,
      tau: number,
    ) => {
      const ch = this.slots[slot]?.channels.get(channel);
      if (ch === undefined) return;
      this.bank?.automate(slot, ch, param, [[kind, Math.max(0, t), value, tau]]);
    };
    return {
      state: this.state,
      play: (ev) => this.play(slot, ev),
      setParam: (channel, param, t, value) => auto(channel, param, 0, t, value, 0),
      targetParam: (channel, param, t, value, tau) => auto(channel, param, 1, t, value, tau),
    };
  }

  play(slot: number, ev: NoteEvent): void {
    const s = this.slots[slot];
    const inst = s?.instruments.get(ev.inst);
    if (!inst) return;
    const now = this.now();
    if (ev.t < now - 0.05) {
      this.dropped++;
      return;
    }
    const t = ev.t < now ? now : ev.t;
    const dest = slot * MAX_CH + inst.channel;
    inst.player.play(t, ev.midi, ev.vel, ev.dur, ev.opts, (v) => this.voice(dest, v));
    if (this.log) {
      // the sounding pitch: a tape rate transposes (rate 0.5 is an octave down)
      const m = ev.midi + (ev.opts.rate ? 12 * Math.log2(ev.opts.rate) : 0);
      this.log.push({
        t: +t.toFixed(4),
        i: ev.inst,
        m: +m.toFixed(3),
        v: +ev.vel.toFixed(3),
        d: +ev.dur.toFixed(3),
      });
    }
  }

  private voice(dest: number, v: VoiceSpec): void {
    this.bank?.note({
      TIME: v.t,
      KIND:
        v.kind === 'sample'
          ? KIND.SAMPLE
          : v.kind === 'sine'
            ? KIND.SINE
            : v.kind === 'organ'
              ? KIND.ORGAN
              : KIND.BELL,
      SRC: v.src,
      DEST: dest,
      GROUP: GROUP.MUSIC,
      RATE: v.rate,
      GAIN: v.gain,
      ATTACK: v.attack,
      ATK_EXP: v.atkExp ? 1 : 0,
      OFF: v.off,
      RELEASE: v.release,
      STOP: v.stop,
      OFFSET: v.offset,
      AUX: v.aux,
      PRIO: 1,
    });
  }
}
