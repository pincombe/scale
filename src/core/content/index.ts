// Placeholder content tables (WP 0.2): the numbers. Player-facing strings live in ./text.ts
// (the writer's file). The economy WP (1.5) replaces these values; the shapes other folders read
// are UnitDef / UpgradeDef / UNIT_IDS / PHASE.
import type { UnitId } from '../types';
import { DRAGON_EPITHETS, DRAGON_NAMES, UNIT_TEXT, UPGRADE_TEXT } from './text';

export { DRAGON_EPITHETS, DRAGON_NAMES };

export const UNIT_IDS: readonly UnitId[] = ['footman', 'archer'];

export interface UnitDef {
  id: UnitId;
  name: string;
  plural: string;
  /** 'melee' units hit in beats; 'ranged' units loose volleys with flight time. */
  kind: 'melee' | 'ranged';
  baseCost: number;
  costGrowth: number;
  /** Damage per unit per beat/volley, before multipliers. */
  damage: number;
  /** Seconds between beats/volleys. */
  interval: number;
  /** Ranged only: arrow flight time in seconds. */
  flight: number;
  /** Flag that reveals it (set by an 'unlock' event). */
  unlockFlag: string;
}

export const UNITS: Record<UnitId, UnitDef> = {
  footman: {
    id: 'footman',
    ...UNIT_TEXT.footman,
    kind: 'melee',
    baseCost: 10,
    costGrowth: 1.12,
    damage: 1,
    interval: 1.0,
    flight: 0,
    unlockFlag: 'unit.footman',
  },
  archer: {
    id: 'archer',
    ...UNIT_TEXT.archer,
    kind: 'ranged',
    baseCost: 60,
    costGrowth: 1.13,
    damage: 4,
    interval: 2.5,
    flight: 1.1,
    unlockFlag: 'unit.archer',
  },
};

export interface UpgradeDef {
  id: string;
  name: string;
  flavor: string;
  cost: number;
  /** Which damage it multiplies. */
  target: 'strike' | UnitId;
  mult: number;
}

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'pointySwords',
    ...UPGRADE_TEXT.pointySwords!,
    cost: 60,
    target: 'footman',
    mult: 2,
  },
  {
    id: 'whetstone',
    ...UPGRADE_TEXT.whetstone!,
    cost: 120,
    target: 'strike',
    mult: 2,
  },
  {
    id: 'fletching',
    ...UPGRADE_TEXT.fletching!,
    cost: 400,
    target: 'archer',
    mult: 2,
  },
];

/** Owned counts that double a unit's damage. */
export const MILESTONES: readonly number[] = [10, 25, 50, 100, 200, 300, 400, 500];

/** Phase timings in seconds. */
export const PHASE = {
  enter: 1.6,
  idleMin: 3,
  idleMax: 6,
  firstIdle: 4,
  windup: 1.2,
  breath: 1.5,
  swipe: 0.9,
  stagger: 1.4,
  dying: 1.6,
  /** Chance a windup leads to breath (else swipe). */
  breathChance: 0.6,
} as const;

export const WEAK_MULT = 5;
