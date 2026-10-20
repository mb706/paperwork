// The registry of era rule sets (A4 `pieces/index.js`). M0 and M1 ship Eras I and II (A4 §10); Era III (M2),
// IV and IV′ (M3) and the takeoff (M4) register here when they exist.
import type { PieceSpec } from '../types.ts';
import { ERA1 } from './era1.ts';
import { ERA2 } from './era2.ts';

export const PIECES: Readonly<Record<string, PieceSpec>> = { era1: ERA1, era2: ERA2 };

/** The sample packs a piece needs (each sampler instrument's pack, once). */
export function packsOf(spec: PieceSpec): string[] {
  const out: string[] = [];
  for (const i of spec.layout.instruments)
    if (i.source.kind === 'sampler' && !out.includes(i.source.pack)) out.push(i.source.pack);
  return out;
}
