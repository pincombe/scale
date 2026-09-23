import { describe, expect, it } from 'vitest';
import { PILE_DX, PILE_DY, PileLayout, pileBase } from './pile';

describe('rally pile', () => {
  it('sizes the base as the smallest triangle that holds everyone', () => {
    expect(pileBase(0)).toBe(0);
    expect(pileBase(1)).toBe(1);
    expect(pileBase(3)).toBe(2);
    expect(pileBase(4)).toBe(3);
    expect(pileBase(300)).toBe(24);
    for (let n = 1; n < 500; n++) {
      const b = pileBase(n);
      expect((b * (b + 1)) / 2).toBeGreaterThanOrEqual(n);
      expect(((b - 1) * b) / 2).toBeLessThan(n);
    }
  });

  it('fills bottom-up, middle-out, each spot distinct', () => {
    const p = new PileLayout(700);
    for (const n of [1, 2, 7, 55, 300, 616]) {
      p.build(n);
      expect(p.n).toBe(n);
      const seen = new Set<string>();
      let lastLayer = 0;
      for (let i = 0; i < n; i++) {
        const l = p.layer[i]!;
        expect(l).toBeGreaterThanOrEqual(lastLayer);
        lastLayer = l;
        // Heights rise with the layer; spots stay within the base.
        expect(p.h[i]!).toBeGreaterThanOrEqual(l * PILE_DY - 1e-6);
        expect(p.h[i]!).toBeLessThan(l * PILE_DY + 0.2);
        expect(Math.abs(p.x[i]!)).toBeLessThanOrEqual(p.halfWidth() + 0.1);
        const key = l + ':' + Math.round(p.x[i]! / (PILE_DX / 4));
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      // The first knight of every layer stands near the middle.
      expect(Math.abs(p.x[0]!)).toBeLessThan(PILE_DX);
      // A pyramid: taller than a single layer once there are a few knights.
      if (n >= 10) expect(p.layers).toBeGreaterThan(2);
    }
  });

  it('keeps each layer narrower than the one below', () => {
    const p = new PileLayout(300);
    p.build(300);
    const width = new Array<number>(p.layers).fill(0);
    for (let i = 0; i < p.n; i++) width[p.layer[i]!] = Math.max(width[p.layer[i]!]!, Math.abs(p.x[i]!));
    for (let l = 1; l < p.layers; l++) expect(width[l]!).toBeLessThanOrEqual(width[l - 1]! + 0.1);
    expect(p.topHeight(p.layers)).toBeGreaterThan(p.topHeight(1));
  });

  it('clamps to its capacity', () => {
    const p = new PileLayout(10);
    p.build(50);
    expect(p.n).toBe(10);
  });
});
