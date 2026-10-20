// The golden ABI traces (README "ABI traces"; GATE-r1 findings 10 and 11): what each one calls, and why. Their
// expected answers are recorded from the reference model's Module (traces.ts), never written by hand.
import {
  ChunkDataCodec,
  NewWorldCodec,
  SaveInputCodec,
  SaveOutputCodec,
} from '../../../src/shared/gen/abi.ts';
import { actionBytes, encodeClosure } from '../../../src/shared/gen/actions.ts';
import { readSaveContainer } from '../../../src/shared/gen/container.ts';
import type { SubRequest } from '../../../src/shared/gen/projections.ts';
import { ProjectionKind, QueryKind } from '../../../src/shared/gen/projections.ts';
import { ProtoKind } from '../../../src/shared/gen/types.ts';
import { chestInv, clear, insert, mainInv, slots, sortMain } from '../model/inventory.ts';
import { Module } from '../model/module.ts';
import type { Protos } from '../model/protos.ts';
import { applyRemaps } from '../model/remap.ts';
import { lineage0 } from '../model/sim.ts';
import { chunkKey, World } from '../model/world.ts';
import { goldenSubs, goldenView } from './run.ts';
import { SERIAL, sha256Hex } from './scenario.ts';
import { type Step, stamp } from './stamp.ts';
import { START } from './start.ts';
import {
  FLAGS,
  initInput,
  invoke,
  loadInput,
  queryInput,
  subscribeInput,
  type Trace,
  type TraceCall,
  unsubscribeInput,
  viewInput,
} from './traces.ts';

const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

const NONE_REF = { a: 0, b: 0, tag: 0 };

const sub = (sub_id: number, kind: number, target = 0, p0 = 0, p1 = 0, p2 = 0): SubRequest => ({
  sub_id,
  kind,
  flags: 0,
  target,
  p0,
  p1,
  p2,
  p3: 0,
});

export interface TraceInputs {
  protosBin: Uint8Array;
  protos: Protos;
  startSave: Uint8Array;
}

/** The boot every trace starts with: sim_init with the golden prototypes, sim_load of the golden start save. */
function boot(x: TraceInputs): TraceCall[] {
  const c = readSaveContainer(x.startSave);
  return [
    { call: 'sim_init', in: initInput(x.protosBin), note: 'the golden prototypes' },
    {
      call: 'sim_load',
      in: loadInput(c.frames, BigInt(`0x${c.header.lineage}`)),
      note: "the golden start save's sections and lineage, no remap tables",
    },
  ];
}

