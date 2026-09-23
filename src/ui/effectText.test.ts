import { describe, expect, it } from 'vitest';
import { CHARGES, CHARGE_IDS, UPGRADES } from '../core';
import { effectLine, heightText, heraldryEffectLine, heraldryTotal, roman, template, times } from './effectText';

describe('effectLine', () => {
  it('writes a line for every upgrade from its data', () => {
    for (const u of UPGRADES) {
      const line = effectLine(u.effect);
      expect(line.length).toBeGreaterThan(5);
      expect(line).not.toMatch(/undefined|NaN/);
    }
  });

  it('formats each effect kind', () => {
    expect(effectLine({ kind: 'clickMult', mult: 2 })).toBe('Click damage ×2');
    expect(effectLine({ kind: 'unitMult', unit: 'footman', mult: 2 })).toBe('Footman damage ×2');
    expect(effectLine({ kind: 'armyMult', mult: 1.5 })).toBe('All army damage ×1.5');
    expect(effectLine({ kind: 'weakMult', value: 10 })).toBe('Weak-spot crits deal ×10');
    expect(effectLine({ kind: 'clickArmyShare', share: 0.05 })).toBe('Each click adds 5% of army DPS');
    expect(effectLine({ kind: 'periodMult', unit: 'archer', mult: 0.7 })).toMatch(/43% faster$/);
  });

  it('rounds multipliers', () => {
    expect(times(1.2345)).toBe('×1.23');
  });

  it('writes roman numerals', () => {
    expect([1, 2, 4, 9, 10, 14].map(roman)).toEqual(['I', 'II', 'IV', 'IX', 'X', 'XIV']);
  });
});

describe('heraldry lines', () => {
  it('writes a line for every charge from its data', () => {
    for (const id of CHARGE_IDS) {
      const line = heraldryEffectLine(CHARGES[id].effect);
      expect(line.length).toBeGreaterThan(8);
      expect(line).not.toMatch(/undefined|NaN/);
      expect(heraldryTotal(CHARGES[id].effect, 0)).toBe('');
      expect(heraldryTotal(CHARGES[id].effect, 3)).not.toMatch(/undefined|NaN/);
    }
  });

  it('formats each effect kind and its total', () => {
    expect(heraldryEffectLine({ kind: 'damageMult', mult: 1.5 })).toBe('All damage ×1.5 per level');
    expect(heraldryTotal({ kind: 'damageMult', mult: 1.5 }, 2)).toBe('×2.25');
    expect(heraldryEffectLine({ kind: 'cooldownMult', mult: 0.85, min: 0.4 })).toBe('Ability cooldowns −15% per level');
    expect(heraldryTotal({ kind: 'cooldownMult', mult: 0.85, min: 0.4 }, 2)).toBe('−27.8%');
    // The floor holds: never below 40% of the base.
    expect(heraldryTotal({ kind: 'cooldownMult', mult: 0.85, min: 0.4 }, 20)).toBe('−60%');
    expect(heraldryEffectLine({ kind: 'startUnits', unit: 'footman', count: 5 })).toMatch(/^\+5 Footmen at the start/);
    expect(heraldryTotal({ kind: 'startUnits', unit: 'footman', count: 5 }, 2)).toBe('+10 Footmen');
    expect(heraldryTotal({ kind: 'fusionBonus', add: 0.5 }, 3)).toBe('+150%');
  });
});

describe('text helpers', () => {
  it('fills templates and keeps unknown slots', () => {
    expect(template('__missing__', 'Press {key}: {name}', { key: '1', name: 'Charge!' })).toBe('Press 1: Charge!');
    expect(template('__missing__', '{a} {b}', { a: 'x' })).toBe('x {b}');
  });

  it('writes heights with 3 significant digits', () => {
    expect(heightText(1.8)).toBe('1.8 m');
    expect(heightText(224)).toBe('224 m');
    expect(heightText(221.4)).toBe('221 m');
    expect(heightText(4360)).toBe('4.36 km');
    expect(heightText(12345678)).toBe('12,300 km');
    expect(heightText(0)).toBe('—');
  });
});
