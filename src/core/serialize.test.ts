import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { applyAction } from './actions';
import { deserialize, fromJSON, serialize, toJSON } from './serialize';
import { createInitialState } from './state';
import { tick } from './tick';
import { TICK_DT } from './formulas';
import type { Action, GameEvent, GameState } from './types';
import { STATE_VERSION } from './state';
import { D } from './decimal';
import { finishZoom, runUntil } from './testing/helpers';

const noop = (_e: GameEvent): void => {};

describe('serialize / deserialize', () => {
  it('round-trips a fresh state exactly', () => {
    const s = createInitialState(123);
    const text = serialize(s);
    const back = deserialize(text);
    expect(serialize(back)).toBe(text);
    expect(back.gold).toBeInstanceOf(Decimal);
    expect(back.dragon.hp).toBeInstanceOf(Decimal);
    expect(back.dragon.maxHp.eq(s.dragon.maxHp)).toBe(true);
  });

  it('round-trips a played state, including volleys in flight and huge numbers', () => {
    const s = createInitialState(7);
    s.dragon.hp = s.dragon.maxHp = s.dragon.maxHp.mul(1e6);
    applyAction(s, { type: 'debug', op: 'units', unit: 'archer', amount: 12 }, noop);
    applyAction(s, { type: 'debug', op: 'units', unit: 'footman', amount: 30 }, noop);
    for (let i = 0; i < 57; i++) tick(s, TICK_DT, noop);
    s.gold = new Decimal('1.2345678901234567e308').mul('1e400');
    s.lifetimeGold = new Decimal(116); // toNumber() of 116 is lossy; the mantissa form is not
    expect(s.army.volleys.length).toBeGreaterThan(0);
    const text = serialize(s);
    const back = deserialize(text);
    expect(serialize(back)).toBe(text);
    expect(back.gold.exponent).toBe(708);
    expect(back.gold.mantissa).toBe(s.gold.mantissa);
    expect(back.lifetimeGold.eq(116)).toBe(true);
    expect(back.army.volleys[0]!.damage).toBeInstanceOf(Decimal);
  });

  it('continues identically after a save/load mid-game', () => {
    const a = createInitialState(99);
    applyAction(a, { type: 'debug', op: 'units', unit: 'footman', amount: 5 }, noop);
    for (let i = 0; i < 300; i++) tick(a, TICK_DT, noop);
    const b = deserialize(serialize(a));
    for (let i = 0; i < 600; i++) {
      tick(a, TICK_DT, noop);
      tick(b, TICK_DT, noop);
    }
    expect(serialize(b)).toBe(serialize(a));
  });

  it('serializes arbitrary values with Decimals (events, logs)', () => {
    const e = { type: 'dragonDeath', id: 3, gold: new Decimal('4.5e21') };
    const back = fromJSON<typeof e>(toJSON(e));
    expect(back.gold).toBeInstanceOf(Decimal);
    expect(back.gold.eq(e.gold)).toBe(true);
  });

  it('rejects foreign or future saves', () => {
    expect(() => deserialize('{"hello":1}')).toThrow();
    const s = JSON.parse(serialize(createInitialState(1))) as { v: number };
    s.v = 999;
    expect(() => deserialize(JSON.stringify(s))).toThrow(/version/);
  });
});

/** Every M2 field populated: a Mountain save mid-fight with a boss, abilities running, champions, lancers in flight. */
function m2State(): GameState {
  const s = createInitialState(21);
  applyAction(s, { type: 'debug', op: 'units', unit: 'footman', amount: 49 }, noop);
  applyAction(s, { type: 'debug', op: 'cleared' }, noop); // the first zoom begins at once
  finishZoom(s);
  s.champions.aldric = { level: 14, specialT: 3.25 };
  s.champions.brunhild = { level: 3, specialT: 1.5 };
  s.heraldry = { levels: { lion: 2, sun: 1, wyvern: 0, stag: 1, tower: 0, crown: 3 }, order: ['crown', 'lion', 'sun', 'stag'] };
  s.scales = D(17);
  s.flags['ability.volley'] = true;
  s.units.lancer = 12;
  s.units.archer = 30;
  applyAction(s, { type: 'debug', op: 'boss' }, noop);
  applyAction(s, { type: 'debug', op: 'kill' }, noop);
  runUntil(s, () => s.dragon.boss !== null && s.dragon.phase !== 'enter');
  s.dragon.hp = s.dragon.maxHp = s.dragon.maxHp.mul(1e9);
  applyAction(s, { type: 'useAbility', id: 'charge' }, noop);
  applyAction(s, { type: 'useAbility', id: 'volley' }, noop);
  for (let i = 0; i < 10; i++) tick(s, TICK_DT, noop);
  s.wyrm.escapes = 1;
  s.wyrm.clearedAt = 4;
  return s;
}

