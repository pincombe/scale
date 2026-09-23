import { describe, expect, it } from 'vitest';
import { Camera } from '../camera';
import { ZOOM_BEATS, pullEase, pullSpeed, span, zoomDoneAt, zoomSwitchAt, zoomTimeline } from './timeline';
import { BOOTS_FILL, BOOTS_X0, BOOTS_X1, CameraPath, HERO_UNIT, HERO_Y, MeadowMorph, Stroke, computeFlashFraming, flashFraming } from './geometry';
import { LIFT, MeadowPlate } from './plate';
import { hideScaleShape, scaleShape, traceScale } from '../backdrop/hide';

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
      expect(tl.fuse).toBeGreaterThan(tl.beats.fusion);
      expect(tl.fuse).toBeLessThan(tl.flash);
      // The boots, the closing stroke, the hold, the landscape stroke.
      expect(tl.pullStart).toBeGreaterThan(tl.flash + 0.5);
      expect(tl.beats.pullback).toBe(tl.pullStart);
      expect(tl.holdStart).toBeGreaterThan(tl.pullStart);
      expect(tl.holdEnd - tl.holdStart).toBeGreaterThanOrEqual(0.8);
      expect(tl.holdEnd - tl.holdStart).toBeLessThanOrEqual(1.2);
      expect(tl.pullEnd).toBeGreaterThan(tl.holdEnd);
      expect(tl.beats.reveal).toBeLessThan(tl.pullEnd);
      expect(tl.beats.reveal).toBeGreaterThan(tl.holdEnd);
      expect(tl.handoff0).toBeLessThan(tl.beats.done);
      expect(tl.handoff1).toBeGreaterThan(tl.beats.done);
      expect(tl.end).toBeGreaterThan(tl.handoff1);
    }
  });

  it('keeps the whole cinematic near ten seconds, slower with reduce motion', () => {
    const a = zoomTimeline(false);
    const b = zoomTimeline(true);
    expect(a.beats.done).toBeGreaterThan(9.5);
    expect(a.beats.done).toBeLessThan(11);
    expect(b.flash).toBe(a.flash);
    expect(b.pullEnd - b.pullStart).toBeGreaterThan(a.pullEnd - a.pullStart);
    expect(b.beats.done).toBeGreaterThan(a.beats.done);
    expect(zoomSwitchAt()).toBe(a.flash);
    expect(zoomDoneAt()).toBe(a.beats.done);
    expect(zoomDoneAt(true)).toBe(b.beats.done);
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
    expect(f.rootSX + ((BOOTS_X0 + BOOTS_X1) / 2) * unit * f.zoom).toBeCloseTo(W / 2, 6);
  });

  it('never frames closer than the base framing, nor wider than the backdrop holds', () => {
    const tiny = computeFlashFraming(W, H, W / 2, H / 2, 0, 1, 0.76, base, flashFraming());
    expect(tiny.zoom).toBeLessThanOrEqual(base + 1e-9);
    const huge = computeFlashFraming(W, H, W / 2, H / 2, 0, 1e6, 0.76, base, flashFraming());
    expect(huge.zoom).toBeGreaterThanOrEqual(base / 12 - 1e-9);
  });
});

