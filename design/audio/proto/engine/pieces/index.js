// Registry of era rule sets: which sample packs each needs, how it routes, and the piece class.
import { ERA1_SAMPLERS, Era1Piece, setupEra1 } from './era1.js';
import { ERA2_SAMPLERS, Era2Piece, setupEra2 } from './era2.js';
import { TAKEOFF_SAMPLERS, TakeoffPiece, setupTakeoff } from './takeoff.js';

export const PIECES = {
  era1: { samplers: ERA1_SAMPLERS, setup: setupEra1, Piece: Era1Piece },
  era2: { samplers: ERA2_SAMPLERS, setup: setupEra2, Piece: Era2Piece },
  takeoff: { samplers: TAKEOFF_SAMPLERS, setup: setupTakeoff, Piece: TakeoffPiece },
};
