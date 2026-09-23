// M2: the zoom's three stages, the hold, the reward, what resets and what persists (ARCHITECTURE §14).
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE, KNIGHT_M, TIERS, heightWord, sizeWord } from './content';
import { D } from './decimal';
import { TICK_DT, enterDuration, fusionForZoom, heightForZoom, heraldryCost, scalesForZoom } from './formulas';
import * as sel from './selectors';
import { createInitialState } from './state';
import { tick } from './tick';
import { finishZoom, inMountain, noop, ofType, recorder, runFor, tank } from './testing/helpers';
import type { GameState } from './types';

/** A tier-0 save with its boss beaten, as if the player had zoomed before (so nothing auto-begins). */
function clearedMeadow(seed = 1): GameState {
  const s = createInitialState(seed);
  s.zoom.count = 1;
  s.wyrm.cleared = true;
  s.wyrm.clearedAt = s.kills;
  return s;
}

describe('the zoom stage machine', () => {
  it('begin → switch → end, and every action in the wrong stage is a no-op', () => {
    const s = clearedMeadow();
    const { events, emit } = recorder();
    // Nothing to switch or end yet.
    applyAction(s, { type: 'zoom', stage: 'switch' }, emit);
    applyAction(s, { type: 'zoom', stage: 'end' }, emit);
    expect(s.zoom.stage).toBeNull();
    expect(events).toEqual([]);

    applyAction(s, { type: 'zoom', stage: 'begin' }, emit);
    expect(s.zoom.stage).toBe('begin');
    const begin = ofType(events, 'zoomBegin');
    expect(begin.length).toBe(1);
    expect(begin[0]!.from).toBe(0);
    expect(begin[0]!.to).toBe(1);
    expect(s.zoom.pending).not.toBeNull();
    expect(begin[0]!.scales.eq(s.zoom.pending!.scales)).toBe(true);
    expect(begin[0]!.fusion).toBe(s.zoom.pending!.fusion);
    expect(begin[0]!.height).toBe(s.zoom.pending!.height);

    applyAction(s, { type: 'zoom', stage: 'begin' }, emit);
    applyAction(s, { type: 'zoom', stage: 'end' }, emit);
    expect(s.zoom.stage).toBe('begin');
    expect(ofType(events, 'zoomBegin').length).toBe(1);

    applyAction(s, { type: 'zoom', stage: 'switch' }, emit);
    expect(s.zoom.stage).toBe('switched');
    applyAction(s, { type: 'zoom', stage: 'switch' }, emit);
    applyAction(s, { type: 'zoom', stage: 'begin' }, emit);
    expect(ofType(events, 'zoomSwitch').length).toBe(1);
    expect(s.tier).toBe(1);

    applyAction(s, { type: 'zoom', stage: 'end' }, emit);
    expect(s.zoom.stage).toBeNull();
    expect(s.zoom.pending).toBeNull();
    expect(ofType(events, 'zoomEnd')).toEqual([{ type: 'zoomEnd', tier: 1 }]);
    applyAction(s, { type: 'zoom', stage: 'end' }, emit);
    expect(ofType(events, 'zoomEnd').length).toBe(1);
  });

  it('begin needs the boss beaten and a next tier', () => {
    const s = createInitialState(1);
    s.zoom.count = 1;
    applyAction(s, { type: 'zoom', stage: 'begin' }, noop);
    expect(s.zoom.stage).toBeNull();
    expect(sel.canZoom(s)).toBe(false);
    const m = inMountain(1);
    m.wyrm.cleared = true;
    expect(sel.canZoom(m)).toBe(false); // past the last tier of this build
    expect(m.tier).toBe(TIERS.length - 1);
    applyAction(m, { type: 'zoom', stage: 'begin' }, noop);
    expect(m.zoom.stage).toBeNull();
  });

  it('the switch emits zoomSwitch then resync (the new tier is already in state), then the tier unlocks', () => {
    const s = clearedMeadow();
    const { events, emit } = recorder();
    applyAction(s, { type: 'zoom', stage: 'begin' }, noop);
    applyAction(s, { type: 'zoom', stage: 'switch' }, emit);
    const types = events.map((e) => e.type);
    expect(types.indexOf('resync')).toBe(types.indexOf('zoomSwitch') + 1);
    expect(types.indexOf('scalesGain')).toBeLessThan(types.indexOf('zoomSwitch'));
    expect(ofType(events, 'zoomSwitch')).toEqual([{ type: 'zoomSwitch', tier: 1 }]);
    const unlocks = ofType(events, 'unlock').map((e) => e.kind + '.' + e.id);
    expect(unlocks).toEqual(expect.arrayContaining(['feature.scales', 'feature.heraldry', 'ability.charge', 'ability.rally']));
    expect(types.indexOf('unlock')).toBeGreaterThan(types.indexOf('resync'));
    for (const f of ['feature.heraldry', 'feature.scales', 'ability.charge', 'ability.rally']) expect(s.flags[f]).toBe(true);
    expect(s.flags['ability.volley']).toBeUndefined();
  });
});

