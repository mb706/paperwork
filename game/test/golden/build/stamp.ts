// Turns a scenario into closures the way a sequencer would (10 §3.3, §15.3): each player's seqs rise by one
// per action from its saved last_seq; system actions take the system counter from last_system_seq; held
// inputs get the input generation the sequencer tracks (the world's value plus one per release_inputs and
// player_left it has seen), unless the step overrides it to make a fenced input; consecutive actions of one
// player in a tick form a batch.
import {
  type Action,
  actionBlob,
  actionBytes,
  encodeClosure,
  withInputGen,
} from '../../../src/shared/gen/actions.ts';
import type { World } from '../model/world.ts';

export type Resolver = { seq: (label: string) => number };

export interface Step {
  t: number;
  /** A player index, or 'sys' for a system action (player 0xFFFF). */
  who: number | 'sys';
  /** The action, or a function of earlier labels' seqs (creation ids, §4.3). */
  a?: Action | ((r: Resolver) => Action);
  /** Raw payload bytes for a malformed action, with its type id. */
  raw?: { type: number; payload: Uint8Array };
  /** Stamp this input generation instead of the tracked one (a fenced held input, D22). */
  gen?: number;
  label?: string;
  /** What the step is for, as the scenario report shows it. */
  why: string;
  /** A blob the action names, supplied for its tick. */
  blob?: Uint8Array;
}

export interface Stamped {
  /** tick → closure bytes (ticks without actions have none). */
  closures: Map<number, Uint8Array>;
  /** tick → blobs (hex sha256 → bytes). */
  blobs: Map<number, Map<string, Uint8Array>>;
  /** Every step with its player, seq and stamped bytes, in execution order. */
  steps: { step: Step; player: number; seq: number; action: Action | null; bytes: Uint8Array }[];
}

export function stamp(world: World, script: readonly Step[], sha256: (b: Uint8Array) => string): Stamped {
  const nextSeq = new Map<number, number>();
  const gen = new Map<number, number>();
  for (const p of world.players) {
    nextSeq.set(p.index, p.last_seq + 1);
    gen.set(p.index, p.input_gen);
  }
  let sysSeq = world.globals.last_system_seq + 1;
  const labels = new Map<string, number>();
  const resolver: Resolver = {
    seq: (l) => {
      const s = labels.get(l);
      if (s === undefined) throw new Error(`no label ${l}`);
      return s;
    },
  };
  const out: Stamped = { closures: new Map(), blobs: new Map(), steps: [] };
  const byTick = new Map<number, Step[]>();
  for (const s of script) byTick.set(s.t, [...(byTick.get(s.t) ?? []), s]);
  for (const t of [...byTick.keys()].sort((a, b) => a - b)) {
    const batches: {
      player: number;
      system: boolean;
      tick: number;
      firstSeq: number;
      actions: Uint8Array[];
    }[] = [];
    for (const s of byTick.get(t) ?? []) {
      const system = s.who === 'sys';
      const player = system ? 0xffff : (s.who as number);
      const seq = system ? sysSeq++ : (nextSeq.get(player) ?? 1);
      if (!system) nextSeq.set(player, seq + 1);
      if (s.label) labels.set(s.label, seq);
      let action: Action | null = null;
      let bytes: Uint8Array;
      if (s.raw) {
        const b = new Uint8Array(4 + s.raw.payload.length);
        const v = new DataView(b.buffer);
        v.setUint16(0, s.raw.type, true);
        v.setUint16(2, s.raw.payload.length, true);
        b.set(s.raw.payload, 4);
        bytes = b;
      } else {
        const a0 = typeof s.a === 'function' ? s.a(resolver) : (s.a as Action);
        action = 'input_gen' in a0 ? withInputGen(a0, s.gen ?? gen.get(player) ?? 0) : a0;
        bytes = actionBytes(action);
        if (action.type === 'release_inputs' || action.type === 'player_left')
          gen.set(action.player, ((gen.get(action.player) ?? 0) + 1) & 0xffff);
        const h = actionBlob(action);
        if (h) {
          if (!s.blob) throw new Error(`step at ${t} names a blob it does not carry`);
          const key = Buffer.from(h).toString('hex');
          if (key !== sha256(s.blob)) throw new Error('blob hash mismatch');
          const m = out.blobs.get(t) ?? new Map<string, Uint8Array>();
          m.set(key, s.blob);
          out.blobs.set(t, m);
        }
      }
      const last = batches[batches.length - 1];
      if (last && last.player === player && last.system === system) last.actions.push(bytes);
      else batches.push({ player, system, tick: t, firstSeq: seq, actions: [bytes] });
      out.steps.push({ step: s, player, seq, action, bytes });
    }
    out.closures.set(t, encodeClosure(batches));
  }
  return out;
}
