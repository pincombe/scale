// Pure juice tuning curves (no DOM): shake from damage, coin counts and landing schedule.
import type { Decimal } from '../../core/decimal';
import { D } from '../../core/decimal';

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

/** Hit-stop and the full kick land only on a crit that follows CRIT_STOP_GAP s without crits. */
export const CRIT_STOP_GAP = 0.6;
/** Crit heat: +1 per crit, cools this much per second, capped. */
export const CRIT_COOL = 3;
export const CRIT_HEAT_MAX = 3;

/** Shake multiplier for a crit at this heat: 1 when isolated, ~0.3 deep in a spree. */
export function critDamp(heat: number): number {
  const h = heat < 0 ? 0 : heat > CRIT_HEAT_MAX ? CRIT_HEAT_MAX : heat;
  return 1 / (1 + 0.8 * h);
}

/** Heat after a crit lands (capped). */
export function heatAfterCrit(heat: number): number {
  return Math.min(CRIT_HEAT_MAX, heat + 1);
}

export interface CoinShares {
  /** Coins to launch (never more than whole units of gold, at least 1). */
  count: number;
  /** Value of every coin but the last (floored). */
  each: Decimal;
  /** Value of the last coin (the remainder), so the shares sum exactly to the total. */
  last: Decimal;
}

/** Split a reward into up to `want` coins with exact Decimal shares. */
export function coinShares(total: Decimal, want: number): CoinShares {
  let n = Math.max(1, Math.floor(want));
  if (total.lt(n)) n = Math.max(1, Math.floor(total.toNumber()));
  if (n === 1) return { count: 1, each: total, last: total };
  const each = total.div(n).floor();
  return { count: n, each, last: total.sub(each.mul(n - 1)) };
}

/** Sum of the shares (for tests and debug). */
export function sharesTotal(s: CoinShares): Decimal {
  return s.each.mul(s.count - 1).add(s.last).add(D(0));
}
