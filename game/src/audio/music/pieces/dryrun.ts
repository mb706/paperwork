// A symbolic dry run of a rule set: the piece plays into a recording host, no audio (A4 `render/dryrun.mjs`).
// The tests use it for validity, fidelity against the prototype and the harmony checks; the dev page uses
// it to show a piece's notes.
import type { ChannelParam, MusicState, NoteEvent, PieceParams, PieceSpec } from '../types.ts';
import { defaultMusicState } from '../types.ts';

export interface Automation {
  channel: string;
  param: ChannelParam;
  kind: 'set' | 'target';
  t: number;
  value: number;
  tau: number;
}

export interface DryRun {
  events: NoteEvent[];
  automation: Automation[];
}

/**
 * Runs `spec` for its duration plus six seconds of tail, scheduling like the realtime clock: the window
 * [cursor, t + lookahead) every `step` seconds. `state` may change over time through `at(t)`.
 */
export function dryRun(
  spec: PieceSpec,
  params: PieceParams & { duration: number },
  state: Partial<MusicState> | ((t: number) => Partial<MusicState>) = {},
  { step = 0.25, lookahead = 0.8, start = 0.05 } = {},
): DryRun {
  const events: NoteEvent[] = [];
  const automation: Automation[] = [];
  const st: MusicState = { ...defaultMusicState(), ...(typeof state === 'function' ? state(0) : state) };
  const piece = spec.create(
    {
      state: st,
      play: (ev) => events.push(ev),
      setParam: (channel, param, t, value) =>
        automation.push({ channel, param, kind: 'set', t, value, tau: 0 }),
      targetParam: (channel, param, t, value, tau) =>
        automation.push({ channel, param, kind: 'target', t, value, tau }),
    },
    { ...params, start: params.start ?? start },
  );
  let cursor = 0;
  for (let t = 0; t < params.duration + 6; t += step) {
    if (typeof state === 'function') Object.assign(st, state(t));
    piece.schedule(cursor, t + lookahead);
    cursor = t + lookahead;
  }
  return { events, automation };
}

/** A4's validity rule (§6.6): finite pitch, time ≥ 0, velocity 0–1.2, duration > 0. */
export function invalidEvents(events: readonly NoteEvent[]): NoteEvent[] {
  return events.filter(
    (ev) => !(ev.t >= 0) || !Number.isFinite(ev.midi) || !(ev.vel >= 0 && ev.vel <= 1.2) || !(ev.dur > 0),
  );
}
