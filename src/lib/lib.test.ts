import { describe, expect, it } from 'vitest';
import { AlphaRamp, ColorRamp, mixHex, parseHex, rgba } from './color';
import { clamp, damp, invLerp, smoothDamp, smoothstep, wrap, angleDelta } from './math';
import { Noise } from './noise';
import { Rng, hashString, nextFloat, nextU32, seedRng } from './rng';
import { rect, rectUnion, rectInclude, rectContains } from './vec';

describe('rng', () => {
  it('is deterministic per seed and diverges across seeds', () => {
    const a = seedRng(1234);
    const b = seedRng(1234);
    const c = seedRng(1235);
    const sa = Array.from({ length: 50 }, () => nextU32(a));
    const sb = Array.from({ length: 50 }, () => nextU32(b));
    const sc = Array.from({ length: 50 }, () => nextU32(c));
    expect(sb).toEqual(sa);
    expect(sc).not.toEqual(sa);
    expect(sa.every((v) => Number.isInteger(v) && v >= 0 && v < 2 ** 32)).toBe(true);
  });

  it('produces floats in [0, 1) with a sane mean', () => {
    const s = seedRng(7);
    let sum = 0;
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 20000; i++) {
      const f = nextFloat(s);
      sum += f;
      lo = Math.min(lo, f);
      hi = Math.max(hi, f);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(1);
    expect(sum / 20000).toBeCloseTo(0.5, 1);
  });

  it('state is JSON-safe and resumes exactly', () => {
    const s = seedRng(99);
    nextU32(s);
    const copy = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(nextU32(copy)).toBe(nextU32(s));
  });

  it('Rng wrapper matches and reseeds', () => {
    const r = new Rng(5);
    const first = r.float();
    r.reseed(5);
    expect(r.float()).toBe(first);
    expect(r.int(10)).toBeLessThan(10);
    expect(hashString('newt')).toBe(hashString('newt'));
    expect(hashString('newt')).not.toBe(hashString('wyrm'));
  });
});

describe('noise', () => {
  it('is deterministic, bounded and continuous', () => {
    const n = new Noise(3);
    const m = new Noise(3);
    let maxJump = 0;
    let prev = n.n1(0);
    for (let i = 1; i < 2000; i++) {
      const x = i * 0.01;
      const v = n.n1(x);
      expect(v).toBe(m.n1(x));
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      maxJump = Math.max(maxJump, Math.abs(v - prev));
      prev = v;
      const s = n.simplex2(x, x * 0.7);
      expect(Math.abs(s)).toBeLessThanOrEqual(1.0001);
      const vn = n.value2(x * 3, -x);
      expect(Math.abs(vn)).toBeLessThanOrEqual(1);
    }
    expect(maxJump).toBeLessThan(0.1);
    expect(new Noise(4).n1(0.5)).not.toBe(n.n1(0.5));
  });
});

describe('math', () => {
  it('basic helpers', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(invLerp(2, 4, 3)).toBe(0.5);
    expect(invLerp(2, 2, 3)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(wrap(-1, 0, 10)).toBe(9);
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
  });

  it('damp is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 10, 4, 1 / 60);
    const b = damp(0, 10, 4, 1);
    expect(a).toBeCloseTo(b, 6);
  });

  it('smoothDamp converges without overshoot and survives retargeting', () => {
    const spring = { v: 0 };
    let x = 0;
    let max = 0;
    for (let i = 0; i < 240; i++) {
      x = smoothDamp(x, 10, spring, 0.5, 1 / 60);
      max = Math.max(max, x);
    }
    expect(max).toBeLessThanOrEqual(10);
    expect(x).toBeCloseTo(10, 2);
    const before = spring.v;
    x = smoothDamp(x, -10, spring, 0.5, 1 / 60);
    expect(Number.isFinite(x)).toBe(true);
    expect(spring.v).toBeLessThan(before + 1e-9);
  });
});

describe('color', () => {
  it('parses and mixes hex', () => {
    expect(parseHex('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('nope')).toEqual({ r: 0, g: 0, b: 0 });
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('caches rgba strings (same instance on repeat)', () => {
    const r = new AlphaRamp('#ff0000');
    expect(r.at(0.5)).toBe('rgba(255,0,0,0.5)');
    expect(r.at(0.5)).toBe(r.at(0.501));
    expect(rgba('#00ff00', 1)).toBe('rgba(0,255,0,1)');
    const ramp = new ColorRamp(['#000000', '#ffffff']);
    expect(ramp.at(0)).toBe('#000000');
    expect(ramp.at(1)).toBe('#ffffff');
  });
});

describe('vec', () => {
  it('rect helpers', () => {
    const a = rect(0, 0, 1, 1);
    const b = rect(2, -1, 1, 1);
    const u = rectUnion(rect(), a, b);
    expect(u).toEqual({ x: 0, y: -1, w: 3, h: 2 });
    rectInclude(u, 5, 5);
    expect(u).toEqual({ x: 0, y: -1, w: 5, h: 6 });
    expect(rectContains(u, 4, 4)).toBe(true);
    expect(rectContains(u, 6, 4)).toBe(false);
  });
});