describe('CameraPath', () => {
  const tl = zoomTimeline(false);
  const setup = (): CameraPath => {
    const p = new CameraPath();
    p.pullStart = tl.pullStart;
    p.holdStart = tl.holdStart;
    p.holdEnd = tl.holdEnd;
    p.pullEnd = tl.pullEnd;
    p.rootX = -2.03;
    p.rootY = HERO_Y;
    p.stageCX = 720;
    p.stageCY = 450;
    p.z0 = 2046;
    p.sx0 = 563;
    p.sy0 = 686;
    p.zh = 780;
    p.sxh = 690;
    p.syh = 480;
    p.zh2 = 780 / 1.07;
    p.fhx = 778;
    p.fhy = 675;
    p.ze = 145;
    p.sxe = 268;
    p.sye = 701;
    return p;
  };

  it('rests on the boots, lands the hold exactly, then the in-tier framing', () => {
    const p = setup();
    p.at(tl.flash + 0.1);
    expect(p.stage).toBe(Stroke.Boots);
    expect(p.zoom).toBe(2046);
    expect(p.rootSX).toBe(563);
    expect(p.rootSY).toBe(686);
    p.at(tl.holdStart - 1e-9);
    expect(p.zoom).toBeCloseTo(780, 3);
    expect(p.rootSX).toBeCloseTo(690, 3);
    expect(p.rootSY).toBeCloseTo(480, 3);
    p.at(tl.holdEnd - 1e-9);
    expect(p.zoom).toBeCloseTo(780 / 1.07, 3);
    p.at(tl.pullEnd + 0.5);
    expect(p.stage).toBe(Stroke.Landed);
    expect(p.zoom).toBe(145);
    expect(p.rootSX).toBe(268);
    expect(p.rootSY).toBe(701);
  });

  it('holds the scale still on screen while it drifts (the drift scales about it)', () => {
    const p = setup();
    // The world point under the hold's fixed point stays under it.
    p.at(tl.holdStart);
    const wx = p.camX + (p.fhx - p.stageCX) / p.zoom;
    const wy = p.camY + (p.fhy - p.stageCY) / p.zoom;
    const q = { x: 0, y: 0 };
    for (let i = 0; i <= 10; i++) {
      p.at(tl.holdStart + ((tl.holdEnd - tl.holdStart) * i) / 10 - 1e-9);
      p.toScreen(wx, wy, q);
      expect(q.x).toBeCloseTo(p.fhx, 6);
      expect(q.y).toBeCloseTo(p.fhy, 6);
    }
  });

  it('is one smooth pull-back: monotonic, continuous, at rest where the strokes meet', () => {
    const p = setup();
    let lastZ = Infinity;
    let lastX = p.at(tl.flash).rootSX;
    let lastY = p.rootSY;
    const steps = 4000;
    for (let i = 1; i <= steps; i++) {
      const t = tl.flash + ((tl.pullEnd + 0.2 - tl.flash) * i) / steps;
      p.at(t);
      expect(p.zoom).toBeLessThanOrEqual(lastZ + 1e-9);
      expect(Math.abs(p.rootSX - lastX)).toBeLessThan(3);
      expect(Math.abs(p.rootSY - lastY)).toBeLessThan(3);
      expect(p.speed).toBeLessThanOrEqual(1e-12);
      lastZ = p.zoom;
      lastX = p.rootSX;
      lastY = p.rootSY;
    }
    for (const t of [tl.pullStart, tl.holdStart, tl.holdEnd, tl.pullEnd]) {
      expect(Math.abs(p.at(t + 1e-4).speed)).toBeLessThan(0.01);
      expect(Math.abs(p.at(t - 1e-4).speed)).toBeLessThan(0.01);
    }
  });

  it('writes a camera that puts the root where it says', () => {
    const p = setup();
    const cam = new Camera();
    cam.setViewport(1440, 900);
    const q = { x: 0, y: 0 };
    for (let i = 0; i <= 40; i++) {
      p.at(tl.flash + ((tl.pullEnd - tl.flash) * i) / 40);
      cam.x = p.camX;
      cam.y = p.camY;
      cam.zoom = p.zoom;
      cam.derive();
      cam.worldToScreen(p.rootX, p.rootY, q);
      expect(q.x).toBeCloseTo(p.rootSX, 5);
      expect(q.y).toBeCloseTo(p.rootSY, 5);
    }
  });
});

describe('MeadowMorph', () => {
  const setup = (): MeadowMorph => {
    const m = new MeadowMorph();
    m.rootX = -2.03;
    m.rootY = HERO_Y;
    // The screen at the switch (1.6 : 1) around the root, and a scale's picture rect ahead of the toes.
    m.w0 = 0.72;
    m.h0 = 0.45;
    m.x0 = m.rootX - 0.28;
    m.y0 = m.rootY - 0.34;
    m.x1 = -2.1;
    m.y1 = 0.3;
    m.w1 = 0.37;
    return m;
  };

  it('starts as the screen with the colossus standing in it, ends as its scale', () => {
    const m = setup().at(0);
    expect(m.x).toBeCloseTo(m.x0, 9);
    expect(m.y).toBeCloseTo(m.y0, 9);
    expect(m.w).toBeCloseTo(m.w0, 9);
    expect(m.h).toBeCloseTo(m.h0, 9);
    expect(m.frame).toBe(0);
    m.at(1);
    expect(m.x).toBeCloseTo(m.x1, 9);
    expect(m.y).toBeCloseTo(m.y1, 9);
    expect(m.w).toBeCloseTo(m.w1, 9);
    expect(m.h / m.w).toBeCloseTo(m.h0 / m.w0, 9);
    expect(m.frame).toBe(1);
  });

  it('only shrinks, and its frame only closes', () => {
    const m = setup();
    let w = Infinity;
    let f = -1;
    for (let i = 0; i <= 500; i++) {
      m.at(i / 500);
      expect(m.w).toBeLessThanOrEqual(w + 1e-12);
      expect(m.frame).toBeGreaterThanOrEqual(f - 1e-12);
      w = m.w;
      f = m.frame;
    }
  });
});

