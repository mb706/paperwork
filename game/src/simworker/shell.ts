// The sim worker's shell (10 §3.1–§3.6; S2, S3, S7–S11, S14, S15): a TypeScript shell around one instance of
// sim.wasm in one worker, for one world (decision 10). It owns the closure intake (the LocalSequencer in single
// player, a closure port in multiplayer, a closure log in replays), pacing and clock generations, the packet
// pool, subscriptions and queries, checkpoint copies, the closure log and digest ring, and trap handling.
// Everything that decides state happens inside the module; the shell keeps no competing state (§3.6).
//
// The life of a worker: `boot` (the handshake: the build manifest, the module's ABI and schema hash, and
// prototypes.bin's SHA-256 against the manifest's, §15.2) answers `ready` or `refused`; one `world` (new or load)
// answers `loadReport` (loads), `bound`, then an unsolicited FULL packet (§3.4 step 2), and starts the clock;
// ticks run on the clock (or `seq step` in test mode), each extracting at most once per wake; a trap ends it
// (`trap`, with the closure log up to the trapping tick). The main thread then terminates it and, for a new
// world, a load or a trap recovery, starts a fresh worker (§3.4).
//
// The tick path allocates nothing (A1 open issue 7): closures are written straight into the module's input
// buffer, digests and packet headers are read through the lease, packets are copied into pooled buffers, and
// the messages it posts are reused objects.

import {
  InitInputCodec,
  NewWorldCodec,
  PendingChunksCodec,
  RemapTableCodec,
  SaveInputCodec,
  SimError,
  SimMetaCodec,
  SubscribeInputCodec,
  UnsubscribeInputCodec,
} from '../shared/gen/abi.ts';
import { ActionType, actionBytes, SYSTEM_TYPE_MIN } from '../shared/gen/actions.ts';
import { Writer } from '../shared/gen/codec.ts';
import { type ClosureLog, parseClosureLog, type SaveHeader } from '../shared/gen/container.ts';
import { chunkXY, PacketSection, ViewFlags, ViewRequestCodec } from '../shared/gen/packet.ts';
import { StateHashCodec } from '../shared/gen/projections.ts';
import { readPrototypesBin } from '../shared/gen/protos.ts';
import { PROTOCOL_VERSION, SCHEMA_HASH } from '../shared/gen/schema.ts';
import { SimFlags } from '../shared/gen/types.ts';
import type { IoReply, IoRequest } from '../shared/io-protocol.ts';
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
import { Clock, MAX_TICKS_PER_WAKE, REBASE_BACKLOG, SHORT_WAIT_MS, TIMER_LEAD_MS } from './clock.ts';
import { ClosureLogRecorder } from './closurelog.ts';
import { DEV_PANIC_DUMP_ID } from './dev.ts';
import { DigestRing } from './digests.ts';
import { HandshakeError, instantiateSim, type SimHooks, type SimInstance, TrapError } from './module.ts';
import { fillPacket, PacketPool } from './packets.ts';
import { QUERY_BUDGET_MS, type QueryResultOut, QueryScheduler } from './queries.ts';
import { type NameTables, remapTables } from './remap.ts';
import { PortRpc } from './rpc.ts';
import { newWorldOf, saveHeader, type WorldInfo, worldFromHeader, worldFromNew } from './saves.ts';
import { type ClosureSource, LocalSequencer, PortSource, ReplaySource } from './sequencer.ts';
import { GenPool } from './worldgen.ts';

/** What the shell needs from its thread (the worker, or a test's harness). */
export interface ShellHost {
  /** Posts a message. The shell may reuse a message object after `post` returns: copy it if you keep it. */
  post(msg: SimToMain, transfer?: Transferable[]): void;
  /** Milliseconds, for pacing (the worker shells may read the clock, §2.5). */
  now(): number;
  /** Schedules `f` after `ms` (0: a self-posted message, which avoids the 4 ms timer clamp, §3.3). */
  wake(ms: number, f: () => void): unknown;
  cancel(handle: unknown): void;
  /** This build's prototypes.bin (the worker fetches it, §15.2). */
  protos(): Promise<Uint8Array>;
  /** SHA-256 (WebCrypto). */
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
  /** Instantiates sim.wasm and runs the handshake; tests substitute the reference model. */
  instantiate?(module: WebAssembly.Module | null, hooks: SimHooks, dev: boolean): Promise<SimInstance>;
}

/** The local player of single player. */
export const LOCAL_PLAYER = 0;
/** Catch-up (§3.3, 11 §3.6): slices of at most this many milliseconds, extraction off, events historical. */
export const CATCHUP_SLICE_MS = 12;
/** A port's backlog beyond this enters catch-up, at or below CATCHUP_LEAVE leaves it (11 §3.6, D at its minimum). */
export const CATCHUP_ENTER = 30;
export const CATCHUP_LEAVE = 2;
/** After a view, sub or unsub, a paused world extracts within this (§3.3 "Extraction without ticks"). */
export const EXTRACT_SOON_MS = 16;
/** While no tick runs, queries are stepped this often. */
export const QUERY_TIMER_MS = 4;
/** Autosave slots when the main thread names none (§8.4). */
export const AUTOSAVE_SLOTS = 3;

const hex = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += (x < 16 ? '0' : '') + x.toString(16);
  return s;
};
const hex16 = (v: bigint): string => v.toString(16).padStart(16, '0');
const ZERO_VIEW = new Uint8Array(ViewRequestCodec.SIZE);
const EMPTY = new ArrayBuffer(0);
const utf8 = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

/** A closure the module refused at the preflight: a sequencer, codec or shell bug, treated like a trap (§15.3). */
class PreflightFailure extends Error {}

type Mode = 'local' | 'replay' | 'port';

export class SimShell {
  private readonly host: ShellHost;
  private build: BuildManifest | null = null;
  private dev = false;
  private booted = false;
  private sim: SimInstance | null = null;
  private protos: Uint8Array | null = null;
  private protosHash = '';
  private names: NameTables | null = null;
  private io: PortRpc<IoRequest, IoReply> | null = null;
  private pool: GenPool | null = null;
  private closurePort: MessagePort | null = null;

