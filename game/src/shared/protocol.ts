// The messages between the main thread and a sim worker (10 §3.2), as structured-clone objects whose bulk
// content is transferable ArrayBuffers in §15's binary formats. Every message that refers to a world carries
// the state generation it belongs to (§3.4); a receiver drops messages from any other generation. The fake
// sim (src/simworker/fake.ts) and the real worker shell both speak exactly this protocol.
import type { NewWorld } from './gen/abi.ts';
import type { ViewRequest } from './gen/packet.ts';
import type { SubRequest } from './gen/projections.ts';

/** The main thread's state generation (§3.4): u32, allocated only by the main thread. */
export type StateGen = number;

/** build-manifest.json (§2.3, §9.7): the parts of it a worker reads. */
export interface BuildManifest {
  build: string;
  buildHash: string;
  dev: boolean;
  [key: string]: unknown;
}

/** What the New game screen sets (07 §17): the `new_world` record (schema/abi.yaml), as `sim_new_world` takes it. */
export type NewWorldSettings = NewWorld;

/** A save's metadata from its container header (§8.1), as the IO worker hands it over. */
export interface SaveMeta {
  /** The header's digest lineage r, 16 hex digits (§4.8). */
  lineage: string;
  prototypesHash: string;
  tick: number;
}

/** Sequencer control (S14): pause and speed never reach the World. */
export type SeqOp = 'pause' | 'resume' | { speed: number } | { step: number };

/** Dev hooks (§3.5) a worker answers; each reply is a `res` with the same id. */
export type DevOp = { op: 'hash' } | { op: 'digest' } | { op: 'flags'; noSleep: boolean };

export type MainToSim =
  | {
      t: 'boot';
      build: BuildManifest;
      /** sim.wasm, compiled once per page (§3.1); the fake sim ignores it. */
      module: WebAssembly.Module | null;
      ioPort: MessagePort | null;
      genPorts: MessagePort[];
      /** Multiplayer only (S11). */
      closurePort?: MessagePort;
    }
  | { t: 'world'; gen: StateGen; op: 'new'; settings: NewWorldSettings }
  | { t: 'world'; gen: StateGen; op: 'load'; sections: ArrayBuffer; meta: SaveMeta }
  /** Encoded actions (§15.3: u16 type, u16 len, payload, back to back), the first with seq `firstSeq`. */
  | { t: 'act'; gen: StateGen; firstSeq: number; actions: ArrayBuffer; blobs?: ArrayBuffer[] }
  | { t: 'seq'; op: SeqOp }
  | { t: 'view'; gen: StateGen; v: ViewRequest }
  | { t: 'sub'; gen: StateGen; subs: SubRequest[] }
  | { t: 'unsub'; gen: StateGen; ids: number[] }
  /** A query (§15.5): u16 kind, u16 flags, then the kind's parameters. */
  | { t: 'query'; gen: StateGen; id: number; q: ArrayBuffer }
  | { t: 'cancel'; gen: StateGen; id: number }
  /** A packet buffer returned for reuse (§15.4 "Pooling"). */
  | { t: 'ack'; buf: ArrayBuffer }
  | { t: 'save'; id: number; reason: 'manual' | 'auto' | 'exit' | 'checkpoint' }
  | { t: 'dev'; id: number; op: DevOp };

export type SimToMain =
  | { t: 'ready'; abi: number; schemaHash: string; buildHash: string }
  /** A world is loaded and running (from sim_meta, §15.8). */
  | {
      t: 'bound';
      gen: StateGen;
      tick: number;
      players: { index: number; lastSeq: number; inputGen: number }[];
    }
  | { t: 'loadReport'; gen: StateGen; report: ArrayBuffer }
  | { t: 'chart'; gen: StateGen; records: ArrayBuffer }
  /** One render-and-UI packet (§15.4), transferred; its header carries the state generation. */
  | { t: 'pkt'; buf: ArrayBuffer }
  | { t: 'res'; gen: StateGen; id: number; ok: boolean; value: ArrayBuffer }
  | { t: 'clock'; gen: StateGen; clockGen: number; tick: number; speed: number; paused: boolean }
  | { t: 'saved'; id: number; bytes: number; ms: number; sha256: string }
  | { t: 'trap'; gen: StateGen; tick: number; message: string }
  | { t: 'log'; level: 'info' | 'warn' | 'error'; msg: string; data?: unknown };

/** The packet header's state_gen and view_seq (§15.4): the module leaves them zero, the shell fills them. */
export const PACKET_STATE_GEN_OFFSET = 8;
export const PACKET_VIEW_SEQ_OFFSET = 16;
