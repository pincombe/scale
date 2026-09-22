import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE, PHASE, UNITS, UPGRADES, UPGRADE_IDS } from './content';
import { UPGRADE_TEXT } from './content/text';
import { D, Decimal } from './decimal';
import { fmt } from './format';
import {
  BUY_MAX,
  TICK_DT,
  armyDps,
  clickDamage,
  dragonGold,
  dragonMaxHp,
  dragonSize,
  killGold,
  maxAffordable,
  milestoneAt,
  milestoneCount,
  milestoneMult,
  unitCost,
  unitDamage,
  unitDps,
  unitPeriod,
  upgradeCost,
  weakMult,
  wholeCeil,
  wholeNumber,
} from './formulas';
import { UNLOCK_FLAGS } from './progress';
import { deserialize, serialize } from './serialize';
import { createInitialState } from './state';
import { tick } from './tick';
import type { EventOf, GameEvent, GameEventType, GameState, UpgradeId } from './types';

function recorder(): { events: GameEvent[]; emit: (e: GameEvent) => void } {
  const events: GameEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

function ofType<T extends GameEventType>(events: GameEvent[], type: T): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

const noop = (): void => {};

/** A state with a practically unkillable dragon (for measuring damage). */
function tank(seed = 1): GameState {
  const s = createInitialState(seed);
  s.dragon.hp = s.dragon.maxHp = dragonMaxHp(0, 0).mul(1e12);
  return s;
}

function own(s: GameState, id: UpgradeId): void {
  s.upgrades[id] = 1;
}

describe('dragon curves', () => {
  it('the tutorial newt has 10 HP and pays for exactly one footman', () => {
    expect(dragonMaxHp(0, 0).eq(10)).toBe(true);
    expect(dragonGold(0, 0).eq(UNITS.footman.baseCost)).toBe(true);
  });

  it('HP, gold and size grow with every dragon, and HP stays whole', () => {
    for (let i = 1; i < 120; i++) {
      expect(dragonMaxHp(0, i).gt(dragonMaxHp(0, i - 1))).toBe(true);
      expect(dragonGold(0, i).gte(dragonGold(0, i - 1))).toBe(true);
      expect(dragonSize(0, i)).toBeGreaterThan(dragonSize(0, i - 1));
      if (i < 40) expect(dragonMaxHp(0, i).eq(dragonMaxHp(0, i).round())).toBe(true);
    }
    // Growth per kill fades from early to late and never drops below the late ratio.
    const ratio = (i: number): number => dragonMaxHp(0, i + 1).div(dragonMaxHp(0, i)).toNumber();
    expect(ratio(1)).toBeGreaterThan(ratio(30));
    expect(ratio(200)).toBeCloseTo(BALANCE.dragon.hpGrowthLate, 3);
  });

  it('size passes through the anchors: newt, dog, horse, barn', () => {
    for (const [i, m] of BALANCE.dragon.sizeAnchors) expect(dragonSize(0, i)).toBeCloseTo(m, 9);
    expect(dragonSize(0, 0)).toBe(0.5);
  });

  it('gold is HP × goldPerHp, and tiers multiply both', () => {
    expect(dragonGold(0, 12).toNumber()).toBeCloseTo(dragonMaxHp(0, 12).toNumber() * BALANCE.dragon.goldPerHp, -1);
    // Tier-0 HP is rounded to whole numbers (~4e3 at index 20), so the ratio is only good to ~1e-4.
    expect(dragonMaxHp(1, 20).div(dragonMaxHp(0, 20)).toNumber() / BALANCE.dragon.tierHpMult).toBeCloseTo(1, 3);
  });

  it('names come from dragonName() and are deterministic per seed', () => {
    const a = createInitialState(77);
    const b = createInitialState(77);
    expect(a.dragon.species).toBe('newt');
    expect(a.dragon.name.length).toBeGreaterThan(0);
    expect(a.dragon.name).toBe(b.dragon.name);
    expect(a.dragon.epithet).toBe(b.dragon.epithet);
    const names = new Set<string>();
    for (let seed = 1; seed < 40; seed++) names.add(createInitialState(seed).dragon.name);
    expect(names.size).toBeGreaterThan(3);
  });
});

describe('unit costs', () => {
  it('buying N costs the geometric series sum', () => {
    const s = createInitialState(1);
    s.units.footman = 7;
    const { baseCost, costGrowth } = UNITS.footman;
    let sum = 0;
    for (let k = 0; k < 10; k++) sum += baseCost * Math.pow(costGrowth, 7 + k);
    expect(unitCost(s, 'footman', 10).toNumber()).toBe(Math.ceil(sum - 1e-9));
    expect(unitCost(s, 'footman', 1).toNumber()).toBe(Math.ceil(baseCost * Math.pow(costGrowth, 7) - 1e-9));
  });

  it('cost growth is within the 1.07–1.15 band', () => {
    for (const u of Object.values(UNITS)) {
      expect(u.costGrowth).toBeGreaterThanOrEqual(1.07);
      expect(u.costGrowth).toBeLessThanOrEqual(1.15);
    }
  });

  it('buyUnit 10 = ten single buys (within rounding), and emits one purchase', () => {
    const a = createInitialState(1);
    const b = createInitialState(1);
    for (const s of [a, b]) {
      s.flags['unit.footman'] = true;
      applyAction(s, { type: 'debug', op: 'gold', amount: 1e4 }, noop);
    }
    const { events, emit } = recorder();
    applyAction(a, { type: 'buyUnit', unit: 'footman', amount: 10 }, emit);
    for (let i = 0; i < 10; i++) applyAction(b, { type: 'buyUnit', unit: 'footman', amount: 1 }, noop);
    expect(a.units.footman).toBe(10);
    expect(b.units.footman).toBe(10);
    expect(Math.abs(a.gold.sub(b.gold).toNumber())).toBeLessThanOrEqual(10);
    expect(ofType(events, 'purchase')).toEqual([{ type: 'purchase', kind: 'unit', id: 'footman', amount: 10 }]);
  });

  it('BUY_MAX buys exactly as many as the gold covers', () => {
    const s = createInitialState(1);
    s.flags['unit.archer'] = true;
    s.gold = unitCost(s, 'archer', 13).add(1);
    expect(maxAffordable(s, 'archer')).toBe(13);
    const { events, emit } = recorder();
    applyAction(s, { type: 'buyUnit', unit: 'archer', amount: BUY_MAX }, emit);
    expect(s.units.archer).toBe(13);
    expect(s.gold.lt(unitCost(s, 'archer', 1))).toBe(true);
    expect(ofType(events, 'purchase')[0]!.amount).toBe(13);
    expect(ofType(events, 'milestone').map((e) => e.owned)).toEqual([10]);
  });

  it('maxAffordable is exact at the boundary and 0 when broke', () => {
    const s = createInitialState(1);
    s.units.footman = 30;
    expect(maxAffordable(s, 'footman')).toBe(0);
    for (const n of [1, 2, 5, 37]) {
      s.gold = unitCost(s, 'footman', n);
      expect(maxAffordable(s, 'footman')).toBe(n);
      s.gold = s.gold.sub(1);
      expect(maxAffordable(s, 'footman')).toBe(n - 1);
    }
    s.gold = dragonMaxHp(0, 0).mul('1e300');
    expect(maxAffordable(s, 'footman')).toBeGreaterThan(1000);
  });

  it('buying is all-or-nothing and needs the unlock', () => {
    const s = createInitialState(1);
    applyAction(s, { type: 'debug', op: 'gold', amount: 15 }, noop);
    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: 1 }, noop);
    expect(s.units.footman).toBe(0);
    s.flags['unit.footman'] = true;
    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: 10 }, noop);
    expect(s.units.footman).toBe(0);
    expect(s.gold.eq(15)).toBe(true);
    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: 0 }, noop);
    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: NaN }, noop);
    expect(s.units.footman).toBe(0);
  });
});

