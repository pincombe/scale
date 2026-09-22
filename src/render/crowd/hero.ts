// The hero (you): drawn live every frame from the same rig as the army, so the sword swing is
// perfectly smooth, the cape flows (a verlet chain in the wind), the red plume springs, and the
// shield carries the coat of arms. Rendered into an offscreen buffer with the same rim-light passes
// as the baked knights, then placed in the world. Also owns the bright sword-arc trail.
import { context2d, makeCanvas } from '../atlas';
import { AlphaRamp, mixHex } from '../../lib/color';
import { clamp01 } from '../../lib/math';
import type { Palette } from '../palette';
import type { View } from '../types';
import { KNIGHT_HEIGHT } from '../world';
import { drawEmblem, type Heraldry } from './banner';
import { Joints, Pose, SHIELD_SCALE, bladeLength, copyPose, drawDetails, drawFigure, lerpPose, shieldPath, solve } from './rig';

export const HERO_SCALE = 1.1;
/** Meters per figure unit for the hero. */
const UNIT = (KNIGHT_HEIGHT / 100) * HERO_SCALE;
/** Swing duration (s) and its phases as fractions: windup end, slash end. */
const SWING = 0.36;
// The guard is already cocked, so the windup is a 20 ms snap and the blade lands ~70 ms after the
// click, in step with the sparks and numbers.
const U_WIND = 0.055;
const U_SLASH = 0.2;
/** Largest offscreen buffer side (px). Past it the hero renders at reduced resolution, upscaled. */
const MAX_BUF = 2048;
/** How long the arc lingers after the blade stops (s), and the smear window (s). */
const ARC_LINGER = 0.09;
const ARC_WINDOW = 0.1;
const ARC_SAMPLES = 24;
/** Offscreen bounds in figure units. */
const BX0 = -80;
const BX1 = 100;
const BY0 = -178;
const BY1 = 12;
const CAPE_N = 8;
/** Plume spine (figure units from the helm peak) and half-widths: rises, curls back, droops. */
const PLUME_N = 7;
// Rooted in the bascinet's peak, then trailing back and down past the nape.
const PLUME_X = [1, -5, -12, -19, -25, -30, -33];
const PLUME_Y = [4, -2, -4, -1, 5, 13, 22];
const PLUME_W = [3.5, 6, 6.8, 6.2, 5, 3.2, 0.8];
const CAPE_SEG = 7.4;

const enum Mode {
  Idle,
  Brace,
}

function smooth(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}
function outCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

function P(o: Partial<Pose>): Pose {
  return Object.assign(new Pose(), o);
}

// Guard: sword cocked high over the shoulder, ready to fall.
const GUARD = P({ hipX: 0, hipY: -47, lean: 0.05, head: 0.0, aFootX: 11, bFootX: -10, nHandX: 12, nHandY: -62, shield: 0.06, fHandX: 3, fHandY: -70, weapon: -1.85 });
const BRACE = P({ hipX: -3, hipY: -39, lean: 0.42, head: 0.22, aFootX: 17, bFootX: -14, nHandX: 22, nHandY: -60, shield: -0.16, fHandX: -2, fHandY: -50, weapon: 2.2 });
const CHEER = P({ hipX: 0, hipY: -47, lean: -0.06, head: -0.3, aFootX: 9, bFootX: -8, nHandX: 6, nHandY: -66, shield: -0.2, fHandX: 8, fHandY: -114, weapon: -1.57 });
// Forehand: cock the sword high behind the helm, smash it down and forward.
const FORE_WIND = P({ hipX: -2, hipY: -47, lean: -0.08, head: -0.08, aFootX: 13, bFootX: -10, nHandX: 13, nHandY: -64, shield: 0.06, fHandX: -4, fHandY: -92, weapon: -2.6 });
const FORE_HIT = P({ hipX: 8, hipY: -43, lean: 0.38, head: 0.12, aFootX: 23, bFootX: -9, nHandX: 6, nHandY: -60, shield: 0.3, fHandX: 28, fHandY: -56, weapon: 0.3 });
// Against a tiny dragon: a short downward chop that ends on its nose instead of sailing past it.
const FORE_HIT_LOW = P({ hipX: 4, hipY: -41, lean: 0.42, head: 0.3, aFootX: 17, bFootX: -10, nHandX: 5, nHandY: -58, shield: 0.3, fHandX: 18, fHandY: -48, weapon: 1.12 });
// Backhand (quick follow-up click): drop the blade low, rip it up and over.
const BACK_WIND = P({ hipX: 4, hipY: -44, lean: 0.25, head: 0.08, aFootX: 19, bFootX: -9, nHandX: 8, nHandY: -60, shield: 0.2, fHandX: 20, fHandY: -46, weapon: 0.9 });
const BACK_HIT = P({ hipX: 3, hipY: -47, lean: -0.1, head: -0.2, aFootX: 17, bFootX: -10, nHandX: 12, nHandY: -64, shield: 0.0, fHandX: 12, fHandY: -96, weapon: -2.3 });

