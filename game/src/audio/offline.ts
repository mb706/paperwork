// Rendering one piece (and an SFX load) through the runtime's own engine, offline or live (A4 §6.1, §6.3;
// 10 §9.4): the voice bank worklet (with the rooms' FDN reverbs), the native mixer, the scheduler and the
// rule sets.
// - Offline (OfflineAudioContext): the menu loop and recorded fallbacks, the analysis renders that check the
//   engine against A4's approved demos, and bench.html's offline load on the player's machine (§9.4: the
//   render time as a share of the audio's duration, on average and in the worst second).
// - Live (AudioContext): the realtime CPU benchmark, measured from outside (/proc) on this host.
import { BankClient } from './bank-client.ts';
import { makeRng } from './core/rng.ts';
import { encodePacket, StandinPacket } from './feed/standin.ts';
import type { ProtoInfo, WorkingRecord } from './feed/types.ts';
import { EVENT } from './feed/types.ts';
import { Decoder } from './loading/decode.ts';
import type { MusicManifest, SoundsManifest } from './loading/manifest.ts';
import { type Fetcher, FileLoader, httpFetcher, IdAllocator, PackLoader } from './loading/packs.ts';
import { MixerGraph } from './mixer/graph.ts';
import { defaultSettings } from './mixer/volumes.ts';
import { DEFAULT_BUS_DB } from './music/director.ts';
import { type LoggedNote, MusicEngine } from './music/engine.ts';
import { PIECES, packsOf } from './music/pieces/index.ts';
import { fdnConfig } from './music/reverb.ts';
import { Scheduler } from './music/scheduler.ts';
import type { PieceParams } from './music/types.ts';
import { SfxSystem } from './sfx/sfx.ts';
import { SoundTable } from './sfx/sounds.ts';
import { BankCore } from './worklet/bank-core.ts';
import { type BankStats, OUT_TAPS, TAP_REVERB } from './worklet/protocol.ts';

export interface OfflineDeps {
  worklets: { bank: string };
  baseUrl: string;
  music: MusicManifest | null;
  sounds: SoundsManifest | null;
  fetcher?: Fetcher;
}

export interface SfxLoad {
  /** Working sound ids sounding at once (one loop voice each; the bank's cap is 12). */
  loops: number;
  /** Working machines in view, spread over the loops. */
  machines: number;
  /** One-shot events per second, on average. */
  shotsPerSec: number;
  /** Every `burstEvery` seconds, `burst` build events in one packet (a drag-built row). */
  burst?: number;
  burstEvery?: number;
}

export interface RenderConfig {
  piece?: string;
  params?: PieceParams;
  /** The piece's duration (s). */
  duration: number;
  /** Seconds rendered after the piece (the reverb's tail). Offline only. */
  tail?: number;
  /** A constant activity, or [time, activity] automation. */
  activity?: number | [number, number][];
  sampleRate?: number;
  /** Per-channel taps of the slot (post-fader dry) and its reverb return, as extra output pairs. */
  stems?: boolean;
  sfx?: SfxLoad;
  /** Override the era bus gain (dB); default: the data's (100 % music volume, A4 §8 calibration). */
  busDb?: number;
  /** Record every note. */
  log?: boolean;
  /** The scheduler's step offline (s). */
  step?: number;
  /** Live only: the AudioContext's latency hint. */
  latencyHint?: AudioContextLatencyCategory;
  /** Live only: a running context without the engine (the benchmark's baseline). */
  bare?: boolean;
}

export interface RenderResult {
  buffer: AudioBuffer;
  notes: LoggedNote[];
  /** Names of the output pairs after the mix (stems renders). */
  stems: string[];
  /** Wall-clock ms of the render, and per second of audio. */
  ms: number;
  perSecondMs: number[];
  dropped: number;
  bank: BankStats | null;
  errors: string[];
  decodeMs: number;
}

const NO_PROTO: ProtoInfo = {
  entitySize: () => 1,
  minedKind: () => 'entity',
  isDeveloperReason: () => false,
};

interface Assembly {
  clock: { sim: number | null };
  bank: BankClient;
  bankNode: AudioWorkletNode;
  mixer: MixerGraph;
  engine: MusicEngine;
  scheduler: Scheduler;
  files: FileLoader;
  stems: string[];
  decodeMs: number;
}

/** The engine on a context: worklets, mixer, packs and SFX loaded, the piece added to the scheduler. */
const NO_SIM = (): { sim: number | null } => ({ sim: null });

