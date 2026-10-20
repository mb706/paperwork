// Lookahead scheduling ("a tale of two clocks"; A4 `engine/clock.js`, 10 §9.4): a coarse main-thread timer
// asks every piece for the notes that start in [cursor, now + lookahead) and the bank plays them on the
// audio clock, sample-accurately. Notes are created at most `lookahead` seconds ahead: A4 measured that
// creating a whole piece up front makes the renderer process thousands of idle notes.
//
// Realtime: a 100 ms timer, 0.8 s of lookahead. A hidden page with "Keep running in background tab" is
// throttled to about one timer a second, so the lookahead grows to 2.5 s there, and the app may supply a
// Worker-driven ticker instead (only app/ creates workers, 10 §2.2).
// Offline: the OfflineAudioContext suspends every `step` seconds; each suspension ticks, waits until the
// bank has the notes (a sync round trip), then resumes. An exception in a tick is recorded and rendering
// continues: the context is never left suspended (A4 §6.3).

export interface Schedulable {
  schedule(t0: number, t1: number): void;
  done?(now: number): boolean;
}

/** Something that calls back every `interval` seconds until stopped. */
export interface Ticker {
  start(interval: number, cb: () => void): void;
  stop(): void;
}

export const timerTicker = (): Ticker => {
  let id: ReturnType<typeof setInterval> | null = null;
  return {
    start(interval, cb) {
      if (id !== null) clearInterval(id);
      id = setInterval(cb, interval * 1000);
    },
    stop() {
      if (id !== null) clearInterval(id);
      id = null;
    },
  };
};

export interface TickStats {
  ticks: number;
  /** Main-thread milliseconds spent in ticks. */
  ms: number;
  maxMs: number;
}

export class Scheduler {
  lookahead = 0.8;
  readonly interval = 0.1;
  cursor = 0;
  readonly procs = new Set<Schedulable>();
  /** Called once per tick, before scheduling, with the audio time: game-state updates. */
  readonly listeners = new Set<(now: number) => void>();
  readonly stats: TickStats = { ticks: 0, ms: 0, maxMs: 0 };
  errors: string[] = [];
  private ticker: Ticker | null = null;

  private readonly now: () => number;
  /** After each tick: post the pooled notes to the bank. */
  private readonly flush: () => void;
  private readonly perfNow: () => number;
  constructor(now: () => number, flush: () => void, perfNow: () => number = () => performance.now()) {
    this.now = now;
    this.flush = flush;
    this.perfNow = perfNow;
  }

  add<T extends Schedulable>(p: T): T {
    this.procs.add(p);
    return p;
  }

  remove(p: Schedulable): void {
    this.procs.delete(p);
  }

  tick(now: number): void {
    const a = this.perfNow();
    try {
      for (const l of this.listeners) l(now);
      const horizon = now + this.lookahead;
      if (horizon > this.cursor) {
        const t0 = Math.max(this.cursor, now);
        for (const p of [...this.procs]) {
          p.schedule(t0, horizon);
          if (p.done?.(now)) this.procs.delete(p);
        }
        this.cursor = horizon;
      }
    } finally {
      this.flush();
      const d = this.perfNow() - a;
      this.stats.ticks++;
      this.stats.ms += d;
      if (d > this.stats.maxMs) this.stats.maxMs = d;
    }
  }

  /** Realtime: start ticking from the current audio time. */
  start(ticker: Ticker = timerTicker()): void {
    this.stop();
    this.ticker = ticker;
    const t = this.now();
    if (this.cursor < t) this.cursor = t;
    this.tick(t);
    ticker.start(this.interval, () => this.tick(this.now()));
  }

  stop(): void {
    this.ticker?.stop();
    this.ticker = null;
  }

  /** Switches the timer source (a Worker ticker in a background tab, 10 §9.4). */
  setTicker(ticker: Ticker): void {
    if (this.ticker) this.start(ticker);
  }

  /**
   * Offline: tick at every `step`, waiting for `sync` before each resume. A browser without
   * `OfflineAudioContext.suspend()` (Firefox) gets every tick up front instead, against a simulated clock
   * (`setNow`), and the voice bank's queue holds the notes: the same notes, without per-second timing.
   */
  renderOffline(
    ctx: OfflineAudioContext,
    duration: number,
    sync: () => Promise<void>,
    step = 0.25,
    setNow: (t: number | null) => void = () => {},
  ): Promise<AudioBuffer> {
    this.errors = [];
    if (typeof (ctx as { suspend?: unknown }).suspend !== 'function') {
      for (let t = 0; t < duration; t += step) {
        setNow(t);
        try {
          this.tick(t);
        } catch (e) {
          if (this.errors.length < 5)
            this.errors.push(`${t.toFixed(2)} s: ${e instanceof Error ? e.stack : String(e)}`);
        }
      }
      setNow(null);
      return sync().then(() => ctx.startRendering());
    }
    for (let t = step; t < duration; t += step) {
      const at = t;
      ctx
        .suspend(at)
        .then(async () => {
          try {
            this.tick(at);
            await sync();
          } catch (e) {
            if (this.errors.length < 5)
              this.errors.push(`${at.toFixed(2)} s: ${e instanceof Error ? e.stack : String(e)}`);
          } finally {
            void ctx.resume();
          }
        })
        .catch((e: unknown) => {
          if (this.errors.length < 5) this.errors.push(`suspend ${at}: ${String(e)}`);
        });
    }
    this.tick(0);
    return sync().then(() => ctx.startRendering());
  }
}
