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

interface Native {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  handle: number;
  type: number;
  level: number;
  started: number;
}

export class NativeVoices implements VoiceEngine {
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly live: Native[] = [];

  private readonly ctx: BaseAudioContext;
  private readonly mixer: MixerGraph;
  constructor(ctx: BaseAudioContext, mixer: MixerGraph) {
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
    this.buffers.delete(id);
  }

  note(r: NoteRecord): void {
    const buf = this.buffers.get(r.SRC ?? -1);
    const busIndex = (r.DEST ?? 64) - 64;
    const bus = SFX_BUSES[busIndex];
    if (!buf || !bus) return;
    const looping = (r.LOOP_E ?? 0) > 0;
    if (looping && this.live.filter((v) => v.handle > 0).length >= REDUCED_LOOPS) {
      // only the loudest loops: replace the quietest if this one is louder
      const quiet = this.live.filter((v) => v.handle > 0).sort((a, b) => a.level - b.level)[0];
      if (!quiet || quiet.level >= (r.GAIN ?? 0)) return;
      this.stop(quiet, 0.05);
    }
    if (this.live.length >= REDUCED_VOICES) {
      const victim = [...this.live].sort((a, b) => a.level - b.level || a.started - b.started)[0];
      if (victim) this.stop(victim, 0.005);
    }
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, r.TIME ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = r.RATE ?? 1;
    const gain = ctx.createGain();
    const g = r.GAIN ?? 1;
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
    const v: Native = { src, gain, pan, handle: r.HANDLE ?? 0, type: r.TYPE ?? -1, level: g, started: t };
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

  private stop(v: Native, tau: number): void {
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.setTargetAtTime(0, now, tau / 4);
    v.src.stop(now + tau * 1.5 + 0.01);
    v.level = 0;
    v.handle = 0;
  }

  control(handle: number, gain: number, pan: number, release = false, tau = 0.3): void {
    const v = this.live.find((x) => x.handle === handle);
    if (!v) return;
    if (release) {
      this.stop(v, tau);
      return;
    }
    const now = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(gain, now, 0.05);
    v.pan.pan.setTargetAtTime(pan, now, 0.05);
    v.level = gain;
  }

  flush(): void {}

  get voices(): number {
    return this.live.length;
  }
}

/**
 * Recorded music through a media element (the menu loop, the game's first piece, reduced mode): streamed,
 * never decoded into memory (A4 §6.4), routed into the music bus so the Music slider applies.
 */
export class RecordedPlayer {
  readonly el: HTMLAudioElement;
  private node: MediaElementAudioSourceNode | null = null;

  constructor(src: string) {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.crossOrigin = 'anonymous';
    this.el.src = src;
  }

  /** Routes the element through the mixer (once; a media element can have one source node). */
  attach(ctx: AudioContext, mixer: MixerGraph): void {
    if (this.node) return;
    this.node = ctx.createMediaElementSource(this.el);
    this.node.connect(mixer.recordedInput());
  }

  /** Must be called inside a user activation the first time (autoplay rules, 10 §9.4). */
  play(loop: boolean, from = 0): Promise<void> {
    this.el.loop = loop;
    if (from >= 0) this.el.currentTime = from;
    return this.el.play();
  }

  pause(): void {
    this.el.pause();
  }

  get playing(): boolean {
    return !this.el.paused && !this.el.ended;
  }

  /** Fades the element's own volume (used when no audio graph is attached). */
  fade(to: number, seconds: number): void {
    const from = this.el.volume;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      this.el.volume = from + (to - from) * k;
      if (k < 1) requestAnimationFrame(step);
      else if (to === 0) this.el.pause();
    };
    step();
  }
}
