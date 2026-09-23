// Economy formulas. Every number comes from content/balance.ts (BALANCE); this file is the math.
// Pure functions of (state, content). Economy values are Decimals; multipliers and counts are numbers.
import { Decimal, D } from './decimal';
import { BALANCE, CHAMPIONS, KNIGHT_M, UNITS, UNIT_IDS, UPGRADES, lastTier, tierNumber, tierOf, upgradeDefOf } from './content';
import type { AbilityId, ChampionId, ChargeId, GameState, UnitId } from './types';

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

// ---- Tiers ----

/** Dragon HP in tier t × this (vs the Meadow). */
export function tierHpMult(tier: number): number {
  return tierNumber(tier, 'hpMult');
}

/** Kill gold in tier t × this. */
export function tierGoldMult(tier: number): number {
  return tierNumber(tier, 'goldMult');
}

/** Unit, upgrade and champion-level costs in tier t × this. */
export function tierCostMult(tier: number): number {
  return tierNumber(tier, 'costMult');
}

/** Ordinary kills that fill tier t's Wyrm Gauge. */
export function bossAt(tier: number): number {
  return Math.max(1, Math.round(tierNumber(tier, 'bossAt')));
}

/**
 * Max HP of the nth dragon of a tier. Dragon #0 is special: the Meadow's tutorial newt has
 * `firstHp`; in every later tier it is the colossus's first opponent, with `arrivalHp` of its curve
 * HP (it falls in a few strikes, then the curve takes over).
 */
export function dragonMaxHp(tier: number, index: number): Decimal {
  if (index === 0 && tier === 0) return D(BALANCE.dragon.firstHp);
  const arrival = index === 0 ? Math.log10(BALANCE.dragon.arrivalHp) : 0;
  return fromLog10(hpLog10(index) + Math.log10(tierHpMult(tier)) + arrival);
}

/** Kill reward before gold upgrades. */
export function dragonGold(tier: number, index: number): Decimal {
  const b = BALANCE.dragon;
  if (tier === 0 && index === 0) return D(b.firstGold);
  return fromLog10(hpLog10(index) + Math.log10(b.goldPerHp) + Math.log10(tierGoldMult(tier)));
}