describe('schema v4 (M2)', () => {
  it('round-trips every M2 field exactly', () => {
    const s = m2State();
    expect(s.v).toBe(STATE_VERSION);
    expect(STATE_VERSION).toBe(4);
    expect(s.tier).toBe(1);
    expect(s.dragon.boss).toBe('grimmaw');
    expect(s.wyrm.bossT).toBeGreaterThan(0);
    expect(s.abilities.charge.active).toBeGreaterThan(0);
    expect(s.army.volleys.some((v) => v.ability)).toBe(true);
    expect(s.zoom.count).toBe(1);
    expect(s.zoom.fusion).toBeGreaterThan(1);
    expect(s.lifetimeScales.gt(0)).toBe(true);
    const text = serialize(s);
    const back = deserialize(text);
    expect(serialize(back)).toBe(text);
    expect(back.scales).toBeInstanceOf(Decimal);
    expect(back.lifetimeScales.eq(s.lifetimeScales)).toBe(true);
    expect(back.wyrm).toEqual(s.wyrm);
    expect(back.heraldry).toEqual(s.heraldry);
    expect(back.abilities).toEqual(s.abilities);
    expect(back.champions).toEqual(s.champions);
    expect(back.zoom).toEqual(JSON.parse(JSON.stringify(s.zoom)));
    expect(back.height).toBe(s.height);
    expect(back.units).toEqual(s.units);
    expect(back.army.cavalryT).toBe(s.army.cavalryT);
  });

  it('round-trips a pending zoom (mid-cinematic) and continues identically', () => {
    const a = createInitialState(22);
    applyAction(a, { type: 'debug', op: 'units', unit: 'footman', amount: 30 }, noop);
    applyAction(a, { type: 'debug', op: 'cleared' }, noop);
    expect(a.zoom.stage).toBe('begin');
    const b = deserialize(serialize(a));
    expect(b.zoom.pending!.scales).toBeInstanceOf(Decimal);
    expect(b.zoom.pending!.scales.eq(a.zoom.pending!.scales)).toBe(true);
    for (const s of [a, b]) {
      for (let i = 0; i < 40; i++) tick(s, TICK_DT, noop);
      finishZoom(s);
    }
    expect(serialize(b)).toBe(serialize(a));
  });

  it('continues identically after a save/load in the Mountain', () => {
    const a = m2State();
    const b = deserialize(serialize(a));
    for (let i = 0; i < 800; i++) {
      if (i % 7 === 0) for (const s of [a, b]) applyAction(s, { type: 'strike', weak: i % 21 === 0, aimed: true, x: 0, y: 0 }, noop);
      tick(a, TICK_DT, noop);
      tick(b, TICK_DT, noop);
    }
    expect(serialize(b)).toBe(serialize(a));
  });
});

describe('determinism through bosses and zooms', () => {
  it('same seed + same actions => the same state and events across a zoom', () => {
    const play = (seed: number): { state: string; events: string } => {
      const s = createInitialState(seed);
      const events: GameEvent[] = [];
      const emit = (e: GameEvent): void => {
        events.push(e);
      };
      let zoomAt = -1;
      for (let i = 0; i < 20 * 150; i++) {
        let a: Action | null = null;
        if (i === 5) a = { type: 'debug', op: 'units', unit: 'footman', amount: 300 };
        else if (i === 6) a = { type: 'debug', op: 'units', unit: 'archer', amount: 20 };
        else if (i === 10) a = { type: 'debug', op: 'boss' };
        else if (i % 3 === 0) a = { type: 'strike', weak: i % 9 === 0, aimed: true, x: 0, y: 0 };
        else if (i % 50 === 1) a = { type: 'useAbility', id: i % 100 === 1 ? 'charge' : 'rally' };
        else if (i % 60 === 2) a = { type: 'buyHeraldry', id: 'lion' };
        else if (i % 40 === 3) a = { type: 'levelChampion', id: 'aldric', amount: 1 };
        if (a) applyAction(s, a, emit);
        tick(s, TICK_DT, emit);
        if (s.zoom.stage === 'begin' && zoomAt < 0) zoomAt = i;
        if (zoomAt >= 0 && i === zoomAt + 100) finishZoom(s, emit);
      }
      expect(s.tier).toBe(1);
      return { state: serialize(s), events: toJSON(events) };
    };
    const a = play(31);
    expect(play(31)).toEqual(a);
    expect(play(32).state).not.toBe(a.state);
  });
});
