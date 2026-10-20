// The audio module's inputs from the simulation (10 §15.4–§15.6), as a small adapter interface.
//
// SEAM (C7 → C1b): the generated packet, event and projection decoders of `src/shared/gen/` (the schema
// package) did not exist when this was written. The audio layer reads packets only through these
// interfaces; `standin.ts` implements them over the raw bytes of §15.4/§15.6 for tests and the dev page.
// At merge time the app wires the generated decoders behind the same interfaces (a few lines), and the
// stand-in's ids for event types and fail reasons give way to the schema's enums.

/** Event type ids (10 §15.6; append-only). */
export const EVENT = {
  action_failed: 1,
  flying_text: 2,
  entity_built: 3,
  entity_mined: 4,
  entity_rotated: 5,
  item_crafted: 6,
  research_completed: 7,
  milestone: 8,
  alert_raised: 9,
  player_joined: 10,
  player_left: 11,
  input_fenced: 12,
  loop_closed: 13,
  victory: 14,
} as const;
export type EventName = keyof typeof EVENT;
export const EVENT_NAME: Readonly<Record<number, EventName>> = Object.fromEntries(
  Object.entries(EVENT).map(([k, v]) => [v, k as EventName]),
);

/** The fields audio reads from one event record; written into a reused object (no allocation). */
export interface AudioEventRecord {
  type: number;
  tick: number;
  /** 0xFFFF: none. */
  player: number;
  /** Bit 0: HISTORICAL (catch-up, replay, fast-forward; 10 §15.6). */
  flags: number;
  /** entity_built, entity_mined, entity_rotated: the prototype id; −1 otherwise. */
  proto: number;
  /** entity_built: bit 0 ghost. */
  entityFlags: number;
  /** action_failed: the FailReason; alert_raised: the AlertType; −1 otherwise. */
  reason: number;
  /** World position in tiles (FinePos ÷ 256, TilePos2 ÷ 2); NaN when the event has none. */
  x: number;
  y: number;
}

export const newEventRecord = (): AudioEventRecord => ({
  type: 0,
  tick: 0,
  player: 0xffff,
  flags: 0,
  proto: -1,
  entityFlags: 0,
  reason: -1,
  x: Number.NaN,
  y: Number.NaN,
});

/** One AUDIO_WORKING record (16 bytes: u16 sound, u16 n, f32 cx, f32 cy, f32 wsum). */
export interface WorkingRecord {
  sound: number;
  n: number;
  /** Centroid relative to the view centre, in tiles. */
  cx: number;
  cy: number;
  wsum: number;
}

export const newWorkingRecord = (): WorkingRecord => ({ sound: 0, n: 0, cx: 0, cy: 0, wsum: 0 });

/** What audio needs from one decoded render packet. */
export interface AudioPacketView {
  /** The packet's state generation (10 §3.4): a new one resets all audio state. */
  readonly generation: number;
  /** The tick after which it was extracted. */
  readonly tick: number;
  readonly eventCount: number;
  readEvent(i: number, out: AudioEventRecord): void;
  /** The AUDIO_WORKING section is a snapshot; absent means "none" (10 §15.4). */
  readonly workingCount: number;
  readWorking(i: number, out: WorkingRecord): void;
}

/** The music feed from the HUD projection (10 §15.5–§15.6), read once a second. */
export interface MusicFeed {
  literatureYear: number;
  /** Electric consumption, the mean over 60 s, in W (the audio module normalises it). */
  consumptionW: number;
  /** The takeoff's doubling time in s, or 0 (M4). */
  doublingTime: number;
  closed: boolean;
  victory: boolean;
}

/** Prototype facts the event map needs (from prototypes.json, 10 §15.2). */
export interface ProtoInfo {
  /** The larger side of an entity's footprint, in tiles. */
  entitySize(proto: number): number;
  /** What `entity_mined`'s proto names. */
  minedKind(proto: number): 'entity' | 'resource';
  /** FailReasons with no player-facing string (`malformed`, `unsupported`): they play nothing. */
  isDeveloperReason(reason: number): boolean;
}
