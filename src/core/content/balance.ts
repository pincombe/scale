// BALANCE: every tunable economy number in one place. The balance sim (WP 1.9) tunes this file.
// Formulas that read it live in core/formulas.ts; content/index.ts merges it with text.ts.
// Units: seconds, meters, gold. Economy values are plain numbers here and become Decimals in
// formulas.ts (they are small; growth is what makes them huge).
import type { UnitId, UpgradeId } from '../types';

/** A progressive-disclosure condition: `stat` reaches `at`. */
export interface Requirement {
  stat: 'kills' | UnitId;
  at: number;
}

/** What an upgrade does. Kinds are fixed by design; magnitudes are tunable. */
export type UpgradeEffect =
  /** Click damage × mult (the whole strike: base and the heroicExample share). */
  | { kind: 'clickMult'; mult: number }
  /** One unit type's damage × mult. */
  | { kind: 'unitMult'; unit: UnitId; mult: number }
  /** Every unit's damage × mult. */
  | { kind: 'armyMult'; mult: number }
  /** The weak-spot crit multiplier becomes `value` (replaces the base ×5). */
  | { kind: 'weakMult'; value: number }
  /** Kill gold (and the stagger bonus, which is a share of it) × mult. */
  | { kind: 'goldMult'; mult: number }
  /** Each click also deals `share` × army DPS (before the weak-spot multiplier). */
  | { kind: 'clickArmyShare'; share: number }
  /** One unit type's beat/volley period × mult (0.7 = 30% faster). */
  | { kind: 'periodMult'; unit: UnitId; mult: number };

export interface UpgradeBalance {
  cost: number;
  unlock: Requirement;
  effect: UpgradeEffect;
}

export interface UnitBalance {
  baseCost: number;
  /** Cost × this per unit owned (1.07–1.15). */
  costGrowth: number;
  /** Damage per unit per beat/volley, before multipliers. */
  damage: number;
  /** Seconds between melee beats / volleys. */
  interval: number;
  /** Ranged: arrow flight time (s). 0 for melee. */
  flight: number;
  unlock: Requirement;
}

export interface Balance {
  dragon: {
    firstHp: number;
    firstGold: number;
    hpBase: number;
    hpGrowthEarly: number;
    hpGrowthLate: number;
    hpGrowthFade: number;
    goldPerHp: number;
    tierHpMult: number;
    tierGoldMult: number;
    sizeAnchors: [number, number][];
    sizeGrowthAfter: number;
  };
  click: { base: number; weakMult: number; armyShare: number };
  stagger: { armyMult: number; goldFrac: number; repeatGoldFrac: number };
  milestones: { at: number[]; every: number; mult: number };
  units: Record<UnitId, UnitBalance>;
  upgrades: Record<UpgradeId, UpgradeBalance>;
  phase: {
    enter: number;
    enterQuick: number;
    idleMin: number;
    idleMax: number;
    idleAfterEnter: number;
    firstIdle: number;
    windup: number;
    breath: number;
    swipe: number;
    stagger: number;
    dying: number;
    dyingQuick: number;
    quickSize: number;
    fullSize: number;
    breathChance: number;
  };
}

/**
 * Mutable on purpose: the balance sim may tweak values in-process between runs. The game never
 * writes to it. Formulas read it on every call, so a tweak applies immediately.
 */