describe('milestones', () => {
  it('each threshold doubles that unit type', () => {
    const mult = (n: number): number => milestoneMult(n).toNumber();
    expect(mult(9)).toBe(1);
    expect(mult(10)).toBe(2);
    expect(mult(25)).toBe(4);
    expect(mult(50)).toBe(8);
    expect(mult(100)).toBe(16);
    expect(BALANCE.milestones.at.slice(0, 4)).toEqual([10, 25, 50, 100]);
    const s = createInitialState(1);
    s.units.footman = 24;
    const before = unitDamage(s, 'footman');
    s.units.footman = 25;
    expect(unitDamage(s, 'footman').div(before).toNumber()).toBe(2);
    expect(unitDamage(s, 'archer').eq(UNITS.archer.damage)).toBe(true); // per type
  });

  it('a big purchase crossing several thresholds emits each one', () => {
    const s = createInitialState(1);
    s.flags['unit.footman'] = true;
    s.gold = unitCost(s, 'footman', 60);
    const { events, emit } = recorder();
    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: 60 }, emit);
    expect(ofType(events, 'milestone').map((e) => [e.owned, e.mult])).toEqual([
      [10, 2],
      [25, 2],
      [50, 2],
    ]);
  });
});

describe('huge numbers', () => {
  it('milestones keep stacking past the listed ones, in Decimal (no Infinity)', () => {
    const listed = BALANCE.milestones.at;
    const last = listed[listed.length - 1]!;
    expect(milestoneCount(last)).toBe(listed.length);
    expect(milestoneCount(last + BALANCE.milestones.every)).toBe(listed.length + 1);
    expect(milestoneAt(listed.length)).toBe(last + BALANCE.milestones.every);
    for (let k = 0; k < 30; k++) expect(milestoneCount(milestoneAt(k))).toBe(k + 1);
    const s = createInitialState(1);
    s.units.footman = 200_000; // ~2,000 milestones: 2^2000 overflows doubles
    const dmg = unitDamage(s, 'footman');
    expect(dmg.exponent).toBeGreaterThan(600);
    expect(Number.isFinite(dmg.mantissa)).toBe(true);
    expect(armyDps(s).gt(dmg)).toBe(true);
  });

  it('costs are clean whole numbers and fmt never shows float noise', () => {
    const s = createInitialState(1);
    for (let owned = 0; owned < 400; owned += 7) {
      s.units.archer = owned;
      for (const n of [1, 10, 25]) {
        const c = unitCost(s, 'archer', n);
        if (c.lt(1e15)) {
          expect(wholeNumber(c)).toBe(Math.round(wholeNumber(c)));
          expect(c.eq(D(wholeNumber(c)))).toBe(true); // canonical integer Decimal
        }
        expect(fmt(c)).toMatch(/^\d{1,3}(\.\d{1,2})?([A-Za-z]{1,2}|e\d+)?$/);
      }
    }
    expect(fmt(D(851860))).toBe('852K');
    expect(fmt(D(116).mul(1.0000000000001))).toBe('116');
    expect(fmt(D(12).add(1e-12))).toBe('12');
    expect(wholeCeil(D(851859.9999999999)).eq(D(851860))).toBe(true);
    expect(wholeCeil(D(12.2)).eq(13)).toBe(true);
  });
});