describe('the hold', () => {
  it('a fighting dragon leaves at begin; its animation finishes but nothing transitions or spawns', () => {
    const s = clearedMeadow(2);
    const { events, emit } = recorder();
    runFor(s, 0.5, emit);
    const id = s.dragon.id;
    applyAction(s, { type: 'zoom', stage: 'begin' }, emit);
    expect(s.dragon.phase).toBe('leave');
    expect(s.dragon.phaseDur).toBe(enterDuration(s.dragon.size));
    const phases = ofType(events, 'dragonPhase');
    expect(phases.at(-1)).toEqual({ type: 'dragonPhase', id, phase: 'leave', dur: s.dragon.phaseDur });
    const n = events.length;
    runFor(s, 10, emit);
    expect(s.dragon.id).toBe(id);
    expect(s.dragon.phase).toBe('leave');
    expect(s.dragon.phaseT).toBeCloseTo(s.dragon.phaseDur, 9); // ran to the end, then stopped
    expect(events.slice(n).filter((e) => e.type === 'dragonPhase' || e.type === 'dragonSpawn')).toEqual([]);
  });

  it('the army, champions and abilities pause; strikes, purchases and abilities are ignored', () => {
    const s = clearedMeadow(3);
    tank(s);
    s.units.footman = 20;
    s.units.archer = 10;
    s.units.lancer = 5;
    s.champions.aldric.level = 3;
    s.champions.aldric.specialT = 0.5;
    s.flags['unit.footman'] = s.flags['ability.charge'] = s.flags['feature.heraldry'] = true;
    s.gold = D(1e12);
    s.scales = D(100);
    s.abilities.rally.cooldown = 10;
    const { events, emit } = recorder();
    runFor(s, 3, emit); // volleys in flight
    expect(s.army.volleys.length).toBeGreaterThan(0);
    applyAction(s, { type: 'zoom', stage: 'begin' }, emit);
    expect(s.army.volleys.length).toBe(0); // nothing in flight lands during a hold
    const n = events.length;
    const snapshot = JSON.stringify({ units: s.units, gold: s.gold, scales: s.scales, levels: s.heraldry.levels, champ: s.champions, ab: s.abilities });
    applyAction(s, { type: 'strike', weak: true, aimed: true, x: 0, y: 0 }, emit);
    applyAction(s, { type: 'buyUnit', unit: 'footman', amount: 1 }, emit);
    applyAction(s, { type: 'buyUpgrade', id: 'pointySwords' }, emit);
    applyAction(s, { type: 'buyHeraldry', id: 'lion' }, emit);
    applyAction(s, { type: 'levelChampion', id: 'aldric', amount: 1 }, emit);
    applyAction(s, { type: 'useAbility', id: 'charge' }, emit);
    runFor(s, 10, emit);
    const later = events.slice(n).map((e) => e.type);
    for (const t of ['strike', 'armyHit', 'volley', 'cavalry', 'championHit', 'championSpecial', 'purchase', 'abilityUse', 'abilityReady']) {
      expect(later, t).not.toContain(t);
    }
    expect(JSON.stringify({ units: s.units, gold: s.gold, scales: s.scales, levels: s.heraldry.levels, champ: s.champions, ab: s.abilities })).toBe(snapshot);
  });

  it("in 'switched' the new tier's dragon #0 waits, frozen at the start of its entrance, until end", () => {
    const s = clearedMeadow(4);
    applyAction(s, { type: 'zoom', stage: 'begin' }, noop);
    applyAction(s, { type: 'zoom', stage: 'switch' }, noop);
    expect(s.dragon.index).toBe(0);
    expect(s.dragon.phase).toBe('enter');
    runFor(s, 5);
    expect(s.dragon.phaseT).toBe(0);
    expect(s.dragon.phase).toBe('enter');
    applyAction(s, { type: 'zoom', stage: 'end' }, noop);
    tick(s, TICK_DT, noop);
    expect(s.dragon.phaseT).toBeCloseTo(TICK_DT, 9);
  });
});

