// BALANCE: every tunable economy number in one place. The balance sim (WP 1.9, M2 pacing: WP 2.7)
// tunes this file: `npm run sim` checks the pacing it produces (src/sim/targets.ts).
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
  /** The tier's boss has dragon #bossAt's HP × this. */
  bossHp: number;
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
  /**
   * Damage is a share of the CURRENT dragon's max HP (bosses included), so a champion counts the
   * same in every tier and a blow never one-shots: a blow deals `blow[0]` of max HP at level 1,
   * rising to `blow[1]` at maxLevel; a special `special[0]` → `special[1]`. Between, the share
   * follows ((level-1)/(maxLevel-1))^levelCurve (front-loaded for levelCurve < 1).
   */
  blow: [number, number];
  special: [number, number];
  levelCurve: number;
  /** Levels stop here (the champion is mastered). */
  maxLevel: number;
  /** Gold (tier-0 scale) for level 2; each level costs `costGrowth` × the last. */
  baseCost: number;
  costGrowth: number;
  /** Seconds between special moves. */
  specialEvery: number;
}

export interface Balance {
  dragon: {
    firstHp: number;
    firstGold: number;
    arrivalHp: number;
    hpBase: number;
    hpGrowthEarly: number;
    hpGrowthLate: number;
    hpGrowthFade: number;
    goldPerHp: number;
    sizeAnchors: [number, number][];
    sizeGrowthAfter: number;
  };
  tiers: TierBalance[];
  boss: { goldMult: number; sizeMult: number; timer: number; escapeCharge: number; enter: number; dying: number };
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
     * Dragon #0 of every tier after the Meadow (the colossus's first opponent, right after the zoom)
     * has this share of its curve HP, so the colossus fells it in a few seconds (its gold stays on
     * the curve: the first purse rebuilds the army).
     */
    arrivalHp: 0.6,
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
   * Per tier (tiers past the table extrapolate each number geometrically from the last two). Tuned
   * by WP 2.7 (sim, 20 seeds, juiced, median):
   * - The Meadow's boss comes after 30 kills (engaged 3:06, just after the 3:00 size check); the
   *   Elder Newt has dragon #30's HP ×1.4: engaged fight 8.6 s (summon → kill, incl. its 2.6 s
   *   entrance), casual ~15 s; the first zoom begins at 3:19 (casual 4:57, worst 5:17).
   * - The Mountain: HP ×100, gold ×60, costs ×45, so what the player buys there is ~1.7× weaker
   *   against the dragons than in the Meadow, which the upgrades they keep, the Fusion Bonus,
   *   heraldry, abilities and champions make up for; its army upgrades (pikeWall, yewLongbows,
   *   couchedLances) are strong so the army rebuilds fast and matters (engaged: 20 units 51 s after
   *   the zoom; clicks 52% / army ~33% / champions 15% of the Mountain's damage). Dragon #0 is 1.8 m
   *   of world (a knight: 200 m on the display) and grows ×1.12 per dragon like the newts. Its gauge
   *   fills at 31 kills and Grimmaw has dragon #31's HP ×1.3 (about #30's ×1.6): engaged summons it
   *   at 7:14 and beats it at 7:27 in a 12 s fight; casual beats it at ~12:00, nonAimer ~11:20.
   * - Scales: the first zoom pays 6 (three first-level charges); the Mountain's zoom 24.
   * The boss fights are the tightest numbers here: an engaged fight ≥ 12 s and a slow player's
   * worst fight (every ability on cooldown) ≤ ~27 s (the 30 s dead-end check) leave ~1 s of room.
   */
  tiers: [
    { bossAt: 30, baseHeight: 1.8, hpMult: 1, goldMult: 1, costMult: 1, firstSize: 0.5, scales: 6, bossHp: 1.4 },
    { bossAt: 31, baseHeight: 200, hpMult: 100, goldMult: 60, costMult: 45, firstSize: 1.8, scales: 24, bossHp: 1.3 },
  ],

  /**
   * The tier's boss (the Wyrm Gauge's payoff). HP is the tier's dragon #bossAt's × the tier's
   * `bossHp`, gold its × goldMult, both fixed per tier; its size is the current dragon's × sizeMult.
   * It takes `enter` s to arrive and `dying` s to fall (grander than a dragon's 1.6 s; the first
   * zoom begins when the fall ends). The timer (s) runs only while it can be hit (not during the
   * entrance); on timeout the gauge drops back to escapeCharge × bossAt and the refill replays the
   * dragons leading up to the boss (the same indices), so a retry is never harder than the first
   * approach and the army has grown meanwhile: no dead end.
   */
  boss: { goldMult: 4, sizeMult: 1.5, timer: 30, escapeCharge: 0.75, enter: 2.6, dying: 3.0 },

  /**
   * The zoom's reward. Scales = the tier's `scales` × pushScales^(kills since the boss fell),
   * rounded down. Fusion Bonus = 1 + fusionPerSqrtUnit × √(units fused) × Crown; an engaged
   * player's ~120 units at the Elder Newt give ~×2.1. Height = the next tier's baseHeight ×
   * fusion^heightExp (×2.1 → 224 m).
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
   * volleySeconds × (army + champion) DPS (at least volleyMinClicks plain clicks/s' worth, so it
   * hits even with no army), landing volleyFlight s later. Charge and Rally unlock on arriving in
   * the Mountain, the Volley at its 10th kill (engaged 4:38). Charge! is a short, frequent ×3 (6 s
   * every 45 s) and the Volley 10 s of damage, so a boss fight isn't decided by whether a burst
   * happens to be ready when it arrives (a 10 s Charge! halved the fight when it lined up).
   */
  abilities: {
    charge: { dur: 6, cooldown: 45, unlock: { stat: 'kills', at: 0, tier: 1 } },
    rally: { dur: 8, cooldown: 75, unlock: { stat: 'kills', at: 0, tier: 1 } },
    volley: { dur: 0, cooldown: 90, unlock: { stat: 'kills', at: 10, tier: 1 } },
    chargeMult: 3,
    rallyRate: 8,
    volleySeconds: 10,
    volleyMinClicks: 5,
    volleyArrows: 60,
    volleyFlight: 1.1,
  },

  /**
   * Champions join by themselves (level 1, free) and persist through zooms. A blow lands on every
   * footman melee beat (with or without footmen) and a special every specialEvery s; both deal a
   * share of the current dragon's max HP (× stagger ×2 and Charge! ×3 when they land; the Fusion
   * Bonus and Lion don't apply). Aldric at level 1: blows 0.65%, specials 3.25%; mastered (level
   * 15): 1% and 5%. Brunhild hits rarely but hard: a 2.5% → 4% special every 15 s that visibly
   * chunks the HP bar, tiny blows. Share-of-HP damage helps slower players most (casual 11% of the
   * Meadow's damage after Aldric joins, 26% of the Mountain's; engaged 6% / 15%), which is what lets
   * a non-aiming player beat Grimmaw inside its timer. Levels cost gold (baseCost × tier costMult ×
   * costGrowth^(level-1)). Ser Aldric joins at the Meadow's 20th kill (~2:00 engaged), Dame
   * Brunhild at the Mountain's 12th (engaged 4:51).
   */
  champions: {
    aldric: { unlock: { stat: 'kills', at: 20, tier: 0 }, blow: [0.0065, 0.01], special: [0.0325, 0.05], levelCurve: 0.7, maxLevel: 15, baseCost: 6000, costGrowth: 1.3, specialEvery: 9 },
    brunhild: { unlock: { stat: 'kills', at: 12, tier: 1 }, blow: [0.0005, 0.0015], special: [0.025, 0.04], levelCurve: 0.7, maxLevel: 15, baseCost: 15000, costGrowth: 1.3, specialEvery: 15 },
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
   * warHorns 1:42, quickNock 2:13, grindstone 2:50 (the last push before the boss). A casual
   * player (shops every 10 s, never saves) gets pointySwords ~0:16, heroicExample ~2:06 and
   * warHorns ~2:51 (unlocked at 25 footmen, so it lands before the boss). quickNock unlocks early
   * (15 archers) so a casual player sees it by ~2:45. Most unlock 10–30 s before they're
   * affordable, so the panel usually has something to save for. heroicExample's share is
   * multiplied by every click upgrade and the weak-spot crit, so it sets how much clicks outweigh
   * the army once the army is big (engaged: clicks 47% of the Meadow's damage, 52% of the
   * Mountain's).
   * The Mountain's set (engaged, bought at): highForge 4:00 (a modest ×1.25: the Meadow's ×6 click
   * chain already came along), pikeWall 4:19, yewLongbows 4:52, mountainTithe 5:02, couchedLances
   * 5:32, destriers 5:37; lancers unlock at 4:10 and the first is hired at ~5:15.
   */
  upgrades: {
    pointySwords: { cost: 25, unlock: { stat: 'footman', at: 1 }, effect: { kind: 'clickMult', mult: 2 } },
    keenEye: { cost: 100, unlock: { stat: 'kills', at: 3 }, effect: { kind: 'weakMult', value: 10 } },
    drillSergeant: { cost: 250, unlock: { stat: 'footman', at: 5 }, effect: { kind: 'unitMult', unit: 'footman', mult: 2 } },
    bounty: { cost: 600, unlock: { stat: 'kills', at: 6 }, effect: { kind: 'goldMult', mult: 1.5 } },
    fletching: { cost: 2500, unlock: { stat: 'archer', at: 3 }, effect: { kind: 'unitMult', unit: 'archer', mult: 2 } },
    warHorns: { cost: 10000, unlock: { stat: 'footman', at: 25 }, effect: { kind: 'armyMult', mult: 1.5 } },
    heroicExample: { cost: 3000, unlock: { stat: 'kills', at: 13 }, effect: { kind: 'clickArmyShare', share: 0.015 } },
    quickNock: { cost: 40000, unlock: { stat: 'archer', at: 15 }, effect: { kind: 'periodMult', unit: 'archer', mult: 0.7 } },
    grindstone: { cost: 90000, unlock: { stat: 'kills', at: 27 }, effect: { kind: 'clickMult', mult: 3 } },
    // The Mountain's set (tier 1 only; costs in tier-0 gold, × the tier's costMult = 45).
    highForge: { cost: 300, unlock: { stat: 'kills', at: 1, tier: 1 }, effect: { kind: 'clickMult', mult: 1.25 } },
    pikeWall: { cost: 800, unlock: { stat: 'kills', at: 3, tier: 1 }, effect: { kind: 'unitMult', unit: 'footman', mult: 4 } },
    yewLongbows: { cost: 3000, unlock: { stat: 'archer', at: 5, tier: 1 }, effect: { kind: 'unitMult', unit: 'archer', mult: 4 } },
    mountainTithe: { cost: 5000, unlock: { stat: 'kills', at: 8, tier: 1 }, effect: { kind: 'goldMult', mult: 2 } },
    couchedLances: { cost: 8000, unlock: { stat: 'lancer', at: 3, tier: 1 }, effect: { kind: 'unitMult', unit: 'lancer', mult: 3 } },
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
