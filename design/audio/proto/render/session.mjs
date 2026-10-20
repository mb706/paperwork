// Dry-run the conductor over a simulated game: the competent pace of 00-overview §4 (tier ends at
// 0.7, 3.1, 4.5, 6.1, 8.5 h; closure at 11.5 h; victory at 12.3 h), the Literature year rising
// through the tiers, activity as a slow random walk. Reports how much music plays, per era, and
// whether anything repeats.
//   node design/audio/proto/render/session.mjs [seed]
import { Conductor, eraFor } from '../engine/conductor.js';
import { makeRng } from '../engine/rng.js';

const seed = Number(process.argv[2] ?? 7);
const H = 3600;
// Literature year at tier ends (00 §4): start 1945, Memo 1955, Report 1995, Article 2011, Preprint 2018, Model card 2023
const lit = [[0, 1945], [0.7 * H, 1955], [3.1 * H, 1995], [4.5 * H, 2011], [6.1 * H, 2018], [8.5 * H, 2023], [11.5 * H, 2024]];
const litAt = (t) => {
  for (let i = 1; i < lit.length; i++) if (t < lit[i][0]) return lit[i - 1][1] + ((lit[i][1] - lit[i - 1][1]) * (t - lit[i - 1][0])) / (lit[i][0] - lit[i - 1][0]);
  return 2024;
};
const rng = makeRng(seed);
const c = new Conductor({ seed });
let act = 0.4;
const end = 12.6 * H;
for (let t = 0; t < end; t += 5) {
  act = Math.max(0.05, Math.min(1, act + rng.gauss() * 0.02 + (t < H ? 0.001 : 0)));
  c.update(t, { literatureYear: litAt(t), activity: act, closure: t >= 11.5 * H, victory: t >= 12.3 * H });
}
const segs = c.program.filter((s) => s.start < end).map((s) => ({ ...s, end: Math.min(s.end, end) }));
const tot = (k) => segs.filter((s) => s.kind === k).reduce((a, s) => a + (s.end - s.start), 0);
console.log(`seed ${seed}: ${segs.length} segments over ${(end / H).toFixed(1)} h; music ${((100 * tot('piece')) / end).toFixed(0)}%, silence ${((100 * tot('silence')) / end).toFixed(0)}%`);
const byEra = {};
for (const s of segs.filter((x) => x.kind === 'piece')) {
  const k = s.piece === 'takeoff' ? 'takeoff' : s.era ?? 'charter';
  byEra[k] ??= { pieces: 0, minutes: 0, keys: new Set() };
  byEra[k].pieces++;
  byEra[k].minutes += (s.end - s.start) / 60;
  byEra[k].keys.add(s.params?.transpose);
}
for (const [k, v] of Object.entries(byEra)) console.log(`  ${k.padEnd(22)} ${String(v.pieces).padStart(3)} pieces, ${v.minutes.toFixed(0).padStart(4)} min, keys ${[...v.keys].sort((a, b) => a - b).join(' ')}`);
const sig = segs.filter((s) => s.kind === 'piece').map((s) => `${s.piece}/${s.params?.seed}/${s.params?.transpose}`);
const dup = sig.filter((x, i) => sig.indexOf(x) !== i);
console.log(`  repeated pieces: ${dup.length ? dup.join(', ') : 'none'} (the charter piece returns once after victory, by design)`);
const first = segs.slice(0, 6).map((s) => `${s.kind}${s.piece ? `:${s.piece}` : ''} ${(s.start / 60).toFixed(1)}-${(s.end / 60).toFixed(1)} min`);
console.log(`  opening: ${first.join(' | ')}`);
const era2 = segs.find((s) => s.era === 'Tape and oscillators');
console.log(`  first Era II piece at ${(era2.start / 60).toFixed(0)} min (Literature ${litAt(era2.start).toFixed(0)})`);
const tk = segs.find((s) => s.piece === 'takeoff');
console.log(`  takeoff from ${(tk.start / H).toFixed(2)} h to ${(tk.end / H).toFixed(2)} h; then ${segs.slice(segs.indexOf(tk) + 1).map((s) => `${s.kind}${s.params?.machine ? ' (charter piece, by the machine)' : ''}`).join(', ')}`);