describe('the switch: reward, resets, persists', () => {
  it('pays the pending reward and swaps in the Mountain', () => {
    const s = clearedMeadow(5);
    s.units.footman = 64;
    s.units.archer = 36;
    s.kills = 36;
    s.wyrm.clearedAt = 31;
    const { events, emit } = recorder();
    applyAction(s, { type: 'zoom', stage: 'begin' }, emit);
    const p = s.zoom.pending!;
    expect(p.scales.eq(scalesForZoom(s))).toBe(true);
    expect(p.fusion).toBe(fusionForZoom(s));
    expect(p.height).toBe(heightForZoom(s));
    const fusionBefore = s.zoom.fusion;
    applyAction(s, { type: 'zoom', stage: 'switch' }, emit);
    expect(s.tier).toBe(1);
    expect(s.height).toBe(p.height);
    expect(s.scales.eq(p.scales)).toBe(true);
    expect(s.lifetimeScales.eq(p.scales)).toBe(true);
    expect(s.zoom.fusion).toBeCloseTo(fusionBefore * p.fusion, 12);
    expect(s.zoom.count).toBe(2);
    expect(ofType(events, 'scalesGain')[0]!.amount.eq(p.scales)).toBe(true);
    expect(s.dragon.species).toBe('wyvern');
  });

  it('resets gold, units, army, kills, the gauge, abilities; keeps upgrades, heraldry, champions, Scales, stats, flags, lifetimeGold', () => {
    const s = clearedMeadow(6);
    s.gold = D(12345);
    s.lifetimeGold = D(99999);
    s.units = { footman: 40, archer: 12, lancer: 0 };
    s.upgrades['pointySwords'] = 1;
    s.upgrades['grindstone'] = 1;
    s.kills = 33;
    s.wyrm = { charge: 30, bossT: 0, bossDur: 30, escapes: 2, cleared: true, clearedAt: 31 };
    s.heraldry.levels.lion = 2;
    s.heraldry.order = ['lion'];
    s.scales = D(7);
    s.champions.aldric = { level: 9, specialT: 1 };
    s.stats = { strikes: 500, crits: 90, staggers: 12 };
    s.flags['unit.archer'] = true;
    s.abilities.charge = { active: 4, cooldown: 30 };
    s.army.volleys.push({ unit: 'archer', target: s.dragon.id, t: 0.5, damage: D(5), arrows: 3 });
    s.army.meleeT = 0.1;
    applyAction(s, { type: 'zoom', stage: 'begin' }, noop);
    const paid = s.zoom.pending!.scales;
    applyAction(s, { type: 'zoom', stage: 'switch' }, noop);
    // Reset.
    expect(s.gold.eq(0)).toBe(true);
    expect(s.units).toEqual({ footman: 0, archer: 0, lancer: 0 });
    expect(s.kills).toBe(0);
    expect(s.wyrm).toEqual({ charge: 0, bossT: 0, bossDur: 0, escapes: 0, cleared: false, clearedAt: 0 });
    expect(s.abilities.charge).toEqual({ active: 0, cooldown: 0 });
    expect(s.army.volleys).toEqual([]);
    expect(s.army.meleeT).toBe(BALANCE.units.footman.interval);
    // Kept.
    expect(s.upgrades['pointySwords']).toBe(1);
    expect(s.upgrades['grindstone']).toBe(1);
    expect(s.heraldry.levels.lion).toBe(2);
    expect(s.heraldry.order).toEqual(['lion']);
    expect(s.scales.eq(D(7).add(paid))).toBe(true);
    expect(s.champions.aldric.level).toBe(9);
    expect(s.stats).toEqual({ strikes: 500, crits: 90, staggers: 12 });
    expect(s.flags['unit.archer']).toBe(true);
    expect(s.lifetimeGold.eq(99999)).toBe(true);
  });

  it('Tower heraldry: the new tier starts with footmen', () => {
    const s = clearedMeadow(7);
    s.heraldry.levels.tower = 2;
    applyAction(s, { type: 'zoom', stage: 'begin' }, noop);
    applyAction(s, { type: 'zoom', stage: 'switch' }, noop);
    const e = BALANCE.heraldry.tower.effect;
    expect(e.kind).toBe('startUnits');
    expect(s.units.footman).toBe(e.kind === 'startUnits' ? e.count * 2 : NaN);
  });
});

