// The director (A4 §5, 10 §9.4) on fakes: the charter piece from its recording, a piece waiting for its
// samples (the silence extended), the music keys crossfading era slots, the end of a game, reduced audio.
import { describe, expect, test } from 'vitest';
import { BankClient, type PortLike } from '../bank-client.ts';
import type { PackLoader } from '../loading/packs.ts';
import type { MixerGraph } from '../mixer/graph.ts';
import type { ToBank } from '../worklet/protocol.ts';
import { Conductor } from './conductor.ts';
import { Director, type RecordedMusic } from './director.ts';
import { MusicEngine } from './engine.ts';
import type { LoadedPack } from './instruments.ts';
import { Scheduler } from './scheduler.ts';

const tick = () => new Promise((r) => setTimeout(r, 5));

function world(o: { recording?: boolean; ready?: boolean; reduced?: boolean } = {}) {
  const clock = { t: 0 };
  const msgs: ToBank[] = [];
  const port: PortLike = { onmessage: null, postMessage: (m: ToBank) => msgs.push(m) };
  const bank = new BankClient(port);
  const pack: LoadedPack = {
    kind: 'oneshot',
    layers: 1,
    makeupDb: 0,
    zones: [{ id: 1, root: 60, layer: 0, seconds: 6 }],
  };
  const readyEras = new Set<string>(o.ready === false ? [] : ['era1', 'era2']);
  const loads: string[] = [];
  const packs = {
    pack: () => pack,
    stereo: () => false,
    ready: (era: string) => readyEras.has(era),
    loadEra: (era: string) => {
      loads.push(era);
      return Promise.resolve();
    },
    retain: () => {},
  } as unknown as PackLoader;
  const engine = new MusicEngine(bank, () => clock.t, packs);
  const scheduler = new Scheduler(
    () => clock.t,
    () => bank.flush(),
    () => 0,
  );
  const fades: [number, number, number][] = [];
  const mixer = {
    configureSlot: () => {},
    fadeSlot: (slot: number, db: number, seconds: number) => fades.push([slot, db, seconds]),
  } as unknown as MixerGraph;
  const played: string[] = [];
  const stopped: number[] = [];
  const recorded: RecordedMusic = {
    play: (name) => {
      played.push(name);
      return Promise.resolve(true);
    },
    stop: (f) => stopped.push(f),
    forEra: (piece) => (o.recording && piece === 'era1' ? [{ name: 'charter', seconds: 153 }] : []),
    has: (name) => !!o.recording && name === 'charter',
  };
  const director = new Director({
    conductor: new Conductor({ seed: 3, available: ['era1', 'era2'] }),
    engine,
    scheduler,
    mixer,
    bank,
    packs,
    recorded,
    eras: [{ from: Number.NEGATIVE_INFINITY, piece: 'era1', name: 'I', typicalWatts: 1e6 }],
    busDb: { era1: 13.6 },
    reduced: !!o.reduced,
    now: () => clock.t,
  });
  return { clock, msgs, director, scheduler, fades, played, stopped, readyEras, loads };
}

describe('the director', () => {
  test("a game's first piece is the charter piece, from its recording", async () => {
    const w = world({ recording: true });
    w.director.start(0);
    w.director.tick(0);
    await tick();
    expect(w.played).toEqual(['charter']);
    expect(w.director.playing).toMatchObject({ piece: 'era1', recorded: true });
    expect(w.scheduler.procs.size).toBe(0);
  });

  test('without a recording the charter piece is generative; it waits until its samples are decoded', async () => {
    const w = world({ ready: false });
    w.director.start(0);
    w.director.tick(0);
    await tick();
    expect(w.scheduler.procs.size).toBe(0);
    expect(w.loads).toContain('era1');
    w.readyEras.add('era1');
    w.clock.t = 1.2;
    w.director.tick(1.2);
    await tick();
    expect(w.scheduler.procs.size).toBe(1);
    expect(w.director.playing).toMatchObject({ piece: 'era1', slot: 0, recorded: false });
    expect(w.fades.at(-1)).toEqual([0, 13.6, 0]);
    const layouts = w.msgs.filter((m) => m.t === 'layout');
    expect(layouts.length).toBe(1);
  });

  test('play-next-track crossfades to the other slot; ending the game fades everything', async () => {
    const w = world();
    w.director.start(0);
    w.director.tick(0);
    await tick();
    expect(w.director.playing.slot).toBe(0);
    w.clock.t = 30;
    w.director.next();
    await tick();
    expect(w.director.playing.slot).toBe(1);
    expect(w.fades).toContainEqual([0, Number.NEGATIVE_INFINITY, 1.5]);
    expect(w.msgs.some((m) => m.t === 'clear' && m.slot === 0)).toBe(true);
    // previous: the charter piece once more
    w.clock.t = 40;
    w.director.previous();
    await tick();
    expect(w.director.playing.seg?.params?.seed).toBe(1945);
    w.director.stop(2);
    expect(w.fades.at(-1)?.[1]).toBe(Number.NEGATIVE_INFINITY);
    expect(w.director.running).toBe(false);
  });

  test('reduced audio plays recordings only', async () => {
    const w = world({ recording: true, reduced: true });
    w.director.start(0);
    w.director.tick(0);
    await tick();
    expect(w.played).toEqual(['charter']);
    expect(w.msgs.filter((m) => m.t === 'layout').length).toBe(0);
  });
});
