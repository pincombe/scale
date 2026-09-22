// Placeholder economy formulas (WP 0.2). WP 1.5 rewrites the numbers; keep these signatures.
import { Decimal, D } from './decimal';
import { MILESTONES, UNITS, UPGRADES } from './content';
import type { GameState, UnitId } from './types';

/** Fixed logic step in seconds. tick() is always called with this dt. */
export const TICK_DT = 1 / 20;

export function dragonMaxHp(tier: number, index: number): Decimal {
  return D(10).mul(Decimal.pow(1.45, index)).mul(Decimal.pow(1000, tier)).ceil();
}

/** Body length in meters: newt ~0.5 m, dog ~1 m, horse ~2.5 m, barn ~10 m by index ~15. */
export function dragonSize(_tier: number, index: number): number {
  return 0.5 * Math.pow(1.22, index);
}

export function dragonGold(tier: number, index: number): Decimal {
  return dragonMaxHp(tier, index).mul(0.8).ceil();
}

function upgradeMult(state: GameState, target: 'strike' | UnitId): number {
  let m = 1;
  for (const u of UPGRADES) if (u.target === target && (state.upgrades[u.id] ?? 0) > 0) m *= u.mult;
  return m;
}

/** 2 to the number of milestones reached. */
export function milestoneMult(owned: number): number {
  let m = 1;
  for (const t of MILESTONES) if (owned >= t) m *= 2;
  return m;
}

/** Base damage of one click (before the weak-spot multiplier). */
export function strikeDamage(state: GameState): Decimal {
  return D(upgradeMult(state, 'strike'));
}

/** Damage one unit of this type deals per beat/volley. */
export function unitDamage(state: GameState, unit: UnitId): Decimal {
  const def = UNITS[unit];
  return D(def.damage * upgradeMult(state, unit) * milestoneMult(state.units[unit]));
}

/** Total gold to buy `amount` more of a unit. */
export function unitCost(state: GameState, unit: UnitId, amount = 1): Decimal {
  const def = UNITS[unit];
  return Decimal.sumGeometricSeries(amount, def.baseCost, def.costGrowth, state.units[unit]).ceil();
}

export function upgradeCost(id: string): Decimal | null {
  for (const u of UPGRADES) if (u.id === id) return D(u.cost);
  return null;
}