export class Hero {
  /** World placement (m): x is the formation anchor; the lunge is added on top. */
  x = -0.95;
  y = 0.12;
  private strikeT0 = -100;
  private pendingStrike = -1;
  private dir = 1;
  /** Pose at the moment the current swing started (so chained swings never pop). */
  private readonly from = new Pose();
  private lungeFrom = 0;
  /** Swing scaled to the dragon: lunge length factor and the forehand's end pose. */
  /** Forehand lunge (m): a dash just long enough for the blade tip to reach the dragon's front. */
  private lungeM = 0.32;
  private targetSize = -1;
  private readonly foreHit = copyPose(new Pose(), FORE_HIT);
  private cheerT0 = -100;
  private mode = Mode.Idle;
  private braceW = 0;
  private now = 0;

  private readonly pose = new Pose();
  private readonly tmp = new Pose();
  private readonly j = new Joints();
  private readonly aj = new Joints();
  readonly restTipX: number;

  // Cape verlet chain (figure units, in a frame that includes the root's world motion).
  private readonly cx = new Float32Array(CAPE_N);
  private readonly cy = new Float32Array(CAPE_N);
  private readonly px = new Float32Array(CAPE_N);
  private readonly py = new Float32Array(CAPE_N);
  private capeInit = false;
  // Plume spring (figure units).
  private plX = 0;
  private plY = 0;
  private plVX = 0;
  private plVY = 0;
  private lastRootX = 0;
  private lastRootY = 0;
  private rootVX = 0;

  private buf: HTMLCanvasElement | null = null;
  private bctx: CanvasRenderingContext2D | null = null;
  private shieldFace: HTMLCanvasElement | null = null;
  private artPal: Palette | null = null;
  private artHer: Heraldry | null = null;
  private bufSmallT = 0;
  private mid = '#888';
  private plumeHi = '#f88';
  private plumeLo = '#800';
  private arcBand: AlphaRamp | null = null;
  private arcEdge: AlphaRamp | null = null;

  constructor() {
    solve(GUARD, this.j);
    // The front of the guard (m from the root): the sword is cocked back over the shoulder, so the
    // shield rim or the blade tip, whichever is further forward. The dragon aims fire and tail here.
    const tip = this.j.fHX + Math.cos(GUARD.weapon) * (5 + bladeLength('hero'));
    const shield = this.j.nHX + 2 + 12 * SHIELD_SCALE;
    this.restTipX = Math.max(tip, shield) * UNIT;
  }