  private gen: StateGen = 0;
  private worldStarted = false;
  private bound = false;
  /** The world's tick: the last tick the module ran. */
  tick = 0;
  private world: WorldInfo | null = null;
  private mode: Mode = 'local';
  readonly seq = new LocalSequencer();
  private source: ClosureSource = this.seq;
  private replaying: ReplaySource | null = null;
  /** The first tick whose digest differs from the replayed log's (§8.5), when one does. */
  private mismatch: { tick: number; lo: number; hi: number; aLo: number; aHi: number } | null = null;
  private port: PortSource | null = null;
  private readonly clock = new Clock();
  private readonly packets = new PacketPool();
  readonly digests = new DigestRing();
  readonly log = new ClosureLogRecorder();
  private readonly queries = new QueryScheduler();
  private readonly view = new Uint8Array(ViewRequestCodec.SIZE);
  private viewSeq = 0;
  private viewChart = false;
  private flags = 0;
  private hidden = false;
  private catchingUp = false;
  /** A view, sub or unsub arrived: extract within EXTRACT_SOON_MS even without ticks. */
  private extractWanted = false;
  /** An extraction was skipped for want of a buffer: extract when one comes back. */
  private extractPending = false;
  private timer: unknown = null;
  private timerAt = Number.POSITIVE_INFINITY;
  /** Why the shell stopped (a trap): it never calls the module again. */
  stopped: string | null = null;
  /** The main thread has sent actions to this world (a replay needs none). */
  private acted = false;
  /** Blob verifications in flight: later `act`s wait behind them, so each player's order is kept. */
  private intake: Promise<void> = Promise.resolve();
  private intakeBusy = 0;
  // Tick-path scratch: the system actions a closure carried, handled after the tick.
  private readonly sysTypes = new Uint32Array(16);
  private readonly sysArgs = new Uint32Array(16);
  private sysCount = 0;
  // Reused messages (the host clones on post).
  private readonly pktMsg: { t: 'pkt'; buf: ArrayBuffer } = { t: 'pkt', buf: EMPTY };
  private readonly pktTransfer: Transferable[] = [EMPTY];
  private readonly wakeFn = (): void => this.wake();
  private readonly hooks: SimHooks;
  private readonly queryDone = (r: QueryResultOut): void => {
    this.host.post({ t: 'res', gen: this.gen, id: r.id, ok: r.ok, value: r.value }, [r.value]);
  };

  constructor(host: ShellHost) {
    this.host = host;
    this.hooks = {
      log: (level, msg) => this.host.post({ t: 'log', level, msg }),
      now: () => this.host.now(),
    };
  }

  private logLine(level: 'info' | 'warn' | 'error', msg: string): void {
    this.host.post({ t: 'log', level, msg: `sim worker: ${msg}` });
  }

  private postError(op: string, status: number, message: string): void {
    this.host.post({ t: 'error', gen: this.gen, op, status, message });
    this.logLine('error', `${op}: ${message}`);
  }

  /** The state generation of the bound world (0 before one). */
  get stateGen(): StateGen {
    return this.gen;
  }

  get clockState(): { gen: number; paused: boolean; speed: number } {
    return { gen: this.clock.gen, paused: this.clock.paused, speed: this.clock.speed };
  }

  /** The module, for tests (null before boot or after a refusal). */
  get instance(): SimInstance | null {
    return this.sim;
  }

  /** The highest tick whose closure the shell holds (§3.3): unbounded for the LocalSequencer. */
  get horizon(): number {
    return this.source.horizon();
  }

  /** Handles one message from the main thread (§3.2). */
  async handle(m: MainToSim): Promise<void> {
    try {
      switch (m.t) {
        case 'boot':
          return await this.boot(m);
        case 'world':
          return await this.startWorld(m);
        case 'act':
          return this.act(m);
        case 'seq':
          return this.control(m.op);
        case 'view':
          if (m.gen !== this.gen || !this.bound) return;
          this.view.set(ViewRequestCodec.encode(m.v));
          this.viewSeq = m.v.view_seq >>> 0;
          this.viewChart = (m.v.flags & ViewFlags.chart) !== 0;
          return this.wantExtraction();
        case 'sub':
          if (m.gen !== this.gen || !this.sim || !this.bound || this.stopped) return;
          try {
            const input = SubscribeInputCodec.encode({ subs: m.subs });
            this.sim.cold((s) => s.subscribe(input));
          } catch (e) {
            if (e instanceof TrapError) throw e;
            this.postError('subscribe', e instanceof SimError ? e.status : 0, String(e));
          }
          return this.wantExtraction();
        case 'unsub':
          if (m.gen !== this.gen || !this.sim || !this.bound || this.stopped) return;
          try {
            const input = UnsubscribeInputCodec.encode({ ids: m.ids });
            this.sim.cold((s) => s.unsubscribe(input));
          } catch (e) {
            if (e instanceof TrapError) throw e;
            this.postError('unsubscribe', e instanceof SimError ? e.status : 0, String(e));
          }
          return this.wantExtraction();
        case 'query':
          if (m.gen !== this.gen || !this.sim || !this.bound || this.stopped) return;
          this.queries.submit(this.sim, m.id, new Uint8Array(m.q), this.queryDone);
          return this.soon(0);
        case 'cancel':
          if (m.gen !== this.gen || !this.sim || !this.bound || this.stopped) return;
          this.queries.cancel(this.sim, m.id);
          return;
        case 'ack':
          this.packets.release(m.buf);
          if (this.extractPending) {
            this.extractPending = false;
            this.wantExtraction();
          }
          return;
        case 'save':
          return await this.save(m.id, m.reason, m.name ?? null);
        case 'dev':
          return this.devOp(m.id, m.op);
        case 'hidden':
          this.hidden = m.hidden;
          if (!m.hidden) this.wantExtraction();
          return;
        case 'replay':
          if (m.gen !== this.gen) return;
          return await this.startReplay(new Uint8Array(m.log));
      }
    } catch (e) {
      this.stop(e);
    }
  }

