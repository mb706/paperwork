// The era rooms (A4 §3 "Rooms change with the era"; 10 §9.4): FDN presets with their output gains.
//
// FDN_GAIN gives each preset the level per Hz of A4's ConvolverNode (normalize: true) with its generated IR
// at 48 kHz, which the approved demos used, averaged over the music band (125 Hz – 4 kHz octaves). It does
// not depend on the sample rate. Measured, and checked within 0.25 dB, by `worklet/fdn-core.test.ts`.
import { FDN_PRESETS } from '../worklet/fdn-core.ts';
import type { FdnConfig } from '../worklet/protocol.ts';
import type { ReverbPreset } from './types.ts';

export const FDN_GAIN: Readonly<Record<string, number>> = {
  hall: 0.5302,
  plate: 0.3279,
  digital: 0.5173,
  vast: 0.5603,
};

export function fdnConfig(preset: ReverbPreset): FdnConfig {
  const p = FDN_PRESETS[preset] as Omit<FdnConfig, 'gain'>;
  return { t60: [...p.t60], predelay: p.predelay, size: p.size, gain: FDN_GAIN[preset] ?? 1 };
}
