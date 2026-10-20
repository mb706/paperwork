// The messages between the main thread and a sim worker (10 §3.2), as structured-clone objects whose bulk
// content is transferable ArrayBuffers in §15's binary formats. Every message that refers to a world carries
// the state generation it belongs to (§3.4); a receiver drops messages from any other generation. The fake
// sim (src/simworker/fake.ts) and the real worker shell (src/simworker/shell.ts) both speak this protocol.
//
// Versions. One handshake per worker versions the whole conversation: `boot` carries the build manifest, whose
// `protocolVersion` and `schemaHash` the worker compares with its own PROTOCOL_VERSION and SCHEMA_HASH (the
// schema hash covers every layout and version, PROTOCOL_VERSION and ABI_VERSION included); the worker answers
// `ready` with its module's ABI version and schema hash, which the main thread compares in turn, or `refused`.
// Main thread and workers come from one build (content-addressed chunks, §9.7), so a mismatch means a stale
// cache. The binary payloads carry their own versions (PACKET_VERSION, ACTION_SCHEMA_VERSION, the save and
// closure-log formats). C3 added the messages marked "(C3)" to §3.2's list; each is optional for the fake.
import type { NewWorld } from './gen/abi.ts';
import type { SaveHeader } from './gen/container.ts';
import type { ViewRequest } from './gen/packet.ts';
import type { SubRequest } from './gen/projections.ts';

/** The main thread's state generation (§3.4): u32, allocated only by the main thread. */
export type StateGen = number;

/** build-manifest.json (§2.3, §9.7): the parts of it a worker reads. */
export interface BuildManifest {
  build: string;
  buildHash: string;
  dev: boolean;
  /** PROTOCOL_VERSION and SCHEMA_HASH of the build (scripts/build-manifest.ts); the worker refuses others. */
  protocolVersion?: number;
  schemaHash?: string;
  /** SHA-256 of prototypes.bin (§15.2 "the prototypes.hash handshake"). */
  prototypesHash?: string;
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
  /** (C3) The save's name in storage: the closure log's base (§8.5) until the next save. */
  name?: string;
  /**
   * The whole container header (C3): its name tables give the remap tables when `prototypesHash` is not the
   * build's (§8.3), and its seed and map settings the worldgen pool's `gen_init`. Saves of the real shell
   * always carry it; the fake's saves have none.
   */
  header?: SaveHeader;
}

/** Sequencer control (S14): pause and speed never reach the World. */
export type SeqOp = 'pause' | 'resume' | { speed: number } | { step: number };

/** Dev hooks (§3.5) a worker answers; each reply is a `res` with the same id (`bundle`: a `bundle` message). */
export type DevOp =
  | { op: 'hash' }
  | { op: 'digest' }
  | { op: 'flags'; noSleep: boolean }
  /** (C3) The counting allocator's totals (`sim_allocs`, AllocStats; `ok` false without simcheck). */
  | { op: 'allocs' }
  /** (C3) Linear memory and the pool directory, as UTF-8 JSON. */
  | { op: 'memory' }
  /** (C3) The closure log since the last autosave and the digest ring (§8.5): answered by `bundle`. */
  | { op: 'bundle' }
  /** (C3) Dev builds: the next tick carries `debug_dump(DEV_PANIC_DUMP_ID)`, the dev-only panic (§12 M0 exit). */
  | { op: 'panic' }
  /** (C3) Dev builds: system actions (framed, without seqs) for the next tick, stamped by the sequencer. */
  | { op: 'system'; actions: ArrayBuffer };

/** Where a closure log starts (§8.5): a stored save, or the world's start held in memory (C3). */
export type LogBase =
  | { kind: 'save'; name: string; tick: number }
  /** A new world before its first autosave: `sim_save`'s output at its start (SaveOutput) and its header. */
  | { kind: 'start'; tick: number; save: ArrayBuffer; header: SaveHeader };

/** What reproduces a run natively (§8.5 "Bug bundles"): the closure log since its base, and the digest ring. */
export interface ShellBundle {
  base: LogBase;
  /** The closure log (§8.5) from the base's tick: a `*.pwlog`, with the digests it covers. */
  log: ArrayBuffer;
  /** The digest ring (§4.8 item 6): `u32 first tick, u32 count`, then count × (u32 d low, u32 d high). */
  digests: ArrayBuffer;
}

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
  /**
   * `sections`: the sections as `sim_load` takes them (§15.8: `u32 section_count`, then each in the container's
   * framing with codec 0), as the IO worker decompresses them.
   */
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
  /** `name` (C3): the save's name; autosaves name their own rotating slot. */
  | { t: 'save'; id: number; reason: 'manual' | 'auto' | 'exit' | 'checkpoint'; name?: string }
  | { t: 'dev'; id: number; op: DevOp }
  /** (C3) The page is hidden (07 §19.3): extraction stops while it is; ticks go on if the sequencer runs. */
  | { t: 'hidden'; hidden: boolean }
  /**
   * (C3) Replays a closure log (§8.5) from the world just loaded, which must be its start state: every tick from
   * `start_tick + 1` to `end_tick`, as fast as possible, its digests compared when it has them.
   */
  | { t: 'replay'; gen: StateGen; log: ArrayBuffer };

export type SimToMain =
  | { t: 'ready'; abi: number; schemaHash: string; buildHash: string }
  /** (C3) The handshake refused the module or the build (instead of `ready`): the worker does nothing more. */
  | { t: 'refused'; reason: string; abi: number; schemaHash: string; message: string }
  /** A world is loaded and running (from sim_meta, §15.8); sent again after a replay moved the watermarks. */
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
  /** (C3) A save failed: nothing was stored. */
  | { t: 'saveFailed'; id: number; message: string }
  /**
   * (C3) A world operation failed with a structured error (§3.6, §15.8 status codes): `world` (the world was not
   * bound), `subscribe`, `unsubscribe`, `replay`, `act` … `status` is a SimStatus, or 0 for a shell refusal.
   */
  | { t: 'error'; gen: StateGen; op: string; status: number; message: string }
  /** `bundle` (C3): the closure log up to the trapping tick, for the bug bundle (§3.6 step 3). */
  | { t: 'trap'; gen: StateGen; tick: number; message: string; bundle?: ShellBundle }
  /** (C3) The answer to `dev {op: 'bundle'}`, and after a `debug_dump` system action (11 §5.3). */
  | { t: 'bundle'; gen: StateGen; id: number; tick: number; bundle: ShellBundle }
  /** (C3) A replay ended: every tick ran with matching digests, or the first mismatch. */
  | {
      t: 'replayed';
      gen: StateGen;
      ok: boolean;
      /** The last tick run. */
      tick: number;
      mismatch?: { tick: number; expected: string; actual: string };
      message?: string;
    }
  | { t: 'log'; level: 'info' | 'warn' | 'error'; msg: string; data?: unknown };

/** The packet header's state_gen and view_seq (§15.4): the module leaves them zero, the shell fills them. */
export const PACKET_STATE_GEN_OFFSET = 8;
export const PACKET_VIEW_SEQ_OFFSET = 16;
