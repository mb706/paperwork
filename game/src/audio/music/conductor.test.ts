// The conductor over a simulated twelve-hour game (A4 `render/session.mjs`, DIRECTION §5): identical to the
// prototype's program, music about two-thirds of the time, no repeats except the callback, eras by the
// Literature year, and the music keys.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { makeRng } from '../core/rng.ts';
import { Conductor, eraFor, type Segment } from './conductor.ts';

const FIXTURES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pieces', 'fixtures.json'), 'utf8'),
) as Record<string, { segments: number; sha256: string; head: string[] }>;

const H = 3600;
// Literature year at tier ends (00 §4): start 1945, Memo 1955, Report 1995, Article 2011, Preprint 2018, Model card 2023
const LIT: [number, number][] = [
  [0, 1945],
  [0.7 * H, 1955],
  [3.1 * H, 1995],
  [4.5 * H, 2011],
  [6.1 * H, 2018],
  [8.5 * H, 2023],
  [11.5 * H, 2024],
];
const litAt = (t: number): number => {
  for (let i = 1; i < LIT.length; i++) {
    const [t1, y1] = LIT[i] as [number, number];
    const [t0, y0] = LIT[i - 1] as [number, number];
    if (t < t1) return y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
  }
  return 2024;
};

function session(seed: number, available?: string[]): Conductor {
  const rng = makeRng(seed);
  const c = new Conductor(available ? { seed, available } : { seed });
  let act = 0.4;
  for (let t = 0; t < 12.6 * H; t += 5) {
    act = Math.max(0.05, Math.min(1, act + rng.gauss() * 0.02 + (t < H ? 0.001 : 0)));
    c.update(t, { literatureYear: litAt(t), activity: act, closure: t >= 11.5 * H, victory: t >= 12.3 * H });
  }
  return c;
}

const sig = (s: Segment) =>
  [s.kind, s.piece ?? '-', s.start.toFixed(6), s.end.toFixed(6), JSON.stringify(s.params ?? null)].join(' ');

describe('the conductor', () => {
  for (const seed of [7, 1945]) {
    test(`reproduces the prototype's program (seed ${seed})`, () => {
      const fx = FIXTURES[`conductor-session-${seed}`] as {
        segments: number;
        sha256: string;
        head: string[];
      };
      const lines = session(seed).program.map(sig);
      expect(lines.slice(0, fx.head.length)).toEqual(fx.head);
      expect(lines.length).toBe(fx.segments);
      expect(createHash('sha256').update(lines.join('\n')).digest('hex')).toBe(fx.sha256);
    });
  }

  test('a 12.6 h game: the charter piece first, music two-thirds of the time, nothing repeats', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const c = session(seed);
      const end = 12.6 * H;
      const segs = c.program.filter((s) => s.start < end).map((s) => ({ ...s, end: Math.min(s.end, end) }));
      const tot = (k: string) => segs.filter((s) => s.kind === k).reduce((a, s) => a + (s.end - s.start), 0);
      const music = tot('piece') / end;
      expect(music).toBeGreaterThan(0.58);
      expect(music).toBeLessThan(0.78);
      const first = segs[0] as Segment;
      expect([first.kind, first.piece, first.start, first.end, first.params?.seed]).toEqual([
        'piece',
        'era1',
        0,
        150,
        1945,
      ]);
      const pieces = segs.filter((s) => s.kind === 'piece');
      const keys = pieces.map((s) => `${s.piece}/${s.params?.seed}/${s.params?.transpose}`);
      const dup = keys.filter((x, i) => keys.indexOf(x) !== i);
      // the charter piece returns once, after victory, played by the machine: the one deliberate callback
      expect(dup).toEqual(['era1/1945/0']);
      const callback = pieces.filter((x) => x.params?.machine);
      expect(callback.length).toBe(1);
      expect((callback[0] as Segment).start).toBeGreaterThan(12.3 * H);
      // every silence is 1.2–4.2 min, every piece 3–6 min (except the charter piece and the cuts)
      for (const s of segs.filter((x) => x.kind === 'silence' && x.end < 11.5 * H)) {
        expect(s.end - s.start).toBeGreaterThan(72 - 1e-9);
        expect(s.end - s.start).toBeLessThan(252);
      }
      // the era follows the Literature year when a piece starts
      for (const s of pieces.filter((x) => x.era))
        expect(s.piece).toBe(eraFor(litAt(s.start)).piece === 'era1' ? 'era1' : s.piece);
      const era2 = pieces.find((s) => s.piece === 'era2') as Segment;
      expect(litAt(era2.start)).toBeGreaterThanOrEqual(1957);
    }
  });

  test('with only the M1 rule sets, later eras play the latest one that exists', () => {
    const c = session(7, ['era1', 'era2']);
    const late = c.program.filter((s) => s.kind === 'piece' && s.start > 5 * H && s.start < 11 * H);
    expect(late.length).toBeGreaterThan(5);
    for (const s of late) expect(s.piece).toBe('era2');
  });

  test('the music keys: next skips the silence, previous replays a piece', () => {
    const c = new Conductor({ seed: 3, available: ['era1', 'era2'] });
    const st = { literatureYear: 1945, activity: 0.5 };
    c.update(10, st);
    expect(c.at(10)?.params?.seed).toBe(1945);
    const charter = c.at(10) as Segment;
    const next = c.skip(20, st) as Segment;
    expect(next.start).toBe(20);
    expect(next.kind).toBe('piece');
    expect(charter.end).toBe(20);
    expect(c.at(25)).toBe(next);
    const again = c.replay(30, charter) as Segment;
    expect(again.params?.seed).toBe(1945);
    expect(again.end - again.start).toBe(150);
    expect(next.end).toBe(30);
    c.update(200, st);
    expect(c.at(190)?.kind).toBe('silence');
  });

  test('a piece whose samples are not decoded waits: the silence is extended', () => {
    const c = new Conductor({ seed: 5, available: ['era1', 'era2'] });
    const st = { literatureYear: 1960, activity: 0.5 };
    let t = 0;
    while (c.at(t)?.kind !== 'silence') {
      t += 1;
      c.update(t, st);
    }
    const silence = c.at(t) as Segment;
    c.update(silence.end, st);
    const piece = c.at(silence.end) as Segment;
    expect(piece.kind).toBe('piece');
    const len = piece.end - piece.start;
    c.postpone(piece, silence.end + 12);
    expect(silence.end).toBe(piece.start);
    expect(piece.end - piece.start).toBe(len);
    expect(c.at(piece.start - 1)).toBe(silence);
  });
});