export function traces(x: TraceInputs): Trace[] {
  const c = readSaveContainer(x.startSave);
  const empty = new Uint8Array();
  const view = viewInput({ ...goldenView(SERIAL.chestA), view_seq: 1 });
  const out: Trace[] = [];

  out.push({
    name: 'boot-and-order',
    why: 'call order (§15.8): ERR_ORDER before a world, flags, a plain load and its report, meta, digest, the state hash, an ignored chunk, a save, and the report until the next world call',
    calls: [
      { call: 'sim_load_report', note: 'before sim_init: ERR_ORDER' },
      { call: 'sim_init', in: initInput(x.protosBin) },
      { call: 'sim_load_report', note: 'no world call yet: ERR_ORDER' },
      { call: 'sim_tick', in: empty, note: 'no world exists yet: ERR_ORDER (tick-before-world)' },
      { call: 'sim_set_flags', params: [8], note: 'SimFlags bit 3: ERR_INPUT (set-flags-undeclared)' },
      boot(x)[1] as TraceCall,
      { call: 'sim_meta', note: 'tick, seed, last_system_seq, worldgen version, r and the players' },
      { call: 'sim_load_report', note: 'a load without remap tables: the save lineage, nothing removed' },
      { call: 'sim_digest', note: 'tick 0: d is 0 (no tick ran), r the save lineage' },
      { call: 'sim_state_hash' },
      { call: 'sim_pending_chunks', note: 'the golden map is stored whole: nothing pending' },
      {
        call: 'sim_supply_chunk',
        in: ChunkDataCodec.encode({ ...ChunkDataCodec.defaults(), key: chunkKey(0, 0) }),
        note: 'a chunk no request asked for: ignored, the state is unchanged',
      },
      { call: 'sim_set_flags', params: [FLAGS.no_sleep], note: 'NO_SLEEP: changes no state' },
      { call: 'sim_save', in: SaveInputCodec.encode({ flags: 0 }), note: 'the sections and the lineage' },
      {
        call: 'sim_save',
        in: SaveInputCodec.encode({ flags: 1 }),
        note: 'BAKE: nothing is pristine here, but a baked save starts a new lineage, XXH64(stateHash ‖ tick)',
      },
      { call: 'sim_tick', in: empty, note: 'tick 1, an empty closure' },
      { call: 'sim_digest', note: 'd_1 and r_1' },
      { call: 'sim_load_report', note: 'still the load: sim_tick is no world call' },
      {
        call: 'sim_new_world',
        in: NewWorldCodec.encode(NewWorldCodec.defaults()),
        note: 'replaces the world',
      },
      {
        call: 'sim_load_report',
        note: 'the last world call was sim_new_world: ERR_ORDER (load-report-without-load)',
      },
    ],
  });

  out.push({
    name: 'queries',
    why: 'queries (§15.5): at most 4 running (ERR_LIMIT), step 0 finishes none, cancel (an unknown id is ignored), results in arrival order spanning a tick, an unsupported kind',
    calls: [
      ...boot(x),
      { call: 'sim_query', in: queryInput(1, QueryKind.hash), note: 'id 1: the state hash' },
      { call: 'sim_query', in: queryInput(2, QueryKind.digest), note: 'id 2: the digest' },
      {
        call: 'sim_query',
        in: queryInput(3, QueryKind.inspect, u32(SERIAL.chestA)),
        note: 'id 3: inspect chest A',
      },
      {
        call: 'sim_query',
        in: queryInput(4, QueryKind.rates),
        note: 'id 4: rates, outside M0: an unsupported result',
      },
      { call: 'sim_query', in: queryInput(5, QueryKind.hash), note: 'a fifth: ERR_LIMIT (query-limit)' },
      { call: 'sim_query_step', params: [0], note: 'no work: nothing finishes' },
      { call: 'sim_query_cancel', params: [2], note: 'drops id 2' },
      { call: 'sim_query_cancel', params: [99], note: 'an unknown id is ignored' },
      {
        call: 'sim_query',
        in: queryInput(6, QueryKind.inspect, u32(SERIAL.p0)),
        note: 'id 6: a character is no entity',
      },
      { call: 'sim_tick', in: empty, note: 'the queries span a tick' },
      {
        call: 'sim_query_step',
        params: [0xffffffff],
        note: 'all finish: 1, 3, 4, 6 in arrival order, first tick 0, last 1',
      },
      { call: 'sim_query_step', params: [0xffffffff], note: 'none left' },
    ],
  });

  const stats = (id: number) => sub(id, ProjectionKind.stats, 0, 1, 0, 0);
  out.push({
    name: 'subscriptions',
    why: 'subscriptions (§15.5): unsubscribe (and an unknown id), replacement, both limits (32 subscriptions, 4 STATS) including a replacement over the STATS limit',
    calls: [
      ...boot(x),
      { call: 'sim_subscribe', in: subscribeInput(goldenSubs()), note: "the golden packets' subscriptions" },
      { call: 'sim_extract', in: view, note: 'every subscription answers once' },
      { call: 'sim_unsubscribe', in: unsubscribeInput([3, 9]), note: 'chest A windows close' },
      { call: 'sim_unsubscribe', in: unsubscribeInput([77]), note: 'an unknown id is ignored' },
      { call: 'sim_tick', in: empty },
      { call: 'sim_extract', in: view, note: 'no record of 3 or 9; unchanged records are not resent' },
      {
        call: 'sim_subscribe',
        in: subscribeInput([stats(10), stats(11), stats(12)]),
        note: 'three more STATS: four with sub 6',
      },
      {
        call: 'sim_subscribe',
        in: subscribeInput([stats(5)]),
        note: 'replacing HUD sub 5 by a fifth STATS: status 2 reason 3, and sub 5 ends',
      },
      { call: 'sim_extract', in: view },
      {
        call: 'sim_subscribe',
        in: subscribeInput(Array.from({ length: 30 }, (_, i) => sub(100 + i, ProjectionKind.hud))),
        note: '30 HUD subscriptions: those past 32 live ones get status 2 reason 3',
      },
      { call: 'sim_extract', in: view },
      {
        call: 'sim_subscribe',
        in: subscribeInput([sub(0, ProjectionKind.hud)]),
        note: 'sub_id 0 is the hover projection: ERR_INPUT, nothing changes',
      },
    ],
  });

  out.push(transitions(x, view));
  out.push(watermarks(x));
  out.push(capacity(x));

  // A save made with other prototypes (§8.3): its item ids in another order, and copper plates this build lacks.
  const save = remappedSave(x);
  out.push({
    name: 'remap-load',
    why: 'a load with remap tables (§8.3, §15.8): ids reordered, an item removed with its count, a new lineage over the resulting state',
    calls: [
      { call: 'sim_init', in: initInput(x.protosBin) },
      { call: 'sim_load', in: save, note: 'item ids remapped; 7 copper plates removed' },
      { call: 'sim_load_report', note: 'new lineage XXH64(stateHash ‖ tick); removed: copper-plate, 7' },
      { call: 'sim_state_hash', note: "the golden start's state: the remap undid the reordering" },
      { call: 'sim_digest' },
      { call: 'sim_meta' },
    ],
  });
  void c;
  void lineage0;
  return out;
}

