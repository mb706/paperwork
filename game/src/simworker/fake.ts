// The fake sim worker (10 §15.10): speaks the protocol of §3.2 and writes packets with the generated
// encoders, so the renderer, the UI and audio can be built before the sim exists. `?sim=fake` selects it.
//
// It follows the world-replacement protocol (§3.4: `bound`, then an unsolicited FULL packet; every message
// carries its state generation), the LocalSequencer's pacing and seq rules (§3.3), the packet pool with acks
// (§15.4), extraction without ticks after view and subscription messages, and the explicit errors of the
// capability manifest (§2.4): unsupported actions, projections and queries are refused as the real sim
// refuses them. It is deterministic: the same seed, actions and ticks give the same packets (`seq step`
// runs ticks synchronously, as `__game.step(n)` does in test mode).
//
// Every action of M0's capability manifest is live (fake/rules.ts, after the golden set's reference model).
// Saves: the fake writes its own format, not a §8.1 container, because its world is not a World: the magic
// "PWFAKSAV", a u32 version, a u32 length, then the fake world's state as canonical JSON with the build's
// prototypesHash. `save` answers `saved` with its size and SHA-256 and keeps the bytes (`lastSave`), and
// `world {op: 'load'}` with those bytes restores that world exactly: the ticks after a load produce the same
// world as an uninterrupted run. Anything else given to `load` is refused explicitly: a `trap` message that
// says why, and a log line; no world is bound.
import {
  type Action,
  decodeAction,
  encodeActionPayload,
  HELD_ACTIONS,
  withInputGen,
} from '../shared/gen/actions.ts';
import { SUPPORTED_ACTIONS } from '../shared/gen/capabilities.ts';
import { Writer } from '../shared/gen/codec.ts';
import { QueryKind } from '../shared/gen/projections.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import { ABI_VERSION, SCHEMA_HASH } from '../shared/gen/schema.ts';
import type { MainToSim, SimToMain } from '../shared/protocol.ts';
import { PACKET_STATE_GEN_OFFSET, PACKET_VIEW_SEQ_OFFSET } from '../shared/protocol.ts';
import { FakeExtractor } from './fake/extract.ts';
import { insert, room } from './fake/inventory.ts';
import { FakeProtos } from './fake/protos.ts';
import { applyAction, sortMain } from './fake/rules.ts';
import { type FakeOptions, type FakeSnapshot, FakeWorld } from './fake/world.ts';

/** Where the dev server serves the fake's prototype build (the M1 filter: belts, inserters, machines). */
export const FAKE_DATA = '/data/fake/';

export interface FakeHost {
  post(msg: SimToMain, transfer?: Transferable[]): void;
  /** Milliseconds, for pacing only (worker shells may read the clock, §2.5). */
  now(): number;
  /** Schedules a wake; returns a handle for `cancel`. */
  wake(ms: number, f: () => void): unknown;
  cancel(handle: unknown): void;
  /** The prototypes the fake uses (the worker fetches them; tests pass them in). */
  protos(): Promise<PrototypesJson>;
  /** The same build's prototypes.bin, for its working-sound table (§15.6); null when unavailable. */
  protosBin?(): Promise<Uint8Array | null>;
}

const TICK_MS = 1000 / 60;
const BUFFERS = 3;
const BUFFER_BYTES = 262144;
/** The fake save's magic and format version (see the header comment). */
const SAVE_MAGIC = 'PWFAKSAV';
const SAVE_VERSION = 1;

/** A fake save's bytes: magic, version, length, canonical JSON. */
export function encodeFakeSave(prototypesHash: string, snap: FakeSnapshot): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ prototypesHash, world: snap }));
  const out = new Uint8Array(16 + json.length);
  out.set(new TextEncoder().encode(SAVE_MAGIC), 0);
  const v = new DataView(out.buffer);
  v.setUint32(8, SAVE_VERSION, true);
  v.setUint32(12, json.length, true);
  out.set(json, 16);
  return out;
}

