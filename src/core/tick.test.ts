import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { PHASE, UNITS } from './content';
import { TICK_DT, unitCost } from './formulas';
import { serialize, toJSON } from './serialize';
import { createInitialState } from './state';
import { tick } from './tick';
import type { Action, EventOf, GameEvent, GameEventType, GameState } from './types';

function recorder(): { events: GameEvent[]; emit: (e: GameEvent) => void } {
  const events: GameEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

function ofType<T extends GameEventType>(events: GameEvent[], type: T): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

function run(state: GameState, seconds: number, emit: (e: GameEvent) => void): void {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) tick(state, TICK_DT, emit);
}

/** A scripted two-minute session: clicks, weak hits, purchases. */
function play(seed: number): { state: string; events: string; kills: number } {
  const s = createInitialState(seed);
  const { events, emit } = recorder();
  for (let i = 0; i < 20 * 120; i++) {
    let a: Action | null = null;
    if (i % 4 === 0) a = { type: 'strike', weak: i % 36 === 0, aimed: i % 8 === 0, x: i * 0.01, y: -0.2 };
    else if (i % 100 === 50) a = { type: 'buyUnit', unit: 'footman', amount: 1 };
    else if (i % 300 === 150) a = { type: 'buyUnit', unit: 'archer', amount: 1 };
    else if (i % 400 === 222) a = { type: 'buyUpgrade', id: 'pointySwords' };
    if (a) applyAction(s, a, emit);
    tick(s, TICK_DT, emit);
  }
  return { state: serialize(s), events: toJSON(events), kills: s.kills };
}

describe('determinism', () => {
  it('same seed + same action script => identical state and events', () => {
    const a = play(42);
    const b = play(42);
    expect(a.kills).toBeGreaterThan(5);
    expect(b.state).toBe(a.state);
    expect(b.events).toBe(a.events);
  });

  it('different seeds diverge', () => {
    expect(play(43).state).not.toBe(play(42).state);
  });
});

describe('strikes and kills', () => {
  it('clicks damage the dragon; the killing blow pays gold and unlocks footmen', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    const hp = s.dragon.maxHp.toNumber();
    expect(hp).toBe(10);
    for (let i = 0; i < hp; i++) applyAction(s, { type: 'strike', weak: false, aimed: true, x: 1, y: -0.1 }, emit);
    const strikes = ofType(events, 'strike');
    expect(strikes.length).toBe(10);
    expect(strikes[0]!.damage.eq(1)).toBe(true);
    expect(strikes[0]!.x).toBe(1);
    const death = ofType(events, 'dragonDeath');
    expect(death.length).toBe(1);
    expect(s.gold.eq(death[0]!.gold)).toBe(true);
    expect(s.kills).toBe(1);
    expect(s.dragon.phase).toBe('dying');
    tick(s, TICK_DT, emit);
    expect(ofType(events, 'unlock').some((e) => e.id === 'footman')).toBe(true);
    expect(s.flags['unit.footman']).toBe(true);
  });

  it('strikes on a dying dragon are ignored', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'kill' }, emit);
    const n = events.length;
    applyAction(s, { type: 'strike', weak: true, aimed: true, x: 0, y: 0 }, emit);
    expect(events.length).toBe(n);
  });

  it('the next, bigger dragon enters after the death throes', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    const first = { id: s.dragon.id, size: s.dragon.size, maxHp: s.dragon.maxHp };
    applyAction(s, { type: 'debug', op: 'kill' }, emit);
    run(s, PHASE.dying + TICK_DT, emit);
    const spawn = ofType(events, 'dragonSpawn');
    expect(spawn.length).toBe(1);
    expect(s.dragon.id).not.toBe(first.id);
    expect(s.dragon.index).toBe(1);
    expect(s.dragon.size).toBeGreaterThan(first.size);
    expect(s.dragon.maxHp.gt(first.maxHp)).toBe(true);
    expect(s.dragon.phase).toBe('enter');
  });

  it('the weak spot crits x5, and during a windup it staggers for bonus gold', () => {
    const s = createInitialState(1);
    s.dragon.hp = s.dragon.maxHp = s.dragon.maxHp.mul(100);
    const { events, emit } = recorder();
    applyAction(s, { type: 'strike', weak: true, aimed: true, x: 0, y: 0 }, emit);
    const crit = ofType(events, 'strike')[0]!;
    expect(crit.damage.eq(5)).toBe(true);
    expect(crit.crit).toBe(true);
    expect(crit.stagger).toBe(false);

    applyAction(s, { type: 'debug', op: 'phase', phase: 'windup', attack: 'breath' }, emit);
    applyAction(s, { type: 'strike', weak: true, aimed: true, x: 0, y: 0 }, emit);
    const staggerHit = ofType(events, 'strike')[1]!;
    expect(staggerHit.stagger).toBe(true);
    const bonus = ofType(events, 'goldGain');
    expect(bonus.length).toBe(1);
    expect(bonus[0]!.source).toBe('stagger');
    expect(s.gold.eq(bonus[0]!.amount)).toBe(true);
    expect(s.dragon.phase).toBe('stagger');
  });
});