export const BALANCE: Balance = {
  dragon: {
    /** The tutorial newt (dragon #0 of tier 0): dies in ~10 clicks and pays for the first footman. */
    firstHp: 10,
    firstGold: 10,
    /**
     * HP curve for dragons #1+ (and #0 of later tiers). Each dragon has `growth` × the previous
     * one's HP, where growth fades from hpGrowthEarly to hpGrowthLate over ~hpGrowthFade kills:
     * steep while clicks and first upgrades carry the player, steady once the army does.
     */
    hpBase: 12,
    hpGrowthEarly: 1.75,
    hpGrowthLate: 1.23,
    hpGrowthFade: 8,
    /** Kill gold = HP × goldPerHp (× goldMult upgrades). */
    goldPerHp: 1.2,
    /** Tier t multiplies HP and gold by these to the power t (placeholder until M2 tunes tiers). */
    tierHpMult: 1000,
    tierGoldMult: 1000,
    /**
     * Body length in meters by dragon index: log-linear between anchors [index, meters], then
     * × sizeGrowthAfter per dragon. A steady geometric climb from the 0.5 m newt, so the dragon
     * visibly grows from the first minute: engaged ~1.7 m at 1:00, ~4.5 m at 2:00, ~12 m at 3:00;
     * casual ~1 m at 1:00, ~2.5 m at 2:00.
     */
    sizeAnchors: [[0, 0.5]],
    sizeGrowthAfter: 1.12,
  },

  click: {
    /** Damage of a plain click before upgrades. */
    base: 1,
    /** Weak-spot crit multiplier (keenEye raises it). */
    weakMult: 5,
    /** Share of army DPS every click deals without upgrades (heroicExample adds to it). */
    armyShare: 0,
  },

  stagger: {
    /** Army damage × this while the dragon is staggered. */
    armyMult: 2,
    /** Gold bonus for the first stagger of a dragon = kill reward × this. */
    goldFrac: 0.5,
    /** Later staggers of the same dragon pay kill reward × this (so staggering stays a bonus, not the income). */
    repeatGoldFrac: 0.1,
  },

  /**
   * Owned counts that multiply a unit type's damage by `mult` each: the listed ones, then one
   * every `every` units forever (so the product is unbounded: formulas keep it in Decimal).
   */
  milestones: { at: [10, 25, 50, 100, 200, 300, 400, 500], every: 100, mult: 2 },

  units: {
    footman: { baseCost: 10, costGrowth: 1.12, damage: 1, interval: 1.0, flight: 0, unlock: { stat: 'kills', at: 1 } },
    archer: { baseCost: 300, costGrowth: 1.13, damage: 15, interval: 2.5, flight: 0.9, unlock: { stat: 'kills', at: 12 } },
  },

  /**
   * Tuned by the balance sim (juiced engaged player, median of 20 seeds, bought at): pointySwords
   * 0:06, keenEye 0:18, drillSergeant 0:34, bounty 0:48, fletching 1:12, heroicExample 1:17,
   * warHorns 1:52, quickNock 2:15, grindstone 2:48 (the last push before the boss). A casual
   * player (shops every 10 s, never saves) gets pointySwords ~0:16, heroicExample ~2:06 and
   * warHorns ~3:06. quickNock unlocks early (15 archers) so a casual player sees it by ~2:45. Most
   * unlock 10–30 s before they're affordable, so the panel usually has something to save for.
   */
  upgrades: {
    pointySwords: { cost: 25, unlock: { stat: 'footman', at: 1 }, effect: { kind: 'clickMult', mult: 2 } },
    keenEye: { cost: 100, unlock: { stat: 'kills', at: 3 }, effect: { kind: 'weakMult', value: 10 } },
    drillSergeant: { cost: 250, unlock: { stat: 'footman', at: 5 }, effect: { kind: 'unitMult', unit: 'footman', mult: 2 } },
    bounty: { cost: 600, unlock: { stat: 'kills', at: 6 }, effect: { kind: 'goldMult', mult: 1.5 } },
    fletching: { cost: 2500, unlock: { stat: 'archer', at: 3 }, effect: { kind: 'unitMult', unit: 'archer', mult: 2 } },
    warHorns: { cost: 15000, unlock: { stat: 'footman', at: 40 }, effect: { kind: 'armyMult', mult: 1.5 } },
    heroicExample: { cost: 3000, unlock: { stat: 'kills', at: 13 }, effect: { kind: 'clickArmyShare', share: 0.0175 } },
    quickNock: { cost: 40000, unlock: { stat: 'archer', at: 15 }, effect: { kind: 'periodMult', unit: 'archer', mult: 0.7 } },
    grindstone: { cost: 90000, unlock: { stat: 'kills', at: 27 }, effect: { kind: 'clickMult', mult: 3 } },
  },

  /** Dragon phase timings in seconds (the phase machine lives in core/dragon.ts). */
  phase: {
    /** Entrance of a big dragon (≥ fullSize m); small ones are quicker (enterQuick, see below). */
    enter: 1.6,
    /** Newts (≤ quickSize m) scuttle in this fast. */
    enterQuick: 1.0,
    idleMin: 3,
    idleMax: 6,
    /** A fresh dragon idles only this long after its entrance, so every dragon telegraphs an attack early. */
    idleAfterEnter: 1.0,
    /** The first newt idles this long under the title before its first windup. */
    firstIdle: 4,
    windup: 1.2,
    breath: 1.5,
    swipe: 0.9,
    stagger: 2.0,
    /** Death of a big dragon (≥ fullSize m): the roar, the fold, the burn. */
    dying: 1.6,
    /** Newts (≤ quickSize m) pop this fast, so the first minute moves. */
    dyingQuick: 1.1,
    /**
     * Enter and dying durations ease from the quick values at ≤ quickSize m to the full ones at
     * ≥ fullSize m, linear in log size (formulas.enterDuration / dyingDuration). The rig animates
     * both on normalized progress, so they just play faster.
     */
    quickSize: 0.6,
    fullSize: 4,
    /** Chance a windup leads to breath (else swipe). */
    breathChance: 0.6,
  },
};
