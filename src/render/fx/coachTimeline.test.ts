import { describe, expect, it } from 'vitest';
import type { DragonPhase } from '../../core/types';
import {
  COACH_LABEL_MAX,
  COACH_NONE,
  COACH_STAGGER,
  COACH_STAGGER_AFTER,
  COACH_STAGGER_MAX,
  COACH_WEAK,
  COACH_WEAK_DELAY,
  createCoachTimeline,
  stepCoach,
  type CoachInput,
  type CoachTimeline,
} from './coachTimeline';

const DT = 1 / 60;

/** A little harness: a mutable input and a clock stepped at 60 fps. */
function rig(init: Partial<CoachInput> = {}) {
  const tl = createCoachTimeline();
  const s: CoachInput = {
    started: false,
    now: 0,
    strikes: 0,
    crits: 0,
    staggers: 0,
    kills: 0,
    dragonId: 1,
    phase: 'idle',
    spotLive: true,
    ...init,
  };
  const step = (): CoachTimeline => stepCoach(tl, s);
  /** Advance `seconds` in frames; returns the last step. */
  const run = (seconds: number): CoachTimeline => {
    const n = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < n; i++) {
      s.now += DT;
      step();
    }
    return tl;
  };
  const strike = (crit = false, stagger = false): CoachTimeline => {
    s.started = true;
    s.strikes++;
    if (crit) s.crits++;
    if (stagger) s.staggers++;
    s.now += DT;
    return step();
  };
  const phase = (p: DragonPhase): CoachTimeline => {
    s.phase = p;
    s.now += DT;
    return step();
  };
  const nextDragon = (): CoachTimeline => {
    s.dragonId++;
    s.kills++;
    s.phase = 'enter';
    s.now += DT;
    return step();
  };
  step();
  return { tl, s, run, strike, phase, nextDragon };
}

describe('coach timeline: weak spot', () => {
  it('never shows on the title screen, even with a live spot', () => {
    const r = rig();
    expect(r.run(30).mode).toBe(COACH_NONE);
  });

  it('appears COACH_WEAK_DELAY after the first strike, with its label', () => {
    const r = rig();
    r.run(2);
    r.strike();
    expect(r.run(COACH_WEAK_DELAY - 0.1).mode).toBe(COACH_NONE);
    const t = r.run(0.15);
    expect(t.mode).toBe(COACH_WEAK);
    expect(t.label).toBe(true);
  });

  it('hides while the spot is not live and comes back when it is', () => {
    const r = rig();
    r.strike();
    r.run(1);
    r.s.spotLive = false;
    expect(r.run(0.1).mode).toBe(COACH_NONE);
    r.s.spotLive = true;
    expect(r.run(0.1).mode).toBe(COACH_WEAK);
  });

  it('the first crit dismisses it for good and reports the lesson once', () => {
    const r = rig();
    r.strike();
    r.run(2);
    const t = r.strike(true);
    expect(t.learned).toBe(COACH_WEAK);
    expect(t.mode).toBe(COACH_NONE);
    expect(r.run(DT).learned).toBe(0);
    expect(r.run(60).mode).toBe(COACH_NONE);
  });

  it('a lucky crit before it appears means it never appears', () => {
    const r = rig();
    r.strike(true);
    expect(r.run(20).mode).toBe(COACH_NONE);
  });

  it('keeps the ring but drops the label after COACH_LABEL_MAX on screen', () => {
    const r = rig();
    r.strike();
    r.run(COACH_WEAK_DELAY + 0.05);
    let t = r.run(COACH_LABEL_MAX - 0.5);
    expect(t.label).toBe(true);
    t = r.run(1);
    expect(t.mode).toBe(COACH_WEAK);
    expect(t.label).toBe(false);
  });

  it('only counts label time while it is on screen', () => {
    const r = rig();
    r.strike();
    r.run(COACH_WEAK_DELAY + 0.05);
    r.run(COACH_LABEL_MAX / 2);
    r.s.spotLive = false;
    r.run(COACH_LABEL_MAX);
    r.s.spotLive = true;
    expect(r.run(COACH_LABEL_MAX / 2 - 0.5).label).toBe(true);
  });

  it('brings the label back once on the next dragon, then never again', () => {
    const r = rig();
    r.strike();
    r.run(COACH_WEAK_DELAY + COACH_LABEL_MAX + 0.5);
    expect(r.tl.label).toBe(false);
    r.nextDragon();
    r.phase('idle');
    let t = r.run(1);
    expect(t.label).toBe(true);
    t = r.run(COACH_LABEL_MAX);
    expect(t.label).toBe(false);
    expect(t.mode).toBe(COACH_WEAK);
    r.nextDragon();
    r.phase('idle');
    t = r.run(2);
    expect(t.label).toBe(false);
    expect(t.mode).toBe(COACH_WEAK);
  });

  it('stays learned across a reload (crits come from the save)', () => {
    const r = rig({ strikes: 40, crits: 3, kills: 1 });
    r.strike();
    expect(r.run(5).mode).toBe(COACH_NONE);
  });

  it('a returning player who never crit is coached after their first strike this session', () => {
    const r = rig({ strikes: 12, crits: 0 });
    r.s.started = true;
    expect(r.run(3).mode).toBe(COACH_NONE);
    r.strike();
    expect(r.run(1).mode).toBe(COACH_WEAK);
  });

  it('a hard reset (stats drop) starts the lesson over', () => {
    const r = rig();
    r.strike();
    r.run(1);
    r.strike(true);
    r.run(1);
    Object.assign(r.s, { strikes: 0, crits: 0, staggers: 0, kills: 0 });
    expect(r.run(2).mode).toBe(COACH_NONE);
    r.strike();
    expect(r.run(1).mode).toBe(COACH_WEAK);
  });
});

