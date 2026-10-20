// The director: the conductor's program played on the engine (A4 §5; 10 §9.4). It turns program segments
// into pieces in era slots, crossfades slots on the music keys, extends a silence while a piece's samples
// are still decoding, preloads the next era's packs and frees the old ones, plays the charter piece from
// its recording at the start of a game, and in reduced audio plays recordings instead of pieces.
import type { BankClient } from '../bank-client.ts';
import type { PackLoader } from '../loading/packs.ts';
import type { MixerGraph } from '../mixer/graph.ts';
import { type Conductor, type Era, eraFor, type Segment } from './conductor.ts';
import type { MusicEngine } from './engine.ts';
import { PIECES } from './pieces/index.ts';
import { fdnConfig } from './reverb.ts';
import type { Scheduler } from './scheduler.ts';
import type { Piece, PieceSpec } from './types.ts';

/** Era bus gains (dB) so a piece measures −18 LUFS integrated at 100 % music (A4 §8); data overrides. */
export const DEFAULT_BUS_DB: Readonly<Record<string, number>> = { era1: 13.9, era2: 9.4, takeoff: 7.3 };
/** Fades: a skipped piece (the music keys), a closure cut (A4 §5.3), a finished piece's tail. */
const SKIP_FADE = 1.5;
const CUT_FADE = 6;

/** A recorded piece the director can play through a media element. */
export interface RecordedMusic {
  /** Plays the recording named `name` from its start; resolves false if it cannot play. */
  play(name: string): Promise<boolean>;
  stop(fadeSeconds: number): void;
  /** The recordings available for an era's pieces (reduced audio), and their lengths in seconds. */
  forEra(piece: string): { name: string; seconds: number }[];
  has(name: string): boolean;
}

interface Playing {
  seg: Segment;
  slot: number;
  piece: Piece | null;
  recorded: boolean;
}

export interface DirectorOptions {
  conductor: Conductor;
  engine: MusicEngine;
  scheduler: Scheduler;
  mixer: MixerGraph;
  bank: BankClient | null;
  packs: PackLoader | null;
  fdn: (AudioWorkletNode | null)[];
  recorded: RecordedMusic | null;
  eras: readonly Era[];
  busDb?: Readonly<Record<string, number>>;
  /** Reduced audio: recordings only. */
  reduced: boolean;
  /** The audio clock. */
  now: () => number;
}

export class Director {
  /** The audio time at which the game's music program began. */
  origin = 0;
  running = false;
  /** pause-resume-music (I §2). */
  paused = false;
  readonly history: Segment[] = [];
  private current: Playing | null = null;
  /** Slots fading out after a skip or a cut, with the time they are free again. */
  private readonly fading: (number | null)[] = [null, null];
  private lastUpdate = Number.NEGATIVE_INFINITY;
  private readonly warned = new Set<string>();
  private readonly o: DirectorOptions;

  constructor(o: DirectorOptions) {
    this.o = o;
  }

  /** A new game: the program starts at audio time `at` with the charter piece. */
  start(at: number): void {
    this.origin = at;
    this.running = true;
    this.lastUpdate = Number.NEGATIVE_INFINITY;
  }

  /** Leaving a game: everything fades. */
  stop(fade = SKIP_FADE): void {
    this.running = false;
    this.cutCurrent(fade);
  }

  /** The music time (seconds into the game's program). */
  musicTime(now = this.o.now()): number {
    return now - this.origin;
  }

  /** The scheduler's listener: once a second the conductor reads the feed (10 §15.6). */
  tick(now: number): void {
    if (!this.running) return;
    this.releaseFaded(now);
    if (this.current?.piece?.done(now)) this.finishCurrent();
    if (now - this.lastUpdate < 1 && this.current) return;
    this.lastUpdate = now;
    const t = this.musicTime(now);
    const st = this.o.engine.state;
    this.o.conductor.update(t, st);
    this.prefetch(st.literatureYear);
    const seg = this.o.conductor.at(t);
    if (!seg || seg === this.current?.seg) return;
    if (seg.kind === 'fade') {
      this.cutCurrent(CUT_FADE);
      return;
    }
    if (seg.kind === 'silence') {
      // the piece before ends by itself (its duration is the segment's); a cut one is already fading
      if (this.current && !this.current.piece) this.current = null;
      return;
    }
    this.begin(seg, now);
  }

  private begin(seg: Segment, now: number): void {
    const name = seg.piece ?? '';
    // the first piece of a game is the charter piece, from its recording (10 §9.4; A4 §5.4)
    const isCharter = seg.start === 0 && seg.params?.seed === 1945 && !seg.params.machine;
    if (this.o.recorded && (this.o.reduced || isCharter)) {
      const rec =
        isCharter && this.o.recorded.has('charter') ? 'charter' : this.o.recorded.forEra(name)[0]?.name;
      if (rec) {
        this.cutCurrent(SKIP_FADE);
        this.current = { seg, slot: -1, piece: null, recorded: true };
        this.remember(seg);
        void this.o.recorded.play(rec).then((ok) => {
          if (!ok) this.warnOnce(`rec:${rec}`, `audio: the recording ${rec} does not play`);
        });
        return;
      }
    }
    if (this.o.reduced) return;
    const spec = PIECES[name];
    if (!spec) {
      // a rule set that does not exist yet (the takeoff before M4): the segment stays silent
      this.warnOnce(`piece:${name}`, `audio: no rule set ${name}; the segment is silent`);
      this.current = { seg, slot: -1, piece: null, recorded: false };
      return;
    }
    const packs = this.o.packs;
    if (packs && !packs.ready(name)) {
      // a piece starts only when its samples are decoded; until then the silence is extended (10 §9.7)
      void packs.loadEra(name, 'high').catch(() => {});
      this.o.conductor.postpone(seg, this.musicTime(now) + 1);
      return;
    }
    this.cutCurrent(SKIP_FADE);
    const slot = this.freeSlot(now);
    this.startPiece(seg, spec, slot, now);
  }

