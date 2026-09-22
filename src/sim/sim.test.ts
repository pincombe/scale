import { describe, expect, it } from 'vitest';
import { PROFILES, SHOP_PAUSE_BASE, SHOP_PAUSE_PER_BUY, shopPause } from './bots';
import { JUICE, JuiceClock } from './juice';
import { CRIT_HIT_STOP, CRIT_STOP_GAP, KILL_HIT_STOP, KILL_SLOW_MO, KILL_SLOW_MO_DUR, STAGGER_HIT_STOP } from '../render/fx/tuning';
import { FRAME_DT, runGame } from './play';
import { clock, median, never } from './stats';
import { TARGETS, checkTargets, metric } from './targets';
import { D } from '../core';
import type { GameEvent } from '../core';

const strike = (crit: boolean, stagger = false): GameEvent => ({ type: 'strike', damage: D(1), crit, weak: crit, stagger, aimed: true, x: 0, y: 0 });

/** Logic seconds a clock yields over `seconds` of 60 fps wall time. */
function logicOver(c: JuiceClock, seconds: number): number {
  let t = 0;
  for (let i = 0; i < Math.round(seconds / FRAME_DT); i++) t += c.update(FRAME_DT);
  return t;
}

describe('juice clock', () => {
  it('uses the fx layer\'s own time-effect constants', () => {
    expect(JUICE).toEqual({
      critHitStop: CRIT_HIT_STOP,
      staggerHitStop: STAGGER_HIT_STOP,
      killHitStop: KILL_HIT_STOP,
      killSlowMo: KILL_SLOW_MO,
      killSlowMoDur: KILL_SLOW_MO_DUR,
    });
  });

  it('runs at 1× when juice is off, whatever happens', () => {
    const c = new JuiceClock(false);
    c.onEvent(strike(true));
    c.onEvent({ type: 'dragonDeath', id: 1, gold: D(1) });
    expect(logicOver(c, 1)).toBeCloseTo(1, 9);
  });

  it('a crit freezes logic for its hit-stop; plain hits cost nothing', () => {
    const c = new JuiceClock(true);
    c.onEvent(strike(false));
    expect(logicOver(c, 1)).toBeCloseTo(1, 6);
    c.onEvent(strike(true));
    const lost = 1 - logicOver(c, 1);
    expect(lost).toBeGreaterThanOrEqual(JUICE.critHitStop - FRAME_DT);
    expect(lost).toBeLessThanOrEqual(JUICE.critHitStop + FRAME_DT);
  });

  it('only the first crit of a spree hit-stops (CRIT_STOP_GAP of calm re-arms it)', () => {
    const c = new JuiceClock(true);
    let logic = 0;
    // Crits every 0.4 s (spree): only the first one freezes.
    for (let i = 0; i < 5; i++) {
      c.onEvent(strike(true));
      logic += logicOver(c, 0.4);
    }
    expect(2 - logic).toBeCloseTo(JUICE.critHitStop, 1);
    // After a calm stretch, the next crit punches again.
    logicOver(c, CRIT_STOP_GAP + 0.1);
    c.onEvent(strike(true, true));
    expect(1 - logicOver(c, 1)).toBeCloseTo(JUICE.staggerHitStop, 1);
  });

  it('a kill costs its hit-stop plus the slow-mo (about half the slow-mo is lost)', () => {
    const c = new JuiceClock(true);
    c.onEvent({ type: 'dragonDeath', id: 1, gold: D(1) });
    const lost = 1 - logicOver(c, 1);
    // Scale eases from 0.25 back to 1 (inQuad) over 0.55 s: ~0.275 s lost, plus the freeze.
    expect(lost).toBeGreaterThan(0.25);
    expect(lost).toBeLessThan(0.45);
  });
});

describe('stats', () => {
  it('median, never, clock', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(never(-1)).toBe(Infinity);
    expect(never(12)).toBe(12);
    expect(clock(75.4)).toBe('1:15');
    expect(clock(Infinity)).toBe('never');
  });
});

describe('balance sim', () => {
  it('is deterministic per seed and profile', () => {
    const a = runGame(PROFILES.engaged, 5, { seconds: 60 });
    const b = runGame(PROFILES.engaged, 5, { seconds: 60 });
    const c = runGame(PROFILES.engaged, 6, { seconds: 60 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('juice dilation slows the engaged player down, but only a little', () => {
    const plain = runGame(PROFILES.engaged, 2, { juice: false });
    const juiced = runGame(PROFILES.engaged, 2, { juice: true });
    expect(plain.dilation).toBe(1);
    expect(juiced.dilation).toBeLessThan(0.97);
    expect(juiced.dilation).toBeGreaterThan(0.8);
    expect(juiced.killsAtBoss).toBeLessThanOrEqual(plain.killsAtBoss);
  });

  it('shopping costs clicking time: 0.3 s + 0.15 s per purchase, nothing for an empty trip', () => {
    expect(SHOP_PAUSE_BASE).toBe(0.3);
    expect(SHOP_PAUSE_PER_BUY).toBe(0.15);
    expect(shopPause(0)).toBe(0);
    expect(shopPause(1)).toBeCloseTo(0.45, 9);
    expect(shopPause(4)).toBeCloseTo(0.9, 9);
    const r = runGame(PROFILES.engaged, 3, { seconds: 90 });
    expect(r.shopping).toBeGreaterThan(5);
    expect(r.shopping).toBeLessThan(30);
  });

  it('click share is a share of the damage actually dealt', () => {
    for (const name of ['engaged', 'casual'] as const) {
      const r = runGame(PROFILES[name], 4, { seconds: 90 });
      expect(r.clickShare).toBeGreaterThan(0);
      expect(r.clickShare).toBeLessThan(1);
    }
  });

  it('windups are a harder target than the loose scale; idle never staggers', () => {
    for (const p of Object.values(PROFILES)) expect(p.windupWeakRate).toBeLessThanOrEqual(p.weakRate);
    expect(PROFILES.idle.windupWeakRate).toBe(0);
  });

  it('checks only the targets of profiles that ran (a single-profile sim does not crash)', () => {
    const results = checkTargets({ casual: [runGame(PROFILES.casual, 1, { seconds: 200 })] });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.target.profile === 'casual')).toBe(true);
  });

  it('every target names a real metric', () => {
    for (const t of TARGETS) expect(() => metric(t.metric)).not.toThrow();
  });

  it('a few seeds already meet the every-seed targets (the full check is `npm run sim`)', () => {
    const seeds = [1, 2, 3];
    const runs = {
      engaged: seeds.map((s) => runGame(PROFILES.engaged, s)),
      casual: seeds.map((s) => runGame(PROFILES.casual, s)),
      idle: seeds.map((s) => runGame(PROFILES.idle, s)),
    };
    const failed = checkTargets(runs).filter((r) => r.target.stat === 'worst' && !r.ok);
    expect(failed.map((r) => `${r.target.profile}: ${r.target.note} (${r.value})`)).toEqual([]);
  });
});
