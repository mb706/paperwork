// Where the sim worker's closures come from (10 §3.3, §15.3, S2, S3, S11): the shell runs tick k only when it
// holds the closure of tick k, and never invents a tick. Three sources share one interface:
// - the LocalSequencer (single player, tests): it stamps each action for the next tick (margin 0) through the
//   shared admission function, refuses seqs that do not rise, writes the player's input generation into each
//   held-input action, builds batches, and issues the system actions single player needs (`player_joined(0)` in
//   a new world's first tick). It closes ticks on demand, so its horizon is unbounded; the shell's clock paces it;
// - a ReplaySource (§8.5): a closure log's recorded closures, or empty ones, with their blobs and digests;
// - a PortSource (multiplayer, S11): closures that arrive on the closure port (11 §2.4), already sequenced by the
//   relay and the net worker.
//
// The shell writes each closure straight into the module's input buffer (`write`), so a tick copies no closure
// through JavaScript arrays, and the LocalSequencer keeps its queue in typed arrays: its steady state allocates
// nothing (A1 open issue 7). Allocation is explicit and amortised: the queue and the payload arena double when
// full, and blob-carrying actions (large blueprints, M3) take a slow path.
import {
  ACTION_HEADER_BYTES,
  type AdmissionAction,
  BATCH_HEADER_BYTES,
  emptyRoom,
  resetRoom,
  type TickRoom,
  tryAdmit,
} from '../shared/admission.ts';
import {
  ACTION_SCHEMA_VERSION,
  ActionType,
  actionBlob,
  closureActions,
  decodeAction,
  HELD_ACTIONS,
  PAYLOAD_MAX,
  PLAYERS,
  SYSTEM_PLAYER,
  SYSTEM_TYPE_MIN,
} from '../shared/gen/actions.ts';
import type { ClosureLog } from '../shared/gen/container.ts';

export interface ClosureSource {
  /** The highest tick whose closure is held; the LocalSequencer closes ticks on demand (Infinity). */
  horizon(): number;
  /** The byte length of tick `tick`'s closure (0: the empty closure). */
  length(tick: number): number;
  /** Writes tick `tick`'s closure at `at` of linear memory. */
  write(tick: number, u8: Uint8Array, dv: DataView, at: number): void;
  /** The blobs tick `tick`'s actions name, each `sha256 ‖ bytes` as `sim_blob_put` takes it; null for none. */
  blobs(tick: number): Uint8Array[] | null;
  /** Tick `tick` ran. */
  done(tick: number): void;
}

const hexOf = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += (x < 16 ? '0' : '') + x.toString(16);
  return s;
};

/** Every blob a closure's actions name (§15.3), as hex SHA-256s. */
export function closureBlobs(closure: Uint8Array): string[] {
  const out: string[] = [];
  for (const a of closureActions(closure)) {
    if (a.type !== ActionType.place_blueprint) continue;
    try {
      const h = actionBlob(decodeAction(a.type, a.payload));
      if (h) out.push(hexOf(h));
    } catch {
      // malformed: the sim refuses it with `malformed` and names no blob
    }
  }
  return out;
}

/** Concatenates a blob's hash and bytes, as `sim_blob_put` takes them. */
export function blobPut(sha256Hex: string, bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(32 + bytes.length);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(sha256Hex.slice(2 * i, 2 * i + 2), 16);
  out.set(bytes, 32);
  return out;
}

const HELD = new Uint8Array(65536);
for (const name of HELD_ACTIONS) HELD[ActionType[name as keyof typeof ActionType]] = 1;
const RELEASE_INPUTS = ActionType.release_inputs;
const PLAYER_LEFT = ActionType.player_left;
const PLACE_BLUEPRINT = ActionType.place_blueprint;
/** Index of the system "player" in the per-player arrays. */
const SYS = PLAYERS;

/** A world's watermarks at `bound` (sim_meta, §15.8). */
export interface Watermarks {
  tick: number;
  lastSystemSeq: number;
  players: readonly { index: number; lastSeq: number; inputGen: number }[];
}

