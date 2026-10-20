// Prints the PoC's result files as markdown tables (DESIGN.md §12). Usage: node summarize.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const load = (n) => {
  const f = path.join(dir, `${n}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const pctOf = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');

console.log('### Latency, stamping and playout\n');
console.log('| Scenario | Client (profile) | RTT ms | Margin (ticks) | Input delay p50 (ticks) | Late actions | Walk inputs mispredicted | Confirm p50 / p95 ms | Applied p50 / p95 ms | Playout delay ms | Underruns (total ms) | Reconnects |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const n of ['base', 'relaystamp', 'hz30', 'mixed', 'harsh', 'slow', 'bigjoin', 'bigjoin-paced', 'bigresync', 'bigresync-paced']) {
  const r = load(n);
  if (!r) continue;
  r.clients.forEach((c, i) => {
    const prof = r.config.clients[i];
    const p = prof.net;
    const label = `${c.client} (${p.delay} ms ±${p.jitter}${p.stallP ? `, ${p.stallP * 100}% × ${p.stallMs} ms` : ''}${prof.costMs ?? r.config.costMs ? `, ${prof.costMs ?? r.config.costMs} ms/tick` : ''})`;
    console.log(
      `| ${n} | ${label} | ${c.rttMs} | ${c.margin} | ${c.inputDelayTicks?.p50} | ${pctOf(c.late, c.acts)} | ${c.predErrTicks?.nonzeroShare === null ? '—' : `${(100 * c.predErrTicks.nonzeroShare).toFixed(1)}%`} | ${c.confirmMs?.p50} / ${c.confirmMs?.p95} | ${c.applyMs?.p50} / ${c.applyMs?.p95} | ${c.playoutDelayMs} | ${c.stalls?.n} (${c.stalls?.totalMs}) | ${c.reconnects} |`,
    );
  });
}

console.log('\n### Agreement, desyncs, joins and transfers\n');
console.log('| Scenario | Final digests agree | Desyncs detected | Snapshots (bytes, upload ms) | Join: download ms, catch-up ticks / ms | Re-sync: download ms, swapped after ms | Donor RTT idle p50 → during upload p50 / p95 |');
console.log('|---|---|---|---|---|---|---|');
for (const n of ['base', 'relaystamp', 'hz30', 'mixed', 'harsh', 'slow', 'bigjoin', 'bigjoin-paced', 'bigresync', 'bigresync-paced']) {
  const r = load(n);
  if (!r) continue;
  const snaps = (r.relay?.snaps ?? []).map((s) => `${s.reason} ${(s.bytes / 1e6).toFixed(1)} MB ${Math.round(s.uploadMs ?? 0)}`).join('; ');
  const joins = r.clients
    .filter((c) => c.lastSnap)
    .map((c) => `${c.client}: ${c.lastSnap.downloadMs}, ${c.catchups.find((x) => x.reason === 'join')?.ticks ?? '—'} / ${c.catchups.find((x) => x.reason === 'join')?.ms ?? '—'}`)
    .join('; ');
  const res = r.clients
    .flatMap((c) => (c.resyncs ?? []).map((x) => `${c.client}: ${x.downloadMs ?? '—'}, ${x.swappedAfterMs ?? 'not within run'}`))
    .join('; ');
  const donors = r.clients
    .filter((c) => c.rttDuringTransfer?.n > 0 && (c.uploads ?? []).length)
    .map((c) => `${c.client}: ${c.rttIdle.p50} → ${c.rttDuringTransfer.p50} / ${c.rttDuringTransfer.p95}`)
    .join('; ');
  console.log(`| ${n} | ${r.agree ? 'yes' : 'no'} (ticks ${r.agreeAtTicks.join(', ')}) | ${r.relay?.desyncs?.length ?? 0} | ${snaps || '—'} | ${joins || '—'} | ${res || '—'} | ${donors || '—'} |`);
}

console.log('\n### Bytes (payload, both directions as seen by the client)\n');
console.log('| Scenario | Client | Bytes in per minute | Bytes out per minute | Tick messages per second |');
console.log('|---|---|---|---|---|');
for (const n of ['base', 'hz30', 'mixed']) {
  const r = load(n);
  if (!r) continue;
  r.clients.forEach((c, i) => {
    const mins = (r.config.duration - r.config.clients[i].start) / 60000;
    console.log(`| ${n} | ${c.client} | ${Math.round(c.bytes.in / mins)} | ${Math.round(c.bytes.out / mins)} | ${(c.bytes.ticksMsgs / (mins * 60)).toFixed(1)} |`);
  });
}
