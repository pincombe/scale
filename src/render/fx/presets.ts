// Particle presets (built once per palette; see the table at the top of fx/index.ts).
// All sizes/speeds are authored in screen px: world bursts pass scale = 1 / camera.zoomEff.
import type { BuiltinSprites, SpriteAtlas } from '../atlas';
import type { Palette } from '../palette';
import { CURVE_FADE, CURVE_FLASH, CURVE_HOLD, CURVE_LINEAR, CURVE_PULSE, particleSpec, type ParticleSpec } from '../particles';
import { COIN_FRAMES, fxSprites } from './sprites';

export interface Presets {
  /** Click impact sparks: white -> gold -> fire streaks, fountain up. */
  spark: ParticleSpec;
  /** Crit sparks: bigger, faster, white-gold. */
  sparkBig: ParticleSpec;
  /** Dim little sparks for army blows. */
  sparkSmall: ParticleSpec;
  /** Brief additive bloom at an impact. */
  flare: ParticleSpec;
  /** Big bloom (crit, kill). */
  flareBig: ParticleSpec;
  /** Warm amber bloom for kills, scaled by the kill's magnitude (never a white disc). */
  bloom: ParticleSpec;
  /** 4-point glint. */
  glint: ParticleSpec;
  /** Crescent slash streak (set rot per spawn). */
  slash: ParticleSpec;
  /** Expanding shockwave ring. */
  ring: ParticleSpec;
  /** Rising fire embers. */
  ember: ParticleSpec;
  /** Low ground dust puff (skids along the ground). */
  dust: ParticleSpec;
  /** Dark rising smoke. */
  smoke: ParticleSpec;
  /** Gold motes that float up (milestones, upgrades). */
  shimmer: ParticleSpec;
  /** Soft vertical light shaft (spawn with rot -PI/2). */
  beam: ParticleSpec;
  /** Screen-space spinning coin (the fountain). */
  coin: ParticleSpec;
  /** Screen-space glint where coins land on the HUD. */
  coinGlint: ParticleSpec;
}

