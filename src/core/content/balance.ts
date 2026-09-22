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
  /** Click damage (the base part) × mult. */
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
  stagger: { armyMult: number; goldFrac: number };
  milestones: { at: number[]; every: number; mult: number };
  units: Record<UnitId, UnitBalance>;
  upgrades: Record<UpgradeId, UpgradeBalance>;
  phase: {
    enter: number;
    idleMin: number;
    idleMax: number;
    firstIdle: number;
    windup: number;
    breath: number;
    swipe: number;
    stagger: number;
    dying: number;
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
    hpBase: 20,
    hpGrowthEarly: 1.8,
    hpGrowthLate: 1.25,
    hpGrowthFade: 8,
    /** Kill gold = HP × goldPerHp (× goldMult upgrades). */
    goldPerHp: 1,
    /** Tier t multiplies HP and gold by these to the power t (placeholder until M2 tunes tiers). */
    tierHpMult: 1000,
    tierGoldMult: 1000,
    /**
     * Body length in meters by dragon index: log-linear between anchors [index, meters], then
     * × sizeGrowthAfter per dragon. Newt 0.5 m → dog ~1 m (~1:00) → horse ~2.5 m (~2:00) →
     * barn ~10 m (~3:00) for an engaged player.
     */
    sizeAnchors: [
      [0, 0.5],
      [10, 1],
      [19, 2.5],
      [27, 10],
    ],
    sizeGrowthAfter: 1.17,
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
    /** Gold bonus = kill reward × this. */
    goldFrac: 0.5,
  },

  /**
   * Owned counts that multiply a unit type's damage by `mult` each: the listed ones, then one
   * every `every` units forever (so the product is unbounded: formulas keep it in Decimal).
   */
  milestones: { at: [10, 25, 50, 100, 200, 300, 400, 500], every: 100, mult: 2 },

  units: {
    footman: { baseCost: 10, costGrowth: 1.12, damage: 1, interval: 1.0, flight: 0, unlock: { stat: 'kills', at: 1 } },
    archer: { baseCost: 300, costGrowth: 1.13, damage: 15, interval: 2.5, flight: 0.9, unlock: { stat: 'kills', at: 10 } },
  },

  upgrades: {
    pointySwords: { cost: 25, unlock: { stat: 'footman', at: 1 }, effect: { kind: 'clickMult', mult: 2 } },
    keenEye: { cost: 100, unlock: { stat: 'kills', at: 3 }, effect: { kind: 'weakMult', value: 10 } },
    drillSergeant: { cost: 250, unlock: { stat: 'footman', at: 5 }, effect: { kind: 'unitMult', unit: 'footman', mult: 2 } },
    bounty: { cost: 600, unlock: { stat: 'kills', at: 6 }, effect: { kind: 'goldMult', mult: 1.5 } },
    fletching: { cost: 2500, unlock: { stat: 'archer', at: 3 }, effect: { kind: 'unitMult', unit: 'archer', mult: 2 } },
    warHorns: { cost: 3000, unlock: { stat: 'footman', at: 20 }, effect: { kind: 'armyMult', mult: 1.5 } },
    heroicExample: { cost: 6000, unlock: { stat: 'kills', at: 13 }, effect: { kind: 'clickArmyShare', share: 0.05 } },
    quickNock: { cost: 40000, unlock: { stat: 'archer', at: 15 }, effect: { kind: 'periodMult', unit: 'archer', mult: 0.7 } },
    grindstone: { cost: 100000, unlock: { stat: 'kills', at: 22 }, effect: { kind: 'clickMult', mult: 3 } },
  },

  /** Dragon phase timings in seconds (the phase machine lives in core/dragon.ts). */
  phase: {
    enter: 1.6,
    idleMin: 3,
    idleMax: 6,
    /** The first newt idles this long under the title before its first windup. */
    firstIdle: 4,
    windup: 1.2,
    breath: 1.5,
    swipe: 0.9,
    stagger: 2.0,
    dying: 1.6,
    /** Chance a windup leads to breath (else swipe). */
    breathChance: 0.6,
  },
};
