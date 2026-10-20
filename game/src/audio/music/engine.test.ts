// The music engine's main-thread half (10 §9.4): instruments (zones, velocity layers, re-bowing, synths), the
// era layout as channel strips, late notes, the scheduler's windows, and the director's program on fakes.
import { describe, expect, test } from 'vitest';
import { BankClient, type PortLike } from '../bank-client.ts';
import { type AudioSettings, categoryGain, defaultSettings, sanitizeSettings } from '../mixer/volumes.ts';
import { F, NF, type ToBank } from '../worklet/protocol.ts';
import { MusicEngine } from './engine.ts';
import { type LoadedPack, Sampler, Synth, type VoiceSpec } from './instruments.ts';
import { ERA1_LAYOUT } from './pieces/era1.ts';
import { ERA2_LAYOUT } from './pieces/era2.ts';
import { Scheduler } from './scheduler.ts';

const pack = (kind: 'oneshot' | 'sustain', layers: number, roots: number[], seconds = 6): LoadedPack => ({
  kind,
  layers,
  makeupDb: 0,
  zones: Array.from({ length: layers }, (_, l) =>
    roots.map((root, i) => ({ id: l * 100 + i, root, layer: l, seconds })),
  ).flat(),
});

function voices(
  s: Sampler | Synth,
  t: number,
  midi: number,
  vel: number,
  dur: number,
  opts = {},
): VoiceSpec[] {
  const out: VoiceSpec[] = [];
  s.play(t, midi, vel, dur, opts, (v) => out.push(v));
  return out;
}

describe('instruments', () => {
  test('the nearest zone, preferring to shift a sample down', () => {
    const s = new Sampler(pack('oneshot', 1, [60, 62, 64]), false);
    expect(s.zoneFor(0, 61).root).toBe(62); // 1 down rather than 1 up
    expect(s.zoneFor(0, 63).root).toBe(64);
    expect(s.zoneFor(0, 70).root).toBe(64);
    const [v] = voices(s, 1, 61, 0.5, 2);
    expect(v?.rate).toBeCloseTo(2 ** (-1 / 12));
  });

  test('an equal-power crossfade between two layers for long notes; one voice for short or fast ones', () => {
    const xf = new Sampler(pack('oneshot', 2, [60]), true);
    const two = voices(xf, 0, 60, 0.6, 3);
    expect(two.length).toBe(2);
    const p = 0.6 ** 0.9;
    const g = 10 ** ((-28 * 0.4) / 20);
    expect(two[0]?.gain).toBeCloseTo(g * Math.cos((p * Math.PI) / 2));
    expect(two[1]?.gain).toBeCloseTo(g * Math.sin((p * Math.PI) / 2));
    expect(voices(xf, 0, 60, 0.6, 0.3).length).toBe(1); // A4 §6.5 #2: shorter than 0.5 s
    const fast = new Sampler(pack('oneshot', 2, [60]), false);
    const [one] = voices(fast, 0, 60, 0.6, 3);
    expect(one?.src).toBe(100 + 0); // the nearest layer: round(0.6^0.9) = 1
  });

  test('long notes on sustained instruments are re-bowed: overlapping segments that cover the note', () => {
    const s = new Sampler(pack('sustain', 1, [60], 6), false);
    const segs = voices(s, 10, 60, 0.4, 20, { attack: 2, release: 1.5 });
    expect(segs.length).toBeGreaterThan(3);
    expect(segs[0]?.atkExp).toBe(false);
    expect(segs[0]?.offset).toBe(0);
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1] as VoiceSpec;
      const b = segs[i] as VoiceSpec;
      expect(b.atkExp).toBe(true); // a bow change: an exponential crossfade in
      expect(b.attack).toBe(1.6);
      expect(b.offset).toBe(0.45); // past the attack transient
      expect(b.t).toBeCloseTo(a.off, 9); // the next segment starts where this one releases
    }
    const last = segs.at(-1) as VoiceSpec;
    expect(last.off).toBeCloseTo(30, 6);
    expect(last.release).toBe(1.5);
  });

  test('synths: organ and sine as A4 envelopes them; the bell lasts its T plus 0.1 s', () => {
    const [o] = voices(new Synth('organ', 3), 2, 69, 0.36, 0.5, { attack: 0.03, release: 0.25 });
    expect(o).toMatchObject({ kind: 'organ', src: 3, attack: 0.03, off: 2.5, release: 0.25 });
    expect(o?.rate).toBeCloseTo(440);
    expect(o?.stop).toBeCloseTo(2.5 + 0.25 * 1.3);
    const [s] = voices(new Synth('sine'), 0, 33, 0.62, 10);
    expect(s).toMatchObject({ kind: 'sine', attack: 0.06, release: 0.8 });
    const [b] = voices(new Synth('bell'), 0, 57, 0.5, 11);
    expect(b).toMatchObject({ kind: 'bell', aux: 11 });
    expect(b?.stop).toBeCloseTo(11.1);
  });
});

