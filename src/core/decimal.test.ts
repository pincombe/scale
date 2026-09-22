import Decimal from 'break_infinity.js';
import { describe, expect, it } from 'vitest';

describe('break_infinity.js smoke test', () => {
  it('does basic arithmetic', () => {
    const a = new Decimal(1500);
    expect(a.add(500).toNumber()).toBe(2000);
    expect(a.mul(2).toNumber()).toBe(3000);
    expect(a.div(3).toNumber()).toBe(500);
  });

  it('handles values beyond double range', () => {
    const huge = new Decimal('1e500').mul('1e500');
    expect(huge.exponent).toBe(1000);
    expect(huge.mantissa).toBeCloseTo(1);
    expect(huge.gt(Number.MAX_VALUE)).toBe(true);
  });
});