  // ------------------------------------------------------------------------------------------------ boot

  private refuse(reason: string, abi: number, schemaHash: string, message: string): void {
    this.host.post({ t: 'refused', reason, abi, schemaHash, message });
    // The scaffold module is expected until the sim package's module lands: say so quietly.
    this.logLine(reason === 'scaffold' ? 'info' : 'error', `refused: ${message}`);
  }

  private async boot(m: MainToSim & { t: 'boot' }): Promise<void> {
    if (this.booted) {
      this.logLine('error', 'boot twice: one boot per worker');
      return;
    }
    this.booted = true;
    this.build = m.build;
    this.dev = m.build.dev === true;
    if (m.build.schemaHash !== undefined && m.build.schemaHash !== SCHEMA_HASH)
      return this.refuse(
        'build',
        -1,
        '',
        `the build manifest is for schema ${m.build.schemaHash}, this worker's is ${SCHEMA_HASH}`,
      );
    if (m.build.protocolVersion !== undefined && m.build.protocolVersion !== PROTOCOL_VERSION)
      return this.refuse(
        'build',
        -1,
        '',
        `the build manifest has protocol ${m.build.protocolVersion}, this worker's is ${PROTOCOL_VERSION}`,
      );
    let sim: SimInstance;
    try {
      const make = this.host.instantiate;
      if (make) sim = await make(m.module, this.hooks, this.dev);
      else if (m.module) sim = await instantiateSim(m.module, this.hooks, this.dev);
      else return this.refuse('instantiate', -1, '', 'no sim.wasm module in boot');
    } catch (e) {
      if (e instanceof HandshakeError) return this.refuse(e.reason, e.abi, e.schemaHash, e.message);
      throw e;
    }
    // §15.2 "the prototypes.hash handshake", step 2: a prototypes.bin other than the build's is a stale cache.
    const protos = await this.host.protos();
    const hash = hex(await this.host.sha256(protos));
    if (typeof m.build.prototypesHash === 'string' && m.build.prototypesHash !== hash)
      return this.refuse(
        'protos',
        -1,
        SCHEMA_HASH,
        `prototypes.bin (${hash}) is not the build's (${m.build.prototypesHash}): a stale cache; reload`,
      );
    let names: NameTables;
    try {
      const want = new Uint8Array(32);
      for (let i = 0; i < 32; i++) want[i] = Number.parseInt(SCHEMA_HASH.slice(2 * i, 2 * i + 2), 16);
      names = readPrototypesBin(protos, want).names;
      const bytes = InitInputCodec.encode({ protos, flags: 0 });
      sim.cold((s) => s.init(bytes));
    } catch (e) {
      if (e instanceof TrapError) throw e;
      return this.refuse('protos', -1, SCHEMA_HASH, `prototypes.bin refused: ${String(e)}`);
    }
    this.sim = sim;
    this.protos = protos;
    this.protosHash = hash;
    this.names = names;
    if (m.ioPort) this.io = new PortRpc<IoRequest, IoReply>(m.ioPort);
    if (m.genPorts.length > 0)
      this.pool = new GenPool(m.genPorts, {
        supply: (data, commit) => this.supplyChunk(data, commit),
        chart: (data) => this.host.post({ t: 'chart', gen: this.gen, records: data }, [data]),
        log: (level, msg) => this.logLine(level, msg),
      });
    if (m.closurePort) {
      this.closurePort = m.closurePort;
      m.closurePort.onmessage = (e: MessageEvent) => this.closures(e.data);
    }
    this.host.post({
      t: 'ready',
      abi: sim.cold((s) => s.abiVersion()),
      schemaHash: SCHEMA_HASH,
      buildHash: m.build.buildHash,
    });
  }

  // ----------------------------------------------------------------------------------------------- world

  private async startWorld(m: MainToSim & { t: 'world' }): Promise<void> {
    const sim = this.sim;
    if (!sim || !this.names || !this.build || !this.protos) {
      this.gen = m.gen;
      return this.postError('world', 0, 'no module: boot was refused or has not run');
    }
    if (this.worldStarted) {
      this.logLine('error', 'a second world: one world per worker (decision 10)');
      return;
    }
    this.worldStarted = true;
    this.gen = m.gen;
    let genWorld: Uint8Array | null = null;
    let base: LogBase;
    try {
      if (m.op === 'new') {
        const rec = NewWorldCodec.encode(m.settings);
        sim.cold((s) => s.newWorld(rec));
        this.world = worldFromNew(m.settings);
        genWorld = rec;
      } else {
        const header = m.meta.header ?? null;
        this.loadSections(sim, new Uint8Array(m.sections), m.meta);
        const report = sim.cold((s) => s.loadReport());
        const rb = report.slice().buffer;
        this.host.post({ t: 'loadReport', gen: this.gen, report: rb }, [rb]);
        if (header) {
          this.world = worldFromHeader(header);
          genWorld = NewWorldCodec.encode(newWorldOf(this.world));
        }
      }
    } catch (e) {
      if (e instanceof TrapError) throw e;
      return this.postError(
        'world',
        e instanceof SimError ? e.status : 0,
        String(e instanceof Error ? e.message : e),
      );
    }
    const meta = this.bind();
    if (!this.world) {
      // A load without a header (the fake's saves have none): the settings stay unknown to the header.
      this.world = worldFromNew({ ...NewWorldCodec.defaults(), seed: meta.seed }, meta.tick);
    }
    // §3.3: single player's LocalSequencer issues player_joined(0) in a new world's first tick; after a load,
    // when the local player is not online. In multiplayer the relay does.
    if (!this.closurePort) {
      const me = meta.players.find((p) => p.index === LOCAL_PLAYER);
      if (!me?.online) {
        const a = actionBytes({ type: 'player_joined', player: LOCAL_PLAYER, flags: me ? 1 : 0 });
        this.seq.system(ActionType.player_joined, a.subarray(4));
      }
    }
    // The closure log's base: the loaded save, or the world's start (§8.5).
    if (m.op === 'load' && m.meta.name) base = { kind: 'save', name: m.meta.name, tick: this.tick };
    else base = this.startBase(sim, m.op === 'load' ? (m.meta.header ?? null) : null);
    this.log.start(base, this.tick, this.stateHash(sim));
    if (this.pool && genWorld) this.pool.init(this.gen, this.protos, genWorld);
    this.pendingChunks(sim);
    // §3.4 step 2: the new world's first packet goes out unsolicited, FULL, even while paused.
    this.extract(true);
    if (this.closurePort) {
      this.mode = 'port';
      this.port = new PortSource(this.tick);
      this.source = this.port;
    }
    this.restartClock();
  }

