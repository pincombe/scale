// The army fights on its own in discrete, visible hits: footmen in melee beats, archers in
// volleys whose damage lands after a flight time, lancers (M2) in charges that land after their
// travel. Champions (M2) strike on the footmen's beat and land a special every few seconds. Never a
// silent continuous drain. Nothing here runs during a zoom's hold (tick skips it).
import { BALANCE, CHAMPION_IDS, UNITS } from './content';
import type { Decimal } from './decimal';
import { damageDragon, dragonHittable } from './dragon';
import { chargeMult, championHit, championSpecialDamage, unitDamage, unitPeriod } from './formulas';
import type { DragonPhase, Emit, GameState } from './types';

/** Cap on the visual count reported in events (render shows at most this many blows/arrows/riders). */
export const MAX_MELEE_HITS = 24;
export const MAX_VOLLEY_ARROWS = 40;
export const MAX_RIDERS = 16;

/** Footmen can't land blows while the dragon arrives, breathes, swipes (they're flung), dies or leaves. */
function meleeAllowed(phase: DragonPhase): boolean {
  return phase === 'idle' || phase === 'windup' || phase === 'stagger';
}

/** A staggered dragon takes extra army damage (applied when the blow or volley lands). */
function staggerScaled(state: GameState, damage: Decimal): Decimal {
  return state.dragon.phase === 'stagger' ? damage.mul(BALANCE.stagger.armyMult) : damage;
}

/** Army damage as it leaves the army: × Charge! while it's active. */
function charged(state: GameState, damage: Decimal): Decimal {
  const m = chargeMult(state);
  return m === 1 ? damage : damage.mul(m);
}

export function updateArmy(state: GameState, dt: number, emit: Emit): void {
  const army = state.army;

  // Volleys and charges in flight (before loosing new ones, so a new one flies exactly `flight` s).
  const volleys = army.volleys;
  for (let i = 0; i < volleys.length; ) {
    const v = volleys[i]!;
    v.t -= dt;
    if (v.t > 1e-9) {
      i++;
      continue;
    }
    volleys.splice(i, 1);
    // Arrows (or lances) that arrive after the killing blow land on the corpse (or the empty
    // meadow, if its target is gone or leaving): no damage, no event.
    if (v.target !== state.dragon.id || !dragonHittable(state.dragon.phase)) continue;
    const damage = staggerScaled(state, v.damage);
    if (v.ability) emit({ type: 'armyHit', unit: v.unit, damage, hits: v.arrows, ability: true });
    else emit({ type: 'armyHit', unit: v.unit, damage, hits: v.arrows });
    damageDragon(state, damage, emit);
  }

  // Footmen: one melee beat per period; the champions strike with it.
  army.meleeT -= dt;
  if (army.meleeT <= 0) {
    army.meleeT += unitPeriod(state, 'footman');
    if (meleeAllowed(state.dragon.phase)) {
      const n = state.units.footman;
      if (n > 0) {
        const damage = staggerScaled(state, charged(state, unitDamage(state, 'footman').mul(n)));
        emit({ type: 'armyHit', unit: 'footman', damage, hits: Math.min(n, MAX_MELEE_HITS) });
        damageDragon(state, damage, emit);
      }
      for (const id of CHAMPION_IDS) {
        if (state.champions[id].level <= 0 || !meleeAllowed(state.dragon.phase)) continue;
        const damage = staggerScaled(state, charged(state, championHit(state, id)));
        emit({ type: 'championHit', id, damage });
        damageDragon(state, damage, emit);
      }
    }
  }

  // Archers: loose a volley; it lands `flight` seconds later.
  army.volleyT -= dt;
  if (army.volleyT <= 0) {
    army.volleyT += unitPeriod(state, 'archer');
    const n = state.units.archer;
    if (n > 0 && dragonHittable(state.dragon.phase)) {
      const arrows = Math.min(n, MAX_VOLLEY_ARROWS);
      const flight = UNITS.archer.flight;
      army.volleys.push({ unit: 'archer', target: state.dragon.id, t: flight, damage: charged(state, unitDamage(state, 'archer').mul(n)), arrows });
      emit({ type: 'volley', unit: 'archer', arrows, flight });
    }
  }

  // Lancers: charge; the lances land `travel` (UNITS.lancer.flight) seconds later.
  army.cavalryT -= dt;
  if (army.cavalryT <= 0) {
    army.cavalryT += unitPeriod(state, 'lancer');
    const n = state.units.lancer;
    if (n > 0 && dragonHittable(state.dragon.phase)) {
      const riders = Math.min(n, MAX_RIDERS);
      const travel = UNITS.lancer.flight;
      army.volleys.push({ unit: 'lancer', target: state.dragon.id, t: travel, damage: charged(state, unitDamage(state, 'lancer').mul(n)), arrows: riders });
      emit({ type: 'cavalry', unit: 'lancer', riders, travel });
    }
  }

  updateSpecials(state, dt, emit);
}

/**
 * Champion specials: each joined champion's timer counts down; at 0 it lands its special as soon
 * as the dragon can be hit and isn't arriving (then the timer restarts).
 */
function updateSpecials(state: GameState, dt: number, emit: Emit): void {
  for (const id of CHAMPION_IDS) {
    const c = state.champions[id];
    if (c.level <= 0) continue;
    c.specialT = Math.max(0, c.specialT - dt);
    const phase = state.dragon.phase;
    if (c.specialT > 1e-9 || !dragonHittable(phase) || phase === 'enter') continue;
    c.specialT = BALANCE.champions[id].specialEvery;
    const damage = staggerScaled(state, charged(state, championSpecialDamage(state, id)));
    emit({ type: 'championSpecial', id, damage });
    damageDragon(state, damage, emit);
  }
}