/**
 * The golden start world as a build with items [iron-ore, iron-chest, copper-plate, iron-plate] would have
 * saved it, with 7 copper plates in chest B, as sim_load's input with the remap tables the shell would build.
 */
function remappedSave(x: TraceInputs): Uint8Array {
  const c = readSaveContainer(x.startSave);
  const w = World.load(x.protos, c.frames);
  // M0's items are [iron-chest, iron-ore, iron-plate]; the save's build had [iron-ore, iron-chest, copper-plate, iron-plate].
  const toSave = [1, 0, 3];
  applyRemaps(w, [{ kind: ProtoKind.item, ids: toSave, removed: [] }]);
  w.rebuild();
  const chestB = w.entityBySerial(SERIAL.chestB);
  if (!chestB) throw new Error('no chest B');
  const inv = w.container(chestB).inv;
  insert(w, { ref: inv, size: 32, bar: 32, origin: -1 }, 2 * 8, 7); // copper-plate, the save's id 2
  const name = new TextEncoder().encode('copper-plate');
  return loadInput(w.frames(), BigInt(`0x${c.header.lineage}`), [
    { kind: ProtoKind.item, ids: [1, 0, 0xffff, 2], removed: [{ name }] },
  ]);
}

void START;

/**
 * Retained-state transitions of the packet stream (§15.4–§15.6; GATE-r1 finding 10), extracted after every
 * interesting tick: a chest the renderer sees appear and then disappear; subscriptions to it that go `gone`; a
 * replacement that changes a subscription's kind; the hover; a view that leaves the held chunks (MOVERS goes
 * from populated to absent) and comes back (every per-chunk record afresh); historical events; and an event
 * queue overflow (EVENTS_DROPPED, the newest 8,192 kept).
 */
