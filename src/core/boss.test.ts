// M2: the Wyrm Gauge and the tier's boss (ARCHITECTURE §14).
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { BALANCE, BOSS_TEXT } from './content';
import { TICK_DT, bossAt, bossGold, bossMaxHp, dragonGold, dragonMaxHp, dragonSize, dyingDuration, enterDuration, goldMult } from './formulas';
import * as sel from './selectors';
import { createInitialState } from './state';
import { tick } from './tick';
import { finishZoom, inMountain, killAndNext, noop, ofType, recorder, runFor, runUntil, withBoss } from './testing/helpers';

describe('the Wyrm Gauge', () => {
  it('each ordinary kill fills it; when full, the next dragon is the boss (bossSummon, then its spawn)', () => {
    const s = createInitialState(1);
    const { events, emit } = recorder();
    const at = bossAt(0);
    expect(at).toBe(BALANCE.tiers[0]!.bossAt);
    expect(sel.gauge(s)).toBe(0);
    for (let k = 1; k < at; k++) {
      killAndNext(s, emit);
      expect(s.wyrm.charge).toBe(k);
      expect(s.dragon.boss).toBeNull();
    }
    expect(sel.gauge(s)).toBeCloseTo((at - 1) / at, 9);
    expect(ofType(events, 'bossSummon')).toEqual([]);
    const n = events.length;
    killAndNext(s, emit);
    expect(sel.gauge(s)).toBe(1);
    const after = events.slice(n).map((e) => e.type);
    expect(after.indexOf('bossSummon')).toBeGreaterThan(after.indexOf('dragonDeath'));
    expect(after.indexOf('dragonSpawn')).toBe(after.indexOf('bossSummon') + 1);
    expect(ofType(events, 'bossSummon')[0]).toEqual({ type: 'bossSummon', boss: 'elderNewt', dur: BALANCE.boss.timer });
    const d = s.dragon;
    expect(d.boss).toBe('elderNewt');
    expect(d.index).toBe(at);
    expect(d.phase).toBe('enter');
    expect(d.name).toBe(BOSS_TEXT.elderNewt!.name);
    expect(d.epithet).toBe(BOSS_TEXT.elderNewt!.epithet);
    expect(d.maxHp.eq(bossMaxHp(0))).toBe(true);
    expect(d.size).toBeCloseTo(dragonSize(0, at) * BALANCE.boss.sizeMult, 9);
    expect(s.wyrm.bossT).toBe(BALANCE.boss.timer);
    expect(s.wyrm.bossDur).toBe(BALANCE.boss.timer);
    expect(sel.bossTimeLeft(s)).toBe(BALANCE.boss.timer);
    // A grander entrance than an ordinary dragon's (the timer doesn't run during it).
    expect(d.phaseDur).toBe(BALANCE.boss.enter);
    expect(ofType(events, 'dragonPhase').at(-1)).toEqual({ type: 'dragonPhase', id: d.id, phase: 'enter', dur: BALANCE.boss.enter });
    expect(BALANCE.boss.enter).toBeGreaterThan(enterDuration(d.size));
  });

  it('the boss is tougher and richer than the dragon before it, and fixed per tier', () => {
    for (const tier of [0, 1]) {
      const at = bossAt(tier);
      expect(bossMaxHp(tier).gt(dragonMaxHp(tier, at - 1))).toBe(true);
      expect(bossGold(tier).gt(dragonGold(tier, at - 1))).toBe(true);
      expect(bossMaxHp(tier).div(dragonMaxHp(tier, at)).toNumber()).toBeCloseTo(BALANCE.tiers[tier]!.bossHp, 3);
    }
    const s = withBoss();
    expect(s.dragon.maxHp.eq(bossMaxHp(0))).toBe(true);
    expect(sel.dragonInfo(s).boss).toBe('elderNewt');
  });
});