/** A 2D context stand-in that records path points (moveTo / lineTo / curve ends and controls). */
function recorder(): { ctx: CanvasRenderingContext2D; pts: number[] } {
  const pts: number[] = [];
  const ctx = {
    moveTo: (x: number, y: number) => pts.push(x, y),
    lineTo: (x: number, y: number) => pts.push(x, y),
    bezierCurveTo: (a: number, b: number, c: number, d: number, x: number, y: number) => pts.push(a, b, c, d, x, y),
    closePath: () => undefined,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, pts };
}

describe('MeadowPlate', () => {
  it('picks a real scale of the hide just ahead of the toes, the picture filling its face', () => {
    const pl = new MeadowPlate();
    const rootX = -2.03;
    pl.choose(rootX, HERO_Y, 900 / 1440);
    const s = pl.s;
    expect(s.top - LIFT * s.pitch).toBeGreaterThanOrEqual(HERO_Y + 0.03);
    expect(s.top).toBeLessThan(HERO_Y + 0.35);
    expect(s.cx).toBeGreaterThan(rootX - 0.2);
    expect(s.cx).toBeLessThan(rootX + 0.5);
    // It is the hide's own scale there.
    const again = hideScaleShape(s.cx, s.rowY + s.pitch * 0.5, scaleShape());
    expect(again.n).toBe(s.n);
    expect(again.i).toBe(s.i);
    // The picture spans the plate, from its raised crown down past the next row's crowns (the face
    // that shows), at the snapshot's aspect.
    expect(pl.x).toBeLessThanOrEqual(s.cx - s.sx + 1e-9);
    expect(pl.x + pl.w).toBeGreaterThanOrEqual(s.cx + s.sx - 1e-9);
    expect(pl.y).toBeLessThanOrEqual(s.top - LIFT * s.pitch + 1e-9);
    expect(pl.y + pl.h).toBeGreaterThanOrEqual(s.rowY + s.pitch * 1.3);
    expect(pl.h / pl.w).toBeCloseTo(900 / 1440, 9);
  });

  it("frames the picture: its own rectangle at 0, the whole scale at 1 (the hide's own crown)", () => {
    const pl = new MeadowPlate();
    pl.choose(-2.03, HERO_Y, 900 / 1440);
    const r = recorder();
    pl.traceFrame(r.ctx, 1, 2, 4, 2.5, 0);
    // Every point of the rectangle's path lies on its edges.
    for (let i = 0; i < r.pts.length; i += 2) {
      const x = r.pts[i]!;
      const y = r.pts[i + 1]!;
      const onEdge = Math.abs(x - 1) < 1e-9 || Math.abs(x - 5) < 1e-9 || Math.abs(y - 2) < 1e-9 || Math.abs(y - 4.5) < 1e-9;
      expect(onEdge).toBe(true);
    }
    const a = recorder();
    pl.traceWhole(a.ctx);
    const b = recorder();
    traceScale(b.ctx, pl.s, 0, 0, LIFT);
    // The crown (the move and its two arcs) is the pattern's own, raised as the backdrop keeps it.
    for (let i = 0; i < 14; i++) expect(a.pts[i]).toBeCloseTo(b.pts[i]!, 9);
    // It stays within the picture's width, and its root reaches below the pattern's plate.
    for (let i = 0; i < a.pts.length; i += 2) {
      expect(a.pts[i]!).toBeGreaterThanOrEqual(pl.x - 1e-9);
      expect(a.pts[i]!).toBeLessThanOrEqual(pl.x + pl.w + 1e-9);
      expect(a.pts[i + 1]!).toBeGreaterThanOrEqual(pl.y - 1e-9);
    }
    expect(pl.rootY).toBeGreaterThan(pl.s.bottom - 1e-9);
  });
});
