import { describe, expect, it } from 'vitest';
import { createInitialState, sel, type GameState } from '../../core';
import {
  createEyeSchedule,
  eyeClosed,
  stepEyeSchedule,
  EYE_BOSS_GAP,
  EYE_EARLIEST,
  EYE_FALLBACK,
  EYE_FIRST_DELAY,
  EYE_GAUGE,
  EYE_MAX_GAP,
  EYE_MIN_GAP,
} from './eyeTimeline';

const AT = sel.bossAt(0);
/** Charge that first puts the gauge at or over EYE_GAUGE. */
const FULL_ENOUGH = Math.ceil(EYE_GAUGE * AT - 1e-9);

/** A Meadow state at play time t with `charge` gauge kills (and as many kills), struck once. */
function meadow(t: number, charge: number): GameState {
  const s = createInitialState(1);
  s.t = t;
  s.kills = charge;
  s.wyrm.charge = charge;
  s.stats.strikes = 1;
  return s;
}

/** Step the schedule over [from, to) at 60 fps with a fixed state (play time follows `now`); returns when it opened, or -1. */
function runUntil(sch: ReturnType<typeof createEyeSchedule>, s: GameState, from: number, to: number, t0 = from): number {
  for (let now = from; now < to; now += 1 / 60) {
    s.t = t0 + (now - from);
    if (stepEyeSchedule(sch, s, now, false)) return now;
  }
  return -1;
}

