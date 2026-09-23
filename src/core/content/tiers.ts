// The tiers (PLAN §3.3): one magnitude of scale each. TIERS gives each tier's ids (species, boss,
// the units and champion it introduces); the numbers live in BALANCE.tiers (read live, so the sim
// can tune them). M2 has two tiers: 0 the Meadow and 1 the Mountain. Zooming past the last one is
// refused (sel.canZoom).
import type { ChampionId, UnitId } from '../types';
import { BALANCE } from './balance';
import type { TierBalance } from './balance';

/** A knight's height in world meters, in every tier (render/world.ts KNIGHT_HEIGHT agrees). */
export const KNIGHT_M = 1.8;

export interface TierDef {
  readonly id: number;
  /** Dragon species key (render keys the rig on it; it falls back to the newt until a species lands). */
  readonly species: string;
  /** Boss id (BOSS_TEXT key; `dragon.boss` while it fights). */
  readonly boss: string;
  /** The units this tier introduces (they stay available in every tier after). */
  readonly units: readonly UnitId[];
  /** The champion who joins in this tier. */
  readonly champion: ChampionId;
  /** Ordinary kills that fill the Wyrm Gauge. */
  readonly bossAt: number;
  /** Knight height when you arrive (display m), before the Fusion Bonus. */
  readonly baseHeight: number;
}

function tierDef(id: number, species: string, boss: string, units: UnitId[], champion: ChampionId): TierDef {
  return {
    id,
    species,
    boss,
    units,
    champion,
    get bossAt() {
      return BALANCE.tiers[id]!.bossAt;
    },
    get baseHeight() {
      return BALANCE.tiers[id]!.baseHeight;
    },
  };
}

export const TIERS: readonly TierDef[] = [
  tierDef(0, 'newt', 'elderNewt', ['footman', 'archer'], 'aldric'),
  tierDef(1, 'wyvern', 'grimmaw', ['lancer'], 'brunhild'),
];

/** The tier's def, clamped to the table (debug jumps past the last tier reuse the last one's ids). */
export function tierOf(tier: number): TierDef {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.floor(tier)))]!;
}

/** Dragon species of a tier ('newt', 'wyvern'). */
export function speciesOf(tier: number): string {
  return tierOf(tier).species;
}

/** The last tier of this build (M2: the Mountain). */
export function lastTier(): number {
  return TIERS.length - 1;
}

/**
 * A per-tier number from BALANCE.tiers; past the table it extrapolates geometrically from the last
 * two rows (so debug jumps and later builds get sane values).
 */
export function tierNumber(tier: number, key: keyof TierBalance): number {
  const rows = BALANCE.tiers;
  const t = Math.max(0, Math.floor(tier));
  if (t < rows.length) return rows[t]![key];
  const last = rows[rows.length - 1]![key];
  const prev = rows.length > 1 ? rows[rows.length - 2]![key] : last;
  const ratio = prev > 0 ? last / prev : 1;
  return last * Math.pow(ratio, t - (rows.length - 1));
}
