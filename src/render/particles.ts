// Pooled particle system: struct-of-arrays, fixed capacity, zero allocations per spawn, update
// and draw. Two systems exist: `world` (meters, drawn through the camera, layer slot 3) and
// `screen` (CSS px, drawn on top of everything, slot 8: coins flying to the HUD).
//
// Spawning: build a ParticleSpec ONCE (module scope / constructor) with particleSpec({...}), then
//   ps.burst(spec, x, y, count[, angle, scale])  - randomized burst from the spec's ranges
//   ps.spawn(spec, x, y, vx, vy)                  - one particle with an exact velocity; returns index
// After spawn you may tweak that index's arrays directly (ps.size0[i] = ...), or call
// ps.homeTo(i, tx, ty, delay) to make it fly to a target (screen space) and fire onArrive.
// When full, the oldest particle is recycled.
import type { SpriteAtlas } from './atlas';
import type { Layer, View } from './types';
import { TAU } from '../lib/math';

/** Alpha curves over normalized life t. */
export const CURVE_LINEAR = 0; // 1 - t
export const CURVE_FADE = 1; // (1 - t)^2: bright start, quick fade
export const CURVE_PULSE = 2; // sin(pi t): fade in and out
export const CURVE_HOLD = 3; // full until 70% of life, then linear out
export const CURVE_FLASH = 4; // in over the first 10%, then (1 - t)^2

/** Per-particle flag bits. */
export const PF_ADDITIVE = 1;
export const PF_ALIGN = 2;
export const PF_HOMING = 4;
export const PF_GROUND = 8;

export interface ParticleSpec {
  /** Atlas sprite id (first id of a ramp if ramp > 1). */
  sprite: number;
  /** Number of consecutive sprite variants stepped through over life (atlas.ramp). 1 = none. */
  ramp: number;
  /** Draw with 'lighter' (light, fire, sparks) instead of normal blending (smoke, dust, coins). */
  additive: boolean;
  /** Rotate to face the velocity (sprites point along +x). */
  align: boolean;
  /** Collide with the ground (y > 0) and skid (world space only). */
  ground: boolean;
  /** Seconds, and +/- fraction of variation. */
  life: number;
  lifeVar: number;
  /** Units/s (m/s in world, px/s on screen), and +/- fraction. */
  speed: number;
  speedVar: number;
  /** Direction in radians (0 = +x/right, -PI/2 = up) and +/- half-angle of the cone. */
  angle: number;
  spread: number;
  /** Random spawn offset within this radius (units). */
  radius: number;
  /** Units/s^2, +y down. */
  gravity: number;
  /** Velocity damping in 1/s. */
  drag: number;
  /** Sprite width in units at birth and death, and +/- fraction of variation (applies to both). */
  size: number;
  sizeEnd: number;
  sizeVar: number;
  /** Peak alpha and the curve over life. */
  alpha: number;
  curve: number;
  /** Initial rotation (rad) +/- variation, and spin (rad/s) +/- variation. */
  rot: number;
  rotVar: number;
  spin: number;
  spinVar: number;
}

const SPEC_DEFAULTS: Omit<ParticleSpec, 'sprite'> = {
  ramp: 1,
  additive: false,
  align: false,
  ground: false,
  life: 1,
  lifeVar: 0.2,
  speed: 0,
  speedVar: 0.3,
  angle: -Math.PI / 2,
  spread: Math.PI,
  radius: 0,
  gravity: 0,
  drag: 0,
  size: 1,
  sizeEnd: 1,
  sizeVar: 0.2,
  alpha: 1,
  curve: CURVE_FADE,
  rot: 0,
  rotVar: 0,
  spin: 0,
  spinVar: 0,
};

/** Build a spec with defaults. Call at init and keep it; specs are mutable templates. */
export function particleSpec(p: Partial<ParticleSpec> & { sprite: number }): ParticleSpec {
  return { ...SPEC_DEFAULTS, ...p };
}

function curveAt(c: number, t: number): number {
  switch (c) {
    case CURVE_LINEAR:
      return 1 - t;
    case CURVE_FADE:
      return (1 - t) * (1 - t);
    case CURVE_PULSE:
      return Math.sin(Math.PI * t);
    case CURVE_HOLD:
      return t < 0.7 ? 1 : (1 - t) / 0.3;
    case CURVE_FLASH:
      return t < 0.1 ? t / 0.1 : ((1 - t) / 0.9) * ((1 - t) / 0.9);
    default:
      return 1 - t;
  }
}

