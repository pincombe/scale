// Economy formulas. Every number comes from content/balance.ts (BALANCE); this file is the math.
// Pure functions of (state, content). Economy values are Decimals; multipliers and counts are numbers.
import { Decimal, D } from './decimal';
import { BALANCE, UNITS, UPGRADES, upgradeDefOf } from './content';
import type { GameState, UnitId } from './types';

/** Fixed logic step in seconds. tick() is always called with this dt. */
export const TICK_DT = 1 / 20;

const LN10 = Math.LN10;

/**
 * Below this, economy values are computed as exact double integers and converted to Decimal once,
 * so costs and rewards are canonical whole numbers (D(n) for an integer n). Above it, float noise is
 * far below the 3 significant digits fmt() shows, and nothing needs exact equality.
 * Note: break_infinity can't round-trip every integer through toNumber() (D(851860).toNumber() is
 * 851859.9999999999, a library limit), so display with fmt() and read counts with wholeNumber().
 */
const EXACT_BELOW = 1e15;

/** n rounded up to an integer, treating float noise just above an integer as that integer. */
function ceilClean(n: number): number {
  const r = Math.round(n);
  return Math.abs(n - r) <= 1e-12 * Math.max(1, Math.abs(n)) ? r : Math.ceil(n);
}

/** A whole-number Decimal: x rounded up (ignoring float noise). */
export function wholeCeil(x: Decimal): Decimal {
  return x.gte(EXACT_BELOW) ? x : D(ceilClean(x.toNumber()));
}

/** A Decimal read as the nearest whole number (Infinity when beyond doubles). */
export function wholeNumber(x: Decimal): number {
  return Math.round(x.toNumber());
}

/** 10^log10 as a whole-number Decimal (at least 1). */
function fromLog10(log10: number): Decimal {
  if (log10 < 15) return D(Math.max(1, Math.round(Math.pow(10, log10))));
  return Decimal.pow(10, log10);
}

/**
 * log10 of the tier-0 HP curve at this index: the per-kill log growth r(i) = rL + (rE - rL)·e^(-i/τ)
 * integrated from 0 to i (smooth, monotone, and a steady ratio in the long run).
 */
function hpLog10(index: number): number {
  const b = BALANCE.dragon;
  const rE = Math.log(b.hpGrowthEarly);
  const rL = Math.log(b.hpGrowthLate);
  const tau = Math.max(1e-6, b.hpGrowthFade);
  const ln = Math.log(b.hpBase) + rL * index + (rE - rL) * tau * (1 - Math.exp(-index / tau));
  return ln / LN10;
}

/** Max HP of the nth dragon of a tier. */
export function dragonMaxHp(tier: number, index: number): Decimal {
  if (tier === 0 && index === 0) return D(BALANCE.dragon.firstHp);
  return fromLog10(hpLog10(index) + tier * Math.log10(BALANCE.dragon.tierHpMult));
}

/** Kill reward before gold upgrades. */
export function dragonGold(tier: number, index: number): Decimal {
  const b = BALANCE.dragon;
  if (tier === 0 && index === 0) return D(b.firstGold);
  return fromLog10(hpLog10(index) + Math.log10(b.goldPerHp) + tier * Math.log10(b.tierGoldMult));
}

/** Body length in meters: log-linear between BALANCE.dragon.sizeAnchors, then a steady ratio. */
export function dragonSize(_tier: number, index: number): number {
  const anchors = BALANCE.dragon.sizeAnchors;
  const first = anchors[0]!;
  if (index <= first[0]) return first[1];
  for (let k = 1; k < anchors.length; k++) {
    const a = anchors[k - 1]!;
    const b = anchors[k]!;
    if (index <= b[0]) {
      const u = (index - a[0]) / (b[0] - a[0]);
      return a[1] * Math.pow(b[1] / a[1], u);
    }
  }
  const last = anchors[anchors.length - 1]!;
  return last[1] * Math.pow(BALANCE.dragon.sizeGrowthAfter, index - last[0]);
}

// ---- Phase timing ----

/** 0 at ≤ quickSize m, 1 at ≥ fullSize m, linear in log size between. */
function sizeBlend(size: number): number {
  const p = BALANCE.phase;
  if (!(size > p.quickSize)) return 0;
  if (size >= p.fullSize) return 1;
  return Math.log(size / p.quickSize) / Math.log(p.fullSize / p.quickSize);
}

