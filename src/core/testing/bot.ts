// A scripted player for pacing tests (and a reference for the balance sim, WP 1.9): clicks at a
// fixed rate, hits the weak spot a fraction of the time (deterministically, from its own RNG),
// and every `buyEvery` seconds buys upgrades as soon as affordable, else the cheapest unit.
import { nextFloat, seedRng } from '../../lib/rng';
import { applyAction } from '../actions';
import { UNITS, UNIT_IDS, UPGRADES } from '../content';
import { TICK_DT, unitCost } from '../formulas';
import { createInitialState } from '../state';
import { tick } from '../tick';
import type { Action, GameEvent, GameState } from '../types';

export interface BotProfile {
  clicksPerSec: number;
  /** Fraction of clicks that land on the weak spot. */
  weakRate: number;
  /** Seconds between shopping trips (0 = every tick). */
  buyEvery: number;
  /** Stop clicking after this many seconds (Infinity = never). */
  clickUntil?: number;
}

export const ENGAGED: BotProfile = { clicksPerSec: 6, weakRate: 0.3, buyEvery: 0 };

export interface BotReport {
  state: GameState;
  /** Sim time of the first dragonDeath, or -1. */
  firstKill: number;
  /** Sim time each unlock flag was set, keyed by 'kind.id'. */
  unlockAt: Record<string, number>;
  /** Sim time of the first purchase of each unit/upgrade id. */
  firstBuyAt: Record<string, number>;
  /** Dragon size (m) sampled at each whole minute (index 0 = 0:00). */
  sizeAtMinute: number[];
  /** kills at the given checkpoints (seconds → kills). */
  killsAt: Record<number, number>;
  /** Longest stretch (s) between purchases after the first one. */
  longestBuyGap: number;
  purchases: number;
  staggers: number;
  /** Damage dealt by clicks vs the army (for "clicks stay relevant"). */
  clickDamage: number;
  armyDamage: number;
  /** Per-minute share of damage from clicks. */
  clickShareByMinute: number[];
}

/**
 * The cheapest affordable thing, except that a visible upgrade costing at most SAVE_FOR × the
 * cheapest unit is saved for (units wait until it's bought), like a player eyeing a shiny upgrade.
 */
const SAVE_FOR = 4;

function cheapestBuy(s: GameState): Action | null {
  let best: Action | null = null;
  let bestCost = Infinity;
  let cheapestUnit = Infinity;
  for (const id of UNIT_IDS) {
    if (s.flags[UNITS[id].unlockFlag]) cheapestUnit = Math.min(cheapestUnit, unitCost(s, id).toNumber());
  }
  let saving = false;
  for (const u of UPGRADES) {
    if ((s.upgrades[u.id] ?? 0) > 0 || !s.flags[u.unlockFlag]) continue;
    if (s.gold.gte(u.cost)) return { type: 'buyUpgrade', id: u.id };
    if (u.cost <= SAVE_FOR * cheapestUnit) saving = true;
  }
  if (saving) return null;
  for (const id of UNIT_IDS) {
    if (!s.flags[UNITS[id].unlockFlag]) continue;
    const c = unitCost(s, id).toNumber();
    if (c < bestCost && s.gold.gte(c)) {
      bestCost = c;
      best = { type: 'buyUnit', unit: id, amount: 1 };
    }
  }
  return best;
}

/** Play `seconds` of game with a scripted player. `checkpoints` are times to record kills at. */
export function runBot(
  profile: BotProfile,
  seconds: number,
  seed = 1,
  checkpoints: number[] = [],
  onEvent?: (e: GameEvent, s: GameState) => void,
): BotReport {
  const s = createInitialState(seed);
  const rng = seedRng(seed ^ 0x5eed);
  const r: BotReport = {
    state: s,
    firstKill: -1,
    unlockAt: {},
    firstBuyAt: {},
    sizeAtMinute: [s.dragon.size],
    killsAt: {},
    longestBuyGap: 0,
    purchases: 0,
    staggers: 0,
    clickDamage: 0,
    armyDamage: 0,
    clickShareByMinute: [],
  };
  let lastBuy = -1;
  let minuteClick = 0;
  let minuteArmy = 0;
  const emit = (e: GameEvent): void => {
    onEvent?.(e, s);
    switch (e.type) {
      case 'dragonDeath':
        if (r.firstKill < 0) r.firstKill = s.t;
        break;
      case 'unlock':
        r.unlockAt[e.kind + '.' + e.id] = s.t;
        break;
      case 'purchase':
        if (r.firstBuyAt[e.id] === undefined) r.firstBuyAt[e.id] = s.t;
        if (lastBuy >= 0) r.longestBuyGap = Math.max(r.longestBuyGap, s.t - lastBuy);
        lastBuy = s.t;
        r.purchases++;
        break;
      case 'strike': {
        const d = Math.min(e.damage.toNumber(), s.dragon.hp.toNumber());
        r.clickDamage += d;
        minuteClick += d;
        if (e.stagger) r.staggers++;
        break;
      }
      case 'armyHit': {
        const d = Math.min(e.damage.toNumber(), s.dragon.hp.toNumber());
        r.armyDamage += d;
        minuteArmy += d;
        break;
      }
    }
  };

  const ticks = Math.round(seconds / TICK_DT);
  const clickUntil = profile.clickUntil ?? Infinity;
  const buyTicks = Math.max(1, Math.round(profile.buyEvery / TICK_DT));
  let clickAcc = 0;
  const cps = new Set(checkpoints.map((c) => Math.round(c / TICK_DT)));
  for (let i = 0; i < ticks; i++) {
    if (s.t < clickUntil) {
      clickAcc += profile.clicksPerSec * TICK_DT;
      while (clickAcc >= 1) {
        clickAcc -= 1;
        const weak = nextFloat(rng) < profile.weakRate;
        applyAction(s, { type: 'strike', weak, aimed: true, x: 0, y: 0 }, emit);
      }
    }
    if (i % buyTicks === 0) {
      for (let k = 0; k < 50; k++) {
        const a = cheapestBuy(s);
        if (!a) break;
        applyAction(s, a, emit);
      }
    }
    tick(s, TICK_DT, emit);
    const n = i + 1;
    if (n % Math.round(60 / TICK_DT) === 0) {
      r.sizeAtMinute.push(s.dragon.size);
      const tot = minuteClick + minuteArmy;
      r.clickShareByMinute.push(tot > 0 ? minuteClick / tot : 0);
      minuteClick = minuteArmy = 0;
    }
    if (cps.has(n)) r.killsAt[Math.round(n * TICK_DT)] = s.kills;
  }
  return r;
}
