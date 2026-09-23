import { D } from './decimal';
import { BALANCE, PHASE, UNITS, UPGRADES } from './content';
import { makeDragon } from './dragon';
import { seedRng } from '../lib/rng';
import type { DragonState, GameState } from './types';

/** Save schema version. Bump it (and add a migration in M3) whenever GameState's shape changes. v4: M2 tiers, zoom, Scales, heraldry, abilities, champions. */
export const STATE_VERSION = 4;

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
    units: { footman: 0, archer: 0, lancer: 0 },
    upgrades,
    kills: 0,
    flags: {},
    stats: { strikes: 0, crits: 0, staggers: 0 },
    dragon: null as unknown as DragonState,
    height: BALANCE.tiers[0]!.baseHeight,
    scales: D(0),
    lifetimeScales: D(0),
    wyrm: { charge: 0, bossT: 0, bossDur: 0, escapes: 0, cleared: false, clearedAt: 0 },
    zoom: { stage: null, count: 0, fusion: 1, pending: null },
    heraldry: { levels: { lion: 0, sun: 0, wyvern: 0, stag: 0, tower: 0, crown: 0 }, order: [] },
    abilities: { charge: { active: 0, cooldown: 0 }, rally: { active: 0, cooldown: 0 }, volley: { active: 0, cooldown: 0 } },
    champions: {
      aldric: { level: 0, specialT: BALANCE.champions.aldric.specialEvery },
      brunhild: { level: 0, specialT: BALANCE.champions.brunhild.specialEvery },
    },
    nextDragonId: 1,
    army: { meleeT: UNITS.footman.interval, volleyT: UNITS.archer.interval, cavalryT: UNITS.lancer.interval, volleys: [] },
  };
  // The first newt is already standing in the meadow under the title (no entrance).
  state.dragon = makeDragon(state, 0, 'idle', PHASE.firstIdle);
  return state;
}
