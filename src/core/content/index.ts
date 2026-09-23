// Content tables: the tunable numbers (./balance.ts) merged with player-facing text (./text.ts).
// Other folders read UNITS / UNIT_IDS / UPGRADE_IDS / UPGRADES / PHASE from here (milestone and
// weak-spot numbers: read BALANCE live, or formulas.milestoneAt / weakMult).
// Getters read BALANCE live, so the sim can tweak BALANCE in-process between runs.
import type { AbilityId, ChampionId, ChargeId, UnitId, UpgradeId } from '../types';
import { BALANCE } from './balance';
import type { HeraldryEffect, Requirement, UpgradeEffect } from './balance';
import {
  ABILITY_TEXT,
  BOSS_TEXT,
  CHAMPION_TEXT,
  CHARGE_TEXT,
  MICROCOPY,
  TIER_TEXT,
  UNIT_TEXT,
  UPGRADE_TEXT,
  dragonName,
  heightWord,
  sizeWord,
} from './text';
import { tierNumber } from './tiers';

export { BALANCE, MICROCOPY, dragonName, sizeWord, heightWord, TIER_TEXT, BOSS_TEXT, CHAMPION_TEXT, CHARGE_TEXT, ABILITY_TEXT };
export { KNIGHT_M, TIERS, lastTier, speciesOf, tierNumber, tierOf, type TierDef } from './tiers';
export type {
  AbilityBalance,
  Balance,
  ChampionBalance,
  ChargeBalance,
  HeraldryEffect,
  Requirement,
  TierBalance,
  UnitBalance,
  UpgradeBalance,
  UpgradeEffect,
} from './balance';

/** Every unit type, in panel order (lancers appear in the Mountain). */
export const UNIT_IDS: readonly UnitId[] = ['footman', 'archer', 'lancer'];

/** Display order in the Upgrades panel (roughly the order they unlock). */
export const UPGRADE_IDS: readonly UpgradeId[] = [
  'pointySwords',
  'keenEye',
  'drillSergeant',
  'bounty',
  'fletching',
  'heroicExample',
  'warHorns',
  'quickNock',
  'grindstone',
  'highForge',
  'pikeWall',
  'yewLongbows',
  'mountainTithe',
  'couchedLances',
  'destriers',
];

export interface UnitDef {
  readonly id: UnitId;
  readonly name: string;
  readonly plural: string;
  readonly flavor: string;
  /**
   * 'melee' units hit in beats; 'ranged' units loose volleys with flight time; 'cavalry' (lancers)
   * charge every interval and land `flight` s later (the charge's travel).
   */
  readonly kind: 'melee' | 'ranged' | 'cavalry';
  readonly baseCost: number;
  readonly costGrowth: number;
  /** Damage per unit per beat/volley, before multipliers. */
  readonly damage: number;
  /** Base seconds between beats/volleys (quickNock shortens it: use formulas.unitPeriod). */
  readonly interval: number;
  /** Ranged: arrow flight time in seconds; cavalry: the charge's travel time. */
  readonly flight: number;
  /** When it appears. */
  readonly unlock: Requirement;
  /** Flag that reveals it (set by an 'unlock' event). */
  readonly unlockFlag: string;
}

function unitDef(id: UnitId, kind: UnitDef['kind']): UnitDef {
  const b = (): (typeof BALANCE.units)[UnitId] => BALANCE.units[id];
  return {
    id,
    kind,
    unlockFlag: 'unit.' + id,
    get name() {
      return UNIT_TEXT[id].name;
    },
    get plural() {
      return UNIT_TEXT[id].plural;
    },
    get flavor() {
      return UNIT_TEXT[id].flavor;
    },
    get baseCost() {
      return b().baseCost;
    },
    get costGrowth() {
      return b().costGrowth;
    },
    get damage() {
      return b().damage;
    },
    get interval() {
      return b().interval;
    },
    get flight() {
      return b().flight;
    },
    get unlock() {
      return b().unlock;
    },
  };
}

export const UNITS: Record<UnitId, UnitDef> = {
  footman: unitDef('footman', 'melee'),
  archer: unitDef('archer', 'ranged'),
  lancer: unitDef('lancer', 'cavalry'),
};

export interface UpgradeDef {
  readonly id: UpgradeId;
  readonly name: string;
  readonly flavor: string;
  /** The tier whose set it belongs to (its unlock's minimum tier; 0 for the Meadow's). */
  readonly tier: number;
  /** Gold (one-shot), already in its tier's gold (BALANCE cost × the tier's costMult). */
  readonly cost: number;
  /** When it appears in the panel. */
  readonly unlock: Requirement;
  /** What it does (the UI writes the effect line from this). */
  readonly effect: UpgradeEffect;
  /** Flag that reveals it: 'upgrade.<id>'. */
  readonly unlockFlag: string;
}