/** Entrance duration (s) of a dragon this long: newts scuttle in, big dragons take their time. */
export function enterDuration(size: number): number {
  const p = BALANCE.phase;
  return p.enterQuick + (p.enter - p.enterQuick) * sizeBlend(size);
}

/** Death duration (s) of a dragon this long: newts pop, big dragons stay dramatic. */
export function dyingDuration(size: number): number {
  const p = BALANCE.phase;
  return p.dyingQuick + (p.dying - p.dyingQuick) * sizeBlend(size);
}

// ---- Upgrades ----

export function hasUpgrade(state: GameState, id: string): boolean {
  return (state.upgrades[id] ?? 0) > 0;
}

/** Click upgrades' multiplier on the whole strike (the base and the heroicExample share). */
export function clickMult(state: GameState): number {
  let m = 1;
  for (const u of UPGRADES) {
    const e = u.effect;
    if (e.kind === 'clickMult' && hasUpgrade(state, u.id)) m *= e.mult;
  }
  return m;
}

/** Weak-spot crit multiplier (×5, or ×10 with keenEye). */
export function weakMult(state: GameState): number {
  let m = BALANCE.click.weakMult;
  for (const u of UPGRADES) {
    const e = u.effect;
    if (e.kind === 'weakMult' && hasUpgrade(state, u.id)) m = Math.max(m, e.value);
  }
  return m;
}

/** Multiplier on kill gold (and the stagger bonus). */
export function goldMult(state: GameState): number {
  let m = 1;
  for (const u of UPGRADES) {
    const e = u.effect;
    if (e.kind === 'goldMult' && hasUpgrade(state, u.id)) m *= e.mult;
  }
  return m;
}

/** Share of army DPS each click adds (heroicExample). */
export function clickArmyShare(state: GameState): number {
  let s = BALANCE.click.armyShare;
  for (const u of UPGRADES) {
    const e = u.effect;
    if (e.kind === 'clickArmyShare' && hasUpgrade(state, u.id)) s += e.share;
  }
  return s;
}

/** How many damage milestones `owned` units have passed (listed thresholds, then every N). */
export function milestoneCount(owned: number): number {
  const m = BALANCE.milestones;
  let n = 0;
  for (const t of m.at) if (owned >= t) n++;
  const last = m.at[m.at.length - 1] ?? 0;
  if (m.every > 0 && owned >= last + m.every) n += Math.floor((owned - last) / m.every);
  return n;
}

/** The owned count of the kth milestone (0-based), following the same schedule. */
export function milestoneAt(k: number): number {
  const m = BALANCE.milestones;
  if (k < m.at.length) return m.at[k]!;
  const last = m.at[m.at.length - 1] ?? 0;
  return last + (k - m.at.length + 1) * Math.max(1, m.every);
}

/** Owned count → mult^(milestones reached), per unit type. Unbounded, so a Decimal. */
export function milestoneMult(owned: number): Decimal {
  return Decimal.pow(BALANCE.milestones.mult, milestoneCount(owned));
}

/** Product of owned upgrades' damage multipliers for one unit type (bounded: a number). */
function unitUpgradeMult(state: GameState, unit: UnitId): number {
  let m = 1;
  for (const u of UPGRADES) {
    const e = u.effect;
    if (!hasUpgrade(state, u.id)) continue;
    if (e.kind === 'armyMult') m *= e.mult;
    else if (e.kind === 'unitMult' && e.unit === unit) m *= e.mult;
  }
  return m;
}

/** Upgrade × milestone multiplier on one unit's damage. */
export function unitMult(state: GameState, unit: UnitId): Decimal {
  return milestoneMult(state.units[unit]).mul(unitUpgradeMult(state, unit));
}

/** Seconds between this unit type's beats/volleys (quickNock shortens archers). */
export function unitPeriod(state: GameState, unit: UnitId): number {
  let p = UNITS[unit].interval;
  for (const u of UPGRADES) {
    const e = u.effect;
    if (e.kind === 'periodMult' && e.unit === unit && hasUpgrade(state, u.id)) p *= e.mult;
  }
  return p;
}

