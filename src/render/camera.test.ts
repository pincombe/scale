import { describe, expect, it } from 'vitest';
import { Camera } from './camera';

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
