import { describe, expect, it } from 'vitest';
import { Champion, type ChampInput } from './champion';

/** Run a champion at 60 fps from t0 to t1 with a per-frame input; returns the impact times. */
function run(c: Champion, t0: number, t1: number, input: (t: number) => ChampInput, hits: number[]): number {
  const dt = 1 / 60;
  let t = t0;
  while (t < t1) {
    t += dt;
    c.update(dt, t, dt, input(t));
  }
  return t;
}

function setup(id: 'aldric' | 'brunhild'): { c: Champion; hits: number[] } {
  const c = new Champion(id);
  const hits: number[] = [];
  c.join(true, -6, -2);
  c.onImpact = () => hits.push(-1);
  return { c, hits };
}

const idle = (specialIn: number): ChampInput => ({ homeX: -2, frontX: 0.5, specialIn, surge: 0 });

describe('champion specials', () => {
  it('lands a special fired without a telegraph (core timer already reset) at once, and recovers', () => {
    for (const id of ['aldric', 'brunhild'] as const) {
      const { c, hits } = setup(id);
      let now = run(c, 0, 1, () => idle(-1), hits);
      // The dragon became hittable and core fired immediately: its timer is now a full period.
      c.special(now, null);
      now = run(c, now, now + 0.4, () => idle(8.9), hits);
      expect(hits.length).toBe(1);
      // Back home and able to strike on the beat within the move's length (no 9 s freeze).
      now = run(c, now, now + 1.5, () => idle(7.5), hits);
      const x0 = c.rootX();
      expect(Math.abs(x0 - -2)).toBeLessThan(0.05);
      expect(hits.length).toBe(1);
    }
  });

  it('never teleports: the root moves less than 0.5 m per frame through a quick special', () => {
    const { c, hits } = setup('aldric');
    let now = run(c, 0, 1, () => idle(-1), hits);
    c.special(now, null);
    let last = c.rootX();
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      now += dt;
      c.update(dt, now, dt, idle(8.9));
      expect(Math.abs(c.rootX() - last)).toBeLessThan(0.5);
      last = c.rootX();
    }
  });

  it('times a telegraphed special to core and fires its impact with the event', () => {
    const { c, hits } = setup('brunhild');
    let now = run(c, 0, 1, () => idle(3), hits);
    const due = now + 0.6;
    now = run(c, now, due - 0.01, (t) => idle(Math.max(0, due - t)), hits);
    expect(hits.length).toBe(0);
    c.special(due, null);
    now = run(c, now, due + 0.2, () => idle(8), hits);
    expect(hits.length).toBe(1);
  });

  it('stands down if the dragon stops being hittable during the wind-up', () => {
    const { c, hits } = setup('aldric');
    let now = run(c, 0, 1, () => idle(3), hits);
    const due = now + 0.4;
    // The wind-up starts, then the dragon dies: no special can come now.
    now = run(c, now, now + 0.05, (t) => idle(Math.max(0, due - t)), hits);
    now = run(c, now, now + 1.2, () => idle(-1), hits);
    expect(hits.length).toBe(0);
    expect(Math.abs(c.rootX() - -2)).toBeLessThan(0.05);
  });
});
