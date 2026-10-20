// Which tab owns the saves (10 §8.2 "One tab at a time"; C3-r1 10). Every tab has its own IO worker, and two of
// them writing the same autosave slots would overwrite each other's games. The tab that starts first takes the
// lock (Web Locks, `navigator.locks`, in the IO worker) and becomes the owner: it raises the owner epoch in
// IndexedDB (storage.ts `claimEpoch`), and every commit it makes checks that epoch, so a tab that lost the saves
// can no longer commit, not even a write already under way. A later tab is not the owner: its writes are
// refused and the UI offers *Take over*. Taking over asks the owner on a BroadcastChannel; the owner's main
// thread saves (an exit save), then answers `release`, and its tab drops to a read-only notice. An owner that
// does not answer in time (a frozen tab) has its lock stolen: it learns so when its lock request fails, and its
// epoch is stale anyway. A tab never takes the saves back by itself: its world may be older than what the
// other tab saved since.
import type { IDBPDatabase } from 'idb';
import type { IoToMain } from '../shared/io-protocol.ts';
import { claimEpoch, type Fence } from './storage.ts';

/** The lock the tabs share. */
export interface SaveLock {
  /** Takes the lock if it is free: whether this tab now holds it. `lost` runs if another tab steals it later. */
  tryAcquire(lost: () => void): Promise<boolean>;
  /** Takes the lock whoever holds it (the holder's `lost` runs). */
  steal(lost: () => void): Promise<void>;
  /** Lets go. */
  release(): void;
}

/** The channel the tabs talk on (a BroadcastChannel): `takeover` and `released`. */
export interface TabChannel {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  close(): void;
}

export const LOCK_NAME = 'paperwork:saves';
/** How long a takeover waits for the owner's last save before it steals the lock. */
export const TAKEOVER_WAIT_MS = 5000;

interface LockManagerLike {
  request(
    name: string,
    opts: { ifAvailable?: boolean; steal?: boolean },
    cb: (lock: unknown) => Promise<void> | undefined,
  ): Promise<unknown>;
}

/** Web Locks: the lock is held while its callback's promise is pending, and released with the tab. */
export class WebSaveLock implements SaveLock {
  private readonly locks: LockManagerLike;
  private letGo: (() => void) | null = null;

  constructor(locks: LockManagerLike) {
    this.locks = locks;
  }

  /** The worker's lock manager, where the platform has one. */
  static available(): WebSaveLock | null {
    const locks = (typeof navigator === 'undefined' ? undefined : navigator) as
      | { locks?: LockManagerLike }
      | undefined;
    return locks?.locks ? new WebSaveLock(locks.locks) : null;
  }

  private hold(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.letGo = resolve;
    });
  }

  tryAcquire(lost: () => void): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.locks
        .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          resolve(true);
          return this.hold();
        })
        .catch(() => lost()); // stolen: the request's promise fails with AbortError
    });
  }

  steal(lost: () => void): Promise<void> {
    return new Promise<void>((resolve) => {
      this.locks
        .request(LOCK_NAME, { steal: true }, () => {
          resolve();
          return this.hold();
        })
        .catch(() => lost());
    });
  }

  release(): void {
    this.letGo?.();
    this.letGo = null;
  }
}

/** One process's tabs sharing a lock (tests, and pages without Web Locks get a lock of their own). */
export class MemorySaveLock implements SaveLock {
  private readonly shared: { holder: MemorySaveLock | null; lost: (() => void) | null };

  constructor(
    shared: { holder: MemorySaveLock | null; lost: (() => void) | null } = { holder: null, lost: null },
  ) {
    this.shared = shared;
  }

  /** Another tab's lock on the same saves. */
  sibling(): MemorySaveLock {
    return new MemorySaveLock(this.shared);
  }

  async tryAcquire(lost: () => void): Promise<boolean> {
    if (this.shared.holder && this.shared.holder !== this) return false;
    this.shared.holder = this;
    this.shared.lost = lost;
    return true;
  }

  async steal(lost: () => void): Promise<void> {
    const prev = this.shared.holder !== this ? this.shared.lost : null;
    this.shared.holder = this;
    this.shared.lost = lost;
    prev?.();
  }

  release(): void {
    if (this.shared.holder !== this) return;
    this.shared.holder = null;
    this.shared.lost = null;
  }
}

export class Ownership {
  /** This tab's epoch while it owns the saves; null otherwise (its writes are refused). */
  fence: Fence | null = null;
  private readonly db: IDBPDatabase;
  private readonly lock: SaveLock;
  private readonly channel: TabChannel | null;
  private readonly notify: (m: IoToMain) => void;
  private readonly owned: (f: Fence) => Promise<void>;
  private released: (() => void) | null = null;
  private readonly waitMs: number;

  constructor(o: {
    db: IDBPDatabase;
    lock: SaveLock;
    channel: TabChannel | null;
    /** Messages to this tab's main thread. */
    notify: (m: IoToMain) => void;
    /** Runs when this tab becomes the owner (the sweep of orphaned versions). */
    owned: (f: Fence) => Promise<void>;
    waitMs?: number;
  }) {
    this.db = o.db;
    this.lock = o.lock;
    this.channel = o.channel;
    this.notify = o.notify;
    this.owned = o.owned;
    this.waitMs = o.waitMs ?? TAKEOVER_WAIT_MS;
    if (this.channel) this.channel.onmessage = (e: MessageEvent) => this.heard(e.data);
  }

  /** At the worker's start: the saves are this tab's if no other tab holds them. */
  async start(): Promise<boolean> {
    const ok = await this.lock.tryAcquire(() => this.lost('another tab took over the saves'));
    if (ok) await this.become();
    else this.notify({ t: 'owner', owner: false, reason: 'another tab owns the saves' });
    return ok;
  }

  private async become(): Promise<void> {
    this.fence = await claimEpoch(this.db, Date.now());
    this.notify({ t: 'owner', owner: true });
    try {
      await this.owned(this.fence);
    } catch (e) {
      this.notify({ t: 'log', level: 'warn', msg: `IO worker: the sweep failed: ${String(e)}` });
    }
  }

  /** *Take over*: the owner saves and lets go, or its lock is stolen after `waitMs`. */
  async takeOver(): Promise<void> {
    if (this.fence) return;
    const answered = new Promise<void>((resolve) => {
      this.released = resolve;
    });
    this.channel?.postMessage({ t: 'takeover' });
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      answered,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.channel ? this.waitMs : 0);
      }),
    ]);
    if (timer !== null) clearTimeout(timer);
    this.released = null;
    await this.lock.steal(() => this.lost('another tab took over the saves'));
    await this.become();
  }

  private heard(m: unknown): void {
    const t = (m as { t?: string } | null)?.t;
    // The main thread saves, then answers `release` (SimHost does both).
    if (t === 'takeover' && this.fence) this.notify({ t: 'takeover' });
    else if (t === 'released') this.released?.();
  }

  /** This tab's answer to a takeover, after its last save: it lets go and stays read-only. */
  release(): void {
    if (!this.fence) return;
    this.fence = null;
    this.lock.release();
    this.channel?.postMessage({ t: 'released' });
    this.notify({ t: 'owner', owner: false, reason: 'another tab took over the saves' });
  }

  private lost(reason: string): void {
    if (!this.fence) return;
    this.fence = null;
    this.notify({ t: 'owner', owner: false, reason });
  }

  close(): void {
    this.channel?.close();
    this.lock.release();
  }
}
