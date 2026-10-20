// The asset worker's request queue (10 §9.7 "Priorities" and "Retries and readiness"): at most six requests in
// flight; the lowest priority class first, then arrival order; a request of a lower class never starts while one of
// class 1 (art the renderer drew as a greybox) waits; High level 0 takes at most two of the six connections while
// any Normal file is missing; a failed, truncated or mismatching fetch is retried after 1, 2, 4 and 8 s, then every
// 30 s, keeping its priority. Pure (the clock is passed in), so Vitest drives it.

import { type AssetRequest, PRIORITY } from './protocol.ts';

export const MAX_IN_FLIGHT = 6;
export const MAX_LEVEL0_WHILE_MISSING = 2;
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000] as const;
export const RETRY_LATER_MS = 30000;

export interface Job {
  req: AssetRequest;
  state: 'waiting' | 'running' | 'done';
  attempt: number;
  /** Not before this time (ms), after a failure. */
  notBefore: number;
  /** Arrival order. */
  seq: number;
}

export class FetchQueue {
  readonly jobs = new Map<number, Job>();
  private seq = 0;
  inFlight = 0;

  /**
   * Adds requests, or updates the priority of known ones; a done job is wanted again (an evicted page): it waits
   * once more, and the cache serves it.
   */
  want(reqs: readonly AssetRequest[]): void {
    for (const r of reqs) {
      const j = this.jobs.get(r.id);
      if (j === undefined)
        this.jobs.set(r.id, { req: r, state: 'waiting', attempt: 0, notBefore: 0, seq: this.seq++ });
      else {
        j.req = r;
        if (j.state === 'done') {
          j.state = 'waiting';
          j.attempt = 0;
          j.notBefore = 0;
        }
      }
    }
  }

  /** Drops every job (a new upload epoch). Running ones finish as orphans: counted until then, never retried. */
  clear(): void {
    this.jobs.clear();
  }

  /** Failed jobs waiting for their retry go at once, their delays reset (the core error's Retry). */
  retryNow(ids: readonly number[]): void {
    for (const id of ids) {
      const j = this.jobs.get(id);
      if (j && j.state === 'waiting' && j.attempt > 0) {
        j.attempt = 0;
        j.notBefore = 0;
      }
    }
  }

  /** The next job to start at `now`, or null (none eligible, or six in flight). */
  next(now: number): Job | null {
    if (this.inFlight >= MAX_IN_FLIGHT) return null;
    let best: Job | null = null;
    let level0Running = 0;
    let normalMissing = false;
    let class1Waiting = false;
    for (const j of this.jobs.values()) {
      if (j.req.level0 && j.state === 'running') level0Running++;
      if (!j.req.level0 && j.state !== 'done') normalMissing = true;
      if (j.state === 'waiting' && j.req.priority <= PRIORITY.missing && j.notBefore <= now)
        class1Waiting = true;
    }
    for (const j of this.jobs.values()) {
      if (j.state !== 'waiting' || j.notBefore > now) continue;
      if (class1Waiting && j.req.priority > PRIORITY.missing) continue;
      if (j.req.level0 && normalMissing && level0Running >= MAX_LEVEL0_WHILE_MISSING) continue;
      if (
        best === null ||
        j.req.priority < best.req.priority ||
        (j.req.priority === best.req.priority && j.seq < best.seq)
      )
        best = j;
    }
    if (best !== null) {
      best.state = 'running';
      this.inFlight++;
    }
    return best;
  }

  /** A job finished: its file was delivered. */
  done(j: Job): void {
    if (j.state === 'running') this.inFlight--;
    j.state = 'done';
  }

  /** Whether a job is still this queue's (not dropped by `clear` while it ran). */
  has(j: Job): boolean {
    return this.jobs.get(j.req.id) === j;
  }

  /** A job failed at `now`: it waits for its retry delay. Returns the delay. */
  failed(j: Job, now: number): number {
    if (j.state === 'running') this.inFlight--;
    if (!this.has(j)) {
      j.state = 'done';
      return -1;
    }
    const delay = RETRY_DELAYS_MS[j.attempt] ?? RETRY_LATER_MS;
    j.attempt++;
    j.state = 'waiting';
    j.notBefore = now + delay;
    return delay;
  }

  /** The earliest time a waiting job becomes eligible (for the retry timer), or Infinity. */
  nextWake(): number {
    let t = Number.POSITIVE_INFINITY;
    for (const j of this.jobs.values()) if (j.state === 'waiting' && j.notBefore < t) t = j.notBefore;
    return t;
  }
}
