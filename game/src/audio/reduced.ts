// Reduced audio (10 §9.4, "The worklets"): when `audioWorklet` is missing (no secure context),
// `addModule()` rejects or a processor errors, the engine plays
// - music from recordings, streamed by a media element (A4 §6.1's *Music: recorded*);
// - SFX on native AudioBufferSourceNodes: at most 8 voices, no more than the 4 loudest working loops, no
//   inserts.
// `NativeVoices` takes the same note records as the voice bank, so the SFX system runs unchanged.
import type { NoteRecord, VoiceEngine } from './bank-client.ts';
import type { MixerGraph } from './mixer/graph.ts';
import { SFX_BUSES } from './worklet/protocol.ts';

export const REDUCED_VOICES = 8;
export const REDUCED_LOOPS = 4;
/** A stolen one-shot fades over 5 ms; a displaced loop over 50 ms. */
const STEAL_S = 0.005;
const LOOP_STEAL_S = 0.05;

interface Native {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  handle: number;
  type: number;
  prio: number;
  level: number;
  started: number;
  /**
   * Stopped and fading out until `onended`: it no longer counts against any limit and is never chosen again
   * (codex C7-r1 finding 6: a fading voice chosen again and again let a burst through).
   */
  retiring: boolean;
}

/** Lower priority first, then the quietest, then the oldest: the bank's order (bank-core `victim`). */
const byStealOrder = (a: Native, b: Native) => a.prio - b.prio || a.level - b.level || a.started - b.started;

export class NativeVoices implements VoiceEngine {
  onEnded: ((handles: readonly number[]) => void) | null = null;
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly live: Native[] = [];
  /** Working loops that ended unasked, for the next poll. */
  private readonly lost: number[] = [];

  private readonly ctx: BaseAudioContext;
  private readonly mixer: Pick<MixerGraph, 'sfxInput'>;
  constructor(ctx: BaseAudioContext, mixer: Pick<MixerGraph, 'sfxInput'>) {
    this.ctx = ctx;
    this.mixer = mixer;
  }

  buffer(id: number, chans: Int16Array[], rate: number): void {
    const first = chans[0];
    if (!first) return;
    const b = this.ctx.createBuffer(chans.length, first.length, rate);
    chans.forEach((c, i) => {
      const f = new Float32Array(c.length);
      for (let k = 0; k < c.length; k++) f[k] = (c[k] as number) / 32768;
      b.copyToChannel(f, i);
    });
    this.buffers.set(id, b);
  }

  free(id: number): void {
    const b = this.buffers.get(id);
    this.buffers.delete(id);
    if (b) for (const v of this.playing()) if (v.src.buffer === b) this.retire(v, STEAL_S, true);
  }

  /** The voices that sound and count: not retiring. */
  private playing(): Native[] {
    return this.live.filter((v) => !v.retiring);
  }

  note(r: NoteRecord): void {
    const buf = this.buffers.get(r.SRC ?? -1);
    const bus = SFX_BUSES[(r.DEST ?? 64) - 64];
    const handle = r.HANDLE ?? 0;
    if (!buf || !bus) {
      this.lose(handle);
      return;
    }
    const looping = (r.LOOP_E ?? 0) > 0;
    const g = r.GAIN ?? 1;
    const type = r.TYPE ?? -1;
    const prio = r.PRIO ?? 0;
    // only the loudest loops: a louder one replaces the quietest
    if (looping) {
      const loops = this.playing().filter((v) => v.handle > 0);
      if (loops.length >= REDUCED_LOOPS) {
        const quiet = loops.sort((a, b) => a.level - b.level)[0];
        if (!quiet || quiet.level >= g) {
          this.lose(handle);
          return;
        }
        this.retire(quiet, LOOP_STEAL_S, true);
      }
    }
    // the sound's own voice cap, as in the bank
    if (type >= 0) {
      const same = this.playing().filter((v) => v.type === type);
      if (same.length >= Math.max(1, r.CAP ?? 4)) {
        const victim = same.sort(byStealOrder)[0];
        if (!victim || victim.prio > prio) {
          this.lose(handle);
          return;
        }
        this.retire(victim, STEAL_S, true);
      }
    }
    const playing = this.playing();
    if (playing.length >= REDUCED_VOICES) {
      // a one-shot takes a one-shot's voice of no higher priority; a loop takes the lowest one-shot's
      const victim = playing.filter((v) => v.handle === 0).sort(byStealOrder)[0];
      if (!victim || (!looping && victim.prio > prio)) {
        this.lose(handle);
        return;
      }
      this.retire(victim, STEAL_S, true);
    }
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, r.TIME ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = r.RATE ?? 1;
    const gain = ctx.createGain();
    const attack = r.ATTACK ?? 0;
    if (attack > 0.004) {
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(g, t + attack);
    } else gain.gain.value = g;
    const pan = ctx.createStereoPanner();
    pan.pan.value = r.PAN ?? 0;
    src.connect(gain);
    gain.connect(pan);
    pan.connect(this.mixer.sfxInput(bus));
    if (looping) {
      src.loop = true;
      src.loopStart = (r.LOOP_S ?? 0) / buf.sampleRate;
      src.loopEnd = (r.LOOP_E ?? 0) / buf.sampleRate;
    }
    const v: Native = { src, gain, pan, handle, type, prio, level: g, started: t, retiring: false };
    this.live.push(v);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      pan.disconnect();
      const i = this.live.indexOf(v);
      if (i >= 0) this.live.splice(i, 1);
    };
    src.start(t, r.OFFSET ?? 0);
  }

  /** Fades a voice out and stops it; `unasked`: a working loop's end is reported at the next poll. */
  private retire(v: Native, tau: number, unasked: boolean): void {
    if (v.retiring) return;
    v.retiring = true;
    if (unasked) this.lose(v.handle);
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.setTargetAtTime(0, now, tau / 4);
    v.src.stop(now + tau * 1.5 + 0.01);
  }

  private lose(handle: number): void {
    if (handle > 0) this.lost.push(handle);
  }

  control(handle: number, gain: number, pan: number, release = false, tau = 0.3): void {
    const v = this.playing().find((x) => x.handle === handle);
    if (!v) return;
    if (release) {
      this.retire(v, tau, false);
      return;
    }
    const now = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(gain, now, 0.05);
    v.pan.pan.setTargetAtTime(pan, now, 0.05);
    v.level = gain;
  }

  /** Native voices carry only SFX: clearing a music slot does nothing. */
  clear(slot: number | 'sfx', fade: number): void {
    if (slot !== 'sfx') return;
    for (const v of this.playing()) this.retire(v, Math.max(STEAL_S, fade), true);
  }

  poll(): void {
    if (this.lost.length === 0) return;
    const handles = this.lost.splice(0);
    this.onEnded?.(handles);
  }

  flush(): void {}

  /** Voices sounding now (not retiring). */
  get voices(): number {
    return this.playing().length;
  }
}

