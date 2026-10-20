// The main thread's asset loader (10 §9.7): turns the sprite manifest's pages and terrain materials into the asset
// worker's requests, re-prioritises them every frame from what the renderer drew without art, asks for High
// level 0 where pages are drawn with more than one source px per device px, and hands transcoded files to the
// renderer. Nothing waits for an asset: until a page is resident its sets draw their greyboxes (§9.7
// "Placeholders, never waits"). Only the game's first frame waits, for `core` (`ready`).
//
// C4-r1 4 and 6: readiness is `core`'s alone, and the fourth failure of a core file rejects it (the loading
// screen's error with Retry, `retry()`); any file failing four times raises the HUD's quiet notice. Every allocation
// of the renderer's arrays is an upload epoch: `reconfigure` (a restored context, a lower resolution mode) takes the
// new formats and levels, asks for every page again, and drops the replies of older epochs.

import {
  type AssetRequest,
  type FromWorker,
  PRIORITY,
  type TargetFormat,
  type ToWorker,
} from './worker/protocol.ts';

/** The parts of sprites.json the loader reads (10 §15.7). */
export interface LoaderManifest {
  arrays: {
    kind: 'colour' | 'shadow' | 'light' | 'icon';
    levels: number;
    codec: 'xubc7' | 'etc1s' | 'rgba8';
  }[];
  pages: { group: string; files: string[]; bytes: number[]; sha256?: string[] }[][];
  terrain?: {
    codec: 'xubc7' | 'rgba8';
    levels: number;
    tiles: Record<string, { file: string; bytes: number; sha256?: string; group: string }>;
  };
}

/** A transcoded file for the renderer: the page (or terrain material, array −1) and its levels. */
export interface LoadedFile {
  array: number;
  layer: number;
  format: TargetFormat;
  /** The page level of the first level. */
  firstLevel: number;
  levels: { width: number; height: number; data: Uint8Array }[];
}

/** What the renderer's arrays were allocated as: the formats and the page levels each mode drops. */
export interface UploadConfig {
  colour: TargetFormat;
  shadow: TargetFormat;
  /** Per array, the page levels the resolution mode does not allocate, and the terrain's. */
  levelOffset: number[];
  terrainOffset: number;
}

export interface LoaderOptions extends UploadConfig {
  worker: Worker;
  manifest: LoaderManifest;
  /** The URL the manifest's file paths are relative to. */
  base: string;
  /** Terrain material names in the order of the renderer's material layers. */
  terrainTiles: string[];
  onFile: (f: LoadedFile) => void;
  /** A file failed (it is retried; after the fourth failure the HUD shows a notice, §9.7). */
  onRetry?: (url: string, attempt: number, error: string) => void;
  /** A core file failed for the fourth time: the loading screen shows the error with Retry (§9.7). */
  onCoreError?: (message: string) => void;
  /** Whether some file has failed four times and is still missing (the HUD's quiet notice, §9.7). */
  onNotice?: (on: boolean) => void;
}

interface FileEntry {
  req: AssetRequest;
  array: number;
  layer: number;
  group: string;
  /** The page level of the file's first KTX2 level. */
  fileLevel: number;
  requested: boolean;
  delivered: boolean;
  /** Failures in this epoch (the worker's attempt count). */
  failures: number;
}

export interface LoaderStats {
  files: number;
  requested: number;
  delivered: number;
  bytes: number;
  retries: number;
  transcodeMs: number;
  transcoderMs: number;
}

/** The fourth failure of a core file (§9.7): the game does not start without its core art. */
export class CoreLoadError extends Error {}

/** Failures after which a file counts as failed (the core error, the HUD's notice; §9.7). */
export const FAILURES_NOTICE = 4;

