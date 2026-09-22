import { describe, expect, it } from 'vitest';
import { Camera } from './camera';
import { CameraDirector } from './director';
import type { DragonView } from './dragon/api';
import type { CrowdView } from './crowd/api';
import type { Rect } from '../lib/vec';

/** Minimal stand-in for CanvasRenderingContext2D.transform() composition. */
class FakeCtx {
  m = [1, 0, 0, 1, 0, 0];
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const [A, B, C, D, E, F] = this.m as [number, number, number, number, number, number];
    this.m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  }
  apply(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.m as [number, number, number, number, number, number];
    return [a * x + c * y + e, b * x + d * y + f];
  }
}

function camera(): Camera {
  const c = new Camera();
  c.setViewport(1440, 900);
  c.insetRightTarget = 340;
  c.snapInset();
  c.x = 3;
  c.y = -4;
  c.zoom = 37;
  c.rot = 0.05;
  c.derive();
  return c;
}

describe('Camera', () => {
  it('screenToWorld inverts worldToScreen (zoom, roll, inset, shake)', () => {
    const c = camera();
    c.addTrauma(0.8);
    c.update(0.016);
    const s = { x: 0, y: 0 };
    const w = { x: 0, y: 0 };
    for (const [x, y] of [
      [0, 0],
      [12.5, -3],
      [-40, 7],
    ] as const) {
      c.worldToScreen(x, y, s);
      c.screenToWorld(s.x, s.y, w);
      expect(w.x).toBeCloseTo(x, 9);
      expect(w.y).toBeCloseTo(y, 9);
    }
  });

  it('puts the camera point at the stage center (left of the panel)', () => {
    const c = camera();
    c.rot = 0;
    c.derive();
    const s = c.worldToScreen(c.x, c.y, { x: 0, y: 0 });
    expect(s.x).toBeCloseTo((1440 - 340) / 2, 9);
    expect(s.y).toBeCloseTo(450, 9);
  });

  it('parallax depth 1 equals the world transform', () => {
    const c = camera();
    c.anchorFrac = 0.76;
    c.refZoom = 100;
    c.refX = -0.5;
    c.refY = 0;
    const ctx = new FakeCtx();
    c.applyParallax(ctx as unknown as CanvasRenderingContext2D, 1);
    const s = { x: 0, y: 0 };
    for (const [x, y] of [
      [1, 2],
      [-20, -5],
    ] as const) {
      const [px, py] = ctx.apply(x, y);
      c.worldToScreen(x, y, s);
      expect(px).toBeCloseTo(s.x, 6);
      expect(py).toBeCloseTo(s.y, 6);
    }
  });

  it('parallax depth 0 ignores camera pan and zoom', () => {
    const a = camera();
    const b = camera();
    for (const c of [a, b]) {
      c.anchorFrac = 0.76;
      c.refZoom = 100;
      c.rot = 0;
    }
    b.x += 50;
    b.zoom = 3;
    b.derive();
    const p = { x: 0, y: 0 };
    const q = { x: 0, y: 0 };
    a.parallaxToScreen(0, 10, -2, p);
    b.parallaxToScreen(0, 10, -2, q);
    expect(q.x).toBeCloseTo(p.x, 9);
    expect(q.y).toBeCloseTo(p.y, 9);
  });
});

describe('CameraDirector', () => {
  const dragonSize = { L: 0.5 };
  const dragon: DragonView = {
    hitTest: () => null,
    impactPoint: (o) => o,
    weakSpot: () => null,
    headPoint: (o) => o,
    bounds: (o: Rect) => ((o.x = 0), (o.y = -0.6 * dragonSize.L), (o.w = 1.1 * dragonSize.L), (o.h = 0.6 * dragonSize.L), o),
  };
  const crowd: CrowdView = {
    heroPoint: (o) => o,
    frontX: () => -0.4,
    bounds: (o: Rect) => ((o.x = -1.6), (o.y = -2.1), (o.w = 1.2), (o.h = 2.3), o),
  };

  function framed(L: number): Camera {
    const cam = new Camera();
    cam.setViewport(1440, 900);
    dragonSize.L = L;
    const d = new CameraDirector({ camera: cam, dragon, crowd });
    d.update(1 / 60); // first update snaps
    cam.update(0);
    return cam;
  }

  it('starts at the base framing: the hero is ~20% of the stage height', () => {
    const cam = framed(0.5);
    expect((cam.zoom * 1.8) / 900).toBeCloseTo(0.2, 2);
  });

  it('pulls back monotonically as dragons grow, and big dragons fill 35-50% of the width', () => {
    let last = Infinity;
    for (const L of [0.5, 1, 2.5, 5, 10, 20, 50, 200]) {
      const cam = framed(L);
      expect(cam.zoom).toBeLessThanOrEqual(last);
      last = cam.zoom;
      if (L >= 10) {
        const frac = (1.1 * L * cam.zoom) / 1440;
        expect(frac).toBeGreaterThan(0.35);
        expect(frac).toBeLessThan(0.5);
      }
    }
  });

  it('keeps the ground line pinned at groundFrac at any zoom', () => {
    for (const L of [0.5, 8, 120]) {
      const cam = framed(L);
      const s = cam.worldToScreen(cam.x, 0, { x: 0, y: 0 });
      expect(s.y / 900).toBeCloseTo(0.76, 6);
    }
  });

  it('eases without popping when the target jumps', () => {
    const cam = new Camera();
    cam.setViewport(1440, 900);
    dragonSize.L = 0.5;
    const d = new CameraDirector({ camera: cam, dragon, crowd });
    d.update(1 / 60);
    const z0 = cam.zoom;
    dragonSize.L = 30;
    let prev = z0;
    let maxStep = 0;
    for (let i = 0; i < 180; i++) {
      d.update(1 / 60);
      maxStep = Math.max(maxStep, Math.abs(Math.log(cam.zoom / prev)));
      prev = cam.zoom;
    }
    expect(cam.zoom).toBeLessThan(z0 / 5);
    expect(maxStep).toBeLessThan(0.08); // no single-frame jump bigger than ~8%
  });
});