describe('the boss timer', () => {
  it('counts down only while the boss can be hit (not while it enters)', () => {
    const s = withBoss();
    expect(s.dragon.phase).toBe('enter');
    runUntil(s, () => s.dragon.phase !== 'enter');
    expect(s.wyrm.bossT).toBe(BALANCE.boss.timer);
    runFor(s, 5);
    expect(s.wyrm.bossT).toBeCloseTo(BALANCE.boss.timer - 5, 6);
    expect(sel.bossClockRunning(s)).toBe(true);
    // A zoom's hold pauses it too.
    s.zoom.stage = 'begin';
    runFor(s, 3);
    expect(s.wyrm.bossT).toBeCloseTo(BALANCE.boss.timer - 5, 6);
    expect(sel.bossClockRunning(s)).toBe(false);
  });

  it('timeout: the boss escapes (leave), the gauge drops back, an ordinary dragon follows, and a few kills re-summon it', () => {
    const s = withBoss(2);
    const { events, emit } = recorder();
    const index = s.dragon.index;
    const id = s.dragon.id;
    runUntil(s, () => ofType(events, 'bossEscaped').length > 0, emit);
    expect(ofType(events, 'bossEscaped')).toEqual([{ type: 'bossEscaped', boss: 'elderNewt' }]);
    expect(s.dragon.id).toBe(id);
    expect(s.dragon.phase).toBe('leave');
    expect(s.dragon.phaseDur).toBe(enterDuration(s.dragon.size));
    expect(s.wyrm.escapes).toBe(1);
    expect(s.wyrm.bossT).toBe(0);
    expect(sel.bossTimeLeft(s)).toBe(0);
    const back = Math.floor(bossAt(0) * BALANCE.boss.escapeCharge);
    expect(s.wyrm.charge).toBe(back);
    expect(sel.gauge(s)).toBeCloseTo(BALANCE.boss.escapeCharge, 1);
    // A leaving boss can't be hit.
    const hp = s.dragon.hp;
    applyAction(s, { type: 'strike', weak: false, aimed: true, x: 0, y: 0 }, emit);
    expect(s.dragon.hp.eq(hp)).toBe(true);
    // After the leave, an ordinary dragon: the refill replays the ones leading up to the boss
    // (this boss was debug-summoned early, at #1, so the replay clamps at #0; a real approach is below).
    runUntil(s, () => s.dragon.id !== id, emit);
    expect(s.dragon.boss).toBeNull();
    expect(s.dragon.index).toBe(Math.max(0, index - (bossAt(0) - back)));
    expect(s.dragon.phase).toBe('enter');
    expect(s.wyrm.cleared).toBe(false);
    // Refill the gauge: the boss is back, no tougher than before.
    for (let k = back; k < bossAt(0); k++) killAndNext(s, emit);
    expect(s.dragon.boss).toBe('elderNewt');
    expect(s.dragon.maxHp.eq(bossMaxHp(0))).toBe(true);
    expect(ofType(events, 'bossSummon').length).toBe(1); // (withBoss's summon went to another recorder)
  });
});

