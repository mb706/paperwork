// The voice bank's core in Node (10 §9.4): envelopes as A4's AudioParam automation, click-free starts,
// stops and steals, the voice caps, loop seams, the channel strip's laws, automation and the tape echo.
import { describe, expect, test } from 'vitest';
import { BankCore } from './bank-core.ts';
import {
  type ChannelConfig,
  F,
  GROUP,
  KIND,
  MAX_CH,
  NF,
  OUT_SFX,
  OUT_SLOT,
  SFX_DEST,
  type ToBank,
} from './protocol.ts';

const SR = 32000;
const OUTS = BankCore.outputs(2);

function outputs(n = 128): Float32Array[][] {
  return Array.from({ length: OUTS }, () => [new Float32Array(n), new Float32Array(n)]);
}

/** Runs the core for `frames` frames; returns the chosen output pair, concatenated. */
function render(
  core: BankCore,
  frames: number,
  out = OUT_SLOT(0, false),
  from = 0,
): [Float32Array, Float32Array] {
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  for (let f = 0; f < frames; f += 128) {
    const o = outputs();
    core.process(o, from + f);
    const p = o[out] as Float32Array[];
    L.set((p[0] as Float32Array).subarray(0, Math.min(128, frames - f)), f);
    R.set((p[1] as Float32Array).subarray(0, Math.min(128, frames - f)), f);
  }
  return [L, R];
}

function note(p: Partial<Record<keyof typeof F, number>>): Float64Array {
  const d = new Float64Array(NF);
  d[F.KIND] = KIND.SAMPLE;
  d[F.GROUP] = GROUP.MUSIC;
  d[F.RATE] = 1;
  d[F.GAIN] = 1;
  d[F.OFF] = 1e9;
  d[F.STOP] = 1e9;
  d[F.RELEASE] = 0.35;
  d[F.TYPE] = -1;
  d[F.CAP] = 4;
  for (const [k, v] of Object.entries(p)) d[F[k as keyof typeof F]] = v as number;
  return d;
}

const send = (core: BankCore, m: ToBank) => core.onMessage(m);
const notes = (core: BankCore, ...ns: Float64Array[]) => {
  const data = new Float64Array(ns.length * NF);
  ns.forEach((n, i) => {
    data.set(n, i * NF);
  });
  send(core, { t: 'notes', n: ns.length, data });
};

function channel(p: Partial<ChannelConfig> & { index: number }): ChannelConfig {
  return { stereo: false, trim: 1, pan: 0, dry: 1, send: 0, eq: [], inserts: [], feed: null, ...p };
}

/** A mono Int16 buffer: a sine of `hz` with amplitude `amp`, `seconds` long. */
function sineBuf(hz: number, seconds: number, amp = 0.5): Int16Array {
  const n = Math.round(seconds * SR);
  const b = new Int16Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.round(amp * 32767 * Math.sin((2 * Math.PI * hz * i) / SR));
  return b;
}

const maxStep = (x: Float32Array, a = 1, b = x.length) => {
  let m = 0;
  for (let i = Math.max(1, a); i < b; i++) m = Math.max(m, Math.abs((x[i] as number) - (x[i - 1] as number)));
  return m;
};
const peak = (x: Float32Array, a = 0, b = x.length) => {
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i] as number));
  return m;
};

function bankWith(...chans: ChannelConfig[]): BankCore {
  const core = new BankCore({ sampleRate: SR, taps: 2 });
  send(core, { t: 'layout', slot: 0, channels: chans.length ? chans : [channel({ index: 0 })] });
  return core;
}

