// The colossus: the fused army as one knight, drawn direct as vectors at any size, from the crowd
// hero's own size up to ~30,000 px tall (only what is on screen costs anything: the canvas clips).
//
// It IS the crowd's hero: the same rig (crowd/rig.ts joints and shapes), the same guard pose and
// idle breathing, the same cape chain and plume spring, the same palette-driven rim light. At the
// end of the zoom it stands exactly where, and as, the hero will, so the hand-over is invisible.
//
// Rim light without a buffer: the silhouette is traced as ONE path of clockwise subpaths (the rig's
// stroked limbs become capsules), filled in the rim color, clipped, then filled again in the mid
// tone and the body color shifted away from the light. What stays uncovered is the lit edge. The
// band is the hero's width at hero size and caps at a few CSS px on a close-up, where the armor
// detail (armor.ts, drawn inside the same clip) takes over the lighting.
//
// The shield carries the player's coat of arms (render/heraldry), baked into a small mip chain
// (drawCoat builds paths and maps per call, so it is never called per frame).
import { Joints, Pose, SHIELD_SCALE, copyPose, lerpPose, shieldPath, solve } from '../crowd/rig';
import { HERO_SCALE } from '../crowd/hero';
import { drawShieldFace, type Heraldry } from '../crowd/banner';
import { context2d, makeCanvas } from '../atlas';
import { mixHex } from '../../lib/color';
import type { Palette } from '../palette';
import { COLOSSUS_SCALE } from './geometry';
import { ArmorDetail } from './armor';
import { capsule, disc, traceBoot, traceHelm, traceLeg, traceShield, traceSkirt, traceSword, traceTorso } from './shapes';

if (HERO_SCALE !== COLOSSUS_SCALE) console.warn('zoom: COLOSSUS_SCALE no longer matches the crowd hero');

function P(o: Partial<Pose>): Pose {
  return Object.assign(new Pose(), o);
}

/** The crowd hero's guard (crowd/hero.ts GUARD): sword cocked high over the shoulder. */
export const GUARD = P({ hipX: 0, hipY: -47, lean: 0.05, head: 0.0, aFootX: 11, bFootX: -10, nHandX: 12, nHandY: -62, shield: 0.06, fHandX: 3, fHandY: -70, weapon: -1.85 });
/** Landed: the colossus has just slammed down out of the pile, knees bent, weight forward. */
const LANDED = P({ hipX: 1.5, hipY: -40.5, lean: 0.24, head: 0.16, aFootX: 11, bFootX: -10, nHandX: 17, nHandY: -56, shield: -0.08, fHandX: 1, fHandY: -60, weapon: -1.55 });

const CAPE_N = 8;
const CAPE_SEG = 7.4;
const PLUME_N = 7;
const PLUME_X = [1, -5, -12, -19, -25, -30, -33];
const PLUME_Y = [4, -2, -4, -1, 5, 13, 22];
const PLUME_W = [3.5, 6, 6.8, 6.2, 5, 3.2, 0.8];
/** Figure-unit bounds (the hero's buffer bounds): culling and the cross-fade buffer. */
export const FIG_X0 = -80;
export const FIG_X1 = 100;
export const FIG_Y0 = -178;
export const FIG_Y1 = 12;
/** Rim band cap on a close-up (CSS px): past it the armor's own edge lights take over. */
const RIM_CAP = 4.2;
/** The shield face (the hero's inset kite) in figure units around its center, and the bake levels (device px per unit). */
const FACE_X = 13.5;
const FACE_Y0 = -21;
const FACE_Y1 = 27;
const FACE_LEVELS = [4, 8.5, 17, 34] as const;

