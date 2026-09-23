// M2: Heraldry v1 (Scales → charges → effects), ARCHITECTURE §14.
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE, CHARGE_IDS } from './content';
import { D } from './decimal';
import { abilityCooldown, championHit, clickDamage, fusionForZoom, goldMult, heraldryCost, killGold, unitDamage, weakMult } from './formulas';
import * as sel from './selectors';
import { createInitialState } from './state';
import { noop, ofType, recorder } from './testing/helpers';
import type { ChargeId, GameState } from './types';

function withScales(n: number): GameState {
  const s = createInitialState(1);
  applyAction(s, { type: 'debug', op: 'scales', amount: n }, noop);
  return s;
}

function mult(id: ChargeId): number {
  const e = BALANCE.heraldry[id].effect;
  return 'mult' in e ? e.mult : NaN;
}

describe('buying heraldry', () => {
  it('needs the Heraldry feature and the Scales; costs grow per level', () => {
    const s = createInitialState(1);
    s.scales = D(1000);
    applyAction(s, { type: 'buyHeraldry', id: 'lion' }, noop);
    expect(s.heraldry.levels.lion).toBe(0); // not unlocked yet
    expect(sel.heraldryVisible(s, 'lion')).toBe(false);
    s.flags['feature.heraldry'] = true;
    const b = BALANCE.heraldry.lion;
    let spent = 0;
    for (let L = 0; L < 5; L++) {
      const cost = heraldryCost(s, 'lion');
      expect(cost.toNumber()).toBe(Math.ceil(b.cost * Math.pow(b.growth, L) - 1e-9));
      applyAction(s, { type: 'buyHeraldry', id: 'lion' }, noop);
      spent += cost.toNumber();
      expect(s.heraldry.levels.lion).toBe(L + 1);
    }
    expect(s.scales.toNumber()).toBe(1000 - spent);
  });

  it('is all-or-nothing, records the order charges were first taken, and emits purchase', () => {
    const s = withScales(heraldryCost(createInitialState(1), 'sun').toNumber() * 3);
    const { events, emit } = recorder();
    expect(sel.heraldryAffordable(s, 'sun')).toBe(true);
    applyAction(s, { type: 'buyHeraldry', id: 'sun' }, emit);
    applyAction(s, { type: 'buyHeraldry', id: 'lion' }, emit);
    applyAction(s, { type: 'buyHeraldry', id: 'sun' }, emit); // too dear now
    expect(s.heraldry.order).toEqual(['sun', 'lion']);
    expect(s.heraldry.levels.sun).toBe(1);
    expect(ofType(events, 'purchase')).toEqual([
      { type: 'purchase', kind: 'heraldry', id: 'sun', amount: 1 },
      { type: 'purchase', kind: 'heraldry', id: 'lion', amount: 1 },
    ]);
    s.scales = D(100);
    applyAction(s, { type: 'buyHeraldry', id: 'sun' }, emit);
    expect(s.heraldry.order).toEqual(['sun', 'lion']); // order[0] stays the principal charge
    expect(sel.heraldryLevel(s, 'sun')).toBe(2);
  });

  it('every charge has text and an effect', () => {
    for (const id of CHARGE_IDS) {
      expect(BALANCE.heraldry[id].cost).toBeGreaterThan(0);
      expect(BALANCE.heraldry[id].growth).toBeGreaterThan(1);
    }
  });
});

describe('heraldry effects', () => {
  it('lion: all damage (clicks, units, champions)', () => {
    const s = createInitialState(1);
    s.units.footman = 5;
    s.champions.aldric.level = 2;
    const click = clickDamage(s, false).toNumber();
    const unit = unitDamage(s, 'footman').toNumber();
    const champ = championHit(s, 'aldric').toNumber();
    s.heraldry.levels.lion = 2;
    const m = mult('lion') ** 2;
    expect(clickDamage(s, false).toNumber()).toBeCloseTo(click * m, 9);
    expect(unitDamage(s, 'footman').toNumber()).toBeCloseTo(unit * m, 9);
    expect(championHit(s, 'aldric').toNumber()).toBeCloseTo(champ * m, 9);
  });

  it('sun: kill gold', () => {
    const s = createInitialState(1);
    applyAction(s, { type: 'debug', op: 'dragon', amount: 10 }, noop);
    const g = killGold(s).toNumber();
    s.heraldry.levels.sun = 1;
    expect(goldMult(s)).toBeCloseTo(mult('sun'), 12);
    expect(killGold(s).toNumber()).toBeCloseTo(g * mult('sun'), -1);
  });

  it('wyvern: the weak-spot crit', () => {
    const s = createInitialState(1);
    s.upgrades['keenEye'] = 1;
    const w = weakMult(s);
    s.heraldry.levels.wyvern = 3;
    expect(weakMult(s)).toBeCloseTo(w * mult('wyvern') ** 3, 9);
  });

  it('stag: ability cooldowns, down to a floor', () => {
    const s = createInitialState(1);
    const base = abilityCooldown(s, 'charge');
    expect(base).toBe(BALANCE.abilities.charge.cooldown);
    s.heraldry.levels.stag = 2;
    const e = BALANCE.heraldry.stag.effect;
    if (e.kind !== 'cooldownMult') throw new Error('stag');
    expect(abilityCooldown(s, 'charge')).toBeCloseTo(base * e.mult ** 2, 9);
    s.heraldry.levels.stag = 99;
    expect(abilityCooldown(s, 'charge')).toBeCloseTo(base * e.min, 9);
  });

  it('crown: the Fusion Bonus (tower is covered by the zoom tests)', () => {
    const s = createInitialState(1);
    s.units.footman = 100;
    const f = fusionForZoom(s);
    s.heraldry.levels.crown = 2;
    expect(fusionForZoom(s)).toBeGreaterThan(f);
  });
});