  /** `sim_load`'s input written straight into the module: the sections, the remap tables, the lineage. */
  private loadSections(sim: SimInstance, sections: Uint8Array, meta: SaveMeta): void {
    let tables: ReturnType<typeof remapTables> = [];
    if (meta.prototypesHash !== this.protosHash) {
      if (!meta.header) throw new Error('a save of other prototypes without name tables cannot be remapped');
      tables = remapTables(meta.header.nameTables, this.names as NameTables);
    }
    const tail = new Writer();
    tail.u16(tables.length, 'LoadInput.kind_count');
    for (const t of tables) RemapTableCodec.write(tail, t);
    tail.u64(BigInt(`0x${meta.lineage}`), 'LoadInput.r');
    const rest = tail.finish();
    const len = sections.length + rest.length;
    const p = sim.input(len);
    sim.lease.u8.set(sections, p);
    sim.lease.u8.set(rest, p + sections.length);
    sim.load(len);
  }

  /** The world's start as the log's base: `sim_save` now, with its header (§8.5, §8.6). */
  private startBase(sim: SimInstance, loaded: SaveHeader | null): LogBase {
    const out = sim.cold((s) => s.save(SaveInputCodec.encode({ flags: 0 })));
    const r = new DataView(out.buffer, out.byteOffset, out.byteLength).getBigUint64(out.length - 8, true);
    const header = loaded ?? this.header(this.tick, r);
    return { kind: 'start', tick: this.tick, save: out.slice().buffer, header };
  }

  private header(tick: number, r: bigint): SaveHeader {
    return saveHeader(
      this.world as WorldInfo,
      this.build as BuildManifest,
      this.protosHash,
      this.names as NameTables,
      tick,
      r,
      new Date().toISOString(),
    );
  }

  private stateHash(sim: SimInstance): bigint {
    return StateHashCodec.decode(sim.cold((s) => s.stateHash())).hash;
  }

  /** `sim_meta` → `bound` (§3.2), and the sequencer's watermarks. */
  private bind(post = true): ReturnType<typeof SimMetaCodec.decode> {
    const sim = this.sim as SimInstance;
    const meta = SimMetaCodec.decode(
      sim.cold((s) => s.meta()),
      true,
    );
    this.tick = meta.tick;
    const players = meta.players.map((p) => ({ index: p.index, lastSeq: p.last_seq, inputGen: p.input_gen }));
    this.seq.bind({ tick: meta.tick, lastSystemSeq: meta.last_system_seq, players });
    this.bound = true;
    if (post) this.host.post({ t: 'bound', gen: this.gen, tick: meta.tick, players });
    return meta;
  }

  // ------------------------------------------------------------------------------------------------ input

  private act(m: MainToSim & { t: 'act' }): void {
    if (m.gen !== this.gen || !this.bound || this.stopped) return;
    if (this.mode !== 'local') {
      this.postError('act', 0, `actions go to the ${this.mode === 'port' ? "room's" : 'replay'} sequencer`);
      return;
    }
    const actions = new Uint8Array(m.actions);
    if (!m.blobs?.length && this.intakeBusy === 0) {
      this.submit(m.firstSeq, actions, null);
      return;
    }
    // Blobs are verified first (§15.3 "Blobs"); acts behind them wait, so the order is kept.
    this.intakeBusy += 1;
    this.intake = this.intake.then(async () => {
      try {
        const blobs = new Map<string, Uint8Array>();
        for (const b of m.blobs ?? []) {
          const u = new Uint8Array(b);
          if (u.length < 32) throw new Error('a blob shorter than its hash');
          const h = hex(u.subarray(0, 32));
          if (hex(await this.host.sha256(u.subarray(32))) !== h)
            throw new Error(`blob ${h} does not hash to its name`);
          blobs.set(h, u.subarray(32));
        }
        if (m.gen === this.gen && !this.stopped) this.submit(m.firstSeq, actions, blobs);
      } catch (e) {
        this.postError('act', 0, String(e instanceof Error ? e.message : e));
      } finally {
        this.intakeBusy -= 1;
      }
    });
  }

  private submit(firstSeq: number, actions: Uint8Array, blobs: ReadonlyMap<string, Uint8Array> | null): void {
    this.acted = true;
    const err = this.seq.submit(LOCAL_PLAYER, firstSeq, actions, blobs);
    if (err) this.postError('act', 0, err);
    for (const p of this.seq.problems.splice(0)) this.logLine('warn', p);
  }

  // ---------------------------------------------------------------------------------------------- pacing

  /** Sequencer control (§3.3, S14). Multiplayer's clock is the relay's: there, only `step` is refused too. */
  private control(op: SeqOp): void {
    if (this.mode === 'port') {
      this.logLine('warn', 'the room paces the game: sequencer control ignored');
      return;
    }
    if (op === 'pause') this.clock.paused = true;
    else if (op === 'resume') this.clock.paused = false;
    else if ('speed' in op) this.clock.speed = op.speed > 0 ? op.speed : 1;
    else if ('step' in op) {
      // Test mode (§3.3): close n ticks, run them now, then emit one packet.
      if (!this.bound || this.stopped || this.mode !== 'local') return;
      try {
        for (let i = 0; i < op.step; i++) this.runTick();
        this.extract(false, true);
      } catch (e) {
        this.stop(e);
        return;
      }
      if (this.clock.paused) return;
    }
    this.restartClock();
  }

