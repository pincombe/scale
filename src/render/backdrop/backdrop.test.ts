import { describe, expect, it } from 'vitest';
import { eyePose, EYE_DURATION, type EyePose } from './eyeTimeline';
import { breeze, gust, wind } from './wind';
import { MOUNTAINS } from './ridges';

// The eye's schedule is tested in eyeTimeline.test.ts (WP 2.2).

describe('eye pose', () => {
  const p: EyePose = { open: 0, look: 0, pupil: 0, glow: 0, awake: 0 };

  it('is shut outside an opening', () => {
    expect(eyePose(-1, p).open).toBe(0);
    expect(eyePose(0, p).open).toBe(0);
    expect(eyePose(EYE_DURATION + 0.1, p).open).toBe(0);
  });

  it('cracks open, opens wide, blinks, looks at the fight, and closes', () => {
    const crack = eyePose(1.2, p).open;
    expect(crack).toBeGreaterThan(0.15);
    expect(crack).toBeLessThan(0.4);
    expect(eyePose(3.5, p).open).toBeGreaterThan(0.95);
    expect(eyePose(5.6 + 0.21, p).open).toBeLessThan(0.15); // mid-blink
    expect(eyePose(4.5, p).look).toBeGreaterThan(0.9);
    expect(eyePose(1, p).look).toBe(0);
    expect(eyePose(EYE_DURATION - 0.05, p).open).toBeLessThan(0.02);
  });

  it('the face surfaces as it wakes, holds through the blink, and sinks back', () => {
    expect(eyePose(0.2, p).awake).toBe(0);
    expect(eyePose(4, p).awake).toBeGreaterThan(0.95);
    expect(eyePose(5.6 + 0.21, p).awake).toBeGreaterThan(0.95); // mid-blink
    expect(eyePose(EYE_DURATION - 0.05, p).awake).toBeLessThan(0.02);
    let prev = 0;
    for (let t = 0; t <= EYE_DURATION; t += 1 / 60) {
      const a = eyePose(t, p).awake;
      expect(Math.abs(a - prev)).toBeLessThan(0.02);
      prev = a;
    }
  });

  it('contracts the pupil to a slit once awake', () => {
    const early = eyePose(0.5, p).pupil;
    const awake = eyePose(4, p).pupil;
    expect(awake).toBeLessThan(early);
    expect(awake).toBeGreaterThan(0);
  });

  it('never leaves [0, 1] and never jumps', () => {
    let prev = 0;
    for (let t = 0; t <= EYE_DURATION; t += 1 / 60) {
      const o = eyePose(t, p).open;
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
      expect(Math.abs(o - prev)).toBeLessThan(0.15); // the blink is quick, but never a pop
      prev = o;
    }
  });
});

describe('the wyrm in the mountains', () => {
  it('its head blends into the range with no step in the silhouette', () => {
    let prev = MOUNTAINS.height(-10);
    for (let x = -10; x < 14; x += 0.002) {
      const h = MOUNTAINS.height(x);
      expect(Math.abs(h - prev)).toBeLessThan(0.02);
      prev = h;
    }
  });
});

describe('wind', () => {
  it('is deterministic, mostly blows +x and stays bounded', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const x = (i * 0.37) % 50;
      const t = i * 0.11;
      const w = wind(x, t);
      expect(w).toBe(wind(x, t));
      min = Math.min(min, w);
      max = Math.max(max, w);
      expect(breeze(t)).toBeGreaterThan(0);
      expect(gust(x, t)).toBeGreaterThanOrEqual(0);
    }
    expect(min).toBeGreaterThan(-0.2);
    expect(max).toBeLessThan(2.2);
    expect(max - min).toBeGreaterThan(0.5); // it actually gusts
  });

  it('changes smoothly over time (no popping)', () => {
    for (let i = 0; i < 500; i++) {
      const t = i * 0.5;
      expect(Math.abs(wind(3, t + 1 / 60) - wind(3, t))).toBeLessThan(0.1);
    }
  });
});
