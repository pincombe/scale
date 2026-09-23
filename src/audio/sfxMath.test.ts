import { describe, expect, it } from 'vitest';
import {
  BOSS_TICK_FROM,
  CoinRun,
  VoiceLimiter,
  bossTickInterval,
  bossTickLevel,
  crashesFor,
  expLerp,
  horsesFor,
  panFor,
  pentaHz,
  voiceSize,
} from './sfxMath';

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

describe('VoiceLimiter scheduling', () => {
  it('a voice scheduled ahead still merges requests just before it', () => {
    const l = new VoiceLimiter({ hit: { max: 4, gap: 0.04 } });
    expect(l.tryStart('hit', 1.3, 0.2)).toBe(true);
    expect(l.tryStart('hit', 1.28, 0.2)).toBe(false);
    expect(l.tryStart('hit', 1.0, 0.2)).toBe(true);
  });
  it('setEnd re-times or frees a slot', () => {
    const l = new VoiceLimiter({ hit: { max: 1, gap: 0 } });
    const s = l.claim('hit', 0, 0.2);
    expect(s).toBe(0);
    l.setEnd('hit', s, 2);
    expect(l.canStart('hit', 1)).toBe(false);
    l.setEnd('hit', s, 1);
    expect(l.canStart('hit', 1)).toBe(true);
    expect(l.claim('hit', 1.5, 1)).toBe(0);
    expect(l.claim('hit', 1.6, 1)).toBe(-1);
  });
});

describe('VoiceLimiter stealing', () => {
  it('takes over the slot that frees soonest when full, but still merges inside the gap', () => {
    const l = new VoiceLimiter({ hit: { max: 2, gap: 0.04 } });
    expect(l.claimOrSteal('hit', 0, 1)).toBe(0);
    expect(l.claimOrSteal('hit', 0.1, 0.5)).toBe(1); // ends 0.6, sooner than slot 0
    expect(l.claimOrSteal('hit', 0.2, 1)).toBe(1);
    expect(l.claimOrSteal('hit', 0.21, 1)).toBe(-1);
    expect(l.claimOrSteal('hit', 0.3, 1)).toBe(0);
  });
});

describe('CoinRun', () => {
  it('wraps into repeating cascades when given a wrap step', () => {
    const r = new CoinRun(5, 8, 0.5, 6);
    const got: number[] = [];
    for (let i = 0; i < 9; i++) got.push(r.next(i * 0.05, 0.5));
    expect(got).toEqual([5, 6, 7, 8, 6, 7, 8, 6, 7]);
  });

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

describe('VoiceLimiter.resetCat', () => {
  it('frees one category and leaves the others alone', () => {
    const l = new VoiceLimiter({ a: { max: 1, gap: 0.5 }, b: { max: 1, gap: 0.5 } });
    expect(l.claim('a', 0, 10)).toBe(0);
    expect(l.claim('b', 0, 10)).toBe(0);
    l.resetCat('a');
    expect(l.claim('a', 0.1, 1)).toBe(0);
    expect(l.claim('b', 1, 1)).toBe(-1);
  });
});

describe('boss clock', () => {
  it('is silent above the last 10 s and when no boss fights', () => {
    expect(bossTickInterval(BOSS_TICK_FROM + 0.01)).toBe(Infinity);
    expect(bossTickInterval(30)).toBe(Infinity);
    expect(bossTickInterval(0)).toBe(Infinity);
    expect(bossTickInterval(NaN)).toBe(Infinity);
  });
  it('ticks once a second at 10 s and speeds up to the end', () => {
    expect(bossTickInterval(10)).toBeCloseTo(1, 6);
    let prev = Infinity;
    for (let left = 10; left > 0.05; left -= 0.25) {
      const iv = bossTickInterval(left);
      expect(iv).toBeLessThanOrEqual(prev);
      expect(iv).toBeGreaterThanOrEqual(0.2);
      prev = iv;
    }
    expect(bossTickInterval(0.1)).toBeLessThan(0.25);
  });
  it('grows a little louder, never past 1', () => {
    expect(bossTickLevel(10)).toBeCloseTo(0.6, 6);
    expect(bossTickLevel(0)).toBe(1);
    expect(bossTickLevel(5)).toBeGreaterThan(bossTickLevel(8));
    expect(bossTickLevel(-3)).toBe(1);
  });
});

describe('lancer voicing', () => {
  it('maps riders to 1..4 horses and 1..3 crashes', () => {
    expect(horsesFor(1)).toBe(1);
    expect(horsesFor(4)).toBe(2);
    expect(horsesFor(16)).toBe(4);
    expect(horsesFor(100)).toBe(4);
    expect(horsesFor(0)).toBe(1);
    expect(crashesFor(1)).toBe(1);
    expect(crashesFor(6)).toBe(2);
    expect(crashesFor(16)).toBe(3);
    expect(crashesFor(NaN)).toBe(1);
  });
});