/** The LocalSequencer (10 §3.3). */
export class LocalSequencer implements ClosureSource {
  /** The next tick to close: world tick + 1. */
  open = 1;
  private readonly lastSeq = new Uint32Array(PLAYERS);
  private readonly inputGen = new Uint16Array(PLAYERS);
  private lastSystemSeq = 0;
  private readonly lastAssigned = new Uint32Array(PLAYERS + 1);
  /** Admission rooms for ticks open, open + 1, …: rotated, never reallocated in the steady state. */
  private rooms: TickRoom[] = [emptyRoom(), emptyRoom(), emptyRoom(), emptyRoom()];
  // The queue: parallel typed arrays, a power-of-two ring.
  private cap = 256;
  private qPlayer = new Uint16Array(this.cap);
  private qSeq = new Uint32Array(this.cap);
  private qType = new Uint16Array(this.cap);
  private qLen = new Uint32Array(this.cap);
  private qOff = new Uint32Array(this.cap);
  private qTick = new Uint32Array(this.cap);
  private qBlobs = new Uint8Array(this.cap);
  private head = 0;
  private tail = 0;
  /** Payload bytes of the queued actions. */
  private arena = new Uint8Array(65536);
  private arenaTop = 0;
  /** Blobs that queued actions name (hex SHA-256 → bytes): the slow path. */
  private readonly blobStore = new Map<string, Uint8Array>();
  /** Problems the intake met (refused messages, dropped actions), drained by the shell into log lines. */
  readonly problems: string[] = [];

  /** Starts from a bound world's watermarks: seqs continue from them (§3.2, §15.3). */
  bind(w: Watermarks): void {
    this.open = w.tick + 1;
    this.lastSeq.fill(0);
    this.inputGen.fill(0);
    for (const p of w.players) {
      if (p.index < 0 || p.index >= PLAYERS) continue;
      this.lastSeq[p.index] = p.lastSeq;
      this.inputGen[p.index] = p.inputGen;
    }
    this.lastSystemSeq = w.lastSystemSeq;
    this.lastAssigned.fill(0);
    for (const r of this.rooms) resetRoom(r);
    this.head = 0;
    this.tail = 0;
    this.arenaTop = 0;
    this.blobStore.clear();
  }

  /** The input generation the sequencer tracks for a player (D22). */
  generation(player: number): number {
    return this.inputGen[player] as number;
  }

  /** Actions waiting for their tick. */
  get queued(): number {
    return this.tail - this.head;
  }

  horizon(): number {
    return Number.POSITIVE_INFINITY;
  }

