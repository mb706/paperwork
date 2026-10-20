// The admission function (10 §15.3 "Admission", B1-r1 10): which tick an action joins. Every sequencer uses
// it: the LocalSequencer (src/simworker/sequencer.ts) and, in multiplayer, the relay's RoomCore; the native
// TestSequencer mirrors it, pinned by the shared fixture test/fixtures/admission/cases.txt. It reads only each
// action's player, seq, payload length and blob count, so the relay never parses payloads.
//
// Each tick keeps two running sizes:
// - its closure size: 16 bytes per batch plus 4 + payload bytes per action (§15.3's batch and action frames);
// - its wire size: 17 + 32 × blobCount + payload bytes per action (a TICKS entry, 11 §3.2).
// A player's action fits a tick if both stay within CLOSURE_MAX − SYSTEM_RESERVE, a system action if both stay
// within CLOSURE_MAX. An action that does not fit goes to the first later tick where it does, and the tick it
// did not fit is then closed to player actions, so every later action goes later too and each player's order
// is kept.
//
// A batch starts whenever the acting player changes (the system "player" included) and, a refinement the
// closure format implies, wherever a player's seqs are not consecutive: a batch's i-th action has seq
// first_seq + i, so a gap (an action the sequencer dropped) needs a new batch header, and the closure size must
// count it.
import { CLOSURE_MAX, SYSTEM_PLAYER, SYSTEM_RESERVE } from './gen/actions.ts';

export const BATCH_HEADER_BYTES = 16;
export const ACTION_HEADER_BYTES = 4;
/** A TICKS entry's bytes besides its payload and blob hashes: u32 tick, u16 player, u32 seq, u8 blobCount, u16 len, and the action's own u16 type, u16 len. */
export const WIRE_ENTRY_BYTES = 17;
export const BLOB_HASH_BYTES = 32;

/** One tick's running sizes (allocation-free: sequencers keep these in place and reset them). */
export interface TickRoom {
  closureBytes: number;
  wireBytes: number;
  /** The last admitted action's player (SYSTEM_PLAYER for system actions; -1 for none) and seq. */
  lastPlayer: number;
  lastSeq: number;
  /** A player's action did not fit: the tick takes no more player actions. */
  closed: boolean;
}

export function emptyRoom(): TickRoom {
  return { closureBytes: 0, wireBytes: 0, lastPlayer: -1, lastSeq: 0, closed: false };
}

export function resetRoom(room: TickRoom): void {
  room.closureBytes = 0;
  room.wireBytes = 0;
  room.lastPlayer = -1;
  room.lastSeq = 0;
  room.closed = false;
}

/** Whether an action starts a new batch after the room's last action. */
export function startsBatch(room: TickRoom, player: number, seq: number): boolean {
  return room.lastPlayer !== player || (room.lastSeq + 1) >>> 0 !== seq;
}

/** The bytes an action adds to a tick's closure: its frame, and a batch header if it starts a batch. */
export function closureCost(room: TickRoom, player: number, seq: number, payloadBytes: number): number {
  return (startsBatch(room, player, seq) ? BATCH_HEADER_BYTES : 0) + ACTION_HEADER_BYTES + payloadBytes;
}

/** The bytes an action adds to a tick's TICKS entries (11 §3.2). */
export function wireCost(payloadBytes: number, blobCount: number): number {
  return WIRE_ENTRY_BYTES + BLOB_HASH_BYTES * blobCount + payloadBytes;
}

/**
 * Admits an action to this tick if it fits, updating the room, and returns whether it did. A player's action
 * that does not fit closes the tick to player actions (§15.3). `player` is SYSTEM_PLAYER for system actions,
 * whose `seq` is the system seq.
 */
export function tryAdmit(
  room: TickRoom,
  player: number,
  seq: number,
  payloadBytes: number,
  blobCount: number,
): boolean {
  const system = player === SYSTEM_PLAYER;
  if (!system && room.closed) return false;
  const limit = system ? CLOSURE_MAX : CLOSURE_MAX - SYSTEM_RESERVE;
  const closure = room.closureBytes + closureCost(room, player, seq, payloadBytes);
  const wire = room.wireBytes + wireCost(payloadBytes, blobCount);
  if (closure > limit || wire > limit) {
    room.closed = true;
    return false;
  }
  room.closureBytes = closure;
  room.wireBytes = wire;
  room.lastPlayer = player;
  room.lastSeq = seq;
  return true;
}

/** An action as admission sees it. */
export interface AdmissionAction {
  player: number;
  seq: number;
  payloadBytes: number;
  blobCount: number;
}

/**
 * Assigns ticks to a sequence of actions in arrival order, each at the earliest tick from `open` (and, for a
 * player, from that player's previous assignment, 11 §3.4) that has room: the reference the fixture pins.
 */
export function assignTicks(actions: readonly AdmissionAction[], open: number): number[] {
  const rooms = new Map<number, TickRoom>();
  const lastAssigned = new Map<number, number>();
  return actions.map((a) => {
    let t = Math.max(open, lastAssigned.get(a.player) ?? open);
    for (;;) {
      let room = rooms.get(t);
      if (!room) {
        room = emptyRoom();
        rooms.set(t, room);
      }
      if (tryAdmit(room, a.player, a.seq, a.payloadBytes, a.blobCount)) break;
      t += 1;
    }
    lastAssigned.set(a.player, t);
    return t;
  });
}
