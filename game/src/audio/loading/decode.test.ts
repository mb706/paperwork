// One decode path (10 §9.4): the canonical timeline, priming found by the fingerprint, Int16 conversion.
import { describe, expect, test } from 'vitest';
import { alignOffset, Decoder } from './decode.ts';

const N = 8000;
const signal = () =>
  Float32Array.from(
    { length: N },
    (_, i) => 0.5 * Math.sin(i * 0.05 + 0.3 * Math.sin(i * 0.001)) * Math.min(1, i / 200),
  );
const fpOf = (x: Float32Array, at: number) => ({
  at,
  data: Array.from(x.subarray(at, at + 64), (v) => Math.round(v * 32768)),
});

describe('the canonical timeline', () => {
  test('priming a decoder left in is found and trimmed; an exact decode is left alone', () => {
    const x = signal();
    const fp = fpOf(x, 300);
    expect(alignOffset(x, N, fp)).toBe(0);
    for (const priming of [1024, 2112, 37]) {
      const y = new Float32Array(N + priming);
      y.set(x, priming);
      expect(alignOffset(y, N, fp)).toBe(priming);
    }
    // a decoder that trimmed too much: a negative offset
    expect(alignOffset(x.subarray(10), N, fp)).toBe(-10);
  });

  test('decode() aligns, converts to Int16 (round(x · 32768), clamped) and keeps the canonical length', async () => {
    const x = signal();
    const priming = 1024;
    const decoded = new Float32Array(N + priming + 500);
    decoded.set(x, priming);
    decoded[priming + 10] = 1.5; // over full scale: clamped
    const dec = new Decoder(
      32000,
      2,
      1,
      () =>
        ({
          decodeAudioData: async () => ({
            numberOfChannels: 1,
            length: decoded.length,
            getChannelData: () => decoded,
          }),
        }) as unknown as BaseAudioContext,
    );
    const [c] = await dec.decode(new ArrayBuffer(8), { len: N, fp: fpOf(x, 300) });
    expect(c?.length).toBe(N);
    expect(c?.[10]).toBe(32767);
    expect(c?.[1000]).toBe(Math.round((x[1000] as number) * 32768));
    expect(dec.misaligned).toEqual([priming]);
  });

  test('at most two files decode at once', async () => {
    let running = 0;
    let max = 0;
    const dec = new Decoder(
      32000,
      2,
      1,
      () =>
        ({
          decodeAudioData: async () => {
            running++;
            max = Math.max(max, running);
            await new Promise((r) => setTimeout(r, 5));
            running--;
            return { numberOfChannels: 1, length: 64, getChannelData: () => new Float32Array(64) };
          },
        }) as unknown as BaseAudioContext,
    );
    await Promise.all(Array.from({ length: 7 }, () => dec.decode(new ArrayBuffer(8), null)));
    expect(max).toBe(2);
  });

  test('a file holds its permit until its conversion ends: two decoded buffers at most (C7-r1 9)', async () => {
    const len = 120_000;
    let live = 0;
    let maxLive = 0;
    const dec = new Decoder(
      32000,
      2,
      0.2, // short slices: conversions yield many times
      () =>
        ({
          decodeAudioData: async () => {
            live++;
            // counted after the microtasks already queued (a finished file's own bookkeeping) have run
            await Promise.resolve();
            maxLive = Math.max(maxLive, live);
            return { numberOfChannels: 1, length: len, getChannelData: () => new Float32Array(len) };
          },
        }) as unknown as BaseAudioContext,
    );
    const fp = { at: 0, data: [] };
    await Promise.all(
      Array.from({ length: 10 }, () =>
        dec.decode(new ArrayBuffer(8), { len, fp, channels: 1 }).then(() => {
          live--;
        }),
      ),
    );
    expect(maxLive).toBe(2);
    expect(dec.maxHeld).toBe(2 * (len + 4096) * 4);
  });

  test('and at most maxBytes of decoded audio between them (one larger file still decodes, alone)', async () => {
    const len = 250_000; // about 1 MB of Float32 each
    const dec = new Decoder(
      32000,
      2,
      1,
      () =>
        ({
          decodeAudioData: async () => ({
            numberOfChannels: 1,
            length: len,
            getChannelData: () => new Float32Array(len),
          }),
        }) as unknown as BaseAudioContext,
      1.5 * 2 ** 20,
    );
    const fp = { at: 0, data: [] };
    const one = (n: number) => dec.decode(new ArrayBuffer(8), { len: n, fp, channels: 1 });
    await Promise.all([one(len), one(len), one(len)]);
    expect(dec.maxHeld).toBeLessThanOrEqual(1.5 * 2 ** 20);
    await one(len * 4); // 4 MB: over the limit, but alone it goes
    expect(dec.maxHeld).toBeGreaterThan(1.5 * 2 ** 20);
  });
});
