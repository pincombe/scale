import { describe, expect, it } from 'vitest';
import { Camera } from './camera';
import { CameraDirector, framing } from './director';
import type { DragonView } from './dragon/api';
import type { CrowdView } from './crowd/api';
import { rect, vec2, type Rect } from '../lib/vec';
import { KNIGHT_HEIGHT } from './world';

// A newt-shaped stand-in: long and low (the real rig's rest bounds are ~0.3 L tall), front at x = 0.
const world = { L: 0.5, armyBack: 1.7, tall: 0.32 };
const dragon: DragonView = {
  hitTest: () => null,
  impactPoint: (o) => o,
  weakSpot: () => null,
  headPoint: (o) => o,
  bounds: (o: Rect) => ((o.x = 0), (o.y = -world.tall * world.L), (o.w = world.L), (o.h = world.tall * world.L), o),
};
const crowd: CrowdView = {
  heroPoint: (o) => ((o.x = -0.85), (o.y = -1), o),
  frontX: () => -1.2,
  bounds: (o: Rect) => ((o.x = -world.armyBack), (o.y = -3.3), (o.w = world.armyBack - 0.6), (o.h = 3.6), o),
};

function setup(w = 1440, h = 900, inset = 0): { cam: Camera; dir: CameraDirector } {
  const cam = new Camera();
  cam.setViewport(w, h);
  cam.insetRightTarget = inset;
  cam.snapInset();
  const dir = new CameraDirector({ camera: cam, dragon, crowd });
  return { cam, dir };
}

function framed(L: number, armyBack = 1.7, w = 1440, h = 900, inset = 0): Camera {
  world.L = L;
  world.armyBack = armyBack;
  const { cam, dir } = setup(w, h, inset);
  dir.update(1 / 60); // the first update snaps
  cam.update(0);
  return cam;
}

const at = (cam: Camera, wx: number, wy: number) => cam.worldToScreen(wx, wy, vec2());
/** The dragon's rest-pose width as a fraction of the stage width. */
const share = (cam: Camera, L: number) => (L * cam.zoom) / cam.stageW;

describe('CameraDirector framing', () => {
  it('opens close: the hero is heroFrac of the stage height and the first newt reads (>= 70 px)', () => {
    const cam = framed(0.5);
    expect((cam.zoom * KNIGHT_HEIGHT) / 900).toBeCloseTo(0.29, 3);
    expect(0.5 * cam.zoom).toBeGreaterThanOrEqual(70);
    // Bigger screens keep the same proportions.
    const big = framed(0.5, 1.7, 1920, 1080);
    expect((big.zoom * KNIGHT_HEIGHT) / 1080).toBeCloseTo(0.29, 3);
  });

  it('holds the base framing while the first dragons grow, then pulls back monotonically', () => {
    let last = Infinity;
    const base = framed(0.5).zoom;
    for (const L of [0.5, 0.8, 1.2, 2, 3, 4, 6, 10, 12, 20, 41, 77, 200]) {
      const cam = framed(L);
      expect(cam.zoom).toBeLessThanOrEqual(last + 1e-9);
      if (L <= 2) expect(cam.zoom).toBeCloseTo(base, 6);
      last = cam.zoom;
    }
  });

  it("ramps the dragon's share of the stage width with size (~44% from 10 m)", () => {
    // Pulled back: the share follows the ramp exactly.
    expect(share(framed(4), 4)).toBeCloseTo(setup().dir.share(4), 6);
    expect(share(framed(6), 6)).toBeGreaterThan(0.36);
    for (const L of [10, 12, 41, 77]) {
      expect(share(framed(L), L)).toBeCloseTo(0.44, 3);
      expect(share(framed(L, 1.7, 1440, 900, 340), L)).toBeCloseTo(0.44, 3);
    }
    // Share never falls as dragons grow.
    let last = 0;
    for (const L of [0.5, 1, 2, 3, 5, 8, 12, 30]) {
      const s = share(framed(L), L);
      expect(s).toBeGreaterThanOrEqual(last - 1e-9);
      last = s;
    }
  });

  it('puts the clash point at ~40% of the stage width, panel open or closed', () => {
    for (const inset of [0, 340]) {
      for (const L of [0.5, 1.2, 3, 12, 41]) {
        const cam = framed(L, 8, 1440, 900, inset);
        const f = at(cam, 0, 0).x / cam.stageW;
        expect(f).toBeGreaterThan(0.38);
        expect(f).toBeLessThan(0.42);
        // The dragon stays on stage, with room to spare on the right.
        expect(at(cam, L, 0).x).toBeLessThan(cam.stageW * 0.9);
      }
    }
  });

  it('keeps the ground line at groundFrac at any zoom', () => {
    for (const L of [0.5, 8, 120]) {
      const cam = framed(L);
      expect(at(cam, cam.x, 0).y / 900).toBeCloseTo(0.76, 6);
    }
  });

  it("keeps a tall dragon's top (plus fly-in headroom) clear of the HUD band", () => {
    world.tall = 1.4;
    try {
      for (const L of [2, 12, 60]) {
        const cam = framed(L);
        const top = at(cam, 0, -1.4 * L - 0.25 * L).y;
        expect(top).toBeGreaterThanOrEqual(0.76 * 900 * 0.2 - 1e-6);
      }
    } finally {
      world.tall = 0.32;
    }
  });

  it('lets a big army nudge the camera back by at most armyWiden, and not at all once dragons are big', () => {
    const d = setup().dir;
    const small = framed(0.8, 1.7).zoom;
    const host = framed(0.8, 30).zoom;
    expect(host).toBeLessThan(small);
    expect(small / host).toBeCloseTo(d.armyWiden, 6);
    expect(framed(0.8, 3).zoom).toBeLessThanOrEqual(small);
    expect(framed(12, 60).zoom).toBeCloseTo(framed(12, 1.7).zoom, 9);
  });

  it('keeps the hero on a narrow stage', () => {
    const cam = framed(0.5, 1.7, 700, 900);
    // The hero's back (~1.4 m left of the clash point) stays on stage.
    expect(at(cam, -1.4, 0).x).toBeGreaterThan(0);
  });

  it('frame() is pure: same inputs, same answer', () => {
    const d = setup().dir;
    const D = rect(0, -1, 3, 1);
    const C = rect(-9, -3.3, 8, 3.6);
    const a = d.frame(1100, 900, D, C, framing());
    const b = d.frame(1100, 900, D, C, framing());
    expect(a).toEqual(b);
    expect(a.x).toBeCloseTo(a.clashX + ((0.5 - a.clashFrac) * 1100) / a.zoom, 9);
  });

  it('references parallax to the fixed backdrop framing, not the close base framing', () => {
    const cam = framed(0.5);
    expect(cam.refZoom).toBeCloseTo((0.2 * 900) / KNIGHT_HEIGHT, 9);
    expect(cam.anchorFrac).toBe(0.76);
  });
});

