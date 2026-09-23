// M2: champions (Ser Aldric, Dame Brunhild), ARCHITECTURE §14.
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE, CHAMPION_TEXT } from './content';
import { D } from './decimal';
import { BUY_MAX, championBlowShare, championCost, championDps, championHit, championMaxAffordable, championSpecialDamage, championSpecialShare, unitPeriod } from './formulas';
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

describe('damage: a share of the current dragon\'s max HP', () => {
  it('a blow on every footman melee beat (even with no footmen): level 1 → mastery', () => {
    const s = withAldric(4);
    tank(s);
    const { events, emit } = recorder();
    runFor(s, 3, emit);
    const hits = ofType(events, 'championHit');
    expect(hits.length).toBe(3); // the first newt idles 4 s
    expect(hits[0]!.id).toBe('aldric');
    expect(hits[0]!.damage.eq(championHit(s, 'aldric'))).toBe(true);
    const b = BALANCE.champions.aldric;
    expect(championBlowShare(s, 'aldric')).toBe(b.blow[0]);
    expect(championHit(s, 'aldric').toNumber()).toBe(Math.ceil(s.dragon.maxHp.toNumber() * b.blow[0] - 1e-9));
    // Rises with level, gently, and stops at mastery.
    let prev = 0;
    for (let L = 1; L <= b.maxLevel; L++) {
      s.champions.aldric.level = L;
      const share = championBlowShare(s, 'aldric');
      expect(share).toBeGreaterThan(prev);
      prev = share;
    }
    expect(championBlowShare(s, 'aldric')).toBeCloseTo(b.blow[1], 12);
    expect(championSpecialShare(s, 'aldric')).toBeCloseTo(b.special[1], 12);
    s.champions.aldric.level = b.maxLevel + 5;
    expect(championBlowShare(s, 'aldric')).toBeCloseTo(b.blow[1], 12);
    // A blow never one-shots: even mastered, it's a small share.
    expect(b.blow[1]).toBeLessThan(0.02);
    expect(b.special[1]).toBeLessThanOrEqual(0.07);
    const dps = championHit(s, 'aldric').toNumber() / unitPeriod(s, 'footman') + championSpecialDamage(s, 'aldric').toNumber() / b.specialEvery;
    expect(championDps(s, 'aldric').toNumber() / dps).toBeCloseTo(1, 9);
  });

  it('counts in every tier and against bosses: the share of whatever dragon is on stage', () => {
    const m = inMountain(8);
    m.champions.aldric.level = 5;
    const share = championBlowShare(m, 'aldric');
    expect(championHit(m, 'aldric').toNumber()).toBeCloseTo(m.dragon.maxHp.toNumber() * share, -1);
    applyAction(m, { type: 'debug', op: 'boss' }, noop);
    killAndNext(m);
    expect(m.dragon.boss).toBe('grimmaw');
    expect(championHit(m, 'aldric').toNumber()).toBeCloseTo(m.dragon.maxHp.toNumber() * share, -3);
    expect(championSpecialDamage(m, 'aldric').gt(championHit(m, 'aldric'))).toBe(true);
  });

  it('a special move every specialEvery s visibly chunks the HP bar', () => {
    const s = withAldric(5);
    const { events, emit } = recorder();
    runUntil(s, () => ofType(events, 'championSpecial').length > 0, emit);
    expect(s.t).toBeGreaterThanOrEqual(BALANCE.champions.aldric.specialEvery - 1e-6);
    const sp = ofType(events, 'championSpecial')[0]!;
    expect(sp.id).toBe('aldric');
    const base = championSpecialDamage(s, 'aldric');
    expect(sp.damage.eq(base) || sp.damage.eq(base.mul(BALANCE.stagger.armyMult))).toBe(true);
    expect(base.toNumber() / s.dragon.maxHp.toNumber()).toBeGreaterThanOrEqual(BALANCE.champions.aldric.special[0] - 1e-9);
  });
});

describe('mastery', () => {
  it('levels stop at maxLevel: costs, BUY_MAX and affordability respect it', () => {
    const s = withAldric(7);
    const max = BALANCE.champions.aldric.maxLevel;
    s.gold = D('1e30');
    applyAction(s, { type: 'levelChampion', id: 'aldric', amount: max + 10 }, noop);
    expect(s.champions.aldric.level).toBe(1); // all-or-nothing: more levels than exist
    applyAction(s, { type: 'levelChampion', id: 'aldric', amount: BUY_MAX }, noop);
    expect(s.champions.aldric.level).toBe(max);
    expect(sel.championMastered(s, 'aldric')).toBe(true);
    expect(sel.championAffordable(s, 'aldric')).toBe(false);
    expect(championMaxAffordable(s, 'aldric')).toBe(0);
    const gold = s.gold;
    applyAction(s, { type: 'levelChampion', id: 'aldric', amount: 1 }, noop);
    expect(s.champions.aldric.level).toBe(max);
    expect(s.gold.eq(gold)).toBe(true);
  });
});

describe('persistence', () => {
  it('champions keep their levels through a zoom and strike the new tier\'s dragons at the same share', () => {
    const s = withAldric(6);
    s.champions.aldric.level = 12;
    const share = championBlowShare(s, 'aldric');
    applyAction(s, { type: 'debug', op: 'cleared' }, noop);
    finishZoom(s);
    expect(s.tier).toBe(1);
    expect(s.champions.aldric.level).toBe(12);
    expect(championBlowShare(s, 'aldric')).toBe(share);
    expect(championHit(s, 'aldric').toNumber()).toBe(Math.ceil(s.dragon.maxHp.toNumber() * share - 1e-9));
  });
});
