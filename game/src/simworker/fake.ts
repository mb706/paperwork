// The fake sim worker (10 §15.10): speaks the protocol of §3.2 and writes packets with the generated
// encoders, so the renderer, the UI and audio can be built before the sim exists. `?sim=fake` selects it.
//
// It follows the world-replacement protocol (§3.4: `bound`, then an unsolicited FULL packet; every message
// carries its state generation), the LocalSequencer's pacing and seq rules (§3.3), the packet pool with acks
// (§15.4), extraction without ticks after view and subscription messages, and the explicit errors of the
// capability manifest (§2.4): unsupported actions, projections and queries are refused as the real sim
// refuses them. It is deterministic: the same seed, actions and ticks give the same packets (`seq step`
// runs ticks synchronously, as `__game.step(n)` does in test mode).
import { decodeAction } from '../shared/gen/actions.ts';
import { SUPPORTED_ACTIONS } from '../shared/gen/capabilities.ts';
import { QueryKind } from '../shared/gen/projections.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import { ABI_VERSION, SCHEMA_HASH } from '../shared/gen/schema.ts';
import type { MainToSim, SimToMain } from '../shared/protocol.ts';
import { PACKET_STATE_GEN_OFFSET, PACKET_VIEW_SEQ_OFFSET } from '../shared/protocol.ts';
import { FakeExtractor } from './fake/extract.ts';
import { FakeProtos } from './fake/protos.ts';
import { applyFakeAction, type FakeOptions, FakeWorld } from './fake/world.ts';

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

export class FakeSim {
  private readonly host: FakeHost;
  private protos: FakeProtos | null = null;
  private world: FakeWorld | null = null;
  private readonly x = new FakeExtractor();
  private gen = 0;
  private viewSeq = 0;
  private pending: { player: number; seq: number; type: number; payload: Uint8Array }[] = [];
  private lastSeq = 0;
  private readonly free: ArrayBuffer[] = [];
  private paused = false;
  private speed = 1;
  private clockGen = 0;
  private t0 = 0;
  private tick0 = 0;
  private timer: unknown = null;
  private extractSoon = false;
  /** Options for the next world (the dev page's `?fakeDay=` and the like). */
  options: FakeOptions = {};

  constructor(host: FakeHost) {
    this.host = host;
    for (let i = 0; i < BUFFERS; i++) this.free.push(new ArrayBuffer(BUFFER_BYTES));
  }

  get tick(): number {
    return this.world?.tick ?? 0;
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
        if (!this.protos.realSounds)
          this.log(
            'info',
            'the build has no working sounds yet: AUDIO_WORKING carries stand-in sound ids (prototype ids)',
          );
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
        if (m.op === 'load') this.log('warn', 'the fake sim cannot load a save: it starts a new world');
        this.gen = m.gen;
        const seed = m.op === 'new' ? m.settings.seed : 1;
        this.world = new FakeWorld(this.protos, seed, this.options);
        this.x.reset();
        this.pending = [];
        this.lastSeq = 0;
        this.host.post({
          t: 'bound',
          gen: this.gen,
          tick: 0,
          players: this.world.chars.map((c) => ({ index: c.player, lastSeq: 0, inputGen: 0 })),
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
      case 'save':
        // The fake's world is not a World: there is nothing to save, and no `saved` follows.
        return this.log('warn', 'the fake sim does not save');
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
      this.pending.push({ player: 0, seq, type, payload: bytes.slice(at + 4, at + 4 + len) });
      this.lastSeq = seq;
      seq++;
      at += 4 + len;
    }
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
    w.begin();
    for (const a of actions) {
      const c = w.chars.find((x) => x.player === a.player);
      if (!c) continue;
      c.lastSeq = a.seq;
      const fail = (reason: number) =>
        w.emit(
          { seq: a.seq, player: a.player },
          {
            type: 'action_failed',
            reason,
            pos: { x: Math.round(c.x * 256), y: Math.round(c.y * 256) },
            serial: 0,
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
      const r = applyFakeAction(w, c, act);
      if (r === 'not modelled') this.log('info', `${act.type} is not modelled; it changes nothing`);
      else if (r !== 'applied') fail(r.reason);
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
