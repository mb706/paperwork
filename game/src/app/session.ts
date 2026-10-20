// The game session (UI wiring, C5; 10 §3.1–§3.4): the main thread's side of one world. Each new game or load
// starts a fresh sim worker in a new state generation (S11, S15, IMPL-10), boots it, creates or loads the world,
// and on `bound` hands the UI a port (actions, subscriptions, the view request) and the player's last seq. Every
// packet of the current generation is decoded once and given to the UI, then its buffer goes back (`ack`);
// packets and responses of other generations are dropped (§3.4). Exiting terminates the worker.
//
// Backends: `fake` runs the fake sim (src/simworker/fake.ts, 10 §15.10) on the dev server's M1 build; `real` runs
// src/app/workers/sim.ts (the shell, C3). In M0 only the fake runs worlds, so dev builds default to it; the shell
// package switches the default when the real worker answers `world`. Saves: the fake keeps a save's bytes in its
// worker (no IO worker), so the session lists the saves made this session as not loadable; the IO worker (C3)
// supplies loadable ones.
import { NewWorldCodec } from '../shared/gen/abi.ts';
import { decodePacket, type Packet } from '../shared/gen/packet.ts';
import type { PrototypesJson } from '../shared/gen/protos.ts';
import { readPrototypesBin } from '../shared/gen/protos.ts';
import type { BuildManifest, MainToSim, SeqOp, SimToMain } from '../shared/protocol.ts';
import type { SaveEntry, SessionApi, SimPort, UiHandle } from '../ui/index.ts';

export type Backend = 'fake' | 'real';

