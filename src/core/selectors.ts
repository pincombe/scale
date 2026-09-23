// Read-only views of the state for the HUD and panels (and the sim). Pure and cheap: a handful of
// Decimal ops each, fine for 10 Hz UI refreshes (not for per-frame render loops).
import { D } from './decimal';
import type { Decimal } from './decimal';
import { ABILITIES, BALANCE, CHAMPION_IDS, CHARGE_IDS, TIER_TEXT, UNITS, UNIT_IDS, UPGRADES, heightWord, lastTier, sizeWord, tierOf, upgradeDefOf } from './content';
import type { Requirement, UpgradeDef } from './content';
import { abilityReady as coreAbilityReady } from './abilities';
import { bossClockRuns } from './dragon';
import {
  abilityCooldown,
  armyDps,
  bossAt,
  canZoom,
  championCost,
  championDps,
  championBlowShare,
  championHit,
  championLevelsLeft,
  championMaxAffordable,
  championSpecialDamage,
  championSpecialShare,
  championsDps,
  displayMeters,
  fusionForZoom,
  heightForZoom,
  heraldryCost,
  pushKills,
  scalesForZoom,
  unitsFused,
  clickDamage,
  dragonDyingDuration,
  dragonEnterDuration,
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
import type { AbilityId, ChampionId, ChargeId, GameState, UnitId } from './types';

export {
  abilityCooldown,
  armyDps,
  bossAt,
  canZoom,
  championCost,
  championDps,
  championBlowShare,
  championHit,
  championLevelsLeft,
  championMaxAffordable,
  championSpecialDamage,
  championSpecialShare,
  championsDps,
  clickDamage,
  displayMeters,
  fusionForZoom,
  heightForZoom,
  heraldryCost,
  maxAffordable,
  milestoneMult,
  pushKills,
  scalesForZoom,
  unitCost,
  unitDamage,
  unitDps,
  unitPeriod,
  unitsFused,
  upgradeCost,
};

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

/** Anything the player could buy right now (units, upgrades, champion levels, heraldry). */
export function anythingAffordable(s: GameState): boolean {
  for (const id of UNIT_IDS) if (unitAffordable(s, id)) return true;
  for (const u of UPGRADES) if (upgradeAffordable(s, u.id)) return true;
  for (const id of CHAMPION_IDS) if (championAffordable(s, id)) return true;
  for (const id of CHARGE_IDS) if (heraldryAffordable(s, id)) return true;
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
  const dps = armyDps(s).add(championsDps(s)).add(clickDps(s, clicksPerSec, weakRate));
  if (dps.lte(0)) return D(0);
  const killTime = s.dragon.maxHp.div(dps).toNumber() + dragonDyingDuration(s.dragon) + dragonEnterDuration(s.dragon);
  return killGold(s).div(killTime);
}

// ---- Dragon ----

export interface DragonInfo {
  name: string;
  epithet: string;
  /** nth dragon of the tier (0-based). */
  index: number;
  /** Body length in world meters (tier-local; what render draws). */
  size: number;
  /** Body length in display meters (size at the tier's scale: a Mountain wyvern is ~200 m) and its comparison. */
  displaySize: number;
  sizeWord: string;
  /** The boss's id while the tier's boss fights, else null. */
  boss: string | null;
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
  const displaySize = displayMeters(s, d.size);
  return {
    name: d.name,
    epithet: d.epithet,
    index: d.index,
    size: d.size,
    displaySize,
    sizeWord: sizeWord(displaySize),
    boss: d.boss,
    hp: d.hp,
    maxHp: d.maxHp,
    hpFrac: Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0)),
    reward: killGold(s),
    staggerReward: staggerGold(s),
    kills: s.kills,
  };
}

// ---- M2: the Wyrm Gauge, the boss, the zoom ----

/** The Wyrm Gauge, 0..1 (1 once the tier's boss is beaten). */
export function gauge(s: GameState): number {
  if (s.wyrm.cleared) return 1;
  return Math.max(0, Math.min(1, s.wyrm.charge / bossAt(s.tier)));
}

/** Seconds left before the boss escapes (0 when no boss is fighting). */
export function bossTimeLeft(s: GameState): number {
  return s.dragon.boss && s.dragon.phase !== 'dying' && s.dragon.phase !== 'leave' ? s.wyrm.bossT : 0;
}