function transitions(x: TraceInputs, view: Uint8Array): Trace {
  const c = readSaveContainer(x.startSave);
  const w = World.load(x.protos, c.frames);
  const chestKey = x.protos.id('item', 'iron-chest') * 8;
  const chestC = 4; // the start save's next serial
  const steps: Step[] = [
    {
      t: 1,
      who: 0,
      a: { type: 'cursor_transfer', slot: { owner: NONE_REF, inv: 1, slot: 0 } },
      why: 'pick up the chests',
    },
    {
      t: 2,
      who: 0,
      a: {
        type: 'build',
        item: chestKey,
        pos: { x2: 75, y2: 5 },
        dir: 0,
        flip: false,
        mode: 0,
        flags: 0,
        drag_id: 0,
      },
      why: 'build chest C at (37, 2)',
    },
    {
      t: 4,
      who: 0,
      a: { type: 'begin_mining', input_gen: 0, target: { a: chestC, b: 0, tag: 1 } },
      why: 'mine chest C: gone 24 ticks later',
    },
    ...Array.from(
      { length: 9000 },
      (): Step => ({
        t: 40,
        who: 0,
        raw: { type: 999, payload: new Uint8Array() },
        why: 'an unknown action type: 9,000 malformed refusals, more events than the queue holds',
      }),
    ),
    {
      t: 34,
      who: 0,
      a: { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: { x: 37 * 256 + 128, y: 128 } },
      why: 'no resource there: an action_failed event while HISTORICAL is set',
    },
  ];
  const st = stamp(w, steps, sha256Hex);
  const far = viewInput({
    ...goldenView(0),
    view_seq: 2,
    x0: -48,
    y0: 16,
    x1: -24,
    y1: 40,
    hovered_serial: 0,
  });
  const back = viewInput({ ...goldenView(chestC), view_seq: 3 });
  const tick = (t: number): TraceCall => ({
    call: 'sim_tick',
    in: st.closures.get(t) ?? new Uint8Array(),
    note: `tick ${t}${st.closures.has(t) ? '' : ', an empty closure'}`,
  });
  const extract = (v: Uint8Array, note?: string): TraceCall =>
    note ? { call: 'sim_extract', in: v, note } : { call: 'sim_extract', in: v };
  const hoverC = viewInput({ ...goldenView(chestC), view_seq: 1 });
  const calls: TraceCall[] = [...boot(x)];
  calls.push(
    extract(view, 'the FULL packet after a load: header only (rule 31)'),
    {
      call: 'sim_subscribe',
      in: subscribeInput([sub(1, ProjectionKind.character, 0), sub(2, ProjectionKind.hud)]),
    },
    extract(view, 'tick 0: the chunks, MOVERS, the hover, CHARACTER and HUD'),
  );
  for (let t = 1; t <= 45; t++) {
    calls.push(tick(t));
    if (t === 2) {
      calls.push(extract(hoverC, 'chest C appears (CHUNK_ENTITIES), hovered'));
      calls.push({
        call: 'sim_subscribe',
        in: subscribeInput([
          sub(10, ProjectionKind.inventory, chestC, 2),
          sub(11, ProjectionKind.entity_panel, chestC),
        ]),
        note: "chest C's window: INVENTORY and ENTITY_PANEL",
      });
      calls.push(extract(hoverC, 'their first records'));
    }
    if (t === 28 || t === 29) calls.push(extract(hoverC, t === 28 ? 'chest C is mined' : 'the tick after'));
    if (t === 30) {
      calls.push({
        call: 'sim_subscribe',
        in: subscribeInput([sub(1, ProjectionKind.hud)]),
        note: 'sub 1 becomes a HUD: its version keeps counting',
      });
      calls.push(extract(view, 'the replaced subscription'));
      calls.push(extract(far, 'the view leaves every held chunk: MOVERS absent'));
      calls.push(extract(back, 'and comes back: every per-chunk record afresh, MOVERS again'));
      calls.push({ call: 'sim_unsubscribe', in: unsubscribeInput([1]), note: 'drops sub 1' });
    }
    if (t === 33)
      calls.push({
        call: 'sim_set_flags',
        params: [FLAGS.historical],
        note: 'HISTORICAL on (catch-up, §15.6)',
      });
    if (t === 34) calls.push({ call: 'sim_set_flags', params: [0], note: 'HISTORICAL off' });
    if (t === 35) calls.push(extract(back, "tick 34's refusal carries the HISTORICAL flag"));
    if (t === 40) calls.push(extract(back, '9,000 events: EVENTS_DROPPED, the newest 8,192 kept'));
    if (t === 45) calls.push(extract(back, 'the queue is empty again'));
  }
  return {
    name: 'packet-transitions',
    why: 'retained state across packets (§15.4–§15.6): an entity appears and is removed, subscriptions go gone, a replacement, the hover, held-set eviction and re-entry, MOVERS populated then absent, historical events, an event overflow',
    calls,
  };
}

