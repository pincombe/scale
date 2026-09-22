// Dragon particle effects on the shared world pool: fire breath, smoke, nostril puffs, embers and
// ash from the dissolving corpse, dust from landings, slams and big footsteps.
// Specs are built once per palette; emitters allocate nothing.
import type { ParticleSpec, ParticleSystem } from '../particles';
import { CURVE_FADE, CURVE_FLASH, CURVE_LINEAR, CURVE_PULSE, particleSpec } from '../particles';
import type { SpriteAtlas, BuiltinSprites } from '../atlas';
import type { Palette } from '../palette';
import { mixHex } from '../../lib/color';

export interface DragonFx {
  streak: ParticleSpec;
  clod: ParticleSpec;
  fire: ParticleSpec;
  fireCore: ParticleSpec;
  fireEmber: ParticleSpec;
  smoke: ParticleSpec;
  puff: ParticleSpec;
  puffDark: ParticleSpec;
  ember: ParticleSpec;
  ash: ParticleSpec;
  dust: ParticleSpec;
  spark: ParticleSpec;
  star: ParticleSpec;
}

export function buildDragonFx(atlas: SpriteAtlas, sprites: BuiltinSprites, p: Palette, starSprite: number): DragonFx {
  // The flame body uses the irregular smoke puff so tongues of fire look organic, not beady.
  const fireRamp = atlas.ramp(sprites.smoke, ['#ffe6a6', '#ffab45', p.accent.fire, p.accent.ember, '#8a2208', '#2a0b04'], 10, 0.25);
  const coreRamp = atlas.ramp(sprites.glow, ['#ffffff', '#ffe9a8', '#ffb347', p.accent.fire], 6, 0.6);
  const emberRamp = atlas.ramp(sprites.ember, ['#ffffff', '#ffe07a', p.accent.fire, p.accent.ember, '#6a1a08'], 6, 0.6);
  const dustColor = mixHex(p.haze, p.ground, 0.45);
  return {
    // A bright gust racing along the ground with the swipe's shockwave.
    streak: particleSpec({
      sprite: atlas.tint(sprites.spark, '#fff1c4', 0.6),
      additive: true,
      align: true,
      life: 0.28,
      lifeVar: 0.3,
      speed: 7,
      speedVar: 0.3,
      angle: Math.PI,
      spread: 0.12,
      drag: 3,
      size: 1.6,
      sizeEnd: 0.5,
      sizeVar: 0.3,
      alpha: 0.7,
      curve: CURVE_FADE,
    }),
    // Clods of earth and grass thrown up by the slam.
    clod: particleSpec({
      sprite: atlas.tint(sprites.dust, p.silhouette),
      life: 0.8,
      lifeVar: 0.3,
      speed: 4,
      speedVar: 0.5,
      angle: -Math.PI / 2 - 0.35,
      spread: 0.55,
      gravity: 16,
      drag: 0.6,
      ground: true,
      size: 0.22,
      sizeEnd: 0.18,
      sizeVar: 0.5,
      alpha: 0.9,
      curve: CURVE_FADE,
      spinVar: 8,
    }),
    // Sizes/speeds are per unit of "scale" (stream width in m); emitters multiply.
    fire: particleSpec({
      sprite: fireRamp,
      ramp: 10,
      additive: true,
      ground: true,
      life: 0.7,
      lifeVar: 0.3,
      drag: 2.8,
      gravity: -3.2,
      size: 1,
      sizeEnd: 3.6,
      sizeVar: 0.5,
      alpha: 0.42,
      curve: CURVE_LINEAR,
      rotVar: Math.PI,
      spinVar: 3,
    }),
    fireCore: particleSpec({
      sprite: coreRamp,
      ramp: 6,
      additive: true,
      life: 0.3,
      lifeVar: 0.25,
      drag: 3,
      gravity: -1,
      size: 0.35,
      sizeEnd: 0.9,
      sizeVar: 0.3,
      alpha: 0.55,
      curve: CURVE_FADE,
    }),
    fireEmber: particleSpec({
      sprite: emberRamp,
      ramp: 6,
      additive: true,
      life: 0.9,
      lifeVar: 0.45,
      drag: 1.6,
      gravity: -1.6,
      size: 0.09,
      sizeEnd: 0.03,
      sizeVar: 0.4,
      alpha: 1,
      curve: CURVE_PULSE,
    }),
    smoke: particleSpec({
      sprite: atlas.tint(sprites.smoke, '#2e2320'),
      life: 1.5,
      lifeVar: 0.35,
      drag: 1.6,
      gravity: -1.1,
      size: 0.9,
      sizeEnd: 3.2,
      sizeVar: 0.3,
      alpha: 0.42,
      curve: CURVE_PULSE,
      rotVar: Math.PI,
      spinVar: 0.8,
    }),
    puff: particleSpec({
      sprite: atlas.tint(sprites.smoke, '#6f625c'),
      life: 1.1,
      lifeVar: 0.3,
      speed: 0.8,
      speedVar: 0.4,
      angle: -Math.PI / 2 - 0.5,
      spread: 0.4,
      drag: 2.2,
      gravity: -0.5,
      size: 0.35,
      sizeEnd: 1.3,
      sizeVar: 0.3,
      alpha: 0.32,
      curve: CURVE_PULSE,
      rotVar: Math.PI,
      spinVar: 1,
    }),
    puffDark: particleSpec({
      sprite: atlas.tint(sprites.smoke, '#241a17'),
      life: 1.3,
      lifeVar: 0.3,
      speed: 1,
      speedVar: 0.4,
      angle: -Math.PI / 2 - 0.4,
      spread: 0.45,
      drag: 2,
      gravity: -0.7,
      size: 0.45,
      sizeEnd: 1.8,
      sizeVar: 0.3,
      alpha: 0.5,
      curve: CURVE_PULSE,
      rotVar: Math.PI,
      spinVar: 1,
    }),
    ember: particleSpec({
      sprite: emberRamp,
      ramp: 6,
      additive: true,
      life: 1.5,
      lifeVar: 0.5,
      speed: 1,
      speedVar: 0.6,
      angle: -Math.PI / 2,
      spread: 0.9,
      drag: 1.1,
      gravity: -1.2,
      radius: 0.2,
      size: 0.12,
      sizeEnd: 0.03,
      sizeVar: 0.5,
      curve: CURVE_FLASH,
    }),
    ash: particleSpec({
      sprite: atlas.tint(sprites.dust, '#2a211e'),
      life: 2,
      lifeVar: 0.4,
      speed: 0.7,
      speedVar: 0.6,
      angle: -Math.PI / 2 + 0.25,
      spread: 0.8,
      drag: 1.2,
      gravity: -0.45,
      radius: 0.2,
      size: 0.16,
      sizeEnd: 0.08,
      sizeVar: 0.5,
      alpha: 0.75,
      curve: CURVE_FADE,
      rotVar: Math.PI,
      spinVar: 4,
    }),
    dust: particleSpec({
      sprite: atlas.tint(sprites.dust, dustColor),
      ground: true,
      life: 0.9,
      lifeVar: 0.35,
      speed: 2.2,
      speedVar: 0.5,
      angle: -Math.PI / 2,
      spread: 1.35,
      drag: 3.5,
      gravity: 0.6,
      size: 0.5,
      sizeEnd: 1.6,
      sizeVar: 0.4,
      alpha: 0.45,
      curve: CURVE_FADE,
      rotVar: Math.PI,
      spinVar: 1,
    }),
    spark: particleSpec({
      sprite: atlas.tint(sprites.spark, '#8ff0ff', 0.7),
      additive: true,
      align: true,
      life: 0.4,
      lifeVar: 0.4,
      speed: 3,
      speedVar: 0.5,
      spread: Math.PI,
      drag: 4,
      gravity: 1,
      size: 0.45,
      sizeEnd: 0.12,
      curve: CURVE_FADE,
    }),
    star: particleSpec({
      sprite: starSprite,
      additive: true,
      life: 0.7,
      lifeVar: 0.3,
      speed: 1.6,
      speedVar: 0.5,
      angle: -Math.PI / 2,
      spread: 1.2,
      drag: 3,
      gravity: 1.5,
      size: 0.35,
      sizeEnd: 0.1,
      curve: CURVE_FADE,
      spinVar: 6,
    }),
  };
}

