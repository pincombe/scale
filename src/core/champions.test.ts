// M2: champions (Ser Aldric, Dame Brunhild), ARCHITECTURE §14.
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE, CHAMPION_TEXT } from './content';
import { D } from './decimal';
import { BUY_MAX, championCost, championDps, championHit, championMaxAffordable, championSpecialDamage, damageMult, unitPeriod } from './formulas';
import * as sel from './selectors';
import { createInitialState } from './state';
import { tick } from './tick';
import { TICK_DT } from './formulas';
import { finishZoom, inMountain, killAndNext, noop, ofType, recorder, runFor, runUntil, tank } from './testing/helpers';
import type { GameState } from './types';

/** A Meadow save where Aldric has just joined. */
function withAldric(seed = 1): GameState {
  const s = createInitialState(seed);
  s.kills = BALANCE.champions.aldric.unlock.at;
  tick(s, TICK_DT, noop);
  return s;
}

describe('joining', () => {
  it('Ser Aldric joins in the Meadow at his kill count: level 1, free, championJoin + unlock', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    const at = BALANCE.champions.aldric.unlock.at;
    s.kills = at - 1;
    tick(s, TICK_DT, emit);
    expect(sel.championVisible(s, 'aldric')).toBe(false);
    s.kills = at;
    tick(s, TICK_DT, emit);
    expect(s.champions.aldric.level).toBe(1);
    expect(s.gold.eq(0)).toBe(true);
    const types = events.map((e) => e.type);
    expect(ofType(events, 'championJoin')).toEqual([{ type: 'championJoin', id: 'aldric' }]);
    expect(ofType(events, 'unlock')).toContainEqual({ type: 'unlock', kind: 'champion', id: 'aldric' });
    expect(types.indexOf('championJoin')).toBeLessThan(types.lastIndexOf('unlock'));
    expect(s.flags['champion.aldric']).toBe(true);
    expect(CHAMPION_TEXT.aldric.special).toBe('Heroic Lunge');
  });

  it('Dame Brunhild joins only in the Mountain', () => {
    const m = createInitialState(1);
    m.kills = 50;
    tick(m, TICK_DT, noop);
    expect(sel.championVisible(m, 'brunhild')).toBe(false);
    const s = inMountain(2);
    const { events, emit } = recorder();
    for (let k = 0; k < BALANCE.champions.brunhild.unlock.at; k++) killAndNext(s, emit);
    expect(sel.championVisible(s, 'brunhild')).toBe(true);
    expect(ofType(events, 'championJoin')).toContainEqual({ type: 'championJoin', id: 'brunhild' });
  });
});

describe('levels', () => {
  it('cost gold (tier-scaled, growing per level); BUY_MAX buys as many as gold allows; all-or-nothing', () => {
    const s = withAldric();
    const b = BALANCE.champions.aldric;
    expect(championCost(s, 'aldric').toNumber()).toBe(b.baseCost);
    expect(championCost(s, 'aldric', 3).toNumber()).toBe(Math.ceil(b.baseCost * (1 + b.costGrowth + b.costGrowth ** 2) - 1e-9));
    const { events, emit } = recorder();
    s.gold = championCost(s, 'aldric', 3).sub(1);
    applyAction(s, { type: 'levelChampion', id: 'aldric', amount: 3 }, emit);
    expect(s.champions.aldric.level).toBe(1);
    expect(championMaxAffordable(s, 'aldric')).toBe(2);
    applyAction(s, { type: 'levelChampion', id: 'aldric', amount: BUY_MAX }, emit);
    expect(s.champions.aldric.level).toBe(3);
    expect(ofType(events, 'purchase')).toEqual([{ type: 'purchase', kind: 'champion', id: 'aldric', amount: 2 }]);
    expect(s.gold.lt(championCost(s, 'aldric'))).toBe(true);
    expect(sel.championAffordable(s, 'aldric')).toBe(false);
    // A champion who hasn't joined can't be levelled.
    s.gold = D(1e15);
    applyAction(s, { type: 'levelChampion', id: 'brunhild', amount: 1 }, noop);
    expect(s.champions.brunhild.level).toBe(0);
    // Costs scale with the tier.
    const m = inMountain(3);
    m.champions.aldric.level = 1;
    expect(championCost(m, 'aldric').toNumber()).toBe(b.baseCost * BALANCE.tiers[1]!.costMult);
  });
});

describe('damage', () => {
  it('a blow on every footman melee beat (even with no footmen), scaling with level', () => {
    const s = withAldric(4);
    tank(s);
    const { events, emit } = recorder();
    runFor(s, 3, emit);
    const hits = ofType(events, 'championHit');
    expect(hits.length).toBe(3); // the first newt idles 4 s
    expect(hits[0]!.id).toBe('aldric');
    expect(hits[0]!.damage.eq(championHit(s, 'aldric'))).toBe(true);
    expect(championHit(s, 'aldric').toNumber()).toBe(BALANCE.champions.aldric.damage);
    s.champions.aldric.level = 5;
    expect(championHit(s, 'aldric').toNumber()).toBe(BALANCE.champions.aldric.damage * 5);
    s.champions.aldric.level = 10; // a doubling every doubleEvery levels
    expect(championHit(s, 'aldric').toNumber()).toBe(BALANCE.champions.aldric.damage * 10 * 2);
    const b = BALANCE.champions.aldric;
    expect(championDps(s, 'aldric').toNumber()).toBeCloseTo(championHit(s, 'aldric').toNumber() * (1 / unitPeriod(s, 'footman') + b.specialMult / b.specialEvery), 6);
  });

  it('a special move every specialEvery s: specialMult × a blow, damage applied', () => {
    const s = withAldric(5);
    const { events, emit } = recorder();
    runUntil(s, () => ofType(events, 'championSpecial').length > 0, emit);
    expect(s.t).toBeGreaterThanOrEqual(BALANCE.champions.aldric.specialEvery - 1e-6);
    const sp = ofType(events, 'championSpecial')[0]!;
    expect(sp.id).toBe('aldric');
    expect(sp.damage.eq(championSpecialDamage(s, 'aldric')) || s.dragon.phase === 'stagger').toBe(true);
    expect(sp.damage.toNumber()).toBeGreaterThanOrEqual(championHit(s, 'aldric').toNumber() * BALANCE.champions.aldric.specialMult);
  });
});

describe('persistence', () => {
  it('champions keep their levels through a zoom, and the Fusion Bonus lifts their blows', () => {
    const s = withAldric(6);
    s.champions.aldric.level = 12;
    s.units.footman = 100;
    const before = championHit(s, 'aldric').toNumber();
    applyAction(s, { type: 'debug', op: 'cleared' }, noop);
    finishZoom(s);
    expect(s.tier).toBe(1);
    expect(s.champions.aldric.level).toBe(12);
    expect(championHit(s, 'aldric').toNumber()).toBeCloseTo(before * damageMult(s), 6);
    expect(damageMult(s)).toBeGreaterThan(1);
  });
});
