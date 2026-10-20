// The main thread's side of the simulation (10 §3.1–§3.6; S11, S15): the only allocator of state generations,
// the world-replacement protocol, the worker swap, seqs, the view request and subscriptions it re-sends,
// queries, saves and autosave, pausing, the saves' ownership between tabs, the hidden page, trap recovery and
// bug bundles. The renderer, the UI and audio see the simulation only through it (`on`: packets, generations,
// clock, traps, storage).
//
// A world replacement (§3.4; a new game, a load, a trap recovery, a replay) goes through a fresh sim worker with
// its own worldgen pool and IO port (decision 10):
//   1. the next generation g is allocated, a fresh worker booted (`boot` → `ready`, or `refused`), and sent its
//      world; meanwhile the current generation stays g − 1 (single player has already terminated the old worker,
//      §3.1; a background swap keeps it playing, S11);
//   2. only the current generation's messages are accepted, plus g's `ready`, `bound` and first packet;
//   3. g's first packet (FULL) switches the generation: the view model is dropped (`generation`), the view
//      request and every subscription are re-sent, pending queries of older generations are rejected, audio
//      resets (the consumers do that on `generation`), and the old worker is terminated.
// A replacement that fails at any phase (refused, a world error, a trap before its first packet, superseded,
// closed) rejects, and its worker is terminated with every request still waiting on it (C3-r1 3).
//
// A background swap (multiplayer re-sync, S11) gives the shadow worker the room's closure port and a handover
// tick: the shadow catches up first and sends its first packet only then, so the swap never shows an older
// world than the one it replaces (C3-r1 6).
//
// Seqs are the main thread's (§3.2): when a world is bound, nextSeq = max(loaded, accepted, pending) + 1; a
// single-player replacement discards pending actions, which were addressed to the old world.
import type { NewWorld } from '../shared/gen/abi.ts';
import { SaveOutputCodec } from '../shared/gen/abi.ts';
import { type SaveHeader, writeSaveContainer } from '../shared/gen/container.ts';
import { PacketFlags, type ViewRequest } from '../shared/gen/packet.ts';
import type { SubRequest } from '../shared/gen/projections.ts';
import type { BundleBase, IoReply, SaveInfo, SaveVersion } from '../shared/io-protocol.ts';
import type {
  BuildManifest,
  DevOp,
  Handover,
  LogBase,
  MainToSim,
  SaveMeta,
  SeqOp,
  ShellBundle,
  SimToMain,
  StateGen,
} from '../shared/protocol.ts';
import type { IoClient } from './io-client.ts';

/** What SimHost needs of a worker (a Worker, or an in-process shell behind a MessagePort, `?sim=inline`). */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
}

export interface BoundInfo {
  gen: StateGen;
  tick: number;
  players: { index: number; lastSeq: number; inputGen: number }[];
}

/** A bug bundle (§8.5): what reproduces a run natively (`simtool replay save log`), with what the player saw. */
export interface BugBundle {
  build: BuildManifest;
  /** The base save as a container (the last autosave, or the world's start) and its name ('' for a start). */
  save: Uint8Array | null;
  saveName: string;
  /** The closure log from the save to the trapping (or current) tick, with digests; and the digest ring. */
  log: Uint8Array;
  digests: Uint8Array;
  trap: { tick: number; message: string } | null;
  /** The last console lines of the workers and the shell (§3.2 "Logging"). */
  console: string[];
}

export interface SimHostEvents {
  /**
   * A packet of the current generation, to every listener in turn; the host acks it when they have returned,
   * so copy what you keep (§15.4).
   */
  packet?(bytes: Uint8Array, gen: StateGen): void;
  /** The shown world changed generation (§3.4 step 3): drop the view model, reset audio and latency state. */
  generation?(gen: StateGen): void;
  bound?(b: BoundInfo): void;
  clock?(c: { gen: StateGen; clockGen: number; tick: number; speed: number; paused: boolean }): void;
  loadReport?(gen: StateGen, report: Uint8Array): void;
  chart?(gen: StateGen, records: Uint8Array): void;
  log?(level: 'info' | 'warn' | 'error', msg: string): void;
  /** A structured error of the current world (§3.6): the UI turns it into a notice from 08's strings. */
  error?(e: { gen: StateGen; op: string; status: number; message: string }): void;
  /**
   * The simulation trapped (§3.6): show the notice with *Send report*; the host is reloading the last
   * autosave. `report`: where its bug bundle was kept (OPFS `reports/<report>/`), or null.
   */
  trap?(t: { gen: StateGen; tick: number; message: string; report: string | null }): void;
  /**
   * Whether this tab owns the saves (§8.2 "One tab at a time"): when it does not, saves are refused; a tab that
   * lost them to another is paused (read-only) and the UI shows the notice, or offers *Take over*.
   */
  storage?(s: { owner: boolean; reason?: string }): void;
}
type EventName = keyof SimHostEvents;
type Listener<K extends EventName> = NonNullable<SimHostEvents[K]>;