/**
 * Seq watermarks without a character (§15.3 "Identity and seq", D21; GATE-r1 finding 3; rule 12): a player
 * index that has never joined sends an action, which is refused but consumes its seq; the same seq is refused by
 * the preflight in the next tick, after a save and a load too; the player then joins and keeps its watermark.
 */
function watermarks(x: TraceInputs): Trace {
  const walk = actionBytes({ type: 'start_walking', input_gen: 0, dir: 0 });
  const closure = (tick: number, firstSeq: number) =>
    encodeClosure([{ player: 5, system: false, tick, firstSeq, actions: [walk] }]);
  const joined = (tick: number, seq: number) =>
    encodeClosure([
      {
        player: 0xffff,
        system: true,
        tick,
        firstSeq: seq,
        actions: [actionBytes({ type: 'player_joined', player: 5, flags: 0 })],
      },
    ]);
  const first: TraceCall[] = [
    ...boot(x),
    {
      call: 'sim_tick',
      in: closure(1, 1),
      note: 'player 5 has no record: refused (player_not_present), seq 1 consumed',
    },
    { call: 'sim_meta', note: 'player 5: a watermark record, offline, no character, last_seq 1' },
    { call: 'sim_tick', in: closure(2, 1), note: 'seq 1 again: ERR_FRAMING, nothing changes' },
    { call: 'sim_save', in: SaveInputCodec.encode({ flags: 0 }), note: 'the watermark is saved state' },
  ];
  // The shell passes a save's sections and lineage back to sim_load.
  const m = new Module();
  for (const c of first) invoke(m, c);
  const saved = SaveOutputCodec.decode(m.sim_save(SaveInputCodec.encode({ flags: 0 })).out as Uint8Array);
  const reload = loadInput(
    saved.sections.map((f) => ({ id: f.id, version: f.version, data: f.data })),
    saved.r,
  );
  return {
    name: 'watermarks',
    why: "a never-joined player's refused action consumes its seq, across a save and a load, and survives its join (rule 12)",
    calls: [
      ...first,
      { call: 'sim_load', in: reload, note: 'the save at tick 1, with its lineage' },
      { call: 'sim_tick', in: closure(2, 1), note: 'still consumed after the load: ERR_FRAMING' },
      { call: 'sim_tick', in: closure(2, 2), note: 'seq 2: refused again (player_not_present), consumed' },
      { call: 'sim_tick', in: joined(3, 1), note: 'player_joined(5): a character; the watermark stays' },
      { call: 'sim_meta', note: 'player 5 online, last_seq 2' },
      { call: 'sim_tick', in: closure(4, 2), note: 'seq 2 again: ERR_FRAMING' },
      { call: 'sim_tick', in: closure(4, 3), note: 'seq 3: player 5 walks' },
      { call: 'sim_digest' },
    ],
  };
}

/**
 * The capacity and fencing branches (GATE-r1 finding 9), from a variant of the start state in which player 0's
 * main inventory is full (50 iron chests, 300 plates, 76 full ore stacks: no partial stack, no empty slot) and
 * chest A, limited to 4 slots, has room for 20 ore. Each step's note says what it tests; the outcomes are the
 * reference model's, and the CHARACTER records, events, sim_meta and the final save pin the state.
 */
