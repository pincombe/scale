import { describe, expect, it } from 'vitest';
import { BOSS_JUICE, JUICE, JuiceClock } from './juice';
import { BOSS_HIT_STOP, BOSS_SLOW_MO, BOSS_SLOW_MO_DUR } from '../render/fx/tuning';
import { FRAME_DT } from './play';
import { D } from '../core';

function logicOver(c: JuiceClock, seconds: number): number {
  let t = 0;
  for (let i = 0; i < Math.round(seconds / FRAME_DT); i++) t += c.update(FRAME_DT);
  return t;
}

describe('juice clock: the boss (WP 2.2)', () => {
  it("uses the fx layer's boss constants", () => {
    expect(BOSS_JUICE).toEqual({ hitStop: BOSS_HIT_STOP, slowMo: BOSS_SLOW_MO, slowMoDur: BOSS_SLOW_MO_DUR });
  });

  it("the boss's fall costs more than a kill, and only once", () => {
    const kill = new JuiceClock(true);
    kill.onEvent({ type: 'dragonDeath', id: 1, gold: D(1) });
    const killLost = 3 - logicOver(kill, 3);

    const boss = new JuiceClock(true);
    // Same drain as core emits them: the boss's dragonDeath, then bossDefeated.
    boss.onEvent({ type: 'dragonDeath', id: 2, gold: D(1) });
    boss.onEvent({ type: 'bossDefeated', boss: 'elderNewt', first: true });
    const bossLost = 3 - logicOver(boss, 3);
    expect(bossLost).toBeGreaterThan(killLost * 2);
    // At most the hit-stop plus the slow-mo's full cost (factor + (1 - factor) / 3 on average;
    // the slow-mo's own clock also runs during the freeze, so a little less in practice).
    const most = BOSS_HIT_STOP + BOSS_SLOW_MO_DUR * (1 - (BOSS_SLOW_MO + (1 - BOSS_SLOW_MO) / 3));
    expect(bossLost).toBeLessThanOrEqual(most + 0.02);
    expect(bossLost).toBeGreaterThan(most - 0.15);
    expect(bossLost).toBeLessThan(1.5);
    expect(JUICE.killHitStop).toBeLessThanOrEqual(BOSS_HIT_STOP);
  });

  it('the boss fight itself adds no time effects', () => {
    const c = new JuiceClock(true);
    c.onEvent({ type: 'bossSummon', boss: 'elderNewt', dur: 30 });
    c.onEvent({ type: 'bossEscaped', boss: 'elderNewt' });
    expect(logicOver(c, 1)).toBeCloseTo(1, 6);
  });
});