describe('the voice bank', () => {
  test('a sample plays at its level through a centred mono channel (−3 dB per side, StereoPanner)', () => {
    const core = bankWith();
    send(core, { t: 'buf', id: 1, chans: [sineBuf(500, 1)], rate: SR });
    notes(core, note({ TIME: 0, SRC: 1, DEST: 0 }));
    const [L, R] = render(core, 16000);
    expect(peak(L, 1000, 15000)).toBeCloseTo(0.5 * Math.SQRT1_2, 2);
    expect(peak(R, 1000, 15000)).toBeCloseTo(0.5 * Math.SQRT1_2, 2);
  });

  test('a linear attack and an exponential release, as setTargetAtTime(0, off, release / 4.5)', () => {
    const core = bankWith();
    const dc = new Int16Array(SR * 2).fill(16384); // 0.5
    send(core, { t: 'buf', id: 1, chans: [dc], rate: SR });
    notes(core, note({ TIME: 0, SRC: 1, ATTACK: 0.1, OFF: 0.5, RELEASE: 0.45, STOP: 1.5 }));
    const [L] = render(core, SR * 1.5);
    const g = 0.5 * Math.SQRT1_2;
    expect(L[1600] as number).toBeCloseTo(g * 0.5, 3); // halfway through the 0.1 s ramp
    expect(L[3300] as number).toBeCloseTo(g, 3);
    // τ = 0.45 / 4.5 = 0.1 s: after 0.1 s of release the level is 1/e
    expect((L[0.6 * SR] as number) / g).toBeCloseTo(Math.exp(-1), 2);
  });

  test('start, stop and steal are click-free', () => {
    const core = bankWith();
    send(core, { t: 'buf', id: 1, chans: [sineBuf(220, 2, 0.8)], rate: SR });
    // a hard stop while loud: a 3 ms fade, never a cut
    notes(core, note({ TIME: 0.01, SRC: 1, STOP: 0.5 }));
    const [L] = render(core, SR);
    const signalStep = maxStep(L, 400, 15000);
    expect(maxStep(L, 15900, 16300)).toBeLessThanOrEqual(signalStep * 1.05);
    expect(peak(L, 16200, SR)).toBe(0);
    // stealing: 49 voices of a constant signal, so any cut would be a step; the 49th steals the quietest,
    // which fades in 3 ms, and enters with a 50 ms attack
    const core2 = bankWith();
    send(core2, { t: 'buf', id: 1, chans: [new Int16Array(SR * 2).fill(16384)], rate: SR });
    const many = Array.from({ length: 48 }, (_, i) =>
      note({ TIME: 0, SRC: 1, GAIN: 0.01 + i * 0.001, ATTACK: 0.05 }),
    );
    notes(core2, ...many);
    render(core2, 3200);
    notes(core2, note({ TIME: 0.15, SRC: 1, GAIN: 0.5, ATTACK: 0.05 }));
    const [L2] = render(core2, 3200, OUT_SLOT(0, false), 3200);
    const st = core2.stats();
    expect(st.stolen).toBe(1);
    expect(st.activeMusic).toBe(48);
    // a cut of the quietest voice would be a step of 0.01 · 0.5 · 0.707 = 0.0035; the fade's steps are 1/96 of it
    expect(maxStep(L2, 1, 3200)).toBeLessThan(2e-4);
  });

  test('SFX: at most 4 voices of one sound and 24 in all; lower priority never steals higher', () => {
    const core = new BankCore({ sampleRate: SR });
    send(core, { t: 'buf', id: 1, chans: [sineBuf(440, 1, 0.3)], rate: SR });
    const sfx = (type: number, prio: number) =>
      note({ TIME: 0, SRC: 1, DEST: SFX_DEST + 1, GROUP: GROUP.SFX, TYPE: type, CAP: 4, PRIO: prio });
    notes(core, sfx(7, 1), sfx(7, 1), sfx(7, 1), sfx(7, 1), sfx(7, 1));
    render(core, 256, OUT_SFX(1));
    expect(core.stats().stolen).toBe(1);
    expect(core.stats().activeSfx).toBe(4);
    for (let t = 0; t < 30; t++) notes(core, sfx(100 + t, 5));
    render(core, 256, OUT_SFX(1), 256);
    expect(core.stats().activeSfx).toBe(24);
    notes(core, sfx(999, 0));
    render(core, 256, OUT_SFX(1), 512);
    expect(core.stats().activeSfx).toBe(24);
    expect(core.stats().dropped).toBeGreaterThan(0);
  });

  test('a loop wraps at its manifest points without a seam', () => {
    const core = new BankCore({ sampleRate: SR });
    // 0.25 s of 400 Hz (100 whole cycles) between 50 ms margins of the same signal
    const margin = 0.05 * SR;
    const body = 0.25 * SR;
    const b = new Int16Array(body + 2 * margin);
    for (let i = 0; i < b.length; i++)
      b[i] = Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 400 * (i - margin)) / SR));
    send(core, { t: 'buf', id: 3, chans: [b], rate: SR });
    notes(
      core,
      note({
        TIME: 0,
        SRC: 3,
        DEST: SFX_DEST + 3,
        GROUP: GROUP.SFX,
        TYPE: 1,
        LOOP_S: margin,
        LOOP_E: margin + body,
        OFFSET: 0.123,
        STOP: Number.POSITIVE_INFINITY,
        OFF: Number.POSITIVE_INFINITY,
        SMOOTH: 1,
        HANDLE: 9,
      }),
    );
    const [L] = render(core, SR * 2, OUT_SFX(3));
    const sig = maxStep(L, 100, 4000);
    expect(maxStep(L, 4000, SR * 2)).toBeLessThanOrEqual(sig * 1.02);
    expect(peak(L, SR, SR * 2)).toBeGreaterThan(0.3);
    // the handle releases it with a fade
    send(core, { t: 'ctl', n: 1, data: Float64Array.of(9, 0, 0, 1, 0.3) });
    const [L2] = render(core, SR, OUT_SFX(3), SR * 2);
    expect(peak(L2, 0.32 * SR, SR)).toBe(0);
    expect(maxStep(L2, 1, SR)).toBeLessThanOrEqual(sig * 1.02);
  });

  test('a stereo channel uses the stereo pan law; trims, sends and taps follow the strip', () => {
    const core = bankWith(channel({ index: 0, stereo: true, pan: -0.5, trim: 0.5, send: 0.25 }));
    send(core, {
      t: 'buf',
      id: 1,
      chans: [new Int16Array(SR).fill(16384), new Int16Array(SR).fill(8192)],
      rate: SR,
    });
    send(core, { t: 'taps', list: [{ slot: 0, channel: 0 }] });
    notes(core, note({ TIME: 0, SRC: 1 }));
    const [L, R] = render(core, 1024);
    // pan −0.5: L' = L + R·cos(π/4), R' = R·sin(π/4)
    const l = 0.5 * 0.5;
    const r = 0.25 * 0.5;
    expect(L[500] as number).toBeCloseTo(l + r * Math.cos(Math.PI / 4), 4);
    expect(R[500] as number).toBeCloseTo(r * Math.sin(Math.PI / 4), 4);
    const [sL] = render(core, 128, OUT_SLOT(0, true), 1024);
    expect(sL[10] as number).toBeCloseTo((l + r * Math.cos(Math.PI / 4)) * 0.25, 4);
  });

  test('fader automation follows setValueAtTime and setTargetAtTime', () => {
    const core = bankWith(channel({ index: 0 }));
    send(core, { t: 'buf', id: 1, chans: [new Int16Array(SR * 3).fill(16384)], rate: SR });
    send(core, {
      t: 'auto',
      slot: 0,
      channel: 0,
      param: 'fader',
      events: [
        [0, 0, 0.0001, 0],
        [1, 0.5, 1, 0.25],
      ],
    });
    notes(core, note({ TIME: 0, SRC: 1 }));
    const [L] = render(core, SR * 2);
    const g = 0.5 * Math.SQRT1_2;
    expect((L[0.25 * SR] as number) / g).toBeCloseTo(0.0001, 5);
    expect((L[0.75 * SR] as number) / g).toBeCloseTo(1 - (1 - 0.0001) * Math.exp(-1), 2);
  });

  test('the tape echo repeats its source after the delay, and the gate erases it', () => {
    const time = (4 * 60) / 83;
    const core = bankWith(
      channel({ index: 0 }),
      channel({
        index: 1,
        feed: {
          kind: 'echo',
          from: 0,
          time,
          feedback: 0.36,
          lowpass: 2400,
          highpass: 220,
          wowMs: 0,
          wowHz: 0.35,
        },
      }),
    );
    send(core, { t: 'buf', id: 1, chans: [sineBuf(600, 0.2, 0.5)], rate: SR });
    notes(core, note({ TIME: 0, SRC: 1 }));
    send(core, { t: 'taps', list: [{ slot: 0, channel: 1 }] });
    const [E] = render(core, Math.round(SR * 7), 10 /* OUT_TAPS */);
    const first = peak(E, Math.round(time * SR), Math.round((time + 0.25) * SR));
    const second = peak(E, Math.round(2 * time * SR), Math.round((2 * time + 0.25) * SR));
    expect(peak(E, 0, Math.round(time * SR) - 10)).toBe(0);
    expect(first).toBeGreaterThan(0.05);
    expect(second / first).toBeGreaterThan(0.3);
    expect(second / first).toBeLessThan(0.7);
    // gated: the feedback is erased before the first repeat comes round again
    const core2 = bankWith(
      channel({ index: 0 }),
      channel({
        index: 1,
        feed: {
          kind: 'echo',
          from: 0,
          time,
          feedback: 0.36,
          lowpass: 2400,
          highpass: 220,
          wowMs: 0,
          wowHz: 0.35,
        },
      }),
    );
    send(core2, { t: 'buf', id: 1, chans: [sineBuf(600, 0.2, 0.5)], rate: SR });
    send(core2, { t: 'taps', list: [{ slot: 0, channel: 1 }] });
    send(core2, { t: 'auto', slot: 0, channel: 1, param: 'echoFeedback', events: [[1, 1, 0, 0.12]] });
    notes(core2, note({ TIME: 0, SRC: 1 }));
    const [E2] = render(core2, Math.round(SR * 7), 10);
    expect(peak(E2, Math.round(2 * time * SR), Math.round(SR * 7))).toBeLessThan(first * 0.01);
  });

  test('synth voices: an organ wavetable and a Risset bell', () => {
    const core = bankWith(channel({ index: 0 }), channel({ index: 1 }));
    send(core, { t: 'wave', id: 2, harmonics: [0, 1, 0.55, 0.12, 0.16, 0, 0.04, 0, 0.05] });
    const organ = note({
      TIME: 0,
      KIND: KIND.ORGAN,
      SRC: 2,
      RATE: 440,
      GAIN: 0.3,
      ATTACK: 0.03,
      OFF: 0.5,
      RELEASE: 0.25,
      STOP: 0.5 + 0.25 * 1.3,
    });
    const bell = note({
      TIME: 0,
      KIND: KIND.BELL,
      DEST: 1,
      RATE: 220,
      GAIN: 0.3,
      AUX: 4,
      OFF: 1e9,
      STOP: 1e9,
    });
    notes(core, organ, bell);
    send(core, {
      t: 'taps',
      list: [
        { slot: 0, channel: 0 },
        { slot: 0, channel: 1 },
      ],
    });
    const o = outputs(128);
    const org = new Float32Array(SR);
    const bel = new Float32Array(SR * 6);
    for (let f = 0; f < SR * 6; f += 128) {
      for (const p of o) for (const c of p) c.fill(0);
      core.process(o, f);
      if (f < SR) org.set((o[10] as Float32Array[])[0] as Float32Array, f);
      bel.set((o[11] as Float32Array[])[0] as Float32Array, f);
    }
    expect(peak(org, 0.1 * SR, 0.45 * SR)).toBeCloseTo(0.3 * Math.SQRT1_2, 2); // a peak-normalised wave
    expect(peak(org, 0.9 * SR, SR)).toBe(0);
    expect(peak(bel, 0, 0.2 * SR)).toBeGreaterThan(0.02);
    expect(peak(bel, 4.2 * SR, 6 * SR)).toBeLessThan(peak(bel, 0, 0.2 * SR) * 0.003);
    expect(core.stats().activeMusic).toBe(0);
  });

  test('clear() fades a slot within its time and drops its pending notes', () => {
    const core = bankWith();
    send(core, { t: 'buf', id: 1, chans: [sineBuf(300, 3, 0.5)], rate: SR });
    notes(core, note({ TIME: 0, SRC: 1 }), note({ TIME: 2, SRC: 1 }));
    render(core, SR / 2);
    send(core, { t: 'clear', slot: 0, fade: 0.2 });
    const [L] = render(core, SR * 2, OUT_SLOT(0, false), SR / 2);
    expect(peak(L, 0.25 * SR, SR * 2)).toBe(0);
    expect(core.stats().pending).toBe(0);
    expect(maxStep(L)).toBeLessThan(0.05);
  });

  test('music destinations address slot·MAX_CH + channel', () => {
    expect(MAX_CH).toBe(16);
    const core = new BankCore({ sampleRate: SR });
    send(core, { t: 'layout', slot: 1, channels: [channel({ index: 3 })] });
    send(core, { t: 'buf', id: 1, chans: [sineBuf(500, 1)], rate: SR });
    notes(core, note({ TIME: 0, SRC: 1, DEST: MAX_CH + 3 }));
    const [L] = render(core, 4096, OUT_SLOT(1, false));
    expect(peak(L)).toBeGreaterThan(0.3);
  });
});