function capacity(x: TraceInputs): Trace {
  const c = readSaveContainer(x.startSave);
  const w = World.load(x.protos, c.frames);
  const key = (name: string) => x.protos.id('item', name) * 8;
  const p0 = w.player(0) as NonNullable<ReturnType<World['player']>>;
  const main = mainInv(w, p0);
  for (const s of slots(w, main)) clear(s);
  insert(w, main, key('iron-chest'), 50);
  insert(w, main, key('iron-plate'), 300);
  insert(w, main, key('iron-ore'), 76 * 50);
  sortMain(w, p0);
  const chestA = w.entityBySerial(SERIAL.chestA) as NonNullable<ReturnType<World['entityBySerial']>>;
  const a = chestInv(w, chestA);
  for (const s of slots(w, a)) clear(s);
  insert(w, a, key('iron-ore'), 3 * 50 + 30);
  w.heap.setBar(a.ref, 4, a.size);
  const start = loadInput(w.frames(), lineage0(START.seed));

  const ref = { a: SERIAL.chestA, b: 0, tag: 1 };
  const none = { a: 0, b: 0, tag: 0 };
  const mainSlot = (slot: number) => ({ owner: none, inv: 1, slot });
  const chestSlot = (slot: number) => ({ owner: ref, inv: 2, slot });
  const recipe = x.protos.id('recipe', 'iron-chest');
  const tile = { x: 40 * 256 + 128, y: -2 * 256 + 128 };
  const steps: Step[] = [
    {
      t: 1,
      who: 0,
      a: { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: tile },
      why: 'mine the 2-ore tile with no room for ore: refused when the unit completes (tick 120), the tile keeps its ore (rule 23)',
    },
    {
      t: 2,
      who: 0,
      a: { type: 'craft', recipe, count: 1 },
      why: 'a chest: 8 plates leave; at tick 31 the product finds no room: crafting pauses (rule 25)',
    },
    {
      t: 40,
      who: 0,
      a: { type: 'stack_transfer', from: mainSlot(76), to: ref },
      why: 'an ore stack into chest A, which has room for 20 under its bar: 20 move, 30 stay (rule 19)',
    },
    {
      t: 41,
      who: 0,
      a: { type: 'inventory_transfer', from: mainSlot(1), to: ref },
      why: 'all ore into chest A, full under its bar: nothing moves, inventory_full',
    },
    {
      t: 42,
      who: 0,
      a: { type: 'cursor_transfer', slot: chestSlot(0) },
      why: "pick up chest A's slot 0: 50 ore in the hand, no origin slot",
    },
    { t: 43, who: 0, a: { type: 'clear_cursor' }, why: 'Q with 50 ore and room for 20 (rule 19)' },
    {
      t: 44,
      who: 0,
      a: { type: 'cursor_transfer', slot: chestSlot(6) },
      why: 'the hand onto chest A slot 6, past its bar (rule 16)',
    },
    {
      t: 45,
      who: 0,
      a: { type: 'cursor_transfer', slot: chestSlot(0) },
      why: "whatever is still in the hand into chest A's empty slot 0",
    },
    {
      t: 46,
      who: 0,
      a: { type: 'set_inventory_bar', target: ref, inv: 2, bar: 32 },
      why: "lift chest A's limit",
    },
    {
      t: 47,
      who: 0,
      a: { type: 'stack_transfer', from: mainSlot(77), to: ref },
      why: 'a plate stack into chest A: a main slot frees, and the paused craft completes in this tick',
    },
    { t: 50, who: 0, a: { type: 'craft', recipe, count: 2 }, why: 'two chests: 16 plates leave' },
    {
      t: 51,
      who: 0,
      a: { type: 'fast_entity_transfer', target: ref },
      why: "take what fits from chest A: the inventory fills, the 16 plates' room too",
    },
    {
      t: 52,
      who: 0,
      a: { type: 'cancel_craft', index: 0, count: 0 },
      why: 'cancel both: the refund does not fit (rule 25)',
    },
    {
      t: 121,
      who: 0,
      a: { type: 'craft', recipe, count: 30 },
      why: 'thirty chests with plates for 25: 25 are queued, without a message (rule 25)',
    },
    {
      t: 130,
      who: 'sys',
      a: { type: 'release_inputs', player: 0 },
      why: 'release (after the mining refusal): the input generation rises',
    },
    {
      t: 131,
      who: 0,
      a: { type: 'start_walking', input_gen: 0, dir: 4 },
      why: 'a fresh start (the new generation): walks',
    },
    {
      t: 132,
      who: 0,
      a: { type: 'stop_walking', input_gen: 0 },
      gen: 0,
      why: 'a stop stamped before the release: fenced, it keeps walking',
    },
    {
      t: 133,
      who: 0,
      a: { type: 'begin_mining_terrain', input_gen: 0, kind: 0, pos: tile },
      gen: 0,
      why: 'a begin stamped before the release: fenced',
    },
    { t: 134, who: 0, a: { type: 'stop_walking', input_gen: 0 }, why: 'a fresh stop: stops' },
    {
      t: 140,
      who: 0,
      a: { type: 'fast_entity_transfer', target: ref },
      why: 'take what fits from chest A again: the inventory is full',
    },
    {
      t: 141,
      who: 0,
      a: { type: 'cursor_transfer', slot: chestSlot(1) },
      why: 'pick up a stack from chest A: no origin slot, no room for it',
    },
    {
      t: 142,
      who: 'sys',
      a: { type: 'player_left', player: 0 },
      why: 'leave with a hand that does not fit: it stays in the hand (§5.1)',
    },
    {
      t: 143,
      who: 'sys',
      a: { type: 'player_joined', player: 0, flags: 1 },
      why: 'return: the same character, the hand still held',
    },
    {
      t: 150,
      who: 0,
      a: { type: 'stack_transfer', from: mainSlot(79), to: ref },
      why: 'an ore stack into chest A: one main slot frees',
    },
    {
      t: 151,
      who: 0,
      a: { type: 'begin_mining', input_gen: 0, target: ref },
      why: 'mine chest A: at tick 174 its plates fit, its ore does not: the plates move, chest A stays (rule 23)',
    },
    {
      t: 180,
      who: 0,
      a: { type: 'stop_mining', input_gen: 0 },
      why: 'stop mining',
    },
  ];
  const st = stamp(w, steps, sha256Hex);
  const view = viewInput({ ...goldenView(SERIAL.chestA), view_seq: 1 });
  const calls: TraceCall[] = [
    { call: 'sim_init', in: initInput(x.protosBin) },
    {
      call: 'sim_load',
      in: start,
      note: "the start state with player 0's inventory full and chest A limited to 4 slots",
    },
    { call: 'sim_extract', in: view, note: 'the FULL packet' },
    {
      call: 'sim_subscribe',
      in: subscribeInput([
        sub(1, ProjectionKind.character, 0),
        sub(2, ProjectionKind.inventory, SERIAL.chestA, 2),
      ]),
      note: "player 0's CHARACTER and chest A's INVENTORY",
    },
    { call: 'sim_extract', in: view },
  ];
  const why = new Map<number, string>();
  for (const s2 of steps) why.set(s2.t, [why.get(s2.t), s2.why].filter(Boolean).join('; '));
  for (let t = 1; t <= 182; t++) {
    const closure = st.closures.get(t);
    if (!closure && !WATCH.has(t)) continue;
    // Ticks without actions run as empty closures; the trace keeps only those around the interesting ones.
    calls.push({
      call: 'sim_tick',
      in: closure ?? new Uint8Array(),
      note: `tick ${t}${why.has(t) ? `: ${why.get(t)}` : ''}`,
    });
  }
  return {
    name: 'capacity',
    why: 'capacity and fencing branches (rules 16, 19, 23, 25, D22)',
    calls: fillGaps(calls),
  };
}