/**
 * Recorded music through a media element (the menu loop, the game's first piece, reduced mode): streamed,
 * never decoded into memory (A4 §6.4), routed into the music bus so the Music slider applies. Its own gain
 * fades it; a play cancels any fade still running and restores the level (codex C7-r1 finding 5).
 */
export class RecordedPlayer {
  readonly el: HTMLAudioElement;
  private src: string;
  private node: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private ctx: BaseAudioContext | null = null;
  /** Every play, pause and fade takes a new token; a fade's later steps and its pause check it. */
  private token = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(src: string, el: HTMLAudioElement = new Audio()) {
    this.el = el;
    this.el.preload = 'auto';
    this.el.crossOrigin = 'anonymous';
    this.src = src;
    this.el.src = src;
  }

  /** Points the element at another file (the probe chose the other codec); a playing element keeps its own. */
  setSource(src: string): void {
    if (src === this.src || this.playing) return;
    this.src = src;
    this.el.src = src;
  }

  /** Routes the element through its gain into the mixer (once; a media element can have one source node). */
  attach(ctx: BaseAudioContext, mixer: Pick<MixerGraph, 'recordedInput'>): void {
    if (this.node) return;
    this.ctx = ctx;
    this.node = (ctx as AudioContext).createMediaElementSource(this.el);
    this.gain = ctx.createGain();
    this.node.connect(this.gain);
    this.gain.connect(mixer.recordedInput());
  }

  /** Must be called inside a user activation the first time (autoplay rules, 10 §9.4). */
  play(loop: boolean, from = 0): Promise<void> {
    this.cancel();
    this.level(1);
    this.el.loop = loop;
    if (from >= 0) this.el.currentTime = from;
    return this.el.play();
  }

  pause(): void {
    this.cancel();
    this.el.pause();
  }

  get playing(): boolean {
    return !this.el.paused && !this.el.ended;
  }

  /** Fades to `to` over about `seconds`; a fade to 0 pauses the element at its end. */
  fade(to: number, seconds: number): void {
    this.cancel();
    const token = this.token;
    if (this.gain && this.ctx) {
      const p = this.gain.gain;
      const now = this.ctx.currentTime;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setTargetAtTime(to, now, Math.max(0.005, seconds / 4));
    } else {
      // no graph: the element's own volume, in 50 ms steps (timers, so a hidden page fades too)
      const from = this.el.volume;
      const t0 = Date.now();
      this.timer = setInterval(() => {
        const k = Math.min(1, (Date.now() - t0) / Math.max(1, seconds * 1000));
        this.el.volume = from + (to - from) * k;
        if (k >= 1 && this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
      }, 50);
    }
    if (to === 0)
      setTimeout(
        () => {
          if (this.token === token) this.el.pause();
        },
        seconds * 1000 + 60,
      );
  }

  private cancel(): void {
    this.token++;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private level(v: number): void {
    if (this.gain && this.ctx) {
      const p = this.gain.gain;
      const now = this.ctx.currentTime;
      p.cancelScheduledValues(now);
      p.setValueAtTime(v, now);
    }
    this.el.volume = v;
  }
}
