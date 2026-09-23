// Abilities (M2, keys 1-3): Charge! (army and champion damage × chargeMult for a while), Rally
// (auto-strikes at plain click damage for a while), Dragonbane Volley (one huge volley). Ready when
// unlocked (flag 'ability.<id>'), off cooldown and not in a zoom's hold. The cooldown starts at use
// and runs alongside the effect. Holds pause everything here (tick skips it); a zoom's switch
// resets actives and cooldowns.
import { BALANCE } from './content';
import { damageDragon, dragonHittable } from './dragon';
import { abilityCooldown, clickDamage, volleyAbilityDamage } from './formulas';
import type { AbilityId, Emit, GameState } from './types';

/** Unlocked, off cooldown, and no zoom holding. */
export function abilityReady(state: GameState, id: AbilityId): boolean {
  return !!state.flags['ability.' + id] && state.abilities[id].cooldown <= 0 && state.zoom.stage === null;
}

export function useAbility(state: GameState, id: AbilityId, emit: Emit): void {
  if (!abilityReady(state, id)) return;
  const a = state.abilities[id];
  const b = BALANCE.abilities;
  a.cooldown = abilityCooldown(state, id);
  a.active = b[id].dur;
  emit({ type: 'abilityUse', id, dur: a.active });
  if (id === 'volley') {
    const arrows = b.volleyArrows;
    const flight = b.volleyFlight;
    state.army.volleys.push({ unit: 'archer', target: state.dragon.id, t: flight, damage: volleyAbilityDamage(state), arrows, ability: true });
    emit({ type: 'volley', unit: 'archer', arrows, flight, ability: true });
  }
}

/** Rally strikes due over the effect's life at `rate`/s once `left` s remain (counted from its start). */
function rallyStrikesAt(left: number): number {
  const b = BALANCE.abilities;
  return Math.floor((b.rally.dur - left) * b.rallyRate + 1e-6);
}

export function updateAbilities(state: GameState, dt: number, emit: Emit): void {
  const ids = Object.keys(state.abilities) as AbilityId[];
  for (const id of ids) {
    const a = state.abilities[id];
    if (a.active > 0) {
      const before = a.active;
      a.active = Math.max(0, a.active - dt);
      if (id === 'rally') rally(state, rallyStrikesAt(a.active) - rallyStrikesAt(before), emit);
      if (a.active <= 1e-9) {
        a.active = 0;
        emit({ type: 'abilityEnd', id });
      }
    }
    if (a.cooldown > 0) {
      a.cooldown = Math.max(0, a.cooldown - dt);
      if (a.cooldown <= 1e-9) {
        a.cooldown = 0;
        emit({ type: 'abilityReady', id });
      }
    }
  }
}

/**
 * Rally's auto-strikes: plain click damage (never crits or staggers), `strike` events with
 * auto: true, aimed: false and x = y = 0 (render picks an impact point). Not counted in stats
 * (those are the player's clicks). Skipped while the dragon can't be hit.
 */
function rally(state: GameState, n: number, emit: Emit): void {
  for (let i = 0; i < n; i++) {
    if (!dragonHittable(state.dragon.phase)) return;
    const damage = clickDamage(state, false);
    emit({ type: 'strike', damage, crit: false, weak: false, stagger: false, aimed: false, x: 0, y: 0, auto: true });
    damageDragon(state, damage, emit);
  }
}
