import { describe, expect, it } from 'vitest';
import { TimeDirector } from './time';
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
