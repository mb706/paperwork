// The main thread's side of the simulation (10 §3.1–§3.6; S11, S15): the only allocator of state generations,
// the world-replacement protocol, the worker swap, seqs, the view request and subscriptions it re-sends,
// queries, saves and autosave, the hidden page, trap recovery and bug bundles. The renderer, the UI and audio
// see the simulation only through it (packets, records, events).
//
// A world replacement (§3.4; a new game, a load, a trap recovery, a replay) goes through a fresh sim worker with
// its own worldgen pool and IO port (decision 10):
//   1. the next generation g is allocated, a fresh worker booted (`boot` → `ready`, or `refused`), and sent its
//      world; meanwhile the current generation stays g − 1 (single player has already terminated the old worker,
//      §3.1; multiplayer's background re-sync keeps it playing);
//   2. only the current generation's messages are accepted, plus g's `ready`, `bound` and first packet;
//   3. g's first packet (FULL) switches the generation: the view model is dropped (`events.generation`), the view
//      request and every subscription are re-sent, pending queries of older generations are rejected, audio
//      resets (the consumers do that on `generation`);
//   4. the old worker is terminated.
// Seqs are the main thread's (§3.2): when a world is bound, nextSeq = max(loaded, accepted, pending) + 1; a
// single-player replacement discards pending actions, which were addressed to the old world.
import { type NewWorld, SaveOutputCodec } from '../shared/gen/abi.ts';
import { type SaveHeader, writeSaveContainer } from '../shared/gen/container.ts';
import { PacketFlags, type ViewRequest } from '../shared/gen/packet.ts';
import type { SubRequest } from '../shared/gen/projections.ts';
import type { IoReply } from '../shared/io-protocol.ts';
import type {
  BuildManifest,
  DevOp,
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
  /** The base save as a container (the last save, or the world's start) and its name ('' for a start). */
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
  /** A packet of the current generation; the host acks it when this returns, so copy what you keep (§15.4). */
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
  /** The simulation trapped (§3.6): show the notice with *Send report*; the host is reloading the last save. */
  trap?(t: { gen: StateGen; tick: number; message: string; bundle: BugBundle | null }): void;
}

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
  events?: SimHostEvents;
  /** Test mode (`?test=1`): every world starts paused; `step(n)` drives it (§3.3). */
  test?: boolean;
  /** Multiplayer's background re-sync: the old worker plays on until the new one's first packet (§3.1). */
  background?: boolean;
  /** Reload the trap bundle's save into a fresh worker after a trap (§3.6 step 3). Default on. */
  recover?: boolean;
  /** Autosave (§8.4): every `intervalMs` into `slots` rotating slots; null: off. */
  autosave?: { intervalMs: number } | null;
}

/** A world to start: new, or a save's sections and meta. */
export type WorldSpec =
  | { op: 'new'; settings: NewWorld }
  | { op: 'load'; sections: ArrayBuffer; meta: SaveMeta };

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

interface Session {
  gen: StateGen;
  worker: WorkerLike;
  pool: WorkerLike[];
  ready: Promise<{ abi: number; schemaHash: string }>;
  bound: Promise<BoundInfo>;
  first: Promise<void>;
  settle: {
    ready: (v: { abi: number; schemaHash: string }) => void;
    refused: (e: Error) => void;
    bound: (b: BoundInfo) => void;
    fail: (e: Error) => void;
    first: () => void;
  };
  info: BoundInfo | null;
  live: boolean;
}

/** The console lines a bundle keeps. */
const CONSOLE_LINES = 500;
/** A hidden page autosaves when the last save is older than this (07 §19.3). */
const HIDDEN_AUTOSAVE_MS = 60_000;