async function assemble(
  ctx: BaseAudioContext,
  deps: OfflineDeps,
  cfg: RenderConfig,
  out: AudioNode,
  merger: ChannelMergerNode | null,
): Promise<Assembly> {
  const spec = cfg.piece ? PIECES[cfg.piece] : undefined;
  if (cfg.piece && !spec) throw new Error(`no rule set ${cfg.piece}`);
  const taps = merger && spec ? spec.layout.channels.length : 0;
  // stems: a tap per channel, and the reverb's return
  const nTaps = taps > 0 ? taps + 1 : 0;
  const clock = NO_SIM();
  await ctx.audioWorklet.addModule(deps.worklets.bank);
  const settings = defaultSettings();
  settings.volume.music = 1;
  const mixer = new MixerGraph(ctx, settings, out);
  const bankNode = new AudioWorkletNode(ctx, 'paperwork-bank', {
    numberOfInputs: 0,
    numberOfOutputs: BankCore.outputs(nTaps),
    outputChannelCount: Array(BankCore.outputs(nTaps)).fill(2),
    processorOptions: { taps: nTaps },
  });
  const bank = new BankClient(bankNode.port);
  mixer.attachBank(bankNode, bank);
  const files = new FileLoader(
    bank,
    new Decoder(32000),
    deps.fetcher ?? httpFetcher,
    deps.baseUrl,
    new IdAllocator(),
    'ogg',
  );
  const packs = new PackLoader(files);
  packs.manifest = deps.music;
  const t0 = performance.now();
  if (spec) await Promise.all(packsOf(spec).map((p) => packs.load(p, 'high')));
  let table: SoundTable | null = null;
  if (cfg.sfx && deps.sounds) {
    table = new SoundTable(withLoopAliases(deps.sounds, cfg.sfx.loops));
    await table.load(files);
  }
  await bank.sync();
  const decodeMs = performance.now() - t0;
  // the audio clock, or a simulated one while an offline render is scheduled up front (no suspend())
  const now = () => clock.sim ?? ctx.currentTime;
  const engine = new MusicEngine(bank, now, packs);
  if (cfg.log) engine.log = [];
  const scheduler = new Scheduler(now, () => bank.flush());
  const stems: string[] = [];
  const start = ctx.currentTime + 0.05;
  if (spec) {
    engine.prepare(0, spec.layout);
    mixer.configureSlot(0, {
      reverb: fdnConfig(spec.layout.reverb.preset),
      wetDb: spec.layout.reverb.wetDb,
      airDb: spec.layout.airDb,
    });
    mixer.fadeSlot(0, cfg.busDb ?? DEFAULT_BUS_DB[spec.id] ?? 0, 0, ctx.currentTime);
    if (merger) {
      bank.taps([
        ...spec.layout.channels.map((_, i) => ({ slot: 0, channel: i })),
        { slot: 0, channel: TAP_REVERB },
      ]);
      [...spec.layout.channels.map((c) => c.name), 'reverb'].forEach((name, i) => {
        const sp = ctx.createChannelSplitter(2);
        bankNode.connect(sp, OUT_TAPS + i);
        sp.connect(merger, 0, 2 + 2 * i);
        sp.connect(merger, 1, 3 + 2 * i);
        stems.push(name);
      });
    }
    const auto = typeof cfg.activity === 'number' || cfg.activity === undefined ? null : [...cfg.activity];
    engine.state.activity = typeof cfg.activity === 'number' ? cfg.activity : (auto?.[0]?.[1] ?? 0.5);
    if (auto)
      scheduler.listeners.add((t) => {
        while (auto.length > 0 && (auto[0] as [number, number])[0] <= t - start)
          engine.state.activity = (auto.shift() as [number, number])[1];
      });
    scheduler.add(spec.create(engine.host(0), { ...cfg.params, duration: cfg.duration, start }));
  }
  if (cfg.sfx && table)
    scheduler.listeners.add(sfxLoad(cfg.sfx, new SfxSystem(bank, table, now, NO_PROTO, makeRng(7)), table));
  return { clock, bank, bankNode, mixer, engine, scheduler, files, stems, decodeMs };
}

export async function renderOffline(deps: OfflineDeps, cfg: RenderConfig): Promise<RenderResult> {
  const sr = cfg.sampleRate ?? 32000;
  const total = cfg.duration + (cfg.tail ?? 8);
  const spec = cfg.piece ? PIECES[cfg.piece] : undefined;
  const taps = cfg.stems && spec ? spec.layout.channels.length : 0;
  const outCh = 2 + (cfg.stems && spec ? 2 * (taps + 1) : 0);
  const ctx = new OfflineAudioContext(outCh, Math.ceil(sr * total), sr);
  let out: AudioNode = ctx.destination;
  let merger: ChannelMergerNode | null = null;
  if (cfg.stems && spec) {
    ctx.destination.channelInterpretation = 'discrete';
    merger = ctx.createChannelMerger(outCh);
    merger.connect(ctx.destination);
    const mix = ctx.createGain();
    const sp = ctx.createChannelSplitter(2);
    mix.connect(sp);
    sp.connect(merger, 0, 0);
    sp.connect(merger, 1, 1);
    out = mix;
  }
  const a = await assemble(ctx, deps, cfg, out, merger);
  // per second of audio: the wall time between the ticks at whole seconds
  const perSecondMs: number[] = [];
  let lastSecond = 0;
  let lastWall = performance.now();
  a.scheduler.listeners.add((t) => {
    if (t >= lastSecond + 1 - 1e-9) {
      const w = performance.now();
      perSecondMs.push(w - lastWall);
      lastWall = w;
      lastSecond = Math.round(t);
    }
  });
  const r0 = performance.now();
  const buffer = await a.scheduler.renderOffline(
    ctx,
    total,
    () => a.bank.sync(),
    cfg.step ?? 0.25,
    (t) => {
      a.clock.sim = t;
    },
  );
  const ms = performance.now() - r0;
  return {
    buffer,
    notes: a.engine.log ?? [],
    stems: a.stems,
    ms,
    perSecondMs,
    dropped: a.engine.dropped,
    bank: null,
    errors: [...a.scheduler.errors, ...a.files.errors],
    decodeMs: a.decodeMs,
  };
}

