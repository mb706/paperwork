// The rule sets (A4 §6.6, §10 M1 tests): every event valid, the port note-for-note identical to A4's
// prototype (the approved demos' rules), the harmony checks of DIRECTION §4.1 and §11, density per section.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { NoteEvent, PieceParams } from '../types.ts';
import { dryRun, invalidEvents } from './dryrun.ts';
import { PIECES } from './index.ts';

interface Fixture {
  config: { name: string; piece: string; params: PieceParams; duration: number; activity: number };
  events: number;
  counts: Record<string, number>;
  sha256: string;
  head: string[];
}
const FIXTURES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures.json'), 'utf8'),
) as Record<string, Fixture>;

/** The fixture generator's canonical line (scripts/assets/audio/proto-fixtures.mjs). */
const line = (e: NoteEvent): string =>
  [
    e.t.toFixed(6),
    e.inst,
    e.midi.toFixed(6),
    e.vel.toFixed(6),
    e.dur.toFixed(6),
    Object.keys(e.opts)
      .sort()
      .map((k) => `${k}=${(+(e.opts[k as keyof typeof e.opts] as number)).toFixed(6)}`)
      .join(','),
  ].join(' ');

const run = (piece: string, params: PieceParams & { duration: number }, activity: number) =>
  dryRun(PIECES[piece] as NonNullable<(typeof PIECES)[string]>, params, { activity });

describe('the port reproduces the prototype note for note', () => {
  for (const [name, fx] of Object.entries(FIXTURES).filter(([, f]) => 'config' in f)) {
    test(name, () => {
      const { config: c } = fx;
      const { events } = run(c.piece, { ...c.params, duration: c.duration }, c.activity);
      const lines = events.map(line);
      expect(lines.slice(0, fx.head.length)).toEqual(fx.head);
      expect(events.length).toBe(fx.events);
      expect(createHash('sha256').update(lines.join('\n')).digest('hex')).toBe(fx.sha256);
    });
  }
});

describe('every event is valid', () => {
  for (const piece of ['era1', 'era2']) {
    test(piece, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const duration = 120 + ((seed * 37) % 240);
        const params = {
          seed: seed * 7919,
          transpose: (seed % 12) - 5,
          tempoScale: 0.95 + (seed % 11) / 100,
          duration,
        };
        // activity crossing every threshold during the piece (0.25, 0.3, 0.4)
        const { events } = dryRun(PIECES[piece] as never, params, (t) => ({ activity: (t / duration) % 1 }));
        expect(invalidEvents(events)).toEqual([]);
        expect(events.length).toBeGreaterThan(100);
        // never scheduled before the piece starts or long after it ends
        for (const e of events) expect(e.t).toBeLessThan(0.05 + duration + 12);
      }
    });
  }
});

/** Simultaneous sustained notes a minor second or minor ninth apart, below C5, overlapping by more than 0.4 s
 *  (A4 `analysis/analyze.py`'s clash check, §13). */
function sustainedClashes(events: readonly NoteEvent[], sustained: ReadonlySet<string>): string[] {
  const sus = events.filter((e) => sustained.has(e.inst));
  const out: string[] = [];
  for (let i = 0; i < sus.length; i++)
    for (let j = i + 1; j < sus.length; j++) {
      const a = sus[i] as NoteEvent;
      const b = sus[j] as NoteEvent;
      const overlap = Math.min(a.t + a.dur, b.t + b.dur) - Math.max(a.t, b.t);
      if (overlap <= 0.4) continue;
      const iv = Math.round(Math.abs(a.midi - b.midi));
      if (iv % 12 === 1 && iv <= 13 && Math.min(a.midi, b.midi) < 72)
        out.push(`${a.inst}/${b.inst} ${a.t.toFixed(1)}`);
    }
  return out;
}

