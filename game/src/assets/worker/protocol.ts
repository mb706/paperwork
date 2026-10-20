// The messages between the main thread's asset loader (src/assets/loader.ts) and the asset worker
// (src/assets/worker.ts), 10 §9.7. The main thread probes the GPU formats once and tells the worker; it then asks
// for files by priority, re-ordering as the renderer reports what it drew without art; the worker fetches (at most
// six at once), checks each file's SHA-256, transcodes every KTX2 level to the chosen format and transfers the
// result. It keeps the compressed bytes of what it delivered (≤ 64 MB) to replay them after a lost WebGL context.

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
}

export type ToWorker =
  | { t: 'init'; colour: TargetFormat; shadow: TargetFormat; base: string }
  /** Adds requests, or re-prioritises those already known (by id). */
  | { t: 'want'; reqs: AssetRequest[] }
  /** Transcode these delivered files again (after a lost context), from the cache or the network. */
  | { t: 'replay'; ids: number[] };

export interface TranscodedLevel {
  width: number;
  height: number;
  data: ArrayBuffer;
}

export type FromWorker =
  | { t: 'ready'; ms: number; transcoder: string }
  | {
      t: 'file';
      id: number;
      format: TargetFormat;
      /** The KTX2 levels from `fromLevel` on. */
      levels: TranscodedLevel[];
      fromLevel: number;
      bytes: number;
      fetchMs: number;
      transcodeMs: number;
    }
  /** A failed or mismatching fetch, retried after `delayMs` (1, 2, 4, 8 s, then every 30 s). */
  | { t: 'retry'; id: number; attempt: number; error: string; delayMs: number }
  | { t: 'error'; message: string };