describe('upgrades', () => {
  it('all nine exist with text, costs and unlock rules', () => {
    expect(UPGRADE_IDS.length).toBe(9);
    for (const u of UPGRADES) {
      expect(UPGRADE_TEXT[u.id].name.length).toBeGreaterThan(0);
      expect(u.cost).toBeGreaterThan(0);
      expect(upgradeCost(u.id)!.eq(u.cost)).toBe(true);
      expect(u.unlockFlag).toBe('upgrade.' + u.id);
    }
    expect(upgradeCost('nope')).toBeNull();
  });

  it('pointySwords ×2 and grindstone ×3 click damage', () => {
    const s = tank();
    expect(clickDamage(s, false).eq(1)).toBe(true);
    own(s, 'pointySwords');
    expect(clickDamage(s, false).eq(2)).toBe(true);
    own(s, 'grindstone');
    expect(clickDamage(s, false).eq(6)).toBe(true);
  });

  it('keenEye raises the weak-spot crit from ×5 to ×10', () => {
    const s = tank();
    expect(weakMult(s)).toBe(5);
    expect(clickDamage(s, true).eq(5)).toBe(true);
    own(s, 'keenEye');
    expect(clickDamage(s, true).eq(10)).toBe(true);
  });

  it('drillSergeant ×2 footmen, fletching ×2 archers, warHorns ×1.5 everyone', () => {
    const s = tank();
    s.units.footman = 3;
    s.units.archer = 2;
    const f = unitDps(s, 'footman').toNumber();
    const a = unitDps(s, 'archer').toNumber();
    own(s, 'drillSergeant');
    expect(unitDps(s, 'footman').toNumber()).toBeCloseTo(f * 2, 9);
    expect(unitDps(s, 'archer').toNumber()).toBeCloseTo(a, 9);
    own(s, 'fletching');
    expect(unitDps(s, 'archer').toNumber()).toBeCloseTo(a * 2, 9);
    own(s, 'warHorns');
    expect(unitDps(s, 'footman').toNumber()).toBeCloseTo(f * 3, 9);
    expect(unitDps(s, 'archer').toNumber()).toBeCloseTo(a * 3, 9);
  });

  it('quickNock shortens the volley period to 70%', () => {
    const s = tank();
    s.units.archer = 1;
    const dps = unitDps(s, 'archer').toNumber();
    own(s, 'quickNock');
    expect(unitPeriod(s, 'archer')).toBeCloseTo(UNITS.archer.interval * 0.7, 9);
    expect(unitDps(s, 'archer').toNumber()).toBeCloseTo(dps / 0.7, 9);
    const { events, emit } = recorder();
    for (let i = 0; i < Math.round(20 / TICK_DT); i++) tick(s, TICK_DT, emit);
    // 20 s of volleys at 1.75 s instead of 2.5 s.
    expect(ofType(events, 'volley').length).toBe(Math.floor((20 - UNITS.archer.interval) / (UNITS.archer.interval * 0.7)) + 1);
  });

  it('bounty pays ×1.5 kill gold (and a bigger stagger bonus)', () => {
    const s = createInitialState(1);
    applyAction(s, { type: 'debug', op: 'dragon', amount: 12 }, noop);
    const base = killGold(s);
    own(s, 'bounty');
    expect(killGold(s).toNumber()).toBeCloseTo(base.toNumber() * 1.5, -1);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'kill' }, emit);
    expect(ofType(events, 'dragonDeath')[0]!.gold.eq(killGold(s))).toBe(true);
  });

  it('heroicExample adds a share of army DPS to every click, and the crit multiplies it', () => {
    const s = tank();
    s.units.footman = 40;
    s.units.archer = 12;
    const army = armyDps(s);
    own(s, 'heroicExample');
    const e = BALANCE.upgrades.heroicExample.effect;
    const share = e.kind === 'clickArmyShare' ? e.share : NaN;
    expect(share).toBeGreaterThan(0);
    expect(clickDamage(s, false).toNumber()).toBeCloseTo(1 + army.toNumber() * share, 6);
    expect(clickDamage(s, true).toNumber()).toBeCloseTo((1 + army.toNumber() * share) * 5, 6);
  });

  it('click upgrades multiply the whole strike, heroicExample share included', () => {
    const s = tank();
    s.units.footman = 40;
    s.units.archer = 12;
    own(s, 'heroicExample');
    const plain = clickDamage(s, false).toNumber();
    own(s, 'pointySwords');
    own(s, 'grindstone');
    expect(clickDamage(s, false).toNumber()).toBeCloseTo(plain * 6, 6);
    own(s, 'keenEye');
    expect(clickDamage(s, true).toNumber()).toBeCloseTo(plain * 6 * 10, 6);
  });

  it('upgrades need their flag and the gold, and never double-buy', () => {
    const s = createInitialState(1);
    s.gold = upgradeCost('keenEye')!.mul(3);
    applyAction(s, { type: 'buyUpgrade', id: 'keenEye' }, noop);
    expect(s.upgrades['keenEye']).toBe(0);
    s.flags['upgrade.keenEye'] = true;
    applyAction(s, { type: 'buyUpgrade', id: 'keenEye' }, noop);
    applyAction(s, { type: 'buyUpgrade', id: 'keenEye' }, noop);
    expect(s.upgrades['keenEye']).toBe(1);
    expect(s.gold.eq(upgradeCost('keenEye')!.mul(2))).toBe(true);
    applyAction(s, { type: 'buyUpgrade', id: 'bogus' }, noop);
    expect(s.upgrades['bogus']).toBeUndefined();
  });
});

