import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { TICK_DT, clickDamage } from './formulas';
import { createInitialState } from './state';
import { tick } from './tick';
import type { EventOf, GameEvent, GameState } from './types';
import { ENTER_WEAK_FROM, phaseProgress, weakSpotFor, weakSpotHittable, weakSpotLive } from './weakspot';

function strikes(events: GameEvent[]): EventOf<'strike'>[] {
  return events.filter((e): e is EventOf<'strike'> => e.type === 'strike');
}

/** A state whose current dragon has just spawned (phase `enter`) with HP to spare. */
function entering(): { s: GameState; events: GameEvent[]; emit: (e: GameEvent) => void } {
  const s = createInitialState(7);
  const events: GameEvent[] = [];
  const emit = (e: GameEvent): void => {
    events.push(e);
  };
  applyAction(s, { type: 'debug', op: 'next' }, emit);
  s.dragon.hp = s.dragon.maxHp = s.dragon.maxHp.mul(1e6);
  events.length = 0;
  return { s, events, emit };
}

const weakStrike = { type: 'strike', weak: true, aimed: true, x: 0, y: 0 } as const;

describe('weak-spot rule', () => {
  it('shows the throat in a breath windup, the tail base in a swipe windup, else the loose scale', () => {
    expect(weakSpotFor('windup', 'breath')).toBe('throat');
    expect(weakSpotFor('windup', 'swipe')).toBe('tail');
    for (const ph of ['enter', 'idle', 'breath', 'swipe', 'stagger', 'dying'] as const) {
      expect(weakSpotFor(ph, 'breath')).toBe('scale');
      expect(weakSpotFor(ph, 'swipe')).toBe('scale');
    }
  });

  it('is hittable except while the dragon is still arriving, dying or leaving', () => {
    expect(weakSpotLive('enter', 0)).toBe(false);
    expect(weakSpotLive('enter', ENTER_WEAK_FROM)).toBe(false);
    expect(weakSpotLive('enter', ENTER_WEAK_FROM + 0.01)).toBe(true);
    expect(weakSpotLive('dying', 0.5)).toBe(false);
    // A leaving dragon (an escaping boss, or one sent away by a zoom) can't be crit, at any point.
    for (const k of [0, 0.5, 1]) expect(weakSpotLive('leave', k)).toBe(false);
    for (const ph of ['idle', 'windup', 'breath', 'swipe', 'stagger'] as const) {
      expect(weakSpotLive(ph, 0)).toBe(true);
      expect(weakSpotLive(ph, 1)).toBe(true);
    }
  });

  it('measures progress through the phase', () => {
    const { s } = entering();
    expect(phaseProgress(s.dragon)).toBe(0);
    s.dragon.phaseT = s.dragon.phaseDur / 2;
    expect(phaseProgress(s.dragon)).toBeCloseTo(0.5, 9);
    s.dragon.phaseDur = 0;
    expect(phaseProgress(s.dragon)).toBe(1);
  });
});

describe('core enforces the weak-spot rule', () => {
  it('a weak click early in the entrance is a plain hit: no crit, no stagger, not counted', () => {
    const { s, events, emit } = entering();
    expect(weakSpotHittable(s.dragon)).toBe(false);
    const plain = clickDamage(s, false);
    const hp = s.dragon.hp;
    applyAction(s, weakStrike, emit);
    const e = strikes(events)[0]!;
    expect(e.weak).toBe(false);
    expect(e.crit).toBe(false);
    expect(e.stagger).toBe(false);
    expect(e.damage.eq(plain)).toBe(true);
    expect(hp.sub(s.dragon.hp).eq(plain)).toBe(true);
    expect(s.stats.crits).toBe(0);
    expect(s.stats.strikes).toBe(1);
  });

  it('once the dragon has arrived (past ENTER_WEAK_FROM of enter) the weak spot crits', () => {
    const { s, events, emit } = entering();
    while (phaseProgress(s.dragon) <= ENTER_WEAK_FROM) tick(s, TICK_DT, emit);
    expect(s.dragon.phase).toBe('enter');
    expect(weakSpotHittable(s.dragon)).toBe(true);
    events.length = 0;
    applyAction(s, weakStrike, emit);
    const e = strikes(events)[0]!;
    expect(e.crit).toBe(true);
    expect(e.weak).toBe(true);
    expect(e.damage.eq(clickDamage(s, true))).toBe(true);
    expect(s.stats.crits).toBe(1);
  });

  it('a weak click on the throat during a breath windup crits and staggers', () => {
    const { s, events, emit } = entering();
    applyAction(s, { type: 'debug', op: 'phase', phase: 'windup', attack: 'breath' }, emit);
    events.length = 0;
    applyAction(s, weakStrike, emit);
    const e = strikes(events)[0]!;
    expect(e.crit).toBe(true);
    expect(e.stagger).toBe(true);
    expect(s.dragon.phase).toBe('stagger');
  });

  it('plain clicks are unaffected by the rule', () => {
    const { s, events, emit } = entering();
    applyAction(s, { type: 'strike', weak: false, aimed: true, x: 0, y: 0 }, emit);
    expect(strikes(events)[0]!.damage.eq(clickDamage(s, false))).toBe(true);
  });
});
