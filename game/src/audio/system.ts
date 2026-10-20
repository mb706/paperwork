// The audio runtime's façade (10 §9.4): what the app and the UI call. It owns the AudioContext and its
// lifecycle (user activation, resume on return, a hidden page), the worklets or reduced audio, the mixer,
// the music (conductor, director, engine) and the SFX.
//
// Starting, and what happens when it fails (10 §9.4, codex B2-r1 finding 8):
// - `preload()` at page load fetches the manifests and prepares the menu loop's media element; no context.
// - `unlock()` must run inside the first click or key handler of the main menu (07 §18): it creates the
//   AudioContext, calls resume() and starts the menu loop's play(), all synchronously in that handler.
//   If play() rejects or the context stays suspended, the state is 'blocked' and the menu shows a muted
//   speaker; the next gesture calls `unlock()` again.
// - Returning to the page (visibilitychange to visible, focus) resumes a 'suspended' or 'interrupted'
//   context unless the player muted the master. A hidden page fades the music over 1 s and suspends the
//   context, unless "Keep running in background tab" is on.
// - A missing `audioWorklet`, a rejected addModule() or a processorerror switches to reduced audio.

import type { Packet } from '../shared/gen/packet.ts';
import type { Hud } from '../shared/gen/projections.ts';
import { FailReasonCodec } from '../shared/gen/types.ts';
import { BankClient } from './bank-client.ts';
import { makeRng } from './core/rng.ts';
import { Activity } from './feed/activity.ts';
import { GenPacketView, musicFeedOf } from './feed/gen.ts';
import type { AudioPacketView, MusicFeed, ProtoInfo } from './feed/types.ts';
import { type Codec, MIME, probeCodec } from './loading/codec.ts';
import { Decoder } from './loading/decode.ts';
import type { MusicManifest, SoundsManifest } from './loading/manifest.ts';
import { type Fetcher, FileLoader, httpFetcher, IdAllocator, PackLoader } from './loading/packs.ts';
import { MixerGraph } from './mixer/graph.ts';
import { type AudioSettings, type Category, defaultSettings, sanitizeSettings } from './mixer/volumes.ts';
import { Conductor, DEFAULT_ERAS, type Era } from './music/conductor.ts';
import { DEFAULT_BUS_DB, Director, type RecordedMusic, warmUp } from './music/director.ts';
import { MusicEngine } from './music/engine.ts';
import { PIECES } from './music/pieces/index.ts';
import { Scheduler, type Ticker } from './music/scheduler.ts';
import { NativeVoices, RecordedPlayer } from './reduced.ts';
import { FootstepClock, SfxSystem } from './sfx/sfx.ts';
import { SoundTable } from './sfx/sounds.ts';
import type { ListenerView } from './sfx/spatial.ts';
import { BankCore } from './worklet/bank-core.ts';
import type { BankStats } from './worklet/protocol.ts';

export const BANK_PROCESSOR = 'paperwork-bank';
export const ENGINE_RATE = 32000;

export type AudioState = 'idle' | 'starting' | 'running' | 'blocked' | 'suspended' | 'closed';
export type AudioMode = 'full' | 'reduced';

export interface AudioOptions {
  /** The worklet modules' URLs; the app imports them as `../audio/worklet/bank.ts?worker&url` (10 §2.2). */
  worklets: { bank: string };
  /** Where the asset build's public/audio/ is served. */
  baseUrl?: string;
  fetcher?: Fetcher;
  sampleRate?: number;
  /** 'balanced' (10 §9.4). */
  latencyHint?: AudioContextLatencyCategory;
  /** The data stage's sound ids (prototypes.json's id → name table), when it has them. */
  soundIds?: readonly string[] | null;
  prototypesHash?: string | null;
  proto?: ProtoInfo;
  /** Force reduced audio (the setting, tests). */
  reduced?: boolean;
  /** The music program's seed (a new game's). */
  seed?: number;
  settings?: unknown;
}