describe('dragon phases', () => {
  it('a fresh dragon idles only briefly after its entrance, then winds up', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'next' }, emit);
    const phases: [string, number][] = [];
    for (let i = 0; i < Math.round((PHASE.enter + PHASE.idleAfterEnter + 0.2) / TICK_DT); i++) {
      const n = events.length;
      tick(s, TICK_DT, emit);
      for (const e of events.slice(n)) if (e.type === 'dragonPhase') phases.push([e.phase, e.dur]);
    }
    expect(phases.map((p) => p[0])).toEqual(['idle', 'windup']);
    expect(phases[0]![1]).toBe(PHASE.idleAfterEnter);
    expect(PHASE.idleAfterEnter).toBeLessThan(PHASE.idleMin);
  });
});

describe('stagger', () => {
  it('a weak hit during windup stuns ~2 s, pays half the kill reward and doubles army damage', () => {
    const s = tank();
    s.units.footman = 4;
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'phase', phase: 'windup', attack: 'breath' }, emit);
    applyAction(s, { type: 'strike', weak: true, aimed: true, x: 0, y: 0 }, emit);
    expect(s.dragon.phase).toBe('stagger');
    expect(s.dragon.phaseDur).toBe(PHASE.stagger);
    expect(PHASE.stagger).toBeGreaterThanOrEqual(1.5);
    expect(s.stats.staggers).toBe(1);
    const bonus = ofType(events, 'goldGain')[0]!;
    expect(bonus.source).toBe('stagger');
    expect(bonus.amount.eq(killGold(s).mul(BALANCE.stagger.goldFrac).ceil())).toBe(true);
    for (let i = 0; i < Math.round(1.5 / TICK_DT); i++) tick(s, TICK_DT, emit);
    const hit = ofType(events, 'armyHit')[0]!;
    expect(hit.damage.eq(unitDamage(s, 'footman').mul(4).mul(2))).toBe(true);
  });

  it('only the first stagger of a dragon pays the full bonus; later ones pay a little', () => {
    const s = tank();
    const { events, emit } = recorder();
    const staggerOnce = (): void => {
      applyAction(s, { type: 'debug', op: 'phase', phase: 'windup', attack: 'swipe' }, emit);
      applyAction(s, { type: 'strike', weak: true, aimed: true, x: 0, y: 0 }, emit);
    };
    staggerOnce();
    staggerOnce();
    staggerOnce();
    expect(s.dragon.staggers).toBe(3);
    expect(s.stats.staggers).toBe(3);
    const bonuses = ofType(events, 'goldGain').map((e) => e.amount);
    expect(bonuses.length).toBe(3);
    expect(bonuses[0]!.eq(killGold(s).mul(BALANCE.stagger.goldFrac).ceil())).toBe(true);
    expect(bonuses[1]!.eq(killGold(s).mul(BALANCE.stagger.repeatGoldFrac).ceil())).toBe(true);
    expect(bonuses[2]!.eq(bonuses[1]!)).toBe(true);
    expect(BALANCE.stagger.repeatGoldFrac).toBeLessThan(BALANCE.stagger.goldFrac);
    // The next dragon starts fresh.
    applyAction(s, { type: 'debug', op: 'next' }, emit);
    expect(s.dragon.staggers).toBe(0);
    s.dragon.hp = s.dragon.maxHp = s.dragon.maxHp.mul(1e12);
    staggerOnce();
    expect(ofType(events, 'goldGain')[3]!.amount.eq(killGold(s).mul(BALANCE.stagger.goldFrac).ceil())).toBe(true);
  });

  it('a killing blow is never also a stagger, even where huge-HP rounding is tight', () => {
    const base = BALANCE.click.base;
    try {
      // A weak click of ~5.76e16 against HP one ulp above it: hp > damage by compare, yet
      // break_infinity's hp - damage rounds to 0, so damageDragon kills. The blow must not stagger.
      BALANCE.click.base = 1.151075441524737e16;
      const s = createInitialState(1);
      const { events, emit } = recorder();
      applyAction(s, { type: 'debug', op: 'phase', phase: 'windup', attack: 'breath' }, emit);
      const damage = clickDamage(s, true);
      const hp = Decimal.fromMantissaExponent(damage.mantissa + 4 * Number.EPSILON, damage.exponent);
      expect(hp.lte(damage)).toBe(false);
      expect(hp.sub(damage).gt(0)).toBe(false);
      s.dragon.hp = s.dragon.maxHp = hp;
      applyAction(s, { type: 'strike', weak: true, aimed: true, x: 0, y: 0 }, emit);
      expect(s.dragon.phase).toBe('dying');
      expect(ofType(events, 'strike')[0]!.stagger).toBe(false);
      expect(ofType(events, 'goldGain').length).toBe(0);
      expect(s.stats.staggers).toBe(0);
    } finally {
      BALANCE.click.base = base;
    }
  });

  it('volleys landing on a staggered dragon hit twice as hard', () => {
    const s = tank();
    s.units.archer = 3;
    const { events, emit } = recorder();
    // Tick until a volley is in flight, then stagger the dragon before it lands.
    while (s.army.volleys.length === 0) tick(s, TICK_DT, emit);
    applyAction(s, { type: 'debug', op: 'phase', phase: 'stagger' }, emit);
    while (ofType(events, 'armyHit').length === 0) tick(s, TICK_DT, emit);
    expect(ofType(events, 'armyHit')[0]!.damage.eq(unitDamage(s, 'archer').mul(3 * 2))).toBe(true);
  });

  it('weak hits outside windup crit without staggering; a killing weak hit just kills', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'phase', phase: 'windup', attack: 'swipe' }, emit);
    s.dragon.hp = s.dragon.maxHp = clickDamage(s, true);
    applyAction(s, { type: 'strike', weak: true, aimed: true, x: 0, y: 0 }, emit);
    expect(ofType(events, 'strike')[0]!.stagger).toBe(false);
    expect(s.dragon.phase).toBe('dying');
    expect(ofType(events, 'goldGain').length).toBe(0);
  });
});