export interface LiveRun {
  ctx: AudioContext;
  stats(): Promise<{ scheduler: Scheduler['stats']; dropped: number; bank: BankStats; audioTime: number }>;
  stop(): Promise<void>;
}

/** Plays a piece (and an SFX load) live, for the realtime CPU benchmark (measured from outside). */
export async function playLive(deps: OfflineDeps, cfg: RenderConfig): Promise<LiveRun> {
  const ctx = new AudioContext({
    sampleRate: cfg.sampleRate ?? 32000,
    latencyHint: cfg.latencyHint ?? 'balanced',
  });
  await ctx.resume();
  if (cfg.bare) {
    // a silent source keeps the context's render thread busy the way a playing graph does
    const src = new ConstantSourceNode(ctx, { offset: 0 });
    src.connect(ctx.destination);
    src.start();
    const zero = { ticks: 0, ms: 0, maxMs: 0 };
    const bank: BankStats = {
      t: 'stats',
      active: 0,
      maxActive: 0,
      activeMusic: 0,
      activeSfx: 0,
      stolen: 0,
      dropped: 0,
      pending: 0,
      buffers: 0,
      bytes: 0,
      quanta: 0,
    };
    return {
      ctx,
      stats: async () => ({ scheduler: zero, dropped: 0, bank, audioTime: ctx.currentTime }),
      stop: () => ctx.close(),
    };
  }
  const a = await assemble(ctx, deps, cfg, ctx.destination, null);
  a.scheduler.start();
  const t0 = ctx.currentTime;
  return {
    ctx,
    stats: async () => ({
      scheduler: { ...a.scheduler.stats },
      dropped: a.engine.dropped,
      bank: await a.bank.stats(),
      audioTime: ctx.currentTime - t0,
    }),
    stop: async () => {
      a.scheduler.stop();
      await ctx.close();
    },
  };
}

/**
 * The load generator needs `n` distinct working sounds; M0 has two loop files, so further loop sounds are
 * aliases of them (the slice will have about 14 working sounds, at most 12 sounding: 10 §9.4).
 */
export function withLoopAliases(m: SoundsManifest, n: number): SoundsManifest {
  const loops = Object.entries(m.sounds).filter(([, s]) => s.loop);
  const sounds = { ...m.sounds };
  for (let i = loops.length; i < n && loops.length > 0; i++) {
    const [name, s] = loops[i % loops.length] as [string, SoundsManifest['sounds'][string]];
    sounds[`${name}-alias-${i}`] = s;
  }
  return { ...m, sounds };
}

/**
 * A busy factory's SFX (the CPU budget's load, 10 §9.4): `loops` working sounds from `machines` machines in
 * view, one-shots at `shotsPerSec`, and bursts of builds, fed through the SFX system as render packets.
 */
export function sfxLoad(load: SfxLoad, sfx: SfxSystem, table: SoundTable): (t: number) => void {
  const loopSounds = [...table.byName.values()].filter((s) => s.def.loop);
  const rng = makeRng(42);
  const kinds = [EVENT.entity_built, EVENT.entity_mined, EVENT.entity_built] as const;
  let tick = 0;
  let next = 0;
  let nextBurst = load.burstEvery ?? 5;
  let lastT = -1;
  return (t) => {
    if (lastT < 0) {
      lastT = t;
      next = t;
      nextBurst = t + (load.burstEvery ?? 5);
    }
    tick += Math.max(1, Math.round((t - lastT) * 60));
    lastT = t;
    const events: Parameters<typeof encodePacket>[2][number][] = [];
    while (next < t) {
      events.push({
        type: kinds[rng.int(0, 2)] as number,
        tick,
        proto: 0,
        x: rng.range(-20, 20),
        y: rng.range(-12, 12),
      });
      next += rng.range(0, 2 / Math.max(0.01, load.shotsPerSec));
    }
    if (load.burst && t >= nextBurst) {
      for (let i = 0; i < load.burst; i++)
        events.push({ type: EVENT.entity_built, tick, proto: 0, x: i, y: 0 });
      nextBurst += load.burstEvery ?? 5;
    }
    const working: WorkingRecord[] = [];
    for (let i = 0; i < Math.min(load.loops, loopSounds.length); i++) {
      const s = loopSounds[i];
      if (!s) continue;
      const n = Math.max(1, Math.round(load.machines / load.loops));
      working.push({ sound: s.id, n, cx: (i / Math.max(1, load.loops - 1)) * 30 - 15, cy: 0, wsum: n * 0.7 });
    }
    sfx.onPacket(new StandinPacket(encodePacket(1, tick, events, working)));
  };
}
