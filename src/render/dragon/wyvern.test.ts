// The mountain wyvern, the bosses and the rig extensions they need (wing-arms, flight, the run
// cycle, rock plates, species-specific choreography). Pure: no canvas.
import { describe, expect, it } from 'vitest';
import type { DragonAttack, DragonPhase } from '../../core';
import { BOSSES, bossOf } from './bosses';
import { BoundedCache } from './cache';
import { Choreo, type ChoreoEnv } from './choreo';
import { C_AIR, C_FACE, C_RUN, C_WSPREAD, DragonRig, LEG_BN, LEG_FF, LEG_FN } from './rig';
import { NEWT, buildIndividual, speciesOf } from './species';
import { WYVERN } from './wyvern';

const SIZES = [0.8, 4, 15, 60];

function wyvern(seed: number, size: number, boss: string | null = null): DragonRig {
  const rig = new DragonRig();
  rig.setup(buildIndividual(WYVERN, seed, size, undefined, boss));
  rig.tempo = Math.min(1.25, Math.max(0.3, Math.pow(size, -0.3)));
  return rig;
}

function env(phase: DragonPhase, attack: DragonAttack, k: number, t: number, time: number, dur: number): ChoreoEnv {
  return { phase, attack, k, t, dt: 1 / 60, time, lookX: -1.5, lookY: -0.3, lookPull: 0.6, enterDist: 5, lunge: 0.4, aimX: -1.2, aimY: 0, dur, enterH: 4, exitDist: 6, exitH: 5, slamX: -0.1 };
}

/** Play a phase from 0 to `upTo` of its length; returns the elapsed clock. */
function play(rig: DragonRig, ch: Choreo, phase: DragonPhase, attack: DragonAttack, dur: number, time: number, upTo = 1): number {
  const frames = Math.ceil(dur * 60 * upTo);
  for (let f = 0; f < frames; f++) {
    const t = (f / 60) * 1;
    const e = env(phase, attack, Math.min(1, t / dur), t, time, dur);
    ch.apply(rig, e);
    rig.update(e.dt);
    ch.post(rig, e);
    time += e.dt;
  }
  return time;
}

function finite(rig: DragonRig): boolean {
  for (let i = 0; i < rig.total; i++) if (!Number.isFinite(rig.x[i]!) || !Number.isFinite(rig.y[i]!)) return false;
  for (let k = 0; k < 4; k++) if (rig.legOn[k] && (!Number.isFinite(rig.kneeX[k]!) || !Number.isFinite(rig.ankY[k]!))) return false;
  for (let a = 0; a < 2; a++) {
    const w = rig.armPose[a]!;
    for (let i = 0; i < w.n * 2; i++) if (!Number.isFinite(w.pts[i]!)) return false;
  }
  return true;
}

function centroid(pts: Float32Array, n: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += pts[i * 2]!;
    y += pts[i * 2 + 1]!;
  }
  return { x: x / n, y: y / n };
}

