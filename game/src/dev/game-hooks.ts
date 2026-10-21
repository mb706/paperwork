// `window.__game` (10 §3.5): in dev builds, and in production builds behind `?dev=1`. Deterministic tests drive
// the game through it whatever the frame rate: in test mode (`?test=1`) the clock stops and `step(n)` closes n
// ticks, runs them synchronously and resolves with the tick after them, once their packet went out (§3.3); each
// step is answered by its own reply, and steps run one after another (C3-r1 12). The simulation hooks are here;
// the renderer and the UI register theirs (`ui`, `render`, `camera`, `loadScenario`) with `register`. The dev
// server's report and screenshot endpoints (§3.5) come with them: `report()`, `shot()` and Ctrl+Alt+F12
// (src/dev/report.ts, C8).

import type { BoundInfo, BugBundle, SimHost } from '../app/sim-host.ts';
import { AllocStatsCodec } from '../shared/gen/abi.ts';
import { type Action, actionBytes } from '../shared/gen/actions.ts';
import {
  DigestResultCodec,
  InspectParamsCodec,
  type InspectResult,
  InspectResultCodec,
  QueryHeaderCodec,
  QueryKind,
  StateHashCodec,
} from '../shared/gen/projections.ts';
import { captureConsole, installReportKey, type ReportResult, sendReport, sendShot } from './report.ts';

const hex16 = (v: bigint): string => v.toString(16).padStart(16, '0');

export interface GameHooks {
  /** Closes n ticks, runs them and resolves with the world's tick after them (test mode). */
  step(n: number): Promise<number>;
  /** An action, encoded and submitted to the sequencer: it runs in the next tick. Returns its seq. */
  dispatch(action: Action): number;
  /** A query (§15.5): `u16 kind, u16 flags`, then its parameters. */
  query(q: Uint8Array): Promise<{ ok: boolean; value: Uint8Array }>;
  /** The full state hash (§4.8), hex. */
  hash(): Promise<string>;
  /** This tick's digest and the rolling digest (§4.8), hex. */
  digest(): Promise<{ tick: number; d: string; r: string }>;
  /** The counting allocator's totals (§2.5); null without simcheck. */
  allocs(): Promise<{
    allocations: string;
    deallocations: string;
    liveBytes: string;
    peakBytes: string;
  } | null>;
  /** Linear memory's size and the pool directory's (§3.6). */
  memory(): Promise<unknown>;
  save(name?: string): Promise<unknown>;
  /** Loads a save container's bytes into a fresh worker (§3.4). */
  load(buf: ArrayBuffer | Uint8Array): Promise<BoundInfo>;
  /** Every saved field of one entity (the `inspect` query, §15.5). */
  inspect(serial: number): Promise<InspectResult | null>;
  speed(x: number): void;
  pause(): void;
  resume(): void;
  /** Replays a closure log from a save (§8.5): resolves with the replay's verdict. */
  replay(log: ArrayBuffer | Uint8Array, save: ArrayBuffer | Uint8Array): Promise<unknown>;
  exportBugBundle(): Promise<BugBundle>;
  /** NO_SLEEP, for tests only (§4.6). */
  flags(f: { noSleep: boolean }): Promise<void>;
  /** The dev-only panic (§12 M0 exit): the next tick traps; the trap notice, recovery and a bundle follow. */
  panic(): Promise<void>;
  /** The last packet's tick. */
  tick(): number;
  /** *Take over* the saves from another tab (§8.2). */
  takeOver(): void;
  /** A bug report to the dev server (`POST /__report`, §3.5): the bundle, console, screenshot; also Ctrl+Alt+F12. */
  report(note?: string): Promise<ReportResult>;
  /** A screenshot of the world to the dev server (`POST /__shot`, §3.5). */
  shot(name?: string): Promise<string>;
  /** Other layers' hooks (`ui.open`, `render.frame`, `camera`, `loadScenario` …). */
  register(more: Record<string, unknown>): void;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __game?: GameHooks;
  }
}

const bytes = (b: ArrayBuffer | Uint8Array): Uint8Array => (b instanceof Uint8Array ? b : new Uint8Array(b));

export function gameHooks(host: SimHost): GameHooks {
  const res = async (m: Promise<unknown>): Promise<Uint8Array> => {
    const r = (await m) as { t: string; ok?: boolean; value?: ArrayBuffer };
    if (r.t !== 'res' || !r.ok) throw new Error(new TextDecoder().decode(r.value ?? new ArrayBuffer(0)));
    return new Uint8Array(r.value as ArrayBuffer);
  };
  const hooks: GameHooks = {
    step: (n) => host.step(n),
    dispatch: (a) => host.act(actionBytes(a)),
    query: (q) => host.query(q),
    async hash() {
      return hex16(StateHashCodec.decode(await res(host.dev({ op: 'hash' }))).hash);
    },
    async digest() {
      const d = DigestResultCodec.decode(await res(host.dev({ op: 'digest' })));
      return { tick: d.tick, d: hex16(d.d), r: hex16(d.r) };
    },
    async allocs() {
      const r = (await host.dev({ op: 'allocs' })) as { t: string; ok?: boolean; value?: ArrayBuffer };
      if (r.t !== 'res' || !r.ok || !r.value) return null;
      const a = AllocStatsCodec.decode(new Uint8Array(r.value));
      return {
        allocations: a.allocations.toString(),
        deallocations: a.deallocations.toString(),
        liveBytes: a.live_bytes.toString(),
        peakBytes: a.peak_bytes.toString(),
      };
    },
    async memory() {
      return JSON.parse(new TextDecoder().decode(await res(host.dev({ op: 'memory' }))));
    },
    save: (name) => (name ? host.save('manual', name) : host.save('auto')),
    load: (buf) => host.loadBytes(bytes(buf)),
    async inspect(serial) {
      const q = new Uint8Array(QueryHeaderCodec.SIZE + 4);
      q.set(QueryHeaderCodec.encode({ kind: QueryKind.inspect, flags: 0 }), 0);
      q.set(InspectParamsCodec.encode({ serial }), QueryHeaderCodec.SIZE);
      const r = await host.query(q);
      return r.ok ? InspectResultCodec.decode(r.value) : null;
    },
    speed: (x) => host.control({ speed: x }),
    pause: () => host.control('pause'),
    resume: () => host.control('resume'),
    replay: (log, save) => host.replay({ bytes: bytes(save) }, bytes(log)),
    exportBugBundle: () => host.exportBugBundle(),
    async flags(f) {
      await res(host.dev({ op: 'flags', noSleep: f.noSleep }));
    },
    async panic() {
      await res(host.dev({ op: 'panic' }));
    },
    tick: () => host.lastTick,
    takeOver: () => host.takeOver(),
    report: (note) => sendReport(host, note),
    shot: (name) => sendShot(name),
    register(more) {
      Object.assign(hooks, more);
    },
  };
  return hooks;
}

/** Installs `window.__game` (dev builds, or `?dev=1`). */
export function installGameHooks(host: SimHost): GameHooks {
  captureConsole();
  installReportKey(host);
  const hooks = gameHooks(host);
  window.__game = hooks;
  return hooks;
}
