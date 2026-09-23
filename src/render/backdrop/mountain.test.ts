import { describe, expect, it } from 'vitest';
import { hidePitch, hideRowAt, hideRowY, hideScaleAt, hideWidth, HIDE_K, HIDE_S0 } from './hide';
import { CASTLE_X, SPINE_END, SPINE_PLATES, slopesHeight, spineBody, spineHeight } from './mountainRidges';
import {
  createWyrmIdle,
  exhale,
  followPose,
  idlePose,
  resetWyrmIdle,
  stepWyrmIdle,
  WAKE_DURATION,
  WAKE_FIRST,
  WAKE_MAX_GAP,
  WAKE_MIN_GAP,
  WAKE_OPEN,
  type WyrmIdleEvents,
} from './wyrmSchedule';
import type { WyrmPose } from './api';

describe('the hide (the Mountain ground)', () => {
  it('rows form a geometric series whose pitch grows linearly with depth', () => {
    expect(hideRowY(0)).toBe(0);
    for (let n = 0; n < 60; n++) {
      expect(hideRowY(n + 1) - hideRowY(n)).toBeCloseTo(hidePitch(n), 10);
      // pitch(y) = S0 + K y at every row's top
      expect(hidePitch(n)).toBeCloseTo(HIDE_S0 + HIDE_K * hideRowY(n), 10);
    }
  });

  it('finds the row of any depth, including row boundaries and above the ridge line', () => {
    expect(hideRowAt(-3)).toBe(0);
    expect(hideRowAt(0)).toBe(0);
    for (let n = 0; n < 50; n++) {
      expect(hideRowAt(hideRowY(n) + 1e-9)).toBe(n);
      expect(hideRowAt((hideRowY(n) + hideRowY(n + 1)) / 2)).toBe(n);
    }
  });

  it('is foreshortened: wide near the ridge line, rounder toward the viewer (never a sliver)', () => {
    for (let n = 0; n < 80; n++) {
      expect(hideWidth(n)).toBeGreaterThan(0);
      expect(hideWidth(n + 1)).toBeGreaterThan(hideWidth(n));
      expect(hideWidth(n + 1) / hidePitch(n + 1)).toBeLessThanOrEqual(hideWidth(n) / hidePitch(n) + 1e-12);
      expect(hideWidth(n) / hidePitch(n)).toBeGreaterThanOrEqual(1.2 - 1e-12);
    }
    expect(hideWidth(0) / hidePitch(0)).toBeGreaterThan(3);
  });

  it('hideScaleAt returns the drawn scale around a point (the zoom puts the Meadow in it)', () => {
    const r = { x: 0, y: 0, w: 0, h: 0 };
    for (const [x, y] of [
      [0, 0.02],
      [-0.95, 0.01],
      [3.3, 0.4],
      [-12.5, 1.3],
      [1000.25, 7],
    ] as const) {
      hideScaleAt(x, y, r);
      const n = hideRowAt(y);
      expect(r.h).toBeCloseTo(hidePitch(n), 10);
      expect(r.w).toBeGreaterThan(hideWidth(n) * 1.1);
      expect(r.w).toBeLessThan(hideWidth(n) * 1.6);
      // Horizontally it covers the point; its top is near the row's top (rows undulate).
      expect(x).toBeGreaterThanOrEqual(r.x - hideWidth(n) * 0.2);
      expect(x).toBeLessThanOrEqual(r.x + r.w + hideWidth(n) * 0.2);
      expect(Math.abs(r.y - hideRowY(n))).toBeLessThan(r.h * 0.9);
    }
    // Deterministic.
    const a = { ...hideScaleAt(0.3, 0.05, r) };
    expect(hideScaleAt(0.3, 0.05, r)).toEqual(a);
  });

  it('a scale near the feet holds the whole Meadow after a x100-x120 pull-back', () => {
    // The Meadow's view (1440 x 900 at a 145 px/m base framing) shrinks by the knight-height
    // ratio; at the Mountain's base framing it must fit in one scale near the ridge line.
    const baseZoom = (0.29 * 900) / 1.8;
    const r = { x: 0, y: 0, w: 0, h: 0 };
    hideScaleAt(-0.95, 0.12, r);
    for (const ratio of [100, 111, 120]) {
      const meadowW = 1440 / (ratio * baseZoom);
      const meadowH = 900 / (ratio * baseZoom);
      expect(r.w).toBeGreaterThan(meadowW);
      expect(r.h).toBeGreaterThan(meadowH * 0.9);
    }
  });
});

