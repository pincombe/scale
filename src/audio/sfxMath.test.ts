import { describe, expect, it } from 'vitest';
import { CoinRun, VoiceLimiter, expLerp, panFor, pentaHz, voiceSize } from './sfxMath';

describe('pentaHz', () => {
  it('walks D major pentatonic', () => {
    expect(pentaHz(0)).toBeCloseTo(293.66, 1); // D4
    expect(pentaHz(3)).toBeCloseTo(440, 5); // A4
    expect(pentaHz(5)).toBeCloseTo(587.33, 1); // D5
    expect(pentaHz(10)).toBeCloseTo(pentaHz(5) * 2, 6);
  });
  it('rises monotonically', () => {
    for (let s = 0; s < 25; s++) expect(pentaHz(s + 1)).toBeGreaterThan(pentaHz(s));
  });
});

describe('voiceSize', () => {
  it('maps newt → 0, barn → 1, clamped and log-scaled', () => {
    expect(voiceSize(0.5)).toBe(0);
    expect(voiceSize(0.1)).toBe(0);
    expect(voiceSize(10)).toBeCloseTo(1, 6);
    expect(voiceSize(1000)).toBe(1);
    expect(voiceSize(Math.sqrt(0.5 * 10))).toBeCloseTo(0.5, 6);
    expect(voiceSize(NaN)).toBe(0);
  });
});

describe('expLerp', () => {
  it('interpolates geometrically', () => {
    expect(expLerp(100, 400, 0.5)).toBeCloseTo(200, 6);
    expect(expLerp(100, 400, 0)).toBe(100);
  });
});

describe('panFor', () => {
  it('is centered at stage center and clamped to ±width', () => {
    expect(panFor(500, 500, 1000)).toBe(0);
    expect(panFor(1000, 500, 1000)).toBeCloseTo(0.55, 6);
    expect(panFor(-5000, 500, 1000)).toBe(-0.55);
    expect(panFor(750, 500, 1000, 0.4)).toBeCloseTo(0.2, 6);
    expect(panFor(NaN, 500, 1000)).toBe(0);
  });
});

describe('VoiceLimiter', () => {
  it('merges requests inside the gap', () => {
    const l = new VoiceLimiter({ hit: { max: 4, gap: 0.04 } });
    expect(l.tryStart('hit', 1, 0.3)).toBe(true);
    expect(l.tryStart('hit', 1.02, 0.3)).toBe(false);
    expect(l.tryStart('hit', 1.05, 0.3)).toBe(true);
  });
  it('caps concurrent voices and frees them when they end', () => {
    const l = new VoiceLimiter({ hit: { max: 2, gap: 0 } });
    expect(l.tryStart('hit', 0, 1)).toBe(true);
    expect(l.tryStart('hit', 0.1, 1)).toBe(true);
    expect(l.tryStart('hit', 0.2, 1)).toBe(false);
    expect(l.active('hit', 0.5)).toBe(2);
    expect(l.tryStart('hit', 1.05, 1)).toBe(true);
    expect(l.active('hit', 1.05)).toBe(2);
  });
  it('keeps categories independent and can reset', () => {
    const l = new VoiceLimiter({ a: { max: 1, gap: 0 }, b: { max: 1, gap: 0 } });
    expect(l.tryStart('a', 0, 1)).toBe(true);
    expect(l.tryStart('b', 0, 1)).toBe(true);
    expect(l.canStart('a', 0.5)).toBe(false);
    l.reset();
    expect(l.canStart('a', 0.5)).toBe(true);
  });
});

describe('CoinRun', () => {
  it('climbs one step per clink and restarts after a pause', () => {
    const r = new CoinRun(5, 8, 0.5);
    expect(r.next(0, 0)).toBe(5);
    expect(r.next(0.1, 0)).toBe(6);
    expect(r.next(0.2, 0)).toBe(7);
    expect(r.next(0.3, 0)).toBe(8);
    expect(r.next(1.0, 0)).toBe(5);
  });
  it('hovers among the top notes instead of climbing out of range', () => {
    const r = new CoinRun(5, 8, 0.5);
    for (let i = 0; i < 4; i++) r.next(i * 0.1, 0);
    for (let i = 4; i < 40; i++) {
      const s = r.next(i * 0.1, (i * 0.37) % 1);
      expect(s).toBeLessThanOrEqual(8);
      expect(s).toBeGreaterThanOrEqual(6);
    }
  });
});
