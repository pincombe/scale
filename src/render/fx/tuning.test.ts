import { describe, expect, it } from 'vitest';
import { D } from '../../core/decimal';
import { coinCount, coinDelay, damageFrac, hitTrauma } from './tuning';

describe('fx tuning', () => {
  it('damageFrac clamps and survives huge and zero values', () => {
    expect(damageFrac(D(5), D(10))).toBeCloseTo(0.5);
    expect(damageFrac(D(50), D(10))).toBe(1);
    expect(damageFrac(D(5), D(0))).toBe(0);
    expect(damageFrac(D('1e500'), D('1e400'))).toBe(1);
    expect(damageFrac(D('1e300'), D('1e500'))).toBeCloseTo(0);
  });

  it('shake grows with damage and ranks army < click < crit < kill', () => {
    expect(hitTrauma(0, 'army')).toBeLessThan(hitTrauma(0, 'click'));
    expect(hitTrauma(0, 'click')).toBeLessThan(hitTrauma(0, 'crit'));
    expect(hitTrauma(1, 'crit')).toBeLessThanOrEqual(hitTrauma(1, 'kill') + 0.05);
    expect(hitTrauma(0.5, 'army')).toBeGreaterThan(hitTrauma(0, 'army'));
    for (const k of ['army', 'click', 'crit', 'kill'] as const) expect(hitTrauma(5, k)).toBeLessThanOrEqual(1);
  });

  it('coin count scales with the reward and caps at 40', () => {
    expect(coinCount(D(1))).toBe(8);
    expect(coinCount(D(100))).toBeGreaterThan(coinCount(D(5)));
    expect(coinCount(D('1e30'))).toBe(40);
    expect(coinCount(D('1e5000'))).toBe(40);
  });

  it('coin delays are ordered and leave time to land within ~1.4 s', () => {
    const n = 40;
    let prev = -1;
    for (let j = 0; j < n; j++) {
      const d = coinDelay(j, n);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
    expect(coinDelay(0, n)).toBeGreaterThanOrEqual(0.15);
    expect(coinDelay(n - 1, n)).toBeLessThanOrEqual(0.65);
    expect(coinDelay(0, 1)).toBeCloseTo(0.16);
  });
});
