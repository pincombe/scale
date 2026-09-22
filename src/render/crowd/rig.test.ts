import { describe, expect, it } from 'vitest';
import { Joints, Pose, lerpPose, solve } from './rig';
import { ANIM_COUNT, SHEET_KINDS, animDuration, buildAnims, oneShotFrame } from './anims';

describe('knight rig', () => {
  it('puts hands and feet on reachable targets', () => {
    const p = new Pose();
    const j = solve(p, new Joints());
    expect(Math.hypot(j.nHX - p.nHandX, j.nHY - p.nHandY)).toBeLessThan(0.01);
    expect(Math.hypot(j.fHX - p.fHandX, j.fHY - p.fHandY)).toBeLessThan(0.01);
    expect(Math.hypot(j.aFtX - p.aFootX, j.aFtY - p.aFootY)).toBeLessThan(0.01);
    // Knees bend forward (+x), toward the enemy.
    expect(j.aKnX).toBeGreaterThan((j.aHipX + j.aFtX) / 2);
  });

  it('clamps unreachable targets to a straight limb instead of breaking', () => {
    const p = new Pose();
    p.fHandX = 200;
    p.fHandY = -60;
    const j = solve(p, new Joints());
    expect(Number.isFinite(j.fHX)).toBe(true);
    expect(Math.hypot(j.fHX - j.fShX, j.fHY - j.fShY)).toBeLessThan(35.1);
  });

  it('lerps poses field by field', () => {
    const a = new Pose();
    const b = new Pose();
    b.hipX = 10;
    b.weapon = 1;
    const o = lerpPose(new Pose(), a, b, 0.5);
    expect(o.hipX).toBeCloseTo(5);
    expect(o.weapon).toBeCloseTo((a.weapon + 1) / 2);
  });
});

describe('knight animations', () => {
  it('defines every animation for every kind, with finite poses', () => {
    for (const kind of SHEET_KINDS) {
      const defs = buildAnims(kind);
      expect(defs.length).toBe(ANIM_COUNT);
      const j = new Joints();
      for (const d of defs) {
        expect(d.poses.length).toBeGreaterThan(0);
        if (!d.loop) expect(d.durs.length).toBe(d.poses.length);
        for (const p of d.poses) {
          solve(p, j);
          for (const v of Object.values(j)) expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });

  it('steps one-shots by their hold times', () => {
    const d = buildAnims('foot')[3]!;
    expect(oneShotFrame(d, 0)).toBe(0);
    expect(oneShotFrame(d, animDuration(d) + 1)).toBe(d.poses.length - 1);
  });
});