export interface SimHostOptions {
  build: BuildManifest;
  /** sim.wasm and gen.wasm, compiled once per page (§9.7); null for the fake sim. */
  sim: WebAssembly.Module | null;
  gen?: WebAssembly.Module | null;
  createSim(): WorkerLike;
  createGen?(): WorkerLike;
  /** Worldgen workers per sim worker (2–4, §3.1). */
  genWorkers?: number;
  io?: IoClient | null;
  /** Listeners from the start (more with `on`). */
  events?: SimHostEvents;
  /** Test mode (`?test=1`): every world starts paused; `step(n)` drives it (§3.3). */
  test?: boolean;
  /** Multiplayer: every replacement is a background swap (S11); `replace` can also ask for one. */
  background?: boolean;
  /** Reload the trap bundle's base into a fresh worker after a trap (§3.6 step 3). Default on. */
  recover?: boolean;
}

/** A world to start: new, or a save's sections and meta. */
export type WorldSpec =
  | { op: 'new'; settings: NewWorld }
  | { op: 'load'; sections: ArrayBuffer; meta: SaveMeta };

/** How a replacement runs (S11): a background swap with the room's closure port, handed over once caught up. */
export interface ReplaceOptions {
  background?: boolean;
  closurePort?: MessagePort;
  handover?: Handover;
}

/** Why the world is paused (C3-r1 13): it runs only when no reason holds. */
export type PauseReason = 'user' | 'hidden' | 'menu' | 'storage';

/** A worker refused to run (§15.1 handshake). */
export class RefusedError extends Error {
  readonly reason: string;
  readonly abi: number;
  constructor(m: { reason: string; abi: number; message: string }) {
    super(m.message);
    this.name = 'RefusedError';
    this.reason = m.reason;
    this.abi = m.abi;
  }
}

/** A world operation failed with a structured error (§3.6). */
export class WorldError extends Error {
  readonly status: number;
  readonly op: string;
  constructor(m: { op: string; status: number; message: string }) {
    super(m.message);
    this.name = 'WorldError';
    this.status = m.status;
    this.op = m.op;
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: Error): void;
  settled: boolean;
}

function deferred<T>(): Deferred<T> {
  let res: (v: T) => void = () => {};
  let rej: (e: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    res = resolve;
    rej = reject;
  });
  // A phase nobody awaits any more (a superseded replacement) is not an unhandled rejection.
  promise.catch(() => {});
  const d: Deferred<T> = {
    promise,
    settled: false,
    resolve: (v) => {
      if (d.settled) return;
      d.settled = true;
      res(v);
    },
    reject: (e) => {
      if (d.settled) return;
      d.settled = true;
      rej(e);
    },
  };
  return d;
}

interface Session {
  gen: StateGen;
  worker: WorkerLike;
  pool: WorkerLike[];
  ready: Deferred<{ abi: number; schemaHash: string }>;
  bound: Deferred<BoundInfo>;
  first: Deferred<void>;
  info: BoundInfo | null;
  live: boolean;
  /** The worker answers `seq {step, id}` with `stepped` (the real shell; the fake does not). */
  steps: boolean;
  failure: Error | null;
}

/** A request waiting for its answer from one generation's worker. */
interface Waiter {
  gen: StateGen;
  resolve(m: SimToMain): void;
  reject(e: Error): void;
}

/** The console lines a bundle keeps. */
const CONSOLE_LINES = 500;
/** A hidden page autosaves when the last save is older than this (07 §19.3). */
const HIDDEN_AUTOSAVE_MS = 60_000;
/** The pin holder that keeps a trap's base while the recovery loads it (C3-r1 9). */
const RECOVERY = 'recovery';

const holderOf = (gen: StateGen): string => `gen${gen}`;
const utf8 = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

export class SimHost {
  private readonly o: SimHostOptions;
  private readonly listeners: { [K in EventName]?: Set<Listener<K>> } = {};
  private nextGen = 0;
  /** Bumped by every replacement: an asynchronous recovery that sees it change gives up (C3-r1 2). */
  private replacements = 0;
  /** The generation shown, and the one being loaded. */
  current: Session | null = null;
  private incoming: Session | null = null;
  private view: ViewRequest | null = null;
  private viewSeq = 0;
  private readonly subs = new Map<number, SubRequest>();
  private nextSub = 1;
  private nextSeq = 1;
  private nextId = 1;
  private readonly waiting = new Map<number, Waiter>();
  private readonly saves = new Map<number, Waiter>();
  /** `step(n)` on a worker without `stepped`: the packet at or past the tick the step reaches. */
  private readonly packetSteps: {
    gen: StateGen;
    target: number;
    resolve(t: number): void;
    reject(e: Error): void;
  }[] = [];
  private stepChain: Promise<void> = Promise.resolve();
  private readonly pauses = new Set<PauseReason>();
  readonly console: string[] = [];
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private lastSaveAt = 0;
  private persistAsked = false;
  /** Whether this tab owns the saves (§8.2); null until the IO worker knows (or without one). */
  owner: boolean | null = null;
  /** The last bug bundle (§8.5), for `__game.exportBugBundle()`; the last trap's stored report. */
  lastBundle: BugBundle | null = null;
  lastReport: string | null = null;
  /** Packets delivered (tests and the debug overlay), and the last one's tick. */
  delivered = 0;
  lastTick = 0;