describe('dragon phases', () => {
  it('cycles idle -> windup -> breath/swipe -> idle with matching events', () => {
    const s = createInitialState(5);
    const { events, emit } = recorder();
    run(s, 60, emit);
    const phases = ofType(events, 'dragonPhase').map((e) => e.phase);
    expect(phases).toContain('windup');
    expect(phases.some((p) => p === 'breath' || p === 'swipe')).toBe(true);
    for (let i = 0; i < phases.length; i++) {
      if (phases[i] === 'windup') expect(['breath', 'swipe', 'stagger']).toContain(phases[i + 1] ?? 'breath');
    }
    const last = ofType(events, 'dragonPhase').at(-1)!;
    expect(last.phase).toBe(s.dragon.phase);
    expect(last.dur).toBe(s.dragon.phaseDur);
  });

  it('debug.loopPhase repeats a phase, debug.immortal refills HP', () => {
    const s = createInitialState(5);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'flag', flag: 'debug.loopPhase', value: true }, emit);
    applyAction(s, { type: 'debug', op: 'phase', phase: 'windup', attack: 'swipe' }, emit);
    run(s, PHASE.windup * 3.5, emit);
    expect(s.dragon.phase).toBe('windup');
    expect(ofType(events, 'dragonPhase').filter((e) => e.phase === 'windup').length).toBe(4);

    applyAction(s, { type: 'debug', op: 'flag', flag: 'debug.immortal', value: true }, emit);
    for (let i = 0; i < 50; i++) applyAction(s, { type: 'strike', weak: true, aimed: true, x: 0, y: 0 }, emit);
    expect(s.dragon.hp.gt(0)).toBe(true);
    expect(ofType(events, 'dragonDeath').length).toBe(0);
  });
});

describe('army', () => {
  it('footmen hit in discrete beats', () => {
    const s = createInitialState(1);
    s.dragon.hp = s.dragon.maxHp = s.dragon.maxHp.mul(1000);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'units', unit: 'footman', amount: 3 }, emit);
    run(s, 3, emit); // the first dragon idles for 4 s, so every beat lands
    const hits = ofType(events, 'armyHit');
    expect(hits.length).toBe(3);
    expect(hits[0]!.unit).toBe('footman');
    expect(hits[0]!.damage.eq(3)).toBe(true);
    expect(hits[0]!.hits).toBe(3);
  });

  it('archers loose volleys that land after their flight time', () => {
    const s = createInitialState(1);
    s.dragon.hp = s.dragon.maxHp = s.dragon.maxHp.mul(1000);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'units', unit: 'archer', amount: 2 }, emit);
    let volleyAt = -1;
    let hitAt = -1;
    for (let i = 0; i < 100 && hitAt < 0; i++) {
      tick(s, TICK_DT, (e) => {
        emit(e);
        if (e.type === 'volley') volleyAt = i;
        if (e.type === 'armyHit' && e.unit === 'archer') hitAt = i;
      });
    }
    const volley = ofType(events, 'volley')[0]!;
    expect(volley.arrows).toBe(2);
    expect(volley.flight).toBe(UNITS.archer.flight);
    expect((hitAt - volleyAt) * TICK_DT).toBeCloseTo(UNITS.archer.flight, 5);
  });

  it('buying needs the unlock and the gold; costs grow; 10 owned is a milestone', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'gold', amount: 1e6 }, emit);
    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: 1 }, emit);
    expect(s.units.footman).toBe(0); // still locked
    s.flags['unit.footman'] = true;
    const c1 = unitCost(s, 'footman');
    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: 1 }, emit);
    expect(s.units.footman).toBe(1);
    expect(unitCost(s, 'footman').gt(c1)).toBe(true);
    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: 9 }, emit);
    expect(s.units.footman).toBe(10);
    const ms = ofType(events, 'milestone');
    expect(ms).toEqual([{ type: 'milestone', unit: 'footman', owned: 10, mult: 2 }]);
    expect(ofType(events, 'purchase').length).toBe(2);
  });

  it('upgrades apply once', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'gold', amount: 1e6 }, emit);
    s.flags['upgrade.grindstone'] = true;
    applyAction(s, { type: 'buyUpgrade', id: 'grindstone' }, emit);
    applyAction(s, { type: 'buyUpgrade', id: 'grindstone' }, emit);
    expect(s.upgrades['grindstone']).toBe(1);
    expect(ofType(events, 'purchase').length).toBe(1);
    applyAction(s, { type: 'strike', weak: false, aimed: true, x: 0, y: 0 }, emit);
    expect(ofType(events, 'strike')[0]!.damage.eq(3)).toBe(true);
  });
});
