import { describe, expect, it } from 'vitest';
import { LOD_SCALE, lodFor, lodSticky } from './sheets';

describe('sprite LOD choice', () => {
  it('takes a finer LOD at once but a coarser one only past a margin', () => {
    // Just past the LOD 0/1 boundary: plain lodFor flips, the sticky choice stays on LOD 0.
    const edge = LOD_SCALE[1]! / 0.92;
    expect(lodFor(edge * 0.99)).toBe(1);
    expect(lodSticky(edge * 0.99, 0)).toBe(0);
    // Well past it, it moves on.
    expect(lodSticky(edge * 0.8, 0)).toBe(1);
    // Needing more detail switches immediately.
    expect(lodSticky(edge * 1.01, 1)).toBe(0);
    // No flip-flop through a small oscillation at the boundary.
    let lod = 0;
    for (let i = 0; i < 50; i++) lod = lodSticky(edge * (1 + 0.04 * Math.sin(i)), lod);
    expect(lod).toBe(0);
  });
});
