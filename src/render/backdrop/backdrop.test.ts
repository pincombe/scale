import { describe, expect, it } from 'vitest';
import {
  createEyeSchedule,
  eyeClosed,
  eyePose,
  stepEyeSchedule,
  EYE_DURATION,
  EYE_FIRST_DELAY,
  EYE_MAX_GAP,
  EYE_MIN_GAP,
  type EyePose,
} from './eyeTimeline';
import { breeze, gust, wind } from './wind';

describe('eye schedule', () => {
  it('stays shut before the 3rd kill', () => {
    const s = createEyeSchedule();
    for (let t = 0; t < 300; t += 1) expect(stepEyeSchedule(s, 2, t, false)).toBe(false);
  });

  it('opens shortly after the 3rd kill, then every 45-90 s', () => {
    const s = createEyeSchedule();
    expect(stepEyeSchedule(s, 3, 100, false)).toBe(false);
    expect(stepEyeSchedule(s, 3, 100 + EYE_FIRST_DELAY - 0.01, false)).toBe(false);
    expect(stepEyeSchedule(s, 3, 100 + EYE_FIRST_DELAY, false)).toBe(true);
    expect(s.firstShown).toBe(true);
    // Not again until it has closed and the gap has passed.
    expect(stepEyeSchedule(s, 5, 200, false)).toBe(false);
    eyeClosed(s, 112, 0.5);
    const next = 112 + EYE_MIN_GAP + 0.5 * (EYE_MAX_GAP - EYE_MIN_GAP);
    expect(s.nextAt).toBeCloseTo(next);
    expect(stepEyeSchedule(s, 5, next - 1, false)).toBe(false);
    expect(stepEyeSchedule(s, 5, next, false)).toBe(true);
  });

  it('waits while the eye is already open (manual opening)', () => {
    const s = createEyeSchedule();
    stepEyeSchedule(s, 3, 0, false);
    expect(stepEyeSchedule(s, 3, 10, true)).toBe(false);
    expect(stepEyeSchedule(s, 3, 11, false)).toBe(true);
  });

  it('restarts when kills drop (reset game / new tier)', () => {
    const s = createEyeSchedule();
    stepEyeSchedule(s, 3, 0, false);
    expect(stepEyeSchedule(s, 3, EYE_FIRST_DELAY, false)).toBe(true);
    eyeClosed(s, 20, 0);
    expect(stepEyeSchedule(s, 0, 30, false)).toBe(false);
    expect(s.firstShown).toBe(false);
    expect(s.nextAt).toBe(Infinity);
    // No random openings until the 3rd kill again.
    expect(stepEyeSchedule(s, 2, 20 + EYE_MAX_GAP + 1, false)).toBe(false);
    stepEyeSchedule(s, 3, 500, false);
    expect(stepEyeSchedule(s, 3, 500 + EYE_FIRST_DELAY, false)).toBe(true);
  });

  it('a manual opening before the first kill-triggered one schedules nothing', () => {
    const s = createEyeSchedule();
    eyeClosed(s, 50, 0.3);
    expect(s.nextAt).toBe(Infinity);
  });

  it('keeps gaps within 45-90 s for any random draw', () => {
    const s = createEyeSchedule();
    s.firstShown = true;
    for (const r of [0, 0.25, 1, 1.5, -1]) {
      eyeClosed(s, 0, r);
      expect(s.nextAt).toBeGreaterThanOrEqual(EYE_MIN_GAP);
      expect(s.nextAt).toBeLessThanOrEqual(EYE_MAX_GAP);
    }
  });
});

describe('eye pose', () => {
  const p: EyePose = { open: 0, look: 0, pupil: 0, glow: 0 };

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