  /** A new clock generation (§3.3): pause, resume, speed and rebase each start one. */
  private restartClock(): void {
    this.clock.restart(this.host.now(), this.tick);
    if (!this.bound) return;
    this.host.post({
      t: 'clock',
      gen: this.gen,
      clockGen: this.clock.gen,
      tick: this.tick,
      speed: this.clock.speed,
      paused: this.clock.paused,
    });
    this.reschedule();
  }

  private wantExtraction(): void {
    this.extractWanted = true;
    this.soon(EXTRACT_SOON_MS);
  }

  /** Makes sure a wake comes within `ms`. */
  private soon(ms: number): void {
    if (!this.bound || this.stopped) return;
    const at = this.host.now() + ms;
    if (this.timer !== null && this.timerAt <= at) return;
    this.setTimer(at);
  }

  private setTimer(at: number): void {
    if (this.timer !== null) this.host.cancel(this.timer);
    const ms = at - this.host.now() - TIMER_LEAD_MS;
    this.timerAt = at;
    this.timer = this.host.wake(ms > SHORT_WAIT_MS ? ms : 0, this.wakeFn);
  }

  /** The next wake: the next due tick, more catch-up, an extraction or the query timer. */
  private reschedule(): void {
    if (this.timer !== null) {
      this.host.cancel(this.timer);
      this.timer = null;
      this.timerAt = Number.POSITIVE_INFINITY;
    }
    if (!this.bound || this.stopped) return;
    const now = this.host.now();
    let at = Number.POSITIVE_INFINITY;
    if (this.mode === 'local') {
      if (!this.clock.paused) at = this.clock.nextAt(this.tick);
    } else if (this.source.horizon() > this.tick) at = now;
    if (this.extractWanted) at = Math.min(at, now);
    if (this.queries.pending > 0) at = Math.min(at, now + QUERY_TIMER_MS);
    if (at !== Number.POSITIVE_INFINITY) this.setTimer(at);
  }

  /** A wake (§3.3): the due ticks (at most 3; a backlog over 6 rebases), one extraction, then queries. */
  private wake(): void {
    this.timer = null;
    this.timerAt = Number.POSITIVE_INFINITY;
    if (!this.bound || this.stopped) return;
    const start = this.host.now();
    let ran = 0;
    try {
      if (this.mode === 'local') {
        if (!this.clock.paused) {
          const due = this.clock.due(start, this.tick);
          if (due > REBASE_BACKLOG) {
            // Game time slows instead of a spiral of death: the backlog is dropped in a new clock generation.
            this.restartClock();
            return;
          }
          const n = due > MAX_TICKS_PER_WAKE ? MAX_TICKS_PER_WAKE : due;
          for (; ran < n; ran++) this.runTick();
        }
      } else ran = this.runAvailable(start);
      const r = this.replaying;
      if (this.mode === 'replay' && r && (this.mismatch !== null || this.tick >= r.horizon())) {
        this.finishReplay(this.mismatch);
        this.mismatch = null;
      } else if (ran > 0 || this.extractWanted) this.extract();
      if (this.sim && this.queries.busy) {
        const left = QUERY_BUDGET_MS - (this.host.now() - start);
        if (left > 0 || ran === 0)
          this.queries.step(this.sim, left > 0 ? left : QUERY_BUDGET_MS, this.hooks.now, this.queryDone);
      }
    } catch (e) {
      this.stop(e);
      return;
    }
    this.reschedule();
  }

  /** Replays and the closure port: catch-up in slices (§3.3, 11 §3.6), else at most 3 ticks per wake. */
  private runAvailable(start: number): number {
    let ran = 0;
    const horizon = this.source.horizon();
    if (this.mode === 'port' && !this.catchingUp && horizon - this.tick > CATCHUP_ENTER)
      this.setCatchUp(true);
    if (this.mode === 'replay' || this.catchingUp) {
      while (this.tick < horizon && this.host.now() - start < CATCHUP_SLICE_MS && !this.stopped) {
        ran += 1;
        if (!this.runTick()) break;
      }
      if (this.mode === 'port' && horizon - this.tick <= CATCHUP_LEAVE) this.setCatchUp(false);
    } else {
      while (this.tick < horizon && ran < MAX_TICKS_PER_WAKE) {
        this.runTick();
        ran += 1;
      }
    }
    return ran;
  }

  /** Catch-up runs with extraction off and events historical (§3.3, §15.6, D15). */
  private setCatchUp(on: boolean): void {
    this.catchingUp = on;
    this.setFlag(SimFlags.historical, on);
  }

  private setFlag(bit: number, on: boolean): void {
    const f = on ? this.flags | bit : this.flags & ~bit;
    if (f === this.flags || !this.sim) return;
    this.flags = f;
    this.sim.setFlags(f);
  }

  // ------------------------------------------------------------------------------------------------- ticks

