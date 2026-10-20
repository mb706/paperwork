// Reduced audio and the recordings (10 §9.4): the native voices' limits under a burst, a recording's level
// after a fade, refused plays retried on the next gesture, the probe's codec. A fake Web Audio and media
// element stand in for the browser.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MusicManifest } from './loading/manifest.ts';
import { NativeVoices, REDUCED_LOOPS, REDUCED_VOICES, RecordedPlayer } from './reduced.ts';
import { Recordings } from './system.ts';

class FakeParam {
  value: number;
  events: [string, number, number?][] = [];
  constructor(v = 1) {
    this.value = v;
  }
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['ramp', v, t]);
  }
  setTargetAtTime(v: number, t: number) {
    this.events.push(['target', v, t]);
  }
  cancelScheduledValues(t: number) {
    this.events.push(['cancel', t]);
  }
}

class FakeNode {
  connect(n: unknown) {
    return n;
  }
  disconnect() {}
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  playbackRate = new FakeParam(1);
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  started = false;
  stopAt: number | null = null;
  start() {
    this.started = true;
  }
  stop(t: number) {
    this.stopAt = t;
  }
}

class FakeContext {
  currentTime = 0;
  sources: FakeSource[] = [];
  gains: FakeParam[] = [];
  createBuffer(_ch: number, _len: number, rate: number) {
    return { sampleRate: rate, copyToChannel() {} };
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain() {
    const g = new FakeParam(1);
    this.gains.push(g);
    return Object.assign(new FakeNode(), { gain: g });
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam(0) });
  }
  createMediaElementSource() {
    return new FakeNode();
  }
}

const mixer = { sfxInput: () => new FakeNode(), recordedInput: () => new FakeNode() };

function voices() {
  const ctx = new FakeContext();
  const v = new NativeVoices(ctx as unknown as BaseAudioContext, mixer as never);
  v.buffer(1, [new Int16Array(64)], 32000);
  return { ctx, v };
}

describe('native voices (reduced audio)', () => {
  test('a burst keeps to eight voices and takes a different victim each time (C7-r1 6)', () => {
    const { ctx, v } = voices();
    for (let i = 0; i < 20; i++) v.note({ SRC: 1, DEST: 64 + 1, TYPE: i, CAP: 4, GAIN: 0.5, TIME: 0 });
    expect(v.voices).toBe(REDUCED_VOICES);
    const stopped = ctx.sources.filter((s) => s.stopAt !== null);
    expect(stopped.length).toBe(20 - REDUCED_VOICES); // twelve distinct voices made way
    expect(ctx.sources.filter((s) => s.stopAt === null).length).toBe(REDUCED_VOICES);
  });

  test("a sound's voice cap holds, as in the bank", () => {
    const { ctx, v } = voices();
    for (let i = 0; i < 6; i++) v.note({ SRC: 1, DEST: 64 + 1, TYPE: 7, CAP: 4, GAIN: 0.5, TIME: 0 });
    expect(v.voices).toBe(4);
    expect(ctx.sources.filter((s) => s.stopAt !== null).length).toBe(2);
  });

  test('loops: the four loudest, never taken by one-shots; a displaced loop is reported at the poll', () => {
    const { v } = voices();
    const loop = (h: number, g: number) =>
      v.note({ SRC: 1, DEST: 64 + 3, TYPE: 100 + h, CAP: 1, GAIN: g, HANDLE: h, LOOP_S: 0, LOOP_E: 32 });
    for (let h = 1; h <= REDUCED_LOOPS; h++) loop(h, 0.1 * h);
    for (let i = 0; i < 10; i++) v.note({ SRC: 1, DEST: 64 + 1, TYPE: i, CAP: 4, GAIN: 1, PRIO: 5 });
    const ended: number[] = [];
    v.onEnded = (h) => ended.push(...h);
    v.poll();
    expect(ended).toEqual([]); // one-shots took one-shots' voices only
    loop(9, 0.35); // louder than loop 1 (0.1)
    v.poll();
    expect(ended).toEqual([1]);
  });

  test('clearing the SFX retires every voice', () => {
    const { v } = voices();
    for (let i = 0; i < 5; i++) v.note({ SRC: 1, DEST: 64 + 1, TYPE: i, CAP: 4, GAIN: 0.5 });
    v.clear('sfx', 0.05);
    expect(v.voices).toBe(0);
  });
});