export type ParticleSpace = 'world' | 'screen';

export class ParticleSystem {
  readonly capacity: number;
  /** Live particles. */
  count = 0;

  // Struct of arrays (public: tweak a particle right after spawn if a spec isn't enough).
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly grav: Float32Array;
  readonly drag: Float32Array;
  readonly age: Float32Array;
  /** 0 = dead slot. */
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  readonly alpha: Float32Array;
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly homeDelay: Float32Array;
  readonly homeK: Float32Array;
  readonly sprite: Uint16Array;
  readonly ramp: Uint8Array;
  readonly curve: Uint8Array;
  readonly flags: Uint8Array;
  /** Free-form per-particle tag for onArrive (e.g. which counter to bump). */
  readonly tag: Uint8Array;

  private arriveFn: ((system: ParticleSystem, index: number) => void) | null = null;

  /**
   * Called when a homing particle reaches its target (or its life runs out). No closures per call.
   * A SINGLE slot: `particles.screen` arrivals are owned by render/fx (everyone else subscribes via
   * `scene.fx.onCoinLanded`). Overwriting it with a different function warns in dev; a new owner
   * must chain the previous handler.
   */
  get onArrive(): ((system: ParticleSystem, index: number) => void) | null {
    return this.arriveFn;
  }

  set onArrive(fn: ((system: ParticleSystem, index: number) => void) | null) {
    if (import.meta.env?.DEV && this.arriveFn && fn && fn !== this.arriveFn) {
      console.warn('ParticleSystem.onArrive overwritten: it is a single slot (render/fx owns particles.screen). Chain the previous handler.');
    }
    this.arriveFn = fn;
  }

  private head = 0;
  /** One past the highest possibly-live index: loops stop here. */
  private hi = 0;
  private seed = 0x2545f491;

  constructor(
    capacity: number,
    readonly atlas: SpriteAtlas,
    readonly space: ParticleSpace,
  ) {
    this.capacity = capacity;
    const f = (): Float32Array => new Float32Array(capacity);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.grav = f();
    this.drag = f();
    this.age = f();
    this.life = f();
    this.size0 = f();
    this.size1 = f();
    this.alpha = f();
    this.rot = f();
    this.spin = f();
    this.tx = f();
    this.ty = f();
    this.homeDelay = f();
    this.homeK = f();
    this.sprite = new Uint16Array(capacity);
    this.ramp = new Uint8Array(capacity);
    this.curve = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.tag = new Uint8Array(capacity);
  }

  /** Fast visual-only random in [0, 1) (xorshift32; not the game's deterministic RNG). */
  rand(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s;
    return (s >>> 0) / 4294967296;
  }

  private alloc(): number {
    const cap = this.capacity;
    let i = this.head;
    // Prefer a dead slot close to the head; otherwise recycle the head (the oldest spawn).
    for (let k = 0; k < 8; k++) {
      const j = (this.head + k) % cap;
      if (this.life[j] === 0) {
        i = j;
        break;
      }
    }
    this.head = (i + 1) % cap;
    if (this.life[i] === 0) this.count++;
    else if (this.flags[i]! & PF_HOMING && this.arriveFn) this.arriveFn(this, i);
    if (i >= this.hi) this.hi = i + 1;
    return i;
  }

  private kill(i: number): void {
    this.life[i] = 0;
    this.flags[i] = 0;
    this.count--;
    if (this.count === 0) {
      this.head = 0;
      this.hi = 0;
    }
  }

