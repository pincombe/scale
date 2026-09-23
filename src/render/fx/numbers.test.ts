import { describe, expect, it } from 'vitest';
import { D } from '../../core/decimal';
import { fmtWhole } from './numbers';

describe('floating number text', () => {
  it('shows whole numbers below 1,000 (no "8.09" in the Mountain)', () => {
    expect(fmtWhole(D(8.09))).toBe('8');
    expect(fmtWhole(D(4.6))).toBe('5');
    expect(fmtWhole(D(30.4))).toBe('30');
    expect(fmtWhole(D(999.4))).toBe('999');
    expect(fmtWhole(D(12))).toBe('12');
    expect(fmtWhole(D(0.3))).toBe('1');
    expect(fmtWhole(D(0))).toBe('0');
  });

  it('keeps fmt() suffixes from 1,000 up', () => {
    expect(fmtWhole(D(999.6))).toBe('1.00K');
    expect(fmtWhole(D(45600))).toBe('45.6K');
    expect(fmtWhole(D('1e40'))).toMatch(/e/);
  });
});
