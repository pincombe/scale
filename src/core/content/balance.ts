// BALANCE: every tunable economy number in one place. The balance sim (WP 1.9) tunes this file.
// Formulas that read it live in core/formulas.ts; content/index.ts merges it with text.ts.
// Units: seconds, meters, gold. Economy values are plain numbers here and become Decimals in
// formulas.ts (they are small; growth is what makes them huge).
import type { AbilityId, ChampionId, ChargeId, UnitId, UpgradeId } from '../types';

/**
 * A progressive-disclosure condition: `stat` reaches `at` (kills count in the current tier), and
 * (M2) the player is in tier `tier` or later (so the Mountain's lancers and upgrades stay hidden in
 * the Meadow).
 */
export interface Requirement {
  stat: 'kills' | UnitId;
  at: number;
  tier?: number;
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
  /** In tier-0 gold: tier t multiplies it by tierCostMult(t). */
  baseCost: number;
  /** Cost × this per unit owned (1.07–1.15). */
  costGrowth: number;
  /** Damage per unit per beat/volley, before multipliers. */
  damage: number;
  /** Seconds between melee beats / volleys / charges. */
  interval: number;
  /** Ranged: arrow flight time (s); cavalry: the charge's travel time (s). 0 for melee. */
  flight: number;
  unlock: Requirement;
}

/** Per-tier numbers (TIERS in content/tiers.ts adds the ids and text). */
export interface TierBalance {
  /** Ordinary kills that fill the Wyrm Gauge (the boss comes next). */
  bossAt: number;
  /** Knight height in display m when you arrive (before the Fusion Bonus stretches it). */
  baseHeight: number;
  /** Dragon HP / kill gold × this (vs tier 0). */
  hpMult: number;
  goldMult: number;
  /** Unit, upgrade and champion-level costs × this. */
  costMult: number;
  /** World length (m) of the tier's dragon #0; later ones grow like the Meadow's. */
  firstSize: number;
  /** Scales the zoom out of this tier pays, before pushing past the boss. */
  scales: number;
}

/** What one level of a heraldic charge does (UI writes the effect line from this). */
export type HeraldryEffect =
  /** All damage × mult per level (compounding). */
  | { kind: 'damageMult'; mult: number }
  /** Kill and stagger gold × mult per level. */
  | { kind: 'goldMult'; mult: number }
  /** The weak-spot crit multiplier × mult per level. */
  | { kind: 'weakMult'; mult: number }
  /** Ability cooldowns × mult per level, never below `min` of the base. */
  | { kind: 'cooldownMult'; mult: number; min: number }
  /** Start every tier with `count` × level of this unit (granted at the zoom's switch). */
  | { kind: 'startUnits'; unit: UnitId; count: number }
  /** The Fusion Bonus's growth × (1 + add × level). */
  | { kind: 'fusionBonus'; add: number };

export interface ChargeBalance {
  /** Scales for the first level; each level costs `growth` × the last (rounded up). */
  cost: number;
  growth: number;
  effect: HeraldryEffect;
}

export interface AbilityBalance {
  /** Seconds of effect (0 for the one-shot volley). */
  dur: number;
  /** Seconds from use until ready again (Stag heraldry shortens it). */
  cooldown: number;
  /** When the ability unlocks. */
  unlock: Requirement;
}