describe('harmony', () => {
  test('Era I: no sustained minor seconds or ninths below C5', () => {
    for (const seed of [1945, 7, 99, 2024, 31]) {
      const { events } = run('era1', { seed, duration: 300 }, 0.6);
      expect(sustainedClashes(events, new Set(['violins', 'violas', 'celli', 'bass', 'clarinet']))).toEqual(
        [],
      );
    }
  });

  // DIRECTION §11: organ-involved pairs below 5 % seconds, sevenths and tritones, with the tape echo's
  // repeats modelled (A4 `analysis/dissonance.py notes`, ported); A4 measured 2.5 % after the fix.
  test('Era II: the organ and its echo stay consonant (the round-1 fix)', () => {
    const DISS = [0, 1, 0.6, 0.1, 0.1, 0.05, 0.6, 0.05, 0.1, 0.1, 0.4, 0.5];
    const SUSTAINED = new Set(['organ', 'drone', 'vibes']);
    for (const [seed, duration] of [
      [1962, 140],
      [5, 220],
      [77, 300],
      [1234, 180],
    ] as const) {
      const { events } = run('era2', { seed, duration, transpose: seed % 7 }, 0.7);
      const delay = (4 * 60) / 83;
      const fb = 0.36;
      type V = [number, number, number, number, boolean];
      const voices: V[] = [];
      for (const n of events) {
        if (!SUSTAINED.has(n.inst)) continue;
        const rel = n.inst === 'organ' ? 0.25 : 1.2;
        const organ = n.inst === 'organ';
        voices.push([n.t, n.t + n.dur + rel, n.midi, n.vel, organ]);
        if (organ)
          for (let k = 1, g = fb; g > 10 ** (-30 / 20); k++, g *= fb)
            voices.push([n.t + k * delay, n.t + n.dur + rel + k * delay, n.midi, n.vel * g, true]);
      }
      const hist = new Array<number>(12).fill(0);
      let index = 0;
      let steps = 0;
      for (let t = 0.3 * duration; t < 0.69 * duration; t += 0.1) {
        const snd = voices.filter((v) => v[0] <= t && t < v[1]);
        let di = 0;
        for (let i = 0; i < snd.length; i++)
          for (let j = i + 1; j < snd.length; j++) {
            const x = snd[i] as V;
            const y = snd[j] as V;
            if (!(x[4] || y[4])) continue;
            const ic = Math.round(Math.abs(x[2] - y[2])) % 12;
            const w = Math.sqrt(x[3] * y[3]);
            hist[ic] = (hist[ic] as number) + w;
            di += w * (DISS[ic] as number);
          }
        index += di;
        steps++;
      }
      const tot = hist.reduce((s, x) => s + x, 0);
      const harsh =
        ((hist[1] as number) +
          (hist[2] as number) +
          (hist[6] as number) +
          (hist[10] as number) +
          (hist[11] as number)) /
        tot;
      expect(harsh, `seed ${seed}`).toBeLessThan(0.05);
      expect(index / steps, `seed ${seed}`).toBeLessThan(0.5);
    }
  });

  test('Era II: the echo is erased at every drone change, and the hiss fades with the piece', () => {
    const { automation } = run('era2', { seed: 1962, duration: 140 }, 0.7);
    const gates = automation.filter((a) => a.param === 'echoFeedback');
    expect(gates.map((a) => [+a.t.toFixed(3), a.value])).toEqual([
      [61.15, 0],
      [64.542, 0.36],
      [79.35, 0],
      [82.742, 0.36],
      [94.75, 0],
      [98.142, 0.36],
    ]);
    const hiss = automation.filter((a) => a.channel === 'hiss');
    expect(hiss.map((a) => a.kind)).toEqual(['set', 'target', 'target']);
  });
});

describe('density', () => {
  test('Era I: notes per 10 s stay in a calm range in every section', () => {
    const { events } = run('era1', { seed: 1945, duration: 300 }, 0.6);
    const per10 = new Array<number>(31).fill(0);
    for (const e of events) per10[Math.floor(e.t / 10)] = (per10[Math.floor(e.t / 10)] ?? 0) + 1;
    // ~1.5 notes per second on average (A4 §6.5), never a wall of notes, never empty after the opening
    expect(Math.max(...per10)).toBeLessThanOrEqual(40);
    expect(Math.min(...per10.slice(1, 29))).toBeGreaterThan(0);
    expect(events.length / 300).toBeGreaterThan(0.6);
    expect(events.length / 300).toBeLessThan(2.5);
  });

  test('Era II: about 6 notes per second while both loops run, and a subtractive exit', () => {
    const { events } = run('era2', { seed: 1962, duration: 140 }, 0.8);
    const mid = events.filter((e) => e.t > 40 && e.t < 80).length / 40;
    expect(mid).toBeGreaterThan(4);
    expect(mid).toBeLessThan(10);
    const marimbaTail = events.filter((e) => e.inst.startsWith('marimba') && e.t > 0.98 * 140);
    expect(marimbaTail).toEqual([]);
  });
});
