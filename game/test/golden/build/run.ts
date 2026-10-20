// Runs the golden scenario through the reference model and collects everything the golden set holds:
// the per-tick digests, the canonical states, the packets, the projection records and the query results.
import { readSaveContainer } from '../../../src/shared/gen/container.ts';
import { type EventPayload, readEvents } from '../../../src/shared/gen/events.ts';
import { decodePacket, type ViewRequest } from '../../../src/shared/gen/packet.ts';
import type { SubRequest } from '../../../src/shared/gen/projections.ts';
import { FailReason } from '../../../src/shared/gen/types.ts';
import { Extractor } from '../model/extract.ts';
import { loadProtos, type Protos } from '../model/protos.ts';
import { Sim, Status } from '../model/sim.ts';
import { World } from '../model/world.ts';
import { m0Protos, type ProtoFiles } from './protos.ts';
import { blobBytes, type Ids, script, sha256Hex, TICKS } from './scenario.ts';
import { type Stamped, stamp } from './stamp.ts';
import { type StartSave, startSave } from './start.ts';

/** Ticks whose canonical state the golden set holds (§15.10: 1, 2, 300 and 600; and the start, 0). */
export const STATE_TICKS = [0, 1, 2, 300, 600] as const;
/** Ticks after which the golden packets are extracted (§15.10: 0, 1 and 600). */
export const PACKET_TICKS = [0, 1, 600] as const;

/** The fixed view request of the golden packets: a 40 × 24-tile view around the action, audio on. */
export function goldenView(chestA: number): ViewRequest {
  return {
    view_seq: 0,
    surface: 0,
    flags: 1 << 3, // audio (AUDIO_WORKING stays empty: nothing works in M0)
    x0: 20,
    y0: -12,
    x1: 60,
    y1: 12,
    zoom: 1,
    hovered_serial: chestA,
    audio_half_range: 20,
    chart_x0: 0,
    chart_y0: 0,
    chart_x1: 0,
    chart_y1: 0,
  };
}

/** The golden packets' subscriptions (sent after the FULL packet, §3.4 step 3.2). */
export function goldenSubs(): SubRequest[] {
  const sub = (sub_id: number, kind: number, target: number, p0 = 0, p1 = 0, p2 = 0): SubRequest => ({
    sub_id,
    kind,
    flags: 0,
    target,
    p0,
    p1,
    p2,
    p3: 0,
  });
  return [
    sub(1, 2, 0), // CHARACTER of player 0
    sub(2, 2, 1), // CHARACTER of player 1: gone at tick 0 (it joins at tick 5)
    sub(3, 3, 2, 2), // INVENTORY of chest A (InventoryType.chest)
    sub(4, 4, 4), // ENTITY_PANEL of chest C (serial 4): gone at tick 0, it does not exist yet
    sub(5, 1, 0), // HUD
    sub(6, 7, 0, 1, 0, 1), // STATS: 1 minute, items, with series
    sub(7, 6, 0), // RESEARCH: outside M0's manifest, status 2 reason 1
    sub(8, 3, 2, 5), // INVENTORY of chest A as a fuel inventory: status 2 reason 2
    sub(9, 4, 2), // ENTITY_PANEL of chest A
  ];
}

export interface Outcome {
  tick: number;
  player: number;
  seq: number;
  why: string;
  result: string;
}

export interface RunResult {
  protos: ProtoFiles;
  model: Protos;
  start: StartSave;
  stamped: Stamped;
  digests: bigint[];
  /** tick → the hashed sections as sim_save writes them. */
  states: Map<number, { id: number; bytes: Uint8Array }[]>;
  stateHashes: Map<number, { hash: bigint; sections: { id: number; hash: bigint }[] }>;
  packets: { name: string; tick: number; bytes: Uint8Array }[];
  /** tick → the simulations at that tick (for projection records). */
  sims: Map<number, Sim>;
  outcomes: Outcome[];
  events: { tick: number; payload: EventPayload; player: number; seq: number }[];
}

