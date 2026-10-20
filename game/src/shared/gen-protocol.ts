// The worldgen workers' messages (10 §3.1, §15.9; C3). Each pool belongs to one sim worker: the main thread
// creates the workers with it, sends each `boot` with gen.wasm (compiled once per page) and one end of a
// MessageChannel (`port`), hands the other ends to the sim worker in `boot.genPorts`, and terminates the pool
// with the sim worker. The sim worker initialises the pool for its world and sends it chunk and chart requests
// round-robin; every answer carries the world's hash (inside `chunk_data`, and in `inited`). The main thread
// may ask a worker for a map preview (the New game screen, §5.18) before any world exists.
import type { BuildManifest, StateGen } from './protocol.ts';

/** Requests on a pool port (from the sim worker) or the worker's own channel (previews, from the main thread). */
export type GenRequest =
  /** `gen_init`: prototypes.bin and the world's `new_world` record (§15.9). */
  | { t: 'init'; id: number; gen: StateGen; protos: ArrayBuffer; world: ArrayBuffer }
  | { t: 'chunk'; id: number; gen: StateGen; surface: number; cx: number; cy: number }
  | { t: 'chart'; id: number; gen: StateGen; surface: number; cx: number; cy: number }
  /** `gen_preview` (a PreviewRequest), after an `init`. */
  | { t: 'preview'; id: number; gen: StateGen; request: ArrayBuffer };

export type GenReply =
  /** `gen_init`'s world hash (XXH64 of the seed, the map settings and prototypes.bin), 16 hex digits. */
  | { t: 'inited'; id: number; gen: StateGen; worldHash: string }
  /** A `chunk_data` record (§15.9), transferred. */
  | { t: 'chunk'; id: number; gen: StateGen; data: ArrayBuffer }
  /** A `ChartChunk` record (§5.19), transferred. */
  | { t: 'chart'; id: number; gen: StateGen; data: ArrayBuffer }
  | { t: 'preview'; id: number; gen: StateGen; data: ArrayBuffer }
  | { t: 'failed'; id: number; gen: StateGen; status: number; message: string };

export type MainToGen =
  | { t: 'boot'; build: BuildManifest; module: WebAssembly.Module | null }
  /** The pool port of the sim worker this worker serves. */
  | { t: 'port'; port: MessagePort }
  | GenRequest;

export type GenToMain =
  | { t: 'ready'; abi: number; schemaHash: string }
  | { t: 'refused'; reason: string; abi: number; schemaHash: string; message: string }
  | GenReply
  | { t: 'log'; level: 'info' | 'warn' | 'error'; msg: string };
