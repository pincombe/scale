import { D } from './decimal';
import { PHASE, UNITS, UPGRADES } from './content';
import { makeDragon } from './dragon';
import { seedRng } from '../lib/rng';
import type { DragonState, GameState } from './types';

/** Save schema version. Bump it (and add a migration in M3) whenever GameState's shape changes. */
export const STATE_VERSION = 3;

export function createInitialState(seed: number): GameState {
  const upgrades: Record<string, number> = {};
  for (const u of UPGRADES) upgrades[u.id] = 0;
  const state: GameState = {
    v: STATE_VERSION,
    seed: seed >>> 0,
    rng: seedRng(seed),
    t: 0,
    tier: 0,
    gold: D(0),
    lifetimeGold: D(0),
    units: { footman: 0, archer: 0 },
    upgrades,
    kills: 0,
    flags: {},
    stats: { strikes: 0, crits: 0, staggers: 0 },
    dragon: null as unknown as DragonState,
    nextDragonId: 1,
    army: { meleeT: UNITS.footman.interval, volleyT: UNITS.archer.interval, volleys: [] },
  };
  // The first newt is already standing in the meadow under the title (no entrance).
  state.dragon = makeDragon(state, 0, 'idle', PHASE.firstIdle);
  return state;
}
