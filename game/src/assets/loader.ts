// The main thread's asset loader (10 §9.7): turns the sprite manifest's pages and terrain materials into the asset
// worker's requests, re-prioritises them every frame from what the renderer drew without art, asks for High
// level 0 where pages are drawn with more than one source px per device px, and hands transcoded files to the
// renderer. Nothing waits for an asset: until a page is resident its sets draw their greyboxes (§9.7
// "Placeholders, never waits"). Only the game's first frame waits, for `core` (`ready`).

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

export interface LoaderOptions {
  worker: Worker;
  manifest: LoaderManifest;
  /** The URL the manifest's file paths are relative to. */
  base: string;
  colour: TargetFormat;
  shadow: TargetFormat;
  /** Per array, the page levels the resolution mode does not allocate (the renderer's), and the terrain's. */
  levelOffset: number[];
  terrainOffset: number;
  /** Terrain material names in the order of the renderer's material layers. */
  terrainTiles: string[];
  onFile: (f: LoadedFile) => void;
  /** A file failed (it is retried; after the fourth failure the HUD shows a notice, §9.7). */
  onRetry?: (url: string, attempt: number, error: string) => void;
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
  private readonly o: LoaderOptions;
  private readonly entries: FileEntry[] = [];
  /** Normal-level entry per page key (array << 16 | layer), and the level-0 entry of colour pages. */
  private readonly normal = new Map<number, FileEntry>();
  private readonly level0 = new Map<number, FileEntry>();
  private readonly waiters: { group: string; resolve: () => void }[] = [];
  private failures = 0;

  constructor(o: LoaderOptions) {
    this.o = o;
    const m = o.manifest;
    let id = 1;
    m.arrays.forEach((a, ai) => {
      const offset = o.levelOffset[ai] ?? 0;
      (m.pages[ai] ?? []).forEach((p, layer) => {
        const split = a.kind === 'colour' && p.files.length > 1;
        // the Normal file: a colour page's levels 1…, or the whole page for the other arrays
        const ni = split ? 1 : 0;
        const fileLevel = split ? 1 : 0;
        const fromLevel = Math.max(0, offset - fileLevel);
        const normal = this.add(
          id++,
          ai,
          layer,
          p.group,
          p.files[ni] as string,
          p.bytes[ni],
          p.sha256?.[ni],
          a.kind,
          a.codec,
          fileLevel,
          fromLevel,
          false,
        );
        this.normal.set((ai << 16) | layer, normal);
        if (split && offset === 0) {
          const h = this.add(
            id++,
            ai,
            layer,
            p.group,
            p.files[0] as string,
            p.bytes[0],
            p.sha256?.[0],
            a.kind,
            a.codec,
            0,
            0,
            true,
          );
          this.level0.set((ai << 16) | layer, h);
        }
      });
    });
    o.terrainTiles.forEach((name, layer) => {
      const t = m.terrain?.tiles[name];
      if (!t || !m.terrain) return;
      this.add(
        id++,
        -1,
        layer,
        t.group,
        t.file,
        t.bytes,
        t.sha256,
        'terrain',
        m.terrain.codec,
        0,
        o.terrainOffset,
        false,
      );
    });
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
    kind: AssetRequest['kind'],
    codec: AssetRequest['codec'],
    fileLevel: number,
    fromLevel: number,
    level0: boolean,
  ): FileEntry {
    const req: AssetRequest = {
      id,
      url,
      priority: group === 'core' ? PRIORITY.core : PRIORITY.groups,
      kind,
      codec,
      fromLevel,
      level0,
    };
    if (bytes !== undefined) req.bytes = bytes;
    if (sha256 !== undefined) req.sha256 = sha256;
    const e: FileEntry = { req, array, layer, group, fileLevel, requested: false, delivered: false };
    this.entries.push(e);
    return e;
  }

  /** Starts the worker on the probed formats and asks for every Normal file (core first, then the other groups). */
  start(): void {
    const init: ToWorker = { t: 'init', colour: this.o.colour, shadow: this.o.shadow, base: this.o.base };
    this.o.worker.postMessage(init);
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
   * Once per frame (or less): pages the renderer drew as greyboxes go to the front (class 1); colour pages drawn
   * with k > 0.5 get their High level 0 (class 4). `missed` and `level0` are page keys (array << 16 | layer).
   */
  update(missed: Iterable<number>, level0: Iterable<number>): void {
    const reqs: AssetRequest[] = [];
    for (const key of missed) {
      const e = this.normal.get(key);
      if (e && !e.delivered && e.req.priority !== PRIORITY.missing) {
        e.req.priority = PRIORITY.missing;
        reqs.push(e.req);
      }
    }
    for (const key of level0) {
      const e = this.level0.get(key);
      if (e && !e.requested) {
        e.requested = true;
        e.req.priority = PRIORITY.level0;
        reqs.push(e.req);
        this.stats.requested++;
      }
    }
    if (reqs.length > 0) this.o.worker.postMessage({ t: 'want', reqs } satisfies ToWorker);
  }

  /** In idle time on a screen with a device pixel ratio of 2: every page's High level 0 at low priority (§9.7). */
  prefetchLevel0(): void {
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

  /** After a lost and restored context: every delivered file again (the worker's cache first). */
  replay(): void {
    const ids = this.entries.filter((e) => e.delivered).map((e) => e.req.id);
    this.o.worker.postMessage({ t: 'replay', ids } satisfies ToWorker);
  }

  /** Resolves when every Normal file of `group` has been delivered to the renderer. */
  ready(group = 'core'): Promise<void> {
    if (this.groupDone(group)) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ group, resolve }));
  }

  private groupDone(group: string): boolean {
    return this.entries.every((e) => e.req.level0 || e.group !== group || e.delivered);
  }

  /** How many fetches failed (a quiet notice after four, 10 §9.7). */
  get failed(): number {
    return this.failures;
  }

  private readonly onMessage = (ev: MessageEvent<FromWorker>): void => {
    const m = ev.data;
    if (m.t === 'ready') this.stats.transcoderMs = m.ms;
    else if (m.t === 'file') {
      const e = this.entries.find((x) => x.req.id === m.id);
      if (!e) return;
      e.delivered = true;
      this.stats.delivered++;
      this.stats.bytes += m.bytes;
      this.stats.transcodeMs += m.transcodeMs;
      this.o.onFile({
        array: e.array,
        layer: e.layer,
        format: m.format,
        firstLevel: e.fileLevel + m.fromLevel,
        levels: m.levels.map((l) => ({ width: l.width, height: l.height, data: new Uint8Array(l.data) })),
      });
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i] as { group: string; resolve: () => void };
        if (this.groupDone(w.group)) {
          this.waiters.splice(i, 1);
          w.resolve();
        }
      }
    } else if (m.t === 'retry') {
      this.stats.retries++;
      this.failures++;
      const e = this.entries.find((x) => x.req.id === m.id);
      this.o.onRetry?.(e?.req.url ?? String(m.id), m.attempt, m.error);
    } else if (m.t === 'error') console.error(`asset worker: ${m.message}`);
  };

  dispose(): void {
    this.o.worker.removeEventListener('message', this.onMessage);
  }
}
