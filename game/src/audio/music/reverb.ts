// The era rooms (A4 §3 "Rooms change with the era"; 10 §9.4): FDN presets with their output gains.
//
// FDN_GAIN makes each preset's wet energy equal to A4's ConvolverNode (normalize: true) with its generated
// IR at 48 kHz, which the approved demos used. Measured by `worklet/fdn-core.test.ts` (it recomputes A4's
// IRs and Chrome's normalisation, and checks these constants at 32 and 48 kHz within 0.4 dB).
import { FDN_PRESETS } from '../worklet/fdn-core.ts';
import type { FdnConfig } from '../worklet/protocol.ts';
import type { ReverbPreset } from './types.ts';

export const FDN_GAIN: Readonly<Record<string, number>> = {
  // the geometric mean of the gains measured at 32 and 48 kHz (they differ by 0.2–0.5 dB)
  hall: 0.5611,
  plate: 0.2899,
  digital: 0.523,
  vast: 0.6155,
};

export function fdnConfig(preset: ReverbPreset): FdnConfig {
  const p = FDN_PRESETS[preset] as Omit<FdnConfig, 'gain'>;
  return { t60: [...p.t60], predelay: p.predelay, size: p.size, gain: FDN_GAIN[preset] ?? 1 };
}
