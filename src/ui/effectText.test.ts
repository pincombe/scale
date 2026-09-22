import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../core';
import { effectLine, roman, times } from './effectText';

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