/**
 * Until the app passes prototypes.json's facts: every entity 1×1, mined things are entities. Developer fail
 * reasons come from the schema (they have no text, so no sound, 10 §15.6).
 */
const DEFAULT_PROTO: ProtoInfo = {
  entitySize: () => 1,
  minedKind: () => 'entity',
  isDeveloperReason: FailReasonCodec.isDeveloper,
};

export interface AudioStatus {
  state: AudioState;
  mode: AudioMode;
  reducedReason: string | null;
  codec: Codec | null;
  sampleRate: number;
  piece: string | null;
  musicTime: number;
  activity: number;
  dropped: number;
  residentBytes: number;
  downloaded: number;
  scheduler: { ticks: number; ms: number; maxMs: number };
  bank: BankStats | null;
  sfx: { played: number; limited: number; historical: number; unmapped: number; loops: number };
  errors: string[];
}

class Recordings implements RecordedMusic {
  readonly players = new Map<string, RecordedPlayer>();
  private current: RecordedPlayer | null = null;
  private readonly manifest: MusicManifest;
  private readonly url: (file: string) => string;
  constructor(manifest: MusicManifest, url: (file: string) => string) {
    this.manifest = manifest;
    this.url = url;
  }
  player(name: string): RecordedPlayer | null {
    const r = this.manifest.recordings[name];
    if (!r) return null;
    let p = this.players.get(name);
    if (!p) {
      p = new RecordedPlayer(this.url(r.file));
      this.players.set(name, p);
    }
    return p;
  }
  has(name: string): boolean {
    return name in this.manifest.recordings;
  }
  forEra(piece: string): { name: string; seconds: number }[] {
    return Object.entries(this.manifest.recordings)
      .filter(([n]) => n.startsWith(`${piece}-`) || (piece === 'era1' && n === 'charter'))
      .map(([name, r]) => ({ name, seconds: r.seconds }));
  }
  attachAll(ctx: AudioContext, mixer: MixerGraph): void {
    for (const p of this.players.values()) p.attach(ctx, mixer);
  }
  async play(name: string, loop = false): Promise<boolean> {
    const p = this.player(name);
    if (!p) return false;
    this.current?.pause();
    this.current = p;
    try {
      await p.play(loop, 0);
      return true;
    } catch {
      return false;
    }
  }
  stop(fade: number): void {
    const p = this.current;
    this.current = null;
    if (p) p.fade(0, fade);
  }
}

export class AudioSystem {
  state: AudioState = 'idle';
  mode: AudioMode = 'full';
  reducedReason: string | null = null;
  ctx: AudioContext | null = null;
  readonly settings: AudioSettings;
  readonly errors: string[] = [];
  private readonly o: AudioOptions;
  private readonly base: string;
  private music: MusicManifest | null = null;
  private sounds: SoundsManifest | null = null;
  private recordings: Recordings | null = null;
  private codec: Codec | null = null;
  private mixer: MixerGraph | null = null;
  private bankNode: AudioWorkletNode | null = null;
  private bank: BankClient | null = null;
  private voices: NativeVoices | null = null;
  private files: FileLoader | null = null;
  private packs: PackLoader | null = null;
  private table: SoundTable | null = null;
  sfx: SfxSystem | null = null;
  private engine: MusicEngine | null = null;
  private scheduler: Scheduler | null = null;
  private director: Director | null = null;
  private conductor: Conductor | null = null;
  private activity: Activity;
  private eras: Era[] = [...DEFAULT_ERAS];
  private busDb: Record<string, number> = { ...DEFAULT_BUS_DB };
  private ready: Promise<void> | null = null;
  private readonly listeners = new Set<(s: AudioState) => void>();
  private keepRunning = false;
  private musicOn = true;
  private inGame = false;
  private menuWanted = false;
  private lastFeed = Number.NEGATIVE_INFINITY;
  private readonly steps = new FootstepClock();
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisibility = () => this.visibility();

