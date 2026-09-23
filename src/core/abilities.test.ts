// M2: abilities (Charge!, Rally, Dragonbane Volley), ARCHITECTURE §14.
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE } from './content';
import { abilityCooldown, clickDamage, unitDamage, volleyAbilityDamage } from './formulas';
import * as sel from './selectors';
import { createInitialState } from './state';
import { inMountain, killAndNext, noop, ofType, recorder, runFor, runUntil, tank } from './testing/helpers';
import type { GameState } from './types';

/** In the Mountain, the dragon arrived and practically unkillable. */
function ready(seed = 1): GameState {
  const s = inMountain(seed);
  runUntil(s, () => s.dragon.phase !== 'enter');
  tank(s);
  return s;
}

describe('unlocks', () => {
  it('none in the Meadow; Charge! and Rally on arriving in the Mountain; the Volley at its 10th kill', () => {
    const m = createInitialState(1);
    for (const id of ['charge', 'rally', 'volley'] as const) {
      expect(sel.abilityVisible(m, id)).toBe(false);
      expect(sel.abilityReady(m, id)).toBe(false);
    }
    applyAction(m, { type: 'useAbility', id: 'charge' }, noop);
    expect(m.abilities.charge.cooldown).toBe(0);

    const s = inMountain(1);
    expect(sel.abilityReady(s, 'charge')).toBe(true);
    expect(sel.abilityReady(s, 'rally')).toBe(true);
    expect(sel.abilityVisible(s, 'volley')).toBe(false);
    const { events, emit } = recorder();
    const at = BALANCE.abilities.volley.unlock.at;
    for (let k = 0; k < at; k++) killAndNext(s, emit);
    expect(sel.abilityVisible(s, 'volley')).toBe(true);
    expect(ofType(events, 'unlock').filter((e) => e.kind === 'ability')).toEqual([{ type: 'unlock', kind: 'ability', id: 'volley' }]);
  });
});

describe('Charge!', () => {
  it('multiplies army damage while active; ends, then is ready again after its cooldown', () => {
    const s = ready(2);
    s.units.footman = 10;
    const { events, emit } = recorder();
    applyAction(s, { type: 'useAbility', id: 'charge' }, emit);
    const a = BALANCE.abilities.charge;
    expect(ofType(events, 'abilityUse')).toEqual([{ type: 'abilityUse', id: 'charge', dur: a.dur }]);
    expect(sel.abilityActive(s, 'charge')).toBe(true);
    expect(sel.abilityReady(s, 'charge')).toBe(false);
    expect(sel.abilityFrac(s, 'charge')).toBe(0);
    // Not while cooling down.
    applyAction(s, { type: 'useAbility', id: 'charge' }, emit);
    expect(ofType(events, 'abilityUse').length).toBe(1);
    runUntil(s, () => ofType(events, 'armyHit').length > 0 && s.dragon.phase !== 'stagger', emit);
    const hit = ofType(events, 'armyHit')[0]!;
    expect(hit.damage.toNumber()).toBeCloseTo(unitDamage(s, 'footman').mul(10 * BALANCE.abilities.chargeMult).toNumber(), 3);
    runFor(s, a.dur, emit);
    expect(ofType(events, 'abilityEnd')).toEqual([{ type: 'abilityEnd', id: 'charge' }]);
    expect(sel.abilityActive(s, 'charge')).toBe(false);
    expect(sel.abilityFrac(s, 'charge')).toBeGreaterThan(0);
    expect(sel.abilityFrac(s, 'charge')).toBeLessThan(1);
    runFor(s, a.cooldown - a.dur, emit);
    expect(ofType(events, 'abilityReady')).toEqual([{ type: 'abilityReady', id: 'charge' }]);
    expect(sel.abilityReady(s, 'charge')).toBe(true);
    expect(sel.abilityFrac(s, 'charge')).toBe(1);
  });

  it('Stag shortens the cooldown the ability starts', () => {
    const s = ready(3);
    s.heraldry.levels.stag = 2;
    applyAction(s, { type: 'useAbility', id: 'charge' }, noop);
    expect(s.abilities.charge.cooldown).toBeCloseTo(abilityCooldown(s, 'charge'), 9);
    expect(s.abilities.charge.cooldown).toBeLessThan(BALANCE.abilities.charge.cooldown);
  });
});