  /**
   * Runs the next tick: its blobs, its closure written into the input buffer and recorded, `sim_tick`, the
   * digest into the ring, the chunk requests to the pool, and the system actions' side effects. Returns false
   * when a replay found a digest that differs from the log's (the replay stops there).
   */
  private runTick(): boolean {
    const sim = this.sim as SimInstance;
    const src = this.source;
    const t = this.tick + 1;
    const blobs = src.blobs(t);
    if (blobs !== null)
      for (const b of blobs) {
        sim.cold((s) => s.blobPut(b));
        this.log.recordBlob(t, b);
      }
    const len = src.length(t);
    const p = sim.input(len);
    let lease = sim.lease;
    src.write(t, lease.u8, lease.dv, p);
    this.log.record(t, lease.u8, p, len);
    this.sysCount = 0;
    if (len > 0) this.scanSystem(lease.u8, p, len);
    const status = sim.tick(len);
    if (status !== 0) {
      const e = sim.lastError();
      throw new PreflightFailure(`tick ${t}: the module refused the closure at the preflight (${e.message})`);
    }
    this.tick = t;
    src.done(t);
    sim.digest();
    const d = sim.digestOut;
    this.digests.push(t, d[1] as number, d[2] as number);
    const pc = sim.pendingChunks();
    lease = sim.lease;
    if (lease.dv.getUint32(pc, true) > 0)
      this.requestChunks(lease.u8.slice(pc + 4, pc + 4 + lease.dv.getUint32(pc, true)));
    if (this.pool) this.pool.forget(t);
    if (this.sysCount > 0) this.afterSystem(t);
    const r = this.replaying;
    if (r?.hasDigest(t) && (r.expectLo(t) !== d[1] || r.expectHi(t) !== d[2])) {
      this.mismatch = {
        tick: t,
        lo: r.expectLo(t),
        hi: r.expectHi(t),
        aLo: d[1] as number,
        aHi: d[2] as number,
      };
      return false;
    }
    return true;
  }

  /** Notes the closure's `snapshot_marker` and `debug_dump` actions (§15.3), handled after the tick. */
  private scanSystem(u8: Uint8Array, at: number, len: number): void {
    let o = at;
    const end = at + len;
    while (o + 16 <= end) {
      const system = ((u8[o + 1] as number) & 1) !== 0;
      const count = (u8[o + 12] as number) | ((u8[o + 13] as number) << 8);
      o += 16;
      for (let i = 0; i < count && o + 4 <= end; i++) {
        const type = (u8[o] as number) | ((u8[o + 1] as number) << 8);
        const plen = (u8[o + 2] as number) | ((u8[o + 3] as number) << 8);
        if (
          system &&
          (type === ActionType.snapshot_marker || type === ActionType.debug_dump) &&
          plen >= 4 &&
          this.sysCount < this.sysTypes.length
        ) {
          this.sysTypes[this.sysCount] = type;
          this.sysArgs[this.sysCount] =
            ((u8[o + 4] as number) |
              ((u8[o + 5] as number) << 8) |
              ((u8[o + 6] as number) << 16) |
              ((u8[o + 7] as number) << 24)) >>>
            0;
          this.sysCount += 1;
        }
        o += 4 + plen;
      }
    }
  }

  /** After a tick with system actions: a checkpoint for `snapshot_marker` (S9), a bundle for `debug_dump`. */
  private afterSystem(tick: number): void {
    for (let i = 0; i < this.sysCount; i++) {
      const id = this.sysArgs[i] as number;
      if (this.sysTypes[i] === ActionType.snapshot_marker) {
        void this.save(-1, 'checkpoint', `_snapshot-${id}`);
      } else if (id !== DEV_PANIC_DUMP_ID) {
        this.host.post({ t: 'bundle', gen: this.gen, id, tick, bundle: this.bundleNow(tick, tick) });
      }
    }
  }

  private requestChunks(records: Uint8Array): void {
    const pool = this.pool;
    if (!pool) return;
    const v = new DataView(records.buffer, records.byteOffset, records.byteLength);
    for (let o = 0; o + 16 <= records.length; o += 16)
      pool.request(
        v.getUint16(o, true),
        v.getInt32(o + 4, true),
        v.getInt32(o + 8, true),
        v.getUint32(o + 12, true),
      );
  }

  /** Every pending request after a bind (a load's requests come all at once, §15.8). */
  private pendingChunks(sim: SimInstance): void {
    const p = PendingChunksCodec.decode(sim.cold((s) => s.pendingChunks()));
    for (const q of p.requests) this.pool?.request(q.surface, q.cx, q.cy, q.commit_tick);
  }