  /**
   * An `act` message (§15.3 "The act message"): framed actions without ticks, the i-th with seq `firstSeq + i`.
   * Refuses the whole message (and returns why) when its seqs do not rise or its framing is broken; drops a
   * system action type from a player (§15.3 "Admission") and an action whose blob the message lacks.
   */
  submit(
    player: number,
    firstSeq: number,
    bytes: Uint8Array,
    blobs: ReadonlyMap<string, Uint8Array> | null,
  ): string | null {
    if (player < 0 || player >= PLAYERS) return `player ${player} out of range`;
    const last = this.lastSeq[player] as number;
    if (firstSeq <= last) return `seq ${firstSeq} does not rise above ${last} (D21)`;
    let at = 0;
    let n = 0;
    while (at < bytes.length) {
      if (bytes.length - at < 4) return 'an action header is cut short';
      const len = (bytes[at + 2] as number) | ((bytes[at + 3] as number) << 8);
      if (at + 4 + len > bytes.length) return 'an action runs past the act message';
      at += 4 + len;
      n += 1;
    }
    if (n === 0) return null;
    if (firstSeq + n - 1 > 0xffffffff) return 'the seqs pass u32::MAX';
    at = 0;
    for (let i = 0; i < n; i++) {
      const seq = firstSeq + i;
      const type = (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
      const len = (bytes[at + 2] as number) | ((bytes[at + 3] as number) << 8);
      if (type >= SYSTEM_TYPE_MIN) {
        this.problems.push(
          `seq ${seq}: a system action type (${type}) from a player never enters a tick: dropped`,
        );
      } else {
        let blobCount = 0;
        let named: string | null = null;
        if (type === PLACE_BLUEPRINT) {
          try {
            const h = actionBlob(decodeAction(type, bytes.subarray(at + 4, at + 4 + len)));
            if (h) named = hexOf(h);
          } catch {
            named = null; // malformed: refused by the sim, names no blob
          }
        }
        if (named !== null) {
          const b = blobs?.get(named);
          if (!b) {
            this.problems.push(`seq ${seq}: names a blob the act message does not carry: dropped`);
            at += 4 + len;
            continue;
          }
          this.blobStore.set(named, b);
          blobCount = 1;
        }
        const k = this.enqueue(player, seq, type, bytes, at + 4, len, blobCount);
        // D22: the generation the sequencer tracks, written as it stamps (§15.3 "Input fencing").
        if (HELD[type] === 1 && len >= 2) {
          const g = this.inputGen[player] as number;
          const o = this.qOff[k] as number;
          this.arena[o] = g & 0xff;
          this.arena[o + 1] = g >>> 8;
        }
      }
      at += 4 + len;
    }
    this.lastSeq[player] = firstSeq + n - 1;
    return null;
  }

  /**
   * A system action (player 0xFFFF; framed payload without its header) for the next open tick, with the next
   * system seq. `release_inputs(p)` and `player_left(p)` raise p's tracked generation (§15.3).
   */
  system(type: number, payload: Uint8Array): void {
    if (type < SYSTEM_TYPE_MIN) throw new Error(`action type ${type} is not a system action`);
    if (payload.length > PAYLOAD_MAX) throw new Error('system action payload too long');
    const seq = (this.lastSystemSeq + 1) >>> 0;
    this.lastSystemSeq = seq;
    this.enqueue(SYSTEM_PLAYER, seq, type, payload, 0, payload.length, 0);
    if ((type === RELEASE_INPUTS || type === PLAYER_LEFT) && payload.length >= 2) {
      const p = (payload[0] as number) | ((payload[1] as number) << 8);
      if (p < PLAYERS) this.inputGen[p] = ((this.inputGen[p] as number) + 1) & 0xffff;
    }
  }

  /**
   * The room of a tick from `open` on: a ring indexed by tick, reset as each tick closes. An admission that
   * reaches past the ring (megabytes of spilled actions) doubles it, placing each room at its tick again.
   */
  private room(tick: number): TickRoom {
    while (tick - this.open >= this.rooms.length) {
      const old = this.rooms;
      const n = old.length * 2;
      const grown: TickRoom[] = Array.from({ length: n }, () => emptyRoom());
      for (let t = this.open; t < this.open + old.length; t++)
        grown[t & (n - 1)] = old[t & (old.length - 1)] as TickRoom;
      this.rooms = grown;
    }
    return this.rooms[tick & (this.rooms.length - 1)] as TickRoom;
  }

  /** Admits an action (§15.3) from the open tick, never before its player's previous one (11 §3.4). */
  private admit(a: AdmissionAction): number {
    const pi = a.player === SYSTEM_PLAYER ? SYS : a.player;
    let t = Math.max(this.open, this.lastAssigned[pi] as number);
    while (!tryAdmit(this.room(t), a.player, a.seq, a.payloadBytes, a.blobCount)) t += 1;
    this.lastAssigned[pi] = t;
    return t;
  }

  private readonly scratch: AdmissionAction = { player: 0, seq: 0, payloadBytes: 0, blobCount: 0 };

  private enqueue(
    player: number,
    seq: number,
    type: number,
    src: Uint8Array,
    from: number,
    len: number,
    blobCount: number,
  ): number {
    const a = this.scratch;
    a.player = player;
    a.seq = seq;
    a.payloadBytes = len;
    a.blobCount = blobCount;
    const tick = this.admit(a);
    if (this.tail - this.head === this.cap) this.growQueue();
    if (this.arenaTop + len > this.arena.length) this.growArena(len);
    const k = this.tail & (this.cap - 1);
    this.qPlayer[k] = player;
    this.qSeq[k] = seq;
    this.qType[k] = type;
    this.qLen[k] = len;
    this.qOff[k] = this.arenaTop;
    this.qTick[k] = tick;
    this.qBlobs[k] = blobCount;
    const arena = this.arena;
    const top = this.arenaTop;
    for (let i = 0; i < len; i++) arena[top + i] = src[from + i] as number;
    this.arenaTop = top + len;
    this.tail += 1;
    return k;
  }

  private growQueue(): void {
    const old = this.cap;
    const cap = old * 2;
    const copy = <T extends Uint8Array | Uint16Array | Uint32Array>(a: T, make: (n: number) => T): T => {
      const b = make(cap);
      for (let i = this.head; i < this.tail; i++) b[i & (cap - 1)] = a[i & (old - 1)] as number;
      return b;
    };
    this.qPlayer = copy(this.qPlayer, (n) => new Uint16Array(n));
    this.qSeq = copy(this.qSeq, (n) => new Uint32Array(n));
    this.qType = copy(this.qType, (n) => new Uint16Array(n));
    this.qLen = copy(this.qLen, (n) => new Uint32Array(n));
    this.qOff = copy(this.qOff, (n) => new Uint32Array(n));
    this.qTick = copy(this.qTick, (n) => new Uint32Array(n));
    this.qBlobs = copy(this.qBlobs, (n) => new Uint8Array(n));
    this.cap = cap;
  }

  private growArena(need: number): void {
    let size = this.arena.length * 2;
    while (size < this.arenaTop + need) size *= 2;
    const a = new Uint8Array(size);
    a.set(this.arena.subarray(0, this.arenaTop));
    this.arena = a;
  }

  length(tick: number): number {
    let len = 0;
    let lastPlayer = -1;
    let lastSeq = 0;
    for (let i = this.head; i < this.tail; i++) {
      const k = i & (this.cap - 1);
      if (this.qTick[k] !== tick) continue;
      const p = this.qPlayer[k] as number;
      const s = this.qSeq[k] as number;
      if (p !== lastPlayer || s !== (lastSeq + 1) >>> 0) len += BATCH_HEADER_BYTES;
      len += ACTION_HEADER_BYTES + (this.qLen[k] as number);
      lastPlayer = p;
      lastSeq = s;
    }
    return len;
  }

  write(tick: number, u8: Uint8Array, dv: DataView, at: number): void {
    let o = at;
    let batchAt = -1;
    let count = 0;
    let lastPlayer = -1;
    let lastSeq = 0;
    const arena = this.arena;
    for (let i = this.head; i < this.tail; i++) {
      const k = i & (this.cap - 1);
      if (this.qTick[k] !== tick) continue;
      const p = this.qPlayer[k] as number;
      const s = this.qSeq[k] as number;
      if (p !== lastPlayer || s !== (lastSeq + 1) >>> 0) {
        if (batchAt >= 0) dv.setUint16(batchAt + 12, count, true);
        batchAt = o;
        count = 0;
        // §15.3's batch header: version, flags (bit 0 SYSTEM), player, tick, first_seq, count, reserved.
        dv.setUint8(o, ACTION_SCHEMA_VERSION);
        dv.setUint8(o + 1, p === SYSTEM_PLAYER ? 1 : 0);
        dv.setUint16(o + 2, p, true);
        dv.setUint32(o + 4, tick, true);
        dv.setUint32(o + 8, s, true);
        dv.setUint16(o + 12, 0, true);
        dv.setUint16(o + 14, 0, true);
        o += BATCH_HEADER_BYTES;
      }
      const len = this.qLen[k] as number;
      dv.setUint16(o, this.qType[k] as number, true);
      dv.setUint16(o + 2, len, true);
      o += ACTION_HEADER_BYTES;
      const from = this.qOff[k] as number;
      for (let j = 0; j < len; j++) u8[o + j] = arena[from + j] as number;
      o += len;
      count += 1;
      lastPlayer = p;
      lastSeq = s;
    }
    if (batchAt >= 0) dv.setUint16(batchAt + 12, count, true);
  }

  blobs(tick: number): Uint8Array[] | null {
    let out: Uint8Array[] | null = null;
    for (let i = this.head; i < this.tail; i++) {
      const k = i & (this.cap - 1);
      if (this.qTick[k] !== tick || this.qBlobs[k] === 0) continue;
      const from = this.qOff[k] as number;
      const payload = this.arena.subarray(from, from + (this.qLen[k] as number));
      const h = actionBlob(decodeAction(this.qType[k] as number, payload));
      if (!h) continue;
      const hex = hexOf(h);
      const bytes = this.blobStore.get(hex);
      if (bytes) {
        out ??= [];
        out.push(blobPut(hex, bytes));
      }
    }
    return out;
  }

  /** The blob bytes behind a hash, while an action that names it waits (the closure log copies them). */
  blob(hex: string): Uint8Array | undefined {
    return this.blobStore.get(hex);
  }

  done(tick: number): void {
    for (let i = this.head; i < this.tail; i++) {
      const k = i & (this.cap - 1);
      if (this.qTick[k] === tick) this.qTick[k] = 0;
    }
    while (this.head < this.tail && this.qTick[this.head & (this.cap - 1)] === 0) this.head += 1;
    if (this.head === this.tail) {
      this.head = 0;
      this.tail = 0;
      this.arenaTop = 0;
      // Map.clear() makes a new table even when empty: only when there is something to clear.
      if (this.blobStore.size > 0) this.blobStore.clear();
    }
    // The closed tick's room, empty, serves the tick a ring's length later.
    resetRoom(this.rooms[tick & (this.rooms.length - 1)] as TickRoom);
    this.open = tick + 1;
  }
}

/** A closure log's ticks (§8.5 "Replay"): the recorded closure or an empty one, with blobs and digests. */
export class ReplaySource implements ClosureSource {
  readonly log: ClosureLog;
  private readonly byTick = new Map<number, Uint8Array>();
  private readonly blobBytes = new Map<string, Uint8Array>();
  /** The log's digests as signed words, as SimInstance.digestOut holds them. */
  private readonly digestWords: Int32Array;

