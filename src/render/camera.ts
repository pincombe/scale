// Camera: world meters -> screen CSS px, with parallax for backdrop depth, trauma shake and zoom
// punches. Allocation-free: all queries write into out-params.
//
// Framing fields (x, y, zoom, rot) are written by the in-tier director (or the M2 zoom director).
// update() then eases the UI inset, decays shake/punch and derives the affine matrix. If you change
// the framing after update() in the same frame, call derive().
import { Noise } from '../lib/noise';
import { damp } from '../lib/math';
import type { Rect, Vec2 } from '../lib/vec';

export class Camera {
  // ---- framing ----
  /** World point (m) shown at the stage center. */
  x = -1;
  y = -2;
  /** CSS px per meter. */
  zoom = 100;
  /** Base roll in radians (cinematics). Shake roll is added on top. */
  rot = 0;

  // ---- viewport (CSS px) ----
  viewW = 1;
  viewH = 1;
  /** CSS px on the right covered by the UI panel (eased toward insetRightTarget). */
  insetRight = 0;
  insetRightTarget = 0;

  // ---- parallax (see applyParallax) ----
  /** Screen y of the parallax anchor as a fraction of view height (director: the ground line). */
  anchorFrac = 0.5;
  /** World point under the anchor, and the zoom, at the reference framing (the tier's base). */
  refX = -1;
  refY = 0;
  refZoom = 100;

  // ---- shake / punch tuning ----
  trauma = 0;
  /** Trauma lost per second. */
  traumaDecay = 1.3;
  /** Max shake offset as a fraction of view height, and max roll in radians. */
  shakeFrac = 0.028;
  maxRoll = 0.035;
  /** Shake noise frequency (Hz-ish). */
  shakeFreq = 22;
  /** Global multiplier (settings.reduceMotion sets ~0.25). */
  motionScale = 1;

  // ---- derived after update()/derive() ----
  /** screen = [a c e; b d f] . [wx wy 1] (CSS px, no dpr). */
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  /** Zoom and roll including punch and shake. */
  zoomEff = 100;
  rotEff = 0;
  /** Current shake offsets (px) and roll (rad), already scaled by trauma. */
  shakeX = 0;
  shakeY = 0;
  shakeRot = 0;

