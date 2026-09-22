// DragonView contract tests (Node): hit areas, weak-spot rules, bounds, points. The view methods
// work straight from state + the rig's rest pose, so no canvas is needed.
import { describe, expect, it } from 'vitest';
import type { Scene } from '../../app/scene';
import type { DragonAttack, DragonPhase } from '../../core';
import type { Rect, Vec2 } from '../../lib/vec';
import { Camera } from '../camera';
import { CLASH_X } from '../world';
import { createDragon } from './index';
import { WEAK_HIT_MIN_PX } from './tuning';

interface FakeDragon {
  id: number;
  index: number;
  species: string;
  size: number;
  seed: number;
  phase: DragonPhase;
  phaseT: number;
  phaseDur: number;
  attack: DragonAttack;
}

function setup(size: number, seed: number, zoom = 100) {
  const dragon: FakeDragon = { id: 1, index: 0, species: 'newt', size, seed, phase: 'idle', phaseT: 0, phaseDur: 5, attack: 'breath' };
  const camera = new Camera();
  camera.setViewport(1440, 900);
  camera.zoom = zoom;
  camera.x = 0;
  camera.y = -1;
  camera.derive();
  const noop = (): undefined => undefined;
  const scene = {
    game: { state: { dragon, flags: {} }, on: () => noop },
    camera,
    director: { target: { x: 0, zoom } },
    crowd: {
      heroPoint: (o: Vec2) => ((o.x = -0.95), (o.y = -1.2), o),
      frontX: () => -0.3,
      bounds: (o: Rect) => ((o.x = -3), (o.y = -1.9), (o.w = 2.7), (o.h = 1.9), o),
    },
    input: { pointer: { x: -1, y: -1 } },
    debug: { enabled: false, section: noop, button: noop, slider: noop, toggle: noop, watch: noop },
  } as unknown as Scene;
  const { view } = createDragon(scene);
  const setPhase = (phase: DragonPhase, attack: DragonAttack = 'breath', k = 0.5): void => {
    dragon.phase = phase;
    dragon.attack = attack;
    dragon.phaseDur = 1.2;
    dragon.phaseT = k * 1.2;
  };
  return { view, dragon, camera, setPhase };
}

const v = (): Vec2 => ({ x: 0, y: 0 });
const r = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });

describe('DragonView bounds', () => {
  it('is the stable rest pose: front edge at CLASH_X, about one body length wide, on the ground', () => {
    for (const size of [0.5, 2, 10, 40]) {
      const { view, setPhase } = setup(size, 17);
      const a = view.bounds(r());
      setPhase('windup', 'swipe', 0.7);
      const b = view.bounds(r());
      expect(b).toEqual(a);
      expect(a.x).toBeCloseTo(CLASH_X, 9);
      expect(a.w / size).toBeGreaterThan(0.85);
      expect(a.w / size).toBeLessThan(1.35);
      expect(a.y).toBeLessThan(0);
      expect(a.y + a.h).toBeGreaterThanOrEqual(0);
      expect(a.y + a.h).toBeLessThan(0.02 * size);
    }
  });

  it('follows a new dragon (new id) immediately', () => {
    const { view, dragon } = setup(1, 5);
    const a = view.bounds(r());
    dragon.id = 2;
    dragon.size = 3;
    const b = view.bounds(r());
    expect(b.w).toBeCloseTo(a.w * 3, 0);
  });
});

describe('DragonView points', () => {
  it('headPoint is at the front, up off the ground; impactPoint lands on the body', () => {
    for (const size of [0.5, 10]) {
      const { view } = setup(size, 3, 600 / size);
      const b = view.bounds(r());
      const h = view.headPoint(v());
      expect(h.x).toBeLessThan(b.x + b.w * 0.35);
      expect(h.y).toBeLessThan(0);
      for (let i = 0; i < 200; i++) {
        const p = view.impactPoint(v());
        expect(view.hitTest(p.x, p.y)).not.toBeNull();
        expect(p.x).toBeGreaterThanOrEqual(b.x - 0.05 * size);
        expect(p.x).toBeLessThanOrEqual(b.x + b.w);
      }
    }
  });
});

describe('DragonView tailPoint / breathReachX', () => {
  it('tailPoint is the live tail tip: behind the body at rest, on or above the ground', () => {
    for (const size of [0.5, 2, 10, 40]) {
      const { view } = setup(size, 21, 600 / size);
      const b = view.bounds(r());
      const t = view.tailPoint!(v());
      expect(t.x).toBeGreaterThan(b.x + b.w * 0.75);
      expect(t.x).toBeLessThanOrEqual(b.x + b.w + 1e-9);
      expect(t.y).toBeLessThanOrEqual(1e-9);
    }
  });

  it('breathReachX lies in front of the army, further out for bigger dragons', () => {
    let prev = Infinity;
    for (const size of [0.5, 2, 10, 40]) {
      const { view } = setup(size, 21, 600 / size);
      const x = view.breathReachX!();
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeLessThan(-0.3 - 0.45); // past the front line (-0.3) by at least the minimum aim
      expect(x).toBeLessThan(prev);
      prev = x;
    }
  });
});