  /** A worker's chunk, between ticks (§15.8 call order); the module ignores one that answers no request. */
  private supplyChunk(data: Uint8Array, commit: number): void {
    const sim = this.sim;
    if (!sim || this.stopped || commit <= this.tick) return;
    try {
      sim.cold((s) => s.supplyChunk(data));
    } catch (e) {
      if (e instanceof TrapError) {
        this.stop(e);
        return;
      }
      this.logLine('warn', `sim_supply_chunk: ${String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------------------------- packets

  /**
   * One packet (§15.4): the view request into the input buffer, `sim_extract`, the packet copied into a pooled
   * buffer with its state generation and view sequence, transferred. Skipped while hidden or catching up, and
   * when no buffer is free (backpressure), unless `unsolicited` (a world's first packet) or `force` (a step).
   */
  private extract(unsolicited = false, force = false): void {
    const sim = this.sim;
    if (!sim || this.stopped) return;
    if (!unsolicited && !force && (this.hidden || this.catchingUp)) return;
    if (!unsolicited && this.packets.available === 0) {
      this.extractPending = true;
      return;
    }
    const p = sim.input(ViewRequestCodec.SIZE);
    sim.lease.u8.set(unsolicited ? ZERO_VIEW : this.view, p);
    const env = sim.extract(ViewRequestCodec.SIZE);
    if (env === 0) {
      const e = sim.lastError();
      this.extractWanted = false;
      this.postError('extract', e.status, e.message);
      return;
    }
    const lease = sim.lease;
    const len = lease.dv.getUint32(env, true);
    // A buffer is certain here (checked above, and nothing ran between): the module's presentation state has
    // already advanced, so this packet must go out (§15.4 "What the worker remembers").
    const slot = this.packets.take(len) ?? this.packets.extra(len);
    fillPacket(slot, lease.u32, lease.u8, env + 4, len, this.gen, unsolicited ? 0 : this.viewSeq);
    this.extractWanted = false;
    if (this.viewChart && this.pool) this.chartRequests(slot.dv);
    this.pktMsg.buf = slot.buf;
    this.pktTransfer[0] = slot.buf;
    this.host.post(this.pktMsg, this.pktTransfer);
    this.pktMsg.buf = EMPTY;
  }

  /** CHART_PRISTINE records (§15.4 type 17): their images come from the worldgen pool (§5.19). */
  private chartRequests(dv: DataView): void {
    const n = dv.getUint16(22, true);
    for (let i = 0; i < n; i++) {
      const e = 32 + 16 * i;
      if (dv.getUint16(e, true) !== PacketSection.chart_pristine) continue;
      const off = dv.getUint32(e + 4, true);
      const count = dv.getUint32(e + 12, true);
      for (let k = 0; k < count; k++) {
        const [cx, cy] = chunkXY(dv.getUint32(off + 8 * k, true));
        this.pool?.chart(dv.getUint16(off + 8 * k + 4, true), cx, cy);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------- saves

  /**
   * A save or checkpoint copy (§8.4, §8.6, S9): `sim_save` at the tick boundary, the sections copied out of linear
   * memory into a transferable buffer, the header assembled, and the IO worker compresses, hashes and stores.
   * A stored save becomes the closure log's base.
   */
  private async save(
    id: number,
    reason: 'manual' | 'auto' | 'exit' | 'checkpoint',
    name: string | null,
  ): Promise<void> {
    const sim = this.sim;
    const fail = (message: string) => {
      if (id >= 0) this.host.post({ t: 'saveFailed', id, message });
      this.logLine('warn', `save ${name ?? reason}: ${message}`);
    };
    if (!sim || !this.bound || this.stopped) return fail('no world');
    if (!this.io) return fail('no IO worker');
    if (reason === 'manual' && !name) return fail('a manual save needs a name');
    const t0 = this.host.now();
    const tick = this.tick;
    const out = sim.cold((s) => s.save(SaveInputCodec.encode({ flags: 0 })));
    const stateHash = this.stateHash(sim);
    const ms = this.host.now() - t0;
    const r = new DataView(out.buffer, out.byteOffset, out.byteLength).getBigUint64(out.length - 8, true);
    const header = this.header(tick, r);
    const buf = out.buffer.byteLength === out.length ? (out.buffer as ArrayBuffer) : out.slice().buffer;
    const reply = await this.io.request(
      { t: 'store', name, reason, save: buf, header, slots: AUTOSAVE_SLOTS, stateHash: hex16(stateHash) },
      [buf],
    );
    if (reply.t !== 'stored')
      return fail(reply.t === 'failed' ? reply.message : `unexpected answer ${reply.t}`);
    if (id >= 0) this.host.post({ t: 'saved', id, bytes: reply.info.bytes, ms, sha256: reply.info.sha256 });
    // §8.5: the closure log runs from the last save.
    if (!this.stopped) this.log.rebase({ kind: 'save', name: reply.info.name, tick }, tick, stateHash);
  }

  /** The closure log since its base and the digest ring (§8.5 bug bundles). */
  private bundleNow(endTick: number, digestsThrough: number): ShellBundle {
    const base = this.log.base ?? { kind: 'save', name: '', tick: this.log.baseTick };
    const b = this.build as BuildManifest;
    const buildHash = /^[0-9a-f]{64}$/.test(b.buildHash) ? b.buildHash : '0'.repeat(64);
    const log = this.log.write(endTick, this.digests, digestsThrough, buildHash, this.protosHash)
      .buffer as ArrayBuffer;
    const copy: LogBase = base.kind === 'start' ? { ...base, save: base.save.slice(0) } : base;
    return { base: copy, log, digests: this.digests.bytes() };
  }

  // -------------------------------------------------------------------------------------------- dev hooks

  private devOp(id: number, op: DevOp): void {
    let answer: { ok: boolean; value: ArrayBuffer } | null;
    try {
      answer = this.devAnswer(id, op);
    } catch (e) {
      if (e instanceof TrapError) {
        this.stop(e);
        return;
      }
      answer = { ok: false, value: utf8(String(e)) };
    }
    if (answer) {
      const { ok, value } = answer;
      this.host.post({ t: 'res', gen: this.gen, id, ok, value }, value.byteLength > 0 ? [value] : []);
    }
  }

  /** A dev op's answer (§3.5); null when it answers with its own message (`bundle`). */
  private devAnswer(id: number, op: DevOp): { ok: boolean; value: ArrayBuffer } | null {
    const sim = this.sim;
    const yes = (value: ArrayBuffer = EMPTY) => ({ ok: true, value });
    const no = (why: string) => ({ ok: false, value: utf8(why) });
    if (!sim || !this.bound || this.stopped) return no('no world');
    const copy = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;
    switch (op.op) {
      case 'hash':
        return yes(copy(sim.cold((s) => s.stateHash())));
      case 'digest':
        return yes(copy(sim.cold((s) => s.digest())));
      case 'flags':
        this.setFlag(SimFlags.no_sleep, op.noSleep);
        return yes();
      case 'allocs':
        return yes(copy(sim.cold((s) => s.allocs())));
      case 'memory': {
        const dir = sim.cold((s) => s.poolDir());
        const info = { bytes: sim.lease.bytes, generation: sim.lease.generation, poolDirBytes: dir.length };
        return yes(utf8(JSON.stringify(info)));
      }
      case 'bundle':
        this.host.post({
          t: 'bundle',
          gen: this.gen,
          id,
          tick: this.tick,
          bundle: this.bundleNow(this.tick, this.tick),
        });
        return null;
      case 'panic':
        if (!this.dev) return no('dev builds only');
        this.seq.system(
          ActionType.debug_dump,
          actionBytes({ type: 'debug_dump', dump_id: DEV_PANIC_DUMP_ID }).subarray(4),
        );
        return yes();
      case 'system': {
        if (!this.dev) return no('dev builds only');
        const b = new Uint8Array(op.actions);
        for (let at = 0; at + 4 <= b.length; ) {
          const type = (b[at] as number) | ((b[at + 1] as number) << 8);
          const len = (b[at + 2] as number) | ((b[at + 3] as number) << 8);
          if (type < SYSTEM_TYPE_MIN || at + 4 + len > b.length) return no('not framed system actions');
          this.seq.system(type, b.subarray(at + 4, at + 4 + len));
          at += 4 + len;
        }
        return yes();
      }
    }
  }

  // --------------------------------------------------------------------------------------- replay and port

  /** §8.5 "Replay": the log must start at this world's tick and state, under this build's prototypes. */
  private async startReplay(bytes: Uint8Array): Promise<void> {
    const sim = this.sim;
    const fail = (message: string) =>
      this.host.post({ t: 'replayed', gen: this.gen, ok: false, tick: this.tick, message });
    if (!sim || !this.bound || this.stopped) return fail('no world');
    // A replay is the world's whole input: no tick may have run, and no player action may be waiting. The
    // shell's own `player_joined(0)` for the first tick is dropped: the log holds what really happened.
    if (this.mode !== 'local' || this.acted || this.tick !== this.log.baseTick)
      return fail('a replay needs a fresh world');
    this.bind(false);
    let log: ClosureLog;
    try {
      log = parseClosureLog(bytes);
    } catch (e) {
      return fail(`the closure log is refused: ${String(e)}`);
    }
    const h = log.header;
    if (h.start_tick !== this.tick)
      return fail(`the log starts at tick ${h.start_tick}; the world is at ${this.tick}`);
    if (hex(h.prototypes_hash.bytes) !== this.protosHash)
      return fail(
        'the log was recorded with other prototypes (§8.5: it replays only under its prototypesHash)',
      );
    const buildHash = hex(h.build_hash.bytes);
    if (buildHash !== '0'.repeat(64) && buildHash !== this.build?.buildHash && this.build?.dev !== true)
      return fail('the log was recorded by another build');
    const state = this.stateHash(sim);
    if (h.start_state_hash !== state)
      return fail(
        `the world's state hash is ${hex16(state)}; the log starts from ${hex16(h.start_state_hash)}`,
      );
    for (const b of log.blobs)
      if (hex(await this.host.sha256(b.bytes)) !== hex(b.sha256.bytes))
        return fail('a blob does not hash to its name');
    this.replaying = new ReplaySource(log);
    this.source = this.replaying;
    this.mode = 'replay';
    this.setFlag(SimFlags.historical, true);
    this.reschedule();
  }

  private finishReplay(
    mismatch: { tick: number; lo: number; hi: number; aLo: number; aHi: number } | null,
  ): void {
    const done = this.replaying;
    if (!done) return;
    this.replaying = null;
    this.source = this.seq;
    this.mode = 'local';
    this.setFlag(SimFlags.historical, false);
    this.clock.paused = true;
    this.bind();
    const u64 = (lo: number, hi: number) => hex16((BigInt(hi) << 32n) | BigInt(lo));
    this.host.post(
      mismatch
        ? {
            t: 'replayed',
            gen: this.gen,
            ok: false,
            tick: this.tick,
            mismatch: {
              tick: mismatch.tick,
              expected: u64(mismatch.lo, mismatch.hi),
              actual: u64(mismatch.aLo, mismatch.aHi),
            },
          }
        : { t: 'replayed', gen: this.gen, ok: true, tick: this.tick },
    );
    this.extract(false, true);
    this.restartClock();
  }

  /** Closures from the room (11 §2.4): `{t: 'closures', first, closures, blobs}`. */
  private closures(m: unknown): void {
    const c = m as { t?: string; first?: number; closures?: ArrayBuffer[]; blobs?: ArrayBuffer[] };
    if (c.t !== 'closures' || typeof c.first !== 'number' || !Array.isArray(c.closures)) return;
    if (!this.port) {
      this.logLine('warn', 'closures before a world: dropped');
      return;
    }
    const err = this.port.receive(c.first, c.closures, c.blobs ?? []);
    if (err) {
      this.logLine('error', `closure port: ${err}`);
      return;
    }
    this.soon(0);
  }

  /** Ends an in-process shell (`?sim=inline`, tests) as a terminated worker ends: no more wakes, no messages. */
  close(): void {
    if (!this.stopped) this.stopped = 'closed';
    if (this.timer !== null) this.host.cancel(this.timer);
    this.timer = null;
    this.pool?.close();
    this.io?.close();
    if (this.closurePort) {
      this.closurePort.onmessage = null;
      this.closurePort.close();
    }
  }

  // ------------------------------------------------------------------------------------------------- traps

  /**
   * Stops the shell for good (§3.6 step 2): a trap, a closure the preflight refused (§15.3: a shell bug, treated
   * like a trap) or a shell error in the tick path. Posts `trap` with the closure log up to the trapping tick.
   */
  stop(e: unknown): void {
    if (this.stopped) return;
    const msg =
      e instanceof TrapError
        ? e.message
        : e instanceof PreflightFailure
          ? e.message
          : `shell error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`;
    this.stopped = msg;
    if (this.timer !== null) this.host.cancel(this.timer);
    this.timer = null;
    const trapTick = this.tick + 1;
    let bundle: ShellBundle | undefined;
    if (this.bound && this.build && this.log.base) {
      try {
        bundle = this.bundleNow(trapTick, this.tick);
      } catch {
        bundle = undefined;
      }
    }
    const transfer: Transferable[] = [];
    if (bundle) {
      transfer.push(bundle.log, bundle.digests);
      if (bundle.base.kind === 'start') transfer.push(bundle.base.save);
    }
    this.host.post(
      bundle
        ? { t: 'trap', gen: this.gen, tick: trapTick, message: msg, bundle }
        : { t: 'trap', gen: this.gen, tick: trapTick, message: msg },
      transfer,
    );
    this.logLine('error', `stopped at tick ${trapTick}: ${msg}`);
  }
}
