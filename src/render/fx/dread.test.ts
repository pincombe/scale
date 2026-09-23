import { describe, expect, it } from 'vitest';
import {
  bossUrgency,
  HEART_DUB,
  HEART_PERIOD,
  HEART_PERIOD_URGENT,
  HEART_URGENT_FROM,
  heartPeriod,
  heartPulse,
  pushEnvelope,
  PUSH_DUR,
  tremorDuration,
  tremorEnvelope,
  tremorStrength,
} from './dread';
import { gradeDepth } from '../post';
import { MEADOW, MOUNTAIN } from '../palette';
import { TREMOR_EXP } from './tuning';

describe('dread curves', () => {
  it('tremors build with the gauge: barely there at 10%, unmistakable at 90%', () => {
    expect(tremorStrength(0)).toBe(0);
    expect(tremorStrength(0.1)).toBeLessThan(0.04);
    expect(tremorStrength(0.5)).toBeGreaterThan(0.2);
    expect(tremorStrength(0.5)).toBeLessThan(0.4);
    expect(tremorStrength(0.9)).toBeGreaterThan(0.75);
    expect(tremorStrength(1)).toBe(1);
    expect(tremorStrength(7)).toBe(1);
    let prev = -1;
    for (let g = 0; g <= 1; g += 0.05) {
      expect(tremorStrength(g)).toBeGreaterThanOrEqual(prev);
      prev = tremorStrength(g);
    }
    expect(tremorDuration(1)).toBeGreaterThan(tremorDuration(0.1));
  });

  it('the tremor envelope swells, then rolls off to nothing', () => {
    expect(tremorEnvelope(0)).toBe(0);
    expect(tremorEnvelope(1)).toBe(0);
    expect(tremorEnvelope(0.05)).toBeLessThan(tremorEnvelope(0.18));
    expect(tremorEnvelope(0.18)).toBeGreaterThan(0.7);
    expect(tremorEnvelope(0.9)).toBeLessThan(0.15);
    for (let u = 0; u <= 1; u += 0.01) {
      expect(tremorEnvelope(u)).toBeGreaterThanOrEqual(0);
      expect(tremorEnvelope(u)).toBeLessThanOrEqual(1);
    }
  });

  it('the heartbeat quickens only in the last seconds of the timer', () => {
    expect(bossUrgency(30)).toBe(0);
    expect(bossUrgency(HEART_URGENT_FROM + 0.1)).toBe(0);
    expect(bossUrgency(HEART_URGENT_FROM / 2)).toBeCloseTo(0.5);
    expect(bossUrgency(0.01)).toBeGreaterThan(0.99);
    expect(bossUrgency(0)).toBe(0); // no boss fighting
    expect(heartPeriod(0)).toBe(HEART_PERIOD);
    expect(heartPeriod(1)).toBeCloseTo(HEART_PERIOD_URGENT);
    expect(heartPeriod(0.5)).toBeLessThan(HEART_PERIOD);
    expect(heartPeriod(0.5)).toBeGreaterThan(HEART_PERIOD_URGENT);
    // The dub fits inside the fastest beat.
    expect(HEART_DUB + 0.15).toBeLessThan(HEART_PERIOD_URGENT);
  });

  it('a beat is a lub then a softer dub, and fades before the next', () => {
    expect(heartPulse(0)).toBe(0);
    expect(heartPulse(0.04)).toBeCloseTo(1);
    const dub = heartPulse(HEART_DUB + 0.035);
    expect(dub).toBeGreaterThan(0.45);
    expect(dub).toBeLessThan(0.8);
    expect(heartPulse(HEART_DUB - 0.005)).toBeLessThan(dub);
    expect(heartPulse(HEART_PERIOD_URGENT)).toBeLessThan(0.15);
    expect(heartPulse(HEART_PERIOD)).toBeLessThan(0.02);
  });

  it('the engage push snaps in, holds, and eases out', () => {
    expect(pushEnvelope(0)).toBe(0);
    expect(pushEnvelope(0.16)).toBeCloseTo(1);
    expect(pushEnvelope(0.3)).toBe(1);
    expect(pushEnvelope(PUSH_DUR - 0.01)).toBeLessThan(0.01);
    expect(pushEnvelope(PUSH_DUR + 1)).toBe(0);
  });

  it('the tremor curve is the one SFX reads from tuning.ts', () => {
    expect(tremorStrength(0.5)).toBeCloseTo(Math.pow(0.5, TREMOR_EXP));
  });

  it("the boss's grade goes full depth on the golden Meadow, lighter on the Mountain's dark dusk", () => {
    expect(gradeDepth(MEADOW)).toBe(1);
    expect(gradeDepth(MOUNTAIN)).toBeGreaterThanOrEqual(0.5);
    expect(gradeDepth(MOUNTAIN)).toBeLessThan(0.7);
  });
});