  /**
   * Fit the swing to the dragon's size (m): against small dragons the lunge is short and the blow
   * chops down onto the dragon, so neither the hero nor his arc covers it.
   */
  setTarget(size: number, standOff: number): void {
    if (size === this.targetSize) return;
    this.targetSize = size;
    const r = Math.min(1, Math.max(0, (size - 0.4) / 1.8));
    lerpPose(this.foreHit, FORE_HIT_LOW, FORE_HIT, r);
    const j = solve(this.foreHit, this.aj);
    const reach = (j.fHX + Math.cos(this.foreHit.weapon) * (5 + bladeLength('hero'))) * UNIT;
    this.lungeM = Math.min(1, Math.max(0.08, standOff - reach + 0.08));
  }

  /** A click landed: swing (alternating forehand / backhand when clicks come fast). */
  strike(now: number): void {
    const since = now - this.strikeT0;
    if (since < SWING * U_SLASH) {
      // Mid-smear: let this blow land, then chain the next one immediately.
      this.pendingStrike = this.strikeT0 + SWING * U_SLASH;
      return;
    }
    this.start(now);
  }

  private start(now: number): void {
    const since = now - this.strikeT0;
    this.dir = since < SWING + 0.3 ? -this.dir : 1;
    this.poseAt(now, this.from);
    this.lungeFrom = this.lunge(now);
    this.strikeT0 = now;
    this.pendingStrike = -1;
  }

  cheer(at: number): void {
    this.cheerT0 = at;
  }

  brace(on: boolean): void {
    this.mode = on ? Mode.Brace : Mode.Idle;
  }

  snap(): void {
    this.strikeT0 = -100;
    this.pendingStrike = -1;
    this.cheerT0 = -100;
    this.mode = Mode.Idle;
    this.braceW = 0;
    this.capeInit = false;
  }

  /** World lunge (m) at time t. */
  private lunge(t: number): number {
    const u = (t - this.strikeT0) / SWING;
    if (u <= 0 || u >= 1) return 0;
    const k = this.dir > 0 ? this.lungeM : this.lungeM * 0.6;
    return u < U_SLASH ? this.lungeFrom + (k - this.lungeFrom) * smooth(u / U_SLASH) : k * (1 - smooth((u - U_SLASH) / (1 - U_SLASH)));
  }

  /** Hop height (m, negative = up) while cheering. */
  private hop(t: number): number {
    const c = t - this.cheerT0;
    if (c < 0 || c > 1.5) return 0;
    const ph = (c % 0.5) / 0.5;
    return -0.24 * Math.sin(Math.PI * ph) * (1 - c / 1.8);
  }

  /** The base pose (idle / brace / cheer blend) at time t, without the swing. */
  private basePose(t: number, out: Pose): Pose {
    copyPose(out, GUARD);
    const br = Math.sin(t * 2.1);
    out.hipY += 0.7 * br;
    out.hipX += 0.8 * Math.sin(t * 0.47);
    out.nHandY += 0.5 * br;
    out.fHandY += 0.8 * Math.sin(t * 2.1 + 0.5);
    out.weapon += 0.035 * Math.sin(t * 1.1);
    if (this.braceW > 0.001) lerpPose(out, out, BRACE, this.braceW);
    const c = t - this.cheerT0;
    if (c > 0 && c < 1.8) {
      const w = smooth(c / 0.18) * (1 - smooth((c - 1.4) / 0.4));
      lerpPose(out, out, CHEER, w);
    }
    return out;
  }

  /** Full pose at time t (base + swing). */
  poseAt(t: number, out: Pose): Pose {
    this.basePose(t, this.tmp);
    const u = (t - this.strikeT0) / SWING;
    if (u <= 0 || u >= 1) return copyPose(out, this.tmp);
    const wind = this.dir > 0 ? FORE_WIND : BACK_WIND;
    const hit = this.dir > 0 ? this.foreHit : BACK_HIT;
    if (u < U_WIND) return lerpPose(out, this.from, wind, smooth(u / U_WIND));
    if (u < U_SLASH) return lerpPose(out, wind, hit, outCubic((u - U_WIND) / (U_SLASH - U_WIND)));
    return lerpPose(out, hit, this.tmp, smooth((u - U_SLASH) / (1 - U_SLASH)));
  }