export class AssetLoader {
  readonly stats: LoaderStats = {
    files: 0,
    requested: 0,
    delivered: 0,
    bytes: 0,
    retries: 0,
    transcodeMs: 0,
    transcoderMs: 0,
  };
  /** The upload epoch: bumped by every reallocation (`reconfigure`). */
  epoch = 0;
  private readonly o: LoaderOptions;
  private config: UploadConfig;
  private readonly entries: FileEntry[] = [];
  private readonly byId = new Map<number, FileEntry>();
  /** Normal-level entry per page key (array << 16 | layer), and the level-0 entry of split colour pages. */
  private readonly normal = new Map<number, FileEntry>();
  private readonly level0 = new Map<number, FileEntry>();
  private waiters: { group: string; resolve: () => void; reject: (e: Error) => void }[] = [];
  private coreError: CoreLoadError | null = null;
  private noticeOn = false;
  private failures = 0;

  constructor(o: LoaderOptions) {
    this.o = o;
    this.config = {
      colour: o.colour,
      shadow: o.shadow,
      levelOffset: o.levelOffset,
      terrainOffset: o.terrainOffset,
    };
    const m = o.manifest;
    let id = 1;
    m.arrays.forEach((a, ai) => {
      (m.pages[ai] ?? []).forEach((p, layer) => {
        const split = a.kind === 'colour' && p.files.length > 1;
        // the Normal file: a colour page's levels 1…, or the whole page for the other arrays
        const ni = split ? 1 : 0;
        const normal = this.add(id++, ai, layer, p.group, p.files[ni] as string, p.bytes[ni], p.sha256?.[ni]);
        normal.fileLevel = split ? 1 : 0;
        normal.req.kind = a.kind;
        normal.req.codec = a.codec;
        this.normal.set((ai << 16) | layer, normal);
        // High level 0 (requested only while the colour array is allocated with it)
        if (split) {
          const h = this.add(id++, ai, layer, p.group, p.files[0] as string, p.bytes[0], p.sha256?.[0]);
          h.req.kind = a.kind;
          h.req.codec = a.codec;
          h.req.level0 = true;
          this.level0.set((ai << 16) | layer, h);
        }
      });
    });
    o.terrainTiles.forEach((name, layer) => {
      const t = m.terrain?.tiles[name];
      if (!t || !m.terrain) return;
      const e = this.add(id++, -1, layer, t.group, t.file, t.bytes, t.sha256);
      e.req.kind = 'terrain';
      e.req.codec = m.terrain.codec;
    });
    this.applyLevels();
    this.stats.files = this.entries.length;
    o.worker.addEventListener('message', this.onMessage);
  }

  private add(
    id: number,
    array: number,
    layer: number,
    group: string,
    url: string,
    bytes: number | undefined,
    sha256: string | undefined,
  ): FileEntry {
    const req: AssetRequest = {
      id,
      url,
      priority: group === 'core' ? PRIORITY.core : PRIORITY.groups,
      kind: 'colour',
      codec: 'rgba8',
      fromLevel: 0,
      level0: false,
      epoch: 0,
    };
    if (bytes !== undefined) req.bytes = bytes;
    if (sha256 !== undefined) req.sha256 = sha256;
    const e: FileEntry = {
      req,
      array,
      layer,
      group,
      fileLevel: 0,
      requested: false,
      delivered: false,
      failures: 0,
    };
    this.entries.push(e);
    this.byId.set(id, e);
    return e;
  }

  /** Each request's first KTX2 level under the current allocation, and the epoch. */
  private applyLevels(): void {
    for (const e of this.entries) {
      const r = e.req;
      r.epoch = this.epoch;
      if (r.level0) r.fromLevel = 0;
      else if (e.array < 0) r.fromLevel = this.config.terrainOffset;
      else r.fromLevel = Math.max(0, (this.config.levelOffset[e.array] ?? 0) - e.fileLevel);
    }
  }

  /** Whether the colour array is allocated with its level 0 (High): only then is level 0 fetched. */
  private get high(): boolean {
    return this.config.levelOffset.some(
      (off, i) => off === 0 && this.o.manifest.arrays[i]?.kind === 'colour',
    );
  }

