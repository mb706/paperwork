// Activity, the music's factory busyness (10 §15.6; A4 §5.1 rule 5): a = clamp(0.5 + 0.25 · log₁₀(P ÷ P_era),
// 0, 1) from the HUD's electric consumption P (mean over 60 s), smoothed by an exponential average with a
// 120-s time constant. P_era is the era's typical consumption (data: sounds.yaml). Presentation only: it
// gates layers within a piece and never feeds back into the game.
import { clamp } from '../core/units.ts';
import { type Era, eraFor } from '../music/conductor.ts';

export const ACTIVITY_TAU = 120;

export function rawActivity(watts: number, typicalWatts: number): number {
  if (!(watts > 0) || !(typicalWatts > 0)) return 0;
  return clamp(0.5 + 0.25 * Math.log10(watts / typicalWatts), 0, 1);
}

export class Activity {
  value: number;
  private started = false;

  private readonly eras: readonly Era[];
  constructor(eras: readonly Era[], initial = 0.5) {
    this.eras = eras;
    this.value = initial;
  }

  /** Advances the average by `dt` seconds with the current feed; returns the smoothed activity. */
  update(dt: number, watts: number, literatureYear: number): number {
    const a = rawActivity(watts, eraFor(literatureYear, this.eras).typicalWatts);
    if (!this.started) {
      // the first reading of a game sets the level directly (a load must not ramp up for minutes)
      this.value = a;
      this.started = true;
      return a;
    }
    const k = 1 - Math.exp(-Math.max(0, dt) / ACTIVITY_TAU);
    this.value += (a - this.value) * k;
    return this.value;
  }

  reset(initial = 0.5): void {
    this.value = initial;
    this.started = false;
  }
}
