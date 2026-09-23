// The zoom's geometry (pure, tested): where the camera and the meadow snapshot are at every moment.
//
// The colossus is the fused army: `ratio` (= zoomBegin.height / 1.8) times the crowd's hero. In the
// old tier it stands where the hero stood, `ratio` times too big; in the new tier it IS the hero.
//
// Flash framing (old tier): the camera the rally and fusion ease into, and the one the snapshot is
// taken with. Both boots span the stage (BOOTS_FILL of its width), the ground line where the in-tier
// director keeps it, so the moment the colossus appears its armored boots fill the screen. At the
// switch the camera becomes the new tier's equivalent (same screen, zoom x ratio): the snapshot is
// then exactly the world rect the camera sees, and the colossus stands in it.
//
// Camera path (new tier, CameraPath): it rests on the boots, then pulls back in three strokes, each
// a zoom about its own fixed screen point (the one point that stays put while the view scales, so
// the motion never slides sideways), each starting and landing at rest (pullEase), so they chain
// without a jolt: the boots -> the hold (the meadow's scale at the colossus's feet, ~a fifth of the
// stage wide), a slow drift about the scale itself, then the hold -> the in-tier director's framing,
// where the colossus is the hero at its base size.
//
// The meadow (MeadowMorph): a world-space rect. At the switch it is the screen (the colossus stands
// in it, and the camera's pull-back shrinks both alike); over the first stroke it condenses into the
// picture rect of one scale of the hide, just in front of the colossus's toes (its log-size and the
// point under his feet interpolated), while its frame morphs from the rectangle into the scale's
// plate. From the hold on it is that scale.
import { KNIGHT_HEIGHT } from '../world';

/** The crowd's hero is this much taller than a knight (mirrors crowd/hero.ts HERO_SCALE). */
export const COLOSSUS_SCALE = 1.1;
/** Meters per figure unit for the hero, which the colossus becomes (a knight is 100 units tall). */
export const HERO_UNIT = (KNIGHT_HEIGHT / 100) * COLOSSUS_SCALE;
/** The crowd's hero stands this far below the ground line (mirrors crowd/hero.ts Hero.y). */
export const HERO_Y = 0.12;
/** Both boots in the guard pose, from the back heel to the front toe (figure units from the root). */
export const BOOTS_X0 = -15.5;
export const BOOTS_X1 = 23.5;
/** Fraction of the stage width the boots span at the flash. */
export const BOOTS_FILL = 1.06;
/** The flash framing never pulls back further than this from the old tier's base framing (the
 *  backdrop is built to hold ~13x). */
export const MAX_FLASH_PULL = 12;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function smootherstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The stroke easing (mirrors timeline.pullEase; kept local so geometry has no timing import). */
function stroke(u: number, a: number, b: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const v = 1 / (1 - (a + b) / 2);
  if (u < a) return v * (u / 2 - (a / (2 * Math.PI)) * Math.sin((Math.PI * u) / a));
  const mid = 1 - a - b;
  if (u <= a + mid) return v * (a / 2 + (u - a));
  const w = u - (a + mid);
  return v * (a / 2 + mid + w / 2 + (b / (2 * Math.PI)) * Math.sin((Math.PI * w) / b));
}

function strokeSpeed(u: number, a: number, b: number): number {
  if (u <= 0 || u >= 1) return 0;
  const v = 1 / (1 - (a + b) / 2);
  if (u < a) return (v * (1 - Math.cos((Math.PI * u) / a))) / 2;
  if (u <= 1 - b) return v;
  return (v * (1 + Math.cos((Math.PI * (u - (1 - b))) / b))) / 2;
}

export interface FlashFraming {
  /** Old-tier CSS px per meter. */
  zoom: number;
  /** Camera center (old-tier world m). */
  x: number;
  y: number;
  /** The colossus's root (the hero's feet) on screen, CSS px. */
  rootSX: number;
  rootSY: number;
}

export function flashFraming(): FlashFraming {
  return { zoom: 1, x: 0, y: 0, rootSX: 0, rootSY: 0 };
}

/**
 * The old tier's camera at the flash. `heroX`: the hero's root x (old-tier m); `ratio`: colossus /
 * hero; `groundFrac`: the ground line's screen fraction; `baseZoom`: the old tier's base framing
 * zoom (the closest the camera may be). Writes and returns `out`.
 */