  constructor(o: SimHostOptions) {
    this.o = o;
    for (const [k, f] of Object.entries(o.events ?? {}))
      if (typeof f === 'function') this.on(k as EventName, f as Listener<EventName>);
    if (o.test) this.pauses.add('user');
    if (o.io) {
      this.owner = o.io.owner;
      o.io.onOwner = (owner, reason) => this.ownerChanged(owner, reason);
      o.io.onTakeover = () => void this.handOver();
    }
  }

  get gen(): StateGen {
    return this.current?.gen ?? 0;
  }

  /** Listens to one kind of event; returns how to stop. Packets go to every listener, then back (§15.4). */
  on<K extends EventName>(name: K, f: Listener<K>): () => void {
    let set = this.listeners[name] as Set<Listener<K>> | undefined;
    if (!set) {
      set = new Set();
      (this.listeners as Record<string, Set<unknown>>)[name] = set;
    }
    set.add(f);
    return () => set.delete(f);
  }

  private emit<K extends EventName>(name: K, ...args: Parameters<Listener<K>>): void {
    const set = this.listeners[name] as Set<Listener<K>> | undefined;
    if (!set) return;
    for (const f of set) {
      try {
        (f as (...a: Parameters<Listener<K>>) => void)(...args);
      } catch (e) {
        // A consumer's bug must not stop the others or the host: report it as uncaught.
        queueMicrotask(() => {
          throw e;
        });
      }
    }
  }

  private note(level: 'info' | 'warn' | 'error', msg: string): void {
    this.console.push(`${level}: ${msg}`);
    if (this.console.length > CONSOLE_LINES) this.console.splice(0, this.console.length - CONSOLE_LINES);
    this.emit('log', level, msg);
  }

  // -------------------------------------------------------------------------------------------- sessions

  /** A fresh sim worker with its pool and IO port, booted (§3.1, §9.7: the module is posted, not recompiled). */
  private spawn(gen: StateGen, closurePort: MessagePort | null): Session {
    const worker = this.o.createSim();
    const pool: WorkerLike[] = [];
    const genPorts: MessagePort[] = [];
    const n = this.o.createGen && this.o.gen ? (this.o.genWorkers ?? 2) : 0;
    for (let i = 0; i < n; i++) {
      const g = (this.o.createGen as () => WorkerLike)();
      g.onmessage = (e: MessageEvent<{ t: string; level?: 'info' | 'warn' | 'error'; msg?: string }>) => {
        const m = e.data;
        if (m.t === 'log' && m.level && m.msg) this.note(m.level, m.msg);
      };
      const ch = new MessageChannel();
      g.postMessage({ t: 'boot', build: this.o.build, module: this.o.gen ?? null });
      g.postMessage({ t: 'port', port: ch.port1 }, [ch.port1]);
      genPorts.push(ch.port2);
      pool.push(g);
    }
    let ioPort: MessagePort | null = null;
    if (this.o.io) {
      const ch = new MessageChannel();
      this.o.io.attach(ch.port1);
      ioPort = ch.port2;
    }
    const s: Session = {
      gen,
      worker,
      pool,
      ready: deferred(),
      bound: deferred(),
      first: deferred(),
      info: null,
      live: true,
      steps: false,
      failure: null,
    };
    worker.onmessage = (e: MessageEvent<SimToMain>) => this.receive(s, e.data);
    const transfer: Transferable[] = [...genPorts];
    if (ioPort) transfer.push(ioPort);
    const boot: MainToSim = { t: 'boot', build: this.o.build, module: this.o.sim, ioPort, genPorts };
    if (closurePort) {
      boot.closurePort = closurePort;
      transfer.push(closurePort);
    }
    worker.postMessage(boot, transfer);
    return s;
  }

  /** A session failed: every phase and request still waiting on it rejects (C3-r1 3). */
  private fail(s: Session, err: Error): void {
    s.failure ??= err;
    s.ready.reject(err);
    s.bound.reject(err);
    s.first.reject(err);
    for (const [id, w] of this.waiting)
      if (w.gen === s.gen) {
        this.waiting.delete(id);
        w.reject(err);
      }
    for (const [id, w] of this.saves)
      if (w.gen === s.gen) {
        this.saves.delete(id);
        w.reject(err);
      }
    for (let i = this.packetSteps.length - 1; i >= 0; i--) {
      const w = this.packetSteps[i] as (typeof this.packetSteps)[number];
      if (w.gen === s.gen) {
        this.packetSteps.splice(i, 1);
        w.reject(err);
      }
    }
  }

  /** Ends a session: its worker and pool are terminated, its requests rejected, its pins let go. */
  private retire(s: Session, why: string): void {
    if (!s.live) return;
    this.fail(s, new Error(`generation ${s.gen} ${why}`));
    s.live = false;
    s.worker.onmessage = null;
    s.worker.terminate();
    for (const g of s.pool) {
      g.onmessage = null;
      g.terminate();
    }
    if (this.o.io) void this.o.io.request({ t: 'unpinAll', holder: holderOf(s.gen) });
    if (this.incoming === s) this.incoming = null;
  }

  private post(s: Session, m: MainToSim, transfer: Transferable[] = []): void {
    if (s.live) s.worker.postMessage(m, transfer);
  }

