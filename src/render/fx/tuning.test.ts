import { describe, expect, it } from 'vitest';
import { D } from '../../core/decimal';
import { CRIT_HEAT_MAX, coinCount, coinDelay, coinShares, critDamp, damageFrac, heatAfterCrit, hitTrauma, sharesTotal } from './tuning';

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

  it('crit heat damps a spree but not an isolated crit', () => {
    expect(critDamp(0)).toBe(1);
    let h = 0;
    for (let i = 0; i < 20; i++) h = heatAfterCrit(h);
    expect(h).toBe(CRIT_HEAT_MAX);
    expect(critDamp(h)).toBeLessThan(0.35);
    expect(critDamp(h)).toBeGreaterThan(0.2);
  });

  it('coin shares sum exactly to the reward', () => {
    for (const [g, n] of [[10, 12], [5, 8], [1, 8], [1234567, 33], ['1e45', 40], ['7.77e123', 17]] as const) {
      const total = D(g);
      const s = coinShares(total, n);
      expect(s.count).toBeGreaterThanOrEqual(1);
      expect(s.count).toBeLessThanOrEqual(n);
      // Exact below 2^53; beyond that Decimal mantissas are floats, so compare relatively.
      if (total.lt(2 ** 53)) {
        expect(sharesTotal(s).eq(total)).toBe(true);
        expect(s.last.gte(s.each)).toBe(true);
      } else expect(sharesTotal(s).sub(total).abs().div(total).toNumber()).toBeLessThan(1e-9);
    }
    expect(coinShares(D(5), 8).count).toBe(5);
    expect(coinShares(D(0.5), 8).count).toBe(1);
  });
});