describe('CameraDirector motion', () => {
  /** Runs `frames` updates and returns the biggest per-frame log-zoom step and clash-point move (px). */
  function run(cam: Camera, dir: CameraDirector, frames: number): { dz: number; dx: number } {
    let dz = 0;
    let dx = 0;
    let z = cam.zoom;
    let x = at(cam, 0, 0).x;
    for (let i = 0; i < frames; i++) {
      dir.update(1 / 60);
      cam.update(1 / 60);
      const nx = at(cam, 0, 0).x;
      dz = Math.max(dz, Math.abs(Math.log(cam.zoom / z)));
      dx = Math.max(dx, Math.abs(nx - x));
      z = cam.zoom;
      x = nx;
    }
    return { dz, dx };
  }

  it('eases without popping when a much bigger dragon spawns', () => {
    world.L = 0.5;
    world.armyBack = 1.7;
    const { cam, dir } = setup();
    dir.update(1 / 60);
    cam.update(0);
    const z0 = cam.zoom;
    world.L = 30;
    const m = run(cam, dir, 240);
    expect(cam.zoom).toBeLessThan(z0 / 5);
    expect(m.dz).toBeLessThan(0.08);
    expect(m.dx).toBeLessThan(12);
  });

  it('slides the clash point smoothly when the panel opens, and settles at the same fraction', () => {
    world.L = 1.2;
    world.armyBack = 5;
    const { cam, dir } = setup();
    dir.update(1 / 60);
    cam.update(0);
    cam.insetRightTarget = 340;
    const m = run(cam, dir, 240);
    expect(m.dz).toBeLessThan(0.02);
    expect(m.dx).toBeLessThan(25);
    expect(at(cam, 0, 0).x / cam.stageW).toBeCloseTo(0.39, 2);
  });

  it('drifts, never jumps, as units are bought', () => {
    world.L = 1.2;
    world.armyBack = 1.7;
    const { cam, dir } = setup();
    dir.update(1 / 60);
    cam.update(0);
    let worst = 0;
    for (let n = 0; n < 20; n++) {
      world.armyBack += 0.64; // a new footman column
      worst = Math.max(worst, run(cam, dir, 20).dz);
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('leaves the camera alone while disabled (the M2 zoom director drives it)', () => {
    world.L = 3;
    const { cam, dir } = setup();
    dir.enabled = false;
    cam.x = 42;
    cam.zoom = 7;
    dir.update(1 / 60);
    expect(cam.x).toBe(42);
    expect(cam.zoom).toBe(7);
  });
});