describe('Rally', () => {
  it('auto-strikes at rallyRate/s for its duration: plain click damage, never crits or staggers', () => {
    const s = ready(4);
    const strikes = s.stats.strikes;
    const { events, emit } = recorder();
    applyAction(s, { type: 'useAbility', id: 'rally' }, emit);
    runFor(s, BALANCE.abilities.rally.dur + 1, emit);
    const auto = ofType(events, 'strike').filter((e) => e.auto);
    expect(auto.length).toBe(Math.round(BALANCE.abilities.rally.dur * BALANCE.abilities.rallyRate));
    for (const e of auto) {
      expect(e.crit || e.weak || e.stagger || e.aimed).toBe(false);
      expect(e.damage.eq(clickDamage(s, false))).toBe(true);
    }
    expect(s.stats.strikes).toBe(strikes); // not the player's clicks
    expect(ofType(events, 'abilityEnd')).toEqual([{ type: 'abilityEnd', id: 'rally' }]);
  });
});

describe('Dragonbane Volley', () => {
  it('one huge volley (even with no archers), landing after its flight', () => {
    const s = ready(5);
    s.flags['ability.volley'] = true;
    const damage = volleyAbilityDamage(s);
    expect(damage.toNumber()).toBeCloseTo(clickDamage(s, false).toNumber() * BALANCE.abilities.volleyMinClicks * BALANCE.abilities.volleySeconds, 6);
    const { events, emit } = recorder();
    applyAction(s, { type: 'useAbility', id: 'volley' }, emit);
    const v = ofType(events, 'volley');
    expect(v).toEqual([{ type: 'volley', unit: 'archer', arrows: BALANCE.abilities.volleyArrows, flight: BALANCE.abilities.volleyFlight, ability: true }]);
    expect(ofType(events, 'abilityUse')).toEqual([{ type: 'abilityUse', id: 'volley', dur: 0 }]);
    runFor(s, BALANCE.abilities.volleyFlight + 0.1, emit);
    const hit = ofType(events, 'armyHit').filter((e) => e.ability);
    expect(hit.length).toBe(1);
    expect(hit[0]!.damage.toNumber()).toBeCloseTo(damage.toNumber() * (s.dragon.phase === 'stagger' ? 2 : 1), 6);
  });

  it('scales with the army: ~volleySeconds of army DPS', () => {
    const s = ready(6);
    s.units.archer = 50;
    s.units.footman = 50;
    expect(volleyAbilityDamage(s).toNumber()).toBeCloseTo(sel.armyDps(s).toNumber() * BALANCE.abilities.volleySeconds, 3);
  });
});

describe('holds and zooms', () => {
  it('a hold pauses actives and cooldowns; the switch resets them', () => {
    const s = createInitialState(7);
    s.flags['ability.charge'] = true;
    s.zoom.count = 1;
    applyAction(s, { type: 'useAbility', id: 'charge' }, noop);
    runFor(s, 2);
    const a = { ...s.abilities.charge };
    s.wyrm.cleared = true;
    applyAction(s, { type: 'zoom', stage: 'begin' }, noop);
    runFor(s, 5);
    expect(s.abilities.charge).toEqual(a);
    expect(sel.abilityReady(s, 'rally')).toBe(false); // nothing is ready during a hold
    applyAction(s, { type: 'zoom', stage: 'switch' }, noop);
    expect(s.abilities.charge).toEqual({ active: 0, cooldown: 0 });
  });
});
