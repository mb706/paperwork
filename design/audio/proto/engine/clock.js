// Lookahead scheduling ("a tale of two clocks"): a coarse timer on the main thread asks every
// process for the notes that start in [cursor, now + lookahead) and schedules them on the audio
// clock, which is sample-accurate. Nodes are created at most `lookahead` seconds ahead:
// creating a whole piece's nodes up front makes Chrome process thousands of idle nodes per
// render quantum (measured: 0.67x real time offline, against 3.2x with lookahead).

export class Clock {
  constructor(ctx, { lookahead = 0.8, interval = 0.1 } = {}) {
    this.ctx = ctx;
    this.lookahead = lookahead;
    this.interval = interval;
    this.cursor = 0;
    this.procs = new Set();
    this.listeners = new Set(); // called once per tick with (now) before scheduling: game-state updates
    this.timer = null;
  }

  add(proc) {
    this.procs.add(proc);
    return proc;
  }

  remove(proc) {
    this.procs.delete(proc);
  }

  tick(now) {
    for (const l of this.listeners) l(now);
    const horizon = now + this.lookahead;
    if (horizon <= this.cursor) return;
    const t0 = Math.max(this.cursor, now);
    for (const p of [...this.procs]) {
      p.schedule(t0, horizon);
      if (p.done?.(now)) this.procs.delete(p);
    }
    this.cursor = horizon;
  }

  /** Realtime: a main-thread timer. (A Worker-driven timer keeps ticking in background tabs.) */
  start() {
    this.cursor = this.ctx.currentTime;
    this.tick(this.ctx.currentTime);
    this.timer = setInterval(() => this.tick(this.ctx.currentTime), this.interval * 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Offline: suspend the OfflineAudioContext every `step` seconds and tick, like the realtime timer. */
  renderOffline(duration, step = 0.25) {
    const ctx = this.ctx;
    this.errors = [];
    for (let t = step; t < duration; t += step) {
      const at = t;
      ctx.suspend(at).then(() => {
        try {
          this.tick(at);
        } catch (e) {
          // never leave the context suspended: record the error and keep rendering
          if (this.errors.length < 5) this.errors.push(`${at.toFixed(2)} s: ${e?.stack ?? e}`);
        } finally {
          ctx.resume();
        }
      });
    }
    this.tick(0);
    return ctx.startRendering();
  }
}