export interface ChampionBalance {
  /** Joins by itself (free, level 1) when this is met. */
  unlock: Requirement;
  /** Damage of one blow per level (tier-0 scale), before multipliers. */
  damage: number;
  /** Blow damage × 2 every this many levels. */
  doubleEvery: number;
  /** Gold (tier-0 scale) for level 2; each level costs `costGrowth` × the last. */
  baseCost: number;
  costGrowth: number;
  /** Seconds between special moves; a special hits for `specialMult` × a blow. */
  specialEvery: number;
  specialMult: number;
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
    sizeAnchors: [number, number][];
    sizeGrowthAfter: number;
  };
  tiers: TierBalance[];
  boss: { hpMult: number; goldMult: number; sizeMult: number; timer: number; escapeCharge: number };
  zoom: { pushScales: number; fusionPerSqrtUnit: number; heightExp: number };
  heraldry: Record<ChargeId, ChargeBalance>;
  abilities: Record<AbilityId, AbilityBalance> & {
    chargeMult: number;
    rallyRate: number;
    volleySeconds: number;
    volleyMinClicks: number;
    volleyArrows: number;
    volleyFlight: number;
  };
  champions: Record<ChampionId, ChampionBalance>;
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
    /**
     * Body length in meters by dragon index: log-linear between anchors [index, meters], then
     * × sizeGrowthAfter per dragon. A steady geometric climb from the 0.5 m newt, so the dragon
     * visibly grows from the first minute: engaged ~1.7 m at 1:00, ~4.5 m at 2:00, ~12 m at 3:00;
     * casual ~1 m at 1:00, ~2.5 m at 2:00.
     */
    sizeAnchors: [[0, 0.5]],
    sizeGrowthAfter: 1.12,
  },

  /**
   * Per tier (tiers past the table extrapolate each number geometrically from the last two). WP 2.0
   * first values, tuned by WP 2.7:
   * - The Meadow's boss comes after 30 kills (engaged ~3:05, just after the 3:00 size check).
   * - The Mountain is the Meadow scaled: HP ×150, gold and costs ×60, so what the player buys
   *   there is 2.5× weaker against the dragons than in the Meadow, which the upgrades they keep, the
   *   Fusion Bonus, heraldry, abilities and champions make up for. Its dragon #0 is 1.8 m of world
   *   (a knight's height: 200 m on the display) and grows ×1.12 per dragon like the newts.
   * - Scales: the first zoom pays 6 (three first-level charges); the Mountain's zoom 24.
   */
  tiers: [
    { bossAt: 30, baseHeight: 1.8, hpMult: 1, goldMult: 1, costMult: 1, firstSize: 0.5, scales: 6 },
    { bossAt: 30, baseHeight: 200, hpMult: 150, goldMult: 60, costMult: 60, firstSize: 1.8, scales: 24 },
  ],

  /**
   * The tier's boss (the Wyrm Gauge's payoff). HP and gold are those of the tier's dragon #bossAt ×
   * these, fixed per tier (a boss that escaped comes back no tougher, so the grown army wins: no
   * dead end); its size is the current dragon's × sizeMult. The timer (s) runs only while it can be
   * hit; on timeout the gauge drops back to escapeCharge × bossAt.
   */
  boss: { hpMult: 2, goldMult: 4, sizeMult: 1.5, timer: 30, escapeCharge: 0.75 },

  /**
   * The zoom's reward. Scales = the tier's `scales` × pushScales^(kills since the boss fell),
   * rounded down. Fusion Bonus = 1 + fusionPerSqrtUnit × √(units fused) × Crown; an engaged
   * player's ~90 units at the Elder Newt give ~×1.9. Height = the next tier's baseHeight ×
   * fusion^heightExp (×1.9 → 220 m).
   */
  zoom: { pushScales: 1.15, fusionPerSqrtUnit: 0.1, heightExp: 0.15 },

  /** Heraldry v1 (Scales): costs 2, 4, 7, 12, 21... per charge; effects compound per level. */
  heraldry: {
    lion: { cost: 2, growth: 1.8, effect: { kind: 'damageMult', mult: 1.5 } },
    sun: { cost: 2, growth: 1.8, effect: { kind: 'goldMult', mult: 1.5 } },
    wyvern: { cost: 2, growth: 1.8, effect: { kind: 'weakMult', mult: 1.25 } },
    stag: { cost: 2, growth: 1.8, effect: { kind: 'cooldownMult', mult: 0.85, min: 0.4 } },
    tower: { cost: 2, growth: 1.8, effect: { kind: 'startUnits', unit: 'footman', count: 5 } },
    crown: { cost: 2, growth: 1.8, effect: { kind: 'fusionBonus', add: 0.5 } },
  },

  /**
   * Abilities (keys 1-3). Charge!: army and champion damage × chargeMult for `dur` s. Rally:
   * rallyRate auto-strikes/s at plain click damage for `dur` s. Dragonbane Volley: one volley of
   * volleySeconds × army DPS (at least volleyMinClicks plain clicks/s' worth, so it hits even with
   * no army), landing volleyFlight s later. Charge and Rally unlock on arriving in the Mountain,
   * the Volley at its 10th kill.
   */
  abilities: {
    charge: { dur: 10, cooldown: 60, unlock: { stat: 'kills', at: 0, tier: 1 } },
    rally: { dur: 8, cooldown: 75, unlock: { stat: 'kills', at: 0, tier: 1 } },
    volley: { dur: 0, cooldown: 120, unlock: { stat: 'kills', at: 10, tier: 1 } },
    chargeMult: 3,
    rallyRate: 8,
    volleySeconds: 25,
    volleyMinClicks: 5,
    volleyArrows: 60,
    volleyFlight: 1.1,
  },

  /**
   * Champions join by themselves (level 1, free) and persist through zooms. A blow lands on every
   * footman melee beat (with or without footmen); damage = damage × level × 2^⌊level/doubleEvery⌋ ×
   * all-damage multipliers (like a unit's, not scaled by tier). Levels cost gold (baseCost × tier
   * costMult × costGrowth^(level-1)). Ser Aldric joins at the Meadow's 20th kill (~2:00 engaged),
   * Dame Brunhild at the Mountain's 12th.
   */
  champions: {
    aldric: { unlock: { stat: 'kills', at: 20, tier: 0 }, damage: 40, doubleEvery: 10, baseCost: 6000, costGrowth: 1.22, specialEvery: 9, specialMult: 8 },
    brunhild: { unlock: { stat: 'kills', at: 12, tier: 1 }, damage: 100, doubleEvery: 10, baseCost: 15000, costGrowth: 1.22, specialEvery: 8, specialMult: 10 },
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
    /** The Mountain's cavalry: charges every 5 s, the lances land 1.2 s later. Tier 1+, 6th kill. */
    lancer: { baseCost: 1500, costGrowth: 1.14, damage: 240, interval: 5, flight: 1.2, unlock: { stat: 'kills', at: 6, tier: 1 } },
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
    // The Mountain's set (tier 1 only; costs in tier-0 gold, × the tier's costMult = 60).
    highForge: { cost: 300, unlock: { stat: 'kills', at: 1, tier: 1 }, effect: { kind: 'clickMult', mult: 3 } },
    pikeWall: { cost: 800, unlock: { stat: 'kills', at: 3, tier: 1 }, effect: { kind: 'unitMult', unit: 'footman', mult: 3 } },
    yewLongbows: { cost: 3000, unlock: { stat: 'archer', at: 5, tier: 1 }, effect: { kind: 'unitMult', unit: 'archer', mult: 3 } },
    mountainTithe: { cost: 5000, unlock: { stat: 'kills', at: 8, tier: 1 }, effect: { kind: 'goldMult', mult: 2 } },
    couchedLances: { cost: 8000, unlock: { stat: 'lancer', at: 3, tier: 1 }, effect: { kind: 'unitMult', unit: 'lancer', mult: 2 } },
    destriers: { cost: 40000, unlock: { stat: 'lancer', at: 10, tier: 1 }, effect: { kind: 'periodMult', unit: 'lancer', mult: 0.7 } },
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