  constructor(o: AudioOptions) {
    this.o = o;
    this.base = o.baseUrl ?? '/audio/';
    this.settings = o.settings ? sanitizeSettings(o.settings) : defaultSettings();
    this.activity = new Activity(this.eras);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('focus', this.onVisibility);
    }
  }

  // ---------------------------------------------------------------- start-up

  /** Fetches the manifests and prepares the menu loop's element (no AudioContext yet). */
  preload(): Promise<void> {
    this.ready ??= (async () => {
      const [music, sounds] = await Promise.all([
        this.json<MusicManifest>('music.json'),
        this.json<SoundsManifest>('sounds.json'),
      ]);
      this.music = music;
      this.sounds = sounds;
      if (sounds) {
        const eras = sounds.music.eras.map((e) => ({
          from: e.from ?? Number.NEGATIVE_INFINITY,
          piece: e.piece,
          name: e.name,
          typicalWatts: e.typicalWatts,
        }));
        if (eras.length > 0) this.eras = eras;
        for (const e of sounds.music.eras) this.busDb[e.piece] = e.busDb;
        this.activity = new Activity(this.eras);
        const mismatch = SoundTable.check(sounds, this.o.prototypesHash ?? null);
        if (mismatch) this.error(mismatch);
      }
      if (music) {
        // the media element plays Ogg Opus where the browser says it can; the probe confirms it later
        const codec: Codec =
          typeof document !== 'undefined' && document.createElement('audio').canPlayType(MIME.ogg)
            ? 'ogg'
            : 'm4a';
        this.recordings = new Recordings(music, (f) => `${this.base}${f}.${codec}`);
        this.recordings.player('charter');
      }
    })();
    return this.ready;
  }

  private async json<T>(name: string): Promise<T | null> {
    try {
      const r = await fetch(`${this.base}${name}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      this.error(`audio: ${name} unavailable (${String(e)}); run the audio asset build`);
      return null;
    }
  }

  /**
   * Inside a user activation (the first click or key, 07 §18): creates and resumes the context and starts
   * the menu loop if one is wanted. Safe to call again on every gesture while blocked.
   */
  unlock(): void {
    if (this.state === 'closed') return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({
          sampleRate: this.o.sampleRate ?? ENGINE_RATE,
          latencyHint: this.o.latencyHint ?? 'balanced',
        });
      } catch {
        // a browser that refuses the 32 kHz rate runs at its own; the bank resamples (10 §9.4)
        this.ctx = new AudioContext({ latencyHint: this.o.latencyHint ?? 'balanced' });
      }
      this.mixer = new MixerGraph(this.ctx, this.settings);
      this.ctx.addEventListener('statechange', () => this.contextState());
      this.setState('starting');
    }
    const ctx = this.ctx;
    const resumed = ctx.resume();
    if (this.recordings && this.mixer) this.recordings.attachAll(ctx, this.mixer);
    let played: Promise<unknown> = Promise.resolve();
    if (this.menuWanted && !this.inGame) played = this.recordings?.play('charter', true) ?? played;
    Promise.all([resumed, played])
      .then(() => this.init())
      .then(() => this.contextState())
      .catch(() => this.setState('blocked'));
    // a context that stays suspended after the gesture is blocked (autoplay refused)
    setTimeout(() => this.contextState(), 300);
  }

  private contextState(): void {
    const ctx = this.ctx;
    if (!ctx || this.state === 'closed') return;
    if (ctx.state === 'running') {
      if (this.state !== 'running') this.setState('running');
    } else if (ctx.state === 'closed') this.setState('closed');
    else if (document.visibilityState === 'hidden') this.setState('suspended');
    else this.setState('blocked');
  }

  private init(): Promise<void> {
    if (this.initDone) return this.initDone;
    this.initDone = this.initialise();
    return this.initDone;
  }
  private initDone: Promise<void> | null = null;

  private async initialise(): Promise<void> {
    await this.preload();
    const ctx = this.ctx as AudioContext;
    const mixer = this.mixer as MixerGraph;
    const decoder = new Decoder(ENGINE_RATE);
    // the codec probe
    const probe = await probeCodec(
      (b) => decoder.decode(b, null),
      async () => {
        const r = await fetch(`${this.base}probe.ogg`);
        if (!r.ok) throw new Error('no probe');
        return r.arrayBuffer();
      },
    );
    this.codec = probe.codec;
    // the worklets, or reduced audio
    if (this.o.reduced) this.reduce('reduced audio requested');
    else {
      try {
        if (!ctx.audioWorklet) throw new Error('no AudioWorklet (not a secure context?)');
        await ctx.audioWorklet.addModule(this.o.worklets.bank);
        this.bankNode = new AudioWorkletNode(ctx, BANK_PROCESSOR, {
          numberOfInputs: 0,
          numberOfOutputs: BankCore.outputs(),
          outputChannelCount: Array(BankCore.outputs()).fill(2),
        });
        this.bankNode.onprocessorerror = () => this.reduce('the voice bank processor failed');
        this.bank = new BankClient(this.bankNode.port);
        mixer.attachBank(this.bankNode, this.bank);
      } catch (e) {
        this.reduce(e instanceof Error ? e.message : String(e));
      }
    }
    if (!this.bank && !this.voices) this.voices = new NativeVoices(ctx, mixer);
    const engineVoices = this.bank ?? (this.voices as NativeVoices);
    this.files = new FileLoader(
      engineVoices,
      decoder,
      this.o.fetcher ?? httpFetcher,
      this.base,
      new IdAllocator(),
      this.codec,
    );
    this.packs = new PackLoader(this.files);
    this.packs.manifest = this.music;
    const now = () => ctx.currentTime;
    if (this.sounds) {
      this.table = new SoundTable(this.sounds, this.o.soundIds ?? null);
      this.sfx = new SfxSystem(
        engineVoices,
        this.table,
        now,
        this.o.proto ?? DEFAULT_PROTO,
        makeRng((this.o.seed ?? 1) ^ 0xa0d10),
      );
      void this.table.load(this.files, 'high');
    }
    this.engine = new MusicEngine(this.bank, now, this.packs);
    this.scheduler = new Scheduler(now, () => this.bank?.flush());
    this.scheduler.listeners.add((t) => {
      this.director?.tick(t);
      this.sfx?.tick();
    });
    this.scheduler.start();
    // compile the rule sets before the first generative piece (the charter piece plays from its recording)
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(() => warmUp());
    else setTimeout(warmUp, 2000);
  }

  private reduce(reason: string): void {
    if (this.mode === 'reduced') return;
    this.mode = 'reduced';
    this.reducedReason = reason;
    for (const l of this.listeners) l(this.state);
    this.error(`audio: reduced audio: ${reason}`);
    if (this.bankNode) {
      this.bankNode.disconnect();
      this.bankNode = null;
    }
    this.bank = null;
    if (this.director) {
      // a running game continues on recordings
      const wasRunning = this.director.running;
      this.director.stop(0.2);
      this.director = null;
      if (wasRunning) this.startDirector(0.5);
    }
  }

  // ---------------------------------------------------------------- the menu and the game

  /** The main menu: the charter piece on a loop, from its recording (A4 §5.4). */
  playMenu(): void {
    this.menuWanted = true;
    if (this.ctx?.state === 'running' && !this.inGame) void this.recordings?.play('charter', true);
  }

  /** A game begins: the menu loop fades, the program starts with the charter piece (A4 §5.1 rule 1). */
  startGame(seed = 1): void {
    this.inGame = true;
    this.menuWanted = false;
    this.recordings?.stop(1);
    this.o.seed = seed;
    void this.init().then(() => this.startDirector(1.2));
  }

  private startDirector(delay: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.engine || !this.scheduler || !this.mixer) return;
    this.conductor = new Conductor({ seed: this.o.seed ?? 1, available: Object.keys(PIECES) });
    this.director = new Director({
      conductor: this.conductor,
      engine: this.engine,
      scheduler: this.scheduler,
      mixer: this.mixer,
      bank: this.bank,
      packs: this.mode === 'full' ? this.packs : null,
      recorded: this.recordings,
      eras: this.eras,
      busDb: this.busDb,
      reduced: this.mode === 'reduced',
      now: () => ctx.currentTime,
    });
    this.director.start(ctx.currentTime + delay);
    // Era I during the first piece, Era II in idle time (10 §9.4)
    if (this.mode === 'full' && this.packs) {
      void this.packs
        .loadEra('era1', 'high')
        .then(() => this.packs?.loadEra('era2', 'low'))
        .catch((e: unknown) => this.error(String(e)));
    }
  }

  /** Leaving a game: the music and the loops fade. */
  endGame(): void {
    this.inGame = false;
    this.director?.stop(1.5);
    this.director = null;
    this.sfx?.reset();
    this.activity.reset();
  }

  // ---------------------------------------------------------------- feeds from the simulation

  /** Every decoded render packet of the current generation, in order (10 §15.4). */
  onPacket(p: AudioPacketView): void {
    this.sfx?.onPacket(p);
  }

  /** A render packet as the app decodes it (`decodePacket`, shared/gen/packet.ts): the usual entry point. */
  onRenderPacket(p: Packet): void {
    this.onPacket(this.packetView.set(p));
  }
  private readonly packetView = new GenPacketView();

  /** The HUD projection, about once a second: its music feed (10 §15.5–§15.6). */
  onHud(h: Hud): void {
    this.onMusicFeed(musicFeedOf(h, this.feed));
  }
  private readonly feed: MusicFeed = {
    literatureYear: 1945,
    consumptionW: 0,
    doublingTime: 0,
    closed: false,
    victory: false,
  };

  /** The HUD's music feed, about once a second (10 §15.6). */
  onMusicFeed(f: MusicFeed): void {
    const now = this.ctx?.currentTime ?? 0;
    const dt = Number.isFinite(this.lastFeed) ? now - this.lastFeed : 0;
    this.lastFeed = now;
    if (!this.engine) return;
    const st = this.engine.state;
    st.literatureYear = f.literatureYear;
    st.activity = this.activity.update(dt, f.consumptionW, f.literatureYear);
    st.doublingTime = f.doublingTime > 0 ? f.doublingTime : null;
    st.closure = f.closed;
    st.victory = f.victory;
  }

  setView(v: ListenerView): void {
    if (this.sfx) this.sfx.view = v;
    this.mixer?.setWorld(!v.mapView, 0.05);
  }

  setLocalPlayer(index: number): void {
    if (this.sfx) this.sfx.localPlayer = index;
  }

  /** A paused single-player game fades world sounds and working loops over 0.3 s; UI and music go on. */
  setPaused(paused: boolean): void {
    this.mixer?.setWorld(!paused, 0.3);
  }

  /** The interface setting "Keep running in background tab" (07 §19.3). */
  setBackgroundMode(keepRunning: boolean, ticker?: Ticker): void {
    this.keepRunning = keepRunning;
    if (ticker) this.scheduler?.setTicker(ticker);
  }

  // ---------------------------------------------------------------- sounds the UI and renderer trigger

  /** A UI sound (GUI click, tab, open and close …; I §3.12). */
  ui(name: string): boolean {
    return this.sfx?.play(name) ?? false;
  }

  /** A world sound at a position in tiles. */
  at(name: string, x: number, y: number): boolean {
    return this.sfx?.play(name, x, y) ?? false;
  }

  /** The local character walked `tiles` on a surface: footsteps follow the walk cycle (10 §9.4). */
  walk(tiles: number, surface: string, x: number, y: number): void {
    const n = this.steps.advance(tiles);
    for (let i = 0; i < n; i++) this.at(`footstep-${surface}`, x, y);
  }

  // ---------------------------------------------------------------- settings and the music keys

  setVolume(c: Category, v: number): void {
    this.settings.volume[c] = Math.min(1, Math.max(0, v));
    this.mixer?.apply(this.settings);
  }

  setMuted(c: Category, m: boolean): void {
    this.settings.muted[c] = m;
    this.mixer?.apply(this.settings);
  }

  setSettings(s: unknown): void {
    const v = sanitizeSettings(s);
    Object.assign(this.settings.volume, v.volume);
    Object.assign(this.settings.muted, v.muted);
    this.mixer?.apply(this.settings);
  }

  nextTrack(): void {
    this.director?.next();
  }

  previousTrack(): void {
    this.director?.previous();
  }

  /** pause-resume-music (I §2). */
  pauseResumeMusic(): void {
    this.musicOn = !this.musicOn;
    this.mixer?.setMusic(this.musicOn, 1);
  }

  // ---------------------------------------------------------------- page visibility

  private visibility(): void {
    const ctx = this.ctx;
    if (!ctx || this.state === 'closed') return;
    if (document.visibilityState === 'hidden') {
      if (this.keepRunning) {
        if (this.scheduler) this.scheduler.lookahead = 2.5;
        return;
      }
      this.mixer?.setMusic(false, 1);
      this.hiddenTimer = setTimeout(() => {
        if (document.visibilityState === 'hidden') void ctx.suspend();
      }, 1100);
      return;
    }
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    if (this.scheduler) this.scheduler.lookahead = 0.8;
    const st = ctx.state as AudioContextState | 'interrupted';
    if ((st === 'suspended' || st === 'interrupted') && !this.settings.muted.master)
      ctx.resume().then(
        () => this.mixer?.setMusic(this.musicOn, 1),
        () => this.setState('blocked'),
      );
    else this.mixer?.setMusic(this.musicOn, 1);
  }

  // ---------------------------------------------------------------- state and statistics

  onState(cb: (s: AudioState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setState(s: AudioState): void {
    if (this.state === s) return;
    this.state = s;
    for (const l of this.listeners) l(s);
  }

  private error(msg: string): void {
    if (this.errors.length < 50) this.errors.push(msg);
    console.warn(msg);
  }

  async status(): Promise<AudioStatus> {
    const bank = this.bank
      ? await Promise.race([this.bank.stats(), new Promise<null>((r) => setTimeout(() => r(null), 500))])
      : null;
    return {
      state: this.state,
      mode: this.mode,
      reducedReason: this.reducedReason,
      codec: this.codec,
      sampleRate: this.ctx?.sampleRate ?? 0,
      piece: this.director?.playing.piece ?? null,
      musicTime: this.director?.musicTime() ?? 0,
      activity: this.engine?.state.activity ?? 0,
      dropped: this.engine?.dropped ?? 0,
      residentBytes: this.packs?.residentBytes() ?? 0,
      downloaded: this.files?.downloaded ?? 0,
      scheduler: { ...(this.scheduler?.stats ?? { ticks: 0, ms: 0, maxMs: 0 }) },
      bank,
      sfx: { ...(this.sfx?.stats ?? { played: 0, limited: 0, historical: 0, unmapped: 0, loops: 0 }) },
      errors: [...this.errors, ...(this.files?.errors ?? [])],
    };
  }

  /** Tears everything down (a page leaving). */
  async close(): Promise<void> {
    this.scheduler?.stop();
    this.setState('closed');
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
      window.removeEventListener('focus', this.onVisibility);
    }
    await this.ctx?.close();
  }
}
