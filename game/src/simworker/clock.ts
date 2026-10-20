// The single-player clock (10 §3.3, S3): ticks due = floor((now − t₀) × speed ÷ 16.667 ms), within one clock
// generation {gen, fromTick, speed, paused}. Pause, resume, a speed change and a rebase each start a new
// generation, and old deadlines are void in it. Pause and speed are sequencer state, never world state (S14).

/** One tick at 60 UPS. */
export const TICK_MS = 1000 / 60;
/** Each wake runs at most this many outstanding ticks. */
export const MAX_TICKS_PER_WAKE = 3;
/** A backlog beyond this rebases t₀ and is dropped: game time slows, as in Factorio below 60 UPS. */
export const REBASE_BACKLOG = 6;
/** The next tick closer than this is waited for with a self-posted message, not a timer (the 4 ms clamp). */
export const SHORT_WAIT_MS = 4;
/** Timers wake this much early. */
export const TIMER_LEAD_MS = 2;

export class Clock {
  /** u16, raised by every transition. */
  gen = 0;
  paused = false;
  speed = 1;
  private t0 = 0;
  private tick0 = 0;

  /** A new generation from `now` at `tick`. */
  restart(now: number, tick: number): void {
    this.gen = (this.gen + 1) & 0xffff;
    this.t0 = now;
    this.tick0 = tick;
  }

  /** Ticks due at `now` beyond `tick` (may be negative before the next deadline). */
  due(now: number, tick: number): number {
    return Math.floor(((now - this.t0) * this.speed) / TICK_MS) - (tick - this.tick0);
  }

  /** When the tick after `tick` is due. */
  nextAt(tick: number): number {
    return this.t0 + ((tick - this.tick0 + 1) * TICK_MS) / this.speed;
  }
}