  /** Replaces the world (§3.4): resolves when the new generation is shown; rejects if any phase fails. */
  async replace(world: WorldSpec, opts: ReplaceOptions = {}): Promise<BoundInfo> {
    this.replacements += 1;
    this.nextGen = (this.nextGen + 1) >>> 0;
    const gen = this.nextGen;
    const old = this.current;
    const background = opts.background ?? this.o.background ?? false;
    if (this.incoming) this.retire(this.incoming, 'was replaced before it was shown');
    if (old && !background) this.retire(old, 'was replaced');
    const s = this.spawn(gen, opts.closurePort ?? null);
    this.incoming = s;
    try {
      await s.ready.promise;
      // The pause reasons hold in the new world too (test mode, a paused menu, a hidden page).
      if (this.pauses.size > 0) this.post(s, { t: 'seq', op: 'pause' });
      const handover = opts.handover ? { handover: opts.handover } : {};
      if (world.op === 'new')
        this.post(s, { t: 'world', gen, op: 'new', settings: world.settings, ...handover });
      else
        this.post(
          s,
          { t: 'world', gen, op: 'load', sections: world.sections, meta: world.meta, ...handover },
          [world.sections],
        );
      const b = await s.bound.promise;
      await s.first.promise;
      return b;
    } catch (e) {
      this.retire(s, `failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  newGame(settings: NewWorld, opts?: ReplaceOptions): Promise<BoundInfo> {
    return this.replace({ op: 'new', settings }, opts);
  }

  /** Loads a stored save (the IO worker reads, checks and inflates it); the version read becomes the log's base. */
  async loadSave(name: string): Promise<BoundInfo> {
    const r = await this.io({ t: 'read', name });
    if (r.t !== 'read') throw new Error(r.t === 'failed' ? r.message : `unexpected ${r.t}`);
    return this.replace({
      op: 'load',
      sections: r.sections,
      meta: metaOf(r.header, name, versionOf(r.info)),
    });
  }

  /** Loads container bytes that are not stored (an import, a bundle). */
  async loadBytes(container: Uint8Array): Promise<BoundInfo> {
    const buf = container.slice().buffer as ArrayBuffer;
    const r = await this.io({ t: 'unpack', bytes: buf }, [buf]);
    if (r.t !== 'read') throw new Error(r.t === 'failed' ? r.message : `unexpected ${r.t}`);
    return this.replace({ op: 'load', sections: r.sections, meta: metaOf(r.header) });
  }

  /** Ends the current world (back to the menu): its worker goes; the host stays usable. */
  exit(): void {
    this.replacements += 1;
    if (this.incoming) this.retire(this.incoming, 'was ended (exit)');
    if (this.current) this.retire(this.current, 'was ended (exit)');
    this.current = null;
  }

  private io(req: Parameters<IoClient['request']>[0], transfer: Transferable[] = []): Promise<IoReply> {
    if (!this.o.io) return Promise.reject(new Error('no IO worker'));
    return this.o.io.request(req, transfer);
  }

  // --------------------------------------------------------------------------------------------- messages

  private receive(s: Session, m: SimToMain): void {
    if (!s.live) return;
    const current = s === this.current;
    const incoming = s === this.incoming;
    switch (m.t) {
      case 'ready':
        s.steps = m.steps === true;
        s.ready.resolve({ abi: m.abi, schemaHash: m.schemaHash });
        return;
      case 'refused':
        this.note(m.reason === 'scaffold' ? 'info' : 'error', `sim worker refused: ${m.message}`);
        this.fail(s, new RefusedError(m));
        return;
      case 'bound': {
        if (m.gen !== s.gen) return;
        const b: BoundInfo = { gen: m.gen, tick: m.tick, players: m.players };
        const re = s.info !== null;
        s.info = b;
        if (re && current) this.rebindSeqs(b);
        s.bound.resolve(b);
        this.emit('bound', b);
        return;
      }
      case 'pkt': {
        const v = new DataView(m.buf);
        const gen = v.getUint32(8, true);
        if (incoming && gen === s.gen && (v.getUint16(6, true) & PacketFlags.full) !== 0) this.switchTo(s);
        if (s === this.current && gen === s.gen) {
          const len = v.getUint32(24, true);
          this.delivered += 1;
          this.lastTick = v.getUint32(12, true);
          this.emit('packet', new Uint8Array(m.buf, 0, len), gen);
          for (let i = this.packetSteps.length - 1; i >= 0; i--) {
            const w = this.packetSteps[i] as (typeof this.packetSteps)[number];
            if (w.gen === gen && this.lastTick >= w.target) {
              this.packetSteps.splice(i, 1);
              w.resolve(this.lastTick);
            }
          }
        }
        this.post(s, { t: 'ack', buf: m.buf }, [m.buf]);
        return;
      }
      case 'res':
      case 'bundle':
      case 'stepped':
      case 'replayed': {
        if (m.t === 'replayed' && !current) return;
        const id = m.t === 'replayed' ? -1 : m.id;
        const w = this.waiting.get(id);
        if (w && w.gen === m.gen) {
          this.waiting.delete(id);
          w.resolve(m);
        }
        return;
      }
      case 'clock':
        if (current && m.gen === s.gen) this.emit('clock', m);
        return;
      case 'loadReport':
        if (m.gen === s.gen) this.emit('loadReport', m.gen, new Uint8Array(m.report));
        return;
      case 'chart':
        if (current && m.gen === s.gen) this.emit('chart', m.gen, new Uint8Array(m.records));
        return;
      case 'saved':
      case 'saveFailed': {
        const w = this.saves.get(m.id);
        if (w) {
          this.saves.delete(m.id);
          w.resolve(m);
        }
        return;
      }
      case 'error':
        if (m.gen !== s.gen) return;
        if (m.op === 'world') this.fail(s, new WorldError(m));
        this.emit('error', m);
        return;
      case 'trap': {
        if (m.gen !== s.gen) return;
        this.fail(s, new Error(`the world trapped at tick ${m.tick}: ${m.message}`));
        if (current) void this.onTrap(s, m);
        return;
      }
      case 'log':
        this.note(m.level, m.msg);
        return;
    }
  }

  /** §3.4 step 3: the new generation's first packet. */
  private switchTo(s: Session): void {
    const old = this.current;
    this.current = s;
    this.incoming = null;
    // Queries and dev requests of older generations get no answer: reject them.
    for (const [id, w] of this.waiting)
      if (w.gen !== s.gen) {
        this.waiting.delete(id);
        w.reject(new Error(`generation ${w.gen} was replaced`));
      }
    this.emit('generation', s.gen);
    if (s.info) this.rebindSeqs(s.info, true);
    // The view request and every subscription again: a fresh worker has none (§3.4, §15.5).
    if (this.view) this.post(s, { t: 'view', gen: s.gen, v: { ...this.view, view_seq: ++this.viewSeq } });
    if (this.subs.size > 0) this.post(s, { t: 'sub', gen: s.gen, subs: [...this.subs.values()] });
    s.first.resolve();
    // The world shown before (a background swap kept it playing until now) goes.
    if (old && old !== s) this.retire(old, 'was replaced');
  }

  /** §3.2: nextSeq = max(loaded, accepted, pending) + 1; a single-player replacement starts from loaded. */
  private rebindSeqs(b: BoundInfo, replaced = false): void {
    const me = b.players.find((p) => p.index === 0);
    const loaded = me?.lastSeq ?? 0;
    this.nextSeq = replaced ? loaded + 1 : Math.max(this.nextSeq, loaded + 1);
  }

  private shown(): Session {
    const s = this.current;
    if (!s?.live) throw new Error('no world');
    return s;
  }

  // ---------------------------------------------------------------------------------------------- inputs

  /** Encoded actions (§15.3: u16 type, u16 len, payload, back to back); returns the first one's seq. */
  act(actions: Uint8Array, blobs?: ArrayBuffer[]): number {
    const s = this.shown();
    let n = 0;
    for (let at = 0; at + 4 <= actions.length; n++)
      at += 4 + ((actions[at + 2] as number) | ((actions[at + 3] as number) << 8));
    const firstSeq = this.nextSeq;
    this.nextSeq += n;
    const buf = actions.slice().buffer as ArrayBuffer;
    const m: MainToSim = blobs
      ? { t: 'act', gen: s.gen, firstSeq, actions: buf, blobs }
      : { t: 'act', gen: s.gen, firstSeq, actions: buf };
    this.post(s, m, [buf]);
    return firstSeq;
  }

  /** The camera and overlays (§15.4); the host numbers view requests. */
  setView(v: Omit<ViewRequest, 'view_seq'>): number {
    this.viewSeq += 1;
    this.view = { ...v, view_seq: this.viewSeq };
    if (this.current) this.post(this.current, { t: 'view', gen: this.current.gen, v: this.view });
    return this.viewSeq;
  }

  /** A subscription (§15.5); sub_ids are allocated from 1 and never reused within a generation. */
  subscribe(req: Omit<SubRequest, 'sub_id'>): number {
    const id = this.nextSub++;
    const r = { ...req, sub_id: id } as SubRequest;
    this.subs.set(id, r);
    if (this.current) this.post(this.current, { t: 'sub', gen: this.current.gen, subs: [r] });
    return id;
  }

  /** Replaces subscription `id` (§15.5: sending an existing sub_id replaces it). */
  resubscribe(id: number, req: Omit<SubRequest, 'sub_id'>): void {
    const r = { ...req, sub_id: id } as SubRequest;
    this.subs.set(id, r);
    if (this.current) this.post(this.current, { t: 'sub', gen: this.current.gen, subs: [r] });
  }

  unsubscribe(ids: number[]): void {
    for (const id of ids) this.subs.delete(id);
    if (this.current) this.post(this.current, { t: 'unsub', gen: this.current.gen, ids });
  }

  /** A one-off query (§15.5); rejected if the generation changes first. */
  query(q: Uint8Array): Promise<{ ok: boolean; value: Uint8Array }> {
    let s: Session;
    try {
      s = this.shown();
    } catch (e) {
      return Promise.reject(e);
    }
    const id = this.nextId++;
    const p = this.wait(id, s.gen).then((m) => {
      const r = m as SimToMain & { t: 'res' };
      return { ok: r.ok, value: new Uint8Array(r.value) };
    });
    const buf = q.slice().buffer as ArrayBuffer;
    this.post(s, { t: 'query', gen: s.gen, id, q: buf }, [buf]);
    return p;
  }

  cancel(id: number): void {
    if (this.current) this.post(this.current, { t: 'cancel', gen: this.current.gen, id });
  }

  private wait(id: number, gen: StateGen): Promise<SimToMain> {
    return new Promise((resolve, reject) => this.waiting.set(id, { gen, resolve, reject }));
  }

  // ---------------------------------------------------------------------------------------------- pacing

  /** Sequencer control (§3.3, S14): `pause` and `resume` are the player's pause reason; speed and steps pass. */
  control(op: SeqOp): void {
    if (op === 'pause' || op === 'resume') this.pauseFor('user', op === 'pause');
    else if (this.current) this.post(this.current, { t: 'seq', op });
  }

  /**
   * Sets or clears one reason to pause (C3-r1 13): the world runs only when none holds, so a hidden page that
   * comes back does not resume a game the player (or a menu) paused.
   */
  pauseFor(reason: PauseReason, on: boolean): void {
    const was = this.pauses.size > 0;
    if (on) this.pauses.add(reason);
    else this.pauses.delete(reason);
    const now = this.pauses.size > 0;
    if (was !== now && this.current) this.post(this.current, { t: 'seq', op: now ? 'pause' : 'resume' });
  }

  get paused(): boolean {
    return this.pauses.size > 0;
  }

  /** The menu is open (C5): single player pauses under it. */
  setMenuPause(on: boolean): void {
    this.pauseFor('menu', on);
  }

  /**
   * Test mode's `step(n)` (§3.3): n ticks run now; resolves with the tick after them (C3-r1 12). Steps are
   * serialized and each is answered by its own `stepped`, so concurrent steps never share an answer.
   */
  step(n: number): Promise<number> {
    const run = (): Promise<number> => {
      const s = this.shown();
      const id = this.nextId++;
      if (s.steps) {
        const p = this.wait(id, s.gen);
        this.post(s, { t: 'seq', op: { step: n }, id });
        return p.then((m) => (m as SimToMain & { t: 'stepped' }).tick);
      }
      // A worker without `stepped` (the fake sim): the step's packet, at or past the tick it reaches.
      const target = this.lastTick + n;
      const p = new Promise<number>((resolve, reject) =>
        this.packetSteps.push({ gen: s.gen, target, resolve, reject }),
      );
      this.post(s, { t: 'seq', op: { step: n } });
      return p;
    };
    const next = this.stepChain.then(run, run);
    this.stepChain = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  /** A dev hook (§3.5): `res`, or `bundle` for `{op: 'bundle'}`. */
  dev(op: DevOp): Promise<SimToMain> {
    let s: Session;
    try {
      s = this.shown();
    } catch (e) {
      return Promise.reject(e);
    }
    const id = this.nextId++;
    const p = this.wait(id, s.gen);
    this.post(s, { t: 'dev', id, op });
    return p;
  }

  // ------------------------------------------------------------------------------------------------ saves

  /** A save (§8.4): resolves with `saved` or `saveFailed`; rejects if the world goes first. */
  save(reason: 'manual' | 'auto' | 'exit' | 'checkpoint', name?: string): Promise<SimToMain> {
    let s: Session;
    try {
      s = this.shown();
    } catch (e) {
      return Promise.reject(e);
    }
    const id = this.nextId++;
    const p = new Promise<SimToMain>((resolve, reject) =>
      this.saves.set(id, { gen: s.gen, resolve, reject }),
    );
    this.post(s, name ? { t: 'save', id, reason, name } : { t: 'save', id, reason });
    if (!this.persistAsked) {
      // §8.2: persistent storage is requested at the first save (a main-thread API).
      this.persistAsked = true;
      const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
      if (storage && typeof storage.persist === 'function') storage.persist().catch(() => false);
    }
    return p.then((m) => {
      if (m.t === 'saved') this.lastSaveAt = Date.now();
      return m;
    });
  }

  /** Autosave every `intervalMs` (§8.4: 5 minutes, 3 rotating slots by default); not while another tab owns the saves. */
  startAutosave(intervalMs = 5 * 60_000): void {
    this.stopAutosave();
    this.autosaveTimer = setInterval(() => {
      if (this.current?.live && this.owner !== false) this.save('auto').catch(() => {});
    }, intervalMs);
  }

  stopAutosave(): void {
    if (this.autosaveTimer !== null) clearInterval(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  /** The stored saves, newest first (§8.2). */
  async listSaves(): Promise<SaveInfo[]> {
    const r = await this.io({ t: 'list' });
    return r.t === 'list' ? r.saves : [];
  }

  /** `navigator.storage.estimate()` and persistence, through the IO worker (§8.2: the menu's storage line). */
  async storage(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
    const r = await this.io({ t: 'estimate' }).catch(() => null);
    return r?.t === 'estimate' ? { usage: r.usage, quota: r.quota, persisted: r.persisted } : null;
  }

  /**
   * The page was hidden or shown (07 §19.3): single player pauses when hidden (unless *Keep running in
   * background tab*) and autosaves if the last save is older than a minute; extraction stops while hidden.
   */
  setHidden(hidden: boolean, keepRunning = false): void {
    const s = this.current;
    if (s) this.post(s, { t: 'hidden', hidden });
    if (!keepRunning && !this.o.background) this.pauseFor('hidden', hidden);
    if (hidden && s?.live && this.owner !== false && Date.now() - this.lastSaveAt > HIDDEN_AUTOSAVE_MS)
      this.save('auto').catch(() => {});
  }

  // ------------------------------------------------------------------------------- ownership between tabs

  /** *Take over* (§8.2): the tab that owns the saves saves its game and lets go; `storage` reports the result. */
  takeOver(): void {
    this.o.io?.takeOver();
  }

  private ownerChanged(owner: boolean, reason: string | undefined): void {
    const was = this.owner;
    this.owner = owner;
    // A tab that lost the saves drops to read-only: paused, no autosave (§8.2). One that took them runs again.
    if (was === true && !owner) {
      this.pauseFor('storage', true);
      this.stopAutosave();
    } else if (owner) this.pauseFor('storage', false);
    this.emit('storage', reason === undefined ? { owner } : { owner, reason });
  }

  /** Another tab takes over: this tab's game is saved first (an exit save), then the saves go. */
  private async handOver(): Promise<void> {
    if (this.current?.live) await this.save('exit').catch(() => null);
    this.o.io?.release();
  }

  // -------------------------------------------------------------------------------------- traps, bundles

  /**
   * §3.6: the notice, the bug bundle (kept by the IO worker), and the recovery from the trap's base, the last
   * autosave. Every step after an await checks that no other world started meanwhile (C3-r1 2).
   */
  private async onTrap(s: Session, m: SimToMain & { t: 'trap' }): Promise<void> {
    const token = this.replacements;
    const stale = () => token !== this.replacements || this.current !== s;
    this.note('error', `the simulation trapped at tick ${m.tick}: ${m.message}`);
    const bundle = m.bundle ?? null;
    const base = bundle?.base ?? null;
    // The base version must outlive the trapped worker's pins until the recovered world pins it (C3-r1 9).
    if (base?.kind === 'save' && this.o.io)
      await this.io({ t: 'pin', version: base.version, holder: RECOVERY }).catch(() => null);
    try {
      let report: { name: string | null; start: ArrayBuffer | null } = { name: null, start: null };
      if (bundle) report = await this.keepReport(bundle, { tick: m.tick, message: m.message });
      this.lastReport = report.name;
      if (stale()) return;
      this.emit('trap', { gen: s.gen, tick: m.tick, message: m.message, report: report.name });
      if (this.o.recover === false || !base) return;
      await this.recover(base, report.start, token);
    } catch (e) {
      if (!stale()) this.note('error', `recovery failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (base?.kind === 'save' && this.o.io)
        void this.io({ t: 'unpin', file: base.version.file, holder: RECOVERY }).catch(() => null);
    }
  }

  /** The trap's base into a fresh worker, unless another world started meanwhile. */
  private async recover(base: LogBase, startContainer: ArrayBuffer | null, token: number): Promise<void> {
    if (base.kind === 'save') {
      const v = base.version;
      const r = await this.io({ t: 'read', name: v.name, file: v.file, sha256: v.sha256 });
      if (r.t !== 'read') throw new Error(r.t === 'failed' ? r.message : `unexpected ${r.t}`);
      if (token !== this.replacements) return;
      await this.replace({ op: 'load', sections: r.sections, meta: metaOf(r.header, v.name, v) });
      return;
    }
    if (startContainer) {
      // The IO worker wrote the start as a container for the report: it unpacks it again, off this thread.
      const r = await this.io({ t: 'unpack', bytes: startContainer }, [startContainer]);
      if (r.t !== 'read') throw new Error(r.t === 'failed' ? r.message : `unexpected ${r.t}`);
      if (token !== this.replacements) return;
      await this.replace({ op: 'load', sections: r.sections, meta: metaOf(r.header) });
      return;
    }
    if (token !== this.replacements) return;
    await this.loadStart(base);
  }

  /** A world's start (a log base held in memory) as a fresh world, without an IO worker. */
  private loadStart(base: LogBase & { kind: 'start' }): Promise<BoundInfo> {
    const out = SaveOutputCodec.decode(new Uint8Array(base.save));
    const sections = startSections(new Uint8Array(base.save));
    return this.replace({
      op: 'load',
      sections,
      meta: metaOf({ ...base.header, lineage: out.r.toString(16).padStart(16, '0') }),
    });
  }

  /**
   * Keeps a trap's bundle (`reports/<time>/`): the IO worker assembles it (C3-r1 14). A start base comes back
   * as a container, which the recovery loads.
   */
  private async keepReport(
    b: ShellBundle,
    trap: { tick: number; message: string },
  ): Promise<{ name: string | null; start: ArrayBuffer | null }> {
    if (!this.o.io) {
      this.lastBundle = this.assembleHere(b, trap);
      return { name: null, start: null };
    }
    const name = new Date().toISOString().replace(/[:.]/g, '-');
    const r = await this.bundleInIo(b, trap, name, true, b.base.kind === 'start');
    if (r.t !== 'bundled') {
      this.note('warn', `the bug bundle was not kept: ${r.t === 'failed' ? r.message : r.t}`);
      return { name: null, start: null };
    }
    return { name: r.stored ? name : null, start: r.save };
  }

  private bundleInIo(
    b: ShellBundle,
    trap: { tick: number; message: string } | null,
    name: string,
    store: boolean,
    want: boolean,
  ): Promise<IoReply> {
    const meta = utf8(
      JSON.stringify({
        build: this.o.build,
        trap,
        base: b.base.kind === 'save' ? b.base.version : { start: b.base.tick },
        console: this.console,
      }),
    );
    const base: BundleBase =
      b.base.kind === 'save'
        ? { kind: 'save', version: b.base.version }
        : { kind: 'start', save: b.base.save, header: b.base.header };
    const transfer: Transferable[] = [b.log, b.digests, meta];
    if (b.base.kind === 'start') transfer.push(b.base.save);
    return this.io({ t: 'bundle', name, base, log: b.log, digests: b.digests, meta, store, want }, transfer);
  }

  /** Without an IO worker (tests): the bundle in memory, its start written as a container here. */
  private assembleHere(b: ShellBundle, trap: { tick: number; message: string } | null): BugBundle {
    let save: Uint8Array | null = null;
    if (b.base.kind === 'start') {
      const out = SaveOutputCodec.decode(new Uint8Array(b.base.save));
      const header: SaveHeader = { ...b.base.header, lineage: out.r.toString(16).padStart(16, '0') };
      save = writeSaveContainer(header, out.sections);
    }
    return {
      build: this.o.build,
      save,
      saveName: b.base.kind === 'save' ? b.base.version.name : '',
      log: new Uint8Array(b.log),
      digests: new Uint8Array(b.digests),
      trap,
      console: [...this.console],
    };
  }

  /** `__game.exportBugBundle()` (§3.5): the closure log since the last autosave, and that autosave. */
  async exportBugBundle(): Promise<BugBundle> {
    const m = await this.dev({ op: 'bundle' });
    if (m.t !== 'bundle') throw new Error('no bundle');
    const b = m.bundle;
    const saveName = b.base.kind === 'save' ? b.base.version.name : '';
    if (!this.o.io) {
      this.lastBundle = this.assembleHere(b, null);
      return this.lastBundle;
    }
    const r = await this.bundleInIo(b, null, '', false, true);
    if (r.t !== 'bundled') throw new Error(r.t === 'failed' ? r.message : `unexpected ${r.t}`);
    this.lastBundle = {
      build: this.o.build,
      save: r.save ? new Uint8Array(r.save) : null,
      saveName,
      log: new Uint8Array(r.log ?? new ArrayBuffer(0)),
      digests: new Uint8Array(r.digests ?? new ArrayBuffer(0)),
      trap: null,
      console: [...this.console],
    };
    return this.lastBundle;
  }

  /** `__game.replay(log)` (§8.5): the log's start save into a fresh worker, then every tick of the log. */
  async replay(
    save: { name: string } | { bytes: Uint8Array },
    log: Uint8Array,
  ): Promise<SimToMain & { t: 'replayed' }> {
    if ('name' in save) await this.loadSave(save.name);
    else await this.loadBytes(save.bytes);
    const s = this.shown();
    const p = this.wait(-1, s.gen);
    const buf = log.slice().buffer as ArrayBuffer;
    this.post(s, { t: 'replay', gen: s.gen, log: buf }, [buf]);
    return (await p) as SimToMain & { t: 'replayed' };
  }

  /** Ends everything: the workers and their pools (not the page's IO worker); every waiting request rejects. */
  close(): void {
    this.stopAutosave();
    this.replacements += 1;
    if (this.incoming) this.retire(this.incoming, 'was closed');
    if (this.current) this.retire(this.current, 'was closed');
    this.current = null;
    this.incoming = null;
    const err = new Error('the simulation host was closed');
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
    for (const w of this.saves.values()) w.reject(err);
    this.saves.clear();
    for (const w of this.packetSteps.splice(0)) w.reject(err);
  }
}

/** The exact version a read returned (the base a load starts its closure log from). */
export function versionOf(info: SaveInfo): SaveVersion | undefined {
  return info.file ? { name: info.name, file: info.file, sha256: info.sha256 } : undefined;
}

/** A save's `world load` meta from its header (§3.2). */
export function metaOf(header: SaveHeader, name?: string, version?: SaveVersion): SaveMeta {
  const m: SaveMeta = {
    lineage: header.lineage,
    prototypesHash: header.prototypesHash,
    tick: header.tick,
    header,
  };
  if (name) m.name = name;
  if (version) m.version = version;
  return m;
}

/** `sim_load`'s sections region from `sim_save`'s output (the same frames, without the trailing lineage). */
export function startSections(saveOutput: Uint8Array): ArrayBuffer {
  return saveOutput.slice(0, saveOutput.length - 8).buffer as ArrayBuffer;
}
