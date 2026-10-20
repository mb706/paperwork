// The admission function (src/shared/admission.ts; 10 §15.3 "Admission", B1-r1 10) against its shared fixture,
// test/fixtures/admission/cases.txt, which the native TestSequencer mirrors; and the LocalSequencer, which uses
// it, building exactly those ticks' closures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AdmissionAction, assignTicks } from '../../src/shared/admission.ts';
import { CLOSURE_MAX, closureActions, SYSTEM_PLAYER, SYSTEM_RESERVE } from '../../src/shared/gen/actions.ts';
import { LocalSequencer } from '../../src/simworker/sequencer.ts';
import { GAME } from '../helpers/paths.ts';

interface Case {
  name: string;
  open: number;
  actions: AdmissionAction[];
  ticks: number[];
}

/** Reads cases.txt (its header documents the format). */
function admissionCases(): Case[] {
  const text = readFileSync(join(GAME, 'test', 'fixtures', 'admission', 'cases.txt'), 'utf8');
  const cases: Case[] = [];
  let c: Case | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [word, ...rest] = line.split(' ');
    if (word === 'case') {
      c = { name: rest.join(' '), open: 1, actions: [], ticks: [] };
      cases.push(c);
      continue;
    }
    if (!c) throw new Error(`cases.txt: ${line} before a case`);
    if (word === 'open') c.open = Number(rest[0]);
    else if (word === 'act') {
      const [player, seq, payload, blobs, arrow, tick] = rest.map(String);
      if (arrow !== '->') throw new Error(`cases.txt: ${line}`);
      c.actions.push({
        player: Number(player),
        seq: Number(seq),
        payloadBytes: Number(payload),
        blobCount: Number(blobs),
      });
      c.ticks.push(Number(tick));
    } else if (word === 'run') {
      const arrow = rest.indexOf('->');
      const [player, first, count, payload, blobs] = rest.slice(0, arrow).map(Number) as number[];
      const spans = rest.slice(arrow + 1).map((s) => s.split(':').map(Number) as [number, number]);
      expect(
        spans.reduce((n, [, k]) => n + k, 0),
        line,
      ).toBe(count);
      for (let i = 0; i < (count as number); i++)
        c.actions.push({
          player: player as number,
          seq: (first as number) + i,
          payloadBytes: payload as number,
          blobCount: blobs as number,
        });
      for (const [tick, k] of spans) for (let i = 0; i < k; i++) c.ticks.push(tick);
    } else throw new Error(`cases.txt: unknown directive ${word}`);
  }
  return cases;
}

describe('the admission function (§15.3) and its shared fixture', () => {
  const cases = admissionCases();

  it('reads every case of the fixture', () => {
    expect(cases.length).toBeGreaterThanOrEqual(7);
    expect(CLOSURE_MAX - SYSTEM_RESERVE).toBe(1_044_480);
  });

  for (const c of cases)
    it(`assigns the fixture's ticks: ${c.name}`, () => {
      expect(assignTicks(c.actions, c.open)).toEqual(c.ticks);
    });

  it('the LocalSequencer builds exactly those ticks (player actions without blobs)', () => {
    for (const c of cases) {
      if (c.open !== 1 || c.actions.some((a) => a.blobCount > 0)) continue;
      const seq = new LocalSequencer();
      seq.bind({ tick: 0, lastSystemSeq: 0, players: [] });
      // Each action as its own `act` (type 999: unknown to the sim, refused as malformed; the sequencer does not
      // read payloads), the system ones through `system`.
      for (const a of c.actions) {
        const frame = new Uint8Array(4 + a.payloadBytes);
        if (a.player === SYSTEM_PLAYER) {
          seq.system(0xff05, new Uint8Array(a.payloadBytes));
          continue;
        }
        new DataView(frame.buffer).setUint16(0, 999, true);
        new DataView(frame.buffer).setUint16(2, a.payloadBytes, true);
        const err = seq.submit(a.player, a.seq, frame, null);
        expect(err, `${c.name}: ${a.player}/${a.seq}`).toBeNull();
      }
      const got: number[] = [];
      const last = Math.max(...c.ticks);
      for (let t = 1; t <= last; t++) {
        const len = seq.length(t);
        expect(len, `${c.name}: tick ${t}`).toBeLessThanOrEqual(CLOSURE_MAX);
        const buf = new Uint8Array(len);
        seq.write(t, buf, new DataView(buf.buffer), 0);
        for (const a of closureActions(buf))
          got[
            c.actions.findIndex((x) => x.player === (a.system ? SYSTEM_PLAYER : a.player) && x.seq === a.seq)
          ] = t;
        seq.done(t);
      }
      expect(got, c.name).toEqual(c.ticks);
    }
  });
});