describe('DragonView weak spot rules', () => {
  it('breath windup: only the throat is weak; the loose scale is not', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { view, setPhase } = setup(2, seed * 7919, 250);
      setPhase('idle');
      const scale = view.weakSpot(v())!;
      expect(scale).not.toBeNull();
      expect(view.hitTest(scale.x, scale.y)).toBe('weak');
      setPhase('windup', 'breath', 0.02);
      const throat = view.weakSpot(v())!;
      expect(throat).not.toBeNull();
      expect(view.hitTest(throat.x, throat.y)).toBe('weak');
      // The loose scale's spot is now a plain body hit.
      expect(view.hitTest(scale.x, scale.y)).toBe('body');
      // The throat is up front, near the head.
      const head = view.headPoint(v());
      expect(Math.hypot(throat.x - head.x, throat.y - head.y)).toBeLessThan(Math.hypot(scale.x - head.x, scale.y - head.y));
      // After the windup the loose scale is back.
      setPhase('breath', 'breath', 0.1);
      expect(view.hitTest(scale.x, scale.y)).toBe('weak');
      expect(view.hitTest(throat.x, throat.y)).not.toBe('weak');
    }
  });

  it('swipe windup: big on screen, the raised tail curl; distinct from the throat', () => {
    // 2 m at zoom 250 -> 500 px per body length: the curl tier.
    const { view, setPhase } = setup(2, 99, 250);
    setPhase('windup', 'breath', 0.5);
    const throat = view.weakSpot(v())!;
    setPhase('windup', 'swipe', 0.5);
    const tail = view.weakSpot(v())!;
    expect(view.hitTest(tail.x, tail.y)).toBe('weak');
    expect(view.hitTest(throat.x, throat.y)).not.toBe('weak');
    const b = view.bounds(r());
    expect(tail.x).toBeGreaterThan(b.x + b.w * 0.55);
  });

  it('a newt at zoom 100: the swipe target sits >= 2 hit radii from the loose scale, which cannot crit', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { view, setPhase } = setup(0.5, seed * 104729, 100);
      setPhase('idle');
      const scale = view.weakSpot(v())!;
      setPhase('windup', 'swipe', 0.02);
      const target = view.weakSpot(v())!;
      expect(view.hitTest(target.x, target.y)).toBe('weak');
      // Mashing the old scale spot is a plain body hit, not a stagger...
      expect(view.hitTest(scale.x, scale.y)).toBe('body');
      // ...with margin: the target is at least two hit radii away (in CSS px at this zoom).
      expect(Math.hypot(target.x - scale.x, target.y - scale.y) * 100).toBeGreaterThanOrEqual(2 * WEAK_HIT_MIN_PX);
      // After the windup the loose scale is back.
      setPhase('swipe', 'swipe', 0.1);
      expect(view.hitTest(scale.x, scale.y)).toBe('weak');
    }
  });

  it('none while flying in or dying', () => {
    const { view, setPhase } = setup(2, 4, 250);
    setPhase('enter', 'breath', 0.3);
    expect(view.weakSpot(v())).toBeNull();
    setPhase('dying', 'breath', 0.1);
    expect(view.weakSpot(v())).toBeNull();
  });

  it('a newt at the base framing: clicking the middle of the body is a normal hit, not a crit', () => {
    for (let seed = 1; seed < 60; seed++) {
      // Base framing: a 1.8 m knight is 20% of a 900 px stage = 100 px/m; the newt is 0.5 m.
      const { view, setPhase } = setup(0.5, seed * 104729, 100);
      for (const [ph, at] of [['idle', 'breath'], ['windup', 'breath'], ['windup', 'swipe'], ['breath', 'breath']] as const) {
        setPhase(ph, at, 0.5);
        const b = view.bounds(r());
        // The torso's middle: a little behind the middle of the bounds, halfway up the body.
        const mx = b.x + b.w * 0.42;
        const my = b.y + b.h * 0.55;
        expect(view.hitTest(mx, my)).toBe('body');
        const w = view.weakSpot(v())!;
        expect(view.hitTest(w.x, w.y)).toBe('weak');
        // ...and the forgiving radius is exactly the tuned minimum here.
        const edge = WEAK_HIT_MIN_PX / 100;
        expect(view.hitTest(w.x + edge * 0.95, w.y)).toBe('weak');
      }
    }
  });
});