/**
 * One frame of fire: particles from the mouth toward the aim point. `width` (m) sets the stream
 * thickness; the speed is chosen so the flame reaches `reach` meters before drag stops it.
 */
export function emitFire(
  ps: ParticleSystem,
  fx: DragonFx,
  mx: number,
  my: number,
  ax: number,
  ay: number,
  count: number,
  width: number,
  intensity: number,
  dt: number,
): void {
  const dx = ax - mx;
  const dy = ay - my;
  const reach = Math.sqrt(dx * dx + dy * dy) * 1.12 + width;
  const base = Math.atan2(dy, dx);
  const spec = fx.fire;
  const life = spec.life;
  const v0 = (reach * spec.drag) / (1 - Math.exp(-spec.drag * life));
  for (let n = 0; n < count; n++) {
    const a = base + (ps.rand() - 0.5) * 0.36;
    const sp = v0 * (0.72 + 0.4 * ps.rand());
    const j = width * 0.2;
    // Lateral turbulence so the stream billows.
    const turb = (ps.rand() - 0.5) * v0 * 0.12;
    const vx = Math.cos(a) * sp - Math.sin(a) * turb;
    const vy = Math.sin(a) * sp + Math.cos(a) * turb;
    // Spread births along this frame's travel so the stream is continuous, not a string of beads.
    const f = ps.rand() * dt;
    const i = ps.spawn(spec, mx + vx * f + (ps.rand() - 0.5) * j, my + vy * f + (ps.rand() - 0.5) * j, vx, vy);
    ps.age[i] = f;
    ps.size0[i] *= width;
    ps.size1[i] *= width;
    ps.grav[i] *= width;
    ps.alpha[i] *= intensity;
  }
  // A hot white core near the mouth.
  const cn = count > 2 ? Math.floor(count / 3) : count > 0 && ps.rand() < 0.4 ? 1 : 0;
  const core = fx.fireCore;
  const cv = (reach * 0.55 * core.drag) / (1 - Math.exp(-core.drag * core.life));
  for (let n = 0; n < cn; n++) {
    const a = base + (ps.rand() - 0.5) * 0.12;
    const sp = cv * (0.85 + 0.3 * ps.rand());
    const vx = Math.cos(a) * sp;
    const vy = Math.sin(a) * sp;
    const f = ps.rand() * dt;
    const i = ps.spawn(core, mx + vx * f, my + vy * f, vx, vy);
    ps.age[i] = f;
    ps.size0[i] *= width;
    ps.size1[i] *= width;
    ps.grav[i] *= width;
    ps.alpha[i] *= intensity;
  }
  // Embers spitting off the stream.
  if (ps.rand() < 0.5 * intensity) {
    const e = fx.fireEmber;
    const a = base + (ps.rand() - 0.5) * 0.7;
    const sp = v0 * (0.3 + 0.5 * ps.rand());
    const i = ps.spawn(e, mx, my, Math.cos(a) * sp, Math.sin(a) * sp - v0 * 0.1);
    ps.size0[i] *= width;
    ps.size1[i] *= width;
    ps.grav[i] *= width;
  }
}