describe('the range is the wyrm spine', () => {
  it('its plates are sorted for painting (far row first) and end at the shoulders', () => {
    let row = 1;
    let lastX = -Infinity;
    for (const p of SPINE_PLATES) {
      if (p.row !== row) {
        expect(p.row).toBeLessThan(row);
        row = p.row;
        lastX = -Infinity;
      }
      expect(p.x).toBeGreaterThanOrEqual(lastX);
      lastX = p.x;
      expect(p.x).toBeLessThan(SPINE_END + 0.01);
      expect(p.h).toBeGreaterThan(0);
      expect(p.wl).toBeGreaterThan(0);
      expect(p.wr).toBeGreaterThan(p.wl);
    }
    expect(SPINE_PLATES.filter((p) => p.row === 0).length).toBeGreaterThan(12);
  });

  it('a regular rhythm of plates: tall near mid-back, small toward the receding tail', () => {
    const near = SPINE_PLATES.filter((p) => p.row === 0 && p.x > -4 && p.x < 0);
    const tail = SPINE_PLATES.filter((p) => p.row === 0 && p.x < -10);
    const avg = (ps: typeof near): number => ps.reduce((a, p) => a + p.h, 0) / ps.length;
    expect(avg(near)).toBeGreaterThan(avg(tail) * 2);
  });

  it('is one continuous silhouette (no steps), always above its body', () => {
    let prev = spineHeight(-16);
    for (let x = -16; x < 16; x += 0.002) {
      const h = spineHeight(x);
      expect(Number.isFinite(h)).toBe(true);
      expect(Math.abs(h - prev)).toBeLessThan(0.03);
      expect(h).toBeGreaterThan(spineBody(x) - 0.15);
      prev = h;
    }
  });

  it('the slopes stay low under the resting head (they must never hide its eye)', () => {
    for (let x = 2.2; x < 4.6; x += 0.01) expect(slopesHeight(x)).toBeLessThan(1.3);
    // The castle sits on a crest in the open, right of the fight.
    expect(slopesHeight(CASTLE_X)).toBeGreaterThan(0.9);
  });
});

describe('the world wyrm, left to itself', () => {
  const ev: WyrmIdleEvents = { exhale: false, eyeOpens: false };
  const pose: WyrmPose = { rise: 0, eye: 0, jaw: 0 };

  it('dozes, breathes on a steady rhythm, and first looks up after WAKE_FIRST s', () => {
    const s = createWyrmIdle();
    let exhales = 0;
    let t = 0;
    for (; t < WAKE_FIRST - 0.1; t += 1 / 60) {
      stepWyrmIdle(s, 1 / 60, 0.5, false, ev);
      if (ev.exhale) exhales++;
      expect(ev.eyeOpens).toBe(false);
      expect(idlePose(s, pose).eye).toBe(0);
    }
    expect(exhales).toBeGreaterThanOrEqual(2);
    let opened = false;
    for (let i = 0; i < 30; i++) {
      stepWyrmIdle(s, 1 / 60, 0.5, false, ev);
      opened ||= ev.eyeOpens;
    }
    expect(opened).toBe(true);
  });

  it('a look lifts the lid to a drowsy half-open, blinks slowly, and sinks shut', () => {
    const s = createWyrmIdle();
    stepWyrmIdle(s, 0.01, 0.5, true, ev);
    expect(ev.eyeOpens).toBe(true);
    let max = 0;
    let prev = 0;
    let dipped = false;
    for (let t = 0; t < WAKE_DURATION + 1; t += 1 / 60) {
      stepWyrmIdle(s, 1 / 60, 0.5, false, ev);
      const e = idlePose(s, pose).eye;
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(WAKE_OPEN + 1e-9);
      expect(Math.abs(e - prev)).toBeLessThan(0.05);
      if (max > 0.5 && e < 0.1 && s.wakeT > 4 && s.wakeT < 7) dipped = true;
      max = Math.max(max, e);
      prev = e;
      expect(pose.rise).toBe(0);
      expect(pose.jaw).toBe(0);
    }
    expect(max).toBeGreaterThan(WAKE_OPEN * 0.95);
    expect(dipped).toBe(true);
    expect(prev).toBe(0);
    expect(s.nextWake - s.t).toBeGreaterThanOrEqual(WAKE_MIN_GAP - 1.1);
    expect(s.nextWake - s.t).toBeLessThanOrEqual(WAKE_MAX_GAP);
  });

  it('the exhale swells quickly and releases slowly', () => {
    expect(exhale(0)).toBe(0);
    expect(exhale(0.12)).toBeCloseTo(1, 5);
    expect(exhale(0.7)).toBe(0);
    expect(exhale(0.3)).toBeGreaterThan(0.3);
  });

  it('follows a driven pose exactly and settles back to rest when released', () => {
    const cur: WyrmPose = { rise: 0, eye: 0, jaw: 0 };
    followPose(cur, { rise: 1, eye: 1, jaw: 1 }, true, 1 / 60);
    expect(cur).toEqual({ rise: 1, eye: 1, jaw: 1 });
    followPose(cur, { rise: 2, eye: -1, jaw: 0.5 }, true, 1 / 60);
    expect(cur).toEqual({ rise: 1, eye: 0, jaw: 0.5 });
    const rest: WyrmPose = { rise: 0, eye: 0, jaw: 0 };
    cur.eye = 1;
    let prev = { ...cur };
    for (let t = 0; t < 12; t += 1 / 60) {
      followPose(cur, rest, false, 1 / 60);
      // Monotonic, no pops: a reared wyrm lowers its head slowly.
      expect(cur.rise).toBeLessThanOrEqual(prev.rise);
      expect(prev.rise - cur.rise).toBeLessThan(0.03);
      prev = { ...cur };
    }
    expect(cur.rise).toBeLessThan(0.01);
    expect(cur.jaw).toBeLessThan(0.01);
    expect(cur.eye).toBeLessThan(0.05);
  });

  it('reset: a released wyrm waits a full gap before its next look', () => {
    const s = createWyrmIdle();
    s.t = 500;
    s.wakeT = 3;
    resetWyrmIdle(s, WAKE_MIN_GAP);
    expect(s.wakeT).toBe(-1);
    expect(s.t).toBe(0);
    expect(s.nextWake).toBe(WAKE_MIN_GAP);
  });
});