describe('Scales, the Fusion Bonus and the colossus', () => {
  it('Scales: the tier base, more for every kill pushed past the boss', () => {
    const s = clearedMeadow();
    const base = BALANCE.tiers[0]!.scales;
    expect(scalesForZoom(s).eq(base)).toBe(true);
    // Enough for 2-3 first-level charges.
    const first = heraldryCost(s, 'lion').toNumber();
    expect(base / first).toBeGreaterThanOrEqual(2);
    expect(base / first).toBeLessThan(4);
    s.kills += 5;
    expect(scalesForZoom(s).eq(Math.floor(base * Math.pow(BALANCE.zoom.pushScales, 5)))).toBe(true);
    expect(scalesForZoom(s).gt(base)).toBe(true);
    expect(sel.zoomPreview(s).push).toBe(5);
  });

  it('the Fusion Bonus grows sublinearly with the army fused, and Crown adds to it', () => {
    const s = createInitialState(1);
    expect(fusionForZoom(s)).toBe(1);
    s.units.footman = 60;
    s.units.archer = 40;
    const k = BALANCE.zoom.fusionPerSqrtUnit;
    expect(fusionForZoom(s)).toBeCloseTo(1 + k * 10, 2);
    s.units.footman = 360;
    expect(fusionForZoom(s) - 1).toBeCloseTo(k * 20, 2); // 4× the army, 2× the bonus
    s.units.footman = 60;
    s.heraldry.levels.crown = 1;
    const e = BALANCE.heraldry.crown.effect;
    expect(fusionForZoom(s)).toBeCloseTo(1 + k * 10 * (1 + (e.kind === 'fusionBonus' ? e.add : 0)), 2);
  });

  it('the colossus stands ~200-240 m after a typical first zoom (the next tier\'s base × a gentle fusion curve)', () => {
    const s = createInitialState(1);
    expect(heightForZoom(s)).toBe(BALANCE.tiers[1]!.baseHeight);
    s.units.footman = 60;
    s.units.archer = 40;
    const h = heightForZoom(s);
    expect(h).toBeGreaterThan(200);
    expect(h).toBeLessThan(240);
  });

  it('the fusion multiplies all damage after the zoom', () => {
    const s = clearedMeadow(8);
    s.units.footman = 100;
    applyAction(s, { type: 'zoom', stage: 'begin' }, noop);
    const f = s.zoom.pending!.fusion;
    applyAction(s, { type: 'zoom', stage: 'switch' }, noop);
    applyAction(s, { type: 'zoom', stage: 'end' }, noop);
    expect(sel.clickDamage(s, false).toNumber()).toBeCloseTo(BALANCE.click.base * f, 9);
    s.units.footman = 1;
    expect(sel.unitDamage(s, 'footman').toNumber()).toBeCloseTo(BALANCE.units.footman.damage * f, 9);
  });
});