// ---- Damage ----

/** Damage ONE unit of this type deals per beat/volley (not counting stagger). */
export function unitDamage(state: GameState, unit: UnitId): Decimal {
  return unitMult(state, unit).mul(UNITS[unit].damage);
}

/** Average DPS of all owned units of this type (not counting stagger). */
export function unitDps(state: GameState, unit: UnitId): Decimal {
  const n = state.units[unit];
  if (n <= 0) return D(0);
  return unitDamage(state, unit).mul(n / unitPeriod(state, unit));
}

/** Average DPS of the whole army (not counting stagger). */
export function armyDps(state: GameState): Decimal {
  return unitDps(state, 'footman').add(unitDps(state, 'archer'));
}

/** Damage of one click before the weak-spot multiplier: (base + share × army DPS) × click upgrades. */
export function strikeDamage(state: GameState): Decimal {
  const mult = clickMult(state);
  const share = clickArmyShare(state);
  if (share <= 0) return D(BALANCE.click.base * mult);
  return D(BALANCE.click.base).add(armyDps(state).mul(share)).mul(mult);
}

/** Damage of one click; `weak` = on the weak spot (crit). */
export function clickDamage(state: GameState, weak: boolean): Decimal {
  const d = strikeDamage(state);
  return weak ? d.mul(weakMult(state)) : d;
}

/** Gold paid for killing the current dragon (bounty included). */
export function killGold(state: GameState): Decimal {
  const g = dragonGold(state.tier, state.dragon.index);
  const m = goldMult(state);
  return m === 1 ? g : wholeCeil(g.mul(m));
}

/**
 * Gold bonus for staggering the current dragon next: the full bonus on its first stagger, a small
 * one on later staggers (so staggering stays a bonus on top of kills, never the main income).
 */
export function staggerGold(state: GameState): Decimal {
  const b = BALANCE.stagger;
  return wholeCeil(killGold(state).mul(state.dragon.staggers > 0 ? b.repeatGoldFrac : b.goldFrac));
}

// ---- Costs ----

/** buyUnit's `amount` for "as many as gold allows". */
export const BUY_MAX = -1;
/** Upper bound on one purchase (keeps counts sane when gold is astronomically ahead). */
export const MAX_BUY = 1e6;

/** Total gold to hire `amount` more of a unit (the geometric series sum, rounded up). */
export function unitCost(state: GameState, unit: UnitId, amount = 1): Decimal {
  const def = UNITS[unit];
  if (!(amount >= 1)) return D(0);
  const n = Math.floor(amount);
  const owned = state.units[unit];
  // Exact double arithmetic while it fits (clean integers), the Decimal closed form beyond.
  const first = def.baseCost * Math.pow(def.costGrowth, owned);
  const sum = (first * (Math.pow(def.costGrowth, n) - 1)) / (def.costGrowth - 1);
  if (Number.isFinite(sum) && sum < EXACT_BELOW) return D(ceilClean(sum));
  return wholeCeil(Decimal.sumGeometricSeries(n, def.baseCost, def.costGrowth, owned));
}

/** How many of a unit the current gold buys (0 if not even one). Ignores the unlock flag. */
export function maxAffordable(state: GameState, unit: UnitId): number {
  const def = UNITS[unit];
  const gold = state.gold;
  if (gold.lt(unitCost(state, unit, 1))) return 0;
  const est = Decimal.affordGeometricSeries(gold, def.baseCost, def.costGrowth, state.units[unit]).toNumber();
  let n = Math.min(MAX_BUY, Math.max(1, Math.floor(Number.isFinite(est) ? est : MAX_BUY)));
  // The closed form works in floats and we round costs up: nudge to the exact answer (bounded,
  // so float plateaus at absurd counts can't loop forever).
  for (let k = 0; k < 8 && n > 1 && gold.lt(unitCost(state, unit, n)); k++) n--;
  for (let k = 0; k < 8 && n < MAX_BUY && gold.gte(unitCost(state, unit, n + 1)); k++) n++;
  return n;
}

/** Cost of a one-shot upgrade, or null for an unknown id. */
export function upgradeCost(id: string): Decimal | null {
  const u = upgradeDefOf(id);
  return u ? D(u.cost) : null;
}
