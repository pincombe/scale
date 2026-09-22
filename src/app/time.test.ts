import { describe, expect, it } from 'vitest';
import { HIT_STOP_COOLDOWN, HIT_STOP_MAX, TimeDirector } from './time';
import { TICK_DT } from '../core';

const F = 1 / 60;

function run(t: TimeDirector, seconds: number): number {
  let scaled = 0;
  for (let i = 0; i < Math.round(seconds / F); i++) {
    t.update(F);
    scaled += t.dt;
  }
  return scaled;
}

describe('TimeDirector', () => {
  it('passes real time through at scale 1 and applies the debug scale', () => {
    const t = new TimeDirector();
    expect(run(t, 1)).toBeCloseTo(1, 6);
    t.debugScale = 4;
    expect(run(t, 1)).toBeCloseTo(4, 6);
    expect(t.realTime).toBeCloseTo(2, 6);
  });

  it('hitStop freezes for its wall-clock duration, max-merged', () => {
    const t = new TimeDirector();
    t.hitStop(0.1);
    t.hitStop(0.05); // shorter: ignored
    expect(t.frozen).toBe(true);
    expect(run(t, 0.1)).toBe(0);
    t.update(F);
    expect(t.dt).toBeCloseTo(F, 9);
  });

  it('caps a single hitStop at HIT_STOP_MAX', () => {
    const t = new TimeDirector();
    t.hitStop(1);
    expect(run(t, HIT_STOP_MAX - F / 2)).toBe(0);
    run(t, F);
    t.update(F);
    expect(t.dt).toBeCloseTo(F, 9);
  });

  it('ignores a hitStop requested within the cooldown of the last one', () => {
    const t = new TimeDirector();
    t.hitStop(0.05);
    run(t, 0.1); // freeze over, but still inside the cooldown
    t.hitStop(0.05);
    expect(t.frozen).toBe(false);
    run(t, HIT_STOP_COOLDOWN); // cooldown elapsed
    t.hitStop(0.05);
    expect(t.frozen).toBe(true);
  });

  it('crit spam freezes at most HIT_STOP_MAX per cooldown window', () => {
    const t = new TimeDirector();
    let scaled = 0;
    for (let i = 0; i < 60 * 10; i++) {
      t.hitStop(1); // every frame
      t.update(F);
      scaled += t.dt;
    }
    expect(scaled / t.realTime).toBeGreaterThan(1 - HIT_STOP_MAX / HIT_STOP_COOLDOWN - 0.05);
    expect(t.dilation).toBeCloseTo(scaled / t.realTime, 6);
  });

  it('dilation is 1 when idle and ignores the debug scale', () => {
    const t = new TimeDirector();
    t.debugScale = 3;
    run(t, 40);
    expect(t.dilation).toBeCloseTo(1, 9);
  });

  it('slowMo starts slow and eases back to 1 over its duration', () => {
    const t = new TimeDirector();
    t.slowMo(0.25, 1);
    t.update(F);
    expect(t.scale).toBeCloseTo(0.25, 2);
    run(t, 0.5);
    expect(t.scale).toBeGreaterThan(0.25);
    expect(t.scale).toBeLessThan(1);
    run(t, 0.6);
    expect(t.scale).toBe(1);
  });

  it('an overlapping gentler slowMo does not cancel a stronger one', () => {
    const t = new TimeDirector();
    t.slowMo(0.2, 1);
    t.update(F);
    t.slowMo(0.8, 2);
    t.update(F);
    expect(t.scale).toBeLessThan(0.3);
  });

  it('pause stops time; step advances exactly one logic tick', () => {
    const t = new TimeDirector();
    t.paused = true;
    expect(run(t, 0.5)).toBe(0);
    t.step();
    t.update(F);
    expect(t.dt).toBeCloseTo(TICK_DT, 9);
    t.update(F);
    expect(t.dt).toBe(0);
  });
});