  /** Starts the worker on the probed formats and asks for every Normal file (core first, then the other groups). */
  start(): void {
    const c = this.config;
    this.o.worker.postMessage({
      t: 'init',
      colour: c.colour,
      shadow: c.shadow,
      base: this.o.base,
      epoch: this.epoch,
    } satisfies ToWorker);
    const reqs: AssetRequest[] = [];
    for (const e of this.entries)
      if (!e.req.level0) {
        e.requested = true;
        reqs.push(e.req);
      }
    this.stats.requested = reqs.length;
    this.o.worker.postMessage({ t: 'want', reqs } satisfies ToWorker);
  }

  /**
   * The renderer allocated its arrays again (a restored context, a lower mode for the memory budget): another
   * upload epoch. Every Normal file is asked for again with the new formats and levels (the worker's cache serves
   * what it holds); replies of the older epoch are dropped (C4-r1 6). Readiness waits for the new epoch's core.
   */
  reconfigure(c: UploadConfig): void {
    this.config = { ...c, levelOffset: [...c.levelOffset] };
    this.epoch++;
    for (const e of this.entries) {
      e.requested = false;
      e.delivered = false;
      e.failures = 0;
    }
    this.coreError = null;
    this.setNotice(false);
    this.stats.requested = 0;
    this.stats.delivered = 0;
    this.applyLevels();
    this.start();
  }

  /**
   * Once per frame (or less): pages the renderer drew as greyboxes go to the front (class 1); colour pages drawn
   * with k > 0.5 get their High level 0 (class 4). `missed` and `level0` are page keys (array << 16 | layer), the
   * first nMissed and nLevel0 of them.
   */
  update(
    missed: readonly number[],
    level0: readonly number[],
    nMissed = missed.length,
    nLevel0 = level0.length,
  ): void {
    // nothing is allocated unless a request changes (the app calls this every 10th frame)
    let reqs: AssetRequest[] | null = null;
    for (let i = 0; i < nMissed; i++) {
      const e = this.normal.get(missed[i] as number);
      if (!e || e.delivered) continue;
      // an evicted page (requested no more) is asked for again; a waiting one moves to the front
      if (e.requested && e.req.priority === PRIORITY.missing) continue;
      if (!e.requested) this.stats.requested++;
      e.requested = true;
      e.req.priority = PRIORITY.missing;
      if (reqs === null) reqs = [];
      reqs.push(e.req);
    }
    if (this.high)
      for (let i = 0; i < nLevel0; i++) {
        const e = this.level0.get(level0[i] as number);
        if (e && !e.requested) {
          e.requested = true;
          e.req.priority = PRIORITY.level0;
          if (reqs === null) reqs = [];
          reqs.push(e.req);
          this.stats.requested++;
        }
      }
    if (reqs !== null) this.o.worker.postMessage({ t: 'want', reqs } satisfies ToWorker);
  }

  /** In idle time on a screen with a device pixel ratio of 2: every page's High level 0 at low priority (§9.7). */
  prefetchLevel0(): void {
    if (!this.high) return;
    const reqs: AssetRequest[] = [];
    for (const e of this.level0.values())
      if (!e.requested) {
        e.requested = true;
        e.req.priority = PRIORITY.idle;
        reqs.push(e.req);
        this.stats.requested++;
      }
    if (reqs.length > 0) this.o.worker.postMessage({ t: 'want', reqs } satisfies ToWorker);
  }

  /** A page gave its layer to another (10 §6.13's safety net): it is asked for again when it is drawn. */
  evicted(array: number, page: number): void {
    for (const m of [this.normal, this.level0]) {
      const e = m.get((array << 16) | page);
      if (e) {
        e.delivered = false;
        e.requested = false;
      }
    }
  }

