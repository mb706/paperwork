// Golden composite fixtures (10 §15.1, D18 g): whole messages that cross the boundary, beyond single
// records. Each file in test/fixtures/codec/golden/ is what the TypeScript side writes from the inputs below
// (`UPDATE_GOLDEN=1 npx vitest run test/codec/golden.test.ts` rewrites them after a deliberate change), and
// crates/sim/tests/codec_fixtures/main.rs holds the Rust side to the same bytes:
//   closure.bin      a closure of tick 7 (encodeClosure): Rust preflights it, iterates and decodes it;
//   packet.bin       a packet (PacketWriter, writeEvent, writeUiRecord): Rust's PacketBuilder writes the same;
//   closure-log.bin  a closure log (writeClosureLog): Rust's ClosureLog::parse reads it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTION_SCHEMA_VERSION,
  type Action,
  actionBytes,
  closureActions,
  decodeAction,
  encodeClosure,
  preflight,
} from '../../src/shared/gen/actions.ts';
import { Reader, Writer } from '../../src/shared/gen/codec.ts';
import { ClosureLogFlags, parseClosureLog, writeClosureLog } from '../../src/shared/gen/container.ts';
import { EventFlags, EventType, readEvents, writeEvent } from '../../src/shared/gen/events.ts';
import {
  DynCodec,
  decodePacket,
  MoverCodec,
  PacketFlags,
  PacketSection,
  PacketWriter,
} from '../../src/shared/gen/packet.ts';
import {
  decodeProjection,
  HudCodec,
  HudFlags,
  ProjectionKind,
  readUiRecords,
  UiStatus,
} from '../../src/shared/gen/projections.ts';
import {
  AlertType,
  BuildMode,
  Direction,
  DynState,
  EntityRefTag,
  FlyingText,
  MoverKind,
} from '../../src/shared/gen/types.ts';
import { GAME } from '../helpers/paths.ts';

const DIR = join(GAME, 'test', 'fixtures', 'codec', 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

function golden(name: string, bytes: Uint8Array): Uint8Array {
  const path = join(DIR, name);
  if (UPDATE) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, bytes);
  }
  if (!existsSync(path))
    throw new Error(`${path} is missing: run UPDATE_GOLDEN=1 npx vitest run test/codec/golden.test.ts`);
  return new Uint8Array(readFileSync(path));
}

// ------------------------------------------------------------------------------------------ the closure

const P0: Action[] = [
  { type: 'start_walking', input_gen: 3, dir: Direction.east },
  {
    type: 'build',
    item: 2 << 3,
    pos: { x2: 5, y2: -7 },
    dir: Direction.south,
    flip: false,
    mode: BuildMode.normal,
    flags: 0,
    drag_id: 0,
  },
  { type: 'craft', recipe: 0, count: 2 },
];
const P3: Action[] = [
  { type: 'rotate_entity', target: { a: 12345, b: 0, tag: EntityRefTag.serial }, reverse: true },
];
const SYSTEM: Action[] = [{ type: 'player_joined', player: 3, flags: 0 }];

const closure = () =>
  encodeClosure([
    { player: 0, system: false, tick: 7, firstSeq: 5, actions: P0.map(actionBytes) },
    { player: 3, system: false, tick: 7, firstSeq: 1, actions: P3.map(actionBytes) },
    { player: 0xffff, system: true, tick: 7, firstSeq: 1, actions: SYSTEM.map(actionBytes) },
  ]);

// ------------------------------------------------------------------------------------------- the packet

const DYN = [
  {
    x2: 5,
    y2: -7,
    serial: 12345,
    proto: 0,
    phase: 0x4000,
    dir: Direction.south,
    state: DynState.working,
    light: 0,
    quality: 0,
  },
  {
    x2: -1,
    y2: 1,
    serial: 7,
    proto: 0,
    phase: 0,
    dir: Direction.north,
    state: DynState.idle,
    light: 255,
    quality: 1,
  },
];
const MOVER = {
  serial: 1,
  proto: 1,
  kind: MoverKind.character,
  flags: 0,
  x: -256,
  y: 512,
  vx: 38,
  vy: 0,
  base_tick: 7,
  orientation: 0x4000,
  aux: 0,
};
const HUD = {
  tick: 7,
  research_tech: 0xffff,
  research_level: 0,
  research_progress: 0,
  takeoff_level: 0,
  flags: HudFlags.closed,
  field: 1.5,
  literature: 1945,
  your_year: 1945.25,
  years_ahead: -0.5,
  activity_w: 0,
  doubling_time_s: 0,
  alerts: [{ alert: AlertType.entity_destroyed, count: 2 }],
};