export class SimHost {
  private readonly o: SimHostOptions;
  private readonly events: SimHostEvents;
  private nextGen = 0;
  /** The generation shown, and the one being loaded. */
  current: Session | null = null;
  private incoming: Session | null = null;
  private view: ViewRequest | null = null;
  private viewSeq = 0;
  private readonly subs = new Map<number, SubRequest>();
  private nextSub = 1;
  private nextSeq = 1;
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { gen: StateGen; resolve: (m: SimToMain) => void; reject: (e: Error) => void }
  >();
  private readonly saves = new Map<number, { resolve: (m: SimToMain) => void }>();
  readonly console: string[] = [];
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private lastSaveAt = 0;
  private persistAsked = false;
  private pausedByHide = false;
  /** The last bug bundle (§8.5), for `__game.exportBugBundle()` and *Send report*. */
  lastBundle: BugBundle | null = null;
  /** Packets delivered, by generation (tests and the debug overlay). */
  delivered = 0;

  constructor(o: SimHostOptions) {
    this.o = o;
    this.events = o.events ?? {};
  }

  get gen(): StateGen {
    return this.current?.gen ?? 0;
  }

  private note(level: 'info' | 'warn' | 'error', msg: string): void {
    this.console.push(`${level}: ${msg}`);
    if (this.console.length > CONSOLE_LINES) this.console.splice(0, this.console.length - CONSOLE_LINES);
    this.events.log?.(level, msg);
  }

  // -------------------------------------------------------------------------------------------- sessions

  /** A fresh sim worker with its pool and IO port, booted (§3.1, §9.7: the module is posted, not recompiled). */
  private spawn(gen: StateGen): Session {
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
    const settle = {} as Session['settle'];
    const s: Session = {
      gen,
      worker,
      pool,
      ready: new Promise((resolve, reject) => {
        settle.ready = resolve;
        settle.refused = reject;
      }),
      bound: new Promise((resolve, reject) => {
        settle.bound = resolve;
        settle.fail = reject;
      }),
      first: new Promise((resolve) => {
        settle.first = resolve;
      }),
      settle,
      info: null,
      live: true,
    };
    // Unhandled rejections of a session nobody awaits any more are not errors.
    s.ready.catch(() => {});
    s.bound.catch(() => {});
    worker.onmessage = (e: MessageEvent<SimToMain>) => this.receive(s, e.data);
    const transfer: Transferable[] = [...genPorts];
    if (ioPort) transfer.push(ioPort);
    const boot: MainToSim = { t: 'boot', build: this.o.build, module: this.o.sim, ioPort, genPorts };
    worker.postMessage(boot, transfer);
    return s;
  }

  private retire(s: Session): void {
    s.live = false;
    s.worker.onmessage = null;
    s.worker.terminate();
    for (const g of s.pool) {
      g.onmessage = null;
      g.terminate();
    }
  }

  private post(s: Session, m: MainToSim, transfer: Transferable[] = []): void {
    if (s.live) s.worker.postMessage(m, transfer);
  }

  /** Replaces the world (§3.4): resolves when the new generation is shown. */
  async replace(world: WorldSpec): Promise<BoundInfo> {
    this.nextGen = (this.nextGen + 1) >>> 0;
    const gen = this.nextGen;
    const old = this.current;
    if (this.incoming) {
      this.retire(this.incoming);
      this.incoming.settle.fail(new Error('replaced before it was shown'));
    }
    if (old && !this.o.background) this.retire(old);
    const s = this.spawn(gen);
    this.incoming = s;
    try {
      await s.ready;
      if (this.o.test) this.post(s, { t: 'seq', op: 'pause' });
      if (world.op === 'new') this.post(s, { t: 'world', gen, op: 'new', settings: world.settings });
      else
        this.post(s, { t: 'world', gen, op: 'load', sections: world.sections, meta: world.meta }, [
          world.sections,
        ]);
      const b = await s.bound;
      await s.first;
      if (old && this.o.background && old !== this.current) this.retire(old);
      return b;
    } catch (e) {
      if (this.incoming === s) this.incoming = null;
      this.retire(s);
      throw e;
    }
  }

  newGame(settings: NewWorld): Promise<BoundInfo> {
    return this.replace({ op: 'new', settings });
  }

