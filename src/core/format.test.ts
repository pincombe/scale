import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { fmt } from './format';

describe('fmt', () => {
  it('prints small numbers plainly, integers without decimals', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(7)).toBe('7');
    expect(fmt(999)).toBe('999');
    expect(fmt(-42)).toBe('-42');
    expect(fmt(12.5)).toBe('12.5');
    expect(fmt(1.25)).toBe('1.25');
    expect(fmt(0.5)).toBe('0.5');
    expect(fmt(3.0001)).toBe('3');
    expect(fmt(123.4)).toBe('123');
    expect(fmt(0.001)).toBe('0');
  });

  it('uses three significant digits with suffixes from 1,000', () => {
    expect(fmt(1000)).toBe('1.00K');
    expect(fmt(1234)).toBe('1.23K');
    expect(fmt(12345)).toBe('12.3K');
    expect(fmt(123456)).toBe('123K');
    expect(fmt(45.6e6)).toBe('45.6M');
    expect(fmt(789e9)).toBe('789B');
    expect(fmt(1e12)).toBe('1.00T');
    expect(fmt(2.5e15)).toBe('2.50Qa');
    expect(fmt(1e18)).toBe('1.00Qi');
    expect(fmt(1e21)).toBe('1.00Sx');
    expect(fmt(1e24)).toBe('1.00Sp');
    expect(fmt(1e27)).toBe('1.00Oc');
    expect(fmt(1e30)).toBe('1.00No');
    expect(fmt(1e33)).toBe('1.00Dc');
    expect(fmt(-1234)).toBe('-1.23K');
  });

  it('rounds across group boundaries', () => {
    expect(fmt(999.7)).toBe('1.00K');
    expect(fmt(999_499)).toBe('999K');
    expect(fmt(999_500)).toBe('1.00M');
    expect(fmt(999.6e33)).toBe('1.00e36');
  });

  it('switches to scientific at 1e36', () => {
    expect(fmt(1e36)).toBe('1.00e36');
    expect(fmt(new Decimal('1.234e45'))).toBe('1.23e45');
    expect(fmt(new Decimal('9.999e99'))).toBe('1.00e100');
    expect(fmt(new Decimal('1e500'))).toBe('1.00e500');
    expect(fmt(new Decimal('-5e40'))).toBe('-5.00e40');
  });

  it('formats Decimals like numbers below the scientific range', () => {
    expect(fmt(new Decimal(5))).toBe('5');
    expect(fmt(new Decimal(12.5))).toBe('12.5');
    expect(fmt(new Decimal(116))).toBe('116');
    expect(fmt(new Decimal(999.7))).toBe('1.00K');
    expect(fmt(new Decimal(45.6e6))).toBe('45.6M');
    expect(fmt(new Decimal('1e33'))).toBe('1.00Dc');
    expect(fmt(new Decimal(0))).toBe('0');
  });

  it('supports scientific notation everywhere above 1,000', () => {
    expect(fmt(1234, 'scientific')).toBe('1.23e3');
    expect(fmt(999, 'scientific')).toBe('999');
    expect(fmt(new Decimal('4.56e7'), 'scientific')).toBe('4.56e7');
  });

  it('handles non-finite numbers', () => {
    expect(fmt(Infinity)).toBe('∞');
    expect(fmt(NaN)).toBe('NaN');
  });
});
