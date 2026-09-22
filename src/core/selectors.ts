// Read-only views of the state for the HUD and panels (and the sim). Pure and cheap: a handful of
// Decimal ops each, fine for 10 Hz UI refreshes (not for per-frame render loops).
import { D } from './decimal';
import type { Decimal } from './decimal';
import { BALANCE, UNITS, UNIT_IDS, UPGRADES, sizeWord, upgradeDefOf } from './content';
import type { Requirement, UpgradeDef } from './content';
import {
  armyDps,
  clickDamage,
  dyingDuration,
  enterDuration,
  hasUpgrade,
  killGold,
  maxAffordable,
  milestoneAt,
  milestoneCount,
  milestoneMult,
  staggerGold,
  unitCost,
  unitDamage,
  unitDps,
  unitPeriod,
  upgradeCost,
} from './formulas';
import { requirementValue } from './progress';
import type { GameState, UnitId } from './types';

export { armyDps, clickDamage, maxAffordable, milestoneMult, unitCost, unitDamage, unitDps, unitPeriod, upgradeCost };

// ---- Units ----

/** The unit has been revealed (its row/button may show). */
export function unitVisible(s: GameState, unit: UnitId): boolean {
  return !!s.flags[UNITS[unit].unlockFlag];
}

/** Revealed and the gold covers `amount` of it (BUY_MAX / -1: at least one). */
export function unitAffordable(s: GameState, unit: UnitId, amount = 1): boolean {
  if (!unitVisible(s, unit)) return false;
  return s.gold.gte(unitCost(s, unit, amount < 1 ? 1 : amount));
}

export interface MilestoneInfo {
  /** Owned count that triggers it. */
  at: number;
  /** Damage multiplier it adds (×2). */
  mult: number;
  /** Units still to hire. */
  remaining: number;
  /** Progress from the previous milestone (or 0) to this one, 0..1. */
  frac: number;
}

/** The next damage-doubling threshold for this unit (there always is one). */
export function nextMilestone(s: GameState, unit: UnitId): MilestoneInfo {
  const owned = s.units[unit];
  const k = milestoneCount(owned);
  const at = milestoneAt(k);
  const prev = k > 0 ? milestoneAt(k - 1) : 0;
  return { at, mult: BALANCE.milestones.mult, remaining: at - owned, frac: (owned - prev) / (at - prev) };
}

// ---- Upgrades ----

export function upgradeOwned(s: GameState, id: string): boolean {
  return hasUpgrade(s, id);
}

/** Revealed and not yet bought (show it in the Upgrades list). */
export function upgradeVisible(s: GameState, id: string): boolean {
  const u = upgradeDefOf(id);
  return !!u && !!s.flags[u.unlockFlag] && !hasUpgrade(s, id);
}

/** Visible and the gold covers it. */
export function upgradeAffordable(s: GameState, id: string): boolean {
  const cost = upgradeCost(id);
  return cost !== null && upgradeVisible(s, id) && s.gold.gte(cost);
}

/** Upgrades to list right now, cheapest first (allocates; fine at 10 Hz). */
export function visibleUpgrades(s: GameState): UpgradeDef[] {
  return UPGRADES.filter((u) => upgradeVisible(s, u.id)).sort((a, b) => a.cost - b.cost);
}

/** Progress toward a requirement (e.g. an upgrade's unlock hint), 0..1. */
export function requirementProgress(s: GameState, r: Requirement): number {
  return Math.min(1, requirementValue(s, r) / r.at);
}

/** Anything the player could buy right now (units or upgrades). */
export function anythingAffordable(s: GameState): boolean {
  for (const id of UNIT_IDS) if (unitAffordable(s, id)) return true;
  for (const u of UPGRADES) if (upgradeAffordable(s, u.id)) return true;
  return false;
}

// ---- Damage and income ----

/** Average click DPS for a player clicking `clicksPerSec` with `weakRate` of clicks on the weak spot. */
export function clickDps(s: GameState, clicksPerSec: number, weakRate = 0): Decimal {
  if (clicksPerSec <= 0) return D(0);
  const plain = clickDamage(s, false).mul(clicksPerSec * (1 - weakRate));
  return weakRate > 0 ? plain.add(clickDamage(s, true).mul(clicksPerSec * weakRate)) : plain;
}

/**
 * Estimated gold per second from kills at the current dragon, for an army alone (default) or with
 * a clicking player. Counts the death + entrance downtime between dragons. Ignores stagger bonuses.
 */
export function goldPerSec(s: GameState, clicksPerSec = 0, weakRate = 0): Decimal {
  const dps = armyDps(s).add(clickDps(s, clicksPerSec, weakRate));
  if (dps.lte(0)) return D(0);
  const killTime = s.dragon.maxHp.div(dps).toNumber() + dyingDuration(s.dragon.size) + enterDuration(s.dragon.size);
  return killGold(s).div(killTime);
}

// ---- Dragon ----

export interface DragonInfo {
  name: string;
  epithet: string;
  /** nth dragon of the tier (0-based). */
  index: number;
  /** Body length in meters and its comparison ("dog-sized"). */
  size: number;
  sizeWord: string;
  hp: Decimal;
  maxHp: Decimal;
  /** Remaining HP, 0..1. */
  hpFrac: number;
  /** Gold for killing it / for staggering it. */
  reward: Decimal;
  staggerReward: Decimal;
  /** Dragons slain in this tier. */
  kills: number;
}

export function dragonInfo(s: GameState): DragonInfo {
  const d = s.dragon;
  const frac = d.maxHp.gt(0) ? d.hp.div(d.maxHp).toNumber() : 0;
  return {
    name: d.name,
    epithet: d.epithet,
    index: d.index,
    size: d.size,
    sizeWord: sizeWord(d.size),
    hp: d.hp,
    maxHp: d.maxHp,
    hpFrac: Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)),
    reward: killGold(s),
    staggerReward: staggerGold(s),
    kills: s.kills,
  };
}