  /** Chest point in world meters. */
  chest(out: { x: number; y: number }): void {
    const j = this.j;
    out.x = this.rootX() + (j.hipX + j.upX * 20) * UNIT;
    out.y = this.rootY() + (j.hipY + j.upY * 20) * UNIT;
  }

  rootX(): number {
    return this.x + this.lunge(this.now);
  }
  rootY(): number {
    return this.y + this.hop(this.now);
  }

  update(dt: number, now: number, realDt: number): void {
    this.now = now;
    if (this.pendingStrike >= 0 && now >= this.pendingStrike) this.start(now);
    // Hit-stop / pause freezes the clock right after a click: freeze the hero AT contact (blade
    // through the target, smear drawn), never in the windup.
    if (dt === 0 && realDt > 0) {
      const u = (now - this.strikeT0) / SWING;
      if (u >= 0 && u < U_SLASH) this.strikeT0 = now - SWING * U_SLASH;
    }
    const target = this.mode === Mode.Brace ? 1 : 0;
    this.braceW += (target - this.braceW) * (1 - Math.exp(-12 * dt));
    this.poseAt(now, this.pose);
    solve(this.pose, this.j);
    if (dt > 0) this.simulate(Math.min(dt, 1 / 30), now);
  }

  private simulate(dt: number, t: number): void {
    const j = this.j;
    const rx = this.rootX() / UNIT;
    const ry = this.rootY() / UNIT;
    const vx = (rx - this.lastRootX) / dt;
    const ax = (vx - this.rootVX) / dt;
    this.rootVX = vx;
    this.lastRootX = rx;
    this.lastRootY = ry;
    // Cape anchor: the back of the neck.
    const anX = rx + j.neckX - j.fwX * 7 + j.upX * -2;
    const anY = ry + j.neckY - j.fwY * 7 + j.upY * -2;
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
        const nx = cx + (cx - this.px[i]!) * 0.97 + (windX) * h * h;
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
        // Keep the cape behind the body and above the ground.
        const backX = rx + j.hipX - j.fwX * 6;
        for (let i = 1; i < CAPE_N; i++) {
          const lim = i < 3 ? anX + 1 : backX;
          if (this.cx[i]! > lim) this.cx[i] = lim;
          if (this.cy[i]! > ry - 2) this.cy[i] = ry - 2;
        }
      }
    }
    // Plume spring: lags the lunge, flutters in the wind.
    const k = 160;
    const c = 13;
    const tx = -ax * 0.0035 - 2 * gust;
    const ty = 1.5 * Math.sin(t * 2.3);
    this.plVX += (k * (tx - this.plX) - c * this.plVX) * dt;
    this.plVY += (k * (ty - this.plY) - c * this.plVY) * dt;
    this.plX += this.plVX * dt;
    this.plY += this.plVY * dt;
    if (this.plX > 10) this.plX = 10;
    if (this.plX < -14) this.plX = -14;
  }

  private ensureArt(p: Palette, h: Heraldry): void {
    if (p === this.artPal && h === this.artHer) return;
    if (p !== this.artPal) {
      this.mid = mixHex(p.rim, p.silhouette, 0.58);
      this.plumeHi = mixHex(p.accent.banner, p.rim, 0.55);
      this.plumeLo = mixHex(p.accent.banner, p.silhouette, 0.45);
      this.arcBand = new AlphaRamp(p.accent.glow);
      this.arcEdge = new AlphaRamp('#ffffff');
    }
    this.artPal = p;
    this.artHer = h;
    // Shield face: the coat of arms in the kite, turned away from the sun (so in shade).
    const s = 4;
    const c = makeCanvas(30 * s, 54 * s);
    const x = context2d(c);
    x.setTransform(s, 0, 0, s, 15 * s, 23 * s);
    const jj = this.aj;
    jj.nHX = -2;
    jj.nHY = -1;
    shieldPath(x, jj, 0, SHIELD_SCALE * 0.9);
    x.save();
    x.clip();
    x.setTransform(1, 0, 0, 1, 0, 0);
    drawEmblem(x, h, c.width, c.height);
    x.fillStyle = p.silhouette;
    x.globalAlpha = 0.34;
    x.fillRect(0, 0, c.width, c.height);
    x.globalAlpha = 1;
    x.restore();
    this.shieldFace = c;
  }

  private drawCape(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    const j = this.j;
    const cx = this.cx;
    const cy = this.cy;
    ctx.beginPath();
    ctx.moveTo(j.neckX + j.fwX * 4, j.neckY + j.fwY * 4 + 2);
    ctx.lineTo(cx[0]! - ox, cy[0]! - oy);
    // Smooth outer edge through the chain midpoints.
    for (let i = 1; i < CAPE_N - 1; i++) {
      const x0 = cx[i]! - ox;
      const y0 = cy[i]! - oy;
      ctx.quadraticCurveTo(x0, y0, (x0 + cx[i + 1]! - ox) * 0.5, (y0 + cy[i + 1]! - oy) * 0.5);
    }
    const lx = cx[CAPE_N - 1]! - ox;
    const ly = cy[CAPE_N - 1]! - oy;
    ctx.lineTo(lx, ly);
    // Hem: a shallow wave back toward the legs.
    const hx = j.hipX - j.fwX * 5;
    const hy = Math.max(ly - 3, j.hipY + 14);
    ctx.quadraticCurveTo((lx + hx) * 0.5, ly + 3 + 2 * Math.sin(this.now * 6), hx, hy);
    ctx.lineTo(j.hipX + j.upX * 22 - j.fwX * 9, j.hipY + j.upY * 22);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * A proper plume: one full, curling crest of feathers springing from the bascinet's peak and
   * streaming back in the wind. Scalloped underside (the feather tips), sunlit top edge.
   */
  private drawPlume(ctx: CanvasRenderingContext2D, t: number): void {
    const j = this.j;
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
      sx[i] = bx + PLUME_X[i]! + (this.plX * 1.3) * lag + Math.sin(t * 7.5 - i * 0.9) * 1.1 * u;
      sy[i] = by + PLUME_Y[i]! + this.plY * lag + Math.sin(t * 9.1 - i * 1.3) * 1.3 * u;
      ww[i] = PLUME_W[i]!;
    }
    // Normals pointing "up" (outside of the curl).
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
    // Body: smooth top edge out to the tip, scalloped underside back to the root.
    ctx.fillStyle = this.plumeFill;
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
      // Pull the control toward the spine: each segment dips in, leaving a feather tip at each point.
      const mx = (sx[i]! + sx[i - 1]!) * 0.5 - (nx[i]! + nx[i - 1]!) * 0.5 * ww[i]! * 0.2;
      const my = (sy[i]! + sy[i - 1]!) * 0.5 - (ny[i]! + ny[i - 1]!) * 0.5 * ww[i]! * 0.2;
      ctx.quadraticCurveTo(mx, my, qx, qy);
    }
    ctx.closePath();
    ctx.fill();
    // Feather separations (shade) and the sunlit crest.
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
  private readonly spX = new Float32Array(PLUME_N);
  private readonly spY = new Float32Array(PLUME_N);
  private readonly spW = new Float32Array(PLUME_N);
  private readonly spNX = new Float32Array(PLUME_N);
  private readonly spNY = new Float32Array(PLUME_N);
  private plumeFill = '#b3202a';

  private pass(b: CanvasRenderingContext2D, color: string, off: number, pxu: number, e0: number, f0: number, lx: number, ly: number, ox: number, oy: number, minW: number): void {
    b.fillStyle = color;
    b.strokeStyle = color;
    b.setTransform(pxu, 0, 0, pxu, e0 - lx * off * pxu, f0 - ly * off * pxu);
    this.drawCape(b, ox, oy);
    drawFigure(b, 'hero', this.pose, this.j, minW);
  }

  /** Draw the hero (and the sword arc) through the view's camera. */
  draw(ctx: CanvasRenderingContext2D, v: View, h: Heraldry): void {
    const p = v.palette;
    this.ensureArt(p, h);
    this.plumeFill = p.accent.banner;
    const cam = v.camera;
    const dpr = v.dpr;
    const pad = 2;
    // Render scale (device px per figure unit), capped so the buffer never exceeds MAX_BUF: a
    // hero bigger than that (M2 close-ups) is upscaled a little rather than vanishing.
    let pxu = cam.zoomEff * dpr * UNIT;
    const big = Math.max(BX1 - BX0, BY1 - BY0) * pxu + pad * 2;
    if (big > MAX_BUF) pxu *= MAX_BUF / big;
    const bw = Math.ceil((BX1 - BX0) * pxu + pad * 2);
    const bh = Math.ceil((BY1 - BY0) * pxu + pad * 2);
    if (bw < 2) return;
    const buf = this.buf;
    if (!buf || buf.width < bw || buf.height < bh) {
      this.buf = makeCanvas(Math.max(bw, buf?.width ?? 0), Math.max(bh, buf?.height ?? 0));
      this.bctx = context2d(this.buf);
      this.bufSmallT = 0;
    } else if (buf.width * buf.height > 2.5 * bw * bh) {
      // Shrink after the camera has pulled back for a while (don't thrash on zoom punches).
      if (this.bufSmallT === 0) this.bufSmallT = v.realTime;
      else if (v.realTime - this.bufSmallT > 2) {
        buf.width = 0;
        buf.height = 0;
        this.buf = makeCanvas(bw, bh);
        this.bctx = context2d(this.buf);
        this.bufSmallT = 0;
      }
    } else this.bufSmallT = 0;
    const b = this.bctx!;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, bw + 1, bh + 1);
    const e0 = pad - BX0 * pxu;
    const f0 = pad - BY0 * pxu;
    const rimU = Math.max(0.95, 1.45 / pxu);
    const minW = 1.25 / pxu;
    const lx = p.light.x;
    const ly = p.light.y;
    const ox = this.rootX() / UNIT;
    const oy = this.rootY() / UNIT;
    this.pass(b, p.rim, 0, pxu, e0, f0, lx, ly, ox, oy, minW);
    b.globalCompositeOperation = 'source-atop';
    this.pass(b, this.mid, rimU * 0.5, pxu, e0, f0, lx, ly, ox, oy, minW);
    this.pass(b, p.silhouette, rimU * 1.05, pxu, e0, f0, lx, ly, ox, oy, minW);
    b.setTransform(pxu, 0, 0, pxu, e0, f0);
    drawDetails(b, 'hero', this.j, p.rim);
    // Coat of arms on the shield (inset so the shield keeps its rim).
    if (this.shieldFace) {
      const j = this.j;
      const tilt = this.pose.shield;
      const cs = Math.cos(tilt);
      const sn = Math.sin(tilt);
      b.setTransform(pxu * cs, pxu * sn, -pxu * sn, pxu * cs, e0 + (j.nHX + 2) * pxu, f0 + (j.nHY + 1) * pxu);
      b.globalAlpha = 0.95;
      b.drawImage(this.shieldFace, -15, -23, 30, 54);
      b.globalAlpha = 1;
    }
    b.globalCompositeOperation = 'source-over';
    b.setTransform(pxu, 0, 0, pxu, e0, f0);
    this.drawPlume(b, this.now);

    // Place the buffer: figure units -> world -> device.
    const wx = this.rootX();
    const wy = this.rootY();
    const A = cam.a * dpr;
    const B = cam.b * dpr;
    const C = cam.c * dpr;
    const D = cam.d * dpr;
    const E = cam.e * dpr + A * wx + C * wy;
    const F = cam.f * dpr + B * wx + D * wy;
    const k = UNIT;
    ctx.setTransform(A * k, B * k, C * k, D * k, E, F);
    ctx.drawImage(this.buf!, 0, 0, bw, bh, BX0 - pad / pxu, BY0 - pad / pxu, bw / pxu, bh / pxu);
    this.drawArc(ctx);
  }

  /** The sword smear: a crescent swept by the blade over the last ~0.1 s, additive. */
  private drawArc(ctx: CanvasRenderingContext2D): void {
    const t = this.now;
    const s0 = this.strikeT0 + SWING * U_WIND;
    const s1 = this.strikeT0 + SWING * U_SLASH;
    if (t < s0 || t > s1 + ARC_LINGER) return;
    const fade = t > s1 ? 1 - (t - s1) / ARC_LINGER : 1;
    const band = this.arcBand!;
    const edge = this.arcEdge!;
    const L = 5 + bladeLength('hero');
    ctx.globalCompositeOperation = 'lighter';
    // Butt caps: round caps would stack into beads where additive segments overlap.
    ctx.lineCap = 'butt';
    const tx = this.arcTX;
    const ty = this.arcTY;
    const ix = this.arcIX;
    const iy = this.arcIY;
    const mx = this.arcMX;
    const my = this.arcMY;
    let n = 0;
    const cur = this.lunge(t);
    for (let i = ARC_SAMPLES; i >= 0; i--) {
      let ts = t - (i / ARC_SAMPLES) * ARC_WINDOW;
      if (ts < s0) continue;
      if (ts > s1) ts = s1;
      this.poseAt(ts, this.tmp);
      const j = solve(this.tmp, this.aj);
      const dx = Math.cos(this.tmp.weapon);
      const dy = Math.sin(this.tmp.weapon);
      // Relative to the current root: the lunge carries the whole smear with the hero.
      const shift = (this.lunge(ts) - cur) / UNIT;
      tx[n] = j.fHX + dx * L * 1.05 + shift;
      ty[n] = j.fHY + dy * L * 1.05;
      mx[n] = j.fHX + dx * L * 0.86 + shift;
      my[n] = j.fHY + dy * L * 0.86;
      ix[n] = j.fHX + dx * L * 0.55 + shift;
      iy[n] = j.fHY + dy * L * 0.55;
      n++;
    }
    for (let i = 1; i < n; i++) {
      const a = (i / (n - 1)) * fade;
      const a2 = a * a;
      // Soft body of the smear.
      ctx.fillStyle = band.at(0.3 * a2);
      ctx.beginPath();
      ctx.moveTo(ix[i - 1]!, iy[i - 1]!);
      ctx.lineTo(tx[i - 1]!, ty[i - 1]!);
      ctx.lineTo(tx[i]!, ty[i]!);
      ctx.lineTo(ix[i]!, iy[i]!);
      ctx.closePath();
      ctx.fill();
      // A warm inner streak and the white-hot cutting edge.
      ctx.strokeStyle = band.at(0.5 * a2);
      ctx.lineWidth = 1 + 2.2 * a;
      ctx.beginPath();
      ctx.moveTo(mx[i - 1]!, my[i - 1]!);
      ctx.lineTo(mx[i]!, my[i]!);
      ctx.stroke();
      ctx.strokeStyle = edge.at(0.95 * a);
      ctx.lineWidth = 1.2 + 3.2 * a;
      ctx.beginPath();
      ctx.moveTo(tx[i - 1]!, ty[i - 1]!);
      ctx.lineTo(tx[i]!, ty[i]!);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  private readonly arcTX = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcTY = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcMX = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcMY = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcIX = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcIY = new Float32Array(ARC_SAMPLES + 1);
}