export function computeFlashFraming(
  stageW: number,
  stageH: number,
  stageCX: number,
  stageCY: number,
  heroX: number,
  ratio: number,
  groundFrac: number,
  baseZoom: number,
  out: FlashFraming,
): FlashFraming {
  const unit = HERO_UNIT * Math.max(1, ratio);
  const z = clamp((BOOTS_FILL * stageW) / ((BOOTS_X1 - BOOTS_X0) * unit), baseZoom / MAX_FLASH_PULL, baseZoom);
  const rootSX = stageCX - ((BOOTS_X0 + BOOTS_X1) / 2) * unit * z;
  const groundSY = groundFrac * stageH;
  out.zoom = z;
  out.rootSX = rootSX;
  out.rootSY = groundSY + HERO_Y * z;
  out.x = heroX - (rootSX - stageCX) / z;
  out.y = -(groundSY - stageCY) / z;
  return out;
}

/** Stroke ramps (fractions of each stroke's time): in, out. */
export const STROKE1_A = 0.34;
export const STROKE1_B = 0.44;
export const HOLD_A = 0.5;
export const HOLD_B = 0.5;
export const STROKE2_A = 0.36;
export const STROKE2_B = 0.4;

/** Pull-back stage (CameraPath.stage). */
export const enum Stroke {
  Boots = 0,
  Closing = 1,
  Hold = 2,
  Landscape = 3,
  Landed = 4,
}

/**
 * The new tier's camera from the flash to the landing. Set the inputs (public fields), then at(t);
 * outputs are fields. Allocation-free.
 */
export class CameraPath {
  // ---- inputs: times (s) ----
  pullStart = 0;
  holdStart = 1;
  holdEnd = 2;
  pullEnd = 3;
  // ---- inputs: keyframes (CSS px per meter; the colossus's root on screen, CSS px) ----
  /** The boots (the flash, in the new tier's meters). */
  z0 = 1;
  sx0 = 0;
  sy0 = 0;
  /** The hold: where the first stroke lands. */
  zh = 1;
  sxh = 0;
  syh = 0;
  /** The hold's drift: zoom at its end, and the screen point it scales about (the scale). */
  zh2 = 1;
  fhx = 0;
  fhy = 0;
  /** The in-tier director's framing. */
  ze = 1;
  sxe = 0;
  sye = 0;
  /** The colossus's root (world m) and the stage center (CSS px), for the camera center. */
  rootX = 0;
  rootY = HERO_Y;
  stageCX = 0;
  stageCY = 0;

  // ---- outputs ----
  zoom = 1;
  rootSX = 0;
  rootSY = 0;
  camX = 0;
  camY = 0;
  /** d(ln zoom)/dt (negative while pulling back). */
  speed = 0;
  stage: Stroke = Stroke.Boots;
  /** Progress of the current stroke's time (0..1). */
  u = 0;

  at(t: number): this {
    if (t < this.pullStart) {
      this.set(Stroke.Boots, 0, this.z0, this.sx0, this.sy0, 0);
    } else if (t < this.holdStart) {
      const u = (t - this.pullStart) / (this.holdStart - this.pullStart);
      this.scaleAbout(Stroke.Closing, u, this.z0, this.sx0, this.sy0, this.zh, this.sxh, this.syh, STROKE1_A, STROKE1_B, this.holdStart - this.pullStart);
    } else if (t < this.holdEnd) {
      const u = (t - this.holdStart) / (this.holdEnd - this.holdStart);
      const e = stroke(u, HOLD_A, HOLD_B);
      const lr = Math.log(this.zh2 / this.zh);
      const z = this.zh * Math.exp(lr * e);
      const k = z / this.zh;
      this.set(Stroke.Hold, u, z, this.fhx + (this.sxh - this.fhx) * k, this.fhy + (this.syh - this.fhy) * k, (lr * strokeSpeed(u, HOLD_A, HOLD_B)) / (this.holdEnd - this.holdStart));
    } else if (t < this.pullEnd) {
      const u = (t - this.holdEnd) / (this.pullEnd - this.holdEnd);
      const k = this.zh2 / this.zh;
      const sx1 = this.fhx + (this.sxh - this.fhx) * k;
      const sy1 = this.fhy + (this.syh - this.fhy) * k;
      this.scaleAbout(Stroke.Landscape, u, this.zh2, sx1, sy1, this.ze, this.sxe, this.sye, STROKE2_A, STROKE2_B, this.pullEnd - this.holdEnd);
    } else {
      this.set(Stroke.Landed, 1, this.ze, this.sxe, this.sye, 0);
    }
    return this;
  }