function upgradeDef(id: UpgradeId): UpgradeDef {
  return {
    id,
    unlockFlag: 'upgrade.' + id,
    get name() {
      return UPGRADE_TEXT[id].name;
    },
    get flavor() {
      return UPGRADE_TEXT[id].flavor;
    },
    get tier() {
      return BALANCE.upgrades[id].unlock.tier ?? 0;
    },
    get cost() {
      const b = BALANCE.upgrades[id];
      const mult = tierNumber(b.unlock.tier ?? 0, 'costMult');
      return mult === 1 ? b.cost : Math.ceil(b.cost * mult - 1e-9);
    },
    get unlock() {
      return BALANCE.upgrades[id].unlock;
    },
    get effect() {
      return BALANCE.upgrades[id].effect;
    },
  };
}

export const UPGRADES: readonly UpgradeDef[] = UPGRADE_IDS.map(upgradeDef);

const UPGRADE_BY_ID = new Map<string, UpgradeDef>(UPGRADES.map((u) => [u.id, u]));

/** The upgrade with this id, or undefined for unknown ids. */
export function upgradeDefOf(id: string): UpgradeDef | undefined {
  return UPGRADE_BY_ID.get(id);
}

/** Phase timings in seconds (live view of BALANCE.phase). */
export const PHASE: Readonly<typeof BALANCE.phase> = BALANCE.phase;

// ---- M2: heraldry, abilities, champions ----

/** Heraldic charges in panel order. */
export const CHARGE_IDS: readonly ChargeId[] = ['lion', 'sun', 'wyvern', 'stag', 'tower', 'crown'];

export interface ChargeDef {
  readonly id: ChargeId;
  readonly name: string;
  readonly flavor: string;
  /** Scales for level 1 and the growth per level (use sel.heraldryCost for the live price). */
  readonly cost: number;
  readonly growth: number;
  /** What each level does (the UI writes the effect line from it). */
  readonly effect: HeraldryEffect;
}

function chargeDef(id: ChargeId): ChargeDef {
  return {
    id,
    get name() {
      return CHARGE_TEXT[id].name;
    },
    get flavor() {
      return CHARGE_TEXT[id].flavor;
    },
    get cost() {
      return BALANCE.heraldry[id].cost;
    },
    get growth() {
      return BALANCE.heraldry[id].growth;
    },
    get effect() {
      return BALANCE.heraldry[id].effect;
    },
  };
}

export const CHARGES: Record<ChargeId, ChargeDef> = {
  lion: chargeDef('lion'),
  sun: chargeDef('sun'),
  wyvern: chargeDef('wyvern'),
  stag: chargeDef('stag'),
  tower: chargeDef('tower'),
  crown: chargeDef('crown'),
};

/** Abilities in hotkey order (keys 1-3). */
export const ABILITY_IDS: readonly AbilityId[] = ['charge', 'rally', 'volley'];

export interface AbilityDef {
  readonly id: AbilityId;
  readonly name: string;
  readonly flavor: string;
  /** Hotkey (1-3). */
  readonly key: number;
  /** Seconds of effect (0 = one-shot). */
  readonly dur: number;
  /** Base cooldown (s); sel.abilityCooldown applies Stag. */
  readonly cooldown: number;
  readonly unlock: Requirement;
  /** 'ability.<id>'. */
  readonly unlockFlag: string;
}

function abilityDef(id: AbilityId, key: number): AbilityDef {
  return {
    id,
    key,
    unlockFlag: 'ability.' + id,
    get name() {
      return ABILITY_TEXT[id].name;
    },
    get flavor() {
      return ABILITY_TEXT[id].flavor;
    },
    get dur() {
      return BALANCE.abilities[id].dur;
    },
    get cooldown() {
      return BALANCE.abilities[id].cooldown;
    },
    get unlock() {
      return BALANCE.abilities[id].unlock;
    },
  };
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  charge: abilityDef('charge', 1),
  rally: abilityDef('rally', 2),
  volley: abilityDef('volley', 3),
};

/** Champions in the order they join. */
export const CHAMPION_IDS: readonly ChampionId[] = ['aldric', 'brunhild'];

export interface ChampionDef {
  readonly id: ChampionId;
  readonly name: string;
  /** Joined to the name like an epithet: a leading ',' attaches with no space. */
  readonly title: string;
  /** The special move's name ("Heroic Lunge"). */
  readonly special: string;
  readonly unlock: Requirement;
  /** 'champion.<id>'. */
  readonly unlockFlag: string;
}

function championDef(id: ChampionId): ChampionDef {
  return {
    id,
    unlockFlag: 'champion.' + id,
    get name() {
      return CHAMPION_TEXT[id].name;
    },
    get title() {
      return CHAMPION_TEXT[id].title;
    },
    get special() {
      return CHAMPION_TEXT[id].special;
    },
    get unlock() {
      return BALANCE.champions[id].unlock;
    },
  };
}

export const CHAMPIONS: Record<ChampionId, ChampionDef> = {
  aldric: championDef('aldric'),
  brunhild: championDef('brunhild'),
};