  /** Spawn one particle with an exact velocity. Returns its index (valid until it dies). */
  spawn(spec: ParticleSpec, x: number, y: number, vx: number, vy: number): number {
    const i = this.alloc();
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.grav[i] = spec.gravity;
    this.drag[i] = spec.drag;
    this.age[i] = 0;
    const life = spec.life * (1 + spec.lifeVar * (this.rand() * 2 - 1));
    this.life[i] = life > 0.001 ? life : 0.001;
    const sm = 1 + spec.sizeVar * (this.rand() * 2 - 1);
    this.size0[i] = spec.size * sm;
    this.size1[i] = spec.sizeEnd * sm;
    this.alpha[i] = spec.alpha;
    this.curve[i] = spec.curve;
    this.rot[i] = spec.rot + spec.rotVar * (this.rand() * 2 - 1);
    this.spin[i] = spec.spin + spec.spinVar * (this.rand() * 2 - 1);
    this.sprite[i] = spec.sprite;
    this.ramp[i] = spec.ramp;
    this.flags[i] = (spec.additive ? PF_ADDITIVE : 0) | (spec.align ? PF_ALIGN : 0) | (spec.ground ? PF_GROUND : 0);
    this.tag[i] = 0;
    return i;
  }

  /**
   * Spawn `count` particles with the spec's randomized direction/speed/size.
   * `angle` overrides spec.angle; `scale` multiplies speed, size, gravity and radius (e.g. pass
   * 1 / camera.zoom to author a world-space effect in screen pixels).
   */
  burst(spec: ParticleSpec, x: number, y: number, count: number, angle: number = spec.angle, scale = 1): void {
    for (let n = 0; n < count; n++) {
      const a = angle + spec.spread * (this.rand() * 2 - 1);
      const sp = spec.speed * (1 + spec.speedVar * (this.rand() * 2 - 1)) * scale;
      let ox = 0;
      let oy = 0;
      if (spec.radius > 0) {
        const rr = spec.radius * scale * Math.sqrt(this.rand());
        const th = this.rand() * TAU;
        ox = Math.cos(th) * rr;
        oy = Math.sin(th) * rr;
      }
      const i = this.spawn(spec, x + ox, y + oy, Math.cos(a) * sp, Math.sin(a) * sp);
      if (scale !== 1) {
        this.size0[i] *= scale;
        this.size1[i] *= scale;
        this.grav[i] *= scale;
      }
    }
  }

  /**
   * Make particle i fly to (tx, ty) after `delay` seconds of free flight; `strength` scales how
   * hard it steers. onArrive(system, i) fires on arrival (or when its life runs out).
   */
  homeTo(i: number, tx: number, ty: number, delay: number, strength = 1): void {
    this.tx[i] = tx;
    this.ty[i] = ty;
    this.homeDelay[i] = delay;
    this.homeK[i] = strength;
    this.flags[i] |= PF_HOMING;
  }

  /** Retarget every homing particle with this tag (e.g. the HUD counter moved). */
  retarget(tag: number, tx: number, ty: number): void {
    const n = this.hi;
    for (let i = 0; i < n; i++) {
      if (this.life[i] !== 0 && this.flags[i]! & PF_HOMING && this.tag[i] === tag) {
        this.tx[i] = tx;
        this.ty[i] = ty;
      }
    }
  }

  clear(): void {
    this.life.fill(0);
    this.flags.fill(0);
    this.count = 0;
    this.head = 0;
    this.hi = 0;
  }

  update(dt: number): void {
    if (dt <= 0 || this.count === 0) return;
    const n = this.hi;
    const life = this.life;
    const age = this.age;
    const flags = this.flags;
    const px = this.x;
    const py = this.y;
    const pvx = this.vx;
    const pvy = this.vy;
    for (let i = 0; i < n; i++) {
      const L = life[i]!;
      if (L === 0) continue;
      const fl = flags[i]!;
      const a = age[i]! + dt;
      if (a >= L) {
        if (fl & PF_HOMING && this.arriveFn) this.arriveFn(this, i);
        this.kill(i);
        continue;
      }
      age[i] = a;
      let vx = pvx[i]!;
      let vy = pvy[i]!;
      let x = px[i]!;
      let y = py[i]!;
      if (fl & PF_HOMING && a > this.homeDelay[i]!) {
        const h = a - this.homeDelay[i]!;
        const k = this.homeK[i]!;
        const dx = this.tx[i]! - x;
        const dy = this.ty[i]! - y;
        const d = Math.sqrt(dx * dx + dy * dy) + 1e-6;
        const sp = 350 + h * 2800 * k;
        if (d < 12 || d < sp * dt * 1.25) {
          if (this.arriveFn) this.arriveFn(this, i);
          this.kill(i);
          continue;
        }
        let blend = (5 + h * 40) * k * dt;
        if (blend > 1) blend = 1;
        vx += ((dx / d) * sp - vx) * blend;
        vy += ((dy / d) * sp - vy) * blend;
      } else {
        vy += this.grav[i]! * dt;
        const dr = this.drag[i]!;
        if (dr > 0) {
          const damp = 1 / (1 + dr * dt);
          vx *= damp;
          vy *= damp;
        }
      }
      x += vx * dt;
      y += vy * dt;
      if (fl & PF_GROUND && y > 0) {
        y = 0;
        if (vy > 0) vy = -vy * 0.25;
        vx *= 0.6;
      }
      px[i] = x;
      py[i] = y;
      pvx[i] = vx;
      pvy[i] = vy;
      this.rot[i] += this.spin[i]! * dt;
    }
  }