describe('eye schedule', () => {
  it('stays shut below the gauge threshold before the fallback time', () => {
    const sch = createEyeSchedule();
    expect(runUntil(sch, meadow(0, FULL_ENOUGH - 1), 0, EYE_FALLBACK - 0.1)).toBe(-1);
  });

  it(`opens ${EYE_FIRST_DELAY} s after the gauge reaches ${EYE_GAUGE} (after ${EYE_EARLIEST} s of play)`, () => {
    const sch = createEyeSchedule();
    const s = meadow(130, FULL_ENOUGH);
    expect(stepEyeSchedule(sch, s, 130, false)).toBe(false);
    expect(stepEyeSchedule(sch, s, 130 + EYE_FIRST_DELAY - 0.01, false)).toBe(false);
    expect(stepEyeSchedule(sch, s, 130 + EYE_FIRST_DELAY, false)).toBe(true);
    expect(sch.firstShown).toBe(true);
  });

  it(`never opens before ${EYE_EARLIEST} s of play, however full the gauge`, () => {
    const sch = createEyeSchedule();
    const at = runUntil(sch, meadow(60, AT - 1), 60, 200);
    expect(at).toBeGreaterThanOrEqual(EYE_EARLIEST - 1e-6);
    expect(at).toBeLessThan(EYE_EARLIEST + 0.1);
  });

  it(`falls back to ${EYE_FALLBACK} s of play for a slow player, but not before the first strike`, () => {
    const sch = createEyeSchedule();
    const at = runUntil(sch, meadow(0, 5), 0, 400);
    expect(at).toBeCloseTo(EYE_FALLBACK, 1);
    const idle = createEyeSchedule();
    const s = meadow(0, 0);
    s.stats.strikes = 0;
    expect(runUntil(idle, s, 0, 400)).toBe(-1);
  });

  it('then opens every 45-90 s', () => {
    const sch = createEyeSchedule();
    const s = meadow(150, FULL_ENOUGH);
    stepEyeSchedule(sch, s, 150, false);
    expect(stepEyeSchedule(sch, s, 150 + EYE_FIRST_DELAY, false)).toBe(true);
    expect(stepEyeSchedule(sch, s, 200, false)).toBe(false);
    eyeClosed(sch, 162, 0.5);
    const next = 162 + EYE_MIN_GAP + 0.5 * (EYE_MAX_GAP - EYE_MIN_GAP);
    expect(sch.nextAt).toBeCloseTo(next);
    expect(stepEyeSchedule(sch, s, next - 1, false)).toBe(false);
    expect(stepEyeSchedule(sch, s, next, false)).toBe(true);
  });

  it('opens at once when a boss is summoned, and keeps reopening while it fights', () => {
    const sch = createEyeSchedule();
    const s = meadow(100, AT);
    // Well before its gauge opening would be due (play time 100 < EYE_EARLIEST).
    s.dragon.boss = 'elderNewt';
    s.dragon.id = 40;
    s.dragon.phase = 'enter';
    expect(stepEyeSchedule(sch, s, 100, false)).toBe(true);
    expect(sch.firstShown).toBe(true);
    expect(stepEyeSchedule(sch, s, 101, true)).toBe(false);
    s.dragon.phase = 'idle';
    eyeClosed(sch, 110, 0.9);
    expect(sch.nextAt).toBeCloseTo(110 + EYE_BOSS_GAP);
    expect(stepEyeSchedule(sch, s, 110 + EYE_BOSS_GAP, false)).toBe(true);
    // The boss escapes: back to the slow rhythm.
    s.dragon.phase = 'leave';
    stepEyeSchedule(sch, s, 125, true);
    eyeClosed(sch, 125, 0);
    expect(sch.nextAt).toBeCloseTo(125 + EYE_MIN_GAP);
  });

  it('a boss arriving mid-opening counts as its opening (no second one queued)', () => {
    const sch = createEyeSchedule();
    const s = meadow(150, FULL_ENOUGH);
    stepEyeSchedule(sch, s, 150, false);
    expect(stepEyeSchedule(sch, s, 150 + EYE_FIRST_DELAY, false)).toBe(true);
    eyeClosed(sch, 160, 0);
    s.dragon.boss = 'elderNewt';
    s.dragon.id = 41;
    s.dragon.phase = 'enter';
    expect(stepEyeSchedule(sch, s, 170, true)).toBe(false);
    expect(sch.nextAt).toBe(Infinity);
    expect(stepEyeSchedule(sch, s, 171, false)).toBe(false);
  });

  it('a save loaded past the beat still gets its first opening', () => {
    const sch = createEyeSchedule();
    const s = meadow(900, AT - 2);
    expect(stepEyeSchedule(sch, s, 3, false)).toBe(false);
    expect(stepEyeSchedule(sch, s, 3 + EYE_FIRST_DELAY, false)).toBe(true);
  });

  it('waits while the eye is already open (manual opening)', () => {
    const sch = createEyeSchedule();
    const s = meadow(150, FULL_ENOUGH);
    stepEyeSchedule(sch, s, 0, false);
    expect(stepEyeSchedule(sch, s, 10, true)).toBe(false);
    expect(stepEyeSchedule(sch, s, 11, false)).toBe(true);
  });

  it('restarts when kills or play time drop (reset game / new tier)', () => {
    const sch = createEyeSchedule();
    const s = meadow(150, FULL_ENOUGH);
    stepEyeSchedule(sch, s, 0, false);
    expect(stepEyeSchedule(sch, s, EYE_FIRST_DELAY, false)).toBe(true);
    eyeClosed(sch, 20, 0);
    const fresh = meadow(5, 0);
    expect(stepEyeSchedule(sch, fresh, 30, false)).toBe(false);
    expect(sch.firstShown).toBe(false);
    expect(sch.nextAt).toBe(Infinity);
  });

  it('a manual opening before the first scheduled one schedules nothing', () => {
    const sch = createEyeSchedule();
    eyeClosed(sch, 50, 0.3);
    expect(sch.nextAt).toBe(Infinity);
  });

  it('keeps gaps within 45-90 s for any random draw', () => {
    const sch = createEyeSchedule();
    sch.firstShown = true;
    for (const r of [0, 0.25, 1, 1.5, -1]) {
      eyeClosed(sch, 0, r);
      expect(sch.nextAt).toBeGreaterThanOrEqual(EYE_MIN_GAP);
      expect(sch.nextAt).toBeLessThanOrEqual(EYE_MAX_GAP);
    }
  });

  it('counts play time from the first strike, not from page load (a long wait on the title)', () => {
    const sch = createEyeSchedule();
    const s = meadow(0, 0);
    s.stats.strikes = 0;
    // Three minutes on the title: nothing.
    expect(runUntil(sch, s, 0, 180)).toBe(-1);
    // The first strike: still nothing for EYE_FALLBACK s of play.
    s.stats.strikes = 1;
    const at = runUntil(sch, s, 180, 600, 180);
    expect(at).toBeGreaterThan(180 + EYE_FALLBACK - 0.1);
    expect(at).toBeLessThan(180 + EYE_FALLBACK + 0.1);
    // The gauge rule's floor counts from the first strike too.
    const sch2 = createEyeSchedule();
    const w = meadow(0, 0);
    w.stats.strikes = 0;
    runUntil(sch2, w, 0, 31);
    w.stats.strikes = 1;
    w.wyrm.charge = w.kills = AT - 1;
    const at2 = runUntil(sch2, w, 31, 400, 31);
    expect(at2).toBeGreaterThan(31 + EYE_EARLIEST - 0.1);
  });
});