describe('wyvern species', () => {
  it('is registered, and unknown species fall back to the newt', () => {
    expect(speciesOf('wyvern')).toBe(WYVERN);
    expect(speciesOf('no-such-species')).toBe(NEWT);
  });

  it('builds wing-arm individuals: two hind legs, the elbow first among the loose plates, never the tail', () => {
    for (let s = 0; s < 40; s++) {
      const ind = buildIndividual(WYVERN, s * 7919 + 3, 0.8 + s * 1.5);
      expect(ind.wingWalk).toBe(1);
      expect(ind.legPairs).toBe(1);
      expect(Number.isInteger(ind.plateCount) && Number.isInteger(ind.crownN)).toBe(true);
      expect(ind.weakSpots[0]!.on).toBe(1);
      for (const w of ind.weakSpots) expect(w.at).toBeLessThan(1.05);
      expect(ind.enter).toBe('glide');
      expect(ind.leave).toBe('fly');
      expect(ind.swipe).toBe('slam');
      expect(ind.breath).toBe('rear');
    }
  });

  it('varies per individual: some carry a spade instead of a club', () => {
    let clubs = 0;
    let spades = 0;
    for (let s = 0; s < 60; s++) {
      const ind = buildIndividual(WYVERN, s * 104729 + 1, 20);
      if (ind.tailClub > 0) clubs++;
      if (ind.tailSpade > 0) spades++;
      expect(ind.tailClub > 0 !== ind.tailSpade > 0).toBe(true);
    }
    expect(clubs).toBeGreaterThan(20);
    expect(spades).toBeGreaterThan(10);
  });

  it('dresses bosses from data; unknown ids are ordinary', () => {
    expect(bossOf('grimmaw')).toBe(BOSSES.grimmaw);
    expect(bossOf('nope')).toBeNull();
    expect(bossOf(null)).toBeNull();
    const plain = buildIndividual(WYVERN, 9, 60);
    const grim = buildIndividual(WYVERN, 9, 60, undefined, 'grimmaw');
    expect(grim.boss?.id).toBe('grimmaw');
    expect(grim.grand).toBe(1);
    expect(grim.dress.snow).toBeGreaterThan(0);
    expect(grim.dress.torn).toBeGreaterThan(0);
    expect(grim.plates).toBeGreaterThan(plain.plates);
    expect(grim.eye).toBe(BOSSES.grimmaw!.eye);
    expect(buildIndividual(WYVERN, 9, 60, undefined, 'nope').grand).toBe(0);
    const elder = buildIndividual(NEWT, 5, 30, undefined, 'elderNewt');
    expect(elder.enter).toBe('walk');
    expect(elder.leave).toBe('walk');
    expect(elder.dress.cataract).toBeGreaterThan(0);
    expect(elder.hornGnarl).toBeGreaterThan(0);
    // Mutation overrides still apply on top of a boss.
    expect(buildIndividual(NEWT, 5, 30, { heads: 3 }, 'elderNewt').heads).toBe(3);
  });

  it('leaves ordinary newts undressed', () => {
    const ind = buildIndividual(NEWT, 5, 30);
    expect(ind.boss).toBeNull();
    expect(ind.dress.moss + ind.dress.snow + ind.dress.torn + ind.dress.cataract + ind.dress.scars).toBe(0);
    expect(ind.wingWalk + ind.plates + ind.crownN).toBe(0);
  });
});

describe('wyvern rig: rest pose', () => {
  it('is normalized, stands on its hind feet and wing-wrists, with the elbows jutting up', () => {
    for (const size of SIZES) {
      for (let s = 0; s < 12; s++) {
        const rig = wyvern(s * 104729 + 7, size);
        expect(rig.armWing).toBe(true);
        expect(rig.wingOn).toBe(false);
        expect(rig.restMinX).toBeCloseTo(0, 9);
        expect(rig.restMaxX).toBeGreaterThan(0.85);
        expect(rig.restMaxX).toBeLessThan(1.4);
        expect(rig.restMaxY).toBeLessThan(0.01);
        for (const k of [LEG_FN, LEG_FF, LEG_BN]) {
          expect(rig.legOn[k]).toBe(1);
          expect(rig.footY[k]).toBeCloseTo(0, 6);
          expect(Math.hypot(rig.kneeX[k]! - rig.hipX[k]!, rig.kneeY[k]! - rig.hipY[k]!)).toBeCloseTo(rig.legA[k]!, 5);
          expect(Math.hypot(rig.ankX[k]! - rig.kneeX[k]!, rig.ankY[k]! - rig.kneeY[k]!)).toBeCloseTo(rig.legB[k]!, 5);
        }
        // The folded wing-arm: the elbow above the shoulder, the wrist on the ground.
        expect(rig.kneeY[LEG_FN]!).toBeLessThan(rig.hipY[LEG_FN]! - 0.03);
        expect(rig.ankY[LEG_FN]!).toBeGreaterThan(-0.05);
        // Rock plates along the back, inside the framing bounds.
        expect(rig.plateN).toBeGreaterThan(3);
        expect(finite(rig)).toBe(true);
      }
    }
  });

  it('lays the plates out per individual and deterministically', () => {
    const a = wyvern(42, 30);
    const b = wyvern(42, 30);
    const c = wyvern(43, 30);
    expect(Array.from(a.plateH)).toEqual(Array.from(b.plateH));
    expect(Array.from(a.plateH)).not.toEqual(Array.from(c.plateH));
    for (let p = 0; p < a.plateN; p++) expect(a.plateH[p]!).toBeGreaterThan(0);
  });
});