/** The Meadow's size curve (m): log-linear between BALANCE.dragon.sizeAnchors, then a steady ratio. */
function baseSize(index: number): number {
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

/**
 * Body length in world meters: the Meadow's curve, scaled so the tier's dragon #0 is its
 * `firstSize` (the Mountain's first wyvern is a knight's height, 1.8 m) and growing alike.
 */
export function dragonSize(tier: number, index: number): number {
  const b = baseSize(index);
  if (tier === 0) return b;
  return (b * tierNumber(tier, 'firstSize')) / BALANCE.dragon.sizeAnchors[0]![1];
}

/**
 * HP of the tier's boss: dragon #bossAt's × the tier's `bossHp` (fixed per tier: an escape doesn't
 * toughen it). Per tier because each boss fight is tuned against its tier's army and clicks.
 */
export function bossMaxHp(tier: number): Decimal {
  return wholeCeil(dragonMaxHp(tier, bossAt(tier)).mul(tierNumber(tier, 'bossHp')));
}

/** The boss's kill reward before gold upgrades. */
export function bossGold(tier: number): Decimal {
  return wholeCeil(dragonGold(tier, bossAt(tier)).mul(BALANCE.boss.goldMult));
}

/** Display meters of a world length at the current tier's scale (a knight = state.height). */
export function displayMeters(state: GameState, worldM: number): number {
  return (worldM * state.height) / KNIGHT_M;
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

/** This dragon's entrance (s): a boss takes its own, grander time (BALANCE.boss.enter). */
export function dragonEnterDuration(d: { size: number; boss: string | null }): number {
  return d.boss ? BALANCE.boss.enter : enterDuration(d.size);
}

/** This dragon's death (s): a boss falls for longer (BALANCE.boss.dying). */
export function dragonDyingDuration(d: { size: number; boss: string | null }): number {
  return d.boss ? BALANCE.boss.dying : dyingDuration(d.size);
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

// ---- Heraldry (M2) ----

/** Level of a heraldic charge (0 = not on the shield). */
export function chargeLevel(state: GameState, id: ChargeId): number {
  return state.heraldry.levels[id] ?? 0;
}

/** The compounding per-level multiplier of a charge whose effect has a `mult` (1 when not taken). */
function heraldryMult(state: GameState, id: ChargeId): number {
  const e = BALANCE.heraldry[id].effect;
  const L = chargeLevel(state, id);
  if (L <= 0 || !('mult' in e)) return 1;
  return Math.pow(e.mult, L);
}

/** Scales for the next level of a charge. */
export function heraldryCost(state: GameState, id: ChargeId): Decimal {
  const b = BALANCE.heraldry[id];
  const c = b.cost * Math.pow(b.growth, chargeLevel(state, id));
  return Number.isFinite(c) && c < EXACT_BELOW ? D(ceilClean(c)) : wholeCeil(Decimal.pow(b.growth, chargeLevel(state, id)).mul(b.cost));
}

/** Lion: all damage × this. */
export function lionMult(state: GameState): number {
  return heraldryMult(state, 'lion');
}

/** Units of each kind Tower heraldry grants at the start of a tier. */
export function towerUnits(state: GameState): { unit: UnitId; count: number } | null {
  const e = BALANCE.heraldry.tower.effect;
  const L = chargeLevel(state, 'tower');
  if (L <= 0 || e.kind !== 'startUnits') return null;
  return { unit: e.unit, count: e.count * L };
}

/**
 * Multiplier on ALL damage (clicks, army, champions, abilities): the product of every Fusion Bonus
 * so far × Lion heraldry.
 */
export function damageMult(state: GameState): number {
  return state.zoom.fusion * lionMult(state);
}

/** Weak-spot crit multiplier (×5, or ×10 with keenEye; × Wyvern heraldry). */
export function weakMult(state: GameState): number {
  let m = BALANCE.click.weakMult;
  for (const u of UPGRADES) {
    const e = u.effect;
    if (e.kind === 'weakMult' && hasUpgrade(state, u.id)) m = Math.max(m, e.value);
  }
  return m * heraldryMult(state, 'wyvern');
}

/** Multiplier on kill gold (and the stagger bonus): upgrades × Sun heraldry. */
export function goldMult(state: GameState): number {
  let m = heraldryMult(state, 'sun');
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

/** Upgrade × milestone × all-damage multiplier on one unit's damage. */
export function unitMult(state: GameState, unit: UnitId): Decimal {
  return milestoneMult(state.units[unit]).mul(unitUpgradeMult(state, unit) * damageMult(state));
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

/**
 * Average DPS of the whole army's units (not counting stagger, Charge! or champions: see
 * championDps). The Fusion Bonus and Lion are in it.
 */
export function armyDps(state: GameState): Decimal {
  let dps = D(0);
  for (const id of UNIT_IDS) if (state.units[id] > 0) dps = dps.add(unitDps(state, id));
  return dps;
}

/**
 * Damage of one click before the weak-spot multiplier: (base × all-damage + share × army DPS) ×
 * click upgrades. (Army DPS already carries the all-damage multiplier.)
 */
export function strikeDamage(state: GameState): Decimal {
  const mult = clickMult(state);
  const share = clickArmyShare(state);
  const base = BALANCE.click.base * damageMult(state);
  if (share <= 0) return D(base * mult);
  return D(base).add(armyDps(state).mul(share)).mul(mult);
}

/** Damage of one click; `weak` = on the weak spot (crit). */
export function clickDamage(state: GameState, weak: boolean): Decimal {
  const d = strikeDamage(state);
  return weak ? d.mul(weakMult(state)) : d;
}

/** Gold paid for killing the current dragon (bounty and Sun included; a boss pays its own). */
export function killGold(state: GameState): Decimal {
  const g = state.dragon.boss ? bossGold(state.tier) : dragonGold(state.tier, state.dragon.index);
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

/** Sum of `n` terms base × growth^(start..start+n-1), rounded up to a whole number. */
function seriesCost(base: number, growth: number, start: number, n: number): Decimal {
  // Exact double arithmetic while it fits (clean integers), the Decimal closed form beyond.
  const first = base * Math.pow(growth, start);
  const sum = (first * (Math.pow(growth, n) - 1)) / (growth - 1);
  if (Number.isFinite(sum) && sum < EXACT_BELOW) return D(ceilClean(sum));
  return wholeCeil(Decimal.sumGeometricSeries(n, base, growth, start));
}

/** How many terms of that series `gold` covers (0 if not even one), capped at MAX_BUY. */
function seriesAffordable(gold: Decimal, base: number, growth: number, start: number): number {
  if (gold.lt(seriesCost(base, growth, start, 1))) return 0;
  const est = Decimal.affordGeometricSeries(gold, base, growth, start).toNumber();
  let n = Math.min(MAX_BUY, Math.max(1, Math.floor(Number.isFinite(est) ? est : MAX_BUY)));
  // The closed form works in floats and we round costs up: nudge to the exact answer (bounded,
  // so float plateaus at absurd counts can't loop forever).
  for (let k = 0; k < 8 && n > 1 && gold.lt(seriesCost(base, growth, start, n)); k++) n--;
  for (let k = 0; k < 8 && n < MAX_BUY && gold.gte(seriesCost(base, growth, start, n + 1)); k++) n++;
  return n;
}

/** A unit's first cost in this tier's gold. */
function unitBaseCost(state: GameState, unit: UnitId): number {
  return UNITS[unit].baseCost * tierCostMult(state.tier);
}

/** Total gold to hire `amount` more of a unit in the current tier (the geometric series sum, rounded up). */
export function unitCost(state: GameState, unit: UnitId, amount = 1): Decimal {
  if (!(amount >= 1)) return D(0);
  return seriesCost(unitBaseCost(state, unit), UNITS[unit].costGrowth, state.units[unit], Math.floor(amount));
}

/** How many of a unit the current gold buys (0 if not even one). Ignores the unlock flag. */
export function maxAffordable(state: GameState, unit: UnitId): number {
  return seriesAffordable(state.gold, unitBaseCost(state, unit), UNITS[unit].costGrowth, state.units[unit]);
}

/** Cost of a one-shot upgrade, or null for an unknown id. */
export function upgradeCost(id: string): Decimal | null {
  const u = upgradeDefOf(id);
  return u ? D(u.cost) : null;
}

// ---- Champions (M2) ----

/** Where a champion's level sits between level 1 (0) and mastery (1), shaped by levelCurve. */
function championProgress(state: GameState, id: ChampionId): number {
  const b = BALANCE.champions[id];
  const L = Math.min(state.champions[id].level, b.maxLevel);
  if (L <= 1 || b.maxLevel <= 1) return 0;
  return Math.pow((L - 1) / (b.maxLevel - 1), b.levelCurve);
}

/** Share of the current dragon's max HP a champion's blow deals (0 before it joins). */
export function championBlowShare(state: GameState, id: ChampionId): number {
  if (state.champions[id].level <= 0) return 0;
  const [lo, hi] = BALANCE.champions[id].blow;
  return lo + (hi - lo) * championProgress(state, id);
}

/** Share of the current dragon's max HP a champion's special deals (0 before it joins). */
export function championSpecialShare(state: GameState, id: ChampionId): number {
  if (state.champions[id].level <= 0) return 0;
  const [lo, hi] = BALANCE.champions[id].special;
  return lo + (hi - lo) * championProgress(state, id);
}

/**
 * One ordinary blow of a champion (lands on every footman melee beat): a share of the CURRENT
 * dragon's max HP, so champions count the same in every tier (bosses included) and a blow never
 * one-shots. 0 before it joins. Not counting stagger or Charge! (applied when it lands).
 */
export function championHit(state: GameState, id: ChampionId): Decimal {
  const share = championBlowShare(state, id);
  return share > 0 ? wholeCeil(state.dragon.maxHp.mul(share)) : D(0);
}

/** A champion's special move (every specialEvery s): a bigger share of the dragon's max HP. */
export function championSpecialDamage(state: GameState, id: ChampionId): Decimal {
  const share = championSpecialShare(state, id);
  return share > 0 ? wholeCeil(state.dragon.maxHp.mul(share)) : D(0);
}

/** Average DPS of a champion against the current dragon: blows on the footmen's beat plus its special. */
export function championDps(state: GameState, id: ChampionId): Decimal {
  const b = BALANCE.champions[id];
  return championHit(state, id).mul(1 / unitPeriod(state, 'footman')).add(championSpecialDamage(state, id).mul(1 / b.specialEvery));
}

/** Every joined champion's DPS. */
export function championsDps(state: GameState): Decimal {
  let dps = D(0);
  for (const id of Object.keys(CHAMPIONS) as ChampionId[]) dps = dps.add(championDps(state, id));
  return dps;
}

/** Levels a champion can still gain before mastery (0 if it hasn't joined). */
export function championLevelsLeft(state: GameState, id: ChampionId): number {
  const L = state.champions[id].level;
  return L <= 0 ? 0 : Math.max(0, BALANCE.champions[id].maxLevel - L);
}

/** Gold for the next `amount` levels of a champion (clamped to mastery; 0 if none can be bought). */
export function championCost(state: GameState, id: ChampionId, amount = 1): Decimal {
  const L = state.champions[id].level;
  const n = Math.min(Math.floor(amount), championLevelsLeft(state, id));
  if (L <= 0 || !(n >= 1)) return D(0);
  const b = BALANCE.champions[id];
  return seriesCost(b.baseCost * tierCostMult(state.tier), b.costGrowth, L - 1, n);
}

/** How many levels of a champion the current gold buys (up to mastery). */
export function championMaxAffordable(state: GameState, id: ChampionId): number {
  const L = state.champions[id].level;
  if (L <= 0 || championLevelsLeft(state, id) <= 0) return 0;
  const b = BALANCE.champions[id];
  return Math.min(championLevelsLeft(state, id), seriesAffordable(state.gold, b.baseCost * tierCostMult(state.tier), b.costGrowth, L - 1));
}

// ---- Abilities (M2) ----

/** Full cooldown of an ability right now (Stag heraldry shortens it, down to its floor). */
export function abilityCooldown(state: GameState, id: AbilityId): number {
  const e = BALANCE.heraldry.stag.effect;
  let m = 1;
  const L = chargeLevel(state, 'stag');
  if (L > 0 && e.kind === 'cooldownMult') m = Math.max(e.min, Math.pow(e.mult, L));
  return BALANCE.abilities[id].cooldown * m;
}

/** Army (and champion) damage × this while Charge! is active. */
export function chargeMult(state: GameState): number {
  return state.abilities.charge.active > 0 ? BALANCE.abilities.chargeMult : 1;
}

/**
 * The Dragonbane Volley's damage: volleySeconds × (army DPS + champions), and at least that many
 * seconds of volleyMinClicks plain clicks/s (so it hits even with no army). × Charge! if active.
 */
export function volleyAbilityDamage(state: GameState): Decimal {
  const a = BALANCE.abilities;
  const army = armyDps(state).add(championsDps(state));
  const floor = clickDamage(state, false).mul(a.volleyMinClicks);
  const dps = army.gt(floor) ? army : floor;
  return dps.mul(a.volleySeconds * chargeMult(state));
}

// ---- The zoom (M2) ----

/** The boss is beaten, nothing is holding and a next tier exists in this build. */
export function canZoom(state: GameState): boolean {
  return state.wyrm.cleared && state.zoom.stage === null && state.tier < lastTier();
}

/** Kills since the tier's boss fell (0 before): how far the player pushed. */
export function pushKills(state: GameState): number {
  return state.wyrm.cleared ? Math.max(0, state.kills - state.wyrm.clearedAt) : 0;
}

/** Scales a zoom out of this tier pays now: the tier's base × pushScales^(kills since the boss). */
export function scalesForZoom(state: GameState): Decimal {
  const base = tierNumber(state.tier, 'scales');
  return D(base).mul(Decimal.pow(BALANCE.zoom.pushScales, pushKills(state))).floor();
}

/** Units that would fuse into the colossus. */
export function unitsFused(state: GameState): number {
  let n = 0;
  for (const id of UNIT_IDS) n += state.units[id];
  return n;
}

/**
 * This zoom's Fusion Bonus: 1 + fusionPerSqrtUnit × √(units) × (1 + Crown's add × level), rounded
 * to 0.01. It multiplies into zoom.fusion (all damage) at the switch.
 */
export function fusionForZoom(state: GameState): number {
  const e = BALANCE.heraldry.crown.effect;
  const crown = e.kind === 'fusionBonus' ? 1 + e.add * chargeLevel(state, 'crown') : 1;
  const f = 1 + BALANCE.zoom.fusionPerSqrtUnit * Math.sqrt(unitsFused(state)) * crown;
  return Math.round(f * 100) / 100;
}

/** 3 significant digits (heights read as "221 m", "4.36 km"). */
function round3(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return x;
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 2);
  return Math.round(x / p) * p;
}

/** The colossus's height (display m) after zooming now: the next tier's baseHeight × fusion^heightExp. */
export function heightForZoom(state: GameState): number {
  return round3(tierNumber(state.tier + 1, 'baseHeight') * Math.pow(fusionForZoom(state), BALANCE.zoom.heightExp));
}

/** The tier's boss id. */
export function bossOf(tier: number): string {
  return tierOf(tier).boss;
}