/** The boss's timer is running right now (it can be hit, and nothing holds). */
export function bossClockRunning(s: GameState): boolean {
  return !!s.dragon.boss && s.zoom.stage === null && bossClockRuns(s.dragon.phase) && s.wyrm.bossT > 0;
}

/** This is the last tier of the build: after its boss, the Zoom button says the next tier comes later. */
export function isLastTier(s: GameState): boolean {
  return s.tier >= lastTier();
}

export interface TierInfo {
  tier: number;
  /** "The Meadow", "The Mountain". */
  name: string;
  /** The title card's numeral: "I", "II". */
  numeral: string;
  /** Knight height, display m (the headline number). */
  height: number;
  /** "taller than the cathedral they swore to protect". */
  heightWord: string;
}

export function tierInfo(s: GameState): TierInfo {
  const text = TIER_TEXT[Math.min(s.tier, TIER_TEXT.length - 1)]!;
  return { tier: s.tier, name: text.name, numeral: text.numeral, height: s.height, heightWord: heightWord(s.height) };
}

/** The tier's boss id ('elderNewt', 'grimmaw'). */
export function tierBoss(s: GameState): string {
  return tierOf(s.tier).boss;
}

// ---- Heraldry ----

/** The Heraldry tab is open (after the first zoom). */
export function heraldryVisible(s: GameState, _id?: ChargeId): boolean {
  return !!s.flags['feature.heraldry'];
}

/** Visible and the Scales cover the next level. */
export function heraldryAffordable(s: GameState, id: ChargeId): boolean {
  return heraldryVisible(s, id) && s.scales.gte(heraldryCost(s, id));
}

/** A charge's level (0 = not on the shield). */
export function heraldryLevel(s: GameState, id: ChargeId): number {
  return s.heraldry.levels[id] ?? 0;
}

// ---- Abilities ----

/** The ability has been unlocked (its button shows). */
export function abilityVisible(s: GameState, id: AbilityId): boolean {
  return !!s.flags[ABILITIES[id].unlockFlag];
}

/**
 * Unlocked, off cooldown and not in a zoom's hold; the Volley also needs a dragon it can land on
 * (hittable and arrived), so the UI greys it while the dragon dies, leaves or is still arriving.
 */
export function abilityReady(s: GameState, id: AbilityId): boolean {
  return coreAbilityReady(s, id);
}

/** Its effect is running (Charge!, Rally). */
export function abilityActive(s: GameState, id: AbilityId): boolean {
  return s.abilities[id].active > 0;
}

/** Share of the effect left, 1..0 (0 when not active). */
export function abilityActiveFrac(s: GameState, id: AbilityId): number {
  const dur = BALANCE.abilities[id].dur;
  return dur > 0 ? Math.max(0, Math.min(1, s.abilities[id].active / dur)) : 0;
}

/** Cooldown progress 0..1 (1 = ready). */
export function abilityFrac(s: GameState, id: AbilityId): number {
  const a = s.abilities[id];
  const cd = a.cooldown;
  if (cd <= 0) return 1;
  // The cooldown this use started with (buying Stag mid-cooldown doesn't stall the bar).
  const full = a.cooldownDur > 0 ? a.cooldownDur : abilityCooldown(s, id);
  return full > 0 ? Math.max(0, Math.min(1, 1 - cd / full)) : 1;
}

// ---- Champions ----

/** The champion has joined (its row shows). */
export function championVisible(s: GameState, id: ChampionId): boolean {
  return s.champions[id].level > 0;
}

/** Joined, not mastered, and the gold covers `amount` more levels (BUY_MAX / -1: at least one). */
export function championAffordable(s: GameState, id: ChampionId, amount = 1): boolean {
  const n = amount < 1 ? 1 : amount;
  return championVisible(s, id) && championLevelsLeft(s, id) >= n && s.gold.gte(championCost(s, id, n));
}

/** The champion reached maxLevel: its row shows "Mastered", no more levels to buy. */
export function championMastered(s: GameState, id: ChampionId): boolean {
  return championVisible(s, id) && championLevelsLeft(s, id) <= 0;
}

// ---- Reward preview for the Zoom button and the cinematic ----

export interface ZoomPreview {
  scales: Decimal;
  fusion: number;
  height: number;
  /** Units that would fuse. */
  units: number;
  /** Kills since the boss fell. */
  push: number;
}

export function zoomPreview(s: GameState): ZoomPreview {
  return { scales: scalesForZoom(s), fusion: fusionForZoom(s), height: heightForZoom(s), units: unitsFused(s), push: pushKills(s) };
}