  constructor(log: ClosureLog) {
    this.log = log;
    for (const r of log.records) this.byTick.set(r.tick, r.closure);
    for (const b of log.blobs) this.blobBytes.set(hexOf(b.sha256.bytes), b.bytes);
    this.digestWords = new Int32Array(log.digests.length * 2);
    log.digests.forEach((d, i) => {
      this.digestWords[2 * i] = Number(d & 0xffffffffn);
      this.digestWords[2 * i + 1] = Number(d >> 32n);
    });
  }

  get start(): number {
    return this.log.header.start_tick;
  }

  horizon(): number {
    return this.log.header.end_tick;
  }

  length(tick: number): number {
    return this.byTick.get(tick)?.length ?? 0;
  }

  write(tick: number, u8: Uint8Array, _dv: DataView, at: number): void {
    const c = this.byTick.get(tick);
    if (c) u8.set(c, at);
  }

  blobs(tick: number): Uint8Array[] | null {
    const c = this.byTick.get(tick);
    if (!c) return null;
    const named = closureBlobs(c);
    if (named.length === 0) return null;
    return named.flatMap((h) => {
      const b = this.blobBytes.get(h);
      return b ? [blobPut(h, b)] : [];
    });
  }

  /** Whether the log holds d_t; then `expectLo`/`expectHi` give it. */
  hasDigest(tick: number): boolean {
    const i = tick - this.log.header.digest_first_tick;
    return i >= 0 && i < this.log.header.digest_count;
  }

