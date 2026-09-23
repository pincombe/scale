import { describe, expect, it } from 'vitest';
import { HERO_GAP, LANCE_ROW, archerSlot, champRoom, footSlot, heroStandOff, isBearer, lancerSlot, shownCount, squadSize, SPRITE_CAP, ROWS, ROW_SCALE, ROW_Y, type Slot } from './formation';

const slot = (): Slot => ({ x: 0, row: 0, col: 0 });

describe('crowd formation', () => {
  it('gives every footman a stable slot behind the hero, filling columns front to back', () => {
    const a = slot();
    const b = slot();
    for (let i = 0; i < 600; i++) {
      footSlot(i, a);
      footSlot(i, b);
      expect(a).toEqual(b); // deterministic
      expect(a.x).toBeLessThan(-0.4);
      expect(a.row).toBeGreaterThanOrEqual(0);
      expect(a.row).toBeLessThan(3);
    }
    // Later columns stand further back.
    expect(footSlot(30, a).x).toBeLessThan(footSlot(0, b).x);
    expect(footSlot(299, a).x).toBeLessThan(footSlot(150, b).x);
  });

  it('puts archers in the back rows', () => {
    const a = slot();
    for (let i = 0; i < 300; i++) {
      archerSlot(i, a);
      expect(a.row).toBeGreaterThanOrEqual(3);
      expect(a.row).toBeLessThan(ROWS);
      expect(a.x).toBeLessThan(-1);
    }
  });

  it('never stacks two knights of a row on the same spot', () => {
    const s = slot();
    const seen = new Map<number, number[]>();
    for (let i = 0; i < 300; i++) {
      footSlot(i, s);
      const xs = seen.get(s.row) ?? [];
      for (const x of xs) expect(Math.abs(x - s.x)).toBeGreaterThan(0.3);
      xs.push(s.x);
      seen.set(s.row, xs);
    }
  });

  it('makes the first footman a banner bearer and spaces banners every 6-10 knights', () => {
    expect(isBearer(false, 0)).toBe(true);
    let last = 0;
    for (let i = 1; i < 200; i++) {
      if (isBearer(false, i)) {
        expect(i - last).toBeGreaterThanOrEqual(6);
        expect(i - last).toBeLessThanOrEqual(10);
        last = i;
      }
    }
    let n = 0;
    for (let i = 0; i < 90; i++) if (isBearer(true, i)) n++;
    expect(n).toBeGreaterThanOrEqual(9);
  });

  it('switches to squads past the sprite cap', () => {
    expect(squadSize(0, 0)).toBe(1);
    expect(squadSize(240, 60)).toBe(1);
    expect(squadSize(241, 60)).toBe(2);
    for (const [f, a] of [
      [301, 0],
      [1000, 1000],
      [123456, 7890],
      [1e9, 3e8],
      [1e15, 1],
    ] as const) {
      const k = squadSize(f, a);
      expect(k).toBeGreaterThan(1);
      expect(shownCount(f, k) + shownCount(a, k)).toBeLessThanOrEqual(SPRITE_CAP);
    }
    // Sprites shrink monotonically as squads grow.
    expect(shownCount(1000, squadSize(1000, 0))).toBeLessThanOrEqual(SPRITE_CAP);
  });

  it('forms lancers into a squadron behind everyone, with stable slots', () => {
    const a = slot();
    const b = slot();
    let prev = 0;
    for (let i = 0; i < 200; i++) {
      lancerSlot(i, a);
      lancerSlot(i, b);
      expect(a).toEqual(b);
      expect(a.row).toBeGreaterThanOrEqual(LANCE_ROW);
      expect(a.row).toBeLessThan(ROW_Y.length);
      // Behind the first footman columns: the horses never crowd the hero.
      expect(a.x).toBeLessThan(-2);
      if (i % 2 === 0) {
        expect(a.x).toBeLessThan(prev + 0.3);
        prev = a.x;
      }
    }
    // The lancers' rows are the furthest back (highest, smallest).
    expect(ROW_Y[LANCE_ROW]!).toBeLessThan(ROW_Y[ROWS - 1]!);
    expect(ROW_SCALE[LANCE_ROW]!).toBeLessThan(ROW_SCALE[ROWS - 1]!);
  });

  it('counts a horse as two knights toward the sprite cap', () => {
    expect(squadSize(100, 0, SPRITE_CAP, 100)).toBe(1);
    const k = squadSize(200, 50, SPRITE_CAP, 100);
    expect(k).toBeGreaterThan(1);
    expect(shownCount(200, k) + shownCount(50, k) + 2 * shownCount(100, k)).toBeLessThanOrEqual(SPRITE_CAP);
  });

  it('makes room for champions', () => {
    expect(champRoom(0)).toBe(0);
    expect(champRoom(1)).toBeGreaterThan(1);
    expect(champRoom(2)).toBeGreaterThan(champRoom(1));
  });

  it('stands the hero off further from bigger dragons, but not forever', () => {
    expect(heroStandOff(0.5)).toBeGreaterThanOrEqual(HERO_GAP);
    expect(heroStandOff(1.2)).toBeGreaterThan(heroStandOff(0.5));
    expect(heroStandOff(40)).toBe(heroStandOff(3));
    expect(heroStandOff(40)).toBeLessThan(2.5);
  });
});
