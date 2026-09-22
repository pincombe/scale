import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE, UNITS } from './content';
import { D } from './decimal';
import { TICK_DT, armyDps, clickDamage, dyingDuration, enterDuration, killGold, unitCost, unitDamage } from './formulas';
import * as sel from './selectors';
import { createInitialState } from './state';
import { tick } from './tick';
import type { GameEvent } from './types';

const noop = (_e: GameEvent): void => {};

describe('selectors', () => {
  it('unit visibility and affordability follow flags and gold', () => {
    const s = createInitialState(1);
    expect(sel.unitVisible(s, 'footman')).toBe(false);
    expect(sel.unitAffordable(s, 'footman')).toBe(false);
    s.flags['unit.footman'] = true;
    expect(sel.unitAffordable(s, 'footman')).toBe(false);
    s.gold = unitCost(s, 'footman', 10);
    expect(sel.unitAffordable(s, 'footman')).toBe(true);
    expect(sel.unitAffordable(s, 'footman', 10)).toBe(true);
    expect(sel.unitAffordable(s, 'footman', 11)).toBe(false);
    expect(sel.unitAffordable(s, 'footman', -1)).toBe(true); // "max": at least one
    expect(sel.maxAffordable(s, 'footman')).toBe(10);
  });

  it('nextMilestone counts down to the next doubling, forever', () => {
    const s = createInitialState(1);
    expect(sel.nextMilestone(s, 'archer')).toEqual({ at: 10, mult: 2, remaining: 10, frac: 0 });
    s.units.archer = 20;
    expect(sel.nextMilestone(s, 'archer')).toEqual({ at: 25, mult: 2, remaining: 5, frac: 10 / 15 });
    s.units.archer = 100_000;
    const m = sel.nextMilestone(s, 'archer');
    expect(m.at).toBeGreaterThan(100_000);
    expect(m.remaining).toBeLessThanOrEqual(BALANCE.milestones.every);
  });

  it('upgrades: visible once flagged, hidden once owned, affordable with gold', () => {
    const s = createInitialState(1);
    expect(sel.upgradeVisible(s, 'pointySwords')).toBe(false);
    expect(sel.visibleUpgrades(s)).toEqual([]);
    s.flags['upgrade.pointySwords'] = true;
    s.flags['upgrade.keenEye'] = true;
    expect(sel.visibleUpgrades(s).map((u) => u.id)).toEqual(['pointySwords', 'keenEye']);
    expect(sel.upgradeAffordable(s, 'pointySwords')).toBe(false);
    s.gold = D(BALANCE.upgrades.pointySwords.cost);
    expect(sel.upgradeAffordable(s, 'pointySwords')).toBe(true);
    expect(sel.anythingAffordable(s)).toBe(true);
    applyAction(s, { type: 'buyUpgrade', id: 'pointySwords' }, noop);
    expect(sel.upgradeOwned(s, 'pointySwords')).toBe(true);
    expect(sel.upgradeVisible(s, 'pointySwords')).toBe(false);
    expect(sel.anythingAffordable(s)).toBe(false);
    expect(sel.upgradeVisible(s, 'nonsense')).toBe(false);
  });

  it('requirementProgress reports how close an unlock is', () => {
    const s = createInitialState(1);
    s.units.footman = 2;
    expect(sel.requirementProgress(s, { stat: 'footman', at: 5 })).toBeCloseTo(0.4, 9);
    s.kills = 99;
    expect(sel.requirementProgress(s, { stat: 'kills', at: 3 })).toBe(1);
  });

  it('DPS, click damage and click DPS', () => {
    const s = createInitialState(1);
    s.units.footman = 3;
    s.units.archer = 2;
    const expected = unitDamage(s, 'footman').mul(3 / UNITS.footman.interval).add(unitDamage(s, 'archer').mul(2 / UNITS.archer.interval));
    expect(sel.armyDps(s).toNumber()).toBeCloseTo(expected.toNumber(), 9);
    expect(sel.clickDamage(s, true).eq(clickDamage(s, false).mul(5))).toBe(true);
    expect(sel.clickDps(s, 0).eq(0)).toBe(true);
    expect(sel.clickDps(s, 6, 0.3).toNumber()).toBeCloseTo(6 * 0.7 * 1 + 6 * 0.3 * 5, 9);
  });

  it('goldPerSec estimates kill income including downtime', () => {
    const s = createInitialState(1);
    expect(sel.goldPerSec(s).eq(0)).toBe(true); // no army, no clicks
    s.units.footman = 10;
    const dps = armyDps(s).toNumber();
    const killTime = s.dragon.maxHp.toNumber() / dps + dyingDuration(s.dragon.size) + enterDuration(s.dragon.size);
    expect(sel.goldPerSec(s).toNumber()).toBeCloseTo(killGold(s).toNumber() / killTime, 9);
    expect(sel.goldPerSec(s, 6, 0.3).gt(sel.goldPerSec(s))).toBe(true);
  });

  it('dragonInfo summarizes the current dragon', () => {
    const s = createInitialState(3);
    applyAction(s, { type: 'strike', weak: false, aimed: true, x: 0, y: 0 }, noop);
    const info = sel.dragonInfo(s);
    expect(info.name).toBe(s.dragon.name);
    expect(info.hpFrac).toBeCloseTo(0.9, 9);
    expect(info.sizeWord.length).toBeGreaterThan(0);
    expect(info.reward.eq(killGold(s))).toBe(true);
    expect(info.staggerReward.eq(killGold(s).mul(BALANCE.stagger.goldFrac).ceil())).toBe(true);
    applyAction(s, { type: 'debug', op: 'kill' }, noop);
    expect(sel.dragonInfo(s).hpFrac).toBe(0);
    for (let i = 0; i < 40; i++) tick(s, TICK_DT, noop);
    expect(sel.dragonInfo(s).kills).toBe(1);
  });
});
