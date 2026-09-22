import { describe, expect, it } from 'vitest';
import { ParticleSystem, particleSpec } from './particles';
import type { SpriteAtlas } from './atlas';

// update() and spawning never touch the atlas (only draw does), so a stub is enough.
const atlas = {} as SpriteAtlas;
const spec = particleSpec({ sprite: 0, life: 1, lifeVar: 0, speed: 10, size: 2, sizeEnd: 1, sizeVar: 0 });

describe('ParticleSystem', () => {
  it('spawns, ages and frees particles', () => {
    const ps = new ParticleSystem(64, atlas, 'world');
    ps.burst(spec, 0, 0, 10);
    expect(ps.count).toBe(10);
    ps.update(0.5);
    expect(ps.count).toBe(10);
    ps.update(0.6);
    expect(ps.count).toBe(0);
  });

  it('never grows past capacity: recycles the oldest', () => {
    const ps = new ParticleSystem(32, atlas, 'world');
    const x = ps.x;
    for (let i = 0; i < 100; i++) ps.spawn(spec, i, 0, 0, 0);
    expect(ps.count).toBe(32);
    expect(ps.x).toBe(x); // same backing arrays, no reallocation
    // The survivors are the 32 newest spawns.
    const xs = Array.from(ps.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(68);
    expect(xs[31]).toBe(99);
  });

  it('integrates gravity and drag, and scales bursts', () => {
    const ps = new ParticleSystem(8, atlas, 'world');
    const falling = particleSpec({ sprite: 0, life: 5, lifeVar: 0, gravity: 10, drag: 0, sizeVar: 0 });
    const i = ps.spawn(falling, 0, 0, 0, 0);
    for (let k = 0; k < 100; k++) ps.update(0.01);
    expect(ps.y[i]).toBeGreaterThan(4.5);
    expect(ps.y[i]).toBeLessThan(5.5);
    ps.clear();
    ps.burst(spec, 0, 0, 1, 0, 0.5);
    let j = -1;
    for (let k = 0; k < ps.capacity; k++) if (ps.life[k]! > 0) j = k;
    expect(ps.size0[j]).toBeCloseTo(1, 6);
  });

  it('homing particles reach their target and report arrival exactly once', () => {
    const ps = new ParticleSystem(64, atlas, 'screen');
    const homing = particleSpec({ sprite: 0, life: 3, lifeVar: 0, speed: 500, speedVar: 0, angle: -Math.PI / 2, spread: 1, gravity: 1500 });
    const arrived: number[] = [];
    ps.onArrive = (_s, i) => arrived.push(i);
    for (let k = 0; k < 20; k++) {
      const i = ps.spawn(homing, 400, 400, (k - 10) * 30, -500);
      ps.homeTo(i, 40, 30, 0.4);
    }
    let t = 0;
    while (ps.count > 0 && t < 3) {
      ps.update(1 / 60);
      t += 1 / 60;
    }
    expect(arrived.length).toBe(20);
    expect(new Set(arrived).size).toBe(20);
    expect(t).toBeLessThan(2); // they arrive well before their life runs out
  });
});
