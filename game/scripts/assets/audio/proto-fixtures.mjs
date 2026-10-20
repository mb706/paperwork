// Golden note lists from A4's prototype rule sets (design/audio/proto/engine/pieces), for the TypeScript
// port's fidelity test (src/audio/music/pieces/pieces.test.ts). Runs the prototype in Node with a stand-in
// engine, exactly as its `render/dryrun.mjs` does, and writes a digest of every event per configuration.
//
//   node scripts/assets/audio/proto-fixtures.mjs   (from game/; rewrites src/audio/music/pieces/fixtures.json)
//
// The prototype is read, never modified. Rerun only if A4's rules change (they are the approved reference).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const game = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const proto = join(game, '../design/audio/proto/engine/pieces/index.js');
const { PIECES } = await import(pathToFileURL(proto).href);
const { Conductor } = await import(
  pathToFileURL(join(game, '../design/audio/proto/engine/conductor.js')).href
);
const { makeRng } = await import(pathToFileURL(join(game, '../design/audio/proto/engine/rng.js')).href);

/** The configurations the port must reproduce; activity is constant (the port's deviations need a change). */
export const CONFIGS = [
  { name: 'era1-charter', piece: 'era1', params: { seed: 1945 }, duration: 140, activity: 0.6 },
  {
    name: 'era1-long-quiet',
    piece: 'era1',
    params: { seed: 777, transpose: -5, tempoScale: 1.03 },
    duration: 300,
    activity: 0.2,
  },
  {
    name: 'era1-busy',
    piece: 'era1',
    params: { seed: 424242, transpose: 6, tempoScale: 0.96 },
    duration: 210,
    activity: 0.9,
  },
  {
    name: 'era1-machine',
    piece: 'era1',
    params: { seed: 1945, transpose: 0, machine: true },
    duration: 150,
    activity: 0.5,
  },
  { name: 'era2-demo', piece: 'era2', params: { seed: 1962 }, duration: 140, activity: 0.7 },
  {
    name: 'era2-long-quiet',
    piece: 'era2',
    params: { seed: 31337, transpose: 2 },
    duration: 320,
    activity: 0.2,
  },
  { name: 'era2-busy', piece: 'era2', params: { seed: 9001, transpose: -3 }, duration: 200, activity: 0.95 },
];

/** One event as a canonical line (rounded to 1e-6, so a port must agree to the microsecond). */
export const line = (e) =>
  [
    e.t.toFixed(6),
    e.inst,
    e.midi.toFixed(6),
    e.vel.toFixed(6),
    e.dur.toFixed(6),
    Object.keys(e.opts ?? {})
      .sort()
      .map((k) => `${k}=${(+e.opts[k]).toFixed(6)}`)
      .join(','),
  ].join(' ');

const out = {};
for (const cfg of CONFIGS) {
  const log = [];
  const inert = { connect() {}, disconnect() {}, feedback: { value: 0 }, src: { start() {} } };
  const eng = {
    state: { activity: cfg.activity },
    mixer: { addReverb() {}, air() {}, reverbs: new Map() },
    channels: new Map(),
    fx: {},
    route() {},
    alias() {},
    synth() {},
    echo: () => inert,
    noise: () => inert,
    fade() {},
    play(ev) {
      log.push(ev);
    },
  };
  const spec = PIECES[cfg.piece];
  spec.setup(eng, cfg.params);
  const piece = new spec.Piece(eng, { ...cfg.params, duration: cfg.duration, start: 0.05 });
  let cursor = 0;
  for (let t = 0; t < cfg.duration + 6; t += 0.25) {
    piece.schedule(cursor, t + 0.8);
    cursor = t + 0.8;
  }
  const lines = log.map(line);
  const counts = {};
  for (const e of log) counts[e.inst] = (counts[e.inst] ?? 0) + 1;
  out[cfg.name] = {
    config: cfg,
    events: log.length,
    counts,
    sha256: createHash('sha256').update(lines.join('\n')).digest('hex'),
    head: lines.slice(0, 12),
  };
  console.log(`${cfg.name}: ${log.length} events`, counts);
}

// The conductor over the prototype's simulated game (render/session.mjs): the competent pace of 00 §4.
const H = 3600;
const lit = [
  [0, 1945],
  [0.7 * H, 1955],
  [3.1 * H, 1995],
  [4.5 * H, 2011],
  [6.1 * H, 2018],
  [8.5 * H, 2023],
  [11.5 * H, 2024],
];
export const litAt = (t) => {
  for (let i = 1; i < lit.length; i++)
    if (t < lit[i][0])
      return (
        lit[i - 1][1] + ((lit[i][1] - lit[i - 1][1]) * (t - lit[i - 1][0])) / (lit[i][0] - lit[i - 1][0])
      );
  return 2024;
};
for (const seed of [7, 1945]) {
  const rng = makeRng(seed);
  const c = new Conductor({ seed });
  let act = 0.4;
  for (let t = 0; t < 12.6 * H; t += 5) {
    act = Math.max(0.05, Math.min(1, act + rng.gauss() * 0.02 + (t < H ? 0.001 : 0)));
    c.update(t, { literatureYear: litAt(t), activity: act, closure: t >= 11.5 * H, victory: t >= 12.3 * H });
  }
  const lines = c.program.map((s) =>
    [s.kind, s.piece ?? '-', s.start.toFixed(6), s.end.toFixed(6), JSON.stringify(s.params ?? null)].join(
      ' ',
    ),
  );
  out[`conductor-session-${seed}`] = {
    segments: lines.length,
    sha256: createHash('sha256').update(lines.join('\n')).digest('hex'),
    head: lines.slice(0, 8),
  };
  console.log(`conductor session ${seed}: ${lines.length} segments`);
}
writeFileSync(join(game, 'src/audio/music/pieces/fixtures.json'), `${JSON.stringify(out, null, 1)}\n`);
