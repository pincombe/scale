// M2: lancers (the Mountain's cavalry) and the Mountain's upgrades, ARCHITECTURE §14.
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE, UNITS, UPGRADES } from './content';
import { MAX_RIDERS } from './army';
import { D } from './decimal';
import { tierCostMult, unitCost, unitDamage, unitPeriod } from './formulas';
import * as sel from './selectors';
import { createInitialState } from './state';
import { tick } from './tick';
import { TICK_DT } from './formulas';
import { inMountain, killAndNext, noop, ofType, recorder, runFor, runUntil, tank } from './testing/helpers';

describe('lancers', () => {
  it('are cavalry and unlock only in the Mountain, at its 6th kill', () => {
    expect(UNITS.lancer.kind).toBe('cavalry');
    const at = UNITS.lancer.unlock.at;
    expect(UNITS.lancer.unlock.tier).toBe(1);
    const m = createInitialState(1);
    m.kills = 40;
    tick(m, TICK_DT, noop);
    expect(sel.unitVisible(m, 'lancer')).toBe(false);
    const s = inMountain(1);
    const { events, emit } = recorder();
    for (let k = 0; k < at; k++) killAndNext(s, emit);
    expect(sel.unitVisible(s, 'lancer')).toBe(true);
    expect(ofType(events, 'unlock')).toContainEqual({ type: 'unlock', kind: 'unit', id: 'lancer' });
  });

  it('cost the tier\'s gold', () => {
    const s = inMountain(2);
    expect(unitCost(s, 'lancer').toNumber()).toBe(UNITS.lancer.baseCost * tierCostMult(1));
    expect(unitCost(s, 'footman').toNumber()).toBe(UNITS.footman.baseCost * tierCostMult(1));
  });

  it('charge every interval; the matching armyHit lands `travel` s later', () => {
    const s = inMountain(3);
    runUntil(s, () => s.dragon.phase !== 'enter');
    tank(s);
    s.units.lancer = 20;
    const { events, emit } = recorder();
    const charges: number[] = [];
    let hitAt = -1;
    for (let i = 0; i < 400 && charges.length < 2; i++) {
      tick(s, TICK_DT, (e) => {
        emit(e);
        if (e.type === 'cavalry') charges.push(i);
        if (e.type === 'armyHit' && e.unit === 'lancer' && hitAt < 0) hitAt = i;
      });
    }
    const c = ofType(events, 'cavalry')[0]!;
    expect(c).toEqual({ type: 'cavalry', unit: 'lancer', riders: Math.min(20, MAX_RIDERS), travel: UNITS.lancer.flight });
    expect((charges[1]! - charges[0]!) * TICK_DT).toBeCloseTo(unitPeriod(s, 'lancer'), 5);
    expect((hitAt - charges[0]!) * TICK_DT).toBeCloseTo(UNITS.lancer.flight, 5);
    const hit = ofType(events, 'armyHit').find((e) => e.unit === 'lancer')!;
    expect(hit.hits).toBe(MAX_RIDERS);
    const expected = unitDamage(s, 'lancer').mul(20).toNumber();
    expect(hit.damage.toNumber() === expected || hit.damage.toNumber() === expected * BALANCE.stagger.armyMult).toBe(true);
  });

  it('a charge whose target died, or that a hold overtook, lands on nothing', () => {
    const s = inMountain(4);
    runUntil(s, () => s.dragon.phase !== 'enter');
    tank(s);
    s.units.lancer = 3;
    const { events, emit } = recorder();
    runUntil(s, () => ofType(events, 'cavalry').length > 0, emit);
    applyAction(s, { type: 'debug', op: 'kill' }, emit);
    runFor(s, UNITS.lancer.flight + 0.5, emit);
    expect(ofType(events, 'armyHit').filter((e) => e.unit === 'lancer')).toEqual([]);
    // A hold drops what's in flight.
    const t = inMountain(5);
    runUntil(t, () => t.dragon.phase !== 'enter');
    tank(t);
    t.units.lancer = 3;
    runUntil(t, () => t.army.volleys.length > 0);
    t.wyrm.cleared = true;
    t.tier = 0; // pretend a next tier exists
    applyAction(t, { type: 'zoom', stage: 'begin' }, noop);
    expect(t.zoom.stage).toBe('begin');
    expect(t.army.volleys).toEqual([]);
  });
});

describe('the Mountain upgrades', () => {
  it('four to six, gated to tier 1, priced in the Mountain\'s gold', () => {
    const mountain = UPGRADES.filter((u) => u.tier === 1);
    expect(mountain.length).toBeGreaterThanOrEqual(4);
    expect(mountain.length).toBeLessThanOrEqual(6);
    for (const u of mountain) {
      expect(u.unlock.tier).toBe(1);
      expect(u.cost).toBe(Math.ceil(BALANCE.upgrades[u.id].cost * tierCostMult(1) - 1e-9));
      expect(u.name.length).toBeGreaterThan(0);
      expect(u.flavor.length).toBeGreaterThan(0);
    }
    // Not offered in the Meadow, whatever the kill count.
    const m = createInitialState(1);
    m.kills = 100;
    m.units.lancer = 50;
    m.units.archer = 50;
    tick(m, TICK_DT, noop);
    for (const u of mountain) expect(m.flags[u.unlockFlag]).toBeUndefined();
  });

  it('persist through the zoom (the Meadow set stays bought)', () => {
    const s = createInitialState(1);
    s.upgrades['drillSergeant'] = 1;
    s.units.footman = 1;
    const d = unitDamage(s, 'footman').toNumber();
    applyAction(s, { type: 'debug', op: 'cleared' }, noop);
    applyAction(s, { type: 'zoom', stage: 'switch' }, noop);
    expect(s.upgrades['drillSergeant']).toBe(1);
    s.units.footman = 1;
    expect(unitDamage(s, 'footman').toNumber()).toBeCloseTo(d * s.zoom.fusion, 9);
    // Lancer upgrades work on lancers.
    s.units.lancer = 1;
    const l = unitDamage(s, 'lancer').toNumber();
    s.upgrades['couchedLances'] = 1;
    const couched = BALANCE.upgrades.couchedLances.effect;
    expect(unitDamage(s, 'lancer').toNumber()).toBeCloseTo(l * (couched.kind === 'unitMult' ? couched.mult : NaN), 9);
    const p = unitPeriod(s, 'lancer');
    s.upgrades['destriers'] = 1;
    const destriers = BALANCE.upgrades.destriers.effect;
    expect(unitPeriod(s, 'lancer')).toBeCloseTo(p * (destriers.kind === 'periodMult' ? destriers.mult : NaN), 9);
    s.gold = D(0);
  });
});