  /** Loads a stored save (the IO worker reads, checks and inflates it). */
  async loadSave(name: string): Promise<BoundInfo> {
    const r = await this.io({ t: 'read', name });
    if (r.t !== 'read') throw new Error(r.t === 'failed' ? r.message : `unexpected ${r.t}`);
    return this.replace({ op: 'load', sections: r.sections, meta: metaOf(r.header, name) });
  }

  /** Loads container bytes that are not stored (an import, a bundle). */
  async loadBytes(container: Uint8Array): Promise<BoundInfo> {
    const buf = container.slice().buffer as ArrayBuffer;
    const r = await this.io({ t: 'unpack', bytes: buf }, [buf]);
    if (r.t !== 'read') throw new Error(r.t === 'failed' ? r.message : `unexpected ${r.t}`);
    return this.replace({ op: 'load', sections: r.sections, meta: metaOf(r.header) });
  }

  private io(req: Parameters<IoClient['request']>[0], transfer: Transferable[] = []): Promise<IoReply> {
    if (!this.o.io) throw new Error('no IO worker');
    return this.o.io.request(req, transfer);
  }

  // --------------------------------------------------------------------------------------------- messages

  private receive(s: Session, m: SimToMain): void {
    const current = s === this.current;
    const incoming = s === this.incoming;
    if (!current && !incoming) {
      // A retired or replaced session: give its buffers back (it may still be alive in a background re-sync).
      if (m.t === 'pkt') this.post(s, { t: 'ack', buf: m.buf }, [m.buf]);
      return;
    }
    switch (m.t) {
      case 'ready':
        s.settle.ready({ abi: m.abi, schemaHash: m.schemaHash });
        return;
      case 'refused':
        this.note(m.reason === 'scaffold' ? 'info' : 'error', `sim worker refused: ${m.message}`);
        s.settle.refused(new RefusedError(m));
        return;
      case 'bound': {
        if (m.gen !== s.gen) return;
        const b: BoundInfo = { gen: m.gen, tick: m.tick, players: m.players };
        const re = s.info !== null;
        s.info = b;
        if (re && current) this.rebindSeqs(b);
        s.settle.bound(b);
        this.events.bound?.(b);
        return;
      }
      case 'pkt': {
        const v = new DataView(m.buf);
        const gen = v.getUint32(8, true);
        if (incoming && gen === s.gen && (v.getUint16(6, true) & PacketFlags.full) !== 0) this.switchTo(s);
        if (s === this.current && gen === s.gen) {
          const len = v.getUint32(24, true);
          this.delivered += 1;
          this.events.packet?.(new Uint8Array(m.buf, 0, len), gen);
        }
        this.post(s, { t: 'ack', buf: m.buf }, [m.buf]);
        return;
      }
      case 'res':
      case 'bundle':
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
        if (current && m.gen === s.gen) this.events.clock?.(m);
        return;
      case 'loadReport':
        if (m.gen === s.gen) this.events.loadReport?.(m.gen, new Uint8Array(m.report));
        return;
      case 'chart':
        if (current && m.gen === s.gen) this.events.chart?.(m.gen, new Uint8Array(m.records));
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
        if (m.op === 'world') s.settle.fail(new WorldError(m));
        this.events.error?.(m);
        return;
      case 'trap': {
        if (m.gen !== s.gen) return;
        const err = new Error(`the world trapped at tick ${m.tick}: ${m.message}`);
        s.settle.fail(err);
        // Requests the trapped world will never answer (a replay that reproduced its trap, queries).
        for (const [id, w] of this.waiting)
          if (w.gen === s.gen) {
            this.waiting.delete(id);
            w.reject(err);
          }
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
    this.events.generation?.(s.gen);
    if (s.info) this.rebindSeqs(s.info, true);
    // The view request and every subscription again: a fresh worker has none (§3.4, §15.5).
    if (this.view) this.post(s, { t: 'view', gen: s.gen, v: { ...this.view, view_seq: ++this.viewSeq } });
    if (this.subs.size > 0) this.post(s, { t: 'sub', gen: s.gen, subs: [...this.subs.values()] });
    s.settle.first();
    if (old && old !== s && !this.o.background) this.retire(old);
  }

  /** §3.2: nextSeq = max(loaded, accepted, pending) + 1; a single-player replacement starts from loaded. */
  private rebindSeqs(b: BoundInfo, replaced = false): void {
    const me = b.players.find((p) => p.index === 0);
    const loaded = me?.lastSeq ?? 0;
    this.nextSeq = replaced ? loaded + 1 : Math.max(this.nextSeq, loaded + 1);
  }

  // ---------------------------------------------------------------------------------------------- inputs

  /** Encoded actions (§15.3: u16 type, u16 len, payload, back to back); returns the first one's seq. */
  act(actions: Uint8Array, blobs?: ArrayBuffer[]): number {
    const s = this.current;
    if (!s) throw new Error('no world');
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
    const s = this.current;
    if (!s) return Promise.reject(new Error('no world'));
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

  /** Sequencer control (§3.3, S14). `step` resolves with the next packet's tick. */
  control(op: SeqOp): void {
    if (this.current) this.post(this.current, { t: 'seq', op });
  }

  /** A dev hook (§3.5): `res`, or `bundle` for `{op: 'bundle'}`. */
  dev(op: DevOp): Promise<SimToMain> {
    const s = this.current;
    if (!s) return Promise.reject(new Error('no world'));
    const id = this.nextId++;
    const p = this.wait(id, s.gen);
    this.post(s, { t: 'dev', id, op });
    return p;
  }

  // ------------------------------------------------------------------------------------------------ saves

  /** A save (§8.4): resolves with `saved` or `saveFailed`. */
  save(reason: 'manual' | 'auto' | 'exit' | 'checkpoint', name?: string): Promise<SimToMain> {
    const s = this.current;
    if (!s) return Promise.reject(new Error('no world'));
    const id = this.nextId++;
    const p = new Promise<SimToMain>((resolve) => this.saves.set(id, { resolve }));
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

  /** Autosave every `intervalMs` (§8.4: 5 minutes, 3 rotating slots by default). */
  startAutosave(intervalMs = 5 * 60_000): void {
    this.stopAutosave();
    this.autosaveTimer = setInterval(() => {
      if (this.current) void this.save('auto');
    }, intervalMs);
  }

  stopAutosave(): void {
    if (this.autosaveTimer !== null) clearInterval(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  /**
   * The page was hidden or shown (07 §19.3): single player pauses when hidden (unless *Keep running in
   * background tab*) and autosaves if the last save is older than a minute; extraction stops while hidden.
   */
  setHidden(hidden: boolean, keepRunning = false): void {
    const s = this.current;
    if (!s) return;
    this.post(s, { t: 'hidden', hidden });
    if (hidden) {
      if (!keepRunning && !this.o.background) {
        this.pausedByHide = true;
        this.control('pause');
      }
      if (Date.now() - this.lastSaveAt > HIDDEN_AUTOSAVE_MS) void this.save('auto');
    } else if (this.pausedByHide) {
      this.pausedByHide = false;
      this.control('resume');
    }
  }

  // -------------------------------------------------------------------------------------- traps, bundles

  private async onTrap(s: Session, m: SimToMain & { t: 'trap' }): Promise<void> {
    this.note('error', `the simulation trapped at tick ${m.tick}: ${m.message}`);
    const bundle = m.bundle ? await this.assemble(m.bundle, { tick: m.tick, message: m.message }) : null;
    this.lastBundle = bundle;
    if (bundle) void this.storeBundle(bundle);
    this.events.trap?.({ gen: s.gen, tick: m.tick, message: m.message, bundle });
    if (this.o.recover === false || !m.bundle) return;
    // §3.6 step 3: the last save (the bundle's base) into a fresh worker.
    try {
      const base = m.bundle.base;
      if (base.kind === 'save') await this.loadSave(base.name);
      else await this.loadStart(base);
    } catch (e) {
      this.note('error', `recovery failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** A world's start (a log base held in memory) as a fresh world. */
  private loadStart(base: LogBase & { kind: 'start' }): Promise<BoundInfo> {
    const out = SaveOutputCodec.decode(new Uint8Array(base.save));
    const sections = startSections(new Uint8Array(base.save));
    return this.replace({
      op: 'load',
      sections,
      meta: metaOf({ ...base.header, lineage: out.r.toString(16).padStart(16, '0') }),
    });
  }

  /** A bundle with its base save as a container (§8.5). */
  private async assemble(b: ShellBundle, trap: { tick: number; message: string } | null): Promise<BugBundle> {
    let save: Uint8Array | null = null;
    let saveName = '';
    if (b.base.kind === 'save') {
      saveName = b.base.name;
      if (this.o.io) {
        const r = await this.io({ t: 'export', name: b.base.name });
        if (r.t === 'exported') save = new Uint8Array(r.bytes);
      }
    } else {
      const out = SaveOutputCodec.decode(new Uint8Array(b.base.save));
      const header: SaveHeader = { ...b.base.header, lineage: out.r.toString(16).padStart(16, '0') };
      save = writeSaveContainer(header, out.sections);
    }
    return {
      build: this.o.build,
      save,
      saveName,
      log: new Uint8Array(b.log),
      digests: new Uint8Array(b.digests),
      trap,
      console: [...this.console],
    };
  }

  /** Keeps a bundle in OPFS (`reports/<time>/`), where the IO worker can (§3.5 `/__report` is the dev server's). */
  private async storeBundle(b: BugBundle): Promise<void> {
    if (!this.o.io) return;
    const files = [
      { name: 'save.save', bytes: (b.save ?? new Uint8Array()).slice().buffer as ArrayBuffer },
      { name: 'closures.pwlog', bytes: b.log.slice().buffer as ArrayBuffer },
      { name: 'digests.bin', bytes: b.digests.slice().buffer as ArrayBuffer },
      {
        name: 'report.json',
        bytes: new TextEncoder().encode(
          JSON.stringify({ build: b.build, trap: b.trap, saveName: b.saveName, console: b.console }),
        ).buffer as ArrayBuffer,
      },
    ];
    const name = new Date().toISOString().replace(/[:.]/g, '-');
    await this.io(
      { t: 'report', name, files },
      files.map((f) => f.bytes),
    );
  }

  /** `__game.exportBugBundle()` (§3.5): the closure log since the last save and that save. */
  async exportBugBundle(): Promise<BugBundle> {
    const m = await this.dev({ op: 'bundle' });
    if (m.t !== 'bundle') throw new Error('no bundle');
    const b = await this.assemble(m.bundle, null);
    this.lastBundle = b;
    return b;
  }

  /** `__game.replay(log)` (§8.5): the log's start save into a fresh worker, then every tick of the log. */
  async replay(
    save: { name: string } | { bytes: Uint8Array },
    log: Uint8Array,
  ): Promise<SimToMain & { t: 'replayed' }> {
    if ('name' in save) await this.loadSave(save.name);
    else await this.loadBytes(save.bytes);
    const s = this.current as Session;
    const p = this.wait(-1, s.gen);
    const buf = log.slice().buffer as ArrayBuffer;
    this.post(s, { t: 'replay', gen: s.gen, log: buf }, [buf]);
    return (await p) as SimToMain & { t: 'replayed' };
  }

  /** Ends everything: the worker, its pool (not the page's IO worker). */
  close(): void {
    this.stopAutosave();
    if (this.incoming) this.retire(this.incoming);
    if (this.current) this.retire(this.current);
    this.current = null;
    this.incoming = null;
  }
}

/** A save's `world load` meta from its header (§3.2). */
export function metaOf(header: SaveHeader, name?: string): SaveMeta {
  const m: SaveMeta = {
    lineage: header.lineage,
    prototypesHash: header.prototypesHash,
    tick: header.tick,
    header,
  };
  if (name) m.name = name;
  return m;
}

/** `sim_load`'s sections region from `sim_save`'s output (the same frames, without the trailing lineage). */
export function startSections(saveOutput: Uint8Array): ArrayBuffer {
  return saveOutput.slice(0, saveOutput.length - 8).buffer as ArrayBuffer;
}