describe('wyvern rig: every phase', () => {
  const PHASES: [DragonPhase, DragonAttack, number][] = [
    ['enter', 'breath', 1.6],
    ['idle', 'breath', 6],
    ['windup', 'breath', 1.2],
    ['breath', 'breath', 1.5],
    ['windup', 'swipe', 1.2],
    ['swipe', 'swipe', 0.9],
    ['stagger', 'breath', 2],
    ['idle', 'breath', 1],
    ['dying', 'breath', 1.6],
    ['leave', 'breath', 1.6],
  ];

  it('stays finite, keeps segment lengths and bone lengths, and never flies off to infinity', () => {
    for (const size of SIZES) {
      for (const boss of [null, 'grimmaw']) {
        const rig = wyvern(99 + size * 13, size, boss);
        const ch = new Choreo();
        ch.reset(rig.ind.seed);
        let time = 0;
        for (const [phase, attack, dur] of PHASES) {
          if (phase !== 'dying') rig.dissolve = 1;
          time = play(rig, ch, phase, attack, dur, time);
          expect(finite(rig)).toBe(true);
          for (let i = 1; i < rig.n; i++) {
            if (i === rig.iS) continue;
            const l = rig.leader[i]!;
            const d = Math.hypot(rig.x[i]! - rig.x[l]!, rig.y[i]! - rig.y[l]!);
            expect(Math.abs(d - rig.segLen[i]!)).toBeLessThan(rig.segLen[i]! * 0.25 + 1e-6);
          }
          for (const k of [LEG_FN, LEG_FF]) {
            expect(Math.hypot(rig.kneeX[k]! - rig.hipX[k]!, rig.kneeY[k]! - rig.hipY[k]!)).toBeCloseTo(rig.legA[k]!, 4);
            expect(Math.hypot(rig.ankX[k]! - rig.kneeX[k]!, rig.ankY[k]! - rig.kneeY[k]!)).toBeCloseTo(rig.legB[k]!, 4);
          }
          for (let i = 0; i < rig.total; i++) {
            expect(Math.abs(rig.x[i]!)).toBeLessThan(12);
            expect(rig.y[i]!).toBeLessThan(0.05);
            expect(rig.y[i]!).toBeGreaterThan(-8);
          }
          // Wing tips never go through the ground.
          for (let a = 0; a < 2; a++) {
            const w = rig.armPose[a]!;
            for (let f = 0; f < rig.fingers; f++) expect(w.pts[7 + f * 2]!).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });

  it('glides in: airborne with its wings spread, then lands and folds them before the weak spot is live', () => {
    const rig = wyvern(7, 15);
    const ch = new Choreo();
    ch.reset(7);
    play(rig, ch, 'enter', 'breath', 1.6, 0, 0.3);
    expect(rig.ch[C_AIR]).toBe(1);
    expect(rig.ch[C_WSPREAD]!).toBeGreaterThan(0.9);
    const high = rig.restAy - rig.y[rig.iS]!;
    expect(high).toBeGreaterThan(0.5);
    const rig2 = wyvern(7, 15);
    const ch2 = new Choreo();
    ch2.reset(7);
    // Core makes the spot hittable from 72% of the entrance: it must have landed by then.
    play(rig2, ch2, 'enter', 'breath', 1.6, 0, 0.72);
    expect(rig2.ch[C_AIR]).toBe(0);
    expect(Math.abs(rig2.restAy - rig2.y[rig2.iS]!)).toBeLessThan(0.08);
    play(rig2, ch2, 'enter', 'breath', 1.6, 2, 1);
    expect(rig2.ch[C_WSPREAD]!).toBeLessThan(0.05);
    expect(rig2.footY[LEG_FN]!).toBeCloseTo(0, 3);
  });

  it('flies away on leave: turned around, airborne and far off to the right and up at the end', () => {
    const rig = wyvern(3, 15);
    const ch = new Choreo();
    ch.reset(3);
    play(rig, ch, 'leave', 'breath', 1.6, 0);
    expect(rig.ch[C_FACE]!).toBeLessThan(-0.95);
    expect(rig.ch[C_AIR]).toBe(1);
    // Placed x of the body middle: far right of where it stood (exitDist 6 in this env).
    const mid = rig.placeX(rig.x[rig.iS + 4]!);
    expect(mid - rig.midX).toBeGreaterThan(4.5);
    expect(rig.restAy - rig.y[rig.iS]!).toBeGreaterThan(3.5);
  });

  it('slams: the club comes down to the ground in front of the body around a third of the way in', () => {
    const rig = wyvern(5, 15);
    const ch = new Choreo();
    ch.reset(5);
    let t = play(rig, ch, 'windup', 'swipe', 1.2, 0);
    // Coiled: the tail tip high over the back.
    expect(rig.y[rig.n - 1]!).toBeLessThan(-0.25);
    t = play(rig, ch, 'swipe', 'swipe', 0.9, t, 0.38);
    const tip = rig.n - 1;
    expect(rig.y[tip]!).toBeGreaterThan(-0.08);
    expect(rig.placeX(rig.x[tip]!)).toBeLessThan(rig.placeX(rig.x[rig.iS + 4]!));
  });
});

describe('wyvern loose plates', () => {
  it('every candidate sits clear of the torso middle by more than a big dragon hit radius', async () => {
    const { WeakSpot, WEAK_SCALE } = await import('./weakspot');
    const { WEAK_DRAW_FRAC, WEAK_HIT_SCALE } = await import('./tuning');
    const sp = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };
    const mid = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };
    const ang = { a: 0 };
    const w = new WeakSpot();
    // Big on screen the hit radius is the drawn plate's (a fixed share of the body length).
    const radius = WEAK_DRAW_FRAC * WEAK_HIT_SCALE;
    for (const size of SIZES) {
      for (let seed = 1; seed < 30; seed++) {
        const rig = wyvern(seed * 7919, size);
        rig.spineAtBody(0.5, mid);
        for (let idx = 0; idx < rig.ind.weakSpots.length; idx++) {
          const p = w.pos(rig, sp, { x: 0, y: 0 }, ang, WEAK_SCALE, idx);
          expect(Math.hypot(p.x - mid.x, p.y - mid.y)).toBeGreaterThan(radius * 1.15);
        }
      }
    }
  });
});

describe('run cycle and walks', () => {
  it('the Elder Newt walks in on the run cycle and plants its feet once it arrives', () => {
    const rig = new DragonRig();
    rig.setup(buildIndividual(NEWT, 11, 30, undefined, 'elderNewt'));
    rig.tempo = 0.36;
    const ch = new Choreo();
    ch.reset(11);
    play(rig, ch, 'enter', 'breath', 1.6, 0, 0.4);
    expect(rig.ch[C_RUN]!).toBeGreaterThan(0.9);
    play(rig, ch, 'enter', 'breath', 1.6, 1, 1);
    play(rig, ch, 'idle', 'breath', 3, 3);
    expect(rig.ch[C_RUN]!).toBeLessThan(0.01);
    for (const k of [0, 1, 2, 3]) expect(rig.footY[k]!).toBeCloseTo(0, 3);
    expect(finite(rig)).toBe(true);
  });

  it('the newt scuttles off turned around and ends past the right edge', () => {
    const rig = new DragonRig();
    rig.setup(buildIndividual(NEWT, 2, 1));
    const ch = new Choreo();
    ch.reset(2);
    play(rig, ch, 'leave', 'breath', 1.2, 0);
    expect(rig.ch[C_FACE]!).toBeLessThan(-0.95);
    expect(rig.placeX(rig.x[rig.iS + 4]!) - rig.midX).toBeGreaterThan(4.5);
    expect(finite(rig)).toBe(true);
  });
});

describe('wing hit area (wing-arms)', () => {
  it('folded and spread membranes are body hits; open sky is not', () => {
    const rig = wyvern(9, 30);
    const folded = centroid(rig.armPose[0]!.pts, rig.armPose[0]!.n);
    expect(rig.hitBody(folded.x, folded.y, 0)).toBe(true);
    const ch = new Choreo();
    ch.reset(9);
    play(rig, ch, 'windup', 'breath', 1.2, 0);
    expect(rig.ch[C_WSPREAD]!).toBeGreaterThan(0.9);
    for (let a = 0; a < 2; a++) {
      const w = rig.armPose[a]!;
      const c = centroid(w.pts, w.n);
      expect(rig.hitBody(c.x, c.y, 0)).toBe(true);
    }
    expect(rig.hitBody(0.5, -3, 0.01)).toBe(false);
  });
});

describe('BoundedCache', () => {
  it('never grows past its capacity, evicting the oldest palette', () => {
    const c = new BoundedCache<number>(3);
    let built = 0;
    for (const name of ['meadow', 'mountain', 'kingdom', 'sky', 'meadow', 'mountain']) c.getOrBuild(name, () => ++built);
    expect(c.size).toBe(3);
    expect(c.get('kingdom')).toBeUndefined();
    // A hit builds nothing.
    const before = built;
    c.getOrBuild('mountain', () => ++built);
    expect(built).toBe(before);
  });
});