/** A trace's sim_tick calls must be consecutive: insert empty ticks where the list skips some, extract at each step. */
/** Ticks without actions where the capacity trace extracts anyway: the craft's pause (31), the mining refusals (120, 175). */
const WATCH = new Set([31, 120, 175]);

function fillGaps(calls: TraceCall[]): TraceCall[] {
  const out: TraceCall[] = [];
  let tick = 0;
  const view = viewInput({ ...goldenView(SERIAL.chestA), view_seq: 1 });
  for (const c of calls) {
    if (c.call === 'sim_tick') {
      const want = Number(/tick (\d+)/.exec(c.note ?? '')?.[1]);
      while (tick + 1 < want) {
        tick++;
        out.push({ call: 'sim_tick', in: new Uint8Array(), note: `tick ${tick}, an empty closure` });
      }
      tick = want;
      out.push(c);
      if ((c.in && c.in.length > 0) || WATCH.has(tick))
        out.push({ call: 'sim_extract', in: view, note: `after tick ${tick}` });
    } else out.push(c);
  }
  out.push({ call: 'sim_extract', in: view, note: 'the end' });
  out.push({ call: 'sim_meta', note: "every player's seqs and input generation" });
  out.push({ call: 'sim_save', in: SaveInputCodec.encode({ flags: 0 }), note: 'the final state' });
  return out;
}