  expectLo(tick: number): number {
    return this.digestWords[2 * (tick - this.log.header.digest_first_tick)] as number;
  }

  expectHi(tick: number): number {
    return this.digestWords[2 * (tick - this.log.header.digest_first_tick) + 1] as number;
  }

  done(_tick: number): void {}
}

/** Closures from the closure port (multiplayer, 11 §2.4): `{t: 'closures', first, closures, blobs}`. */
export class PortSource implements ClosureSource {
  private readonly queue = new Map<number, Uint8Array>();
  private readonly blobBytes = new Map<string, Uint8Array>();
  private top = 0;

  constructor(start: number) {
    this.top = start;
  }

  horizon(): number {
    return this.top;
  }

  /**
   * Takes a message's closures; returns why it was refused (11 §3.2: a range that does not continue the
   * horizon is a protocol error, dropped before the horizon moves).
   */
  receive(first: number, closures: readonly ArrayBuffer[], blobs: readonly ArrayBuffer[]): string | null {
    if (first !== this.top + 1) return `closures from tick ${first}; the horizon is ${this.top}`;
    for (const b of blobs) {
      if (b.byteLength < 32) return 'a blob shorter than its hash';
      const u = new Uint8Array(b);
      this.blobBytes.set(hexOf(u.subarray(0, 32)), u.subarray(32));
    }
    closures.forEach((c, i) => {
      if (c.byteLength > 0) this.queue.set(first + i, new Uint8Array(c));
    });
    this.top = first + closures.length - 1;
    return null;
  }

  length(tick: number): number {
    return this.queue.get(tick)?.length ?? 0;
  }

  write(tick: number, u8: Uint8Array, _dv: DataView, at: number): void {
    const c = this.queue.get(tick);
    if (c) u8.set(c, at);
  }

  blobs(tick: number): Uint8Array[] | null {
    const c = this.queue.get(tick);
    if (!c) return null;
    const named = closureBlobs(c);
    if (named.length === 0) return null;
    return named.flatMap((h) => {
      const b = this.blobBytes.get(h);
      return b ? [blobPut(h, b)] : [];
    });
  }

  done(tick: number): void {
    this.queue.delete(tick);
  }
}
