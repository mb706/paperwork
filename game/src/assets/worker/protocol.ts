// The messages between the main thread's asset loader (src/assets/loader.ts) and the asset worker
// (src/assets/worker.ts), 10 §9.7. The main thread probes the GPU formats once and tells the worker; it then asks
// for files by priority, re-ordering as the renderer reports what it drew without art; the worker fetches (at most
// six at once), checks each file's SHA-256, transcodes every KTX2 level to the chosen format and transfers the
// result. It keeps the compressed bytes of what it delivered (≤ 64 MB), so a reallocation (a lost WebGL context, a
// lower resolution mode) re-transcodes without refetching. Every allocation is an upload epoch (C4-r1 6): the
// requests carry it, so do the replies, and the main thread drops replies of an older one.

/** The GPU formats the worker transcodes to (the renderer's probe picks them, 10 §9.2). */
export type TargetFormat = 'bc7' | 'astc' | 'bc3' | 'etc2' | 'rgba8' | 'bc4' | 'eac_r11' | 'r8';
export type FileCodec = 'xubc7' | 'etc1s' | 'rgba8';
export type FileKind = 'colour' | 'shadow' | 'light' | 'icon' | 'terrain';

/** The priority classes of 10 §9.7, lower first. */
export const PRIORITY = {
  /** Normal levels of pages the renderer drew as greyboxes this second. */
  missing: 1,
  /** `core`, then the groups of researched technologies. */
  core: 3,
  groups: 3.5,
  /** High level 0 of drawn pages. */
  level0: 4,
  /** Prefetches, then idle prefetches. */
  prefetch: 5,
  idle: 6,
} as const;

export interface AssetRequest {
  id: number;
  url: string;
  /** The manifest's byte count and SHA-256 (checked when present). */
  bytes?: number;
  sha256?: string;
  priority: number;
  kind: FileKind;
  codec: FileCodec;
  /** The first KTX2 level to transcode (levels the resolution mode does not allocate are skipped). */
  fromLevel: number;
  /** A level-0 (High) file: at most two of six connections while any Normal file is missing. */
  level0: boolean;
  /** The upload epoch it belongs to (the replies carry it back). */
  epoch: number;
}

export type ToWorker =
  /**
   * The formats the renderer allocated its arrays in (probe ∧ transcoder), the files' base URL and the upload
   * epoch: a new epoch drops every request of the older ones (their bytes stay cached).
   */
  | { t: 'init'; colour: TargetFormat; shadow: TargetFormat; base: string; epoch: number }
  /**
   * Adds requests, or re-prioritises those already known (by id); a delivered one is transcoded again (a page
   * evicted under the GPU-memory safety net, 10 §6.13), from the cache when it can be.
   */
  | { t: 'want'; reqs: AssetRequest[] }
  /** Failed requests try again at once, their retry delays reset (the Retry of the core error, §9.7). */
  | { t: 'retry'; ids: number[] };

export interface TranscodedLevel {
  width: number;
  height: number;
  data: ArrayBuffer;
}

/** What the transcoder can make from each supercompressed codec (rgba8 and r8 always work). */
export type Transcodable = Record<'xubc7' | 'etc1s', TargetFormat[]>;

export type FromWorker =
  /** Sent once the transcoder is loaded, before any request: the main thread picks formats it can make. */
  | { t: 'ready'; ms: number; transcoder: string; supports: Transcodable }
  | {
      t: 'file';
      id: number;
      epoch: number;
      format: TargetFormat;
      /** The KTX2 levels from `fromLevel` on. */
      levels: TranscodedLevel[];
      fromLevel: number;
      bytes: number;
      fetchMs: number;
      transcodeMs: number;
    }
  /** A failed or mismatching fetch, retried after `delayMs` (1, 2, 4, 8 s, then every 30 s). */
  | { t: 'retry'; id: number; epoch: number; attempt: number; error: string; delayMs: number }
  | { t: 'error'; message: string };