  /** Draw all live particles: normal-blend pass, then additive pass. Uses view.camera for world space. */
  draw(ctx: CanvasRenderingContext2D, view: View): void {
    if (this.count === 0) return;
    const canvases = this.atlas.canvases;
    const dpr = view.dpr;
    let A = dpr;
    let B = 0;
    let C = 0;
    let Dm = dpr;
    let E = 0;
    let F = 0;
    let zoom = dpr;
    let camRot = 0;
    if (this.space === 'world') {
      const cam = view.camera;
      A = cam.a * dpr;
      B = cam.b * dpr;
      C = cam.c * dpr;
      Dm = cam.d * dpr;
      E = cam.e * dpr;
      F = cam.f * dpr;
      zoom = cam.zoomEff * dpr;
      camRot = cam.rotEff;
    }
    const W = view.width * dpr;
    const H = view.height * dpr;
    const n = this.hi;
    const life = this.life;
    const flags = this.flags;
    for (let pass = 0; pass < 2; pass++) {
      const want = pass === 1 ? PF_ADDITIVE : 0;
      ctx.globalCompositeOperation = pass === 1 ? 'lighter' : 'source-over';
      for (let i = 0; i < n; i++) {
        const L = life[i]!;
        if (L === 0) continue;
        const fl = flags[i]!;
        if ((fl & PF_ADDITIVE) !== want) continue;
        const t = this.age[i]! / L;
        let alpha = this.alpha[i]! * curveAt(this.curve[i]!, t);
        if (alpha < 0.004) continue;
        if (alpha > 1) alpha = 1;
        const rampN = this.ramp[i]!;
        let sid = this.sprite[i]!;
        if (rampN > 1) {
          const step = (t * rampN) | 0;
          sid += step < rampN ? step : rampN - 1;
        }
        const img = canvases[sid];
        if (img === undefined) continue;
        const x = this.x[i]!;
        const y = this.y[i]!;
        const sx = A * x + C * y + E;
        const sy = B * x + Dm * y + F;
        const s0 = this.size0[i]!;
        const sizePx = (s0 + (this.size1[i]! - s0) * t) * zoom;
        if (sizePx < 0.3) continue;
        if (sx < -sizePx || sx > W + sizePx || sy < -sizePx || sy > H + sizePx) continue;
        const k = sizePx / img.width;
        let ang = this.rot[i]! + camRot;
        if (fl & PF_ALIGN) ang += Math.atan2(this.vy[i]!, this.vx[i]!);
        ctx.globalAlpha = alpha;
        if (ang === 0) ctx.setTransform(k, 0, 0, k, sx, sy);
        else {
          const cs = Math.cos(ang) * k;
          const sn = Math.sin(ang) * k;
          ctx.setTransform(cs, sn, -sn, cs, sx, sy);
        }
        ctx.drawImage(img, -img.width * 0.5, -img.height * 0.5);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

/** A stack slot that updates and draws one particle system. */
export function createParticleLayer(name: string, system: ParticleSystem, clock: 'scaled' | 'real' = 'scaled'): Layer {
  return {
    name,
    visible: true,
    update(view: View): void {
      system.update(clock === 'scaled' ? view.dt : view.realDt);
    },
    draw(ctx: CanvasRenderingContext2D, view: View): void {
      system.draw(ctx, view);
    },
  };
}