class CapturePort implements PortLike {
  msgs: ToBank[] = [];
  onmessage: PortLike['onmessage'] = null;
  postMessage(m: ToBank) {
    this.msgs.push(m);
  }
}

const packs = {
  pack: (name: string): LoadedPack => pack('oneshot', name === 'piano' ? 2 : 1, [48, 60, 72]),
  stereo: (name: string) => name === 'piano',
};

describe('the engine', () => {
  test("an era's layout becomes the bank's channel strips", () => {
    const port = new CapturePort();
    const e = new MusicEngine(new BankClient(port), () => 0, packs);
    e.prepare(1, ERA2_LAYOUT);
    const layout = port.msgs.find((m) => m.t === 'layout');
    if (layout?.t !== 'layout') throw new Error('no layout');
    expect(layout.slot).toBe(1);
    const byName = Object.fromEntries(ERA2_LAYOUT.channels.map((c, i) => [c.name, layout.channels[i]]));
    expect(byName.piano?.stereo).toBe(true);
    expect(byName.vibes?.stereo).toBe(false);
    expect(byName.marimbaA?.trim).toBeCloseTo(10 ** (-9.4 / 20));
    expect(byName.marimbaA?.send).toBeCloseTo(10 ** (-11 / 20));
    expect(byName.piano?.inserts[0]).toMatchObject({
      kind: 'tape',
      wowMs: 1.4,
      drive: 2,
      lowpass: 7500,
      highpass: 45,
    });
    expect(byName.piano?.eq[0]).toMatchObject({ type: 'peaking', f: 2800, q: 0.8, gain: -3 });
    expect(byName.echo?.feed).toMatchObject({
      kind: 'echo',
      from: ERA2_LAYOUT.channels.findIndex((c) => c.name === 'organ'),
      feedback: 0.36,
    });
    expect(byName.hiss?.feed).toMatchObject({ kind: 'noise', gainDb: -58 });
    expect(port.msgs.some((m) => m.t === 'wave')).toBe(true);
  });

  test('notes up to 50 ms late play at once; later ones are dropped and counted, never scheduled in the past', () => {
    const port = new CapturePort();
    const clock = { t: 100 };
    const bank = new BankClient(port);
    const e = new MusicEngine(bank, () => clock.t, packs);
    e.prepare(0, ERA1_LAYOUT);
    e.play(0, { t: 99.97, inst: 'harp', midi: 60, vel: 0.4, dur: 1, opts: {} });
    e.play(0, { t: 99.9, inst: 'harp', midi: 60, vel: 0.4, dur: 1, opts: {} });
    e.play(0, { t: 100.5, inst: 'harp', midi: 60, vel: 0.4, dur: 1, opts: {} });
    bank.flush();
    const notes = port.msgs.find((m) => m.t === 'notes');
    if (notes?.t !== 'notes') throw new Error('no notes');
    expect(notes.n).toBe(2);
    expect(notes.data[F.TIME]).toBe(100);
    expect(notes.data[NF + F.TIME]).toBe(100.5);
    expect(notes.data[F.DEST]).toBe(ERA1_LAYOUT.channels.findIndex((c) => c.name === 'harp'));
    expect(e.dropped).toBe(1);
  });
});

describe('the scheduler', () => {
  test('contiguous windows [cursor, now + 0.8 s), a flush per tick, finished pieces removed', () => {
    const windows: [number, number][] = [];
    let flushes = 0;
    const clock = { t: 5 };
    const s = new Scheduler(
      () => clock.t,
      () => flushes++,
      () => 0,
    );
    s.add({ schedule: (a, b) => windows.push([a, b]), done: (now) => now > 6 });
    s.cursor = 5;
    for (let i = 0; i < 20; i++) {
      clock.t = 5 + i * 0.1;
      s.tick(clock.t);
    }
    expect(windows[0]).toEqual([5, 5.8]);
    for (let i = 1; i < windows.length; i++)
      expect((windows[i] as [number, number])[0]).toBeCloseTo((windows[i - 1] as [number, number])[1], 9);
    expect(s.procs.size).toBe(0);
    expect(flushes).toBe(20);
  });
});

describe('volumes (I §4.20)', () => {
  test('squared sliders; music at 70 % by default (−6.2 dB); mutes; untrusted settings sanitised', () => {
    const s: AudioSettings = defaultSettings();
    expect(20 * Math.log10(categoryGain(s, 'music'))).toBeCloseTo(-6.2, 1);
    expect(categoryGain(s, 'gui')).toBe(1);
    s.muted.alerts = true;
    expect(categoryGain(s, 'alerts')).toBe(0);
    const t = sanitizeSettings({
      volume: { master: 2, music: 'x', walking: 0.5 },
      muted: { ambient: true, gui: 'yes' },
    });
    expect(t.volume.master).toBe(1);
    expect(t.volume.music).toBe(0.7);
    expect(t.volume.walking).toBe(0.5);
    expect(t.muted.ambient).toBe(true);
    expect(t.muted.gui).toBe(false);
  });
});