function smooth(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** Figure units -> device px: [a c e; b d f]. */
export interface FigTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export class Colossus {
  readonly pose = new Pose();
  readonly j = new Joints();
  /** 0 = just landed (crouched), 1 = standing in the hero's guard. */
  settle = 1;
  /** Close-up silhouette morph (0 = the rig's exact shapes, 1 = tapered armor): set per draw. */
  shape = 0;
  private now = 0;
  private readonly tmp = new Pose();
  private readonly fake = new Joints();

  // Cape chain (figure units, root-local) and plume spring: crowd/hero.ts's, verbatim.
  private readonly cx = new Float32Array(CAPE_N);
  private readonly cy = new Float32Array(CAPE_N);
  private readonly px = new Float32Array(CAPE_N);
  private readonly py = new Float32Array(CAPE_N);
  private capeInit = false;
  private plX = 0;
  private plY = 0;
  private plVX = 0;
  private plVY = 0;
  private readonly spX = new Float32Array(PLUME_N);
  private readonly spY = new Float32Array(PLUME_N);
  private readonly spW = new Float32Array(PLUME_N);
  private readonly spNX = new Float32Array(PLUME_N);
  private readonly spNY = new Float32Array(PLUME_N);

  // Palette-derived colors.
  private pal: Palette | null = null;
  private mid = '#888';
  private plumeHi = '#f88';
  private plumeLo = '#800';

  // Shield face mip chain.
  private faces: (HTMLCanvasElement | null)[] = [null, null, null, null];
  private faceHer: Heraldry | null = null;
  private facePal: Palette | null = null;
  private faceNext = 0;

  // Cross-fade buffer (only while the colossus is translucent: the hand-over).
  private buf: HTMLCanvasElement | null = null;
  private bctx: CanvasRenderingContext2D | null = null;

  readonly armor = new ArmorDetail();

  /** Start over (a new zoom): the cape falls fresh, the plume at rest. */
  reset(): void {
    this.capeInit = false;
    this.plX = this.plY = this.plVX = this.plVY = 0;
    this.settle = 0;
  }

  /** The pose at time t (the hero's breathing idle, eased up from the landing crouch). */
  update(dt: number, t: number): void {
    this.now = t;
    const p = this.pose;
    copyPose(p, GUARD);
    const br = Math.sin(t * 2.1);
    p.hipY += 0.7 * br;
    p.hipX += 0.8 * Math.sin(t * 0.47);
    p.nHandY += 0.5 * br;
    p.fHandY += 0.8 * Math.sin(t * 2.1 + 0.5);
    p.weapon += 0.035 * Math.sin(t * 1.1);
    const s = smooth(this.settle);
    if (s < 0.999) {
      copyPose(this.tmp, p);
      lerpPose(p, LANDED, this.tmp, s);
    }
    solve(p, this.j);
    if (dt > 0) this.simulate(Math.min(dt, 1 / 30), t);
  }

  private simulate(dt: number, t: number): void {
    const j = this.j;
    const anX = j.neckX - j.fwX * 7 + j.upX * -2;
    const anY = j.neckY - j.fwY * 7 + j.upY * -2;
    if (!this.capeInit) {
      this.capeInit = true;
      for (let i = 0; i < CAPE_N; i++) {
        this.cx[i] = this.px[i] = anX - i * 2.5;
        this.cy[i] = this.py[i] = anY + i * CAPE_SEG * 0.95;
      }
    }
    const steps = 2;
    const h = dt / steps;
    const gust = 1 + 0.5 * Math.sin(t * 0.9) + 0.3 * Math.sin(t * 2.3 + 1.1);
    for (let s = 0; s < steps; s++) {
      for (let i = 1; i < CAPE_N; i++) {
        const cx = this.cx[i]!;
        const cy = this.cy[i]!;
        const f = i / (CAPE_N - 1);
        const windX = -120 * gust * (0.35 + f) + 60 * Math.sin(t * 4.3 - i * 0.8) * f;
        const windY = -45 * gust * f + 40 * Math.sin(t * 5.1 - i * 1.1) * f;
        const nx = cx + (cx - this.px[i]!) * 0.97 + windX * h * h;
        const ny = cy + (cy - this.py[i]!) * 0.97 + (400 + windY) * h * h;
        this.px[i] = cx;
        this.py[i] = cy;
        this.cx[i] = nx;
        this.cy[i] = ny;
      }
      this.cx[0] = anX;
      this.cy[0] = anY;
      for (let it = 0; it < 3; it++) {
        for (let i = 1; i < CAPE_N; i++) {
          const dx = this.cx[i]! - this.cx[i - 1]!;
          const dy = this.cy[i]! - this.cy[i - 1]!;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const k = (d - CAPE_SEG) / d;
          if (i === 1) {
            this.cx[i] = this.cx[i]! - dx * k;
            this.cy[i] = this.cy[i]! - dy * k;
          } else {
            this.cx[i] = this.cx[i]! - dx * k * 0.5;
            this.cy[i] = this.cy[i]! - dy * k * 0.5;
            this.cx[i - 1] = this.cx[i - 1]! + dx * k * 0.5;
            this.cy[i - 1] = this.cy[i - 1]! + dy * k * 0.5;
          }
        }
        const backX = j.hipX - j.fwX * 6;
        for (let i = 1; i < CAPE_N; i++) {
          const lim = i < 3 ? anX + 1 : backX;
          if (this.cx[i]! > lim) this.cx[i] = lim;
          if (this.cy[i]! > -2) this.cy[i] = -2;
        }
      }
    }
    const k = 160;
    const c = 13;
    const tx = -2 * gust;
    const ty = 1.5 * Math.sin(t * 2.3);
    this.plVX += (k * (tx - this.plX) - c * this.plVX) * dt;
    this.plVY += (k * (ty - this.plY) - c * this.plVY) * dt;
    this.plX += this.plVX * dt;
    this.plY += this.plVY * dt;
    if (this.plX > 10) this.plX = 10;
    if (this.plX < -14) this.plX = -14;
  }

  // ---------------------------------------------------------------- the silhouette path

  /** Emit the whole silhouette (cape + the rig's hero figure) as clockwise subpaths. */
  trace(ctx: CanvasRenderingContext2D): void {
    const j = this.j;
    const p = this.pose;
    ctx.beginPath();
    this.traceCape(ctx);
    // Legs (stroked limbs in the rig: round-capped capsules; tapered armor on a close-up) and boots.
    traceLeg(ctx, j.bHipX, j.bHipY, j.bKnX, j.bKnY, j.bFtX, j.bFtY, this.shape);
    traceLeg(ctx, j.aHipX, j.aHipY, j.aKnX, j.aKnY, j.aFtX, j.aFtY, this.shape);
    traceBoot(ctx, j.aFtX, j.aFtY, j.aKnX, this.shape);
    traceBoot(ctx, j.bFtX, j.bFtY, j.bKnX, this.shape);
    traceSkirt(ctx, j);
    traceTorso(ctx, j);
    traceHelm(ctx, j);
    // Arms, pauldrons, gauntlets.
    capsule(ctx, j.fShX, j.fShY, j.fElX, j.fElY, 4.5);
    capsule(ctx, j.fElX, j.fElY, j.fHX, j.fHY, 4);
    capsule(ctx, j.nShX, j.nShY, j.nElX, j.nElY, 4.5);
    capsule(ctx, j.nElX, j.nElY, j.nHX, j.nHY, 4);
    disc(ctx, j.nShX, j.nShY, 8.5);
    disc(ctx, j.fShX, j.fShY, 8.5);
    disc(ctx, j.nHX, j.nHY, 4.8);
    disc(ctx, j.fHX, j.fHY, 4.8);
    traceSword(ctx, j, p.weapon);
    traceShield(ctx, j, p.shield, SHIELD_SCALE);
  }

  /** The cape (crowd/hero.ts drawCape), emitted in reverse so it winds like everything else. */
  private traceCape(ctx: CanvasRenderingContext2D): void {
    const j = this.j;
    const cx = this.cx;
    const cy = this.cy;
    const n = CAPE_N;
    const lx = cx[n - 1]!;
    const ly = cy[n - 1]!;
    const hx = j.hipX - j.fwX * 5;
    const hy = Math.max(ly - 3, j.hipY + 14);
    ctx.moveTo(j.hipX + j.upX * 22 - j.fwX * 9, j.hipY + j.upY * 22);
    ctx.lineTo(hx, hy);
    ctx.quadraticCurveTo((lx + hx) * 0.5, ly + 3 + 2 * Math.sin(this.now * 6), lx, ly);
    ctx.lineTo((cx[n - 2]! + lx) * 0.5, (cy[n - 2]! + ly) * 0.5);
    for (let i = n - 2; i >= 1; i--) {
      const ex = i > 1 ? (cx[i - 1]! + cx[i]!) * 0.5 : cx[0]!;
      const ey = i > 1 ? (cy[i - 1]! + cy[i]!) * 0.5 : cy[0]!;
      ctx.quadraticCurveTo(cx[i]!, cy[i]!, ex, ey);
    }
    ctx.lineTo(j.neckX + j.fwX * 4, j.neckY + j.fwY * 4 + 2);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- drawing

  private ensureColors(p: Palette): void {
    if (p === this.pal) return;
    this.pal = p;
    this.mid = mixHex(p.rim, p.silhouette, 0.58);
    this.plumeHi = mixHex(p.accent.banner, p.rim, 0.55);
    this.plumeLo = mixHex(p.accent.banner, p.silhouette, 0.45);
  }

  /**
   * Bake one more level of the shield face (call once per frame ahead of need: the rally has
   * frames to spare, the flash does not). Returns true when every level is ready.
   */
  prepareFace(h: Heraldry, p: Palette): boolean {
    if (h !== this.faceHer || p !== this.facePal) {
      this.faceHer = h;
      this.facePal = p;
      this.faceNext = 0;
    }
    if (this.faceNext >= FACE_LEVELS.length) return true;
    const i = this.faceNext++;
    const r = FACE_LEVELS[i]!;
    const w = Math.ceil(2 * FACE_X * r);
    const hh = Math.ceil((FACE_Y1 - FACE_Y0) * r);
    let c = this.faces[i];
    if (!c || c.width !== w || c.height !== hh) {
      c = makeCanvas(w, hh);
      this.faces[i] = c;
    }
    const x = context2d(c);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, w, hh);
    x.setTransform(r, 0, 0, r, FACE_X * r, -FACE_Y0 * r);
    const k = SHIELD_SCALE * 0.9;
    const f = this.fake;
    f.nHX = -2;
    f.nHY = -1;
    shieldPath(x, f, 0, k);
    x.save();
    x.clip();
    drawShieldFace(x, h, 0, 4 * k, 42 * k);
    x.fillStyle = p.silhouette;
    x.globalAlpha = 0.34;
    x.fillRect(-FACE_X, FACE_Y0, 2 * FACE_X, FACE_Y1 - FACE_Y0);
    x.restore();
    return this.faceNext >= FACE_LEVELS.length;
  }

  /** Free the canvases (after the zoom). */
  release(): void {
    for (let i = 0; i < this.faces.length; i++) {
      const c = this.faces[i];
      if (c) {
        c.width = 0;
        c.height = 0;
      }
      this.faces[i] = null;
    }
    this.faceHer = null;
    this.faceNext = 0;
    if (this.buf) {
      this.buf.width = 0;
      this.buf.height = 0;
      this.buf = null;
      this.bctx = null;
    }
  }

  /**
   * Draw the colossus. `tf`: figure units -> device px; `pxu`: device px per figure unit (for the
   * rim width and the level of detail); `detail` 0..1 fades the armor in; `alpha` < 1 composites
   * the whole figure through a buffer (the hand-over), so its layers never show through each other.
   */
  draw(ctx: CanvasRenderingContext2D, tf: FigTransform, pxu: number, dpr: number, p: Palette, h: Heraldry, detail: number, alpha: number): void {
    if (alpha <= 0.002) return;
    if (alpha >= 0.998) {
      this.paint(ctx, tf.a, tf.b, tf.c, tf.d, tf.e, tf.f, pxu, dpr, p, h, detail);
      return;
    }
    // Screen bounds of the figure (device px).
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      const fx = i & 1 ? FIG_X1 : FIG_X0;
      const fy = i & 2 ? FIG_Y1 : FIG_Y0;
      const sx = tf.a * fx + tf.c * fy + tf.e;
      const sy = tf.b * fx + tf.d * fy + tf.f;
      if (sx < x0) x0 = sx;
      if (sy < y0) y0 = sy;
      if (sx > x1) x1 = sx;
      if (sy > y1) y1 = sy;
    }
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    x0 = Math.max(0, Math.floor(x0) - 2);
    y0 = Math.max(0, Math.floor(y0) - 2);
    x1 = Math.min(cw, Math.ceil(x1) + 2);
    y1 = Math.min(ch, Math.ceil(y1) + 2);
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    let b = this.buf;
    if (!b || b.width < bw || b.height < bh) {
      if (b) {
        b.width = 0;
        b.height = 0;
      }
      b = makeCanvas(Math.max(bw, b ? b.width : 0), Math.max(bh, b ? b.height : 0));
      this.buf = b;
      this.bctx = context2d(b);
    }
    const g = this.bctx!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, bw + 2, bh + 2);
    this.paint(g, tf.a, tf.b, tf.c, tf.d, tf.e - x0, tf.f - y0, pxu, dpr, p, h, detail);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(b, 0, 0, bw, bh, x0, y0, bw, bh);
    ctx.restore();
  }

  private paint(ctx: CanvasRenderingContext2D, a: number, b: number, c: number, d: number, e: number, f: number, pxu: number, dpr: number, p: Palette, h: Heraldry, detail: number): void {
    this.ensureColors(p);
    this.shape = detail;
    const lx = p.light.x;
    const ly = p.light.y;
    // The hero's rim (0.95 figure units, at least 1.45 device px), capped on a close-up.
    let rim = 0.95 * pxu;
    const cap = RIM_CAP * dpr;
    if (rim > cap) rim = cap;
    if (rim < 1.45) rim = 1.45;
    ctx.save();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.fillStyle = p.rim;
    this.trace(ctx);
    ctx.fill();
    ctx.clip();
    ctx.setTransform(a, b, c, d, e - lx * rim * 0.5, f - ly * rim * 0.5);
    ctx.fillStyle = this.mid;
    this.trace(ctx);
    ctx.fill();
    ctx.setTransform(a, b, c, d, e - lx * rim * 1.05, f - ly * rim * 1.05);
    ctx.fillStyle = p.silhouette;
    this.trace(ctx);
    ctx.fill();
    ctx.setTransform(a, b, c, d, e, f);
    if (detail > 0.002) this.armor.draw(ctx, this, a, b, c, d, e, f, pxu, dpr, p, h, detail, rim);
    ctx.restore();

    ctx.save();
    ctx.setTransform(a, b, c, d, e, f);
    this.drawGlint(ctx, p);
    this.drawFace(ctx, pxu);
    this.drawPlume(ctx, p);
    ctx.restore();
  }

  /** The visor slit catching the light (crowd/rig.ts drawDetails, hero). */
  private drawGlint(ctx: CanvasRenderingContext2D, p: Palette): void {
    const j = this.j;
    const cs = Math.cos(j.headA);
    const sn = Math.sin(j.headA);
    ctx.strokeStyle = p.rim;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(j.headX + 6 * cs + 4 * sn, j.headY + 6 * sn - 4 * cs);
    ctx.lineTo(j.headX + 14 * cs + 1 * sn, j.headY + 14 * sn - 1 * cs);
    ctx.stroke();
  }

  /** The coat of arms on the shield, from the closest baked level (inset: the shield keeps its rim). */
  private drawFace(ctx: CanvasRenderingContext2D, pxu: number): void {
    let face: HTMLCanvasElement | null = null;
    for (let i = 0; i < FACE_LEVELS.length; i++) {
      const f = this.faces[i];
      if (!f) continue;
      face = f;
      if (FACE_LEVELS[i]! >= pxu * 0.9) break;
    }
    if (!face) return;
    const j = this.j;
    const t = this.pose.shield;
    ctx.translate(j.nHX + 2, j.nHY + 1);
    ctx.rotate(t);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(face, -FACE_X, FACE_Y0, 2 * FACE_X, FACE_Y1 - FACE_Y0);
    ctx.globalAlpha = 1;
    ctx.rotate(-t);
    ctx.translate(-(j.nHX + 2), -(j.nHY + 1));
  }

  /** The plume (crowd/hero.ts drawPlume). */
  private drawPlume(ctx: CanvasRenderingContext2D, pal: Palette): void {
    const j = this.j;
    const t = this.now;
    const cs = Math.cos(j.headA);
    const sn = Math.sin(j.headA);
    const bx = j.headX + -2 * cs - -23 * sn;
    const by = j.headY + -2 * sn + -23 * cs;
    const sx = this.spX;
    const sy = this.spY;
    const ww = this.spW;
    for (let i = 0; i < PLUME_N; i++) {
      const u = i / (PLUME_N - 1);
      const lag = u * u;
      sx[i] = bx + PLUME_X[i]! + this.plX * 1.3 * lag + Math.sin(t * 7.5 - i * 0.9) * 1.1 * u;
      sy[i] = by + PLUME_Y[i]! + this.plY * lag + Math.sin(t * 9.1 - i * 1.3) * 1.3 * u;
      ww[i] = PLUME_W[i]!;
    }
    const nx = this.spNX;
    const ny = this.spNY;
    for (let i = 0; i < PLUME_N; i++) {
      const a = i > 0 ? i - 1 : 0;
      const b = i < PLUME_N - 1 ? i + 1 : PLUME_N - 1;
      let dx = sx[b]! - sx[a]!;
      let dy = sy[b]! - sy[a]!;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= l;
      dy /= l;
      nx[i] = -dy;
      ny[i] = dx;
      if (ny[i]! > 0) {
        nx[i] = -nx[i]!;
        ny[i] = -ny[i]!;
      }
    }
    ctx.fillStyle = pal.accent.banner;
    ctx.beginPath();
    ctx.moveTo(sx[0]! + nx[0]! * ww[0]!, sy[0]! + ny[0]! * ww[0]!);
    for (let i = 1; i < PLUME_N - 1; i++) {
      const x0 = sx[i]! + nx[i]! * ww[i]!;
      const y0 = sy[i]! + ny[i]! * ww[i]!;
      const x1 = sx[i + 1]! + nx[i + 1]! * ww[i + 1]!;
      const y1 = sy[i + 1]! + ny[i + 1]! * ww[i + 1]!;
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) * 0.5, (y0 + y1) * 0.5);
    }
    ctx.lineTo(sx[PLUME_N - 1]!, sy[PLUME_N - 1]!);
    for (let i = PLUME_N - 1; i > 0; i--) {
      const qx = sx[i - 1]! - nx[i - 1]! * ww[i - 1]!;
      const qy = sy[i - 1]! - ny[i - 1]! * ww[i - 1]!;
      const mx = (sx[i]! + sx[i - 1]!) * 0.5 - (nx[i]! + nx[i - 1]!) * 0.5 * ww[i]! * 0.2;
      const my = (sy[i]! + sy[i - 1]!) * 0.5 - (ny[i]! + ny[i - 1]!) * 0.5 * ww[i]! * 0.2;
      ctx.quadraticCurveTo(mx, my, qx, qy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.plumeLo;
    ctx.lineWidth = 1.1;
    for (let f = 0; f < 2; f++) {
      const o = f === 0 ? -0.35 : 0.3;
      ctx.beginPath();
      ctx.moveTo(sx[1]! + nx[1]! * ww[1]! * o, sy[1]! + ny[1]! * ww[1]! * o);
      for (let i = 2; i < PLUME_N - 1; i++) ctx.lineTo(sx[i]! + nx[i]! * ww[i]! * o, sy[i]! + ny[i]! * ww[i]! * o);
      ctx.stroke();
    }
    ctx.strokeStyle = this.plumeHi;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(sx[0]! + nx[0]! * ww[0]! * 0.8, sy[0]! + ny[0]! * ww[0]! * 0.8);
    for (let i = 1; i < PLUME_N - 1; i++) ctx.lineTo(sx[i]! + nx[i]! * ww[i]! * 0.82, sy[i]! + ny[i]! * ww[i]! * 0.82);
    ctx.stroke();
  }

  /** Mid-tone of the rim passes for the current palette (the armor reuses it). */
  get midTone(): string {
    return this.mid;
  }
}
