// The main thread's handle on the voice bank (10 §9.4): it pools note records and posts them in one message
// per flush, configures era slots, sends sample data and automation, and asks for statistics. It talks to
// anything with a MessagePort-like `port`, so tests drive a BankCore directly.
import {
  type AutoEvent,
  type BankStats,
  type ChannelConfig,
  type ChannelParam,
  F,
  type FdnConfig,
  type FromBank,
  NF,
  type ToBank,
} from './worklet/protocol.ts';

export interface PortLike {
  postMessage(m: ToBank, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<FromBank>) => void) | null;
}

/** One note record's fields, by name (see protocol.ts F). */
export type NoteRecord = Partial<Record<keyof typeof F, number>>;

/** What the SFX system and the loaders need from a voice engine: the bank, or reduced audio's native voices. */
export interface VoiceEngine {
  note(rec: NoteRecord): void;
  control(handle: number, gain: number, pan: number, release?: boolean, tau?: number): void;
  flush(): void;
  buffer(id: number, chans: Int16Array[], rate: number): void;
  free(id: number): void;
  /** Fades every voice of a music slot, or every SFX voice, and drops its pending notes. */
  clear(slot: number | 'sfx', fade: number): void;
  /** Asks for the report of working loops that ended unasked (stolen, dropped, their buffer freed). */
  poll(): void;
  /** Receives that report: the loops' handles. */
  onEnded: ((handles: readonly number[]) => void) | null;
}

const DEFAULTS: NoteRecord = { RATE: 1, GAIN: 1, OFF: 1e9, STOP: 1e9, RELEASE: 0.35, TYPE: -1, CAP: 4 };

export class BankClient implements VoiceEngine {
  private buf = new Float64Array(64 * NF);
  private n = 0;
  private ctl = new Float64Array(32 * 5);
  private nCtl = 0;
  private seq = 0;
  private readonly waiting = new Map<number, () => void>();
  private statsWaiter: ((s: BankStats) => void) | null = null;
  /** Notes posted since the start (for the scheduler's statistics). */
  posted = 0;
  onEnded: ((handles: readonly number[]) => void) | null = null;

  private readonly port: PortLike;
  constructor(port: PortLike) {
    this.port = port;
    port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'sync') {
        this.waiting.get(m.seq)?.();
        this.waiting.delete(m.seq);
      } else if (m.t === 'stats') {
        this.statsWaiter?.(m);
        this.statsWaiter = null;
      } else if (m.t === 'ended') this.onEnded?.(m.handles);
    };
  }

  /** Queues a note; it is posted with the next flush. */
  note(rec: NoteRecord): void {
    if ((this.n + 1) * NF > this.buf.length) {
      const b = new Float64Array(this.buf.length * 2);
      b.set(this.buf);
      this.buf = b;
    }
    const o = this.n * NF;
    this.buf.fill(0, o, o + NF);
    for (const k in DEFAULTS) this.buf[o + F[k as keyof typeof F]] = DEFAULTS[k as keyof typeof F] as number;
    for (const k in rec) this.buf[o + F[k as keyof typeof F]] = rec[k as keyof typeof F] as number;
    this.n++;
  }

  /** Sets a working loop's gain and pan, or releases it over `tau` seconds. */
  control(handle: number, gain: number, pan: number, release = false, tau = 0.3): void {
    if ((this.nCtl + 1) * 5 > this.ctl.length) {
      const b = new Float64Array(this.ctl.length * 2);
      b.set(this.ctl);
      this.ctl = b;
    }
    this.ctl.set([handle, gain, pan, release ? 1 : 0, tau], this.nCtl * 5);
    this.nCtl++;
  }

  get pending(): number {
    return this.n;
  }

  /** Posts the pooled notes and controls: one message each, the arrays copied by structured clone. */
  flush(): void {
    if (this.n > 0) {
      this.port.postMessage({ t: 'notes', n: this.n, data: this.buf.slice(0, this.n * NF) });
      this.posted += this.n;
      this.n = 0;
    }
    if (this.nCtl > 0) {
      this.port.postMessage({ t: 'ctl', n: this.nCtl, data: this.ctl.slice(0, this.nCtl * 5) });
      this.nCtl = 0;
    }
  }

  /** Sends a sample buffer (transferred: the caller loses the arrays). */
  buffer(id: number, chans: Int16Array[], rate: number): void {
    this.port.postMessage(
      { t: 'buf', id, chans, rate },
      chans.map((c) => c.buffer as ArrayBuffer),
    );
  }

  free(id: number): void {
    this.port.postMessage({ t: 'free', id });
  }

  wave(id: number, harmonics: number[]): void {
    this.port.postMessage({ t: 'wave', id, harmonics });
  }

  layout(slot: number, channels: ChannelConfig[]): void {
    this.port.postMessage({ t: 'layout', slot, channels });
  }

  automate(slot: number, channel: number, param: ChannelParam, events: AutoEvent[]): void {
    this.port.postMessage({ t: 'auto', slot, channel, param, events });
  }

  clear(slot: number | 'sfx', fade: number): void {
    this.port.postMessage({ t: 'clear', slot, fade });
  }

  /** A slot's room: its reverb (cleared), the return's gain (linear), the air shelf (dB). */
  room(slot: number, reverb: FdnConfig, wet: number, airDb: number): void {
    this.port.postMessage({ t: 'room', slot, reverb, wet, airDb });
  }

  /** A slot's era gain (linear) from audio time `at`, over `seconds` (τ = seconds / 4) or at once. */
  fade(slot: number, gain: number, at: number, seconds: number): void {
    this.port.postMessage({ t: 'fade', slot, gain, at, seconds });
  }

  /** The SFX buses' fader gains (linear) from audio time `at`, approached with `tau` (0: at once). */
  buses(gains: number[], at: number, tau: number): void {
    this.port.postMessage({ t: 'buses', gains, at, tau });
  }

  poll(): void {
    this.port.postMessage({ t: 'poll' });
  }

  taps(list: { slot: number; channel: number }[]): void {
    this.port.postMessage({ t: 'taps', list });
  }

  stats(): Promise<BankStats> {
    return new Promise((resolve) => {
      this.statsWaiter = resolve;
      this.port.postMessage({ t: 'stats' });
    });
  }

  /** Resolves once the bank has handled every message posted before it (offline renders wait on it). */
  sync(): Promise<void> {
    const seq = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(seq, resolve);
      this.port.postMessage({ t: 'sync', seq });
    });
  }
}