  private startPiece(seg: Segment, spec: PieceSpec, slot: number, now: number): void {
    const { engine, mixer, scheduler } = this.o;
    engine.prepare(slot, spec.layout);
    mixer.configureSlot(slot, spec.layout.airDb, spec.layout.reverb.wetDb);
    this.o.fdn[slot]?.port.postMessage({ t: 'config', config: fdnConfig(spec.layout.reverb.preset) });
    const busDb = this.o.busDb?.[spec.id] ?? DEFAULT_BUS_DB[spec.id] ?? 0;
    mixer.fadeSlot(slot, busDb, 0, now);
    // the piece's 0 is the segment's start on the audio clock (a piece joined late drops its past notes)
    const start = Math.max(this.origin + seg.start, now + 0.05);
    const piece = spec.create(engine.host(slot), { ...seg.params, start });
    scheduler.add(piece);
    this.current = { seg, slot, piece, recorded: false };
    this.remember(seg);
  }

  private remember(seg: Segment): void {
    this.history.push(seg);
    if (this.history.length > 6) this.history.shift();
  }

  /** The free slot: one neither playing nor fading; if both are busy, the older fade is cut short. */
  private freeSlot(now: number): number {
    const busy = (s: number) => this.current?.slot === s || this.fading[s] !== null;
    for (let s = 0; s < 2; s++) if (!busy(s)) return s;
    const s = this.current?.slot === 0 ? 1 : 0;
    this.releaseSlot(s, 0.05);
    this.fading[s] = null;
    void now;
    return s;
  }

  /** Fades the current piece out over `fade` seconds; its slot frees itself afterwards. */
  private cutCurrent(fade: number): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    if (cur.recorded) {
      this.o.recorded?.stop(fade);
      return;
    }
    if (!cur.piece || cur.slot < 0) return;
    const now = this.o.now();
    this.o.scheduler.remove(cur.piece);
    this.o.mixer.fadeSlot(cur.slot, Number.NEGATIVE_INFINITY, fade, now);
    this.o.bank?.clear(cur.slot, fade);
    this.fading[cur.slot] = now + fade + 0.2;
  }

  /** A piece that ended by itself (its duration and tails are over). */
  private finishCurrent(): void {
    const cur = this.current;
    if (!cur || cur.slot < 0) return;
    this.current = { ...cur, piece: null };
    this.releaseSlot(cur.slot, 0.3);
    this.fading[cur.slot] = this.o.now() + 0.5;
  }

  private releaseSlot(slot: number, fade: number): void {
    this.o.mixer.fadeSlot(slot, Number.NEGATIVE_INFINITY, fade);
    this.o.bank?.clear(slot, fade);
  }

  private releaseFaded(now: number): void {
    for (let s = 0; s < 2; s++) {
      const until = this.fading[s];
      if (until != null && now >= until) {
        this.fading[s] = null;
        if (this.current?.slot !== s) this.o.engine.release(s);
      }
    }
  }

  /** Era II in idle time after Era I; each later era when the Literature year comes within 5 years (A4 §6.4). */
  private prefetch(year: number): void {
    const packs = this.o.packs;
    if (!packs || this.o.reduced) return;
    const eras = this.o.eras;
    const cur = eraFor(year, eras);
    const next = eras.find((e) => e.from > year && e.from - year <= 5 && e.piece !== cur.piece);
    const keep = [cur.piece];
    if (next && PIECES[next.piece]) keep.push(next.piece);
    else if (cur.piece === 'era1' && PIECES.era2) keep.push('era2');
    for (const p of keep)
      if (PIECES[p] && !packs.ready(p))
        void packs.loadEra(p, p === cur.piece ? 'high' : 'low').catch(() => {});
    // the current and the next era stay decoded; older ones are freed (shared packs stay, 10 §9.4)
    if (this.current?.seg.piece && !keep.includes(this.current.seg.piece)) keep.push(this.current.seg.piece);
    packs.retain(keep);
  }

  // ---------------------------------------------------------------- the music keys (I §2)

  /** play-next-track: the next piece now, skipping the silence. */
  next(): void {
    if (!this.running) return;
    const now = this.o.now();
    const seg = this.o.conductor.skip(this.musicTime(now), this.o.engine.state);
    if (seg) {
      this.lastUpdate = Number.NEGATIVE_INFINITY;
      this.begin(seg, now);
    }
  }

  /** play-previous-track: the piece before the current one again (up to 5 remembered). */
  previous(): void {
    if (!this.running) return;
    const now = this.o.now();
    const curSeg = this.current?.seg;
    const prev = [...this.history].reverse().find((s) => s !== curSeg && s.kind === 'piece');
    if (!prev) return;
    const seg = this.o.conductor.replay(this.musicTime(now), prev);
    if (seg) {
      this.lastUpdate = Number.NEGATIVE_INFINITY;
      this.begin(seg, now);
    }
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(msg);
  }

  /** For the dev page and tests. */
  get playing(): { piece: string | null; slot: number; recorded: boolean; seg: Segment | null } {
    const c = this.current;
    return {
      piece: c?.seg.piece ?? null,
      slot: c?.slot ?? -1,
      recorded: c?.recorded ?? false,
      seg: c?.seg ?? null,
    };
  }
}
