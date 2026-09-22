// The army fights on its own in discrete, visible hits: footmen in melee beats, archers in
// volleys whose damage lands after a flight time. Never a silent continuous drain.
import { BALANCE, UNITS } from './content';
import type { Decimal } from './decimal';
import { damageDragon } from './dragon';
import { unitDamage, unitPeriod } from './formulas';
import type { DragonPhase, Emit, GameState } from './types';

/** Cap on the visual count reported in events (render shows at most this many blows/arrows). */
export const MAX_MELEE_HITS = 24;
export const MAX_VOLLEY_ARROWS = 40;

/** Footmen can't land blows while the dragon arrives, breathes, swipes (they're flung) or dies. */
function meleeAllowed(phase: DragonPhase): boolean {
  return phase === 'idle' || phase === 'windup' || phase === 'stagger';
}

/** A staggered dragon takes extra army damage (applied when the blow or volley lands). */
function staggerScaled(state: GameState, damage: Decimal): Decimal {
  return state.dragon.phase === 'stagger' ? damage.mul(BALANCE.stagger.armyMult) : damage;
}

export function updateArmy(state: GameState, dt: number, emit: Emit): void {
  const army = state.army;

  // Volleys in flight (before loosing new ones, so a new volley flies exactly `flight` s).
  const volleys = army.volleys;
  for (let i = 0; i < volleys.length; ) {
    const v = volleys[i]!;
    v.t -= dt;
    if (v.t > 1e-9) {
      i++;
      continue;
    }
    volleys.splice(i, 1);
    // Arrows that arrive after the killing blow land on the corpse (or the empty meadow, if its
    // target is gone): no damage, no event.
    if (v.target !== state.dragon.id || state.dragon.phase === 'dying') continue;
    const damage = staggerScaled(state, v.damage);
    emit({ type: 'armyHit', unit: v.unit, damage, hits: v.arrows });
    damageDragon(state, damage, emit);
  }

  // Footmen: one melee beat per period.
  army.meleeT -= dt;
  if (army.meleeT <= 0) {
    army.meleeT += unitPeriod(state, 'footman');
    const n = state.units.footman;
    if (n > 0 && meleeAllowed(state.dragon.phase)) {
      const damage = staggerScaled(state, unitDamage(state, 'footman').mul(n));
      emit({ type: 'armyHit', unit: 'footman', damage, hits: Math.min(n, MAX_MELEE_HITS) });
      damageDragon(state, damage, emit);
    }
  }

  // Archers: loose a volley; it lands `flight` seconds later.
  army.volleyT -= dt;
  if (army.volleyT <= 0) {
    army.volleyT += unitPeriod(state, 'archer');
    const n = state.units.archer;
    if (n > 0 && state.dragon.phase !== 'dying') {
      const arrows = Math.min(n, MAX_VOLLEY_ARROWS);
      const flight = UNITS.archer.flight;
      army.volleys.push({ unit: 'archer', target: state.dragon.id, t: flight, damage: unitDamage(state, 'archer').mul(n), arrows });
      emit({ type: 'volley', unit: 'archer', arrows, flight });
    }
  }
}