export function buildPresets(atlas: SpriteAtlas, sprites: BuiltinSprites, p: Palette): Presets {
  const fx = fxSprites(atlas);
  const { gold, fire, ember, glow } = p.accent;
  return {
    spark: particleSpec({
      sprite: atlas.ramp(sprites.spark, ['#fff3d2', gold, gold, fire], 5, 0.45),
      ramp: 5,
      additive: true,
      align: true,
      life: 0.32,
      lifeVar: 0.45,
      speed: 820,
      speedVar: 0.55,
      angle: -Math.PI / 2,
      spread: 1.65,
      drag: 5,
      gravity: 1900,
      size: 30,
      sizeEnd: 8,
      sizeVar: 0.3,
      curve: CURVE_FADE,
    }),
    sparkBig: particleSpec({
      sprite: atlas.ramp(sprites.spark, ['#ffffff', glow, gold, fire], 6, 0.8),
      ramp: 6,
      additive: true,
      align: true,
      life: 0.5,
      lifeVar: 0.4,
      speed: 1250,
      speedVar: 0.5,
      angle: -Math.PI / 2,
      spread: Math.PI,
      drag: 4.5,
      gravity: 1500,
      size: 52,
      sizeEnd: 10,
      sizeVar: 0.3,
      curve: CURVE_LINEAR,
    }),
    sparkSmall: particleSpec({
      sprite: atlas.ramp(sprites.spark, [glow, gold, ember], 4, 0.3),
      ramp: 4,
      additive: true,
      align: true,
      life: 0.22,
      lifeVar: 0.4,
      speed: 420,
      speedVar: 0.5,
      angle: -Math.PI / 2,
      spread: 1.5,
      drag: 5,
      gravity: 1400,
      size: 18,
      sizeEnd: 5,
      alpha: 0.8,
      curve: CURVE_FADE,
    }),
    flare: particleSpec({
      sprite: atlas.tint(sprites.glow, '#ffdca0', 0.35),
      additive: true,
      life: 0.13,
      lifeVar: 0.1,
      size: 100,
      sizeEnd: 140,
      sizeVar: 0.1,
      curve: CURVE_FLASH,
      alpha: 0.85,
    }),
    flareBig: particleSpec({
      sprite: atlas.tint(sprites.glow, gold, 0.35),
      additive: true,
      life: 0.3,
      lifeVar: 0.1,
      size: 300,
      sizeEnd: 420,
      sizeVar: 0.05,
      curve: CURVE_FLASH,
      alpha: 0.75,
    }),
    bloom: particleSpec({
      sprite: atlas.tint(sprites.glow, '#ffab45', 0.12),
      additive: true,
      life: 0.45,
      lifeVar: 0.1,
      size: 300,
      sizeEnd: 380,
      sizeVar: 0.05,
      curve: CURVE_FLASH,
      alpha: 0.6,
    }),
    glint: particleSpec({
      sprite: atlas.tint(fx.star, '#ffe2a0', 0.45),
      additive: true,
      life: 0.26,
      lifeVar: 0.15,
      size: 120,
      sizeEnd: 20,
      sizeVar: 0.15,
      rotVar: 0.4,
      spinVar: 3,
      curve: CURVE_FLASH,
    }),
    slash: particleSpec({
      sprite: fx.slash,
      additive: true,
      life: 0.2,
      lifeVar: 0.1,
      size: 190,
      sizeEnd: 250,
      sizeVar: 0.12,
      curve: CURVE_LINEAR,
    }),
    ring: particleSpec({
      sprite: atlas.tint(sprites.ring, glow, 0.5),
      additive: true,
      life: 0.34,
      lifeVar: 0.08,
      size: 40,
      sizeEnd: 300,
      sizeVar: 0.05,
      curve: CURVE_FADE,
      alpha: 0.95,
    }),
    ember: particleSpec({
      sprite: atlas.ramp(sprites.ember, ['#fff3c0', fire, ember], 5, 0.5),
      ramp: 5,
      additive: true,
      life: 1.4,
      lifeVar: 0.5,
      speed: 150,
      speedVar: 0.7,
      angle: -Math.PI / 2,
      spread: 1.3,
      gravity: -90,
      drag: 1.4,
      size: 10,
      sizeEnd: 3,
      sizeVar: 0.4,
      curve: CURVE_HOLD,
      alpha: 0.95,
    }),
    dust: particleSpec({
      sprite: atlas.tint(sprites.dust, '#b88a62'),
      life: 0.9,
      lifeVar: 0.35,
      speed: 160,
      speedVar: 0.6,
      angle: -Math.PI / 2,
      spread: Math.PI / 2,
      drag: 3.2,
      gravity: 60,
      ground: true,
      size: 34,
      sizeEnd: 96,
      sizeVar: 0.35,
      curve: CURVE_FADE,
      alpha: 0.5,
    }),
    smoke: particleSpec({
      sprite: atlas.tint(sprites.smoke, '#3b2a24'),
      life: 1.8,
      lifeVar: 0.35,
      speed: 70,
      speedVar: 0.6,
      angle: -Math.PI / 2,
      spread: 0.7,
      gravity: -30,
      drag: 1.2,
      size: 70,
      sizeEnd: 180,
      sizeVar: 0.3,
      curve: CURVE_PULSE,
      alpha: 0.42,
      rotVar: Math.PI,
      spinVar: 0.5,
    }),
    shimmer: particleSpec({
      sprite: atlas.tint(sprites.glow, gold, 0.6),
      additive: true,
      life: 1.5,
      lifeVar: 0.4,
      speed: 50,
      speedVar: 0.6,
      angle: -Math.PI / 2,
      spread: 0.5,
      gravity: -110,
      drag: 0.8,
      size: 18,
      sizeEnd: 5,
      sizeVar: 0.4,
      curve: CURVE_PULSE,
    }),
    beam: particleSpec({
      sprite: atlas.tint(fx.beam, gold),
      additive: true,
      life: 1.3,
      lifeVar: 0.2,
      size: 420,
      sizeEnd: 520,
      sizeVar: 0.1,
      rot: -Math.PI / 2,
      curve: CURVE_PULSE,
      alpha: 0.55,
    }),
    coin: particleSpec({
      sprite: fx.coin,
      ramp: COIN_FRAMES,
      life: 2.2,
      lifeVar: 0.12,
      speed: 700,
      speedVar: 0.35,
      angle: -Math.PI / 2,
      spread: 0.95,
      gravity: 2100,
      drag: 1.1,
      size: 28,
      sizeEnd: 22,
      sizeVar: 0.18,
      curve: CURVE_HOLD,
      rotVar: 0.5,
    }),
    coinGlint: particleSpec({
      sprite: atlas.tint(fx.star, '#fff3c4', 0.9),
      additive: true,
      life: 0.24,
      lifeVar: 0.2,
      size: 46,
      sizeEnd: 8,
      rotVar: 0.8,
      curve: CURVE_FLASH,
    }),
  };
}
