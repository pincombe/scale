import { describe, expect, it } from 'vitest';
import { buildIndividual, maturityOf, NEWT } from './species';
import { C_CHEST, DragonRig, LEG_BN, LEG_FN } from './rig';
import { Choreo, type ChoreoEnv } from './choreo';
import type { DragonAttack, DragonPhase } from '../../core';

const SIZES = [0.5, 2, 10, 40];

function rigFor(seed: number, size: number, heads?: number): DragonRig {
  const rig = new DragonRig();
  rig.setup(buildIndividual(NEWT, seed, size, heads ? { heads } : undefined));
  return rig;
}

function allFinite(rig: DragonRig): boolean {
  for (let i = 0; i < rig.total; i++) {
    if (!Number.isFinite(rig.x[i]!) || !Number.isFinite(rig.y[i]!)) return false;
  }
  for (let k = 0; k < 4; k++) {
    if (!rig.legOn[k]) continue;
    if (!Number.isFinite(rig.kneeX[k]!) || !Number.isFinite(rig.ankY[k]!)) return false;
  }
  for (let h = 0; h < rig.heads; h++) if (!Number.isFinite(rig.headA[h]!)) return false;
  return true;
}

function env(phase: DragonPhase, attack: DragonAttack, k: number, t: number, time: number): ChoreoEnv {
  return { phase, attack, k, t, dt: 1 / 60, time, lookX: -1.5, lookY: -0.3, lookPull: 0.6, enterDist: 6, lunge: 0.6, aimX: -1.2, aimY: 0 };
}