const REASONS = new Map<number, string>(Object.entries(FailReason).map(([k, v]) => [v as number, k]));

export function ids(model: Protos): Ids {
  return {
    chestKey: model.id('item', 'iron-chest') * 8,
    oreKey: model.id('item', 'iron-ore') * 8,
    plateKey: model.id('item', 'iron-plate') * 8,
    recipe: model.id('recipe', 'iron-chest'),
  };
}

/** A deep copy of a Sim's World at this tick (through a save and load, which the golden set requires to be exact). */
function snapshot(model: Protos, sim: Sim): Sim {
  const copy = new Sim(World.load(model, sim.w.frames()));
  copy.lastDigest = sim.lastDigest;
  return copy;
}

export function run(): RunResult {
  const protos = m0Protos();
  const model = loadProtos(protos.bin);
  const start = startSave(model, protos.bin);
  // The run starts from the start save's bytes, so loading is part of what the golden set pins.
  const loaded = World.load(model, readSaveContainer(start.bytes).frames);
  const sim = new Sim(loaded);
  const stamped = stamp(loaded, script(ids(model)), sha256Hex);
  const states = new Map<number, { id: number; bytes: Uint8Array }[]>();
  const stateHashes = new Map<number, { hash: bigint; sections: { id: number; hash: bigint }[] }>();
  const sims = new Map<number, Sim>();
  const keep = (t: number) => {
    states.set(t, sim.w.sections());
    stateHashes.set(t, sim.w.stateHash());
    sims.set(t, snapshot(model, sim));
  };
  keep(0);

  const x = new Extractor();
  const packets: RunResult['packets'] = [];
  packets.push({ name: 'tick-0000-full', tick: 0, bytes: x.extract(sim) });
  x.view = goldenView(2);
  if (!x.subscribe(goldenSubs())) throw new Error('the golden subscriptions were refused');
  packets.push({ name: 'tick-0000', tick: 0, bytes: x.extract(sim) });

  const digests: bigint[] = [];
  const events: RunResult['events'] = [];
  for (let t = 1; t <= TICKS; t++) {
    const closure = stamped.closures.get(t) ?? new Uint8Array();
    const blobs = new Set((stamped.blobs.get(t) ?? new Map()).keys());
    const before = sim.pres.events.queue.length;
    const r = sim.tick(closure, blobs);
    if (r.status !== Status.ok) throw new Error(`tick ${t}: status ${r.status} (${r.reason})`);
    for (const e of sim.pres.events.queue.slice(before))
      events.push({ tick: t, payload: e.payload, player: e.meta.player, seq: e.meta.seq });
    digests.push(sim.lastDigest);
    if ((STATE_TICKS as readonly number[]).includes(t)) keep(t);
    if ((PACKET_TICKS as readonly number[]).includes(t))
      packets.push({ name: `tick-${String(t).padStart(4, '0')}`, tick: t, bytes: x.extract(sim) });
  }

  const outcomes: Outcome[] = stamped.steps.map(({ step, player, seq }) => {
    const mine = events.filter((e) => e.tick === step.t && e.player === player && e.seq === seq);
    const failed = mine.find((e) => e.payload.type === 'action_failed');
    const fenced = mine.find((e) => e.payload.type === 'input_fenced');
    const result = failed
      ? `refused: ${REASONS.get((failed.payload as { reason: number }).reason)}`
      : fenced
        ? 'fenced (input_fenced)'
        : 'applied';
    return { tick: step.t, player, seq, why: step.why, result };
  });
  // Every packet must decode (the generated decoder is the contract every consumer uses).
  for (const p of packets) {
    const d = decodePacket(p.bytes);
    for (const s of d.sections) if (s.name === 'EVENTS') readEvents(s.bytes, s.count);
  }
  void blobBytes;
  return { protos, model, start, stamped, digests, states, stateHashes, packets, sims, outcomes, events };
}