describe('coach timeline: stagger', () => {
  /** A player who learned the weak spot and killed two dragons, `since` s after the first crit. */
  function learned(since = COACH_STAGGER_AFTER + 1) {
    const r = rig();
    r.strike();
    r.run(1);
    r.strike(true);
    r.nextDragon();
    r.nextDragon();
    r.phase('idle');
    r.run(since);
    return r;
  }

  it('shows on the first eligible windup, with its label, and hides after it', () => {
    const r = learned();
    let t = r.phase('windup');
    expect(t.mode).toBe(COACH_STAGGER);
    expect(t.label).toBe(true);
    expect(r.run(1).mode).toBe(COACH_STAGGER);
    t = r.phase('breath');
    expect(t.mode).toBe(COACH_NONE);
  });

  it('waits COACH_STAGGER_AFTER after the first crit', () => {
    const r = learned(1);
    expect(r.phase('windup').mode).toBe(COACH_NONE);
    r.phase('idle');
    r.run(COACH_STAGGER_AFTER);
    expect(r.phase('windup').mode).toBe(COACH_STAGGER);
  });

  it('a windup already under way when it becomes eligible does not count', () => {
    const r = learned(COACH_STAGGER_AFTER - 0.5);
    r.phase('windup');
    expect(r.run(1).mode).toBe(COACH_NONE);
  });

  it('needs COACH_STAGGER_KILLS kills', () => {
    const r = rig();
    r.strike();
    r.run(1);
    r.strike(true);
    r.nextDragon();
    r.phase('idle');
    r.run(COACH_STAGGER_AFTER + 1);
    expect(r.phase('windup').mode).toBe(COACH_NONE);
  });

  it('never before the weak spot is learned', () => {
    const r = rig({ kills: 5 });
    r.strike();
    r.run(COACH_STAGGER_AFTER + 1);
    expect(r.phase('windup').mode).toBe(COACH_WEAK);
  });

  it('the first stagger ends it for good and reports the lesson', () => {
    const r = learned();
    r.phase('windup');
    const t = r.strike(true, true);
    expect(t.learned).toBe(COACH_STAGGER);
    r.phase('stagger');
    r.phase('idle');
    r.run(3);
    expect(r.phase('windup').mode).toBe(COACH_NONE);
  });

  it(`gives up after ${COACH_STAGGER_MAX} windups`, () => {
    const r = learned();
    for (let i = 0; i < COACH_STAGGER_MAX; i++) {
      expect(r.phase('windup').mode).toBe(COACH_STAGGER);
      r.run(1);
      r.phase('breath');
      r.phase('idle');
      r.run(3);
    }
    expect(r.phase('windup').mode).toBe(COACH_NONE);
  });

  it('a new dragon interrupting a windup drops the coach', () => {
    const r = learned();
    r.phase('windup');
    r.s.dragonId++;
    r.s.phase = 'enter';
    expect(r.run(DT).mode).toBe(COACH_NONE);
  });

  it('never on the title screen after a reload', () => {
    const r = rig({ strikes: 30, crits: 4, kills: 3 });
    r.run(COACH_STAGGER_AFTER + 1);
    expect(r.phase('windup').mode).toBe(COACH_NONE);
  });

  it('after a reload with the weak spot learned, the first windup after starting teaches it', () => {
    const r = rig({ strikes: 30, crits: 4, kills: 3 });
    r.strike();
    r.phase('idle');
    expect(r.phase('windup').mode).toBe(COACH_STAGGER);
  });
});