  /**
   * One stroke: zoom from za to zb about the fixed screen point that carries the root from
   * (xa, ya) to (xb, yb) (a straight, never-sliding path), eased in log-zoom.
   */
  private scaleAbout(stage: Stroke, u: number, za: number, xa: number, ya: number, zb: number, xb: number, yb: number, a: number, b: number, dur: number): void {
    const e = stroke(u, a, b);
    const lr = Math.log(zb / za);
    const z = za * Math.exp(lr * e);
    const s = zb / za;
    let x: number;
    let y: number;
    if (Math.abs(1 - s) > 0.04) {
      const fx = (xb - s * xa) / (1 - s);
      const fy = (yb - s * ya) / (1 - s);
      const k = z / za;
      x = fx + (xa - fx) * k;
      y = fy + (ya - fy) * k;
    } else {
      x = xa + (xb - xa) * e;
      y = ya + (yb - ya) * e;
    }
    this.set(stage, u, z, x, y, (lr * strokeSpeed(u, a, b)) / Math.max(1e-6, dur));
  }

  private set(stage: Stroke, u: number, z: number, x: number, y: number, speed: number): void {
    this.stage = stage;
    this.u = u;
    this.zoom = z;
    this.rootSX = x;
    this.rootSY = y;
    this.speed = speed;
    this.camX = this.rootX - (x - this.stageCX) / z;
    this.camY = this.rootY - (y - this.stageCY) / z;
  }

  /** World (new tier) -> screen at the last at(): writes out. */
  toScreen(wx: number, wy: number, out: { x: number; y: number }): { x: number; y: number } {
    out.x = this.stageCX + (wx - this.camX) * this.zoom;
    out.y = this.stageCY + (wy - this.camY) * this.zoom;
    return out;
  }
}

/**
 * The meadow picture as a world rect (new-tier meters): the screen at the switch (r0) condensing
 * into its scale's picture rect (r1) over the first stroke. `at(u)`: u = the first stroke's time
 * fraction (0 = the boots, 1 = the hold). Allocation-free.
 */
export class MeadowMorph {
  // ---- inputs ----
  /** The screen at the switch, in world meters. */
  x0 = 0;
  y0 = 0;
  w0 = 1;
  h0 = 1;
  /** Its scale's picture rect (same aspect as r0). */
  x1 = 0;
  y1 = 0;
  w1 = 1;
  /** The colossus's root (world m): the point of the meadow under his feet. */
  rootX = 0;
  rootY = HERO_Y;
  /** Windows (fractions of the stroke) for the size and the glide, and the frame's morph. */
  size0 = 0.02;
  size1 = 0.9;
  glide0 = 0;
  glide1 = 0.92;
  frame0 = 0.02;
  frame1 = 0.82;

  // ---- outputs ----
  x = 0;
  y = 0;
  w = 1;
  h = 1;
  /** 0 = the picture's own rect, 1 = the scale's plate. */
  frame = 0;

  at(u: number): this {
    const aspect = this.h0 / this.w0;
    const gs = smootherstep(this.size0, this.size1, u);
    const gp = smootherstep(this.glide0, this.glide1, u);
    const w = Math.exp(Math.log(this.w0) + (Math.log(this.w1) - Math.log(this.w0)) * gs);
    const h = w * aspect;
    // The point of the meadow under the colossus's feet: at his feet, gliding to its place in r1.
    const fx = (this.rootX - this.x0) / this.w0;
    const fy = (this.rootY - this.y0) / this.h0;
    const h1 = this.w1 * aspect;
    const ax = this.rootX + (this.x1 + fx * this.w1 - this.rootX) * gp;
    const ay = this.rootY + (this.y1 + fy * h1 - this.rootY) * gp;
    this.w = w;
    this.h = h;
    this.x = ax - fx * w;
    this.y = ay - fy * h;
    this.frame = smootherstep(this.frame0, this.frame1, u);
    return this;
  }
}