export interface SessionOptions {
  backend: Backend;
  /** `?test=1`: the clock stops; `step(n)` runs ticks (10 §3.3 test mode). */
  test: boolean;
  /** The fake's day length in ticks, 0 for its default (`?fakeDay=N`). */
  fakeDay: number;
  /** The page's build manifest (the real worker's boot). */
  build: BuildManifest;
  /** The compiled sim.wasm for the real backend. */
  module: () => Promise<WebAssembly.Module | null>;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function bytes(url: string): Promise<Uint8Array | null> {
  const r = await fetch(url);
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

export class Session implements SessionApi {
  private ui: UiHandle | null = null;
  private worker: Worker | null = null;
  private gen = 0;
  private seed = 0;
  private saveId = 0;
  private readonly saves: SaveEntry[] = [];
  private readonly pendingSaves = new Map<number, (ok: boolean) => void>();
  private menuPaused = false;
  private userPaused = false;
  private readonly opts: SessionOptions;
  /** Packets applied so far in this world (tests). */
  packets = 0;
  private readonly packetListeners: ((p: Packet) => void)[] = [];
  tick = 0;

  constructor(opts: SessionOptions) {
    this.opts = opts;
  }

  /** Other consumers of the current world's packets (the renderer, audio), after the UI; returns the remover. */
  onPacket(f: (p: Packet) => void): () => void {
    this.packetListeners.push(f);
    return () => {
      const i = this.packetListeners.indexOf(f);
      if (i >= 0) this.packetListeners.splice(i, 1);
    };
  }

  attach(ui: UiHandle): void {
    this.ui = ui;
  }

  private post(m: MainToSim, transfer: Transferable[] = []): void {
    this.worker?.postMessage(m, { transfer });
  }

  /** The port the UI talks to the current world through (§3.2): every message carries this generation. */
  private port(gen: number): SimPort {
    return {
      act: (firstSeq, actions) => this.post({ t: 'act', gen, firstSeq, actions }, [actions]),
      sub: (subs) => this.post({ t: 'sub', gen, subs }),
      unsub: (ids) => this.post({ t: 'unsub', gen, ids }),
      view: (v) => this.post({ t: 'view', gen, v }),
    };
  }

  control(op: SeqOp): void {
    if (op === 'pause' || op === 'resume') this.userPaused = op === 'pause';
    if ((op === 'resume' && this.menuPaused) || this.opts.test) {
      if (typeof op === 'object' && 'step' in op) this.post({ t: 'seq', op });
      return;
    }
    this.post({ t: 'seq', op });
  }

  /** Test mode: run n ticks now (10 §3.3). */
  step(n: number): void {
    this.post({ t: 'seq', op: { step: n } });
  }

  newGame(seed: number): void {
    this.seed = seed;
    void this.start({ op: 'new', seed });
  }

  loadSave(_id: string): void {
    this.ui?.notice(null);
    // No loadable saves exist before the IO worker (C3); the menu lists none as loadable.
  }

  async listSaves(): Promise<SaveEntry[]> {
    return [...this.saves].sort((a, b) => b.date - a.date);
  }

  saveGame(): Promise<boolean> {
    if (!this.worker) return Promise.resolve(false);
    const id = ++this.saveId;
    this.post({ t: 'save', id, reason: 'manual' });
    return new Promise((resolve) => {
      this.pendingSaves.set(id, resolve);
      setTimeout(() => {
        if (this.pendingSaves.delete(id)) resolve(false);
      }, 10_000);
    });
  }

  exitToMenu(): void {
    this.stop();
    this.ui?.unbound();
  }

  setMenuPause(paused: boolean): void {
    if (this.menuPaused === paused) return;
    this.menuPaused = paused;
    if (this.opts.test || !this.worker) return;
    if (paused) this.post({ t: 'seq', op: 'pause' });
    else if (!this.userPaused) this.post({ t: 'seq', op: 'resume' });
  }

  async storage(): Promise<{ used: number; quota: number } | null> {
    try {
      const e = await navigator.storage?.estimate?.();
      return e && typeof e.usage === 'number' && typeof e.quota === 'number'
        ? { used: e.usage, quota: e.quota }
        : null;
    } catch {
      return null;
    }
  }

  private stop(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const r of this.pendingSaves.values()) r(false);
    this.pendingSaves.clear();
    this.menuPaused = false;
    this.userPaused = false;
  }

  private fail(message: string): void {
    console.error(`session: ${message}`);
    this.stop();
    this.ui?.unbound();
    this.ui?.notice(message);
  }

  /** A fresh worker and state generation per world (§3.1, §3.4). */
  private async start(world: { op: 'new'; seed: number }): Promise<void> {
    const ui = this.ui;
    if (!ui) return;
    this.stop();
    ui.notice(null);
    ui.loading(0.05);
    const gen = ++this.gen;
    this.packets = 0;
    let build = this.opts.build;
    try {
      if (this.opts.backend === 'fake') {
        // The fake runs on the dev server's M1 build (10 §15.10); the UI names things from the same build.
        const [manifest, protos, bin] = await Promise.all([
          json<BuildManifest>('/data/fake/build-manifest.json'),
          json<PrototypesJson>('/data/fake/prototypes.json'),
          bytes('/data/fake/prototypes.bin'),
        ]);
        // `?fakeDay=N` shortens the fake's day to N ticks (Factorio's is 25,000), to see the night and the lamps.
        build = this.opts.fakeDay > 0 ? { ...manifest, fake: { dayTicks: this.opts.fakeDay } } : manifest;
        ui.setPrototypes(protos, characterFacts(protos, bin));
      } else {
        const [protos, bin] = await Promise.all([
          json<PrototypesJson>('/data/prototypes.json'),
          bytes('/data/prototypes.bin'),
        ]);
        ui.setPrototypes(protos, characterFacts(protos, bin));
      }
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
      return;
    }
    if (gen !== this.gen) return;
    ui.loading(0.3);
    const worker =
      this.opts.backend === 'fake'
        ? new Worker(new URL('./workers/fake-sim.ts', import.meta.url), { type: 'module', name: 'sim' })
        : new Worker(new URL('./workers/sim.ts', import.meta.url), { type: 'module', name: 'sim' });
    this.worker = worker;
    worker.addEventListener('error', (e) => this.fail(e.message));
    worker.addEventListener('message', (e: MessageEvent<SimToMain>) => {
      if (this.worker !== worker) return;
      this.onMessage(gen, e.data, world);
    });
    const module = this.opts.backend === 'real' ? await this.opts.module() : null;
    if (this.worker !== worker) return;
    this.post({ t: 'boot', build, module, ioPort: null, genPorts: [] });
  }

  private onMessage(gen: number, m: SimToMain, world: { op: 'new'; seed: number }): void {
    const ui = this.ui;
    if (!ui) return;
    switch (m.t) {
      case 'ready':
        ui.loading(0.6);
        if (this.opts.test) this.post({ t: 'seq', op: 'pause' });
        this.post({
          t: 'world',
          gen,
          op: 'new',
          settings: { ...NewWorldCodec.defaults(), seed: world.seed },
        });
        return;
      case 'bound': {
        if (m.gen !== gen) return;
        ui.loading(0.9);
        const me = m.players.find((p) => p.index === 0);
        ui.bound(this.port(gen), 0, me?.lastSeq ?? 0);
        return;
      }
      case 'pkt': {
        const len = new DataView(m.buf).getUint32(24, true);
        try {
          const p = decodePacket(new Uint8Array(m.buf, 0, len));
          if (p.header.state_gen === gen) {
            this.packets += 1;
            this.tick = p.header.tick;
            ui.packet(p);
            for (const f of this.packetListeners) f(p);
          }
        } catch (err) {
          console.error('session: packet', err);
        }
        this.post({ t: 'ack', buf: m.buf }, [m.buf]);
        return;
      }
      case 'saved': {
        const done = this.pendingSaves.get(m.id);
        this.pendingSaves.delete(m.id);
        this.saves.push({
          id: `${gen}-${m.id}`,
          name: String(this.seed),
          tick: this.tick,
          date: Date.now(),
          loadable: false,
        });
        done?.(true);
        return;
      }
      case 'trap':
        if (m.gen === gen) this.fail(m.message);
        return;
      case 'log':
        (m.level === 'error' ? console.error : m.level === 'warn' ? console.warn : console.info)(m.msg);
        return;
      default:
        return;
    }
  }
}

/** The character's reach and build distances from prototypes.bin (I §3.1), for the UI's reach hints. */
function characterFacts(json: PrototypesJson, bin: Uint8Array | null) {
  const id = json.entity.findIndex((e) => e.type === 'character');
  if (!bin || id < 0) return undefined;
  try {
    const row = readPrototypesBin(bin, undefined, []).entity[id];
    if (!row) return undefined;
    return {
      reach: row.reach_distance || 10,
      build: row.build_distance || 10,
      resourceReach: row.resource_reach_distance || 2.7,
    };
  } catch {
    return undefined;
  }
}