describe('species', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = buildIndividual(NEWT, 123, 1);
    const b = buildIndividual(NEWT, 123, 1);
    const c = buildIndividual(NEWT, 124, 1);
    expect(a).toEqual(b);
    expect(a.headLen === c.headLen && a.hornLen === c.hornLen && a.tailLen === c.tailLen).toBe(false);
  });

  it('maps size onto maturity on a log scale', () => {
    expect(maturityOf(NEWT, 0.5)).toBe(0);
    expect(maturityOf(NEWT, 40)).toBe(1);
    expect(maturityOf(NEWT, 1000)).toBe(1);
    expect(maturityOf(NEWT, Math.sqrt(0.5 * 40))).toBeCloseTo(0.5, 5);
  });

  it('keeps integer features integral and in range', () => {
    for (let s = 0; s < 50; s++) {
      const ind = buildIndividual(NEWT, s * 7919, 0.5 + s);
      for (const v of [ind.hornPairs, ind.gillCount, ind.legPairs, ind.toes, ind.wingFingers, ind.heads]) {
        expect(Number.isInteger(v)).toBe(true);
      }
      expect(ind.heads).toBe(1);
      expect(ind.weakSpots.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('rig rest pose', () => {
  it('is normalized: front edge at x = 0, snout-to-tail about 1, on the ground', () => {
    for (const size of SIZES) {
      for (let s = 0; s < 20; s++) {
        const rig = rigFor(s * 104729 + 1, size);
        expect(rig.restMinX).toBeCloseTo(0, 9);
        expect(rig.restMaxX).toBeGreaterThan(0.85);
        expect(rig.restMaxX).toBeLessThan(1.35);
        expect(rig.restMinY).toBeLessThan(-0.1);
        expect(rig.restMaxY).toBeGreaterThanOrEqual(0);
        expect(rig.restMaxY).toBeLessThan(0.01);
        // Feet planted on the ground, legs solved to the right bone lengths.
        for (const k of [LEG_FN, LEG_BN]) {
          expect(rig.footY[k]).toBeCloseTo(0, 6);
          const a = Math.hypot(rig.kneeX[k]! - rig.hipX[k]!, rig.kneeY[k]! - rig.hipY[k]!);
          const b = Math.hypot(rig.ankX[k]! - rig.kneeX[k]!, rig.ankY[k]! - rig.kneeY[k]!);
          expect(a).toBeCloseTo(rig.legA[k]!, 5);
          expect(b).toBeCloseTo(rig.legB[k]!, 5);
        }
        expect(allFinite(rig)).toBe(true);
      }
    }
  });

  it('keeps the belly off the ground at rest', () => {
    const rig = rigFor(42, 0.5);
    for (let i = rig.iS; i <= rig.iH; i++) expect(rig.uy[i]!).toBeLessThanOrEqual(1e-6);
  });
});

describe('rig dynamics', () => {
  it('stays finite and keeps segment lengths through every phase, at many sizes', () => {
    const phases: [DragonPhase, DragonAttack, number][] = [
      ['enter', 'breath', 1.6],
      ['idle', 'breath', 5],
      ['windup', 'breath', 1.2],
      ['breath', 'breath', 1.5],
      ['windup', 'swipe', 1.2],
      ['swipe', 'swipe', 0.9],
      ['stagger', 'breath', 1.4],
      ['dying', 'breath', 1.6],
    ];
    for (const size of SIZES) {
      for (const heads of [1, 3]) {
        const rig = rigFor(99 + size * 13, size, heads);
        rig.tempo = Math.min(1.3, Math.max(0.35, Math.pow(size, -0.25)));
        const ch = new Choreo();
        ch.reset(rig.ind.seed);
        let time = 0;
        for (const [phase, attack, dur] of phases) {
          rig.dissolve = 1;
          const frames = Math.ceil(dur * 60);
          for (let f = 0; f < frames; f++) {
            const t = (f / frames) * dur;
            const e = env(phase, attack, t / dur, t, time);
            ch.apply(rig, e);
            rig.update(e.dt);
            ch.post(rig, e);
            time += e.dt;
          }
          expect(allFinite(rig)).toBe(true);
          // Follow-the-leader keeps every segment at its rest length.
          for (let i = 1; i < rig.n; i++) {
            if (i === rig.iS) continue;
            const l = rig.leader[i]!;
            const d = Math.hypot(rig.x[i]! - rig.x[l]!, rig.y[i]! - rig.y[l]!);
            expect(Math.abs(d - rig.segLen[i]!)).toBeLessThan(rig.segLen[i]! * 0.25 + 1e-6);
          }
          // Nothing flies away.
          for (let i = 0; i < rig.total; i++) {
            expect(Math.abs(rig.x[i]!)).toBeLessThan(10);
            expect(rig.y[i]!).toBeLessThan(0.05);
            expect(rig.y[i]!).toBeGreaterThan(-3);
          }
        }
      }
    }
  });

  it('swells the chest when the channel says so', () => {
    const rig = rigFor(5, 1);
    const i = rig.iS + 3;
    const before = rig.belly[i]!;
    rig.target[C_CHEST] = 1;
    for (let f = 0; f < 60; f++) rig.update(1 / 60);
    expect(rig.belly[i]!).toBeGreaterThan(before * 1.15);
  });

  it('survives huge and zero time steps', () => {
    const rig = rigFor(7, 3);
    rig.update(0);
    rig.update(2);
    rig.update(1e-5);
    expect(allFinite(rig)).toBe(true);
  });
});

describe('rig hit test', () => {
  it('hits the body middle and misses empty sky', () => {
    for (const size of SIZES) {
      const rig = rigFor(11, size);
      const mid = rig.iS + 4;
      expect(rig.hitBody(rig.x[mid]!, rig.y[mid]!, 0)).toBe(true);
      // The head.
      expect(rig.hitBody(rig.headX[0]! - rig.headLen * 0.4, rig.headY[0]!, 0)).toBe(true);
      // Far above and far in front.
      expect(rig.hitBody(0.5, -2, 0.01)).toBe(false);
      expect(rig.hitBody(-1, -0.05, 0.01)).toBe(false);
    }
  });

  it('pad makes it more forgiving', () => {
    const rig = rigFor(3, 1);
    const mid = rig.iS + 4;
    const y = rig.by[mid]! - 0.03 - rig.crestHeightAt(mid);
    expect(rig.hitBody(rig.x[mid]!, y, 0)).toBe(false);
    expect(rig.hitBody(rig.x[mid]!, y, 0.05)).toBe(true);
  });
});

describe('turn-around placement', () => {
  it('placeX / unplaceX are inverses, mirrored or not', async () => {
    const { C_FACE, C_SHIFT } = await import('./rig');
    const rig = rigFor(8, 2);
    for (const [face, shift] of [[1, 0], [-1, 0], [-1, -0.4], [0.5, 0.2], [0.05, 0]] as const) {
      rig.ch[C_FACE] = face;
      rig.ch[C_SHIFT] = shift;
      for (const x of [-0.3, 0, 0.4, 1.1]) {
        const p = rig.placeX(x);
        const back = rig.unplaceX(p);
        if (Math.abs(face) >= 0.15) expect(back).toBeCloseTo(x, 9);
        else expect(Number.isFinite(back)).toBe(true);
      }
    }
  });
});

describe('weak spot modes', () => {
  it('maps phases to the live weak spot and its visibility', async () => {
    const { weakModeFor, weakLiveFor, WEAK_SCALE, WEAK_THROAT, WEAK_TAIL } = await import('./weakspot');
    expect(weakModeFor('windup', 'breath')).toBe(WEAK_THROAT);
    expect(weakModeFor('windup', 'swipe')).toBe(WEAK_TAIL);
    for (const ph of ['idle', 'breath', 'swipe', 'stagger', 'enter'] as const) expect(weakModeFor(ph, 'breath')).toBe(WEAK_SCALE);
    expect(weakLiveFor('dying', 0.1)).toBe(false);
    expect(weakLiveFor('enter', 0.5)).toBe(false);
    expect(weakLiveFor('enter', 0.8)).toBe(true);
    expect(weakLiveFor('windup', 0)).toBe(true);
  });
});