class FakeElement {
  src = '';
  preload = '';
  crossOrigin: string | null = null;
  loop = false;
  currentTime = 0;
  volume = 1;
  paused = true;
  ended = false;
  refuse: string | null = null;
  play(): Promise<void> {
    if (this.refuse) return Promise.reject(new DOMException('refused', this.refuse));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

describe('the recorded player', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('a play after a fade-out sounds at full level and stays playing (C7-r1 5)', async () => {
    const el = new FakeElement();
    const p = new RecordedPlayer('/audio/music/charter.x.ogg', el as unknown as HTMLAudioElement);
    await p.play(true);
    p.fade(0, 1); // leaving the menu
    vi.advanceTimersByTime(600);
    expect(el.volume).toBeLessThan(0.6);
    await p.play(false); // the game's first piece: the same recording, mid-fade
    expect(el.volume).toBe(1);
    vi.advanceTimersByTime(3000); // the old fade's steps and its pause are cancelled
    expect(el.volume).toBe(1);
    expect(el.paused).toBe(false);
  });

  test('through the graph: its own gain fades, and a play restores it', async () => {
    const el = new FakeElement();
    const ctx = new FakeContext();
    const p = new RecordedPlayer('/a.ogg', el as unknown as HTMLAudioElement);
    p.attach(ctx as unknown as BaseAudioContext, mixer as never);
    const gain = ctx.gains[0] as FakeParam;
    await p.play(true);
    p.fade(0, 1);
    expect(gain.events.at(-1)).toEqual(['target', 0, 0]);
    await p.play(true);
    expect(gain.events.at(-1)).toEqual(['set', 1, 0]);
    vi.advanceTimersByTime(3000);
    expect(el.paused).toBe(false);
  });
});

describe('the recordings', () => {
  const manifest = {
    version: 1,
    rate: 32000,
    packs: {},
    eras: {},
    recordings: {
      charter: { file: 'music/charter.abc', seconds: 150, lufs: -18, bytes: { ogg: 1, m4a: 1 } },
      'era2-1962': { file: 'music/era2-1962.def', seconds: 150, lufs: -18, bytes: { ogg: 1, m4a: 1 } },
    },
  } as unknown as MusicManifest;

  test('a play refused for want of a gesture is remembered and retried (C7-r1 7)', async () => {
    const els: FakeElement[] = [];
    const r = new Recordings(manifest, '/audio/', 'ogg', () => {
      const e = new FakeElement();
      els.push(e);
      return e as unknown as HTMLAudioElement;
    });
    let blocked = 0;
    r.onBlocked = () => blocked++;
    r.player('charter');
    (els[0] as FakeElement).refuse = 'NotAllowedError';
    expect(await r.play('charter', true)).toBe(false);
    expect(r.pending).toEqual({ name: 'charter', loop: true });
    expect(blocked).toBe(1);
    // the next gesture: allowed now
    (els[0] as FakeElement).refuse = null;
    expect(await r.retry()).toBe(true);
    expect(r.pending).toBeNull();
    expect(r.playing).toBe(true);
    // a failure for another reason (a broken file) is not a gesture's business
    r.player('era2-1962');
    (els[1] as FakeElement).refuse = 'NotSupportedError';
    expect(await r.play('era2-1962')).toBe(false);
    expect(r.pending).toBeNull();
  });

  test("the probe's codec reaches the recordings that are not playing (C7-r1 13)", async () => {
    const els: FakeElement[] = [];
    const r = new Recordings(manifest, '/audio/', 'ogg', () => {
      const e = new FakeElement();
      els.push(e);
      return e as unknown as HTMLAudioElement;
    });
    r.player('charter');
    r.player('era2-1962');
    await r.play('charter', true);
    r.setCodec('m4a');
    expect((els[0] as FakeElement).src).toBe('/audio/music/charter.abc.ogg'); // playing: it decodes, it stays
    expect((els[1] as FakeElement).src).toBe('/audio/music/era2-1962.def.m4a');
    // once it stops, it switches too
    (els[0] as FakeElement).pause();
    r.setCodec('m4a');
    expect((els[0] as FakeElement).src).toBe('/audio/music/charter.abc.m4a');
  });
});
