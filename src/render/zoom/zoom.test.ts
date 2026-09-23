import { describe, expect, it } from 'vitest';
import { Camera } from '../camera';
import { ZOOM_BEATS, pullEase, pullSpeed, span, zoomTimeline } from './timeline';
import { BOOTS_FILL, BOOTS_X0, BOOTS_X1, HERO_UNIT, HERO_Y, PullBack, computeFlashFraming, flashFraming } from './geometry';

describe('zoom timeline', () => {
  it('fires the beats in order, with the switch at the flash', () => {
    for (const gentle of [false, true]) {
      const tl = zoomTimeline(gentle);
      let last = -1;
      for (const b of ZOOM_BEATS) {
        expect(tl.beats[b]).toBeGreaterThan(last);
        last = tl.beats[b];
      }
      expect(tl.flash).toBe(tl.beats.flash);
      expect(tl.pullStart).toBe(tl.flash);
      expect(tl.fuse).toBeGreaterThan(tl.beats.fusion);
      expect(tl.fuse).toBeLessThan(tl.flash);
      expect(tl.pullEnd).toBeGreaterThan(tl.beats.pullback);
      expect(tl.beats.reveal).toBeLessThan(tl.pullEnd);
      expect(tl.handoff0).toBeLessThan(tl.beats.done);
      expect(tl.handoff1).toBeGreaterThan(tl.beats.done);
      expect(tl.end).toBeGreaterThan(tl.handoff1);
    }
  });

  it('plays slower after the flash with reduce motion', () => {
    const a = zoomTimeline(false);
    const b = zoomTimeline(true);
    expect(b.flash).toBe(a.flash);
    expect(b.pullEnd - b.pullStart).toBeGreaterThan(a.pullEnd - a.pullStart);
    expect(b.beats.done).toBeGreaterThan(a.beats.done);
  });

  it('span clamps', () => {
    expect(span(-1, 0, 2)).toBe(0);
    expect(span(1, 0, 2)).toBe(0.5);
    expect(span(3, 0, 2)).toBe(1);
    expect(span(1, 1, 1)).toBe(1);
  });
});

