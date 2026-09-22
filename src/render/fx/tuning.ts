// Pure juice tuning curves (no DOM): shake from damage, coin counts and landing schedule.
import type { Decimal } from '../../core/decimal';

/** damage / maxHp clamped to [0, 1] (0 when maxHp is 0 or not finite). */
export function damageFrac(damage: Decimal, maxHp: Decimal): number {
  if (maxHp.lte(0)) return 0;
  const f = damage.div(maxHp).toNumber();
  if (!Number.isFinite(f)) return f > 0 ? 1 : 0;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export type HitKind = 'click' | 'crit' | 'army' | 'kill';

/**
 * Camera trauma for a hit that dealt `frac` of the dragon's max HP. Shake = trauma^2, so small
 * values stay subtle; rapid clicks accumulate trauma into a building rumble.
 */
export function hitTrauma(frac: number, kind: HitKind): number {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  switch (kind) {
    case 'army':
      return 0.03 + 0.3 * f;
    case 'click':
      return 0.13 + 0.3 * f;
    case 'crit':
      return 0.34 + 0.3 * f;
    case 'kill':
      return 0.6;
  }
}

/** Coins in a kill fountain: grows with the log of the reward, 8..40. */
export function coinCount(gold: Decimal): number {
  const g = gold.toNumber();
  const mag = Number.isFinite(g) ? Math.log10(Math.max(1, g)) : 308;
  return Math.max(8, Math.min(40, Math.round(8 + 4.5 * mag)));
}

/** Free-flight time before coin j of n starts homing: spread so arrivals form a run. */
export function coinDelay(j: number, n: number): number {
  const u = n > 1 ? j / (n - 1) : 0;
  return 0.16 + 0.44 * Math.pow(u, 0.85);
}