describe('volleys', () => {
  it('arrows loosed at a dragon never hit the next one, whatever the timings', () => {
    const flight = BALANCE.units.archer.flight;
    BALANCE.units.archer.flight = BALANCE.phase.dying + BALANCE.phase.enter + 1; // outlives the corpse
    try {
      const s = createInitialState(1);
      s.units.archer = 5;
      const { events, emit } = recorder();
      while (s.army.volleys.length === 0) tick(s, TICK_DT, emit);
      const firstId = s.dragon.id;
      expect(s.army.volleys[0]!.target).toBe(firstId);
      applyAction(s, { type: 'debug', op: 'kill' }, emit);
      for (let i = 0; i < Math.round((BALANCE.units.archer.flight + 0.5) / TICK_DT); i++) tick(s, TICK_DT, emit);
      expect(s.dragon.id).not.toBe(firstId);
      expect(ofType(events, 'armyHit').filter((e) => e.unit === 'archer').length).toBe(0);
      expect(s.dragon.hp.eq(s.dragon.maxHp)).toBe(true);
    } finally {
      BALANCE.units.archer.flight = flight;
    }
  });
});

describe('progressive disclosure', () => {
  it('starts with nothing revealed, then unlocks step by step with one event each', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    expect(Object.keys(s.flags)).toEqual([]);
    tick(s, TICK_DT, emit);
    expect(ofType(events, 'unlock')).toEqual([]);

    applyAction(s, { type: 'strike', weak: false, aimed: true, x: 0, y: 0 }, emit);
    tick(s, TICK_DT, emit);
    expect(s.flags['feature.dragonBar']).toBe(true);
    expect(s.flags['feature.gold']).toBeUndefined();

    applyAction(s, { type: 'debug', op: 'kill' }, emit);
    tick(s, TICK_DT, emit);
    expect(s.flags['feature.gold']).toBe(true);
    expect(s.flags['unit.footman']).toBe(true);
    expect(s.flags['feature.panel']).toBeUndefined(); // just the one "Hire a Footman" button
    expect(s.flags['unit.archer']).toBeUndefined();

    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: 1 }, emit);
    tick(s, TICK_DT, emit);
    expect(s.flags['upgrade.pointySwords']).toBe(true);
    expect(s.flags['feature.panel']).toBe(true);

    s.kills = UNITS.archer.unlock.at;
    tick(s, TICK_DT, emit);
    expect(s.flags['unit.archer']).toBe(true);
    for (let i = 0; i < 20; i++) tick(s, TICK_DT, emit);

    const ids = ofType(events, 'unlock').map((e) => e.kind + '.' + e.id);
    expect(new Set(ids).size).toBe(ids.length); // never twice
    expect(ids.slice(0, 5)).toEqual(['feature.dragonBar', 'feature.gold', 'unit.footman', 'upgrade.pointySwords', 'feature.panel']);
  });

  it('every upgrade appears when its requirement is met', () => {
    for (const u of UPGRADES) {
      const s = createInitialState(1);
      const r = u.unlock;
      if (r.stat === 'kills') s.kills = r.at - 1;
      else s.units[r.stat] = r.at - 1;
      tick(s, TICK_DT, noop);
      expect(s.flags[u.unlockFlag]).toBeUndefined();
      if (r.stat === 'kills') s.kills = r.at;
      else s.units[r.stat] = r.at;
      tick(s, TICK_DT, noop);
      expect(s.flags[u.unlockFlag]).toBe(true);
    }
  });

  it('documents every flag it can set', () => {
    expect(UNLOCK_FLAGS).toContain('feature.panel');
    expect(UNLOCK_FLAGS).toContain('unit.archer');
    for (const id of UPGRADE_IDS) expect(UNLOCK_FLAGS).toContain('upgrade.' + id);
  });
});