describe('pullEase', () => {
  it('runs 0 -> 1, monotonic and continuous, starting and landing at rest', () => {
    expect(pullEase(0)).toBe(0);
    expect(pullEase(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 1000; i++) {
      const u = i / 1000;
      const e = pullEase(u);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(e - prev).toBeLessThan(0.004);
      prev = e;
    }
    expect(pullSpeed(0.0001)).toBeLessThan(0.01);
    expect(pullSpeed(0.9999)).toBeLessThan(0.01);
    // The boots read: after a tenth of the time the zoom has barely moved.
    expect(pullEase(0.1)).toBeLessThan(0.03);
  });

  it('pullSpeed is its derivative', () => {
    for (const u of [0.05, 0.2, 0.31, 0.5, 0.7, 0.8, 0.95]) {
      const h = 1e-5;
      const d = (pullEase(u + h) - pullEase(u - h)) / (2 * h);
      expect(pullSpeed(u)).toBeCloseTo(d, 4);
    }
  });
});

describe('flash framing', () => {
  const W = 1440;
  const H = 900;
  const base = (0.29 * H) / 1.8;

  it('spans the stage with both boots, the ground at its line, the hero root under the colossus', () => {
    const ratio = 212 / 1.8;
    const f = computeFlashFraming(W, H, W / 2, H / 2, -2.4, ratio, 0.76, base, flashFraming());
    const unit = HERO_UNIT * ratio;
    expect((BOOTS_X1 - BOOTS_X0) * unit * f.zoom).toBeCloseTo(BOOTS_FILL * W, 6);
    const cam = new Camera();
    cam.setViewport(W, H);
    cam.x = f.x;
    cam.y = f.y;
    cam.zoom = f.zoom;
    cam.derive();
    const p = { x: 0, y: 0 };
    cam.worldToScreen(-2.4, HERO_Y, p);
    expect(p.x).toBeCloseTo(f.rootSX, 6);
    expect(p.y).toBeCloseTo(f.rootSY, 6);
    cam.worldToScreen(0, 0, p);
    expect(p.y).toBeCloseTo(0.76 * H, 6);
    // The boots are centered on the stage.
    expect(f.rootSX + ((BOOTS_X0 + BOOTS_X1) / 2) * unit * f.zoom).toBeCloseTo(W / 2, 6);
  });

  it('never frames closer than the base framing, nor wider than the backdrop holds', () => {
    const tiny = computeFlashFraming(W, H, W / 2, H / 2, 0, 1, 0.76, base, flashFraming());
    expect(tiny.zoom).toBeLessThanOrEqual(base + 1e-9);
    const huge = computeFlashFraming(W, H, W / 2, H / 2, 0, 1e6, 0.76, base, flashFraming());
    expect(huge.zoom).toBeGreaterThanOrEqual(base / 12 - 1e-9);
  });
});

describe('PullBack', () => {
  const setup = (): PullBack => {
    const p = new PullBack();
    p.snapW = 1440;
    p.snapH = 900;
    p.stageCX = 720;
    p.stageCY = 450;
    p.rootX = -2.03;
    p.rootY = HERO_Y;
    p.sx0 = 600;
    p.sy0 = 686;
    p.z0 = 2230;
    p.sxe = 268;
    p.sye = 701;
    p.ze = 145;
    // A scale on the hide in front of the toes.
    p.ex = -1.5;
    p.ey = 0.27;
    p.ew = 0.24;
    return p;
  };

  it('starts at the flash: the snapshot covers the screen 1:1, the root where it was', () => {
    const p = setup().at(0);
    expect(p.zoom).toBeCloseTo(2230, 6);
    expect(p.k).toBeCloseTo(1, 9);
    expect(p.ax).toBeCloseTo(0, 6);
    expect(p.ay).toBeCloseTo(0, 6);
    expect(p.rootSX).toBeCloseTo(600, 6);
    expect(p.rootSY).toBeCloseTo(686, 6);
  });

  it('lands on the director framing with the meadow exactly its scale', () => {
    const p = setup().at(1);
    expect(p.zoom).toBeCloseTo(145, 6);
    expect(p.rootSX).toBeCloseTo(268, 6);
    expect(p.rootSY).toBeCloseTo(701, 6);
    const q = { x: 0, y: 0 };
    p.toScreen(p.ex, p.ey, q);
    expect(p.ax).toBeCloseTo(q.x, 6);
    expect(p.ay).toBeCloseTo(q.y, 6);
    expect(p.k * p.snapW).toBeCloseTo(p.ew * p.ze, 6);
    expect(p.fit).toBeCloseTo(0, 9);
  });

  it('the camera it writes puts the root where it says, all the way', () => {
    const p = setup();
    const cam = new Camera();
    cam.setViewport(1440, 900);
    const q = { x: 0, y: 0 };
    for (let i = 0; i <= 20; i++) {
      p.at(i / 20);
      cam.x = p.camX;
      cam.y = p.camY;
      cam.zoom = p.zoom;
      cam.derive();
      cam.worldToScreen(p.rootX, p.rootY, q);
      expect(q.x).toBeCloseTo(p.rootSX, 5);
      expect(q.y).toBeCloseTo(p.rootSY, 5);
    }
  });

  it('is one smooth exponential: monotonic zoom, the meadow never grows, no jumps', () => {
    const p = setup();
    let lastZ = Infinity;
    let lastK = Infinity;
    let lastAx = p.at(0).ax;
    let lastAy = p.ay;
    for (let i = 1; i <= 2000; i++) {
      p.at(i / 2000);
      expect(p.zoom).toBeLessThan(lastZ);
      expect(p.k).toBeLessThanOrEqual(lastK + 1e-12);
      expect(Math.abs(p.ax - lastAx)).toBeLessThan(6);
      expect(Math.abs(p.ay - lastAy)).toBeLessThan(6);
      lastZ = p.zoom;
      lastK = p.k;
      lastAx = p.ax;
      lastAy = p.ay;
    }
  });

  it('keeps the meadow on the colossus until the shrink and drift windows open', () => {
    const p = setup();
    p.at(p.shrink0 * 0.5);
    expect(p.k).toBeCloseTo(p.scale, 9);
    // The root's point of the snapshot stays under the root.
    expect(p.ax + p.k * p.sx0).toBeCloseTo(p.rootSX, 6);
    expect(p.ay + p.k * p.sy0).toBeCloseTo(p.rootSY, 6);
  });
});
