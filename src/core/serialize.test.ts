import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { applyAction } from './actions';
import { deserialize, fromJSON, serialize, toJSON } from './serialize';
import { createInitialState } from './state';
import { tick } from './tick';
import { TICK_DT } from './formulas';
import type { GameEvent } from './types';

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
