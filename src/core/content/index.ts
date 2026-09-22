// Content tables: the tunable numbers (./balance.ts) merged with player-facing text (./text.ts).
// Other folders read UNITS / UNIT_IDS / UPGRADES / UPGRADE_IDS / MILESTONES / PHASE from here.
// Getters read BALANCE live, so the sim can tweak BALANCE in-process between runs.
import type { UnitId, UpgradeId } from '../types';
import { BALANCE } from './balance';
import type { Requirement, UpgradeEffect } from './balance';
import { MICROCOPY, UNIT_TEXT, UPGRADE_TEXT, dragonName, sizeWord } from './text';

export { BALANCE, MICROCOPY, dragonName, sizeWord };
export type { Balance, Requirement, UnitBalance, UpgradeBalance, UpgradeEffect } from './balance';

export const UNIT_IDS: readonly UnitId[] = ['footman', 'archer'];

/** Display order in the Upgrades panel (roughly the order they unlock). */
export const UPGRADE_IDS: readonly UpgradeId[] = [
  'pointySwords',
  'keenEye',
  'drillSergeant',
  'bounty',
  'fletching',
  'warHorns',
  'heroicExample',
  'quickNock',
  'grindstone',
];

export interface UnitDef {
  readonly id: UnitId;
  readonly name: string;
  readonly plural: string;
  readonly flavor: string;
  /** 'melee' units hit in beats; 'ranged' units loose volleys with flight time. */
  readonly kind: 'melee' | 'ranged';
  readonly baseCost: number;
  readonly costGrowth: number;
  /** Damage per unit per beat/volley, before multipliers. */
  readonly damage: number;
  /** Base seconds between beats/volleys (quickNock shortens it: use formulas.unitPeriod). */
  readonly interval: number;
  /** Ranged only: arrow flight time in seconds. */
  readonly flight: number;
  /** When it appears. */
  readonly unlock: Requirement;
  /** Flag that reveals it (set by an 'unlock' event). */
  readonly unlockFlag: string;
}

function unitDef(id: UnitId, kind: 'melee' | 'ranged'): UnitDef {
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
};

export interface UpgradeDef {
  readonly id: UpgradeId;
  readonly name: string;
  readonly flavor: string;
  /** Gold (one-shot). */
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
    get cost() {
      return BALANCE.upgrades[id].cost;
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

/** Owned counts that multiply a unit type's damage by MILESTONE_MULT each. */
export const MILESTONES: readonly number[] = BALANCE.milestones.at;
export const MILESTONE_MULT = BALANCE.milestones.mult;

/** Phase timings in seconds (live view of BALANCE.phase). */
export const PHASE: Readonly<typeof BALANCE.phase> = BALANCE.phase;

/** Base weak-spot crit multiplier (keenEye raises it: use formulas.weakMult(state)). */
export const WEAK_MULT = BALANCE.click.weakMult;

/** Dragon species per tier (render keys the rig on it). */
export const TIER_SPECIES: readonly string[] = ['newt'];

export function speciesOf(tier: number): string {
  return TIER_SPECIES[Math.min(tier, TIER_SPECIES.length - 1)] ?? 'newt';
}