  /** Every failed file tries again at once (the core error's Retry, §9.7); readiness can resolve again. */
  retry(): void {
    const ids: number[] = [];
    for (const e of this.entries)
      if (e.requested && !e.delivered && e.failures > 0) {
        e.failures = 0;
        ids.push(e.req.id);
      }
    this.coreError = null;
    this.setNotice(false);
    if (ids.length > 0) this.o.worker.postMessage({ t: 'retry', ids } satisfies ToWorker);
  }

  /**
   * Resolves when every Normal file of `group` has been delivered to the renderer; for `core`, rejects with
   * CoreLoadError once one of them has failed four times (until `retry`).
   */
  ready(group = 'core'): Promise<void> {
    if (this.groupDone(group)) return Promise.resolve();
    if (group === 'core' && this.coreError !== null) return Promise.reject(this.coreError);
    return new Promise((resolve, reject) => this.waiters.push({ group, resolve, reject }));
  }

  /**
   * Whether every requested file has arrived or failed at least once (it retries behind its placeholder): what a
   * test waits for before a screenshot. Readiness never waits for this.
   */
  settled(): boolean {
    for (const e of this.entries) if (e.requested && !e.delivered && e.failures === 0) return false;
    return true;
  }

  /** Whether some file has failed four times and is still missing (the HUD's quiet notice). */
  get notice(): boolean {
    return this.noticeOn;
  }

  private groupDone(group: string): boolean {
    for (const e of this.entries) if (!e.req.level0 && e.group === group && !e.delivered) return false;
    return true;
  }

  private setNotice(on: boolean): void {
    if (on === this.noticeOn) return;
    this.noticeOn = on;
    this.o.onNotice?.(on);
  }

  /** How many fetches failed (a quiet notice after four, 10 §9.7). */
  get failed(): number {
    return this.failures;
  }

  private readonly onMessage = (ev: MessageEvent<FromWorker>): void => {
    const m = ev.data;
    if (m.t === 'ready') this.stats.transcoderMs = m.ms;
    else if (m.t === 'file') {
      const e = this.byId.get(m.id);
      // a reply for an older allocation (another format or levels): not this one's
      if (!e || m.epoch !== this.epoch) return;
      if (!e.delivered) this.stats.delivered++;
      e.delivered = true;
      e.failures = 0;
      this.stats.bytes += m.bytes;
      this.stats.transcodeMs += m.transcodeMs;
      this.o.onFile({
        array: e.array,
        layer: e.layer,
        format: m.format,
        firstLevel: e.fileLevel + m.fromLevel,
        levels: m.levels.map((l) => ({ width: l.width, height: l.height, data: new Uint8Array(l.data) })),
      });
      const waiting = this.waiters;
      this.waiters = [];
      for (const w of waiting)
        if (this.groupDone(w.group)) w.resolve();
        else this.waiters.push(w);
      if (
        this.noticeOn &&
        !this.entries.some((x) => x.requested && !x.delivered && x.failures >= FAILURES_NOTICE)
      )
        this.setNotice(false);
    } else if (m.t === 'retry') {
      const e = this.byId.get(m.id);
      if (!e || m.epoch !== this.epoch) return;
      this.stats.retries++;
      this.failures++;
      e.failures = m.attempt;
      this.o.onRetry?.(e.req.url, m.attempt, m.error);
      if (e.failures >= FAILURES_NOTICE) {
        this.setNotice(true);
        if (e.group === 'core' && !e.req.level0 && this.coreError === null) {
          this.coreError = new CoreLoadError(`${e.req.url}: ${m.error} (${m.attempt} attempts)`);
          this.o.onCoreError?.(this.coreError.message);
          const waiting = this.waiters;
          this.waiters = [];
          for (const w of waiting)
            if (w.group === 'core') w.reject(this.coreError);
            else this.waiters.push(w);
        }
      }
    } else if (m.t === 'error') console.error(`asset worker: ${m.message}`);
  };

  dispose(): void {
    this.o.worker.removeEventListener('message', this.onMessage);
  }
}