describe('saves', () => {
  it('round-trips a mid-game state with upgrades, stats and flags, then continues identically', () => {
    const a = createInitialState(5);
    a.flags['unit.footman'] = a.flags['unit.archer'] = true;
    applyAction(a, { type: 'debug', op: 'gold', amount: 1e7 }, noop);
    applyAction(a, { type: 'buyUnit', unit: 'footman', amount: BUY_MAX }, noop);
    applyAction(a, { type: 'buyUnit', unit: 'archer', amount: 5 }, noop);
    for (const id of UPGRADE_IDS) {
      a.flags['upgrade.' + id] = true;
      applyAction(a, { type: 'buyUpgrade', id }, noop);
    }
    for (let i = 0; i < 400; i++) {
      if (i % 5 === 0) applyAction(a, { type: 'strike', weak: i % 3 === 0, aimed: true, x: 0, y: 0 }, noop);
      tick(a, TICK_DT, noop);
    }
    expect(a.stats.strikes).toBeGreaterThan(0);
    const text = serialize(a);
    const b = deserialize(text);
    expect(serialize(b)).toBe(text);
    expect(b.stats).toEqual(a.stats);
    expect(b.upgrades).toEqual(a.upgrades);
    for (let i = 0; i < 600; i++) {
      tick(a, TICK_DT, noop);
      tick(b, TICK_DT, noop);
    }
    expect(serialize(b)).toBe(serialize(a));
  });
});
