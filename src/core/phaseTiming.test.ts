import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE, PHASE } from './content';
import { dragonSize, dyingDuration, enterDuration } from './formulas';
import { createInitialState } from './state';
import type { EventOf, GameEvent } from './types';

describe('enter and dying scale with dragon size', () => {
  it('newts are quick, big dragons take the full time, log-size lerp between', () => {
    const p = BALANCE.phase;
    expect(enterDuration(0.5)).toBe(p.enterQuick);
    expect(dyingDuration(p.quickSize)).toBe(p.dyingQuick);
    expect(enterDuration(p.fullSize)).toBe(p.enter);
    expect(dyingDuration(100)).toBe(p.dying);
    // Halfway in log size is halfway in duration.
    const mid = Math.sqrt(p.quickSize * p.fullSize);
    expect(enterDuration(mid)).toBeCloseTo((p.enterQuick + p.enter) / 2, 9);
    expect(dyingDuration(mid)).toBeCloseTo((p.dyingQuick + p.dying) / 2, 9);
    // Monotone over the tier-0 sizes.
    let prevE = 0;
    let prevD = 0;
    for (let i = 0; i < 40; i++) {
      const size = dragonSize(0, i);
      expect(enterDuration(size)).toBeGreaterThanOrEqual(prevE);
      expect(dyingDuration(size)).toBeGreaterThanOrEqual(prevD);
      prevE = enterDuration(size);
      prevD = dyingDuration(size);
    }
    expect(p.enterQuick).toBeLessThan(p.enter);
    expect(p.dyingQuick).toBeLessThan(p.dying);
  });

  it('spawns and kills use the size-scaled durations (events carry them)', () => {
    const s = createInitialState(2);
    const events: GameEvent[] = [];
    const emit = (e: GameEvent): void => {
      events.push(e);
    };
    applyAction(s, { type: 'debug', op: 'kill' }, emit);
    expect(s.dragon.phase).toBe('dying');
    expect(s.dragon.phaseDur).toBe(dyingDuration(s.dragon.size));
    expect(s.dragon.phaseDur).toBeLessThan(PHASE.dying);
    applyAction(s, { type: 'debug', op: 'dragon', amount: 30 }, emit);
    const enter = events.filter((e): e is EventOf<'dragonPhase'> => e.type === 'dragonPhase').at(-1)!;
    expect(enter.phase).toBe('enter');
    expect(s.dragon.size).toBeGreaterThan(BALANCE.phase.fullSize);
    expect(enter.dur).toBe(PHASE.enter);
    expect(s.dragon.phaseDur).toBe(PHASE.enter);
  });
});