describe('beating the boss', () => {
  it('kill: dragonDeath (a big reward), bossDefeated {first}, cleared; the first zoom begins by itself when dying ends', () => {
    const s = withBoss(3);
    const { events, emit } = recorder();
    runUntil(s, () => s.dragon.phase !== 'enter', emit);
    s.dragon.hp = s.dragon.hp.mul(0).add(1);
    const gold = bossGold(0).mul(goldMult(s));
    applyAction(s, { type: 'strike', weak: false, aimed: true, x: 0, y: 0 }, emit);
    const types = events.map((e) => e.type);
    expect(types.indexOf('bossDefeated')).toBe(types.indexOf('dragonDeath') + 1);
    expect(ofType(events, 'dragonDeath')[0]!.gold.eq(gold)).toBe(true);
    expect(ofType(events, 'bossDefeated')).toEqual([{ type: 'bossDefeated', boss: 'elderNewt', first: true }]);
    // The boss falls for longer than an ordinary dragon dies.
    expect(s.dragon.phase).toBe('dying');
    expect(s.dragon.phaseDur).toBe(BALANCE.boss.dying);
    expect(BALANCE.boss.dying).toBeGreaterThan(dyingDuration(s.dragon.size));
    expect(s.wyrm.cleared).toBe(true);
    expect(s.wyrm.clearedAt).toBe(s.kills);
    expect(s.wyrm.bossT).toBe(0);
    expect(sel.gauge(s)).toBe(1);
    expect(sel.canZoom(s)).toBe(true);
    // Still dying: no zoom yet.
    tick(s, TICK_DT, emit);
    expect(s.zoom.stage).toBeNull();
    runUntil(s, () => s.zoom.stage !== null, emit);
    expect(s.zoom.stage).toBe('begin');
    expect(ofType(events, 'zoomBegin').length).toBe(1);
    expect(ofType(events, 'dragonSpawn').length).toBe(0); // no new dragon
    expect(s.dragon.phase).toBe('dying');
  });

  it('on a later tier (the save has zoomed) ordinary dragons keep coming, bigger, and the gauge stays full', () => {
    const s = inMountain(4);
    const { events, emit } = recorder();
    applyAction(s, { type: 'debug', op: 'boss' }, emit);
    killAndNext(s, emit);
    expect(s.dragon.boss).toBe('grimmaw');
    expect(s.dragon.name).toBe(BOSS_TEXT.grimmaw!.name);
    const size = s.dragon.size;
    killAndNext(s, emit);
    expect(ofType(events, 'bossDefeated')).toEqual([{ type: 'bossDefeated', boss: 'grimmaw', first: true }]);
    expect(ofType(events, 'zoomBegin')).toEqual([]);
    expect(s.zoom.stage).toBeNull();
    expect(s.dragon.boss).toBeNull();
    expect(s.dragon.phase).toBe('enter');
    // Pushing on: charge no longer counts, no second summon.
    for (let k = 0; k < bossAt(1) + 2; k++) killAndNext(s, emit);
    expect(ofType(events, 'bossSummon').length).toBe(1);
    expect(sel.gauge(s)).toBe(1);
    expect(s.dragon.size).toBeGreaterThan(size / BALANCE.boss.sizeMult);
    // The Mountain is the last tier of this build: the Zoom button can't be used.
    expect(sel.canZoom(s)).toBe(false);
    expect(sel.isLastTier(s)).toBe(true);
  });

  it('a boss beaten again reports first: false', () => {
    const s = inMountain(5);
    const { events, emit } = recorder();
    for (let i = 0; i < 2; i++) {
      applyAction(s, { type: 'debug', op: 'boss' }, emit);
      killAndNext(s, emit); // the current dragon
      killAndNext(s, emit); // Grimmaw
    }
    expect(ofType(events, 'bossDefeated').map((e) => e.first)).toEqual([true, false]);
  });

  it('a later zoomed save does not zoom by itself, and a debug-cleared first save does', () => {
    const a = createInitialState(6);
    const { events, emit } = recorder();
    applyAction(a, { type: 'debug', op: 'cleared' }, emit);
    expect(a.zoom.stage).toBe('begin');
    finishZoom(a, emit);
    expect(a.tier).toBe(1);
    expect(ofType(events, 'zoomBegin').length).toBe(1);
  });
});

describe('the refill after an escape is never harder than the first approach', () => {
  it('a real approach: the boss at #bossAt escapes; dragons #(bossAt - refill)… come back, then the boss at #bossAt again', () => {
    const s = createInitialState(9);
    const { events, emit } = recorder();
    const at = bossAt(0);
    for (let k = 0; k < at; k++) killAndNext(s, emit);
    expect(s.dragon.boss).toBe('elderNewt');
    expect(s.dragon.index).toBe(at);
    const approachHp = s.dragon.maxHp;
    runUntil(s, () => s.dragon.boss === null, emit, 60);
    const refill = at - s.wyrm.charge;
    expect(s.dragon.index).toBe(at - refill);
    const hps: number[] = [];
    for (let k = 0; k < refill; k++) {
      expect(s.dragon.boss).toBeNull();
      expect(s.dragon.index).toBeLessThan(at);
      hps.push(s.dragon.maxHp.toNumber());
      killAndNext(s, emit);
    }
    // Each refill dragon is one the player already beat on the first approach.
    expect(Math.max(...hps)).toBeLessThan(approachHp.toNumber());
    expect(s.dragon.boss).toBe('elderNewt');
    expect(s.dragon.index).toBe(at);
    expect(s.dragon.maxHp.eq(approachHp)).toBe(true);
    expect(ofType(events, 'bossSummon').length).toBe(2);
  });

  it('after the boss is beaten, ordinary dragons keep growing past it (the push-further choice)', () => {
    const s = inMountain(10);
    applyAction(s, { type: 'debug', op: 'boss' }, noop);
    killAndNext(s);
    const bossIndex = s.dragon.index;
    killAndNext(s);
    expect(s.dragon.index).toBe(bossIndex + 1);
  });
});
