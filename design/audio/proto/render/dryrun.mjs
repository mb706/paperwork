// Symbolic dry run: execute a piece's rules in Node with a stand-in engine (no audio), as a fast test.
//   node design/audio/proto/render/dryrun.mjs <config.json> [--dump]
// Prints notes per instrument, the piece's report and any exception. Validates every event.
import fs from 'node:fs';
import { PIECES } from '../engine/pieces/index.js';

const args = process.argv.slice(2);
const cfgs = JSON.parse(fs.readFileSync(args[0], 'utf8'));
for (const cfg of Array.isArray(cfgs) ? cfgs : [cfgs]) {
  const log = [];
  const inert = { connect() {}, disconnect() {}, feedback: { value: 0 }, src: { start() {} } };
  const eng = {
    state: { activity: 0.5 },
    mixer: { addReverb() {}, air() {}, reverbs: new Map() },
    channels: new Map(),
    route() {},
    alias() {},
    synth() {},
    echo: () => inert,
    noise: () => inert,
    fade() {},
    play(ev) {
      if (!(ev.t >= 0) || !Number.isFinite(ev.midi) || !(ev.vel >= 0 && ev.vel <= 1.2) || !(ev.dur > 0)) throw new Error(`bad event ${JSON.stringify(ev)}`);
      log.push(ev);
    },
  };
  const spec = PIECES[cfg.piece];
  spec.setup(eng, cfg.params ?? {});
  const auto = (cfg.automation ?? []).slice().sort((a, b) => a[0] - b[0]);
  const piece = new spec.Piece(eng, { ...(cfg.params ?? {}), duration: cfg.duration, start: 0.05 });
  const t0 = performance.now();
  let cursor = 0;
  for (let t = 0; t < cfg.duration + 6; t += 0.25) {
    while (auto.length && auto[0][0] <= t) Object.assign(eng.state, auto.shift()[1]);
    piece.schedule(cursor, t + 0.8);
    cursor = t + 0.8;
  }
  const by = {};
  for (const e of log) by[e.inst] = (by[e.inst] ?? 0) + 1;
  // note rate per 10 s
  const rate = [];
  for (const e of log) rate[Math.floor(e.t / 10)] = (rate[Math.floor(e.t / 10)] ?? 0) + 1;
  console.log(`${cfg.name}: ${log.length} notes in ${(performance.now() - t0).toFixed(0)} ms`, by);
  console.log('  notes per 10 s:', Array.from(rate, (x) => x ?? 0).join(' '));
  const rep = piece.report?.();
  if (rep) console.log('  report:', JSON.stringify(rep).slice(0, 400));
  if (args.includes('--dump')) for (const e of log) console.log(e.t.toFixed(3), e.inst, e.midi.toFixed(2), e.vel.toFixed(2), e.dur.toFixed(2));
}