describe('display scale', () => {
  it('displayMeters, tierInfo and dragonInfo read the tier\'s scale', () => {
    const s = createInitialState(1);
    expect(sel.displayMeters(s, KNIGHT_M)).toBeCloseTo(1.8, 12);
    expect(sel.tierInfo(s)).toEqual({ tier: 0, name: 'The Meadow', numeral: 'I', height: 1.8, heightWord: heightWord(1.8) });
    const m = inMountain(1);
    expect(m.height).toBeGreaterThanOrEqual(200);
    const info = sel.tierInfo(m);
    expect(info.tier).toBe(1);
    expect(info.numeral).toBe('II');
    expect(info.height).toBe(m.height);
    expect(info.heightWord).toBe(heightWord(m.height));
    expect(sel.displayMeters(m, KNIGHT_M)).toBeCloseTo(m.height, 9);
    // The first wyvern is about a knight's height in world m, ~200 m on the display.
    expect(m.dragon.size / KNIGHT_M).toBeGreaterThanOrEqual(0.8);
    expect(m.dragon.size / KNIGHT_M).toBeLessThanOrEqual(1.2);
    const d = sel.dragonInfo(m);
    expect(d.size).toBe(m.dragon.size);
    expect(d.displaySize).toBeCloseTo((m.dragon.size * m.height) / KNIGHT_M, 9);
    expect(d.sizeWord).toBe(sizeWord(d.displaySize));
    expect(d.sizeWord).not.toBe(sizeWord(d.size));
  });

  it('size and height words reach tens of kilometers', () => {
    const words = [0.5, 3, 40, 200, 900, 2500, 6000, 15000, 50000, 200000].map(sizeWord);
    expect(new Set(words).size).toBe(words.length);
    const heights = [1.8, 20, 220, 5000, 50000].map(heightWord);
    expect(new Set(heights).size).toBe(heights.length);
    expect(heightWord(220)).toMatch(/cathedral/);
  });
});

describe('debug ops', () => {
  it('tier: like a zoom without the cinematic or reward', () => {
    const s = createInitialState(1);
    s.gold = D(500);
    s.units.footman = 12;
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'tier', amount: 1 }, emit);
    expect(s.tier).toBe(1);
    expect(s.height).toBe(BALANCE.tiers[1]!.baseHeight);
    expect(s.gold.eq(0)).toBe(true);
    expect(s.units.footman).toBe(0);
    expect(s.scales.eq(0)).toBe(true);
    expect(s.zoom.fusion).toBe(1);
    expect(s.zoom.count).toBe(1);
    expect(s.zoom.stage).toBeNull();
    expect(s.dragon.species).toBe('wyvern');
    expect(s.flags['ability.charge']).toBe(true);
    expect(s.flags['feature.heraldry']).toBe(true);
    expect(events.map((e) => e.type)).toContain('resync');
    // Back to the Meadow, and clamped past the last tier.
    applyAction(s, { type: 'debug', op: 'tier', amount: 0 }, noop);
    expect(s.tier).toBe(0);
    expect(s.height).toBe(1.8);
    applyAction(s, { type: 'debug', op: 'tier', amount: 9 }, noop);
    expect(s.tier).toBe(TIERS.length - 1);
  });

  it('boss, cleared, scales', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'boss' }, emit);
    expect(sel.gauge(s)).toBe(1);
    applyAction(s, { type: 'debug', op: 'scales', amount: 10 }, emit);
    expect(s.scales.eq(10)).toBe(true);
    expect(s.lifetimeScales.eq(10)).toBe(true);
    expect(s.flags['feature.heraldry']).toBe(true);
    expect(ofType(events, 'scalesGain')[0]!.amount.eq(10)).toBe(true);
    applyAction(s, { type: 'debug', op: 'cleared' }, emit);
    expect(s.wyrm.cleared).toBe(true);
    expect(s.zoom.stage).toBe('begin'); // a first save zooms at once
    finishZoom(s, emit);
    expect(s.tier).toBe(1);
  });
});