/** A fake save's content, or why the bytes are not one. */
export function decodeFakeSave(
  bytes: Uint8Array,
): { prototypesHash: string; world: FakeSnapshot } | { error: string } {
  if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(0, 8)) !== SAVE_MAGIC)
    return { error: 'not a fake save (the fake sim loads only saves it wrote itself, magic PWFAKSAV)' };
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(8, true) !== SAVE_VERSION) return { error: `fake save version ${v.getUint32(8, true)}` };
  const len = v.getUint32(12, true);
  if (16 + len !== bytes.length) return { error: 'a truncated or padded fake save' };
  try {
    return JSON.parse(new TextDecoder().decode(bytes.subarray(16))) as {
      prototypesHash: string;
      world: FakeSnapshot;
    };
  } catch {
    return { error: 'a fake save whose state does not parse' };
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class FakeSim {
  private readonly host: FakeHost;
  private protos: FakeProtos | null = null;
  private world: FakeWorld | null = null;
  private readonly x = new FakeExtractor();
  private gen = 0;
  private viewSeq = 0;
  private pending: { player: number; seq: number; type: number; payload: Uint8Array }[] = [];
  private lastSeq = 0;
  /**
   * The LocalSequencer's input generation for player 0 (§15.3, D22): the world's at `bound`, plus one for every
   * release_inputs(0) and player_left(0) it has put into the closure stream since. It is written into every held
   * input as the input is stamped; the main thread never needs to know generations.
   */
  private tracked = 0;
  /** System actions for the next tick, ahead of its player actions (`injectSystem`). */
  private system: Action[] = [];
  private readonly free: ArrayBuffer[] = [];
  private paused = false;
  private speed = 1;
  private clockGen = 0;
  private t0 = 0;
  private tick0 = 0;
  private timer: unknown = null;
  private extractSoon = false;
  /** The bytes of the last save (the fake has no IO worker: a load passes them back). */
  lastSave: Uint8Array | null = null;
  /** Options for the next world (the dev page's `?fakeDay=` and the like). */
  options: FakeOptions = {};

  constructor(host: FakeHost) {
    this.host = host;
    for (let i = 0; i < BUFFERS; i++) this.free.push(new ArrayBuffer(BUFFER_BYTES));
  }

  get tick(): number {
    return this.world?.tick ?? 0;
  }

  /** The current world's state (tests compare a loaded world with an uninterrupted one). */
  snapshot(): FakeSnapshot | null {
    return this.world?.snapshot() ?? null;
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    this.host.post({ t: 'log', level, msg: `fake sim: ${msg}` });
  }

  async handle(m: MainToSim): Promise<void> {
    switch (m.t) {
      case 'boot': {
        // The page may pass the fake's own options in the build manifest object (`fake: { dayTicks }`).
        const opts = (m.build as { fake?: FakeOptions }).fake;
        if (opts) this.options = opts;
        const [json, bin] = await Promise.all([this.host.protos(), this.host.protosBin?.() ?? null]);
        this.protos = new FakeProtos(json, bin);
        if (!this.protos.hasSounds)
          this.log('info', 'the build has no working-sound table (sounds.yaml): no AUDIO_WORKING is sent');
        this.host.post({
          t: 'ready',
          abi: ABI_VERSION,
          schemaHash: SCHEMA_HASH,
          buildHash: m.build.buildHash,
        });
        return;
      }
      case 'world': {
        if (!this.protos) return this.log('error', 'world before boot');
        let world: FakeWorld;
        if (m.op === 'load') {
          const save = decodeFakeSave(new Uint8Array(m.sections));
          const error =
            'error' in save
              ? save.error
              : save.prototypesHash !== this.protos.json.prototypesHash
                ? `the fake save was written by another build (prototypesHash ${save.prototypesHash.slice(0, 12)}…)`
                : null;
          if (error !== null || 'error' in save) {
            this.log('error', `cannot load: ${error}`);
            this.host.post({ t: 'trap', gen: m.gen, tick: 0, message: `fake sim: cannot load: ${error}` });
            return;
          }
          world = new FakeWorld(this.protos, 0, this.options, save.world);
        } else world = new FakeWorld(this.protos, m.settings.seed, this.options);
        this.gen = m.gen;
        this.world = world;
        this.x.reset();
        this.pending = [];
        const me = world.chars.find((c) => c.player === 0);
        this.lastSeq = me?.lastSeq ?? 0;
        this.tracked = me?.inputGen ?? 0;
        this.system = [];
        this.host.post({
          t: 'bound',
          gen: this.gen,
          tick: world.tick,
          players: world.chars.map((c) => ({ index: c.player, lastSeq: c.lastSeq, inputGen: c.inputGen })),
        });
        // The new world's first packet goes out unsolicited, FULL, even while paused (§3.4, B1-r1 12).
        this.extract(true);
        this.restartClock();
        return;
      }
      case 'act':
        if (m.gen !== this.gen) return;
        return this.act(m.firstSeq, new Uint8Array(m.actions));
      case 'seq':
        return this.control(m.op);
      case 'view':
        if (m.gen !== this.gen) return;
        this.x.view = m.v;
        this.viewSeq = m.v.view_seq;
        return this.soon();
      case 'sub':
        if (m.gen !== this.gen) return;
        if (!this.x.subscribe(m.subs))
          this.log('error', 'sim_subscribe: ERR_INPUT (sub_id 0 is the hover projection)');
        return this.soon();
      case 'unsub':
        if (m.gen !== this.gen) return;
        this.x.unsubscribe(m.ids);
        return this.soon();
      case 'query': {
        if (m.gen !== this.gen || !this.world) return;
        const r = this.x.query(this.world, new Uint8Array(m.q));
        const value = r.value.slice().buffer;
        this.host.post({ t: 'res', gen: this.gen, id: m.id, ok: r.ok, value }, [value]);
        return;
      }
      case 'cancel':
        return; // queries finish at once
      case 'ack':
        this.free.push(m.buf);
        if (this.extractSoon) this.soon();
        return;
      case 'save': {
        // The fake's own save format (header comment); the bytes stay here for a later load.
        if (!this.world || !this.protos) return this.log('error', 'save before a world is bound');
        const t0 = this.host.now();
        const bytes = encodeFakeSave(this.protos.json.prototypesHash, this.world.snapshot());
        this.lastSave = bytes;
        const sha256 = await sha256Hex(bytes);
        this.host.post({ t: 'saved', id: m.id, bytes: bytes.length, ms: this.host.now() - t0, sha256 });
        return;
      }
      case 'dev': {
        // §3.5's hooks answer as the queries of the same name do (made-up values: the fake has no state hash).
        if (!this.world) return;
        let value = new ArrayBuffer(0);
        if (m.op.op !== 'flags') {
          const q = new Uint8Array(4);
          new DataView(q.buffer).setUint16(0, m.op.op === 'hash' ? QueryKind.hash : QueryKind.digest, true);
          value = this.x.query(this.world, q).value.slice().buffer;
        }
        this.host.post({ t: 'res', gen: this.gen, id: m.id, ok: true, value }, [value]);
        return;
      }
    }
  }

  /** Queues encoded actions for the next tick (§3.3: the LocalSequencer stamps them, margin 0). */
  private act(firstSeq: number, bytes: Uint8Array): void {
    if (firstSeq <= this.lastSeq) {
      this.log('error', `seq ${firstSeq} does not rise above ${this.lastSeq}`);
      return;
    }
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 0;
    let seq = firstSeq;
    while (at + 4 <= bytes.length) {
      const type = v.getUint16(at, true);
      const len = v.getUint16(at + 2, true);
      if (at + 4 + len > bytes.length) {
        this.log('error', 'an action runs past the act message');
        return;
      }
      // A player's action with a system type id never enters a tick: the LocalSequencer drops it (§15.3).
      if (type >= 0xff00) this.log('error', `seq ${seq}: system action type ${type} from a player: dropped`);
      else
        this.pending.push({
          player: 0,
          seq,
          type,
          payload: this.stamp(type, bytes.slice(at + 4, at + 4 + len)),
        });
      this.lastSeq = seq;
      seq++;
      at += 4 + len;
    }
  }

  /**
   * The LocalSequencer stamps a held input with the generation it tracks (§15.3: "The sequencer writes input_gen
   * into each held-input action when it stamps it"), whatever the main thread wrote. A payload that does not decode
   * goes on as it is: the tick refuses it as malformed.
   */
  private stamp(type: number, payload: Uint8Array): Uint8Array {
    let a: Action;
    try {
      a = decodeAction(type, payload);
    } catch {
      return payload;
    }
    if (!HELD_ACTIONS.has(a.type)) return payload;
    const w = new Writer();
    encodeActionPayload(w, withInputGen(a, this.tracked));
    return w.finish();
  }

  /**
   * Puts a system action into the next tick's closure, ahead of its player actions, as the relay injects
   * release_inputs (11 §2.6): held inputs stamped before it carry the old generation and are fenced. For tests and
   * dev tools (the real LocalSequencer issues none of these in single player but player_joined(0)).
   */
  injectSystem(a: Action): void {
    this.system.push(a);
    if ((a.type === 'release_inputs' || a.type === 'player_left') && a.player === 0)
      this.tracked = (this.tracked + 1) & 0xffff;
  }

  private control(op: MainToSim & { t: 'seq' } extends { op: infer O } ? O : never): void {
    if (op === 'pause') this.paused = true;
    else if (op === 'resume') this.paused = false;
    else if ('speed' in op) this.speed = op.speed > 0 ? op.speed : 1;
    else if ('step' in op) {
      // Test mode (§3.3): close n ticks, run them now, then emit one packet.
      for (let i = 0; i < op.step; i++) this.runTick();
      this.extract(false);
      return;
    }
    this.restartClock();
  }

  /** A new clock generation: pause, resume, speed and rebase each start one (§3.3, S3). */
  private restartClock(): void {
    this.clockGen = (this.clockGen + 1) & 0xffff;
    this.t0 = this.host.now();
    this.tick0 = this.tick;
    this.host.post({
      t: 'clock',
      gen: this.gen,
      clockGen: this.clockGen,
      tick: this.tick,
      speed: this.speed,
      paused: this.paused,
    });
    if (this.timer !== null) this.host.cancel(this.timer);
    this.timer = null;
    if (!this.paused && this.world) this.schedule();
  }

  private schedule(): void {
    const next = this.t0 + ((this.tick - this.tick0 + 1) * TICK_MS) / this.speed;
    const ms = next - this.host.now() - 2;
    this.timer = this.host.wake(ms > 4 ? ms : 0, () => this.wakeUp());
  }

  /** A wake: run the due ticks (at most 3; a backlog over 6 rebases the clock), extract once. */
  private wakeUp(): void {
    this.timer = null;
    if (this.paused || !this.world) return;
    let due = Math.floor(((this.host.now() - this.t0) * this.speed) / TICK_MS) - (this.tick - this.tick0);
    if (due > 6) {
      // A backlog over 6 ticks: rebase t₀ and drop it, in a new clock generation (§3.3); game time slows.
      this.restartClock();
      return;
    }
    if (due < 0) due = 0;
    const n = due > 3 ? 3 : due;
    for (let i = 0; i < n; i++) this.runTick();
    if (n > 0) this.extract(false);
    this.schedule();
  }

  private runTick(): void {
    const w = this.world;
    if (!w) return;
    // The closure of this tick: the pending actions in seq order (phase 1), then the world's own step.
    const actions = this.pending;
    this.pending = [];
    const system = this.system;
    this.system = [];
    w.begin();
    for (const a of system) applySystem(w, a);
    for (const a of actions) {
      const c = w.chars.find((x) => x.player === a.player);
      if (!c) continue;
      c.lastSeq = a.seq; // consumed first, refused or not (§15.3)
      const fail = (reason: number, pos?: { x: number; y: number }, serial = 0) =>
        w.emit(
          { seq: a.seq, player: a.player },
          {
            type: 'action_failed',
            reason,
            pos: pos ?? { x: Math.floor(c.x * 256 + 0.5), y: Math.floor(c.y * 256 + 0.5) },
            serial,
          },
        );
      let act: ReturnType<typeof decodeAction>;
      try {
        act = decodeAction(a.type, a.payload);
      } catch {
        fail(1); // malformed (§15.3)
        continue;
      }
      if (!SUPPORTED_ACTIONS.has(act.type)) {
        fail(2); // unsupported: outside the capability manifest (§2.4)
        continue;
      }
      // Presence (§15.3 "the player must exist and be online"): an offline player's action is refused.
      if (!c.online) {
        fail(3); // player_not_present
        continue;
      }
      // Input fencing (§15.3, D22): a held input of another generation is a no-op with an event; its seq is consumed.
      if ('input_gen' in act && act.input_gen !== c.inputGen) {
        w.emit({ seq: a.seq, player: a.player }, { type: 'input_fenced' });
        continue;
      }
      const r = applyAction(w, c, a.seq, act);
      if (r) fail(r.reason, r.pos, r.serial ?? 0);
      else {
        c.lastActionTick = w.tick;
        sortMain(w, c); // auto-sort at every step boundary (I §3.8)
      }
    }
    w.end();
  }

  /** Requests an extraction without ticks (§3.3, B1-r1 12): within 16 ms of a view or subscription change. */
  private soon(): void {
    if (!this.world) return;
    if (this.free.length === 0) {
      this.extractSoon = true;
      return;
    }
    this.extractSoon = false;
    if (this.paused) this.extract(false);
  }

  /** Writes one packet into a pooled buffer, fills state_gen and view_seq, and transfers it (§15.4). */
  private extract(first: boolean): void {
    const w = this.world;
    if (!w) return;
    if (!first && this.free.length === 0) return; // backpressure: skip; nothing is lost (§3.2)
    const bytes = this.x.extract(w);
    let buf = this.free.pop() ?? new ArrayBuffer(BUFFER_BYTES);
    if (buf.byteLength < bytes.length) {
      let size = buf.byteLength;
      while (size < bytes.length) size *= 2;
      buf = new ArrayBuffer(size);
    }
    const out = new Uint8Array(buf);
    out.set(bytes);
    const v = new DataView(buf);
    v.setUint32(PACKET_STATE_GEN_OFFSET, this.gen, true);
    v.setUint32(PACKET_VIEW_SEQ_OFFSET, first ? 0 : this.viewSeq, true);
    this.host.post({ t: 'pkt', buf }, [buf]);
  }
}

/**
 * A system action of the closure (§15.3), as the reference model applies it (test/golden/model/rules.ts
 * `applySystem`; README rules 8–9; GATE-r3 #3): `player_joined` creates a character or brings an offline one back
 * (joining while online changes nothing); `player_left` releases held inputs, marks the player offline and returns
 * the hand to the main inventory only if all of it fits (§5.1); `release_inputs` releases held inputs. Releasing
 * stops walking and mining and raises the input generation, also for an offline player.
 */
function applySystem(w: FakeWorld, a: Action): void {
  if (!('player' in a)) return; // snapshot_marker, debug_dump: nothing in the World
  const c = w.chars.find((x) => x.player === a.player);
  const release = (ch: NonNullable<typeof c>): void => {
    ch.walking = false;
    ch.mining = null;
    ch.miningProgress = 0;
    ch.inputGen = (ch.inputGen + 1) & 0xffff;
  };
  switch (a.type) {
    case 'player_joined':
      if (c) {
        if (c.online) return;
        c.online = true;
      } else w.join(a.player);
      w.emit({ seq: 0, player: a.player }, { type: 'player_joined' });
      return;
    case 'player_left': {
      if (!c) return;
      release(c);
      if (!c.online) return;
      c.online = false;
      returnHand(w, c);
      w.emit({ seq: 0, player: a.player }, { type: 'player_left' });
      return;
    }
    case 'release_inputs':
      if (c) release(c);
      return;
    default:
      return;
  }
}

/** The hand back into the main inventory if all of it fits, the origin slot first (§5.1; rule 9); else it stays. */
function returnHand(w: FakeWorld, c: FakeWorld['chars'][number]): void {
  if (c.hand.ghost) {
    c.hand = { key: 0xffff, count: 0, origin: 0xffff, ghost: false };
    return;
  }
  if (c.hand.count === 0) return;
  const key = c.hand.key;
  const stack = w.p.stack(key);
  const free = { slots: c.main, bar: c.main.length, origin: -1 };
  if (room(free, key, c.hand.count, stack) < c.hand.count) return;
  let left = c.hand.count;
  const origin = c.hand.origin !== 0xffff ? c.hand.origin : -1;
  if (origin >= 0) {
    const s = c.main[origin];
    if (s && (s.count === 0 || s.key === key)) {
      const k = Math.min(left, stack - s.count);
      s.key = key;
      s.count += k;
      left -= k;
    }
  }
  c.hand = { key: 0xffff, count: 0, origin: 0xffff, ghost: false };
  insert(free, key, left, stack);
  sortMain(w, c);
}
