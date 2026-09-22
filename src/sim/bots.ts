// Bot profiles (PLAN §8) and their shopping rules. Bots act in wall time, like a player, and draw
// their own randomness (weak-spot aim) from a private RNG so the game's state.rng is untouched.
import {
  UNIT_IDS,
  UNITS,
  UPGRADES,
  armyDps,
  sel,
  unitCost,
} from '../core';
import type { Action, Decimal, GameState, UnitId } from '../core';

export type ProfileName = 'engaged' | 'casual' | 'idle';

export type ShopPolicy = 'greedy' | 'cheapest';

export interface Profile {
  name: ProfileName;
  /** Clicks per wall second. */
  cps: number;
  /** Chance a click lands on the weak spot (the loose scale) outside windups. */
  weakRate: number;
  /**
   * Windups (PLAN §3.2): the weak spot is the glowing throat, somewhere else, so a stagger takes
   * intent. Each windup the player goes for the throat with chance `staggerTry`; if so, after a
   * reaction time in [reactMin, reactMax] s each click hits the throat with chance `throatHit`.
   * Other windup clicks are plain body hits.
   */
  staggerTry: number;
  reactMin: number;
  reactMax: number;
  throatHit: number;
  /** Wall seconds before the first click (reading the title). */
  startDelay: number;
  /** Stop clicking after the first kill (the idle player: the newt can only die by clicking). */
  clickUntilFirstKill: boolean;
  /** Wall seconds between shopping trips (the first trip is right after the first kill). */
  shopEvery: number;
  shop: ShopPolicy;
  /** Wall seconds to play. */
  seconds: number;
}

export const PROFILES: Record<ProfileName, Profile> = {
  engaged: {
    name: 'engaged',
    cps: 6,
    weakRate: 0.3,
    staggerTry: 0.6,
    reactMin: 0.3,
    reactMax: 0.8,
    throatHit: 0.5,
    startDelay: 1,
    clickUntilFirstKill: false,
    shopEvery: 0.5,
    shop: 'greedy',
    seconds: 240,
  },
  casual: {
    name: 'casual',
    cps: 3,
    weakRate: 0.1,
    // Ignores stagger timing: keeps clicking at random, so the throat gets its 10% share of hits.
    staggerTry: 1,
    reactMin: 0,
    reactMax: 0,
    throatHit: 0.1,
    startDelay: 2,
    clickUntilFirstKill: false,
    shopEvery: 10,
    shop: 'cheapest',
    seconds: 240,
  },
  idle: {
    name: 'idle',
    cps: 3,
    weakRate: 0,
    staggerTry: 0,
    reactMin: 0,
    reactMax: 0,
    throatHit: 0,
    startDelay: 2,
    clickUntilFirstKill: true,
    shopEvery: 60,
    shop: 'cheapest',
    seconds: 600,
  },
};

export const PROFILE_NAMES: readonly ProfileName[] = ['engaged', 'casual', 'idle'];

// ---- Shopping ----

/** Most purchases in one shopping trip (a guard, never reached in practice). */
const MAX_BUYS_PER_TRIP = 200;

function upgradeBuyable(s: GameState, id: string): boolean {
  return sel.upgradeVisible(s, id);
}

/**
 * An upgrade is useless (for now) if it boosts a unit type nobody owns yet, or shares army DPS
 * with clicks while there is no army.
 */
function upgradeUseful(s: GameState, id: string): boolean {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return false;
  const e = u.effect;
  if (e.kind === 'unitMult' || e.kind === 'periodMult') return s.units[e.unit] > 0;
  if (e.kind === 'clickArmyShare' || e.kind === 'armyMult') return armyDps(s).gt(0);
  return true;
}

/** Casual / idle: affordable useful upgrades first (the glowing button), then the cheapest unit. */
function cheapestBuy(s: GameState): Action | null {
  let bestUp: string | null = null;
  let bestUpCost = Infinity;
  for (const u of UPGRADES) {
    if (!upgradeBuyable(s, u.id) || !upgradeUseful(s, u.id) || s.gold.lt(u.cost)) continue;
    if (u.cost < bestUpCost) {
      bestUpCost = u.cost;
      bestUp = u.id;
    }
  }
  if (bestUp) return { type: 'buyUpgrade', id: bestUp };
  let best: UnitId | null = null;
  let bestCost: Decimal | null = null;
  for (const id of UNIT_IDS) {
    if (!sel.unitVisible(s, id)) continue;
    const c = unitCost(s, id);
    if (s.gold.lt(c)) continue;
    if (!bestCost || c.lt(bestCost)) {
      bestCost = c;
      best = id;
    }
  }
  return best ? { type: 'buyUnit', unit: best, amount: 1 } : null;
}

/** Damage per second this player deals right now (army + its own clicking). */
export function effectiveDps(s: GameState, p: Profile): number {
  return armyDps(s).add(sel.clickDps(s, p.clickUntilFirstKill ? 0 : p.cps, p.weakRate)).toNumber();
}

/** DPS gained per gold by hiring one more of `unit` (milestone doublings included). */
function unitValue(s: GameState, p: Profile, unit: UnitId, base: number): number {
  s.units[unit]++;
  const after = effectiveDps(s, p);
  s.units[unit]--;
  return (after - base) / unitCost(s, unit).toNumber();
}

/**
 * The engaged player saves for a visible upgrade if it costs at most this × the best unit, rather
 * than frittering the gold on one more footman.
 */
const SAVE_FOR_UPGRADE = 5;

/**
 * Engaged: buys any affordable useful upgrade at once; otherwise hires the unit with the best DPS
 * per gold, unless a useful upgrade is close enough in price to be worth saving for.
 */
function greedyBuy(s: GameState, p: Profile): Action | null {
  let cheapestUpgrade = Infinity;
  for (const u of UPGRADES) {
    if (!upgradeBuyable(s, u.id) || !upgradeUseful(s, u.id)) continue;
    if (s.gold.gte(u.cost)) return { type: 'buyUpgrade', id: u.id };
    cheapestUpgrade = Math.min(cheapestUpgrade, u.cost);
  }
  const base = effectiveDps(s, p);
  let best: UnitId | null = null;
  let bestValue = -Infinity;
  for (const id of UNIT_IDS) {
    if (!sel.unitVisible(s, id)) continue;
    const v = unitValue(s, p, id, base);
    if (v > bestValue) {
      bestValue = v;
      best = id;
    }
  }
  if (!best) return null;
  const cost = unitCost(s, best);
  if (cheapestUpgrade <= SAVE_FOR_UPGRADE * cost.toNumber()) return null;
  return s.gold.gte(cost) ? { type: 'buyUnit', unit: best, amount: 1 } : null;
}

/** Everything the bot buys on one shopping trip, applied through `apply`. */
export function shop(s: GameState, p: Profile, apply: (a: Action) => void): void {
  for (let k = 0; k < MAX_BUYS_PER_TRIP; k++) {
    const a = p.shop === 'greedy' ? greedyBuy(s, p) : cheapestBuy(s);
    if (!a) return;
    apply(a);
  }
}