function packet(): Uint8Array {
  const w = new Writer();
  const p = new PacketWriter(w, 5, 7, PacketFlags.full, 0x8000);
  p.section(PacketSection.dyn);
  for (const d of DYN) DynCodec.write(w, d);
  p.end(DYN.length);
  p.section(PacketSection.movers);
  MoverCodec.write(w, MOVER);
  p.end(1);
  p.section(PacketSection.events);
  writeEvent(
    w,
    { tick: 7, seq: 6, player: 0, flags: 0, surface: 0 },
    {
      type: 'entity_built',
      serial: 12345,
      proto: 0,
      dir: Direction.south,
      flags: 0,
      pos: { x2: 5, y2: -7 },
    },
  );
  writeEvent(
    w,
    { tick: 7, seq: 7, player: 0, flags: EventFlags.historical, surface: 0 },
    {
      type: 'flying_text',
      text: FlyingText.item_delta,
      item: 2 << 3,
      count: -8,
      total: 0,
      pos: { x: 1280, y: -1792 },
    },
  );
  p.end(2);
  p.section(PacketSection.ui);
  const hud = HudCodec.encode(HUD);
  writeUiRecord(w, 0, ProjectionKind.hud, UiStatus.ok, 1, hud);
  p.end(1);
  p.section(PacketSection.audio_working);
  p.end(0);
  p.finish();
  return w.finish();
}

function writeUiRecord(
  w: Writer,
  sub: number,
  kind: number,
  status: number,
  version: number,
  body: Uint8Array,
) {
  const start = w.pos;
  w.u32(sub, 'UiRecord.sub_id');
  w.u16(kind, 'UiRecord.kind');
  w.u16(status, 'UiRecord.status');
  w.u32(version, 'UiRecord.version');
  w.u32(body.length, 'UiRecord.len');
  w.bytes(body);
  w.pad(start, 4);
}

// ------------------------------------------------------------------------------------------- the closure log

/** Tick 9's closure: player 0 stops walking (seq 8). */
const LATER = () =>
  encodeClosure([
    {
      player: 0,
      system: false,
      tick: 9,
      firstSeq: 8,
      actions: [actionBytes({ type: 'stop_walking', input_gen: 4 })],
    },
  ]);

function closureLog(): Uint8Array {
  const c = closure();
  return writeClosureLog({
    header: {
      action_schema_version: ACTION_SCHEMA_VERSION,
      flags: ClosureLogFlags.has_digests,
      start_tick: 6,
      end_tick: 9,
      build_hash: { bytes: new Uint8Array(32).fill(0xab) },
      prototypes_hash: { bytes: new Uint8Array(32).fill(0xcd) },
      start_state_hash: 0x1122334455667788n,
      digest_first_tick: 7,
    },
    records: [
      { tick: 7, closure: c },
      { tick: 9, closure: LATER() },
    ],
    digests: [0x0123456789abcdefn, 0xfedcba9876543210n],
    blobs: [],
  });
}

describe('golden composite fixtures', () => {
  it('closure.bin: the closure of tick 7', () => {
    const bytes = closure();
    expect(golden('closure.bin', bytes)).toEqual(bytes);
    expect(preflight(bytes, 7, [4, 0, 0, 0], 0, () => false)).toEqual({ batches: 3, actions: 5 });
    const acts = closureActions(bytes);
    expect(acts.map((a) => [a.player, a.seq, a.system])).toEqual([
      [0, 5, false],
      [0, 6, false],
      [0, 7, false],
      [3, 1, false],
      [0xffff, 1, true],
    ]);
    expect(acts.map((a) => decodeAction(a.type, a.payload))).toEqual([...P0, ...P3, ...SYSTEM]);
  });

  it('packet.bin: a packet of five sections', () => {
    const bytes = packet();
    expect(golden('packet.bin', bytes)).toEqual(bytes);
    const p = decodePacket(bytes);
    expect(p.header).toMatchObject({ tick: 7, flags: PacketFlags.full, daylight: 0x8000, section_count: 5 });
    expect(p.sections.map((s) => [s.name, s.count])).toEqual([
      ['DYN', 2],
      ['MOVERS', 1],
      ['EVENTS', 2],
      ['UI', 1],
      ['AUDIO_WORKING', 0],
    ]);
    const [dyn, movers, events, ui] = p.sections as [
      (typeof p.sections)[0],
      (typeof p.sections)[0],
      (typeof p.sections)[0],
      (typeof p.sections)[0],
    ];
    const r = new Reader(dyn.bytes);
    expect([DynCodec.read(r), DynCodec.read(r)]).toEqual(DYN);
    expect(MoverCodec.read(new Reader(movers.bytes))).toEqual(MOVER);
    const ev = readEvents(events.bytes, events.count);
    expect(ev.map((e) => [e.header.type, e.payload.type])).toEqual([
      [EventType.entity_built, 'entity_built'],
      [EventType.flying_text, 'flying_text'],
    ]);
    const [rec] = readUiRecords(ui.bytes, ui.count);
    expect(rec?.kind).toBe(ProjectionKind.hud);
    expect(decodeProjection(ProjectionKind.hud, rec?.body as Uint8Array)).toEqual({ kind: 'HUD', ...HUD });
  });

  it('closure-log.bin: two records, two digests', () => {
    const bytes = closureLog();
    expect(golden('closure-log.bin', bytes)).toEqual(bytes);
    const log = parseClosureLog(bytes);
    expect(log.records.map((r) => [r.tick, r.closure])).toEqual([
      [7, closure()],
      [9, LATER()],
    ]);
    expect(log.digests).toEqual([0x0123456789abcdefn, 0xfedcba9876543210n]);
    expect(log.header).toMatchObject({ start_tick: 6, end_tick: 9, digest_first_tick: 7, record_count: 2 });
  });
});