  private punch = 0;
  private punchTarget = 0;
  private shakeT = 0;
  private readonly noise = new Noise(0x5ca1e);
  private cos = 1;
  private sin = 0;
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly pm = new Float64Array(6);

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.derive();
  }

  /** Width of the uncovered stage (CSS px). */
  get stageW(): number {
    return Math.max(1, this.viewW - this.insetRight);
  }

  /** Stage center in screen CSS px (without shake). */
  get stageCX(): number {
    return (this.viewW - this.insetRight) * 0.5;
  }

  get stageCY(): number {
    return this.viewH * 0.5;
  }

  /** Add screen-shake trauma (0..1, clamped). Shake = trauma^2, so small hits stay subtle. */
  addTrauma(t: number): void {
    this.trauma = Math.min(1, this.trauma + t);
  }

  /** Zoom punch: momentary zoom-in by `strength` (0.05 = +5%) that springs back. */
  punchZoom(strength: number): void {
    if (strength > this.punchTarget) this.punchTarget = strength;
  }

  /** Jump the inset to its target (no easing). */
  snapInset(): void {
    this.insetRight = this.insetRightTarget;
    this.derive();
  }

  /**
   * Per-frame: ease the inset (realDt so UI stays snappy in slow-mo), decay trauma and punch,
   * sample shake noise, derive the matrix.
   */
  update(realDt: number): void {
    this.insetRight = damp(this.insetRight, this.insetRightTarget, 9, realDt);
    if (Math.abs(this.insetRight - this.insetRightTarget) < 0.25) this.insetRight = this.insetRightTarget;

    this.trauma = Math.max(0, this.trauma - this.traumaDecay * realDt);
    this.shakeT += realDt;
    const m = this.trauma * this.trauma * this.motionScale;
    if (m > 0) {
      const t = this.shakeT * this.shakeFreq;
      const amp = this.shakeFrac * this.viewH * m;
      this.shakeX = amp * this.noise.n1(t);
      this.shakeY = amp * this.noise.n1(t + 57.3);
      this.shakeRot = this.maxRoll * m * this.noise.n1(t + 131.7);
    } else {
      this.shakeX = this.shakeY = this.shakeRot = 0;
    }

    this.punch = damp(this.punch, this.punchTarget, 40, realDt);
    this.punchTarget = damp(this.punchTarget, 0, 7, realDt);
    if (this.punchTarget < 1e-4) this.punchTarget = 0;
    this.derive();
  }

  /** Recompute the matrix from the current framing, shake and punch. */
  derive(): void {
    const z = this.zoom * (1 + this.punch * this.motionScale);
    const r = this.rot + this.shakeRot;
    this.zoomEff = z;
    this.rotEff = r;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    this.cos = cos;
    this.sin = sin;
    this.a = z * cos;
    this.b = z * sin;
    this.c = -z * sin;
    this.d = z * cos;
    const cx = this.stageCX + this.shakeX;
    const cy = this.stageCY + this.shakeY;
    this.e = cx - (this.a * this.x + this.c * this.y);
    this.f = cy - (this.b * this.x + this.d * this.y);
  }

  worldToScreen(wx: number, wy: number, out: Vec2): Vec2 {
    out.x = this.a * wx + this.c * wy + this.e;
    out.y = this.b * wx + this.d * wy + this.f;
    return out;
  }

  screenToWorld(sx: number, sy: number, out: Vec2): Vec2 {
    const dx = sx - (this.stageCX + this.shakeX);
    const dy = sy - (this.stageCY + this.shakeY);
    const iz = 1 / this.zoomEff;
    out.x = this.x + (this.cos * dx + this.sin * dy) * iz;
    out.y = this.y + (-this.sin * dx + this.cos * dy) * iz;
    return out;
  }

  /** Meters -> CSS px at the stage plane. */
  toPx(meters: number): number {
    return meters * this.zoomEff;
  }

  /** Multiply the world transform onto ctx (call after the renderer's dpr reset). */
  apply(ctx: CanvasRenderingContext2D): void {
    ctx.transform(this.a, this.b, this.c, this.d, this.e, this.f);
  }

  // ---- parallax ----
  //
  // Depth factor p: 0 = infinitely far (sky), 1 = the stage plane (identical to apply()), > 1 = in
  // front of the stage (foreground). Parallax layers scale about the screen anchor (stage center x,
  // anchorFrac of the height; the director puts it on the ground line) and, relative to the
  // reference framing, zoom by (zoom/refZoom)^p and pan by p x the camera's pan. So as the camera
  // pulls back, far layers barely shrink and stay seated on the horizon. Shake is scaled by p.
  // Layer coordinates equal world meters at the reference framing.

  /** Zoom (CSS px per layer unit) of a parallax layer. */
  parallaxZoom(p: number): number {
    return this.refZoom * Math.pow(this.zoomEff / this.refZoom, p);
  }

  /** Writes the parallax matrix for depth p into this.pm (a, b, c, d, e, f). */
  private parallaxMatrix(p: number): void {
    // World point currently under the anchor (exact inverse of the stage transform).
    const dx = 0;
    const dy = (this.anchorFrac - 0.5) * this.viewH;
    const iz = 1 / this.zoomEff;
    const wx = this.x + (this.cos * dx + this.sin * dy) * iz;
    const wy = this.y + (-this.sin * dx + this.cos * dy) * iz;
    const lx = this.refX + (wx - this.refX) * p;
    const ly = this.refY + (wy - this.refY) * p;
    const z = this.parallaxZoom(p);
    const r = this.rot + this.shakeRot * p;
    const cos = Math.cos(r) * z;
    const sin = Math.sin(r) * z;
    const ax = this.stageCX + this.shakeX * p;
    const ay = this.anchorFrac * this.viewH + this.shakeY * p;
    const m = this.pm;
    m[0] = cos;
    m[1] = sin;
    m[2] = -sin;
    m[3] = cos;
    m[4] = ax - (cos * lx - sin * ly);
    m[5] = ay - (sin * lx + cos * ly);
  }

  /** Multiply the parallax transform for depth p onto ctx. */
  applyParallax(ctx: CanvasRenderingContext2D, p: number): void {
    this.parallaxMatrix(p);
    const m = this.pm;
    ctx.transform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
  }

  /** Layer-space point at depth p -> screen CSS px. */
  parallaxToScreen(p: number, lx: number, ly: number, out: Vec2): Vec2 {
    this.parallaxMatrix(p);
    const m = this.pm;
    out.x = m[0]! * lx + m[2]! * ly + m[4]!;
    out.y = m[1]! * lx + m[3]! * ly + m[5]!;
    return out;
  }

  /** World AABB of the whole viewport (plus `margin` CSS px), accounting for roll. */
  visibleRect(out: Rect, margin = 0): Rect {
    const t = this.tmp;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? this.viewW + margin : -margin;
      const sy = i & 2 ? this.viewH + margin : -margin;
      this.screenToWorld(sx, sy, t);
      if (t.x < x0) x0 = t.x;
      if (t.y < y0) y0 = t.y;
      if (t.x > x1) x1 = t.x;
      if (t.y > y1) y1 = t.y;
    }
    out.x = x0;
    out.y = y0;
    out.w = x1 - x0;
    out.h = y1 - y0;
    return out;
  }
}
