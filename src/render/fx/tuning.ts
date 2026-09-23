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

// Time effects (wall seconds). They cost logic time (ARCHITECTURE §2), so the balance sim
// (src/sim/juice.ts) imports these same constants to model the dilation.
/** Hit-stop on a weak-spot crit (only after CRIT_STOP_GAP s without crits). */
export const CRIT_HIT_STOP = 0.07;
/** Hit-stop on a crit that staggers. */
export const STAGGER_HIT_STOP = 0.08;
/** Hit-stop on a kill. */
export const KILL_HIT_STOP = 0.08;
/** Kill slow-mo: starts at this time scale and eases back to 1 over KILL_SLOW_MO_DUR. */
export const KILL_SLOW_MO = 0.25;
export const KILL_SLOW_MO_DUR = 0.55;
/**
 * The boss's fall (on `bossDefeated`, the same drain as its `dragonDeath`): the kill's freeze (the
 * ARCHITECTURE §2 cap of 80 ms) and a much slower, ~3x longer slow-mo. The boss is dead by then, so
 * this never eats its timer; it only stretches the collapse (and delays the first zoom by ~1 s of
 * wall time). The boss's arrival, engage and urgency add NO time effects: slow-mo during the fight
 * would eat the timer.
 */
export const BOSS_HIT_STOP = 0.08;
export const BOSS_SLOW_MO = 0.12;
export const BOSS_SLOW_MO_DUR = 1.8;
/**
 * The Wyrm Gauge's tremor after an ordinary kill (fx/boss.ts; SFX matches them): it rolls in
 * TREMOR_DELAY wall s after the kill (the kill's own juice lands first), with strength
 * gauge^TREMOR_EXP (0.02 at 10%, 0.29 at 50%, 0.83 at 90%, 1 when the boss is next). Visual and
 * audio only: no time effect.
 */
export const TREMOR_DELAY = 0.45;
export const TREMOR_EXP = 1.8;
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

/**
 * Visual magnitude of a kill (0..1) from the corpse's on-screen width and the reward: a newt's
 * death is a crisp pop (~0), a barn-sized dragon filling the frame gets the full bloom (1). Drives
 * bloom size, ember/smoke counts, flash alpha, kick and shake (NOT hit-stop/slow-mo: those are
 * constant and mirrored by the sim).
 */
export function killScale(screenPx: number, gold: Decimal): number {
  const size = (screenPx - 60) / 500;
  const g = gold.toNumber();
  const reward = Math.min(0.15, 0.03 * (Number.isFinite(g) ? Math.log10(1 + Math.max(0, g)) : 308));
  const m = (size < 0 ? 0 : size) + reward;
  return m > 1 ? 1 : m;
}
