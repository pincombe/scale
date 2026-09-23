// The wyrm's eye, live (WP 1.12). Drawn on the mountains layer only while it is open; shut, it
// costs nothing (the socket, brow and seam are baked into the layer by wyrm.ts).
//
// The lids are the mountain itself: the eye is revealed through an aperture whose edges are
// shaded like the rock around it, so what parts is the layer's own gradient, texture and haze.
// The eye is rendered into a small buffer at the mountains' bake resolution (DPR 1) and blitted,
// so it is exactly as soft as the rock. Non-emissive parts (pupil, lid shadows) use the layer's
// hazed shade; only the iris glows through the haze, with a soft bloom and warm bounce light on
// the brow's underside and the cheek. Pebbles and dust trickle from the brow as the lids part.
import type { Palette } from '../palette';
import type { EyePose } from './eyeTimeline';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { clamp01, TAU } from '../../lib/math';
import { BROW, CHEEK, curve, EYE_H, EYE_HH, EYE_HW, EYE_SAG, EYE_TILT, EYE_X, faceShadow, paintFace, type FaceColors } from './wyrm';
import { MOUNTAINS, ridgePath } from './ridges';

// Eye-local buffer box (units): covers the opening, the folded lid and a soft margin.
const BX0 = -0.46;
const BX1 = 0.46;
const BY0 = -0.34;
const BY1 = 0.26;
/** Upper and lower lid travel at full aperture (units). */
const LID_UP = EYE_HH * 1.18;
const LID_DOWN = EYE_HH * 0.8;
/** Cubic bezier peak = 0.75 x control offset. */
const K = 1 / 0.75;

// Bounce light canvas box (eye-local units) and resolution.
const LX0 = -0.95;
const LX1 = 1.0;
const LY0 = -0.72;
const LY1 = 0.62;
const LIGHT_PX = 80;
// Face overlay box (layer units): the face surfaces around the eye while it is open.
const FX0 = 1.9;
const FX1 = 5.5;
const FY0 = -4.0;
const FY1 = -1.0;
const FACE_PX = 160;

const DEBRIS = 28;
const IRIS_FIBRES = 22;
const COS = Math.cos(EYE_TILT);
const SIN = Math.sin(EYE_TILT);

export class WyrmEye {
  private buf: HTMLCanvasElement | null = null;
  private bctx: CanvasRenderingContext2D | null = null;
  private k = 0;
  private bw = 0;
  private bh = 0;
  private palette: Palette | null = null;
  private iris: CanvasGradient | null = null;
  private vignette: CanvasGradient | null = null;
  private lidFold: CanvasGradient | null = null;
  private light: HTMLCanvasElement | null = null;
  private face: HTMLCanvasElement | null = null;
  private dust: HTMLCanvasElement | null = null;
  private pupil = '#000';
  private shadow = '#000';
  private lip = '#fff';
  private glint = '#fff';
  private pebbleSprite: HTMLCanvasElement | null = null;
  private streak = '#000';

  // Debris (pebbles kind 0, dust kind 1), layer units.
  private readonly dx = new Float32Array(DEBRIS);
  private readonly dy = new Float32Array(DEBRIS);
  private readonly dvx = new Float32Array(DEBRIS);
  private readonly dvy = new Float32Array(DEBRIS);
  private readonly dAge = new Float32Array(DEBRIS);
  private readonly dLife = new Float32Array(DEBRIS);
  private readonly dSize = new Float32Array(DEBRIS);
  private readonly dKind = new Uint8Array(DEBRIS);
  private live = false;

  /** Palette-derived colors, gradients and the baked bounce light. */
  ensure(pal: Palette, c: FaceColors): void {
    if (this.palette === pal && this.bctx) return;
    this.palette = pal;
    if (!this.buf) {
      this.buf = makeCanvas(2, 2);
      this.bctx = context2d(this.buf);
    }
    const e = this.bctx!;
    this.shadow = faceShadow(pal, c);
    this.pupil = mixHex(this.shadow, pal.haze, 0.18);
    const warm = mixHex('#ffa23a', pal.haze, 0.2);
    this.lip = mixHex(warm, pal.accent.glow, 0.35);
    this.glint = mixHex(pal.accent.glow, pal.haze, 0.3);
    const pebble = mixHex(c.shade, c.crest, 0.4);
    // Emissive iris: pierces the haze, but its rim still leans into it.
    const g = e.createRadialGradient(0, 0, 0, 0, 0, EYE_HW * 1.2);
    g.addColorStop(0, '#fff4c8');
    g.addColorStop(0.14, '#ffdc6e');
    g.addColorStop(0.4, '#ffa22e');
    g.addColorStop(0.7, mixHex('#f0701c', pal.haze, 0.1));
    g.addColorStop(1, mixHex('#c24a1a', pal.haze, 0.25));
    this.iris = g;
    const v = e.createRadialGradient(0, 0, 0, 0, 0, 1);
    v.addColorStop(0, rgba(this.shadow, 0));
    v.addColorStop(0.55, rgba(this.shadow, 0.05));
    v.addColorStop(1, rgba(this.shadow, 0.5));
    this.vignette = v;
    const f = e.createLinearGradient(0, 0, 0, 1);
    f.addColorStop(0, rgba(this.shadow, 0.2));
    f.addColorStop(0.5, rgba(this.shadow, 0.1));
    f.addColorStop(1, rgba(this.shadow, 0.02));
    this.lidFold = f;
    this.light = bakeLight(warm);
    this.face = bakeFace(pal, c);
    this.dust = bakePuff(mixHex(pal.rim, pal.accent.glow, 0.3), 48);
    this.pebbleSprite = bakePuff(pebble, 16);
    this.streak = mixHex('#b8420f', pal.haze, 0.2);
  }

  /** The palette art is baked for `pal` (ensure() ran for it). */
  bakedFor(pal: Palette): boolean {
    return this.palette === pal && this.face !== null;
  }

  /** Buffer resolution: px per unit (match the mountains' bake). */
  private size(k: number): void {
    if (Math.abs(k - this.k) < this.k * 0.01) return;
    this.k = k;
    this.bw = Math.ceil((BX1 - BX0) * k);
    this.bh = Math.ceil((BY1 - BY0) * k);
    const b = this.buf!;
    if (b.width < this.bw || b.height < this.bh) {
      b.width = this.bw;
      b.height = this.bh;
    }
  }

  /** Stones and dust shaken loose from the brow as the lids move (count scales with `amount`). */
  crumble(amount: number): void {
    const n = Math.round(10 * amount);
    const puffs = Math.round(4 * amount);
    for (let i = 0; i < n + puffs; i++) {
      const s = this.free();
      if (s < 0) return;
      const dust = i >= n;
      // Somewhere along the brow's lip (eye-local), then to layer coords.
      const u = Math.random();
      const lx = BROW.x0 + 0.1 + (BROW.x1 - BROW.x0 - 0.35) * u;
      const ly = BROW.y0 + (BROW.y1 - BROW.y0) * u + 0.12 * Math.sin(u * Math.PI) + 0.04;
      this.dx[s] = EYE_X + lx * COS - ly * SIN;
      this.dy[s] = -EYE_H + lx * SIN + ly * COS;
      this.dKind[s] = dust ? 1 : 0;
      this.dAge[s] = 0;
      if (dust) {
        this.dvx[s] = 0.02 + 0.04 * Math.random();
        this.dvy[s] = 0.02 + 0.04 * Math.random();
        this.dLife[s] = 1.8 + 1.2 * Math.random();
        this.dSize[s] = 0.06 + 0.06 * Math.random();
      } else {
        this.dvx[s] = (Math.random() - 0.4) * 0.12;
        this.dvy[s] = Math.random() * 0.1;
        this.dLife[s] = 1.1 + 0.9 * Math.random();
        this.dSize[s] = 0.012 + 0.02 * Math.random() * Math.random();
        // A delay so they trickle rather than drop as one.
        this.dAge[s] = -0.5 * Math.random() * amount;
      }
    }
    this.live = true;
  }

  private free(): number {
    for (let i = 0; i < DEBRIS; i++) if (this.dLife[i]! <= 0) return i;
    return -1;
  }

  /** Advance the falling debris (it finishes falling after the lids shut). */
  update(dt: number, wind: number): void {
    if (dt <= 0) return;
    let any = false;
    for (let i = 0; i < DEBRIS; i++) {
      if (this.dLife[i]! <= 0) continue;
      any = true;
      const a = (this.dAge[i]! += dt);
      if (a < 0) continue;
      if (a >= this.dLife[i]!) {
        this.dLife[i] = 0;
        continue;
      }
      if (this.dKind[i] === 0) {
        this.dvy[i] += 1.5 * dt;
        this.dvx[i] *= 1 - 0.5 * dt;
      } else {
        this.dvx[i] += 0.02 * wind * dt;
        this.dvy[i] *= 1 - 0.6 * dt;
      }
      this.dx[i] += this.dvx[i]! * dt;
      this.dy[i] += this.dvy[i]! * dt;
    }
    this.live = any;
  }

  /** Debris still on screen (the layer keeps drawing it after the lids shut). */
  get busy(): boolean {
    return this.live;
  }

  /**
   * Draw in mountains-layer units (the caller has applied the layer transform). `res` = the
   * mountains' bake resolution (device px per unit); `lx, ly` the unit direction toward the fight.
   */
  draw(ctx: CanvasRenderingContext2D, pose: EyePose, res: number, lx: number, ly: number, glow: HTMLCanvasElement, t: number): void {
    const o = pose.open;
    if (o < 0.003 || !this.bctx) {
      if (this.live && this.dust) this.drawBits(ctx);
      return;
    }
    this.size(res);
    const e = this.bctx;
    const k = this.k;
    e.setTransform(1, 0, 0, 1, 0, 0);
    e.globalCompositeOperation = 'source-over';
    e.globalAlpha = 1;
    e.clearRect(0, 0, this.bw + 1, this.bh + 1);
    e.setTransform(k, 0, 0, k, -BX0 * k, -BY0 * k);
    this.paintEye(e, pose, lx * COS + ly * SIN, -lx * SIN + ly * COS, t);

    const flick = 0.92 + 0.08 * Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1);
    const gl = pose.glow * flick;
    // The face surfaces as it wakes: the carved features, deepened, over the rock.
    ctx.globalAlpha = 0.85 * pose.awake;
    ctx.drawImage(this.face!, FX0, FY0, FX1 - FX0, FY1 - FY0);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(EYE_X, -EYE_H);
    ctx.rotate(EYE_TILT);
    // Warm light spilling out of the socket before the eye itself (it sits under the eye).
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.2 * gl;
    ctx.drawImage(glow, -1.8, -1.3, 3.6, 2.6);
    ctx.globalAlpha = 0.85 * gl;
    ctx.drawImage(this.light!, LX0, LY0, LX1 - LX0, LY1 - LY0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.buf!, 0, 0, this.bw, this.bh, BX0, BY0, this.bw / k, this.bh / k);
    // Tight bloom over the iris (soft, so the edges never read as an outline).
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.34 * gl;
    const h = EYE_HH * (0.6 + 1.6 * o);
    ctx.drawImage(glow, -EYE_HW * 1.25, -h * 1.1, EYE_HW * 2.5, h * 2.2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
    // Stones and dust in front of it all.
    if (this.live) this.drawBits(ctx);
  }

  /** The aperture, iris, pupil and lid shading into the buffer (eye-local units). */
  private paintEye(e: CanvasRenderingContext2D, pose: EyePose, lx: number, ly: number, t: number): void {
    const o = pose.open;
    const up = o * LID_UP;
    const dn = o * LID_DOWN;
    const fade = clamp01(o * 5);
    // The opening.
    e.beginPath();
    upperLid(e, up, true);
    lowerLid(e, dn);
    e.closePath();
    e.save();
    e.clip();
    // Iris, centered on the pupil as it slides to watch the fight.
    const px = lx * pose.look * EYE_HW * 0.42;
    const py = ly * pose.look * EYE_HH * 0.3 + (EYE_SAG - up + dn) * 0.35;
    e.translate(px, py);
    e.fillStyle = this.iris!;
    e.fillRect(-EYE_HW * 2, -EYE_HH * 3, EYE_HW * 4, EYE_HH * 6);
    // Fine radial fibres in the iris.
    e.strokeStyle = this.streak;
    e.lineWidth = 0.012;
    e.globalAlpha = 0.22;
    e.beginPath();
    for (let i = 0; i < IRIS_FIBRES; i++) {
      const a = (i / IRIS_FIBRES) * TAU + 0.3 * Math.sin(i * 2.7);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const r0 = EYE_HW * (0.2 + 0.08 * Math.sin(i * 1.9));
      e.moveTo(c * r0, sn * r0 * 0.9);
      e.lineTo(c * EYE_HW * 1.05, sn * EYE_HW * 0.95);
    }
    e.stroke();
    e.globalAlpha = 1;
    // Slit pupil, hazed like the rock (never black), a touch of breathing.
    // Pointed at both ends (it just touches the lids when wide), with a soft falloff around it.
    const pw = EYE_HW * (0.04 + 0.22 * pose.pupil) * (1 + 0.04 * Math.sin(t * 1.7));
    const ph = EYE_HH * 1.04;
    e.fillStyle = rgba(this.pupil, 0.3);
    e.beginPath();
    e.ellipse(0, 0, pw * 1.45, ph * 1.04, 0, 0, TAU);
    e.fill();
    e.fillStyle = this.pupil;
    e.beginPath();
    e.moveTo(0, -ph);
    e.quadraticCurveTo(pw * 1.3, 0, 0, ph);
    e.quadraticCurveTo(-pw * 1.3, 0, 0, -ph);
    e.fill();
    e.translate(-px, -py);
    // Corners fall into shadow.
    e.save();
    e.scale(EYE_HW * 1.02, EYE_HH * 1.5);
    e.fillStyle = this.vignette!;
    e.fillRect(-1.2, -1.2, 2.4, 2.4);
    e.restore();
    // The upper lid shades the top of the eye (a wide stroke along it, clipped to the opening).
    e.beginPath();
    upperLid(e, up, true);
    // (thinner as the lids close, so a narrow slit still glows)
    const lw = Math.min(1, 0.2 + o * 1.2);
    e.strokeStyle = rgba(this.shadow, 0.3);
    e.lineWidth = 0.1 * lw;
    e.stroke();
    e.strokeStyle = rgba(this.shadow, 0.3);
    e.lineWidth = 0.04 * lw;
    e.stroke();
    // Wet glint of the sky, fixed on the eyeball.
    e.globalAlpha = 0.55 * fade;
    e.fillStyle = this.glint;
    e.beginPath();
    e.ellipse(-EYE_HW * 0.3, EYE_SAG - up * 0.45, EYE_HW * 0.07, EYE_HH * 0.13, -0.35, 0, TAU);
    e.fill();
    e.globalAlpha = 1;
    e.restore();

    // The upper lid, folded back under the brow: a band of shaded rock above the opening.
    const fold = EYE_HH * (0.2 + 0.75 * o);
    e.globalAlpha = fade;
    e.beginPath();
    upperLid(e, up + fold, true);
    upperLid(e, up, false);
    e.closePath();
    e.save();
    e.translate(0, EYE_SAG - up - fold);
    e.scale(1, fold * 1.3);
    e.fillStyle = this.lidFold!;
    e.fill();
    e.restore();
    // The lower lid's rim catches the eye's own light.
    e.globalAlpha = fade * 0.3 * pose.glow;
    e.strokeStyle = this.lip;
    e.lineWidth = 0.014;
    e.beginPath();
    lowerLidOnly(e, dn + 0.01);
    e.stroke();
    // A soft shaded ledge under the lower lid.
    e.globalAlpha = fade * 0.6;
    e.strokeStyle = rgba(this.shadow, 0.14);
    e.lineWidth = 0.06;
    e.beginPath();
    lowerLidOnly(e, dn + 0.045);
    e.stroke();
    e.globalAlpha = 1;
  }

  /** Pebbles and dust (layer units). */
  private drawBits(ctx: CanvasRenderingContext2D): void {
    const dust = this.dust!;
    for (let i = 0; i < DEBRIS; i++) {
      const life = this.dLife[i]!;
      const a = this.dAge[i]!;
      if (life <= 0 || a < 0) continue;
      const f = a / life;
      if (this.dKind[i] === 0) {
        // Soft specks in the hazed shade, as blurred as the rock they fell from.
        ctx.globalAlpha = 0.8 * (1 - f * f);
        const s = this.dSize[i]! * 1.3;
        ctx.drawImage(this.pebbleSprite!, this.dx[i]! - s, this.dy[i]! - s, s * 2, s * 2);
      } else {
        ctx.globalAlpha = 0.42 * Math.sin(Math.PI * Math.sqrt(f));
        const r = this.dSize[i]! * (0.7 + 1.8 * f);
        ctx.drawImage(dust, this.dx[i]! - r, this.dy[i]! - r * 0.7, r * 2, r * 1.4);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Release the buffers and baked art (the tier is off screen); ensure() rebuilds them. */
  dispose(): void {
    for (const c of [this.buf, this.light, this.face, this.dust, this.pebbleSprite]) if (c) c.width = c.height = 0;
    this.buf = this.light = this.face = this.dust = this.pebbleSprite = null;
    this.bctx = null;
    this.palette = null;
    this.k = 0;
    this.dLife.fill(0);
    this.live = false;
  }

  bytes(): number {
    const cv = (c: HTMLCanvasElement | null): number => (c ? c.width * c.height * 4 : 0);
    return cv(this.buf) + cv(this.light) + cv(this.face) + cv(this.dust) + cv(this.pebbleSprite);
  }
}

// ---------------------------------------------------------------- lid curves (eye-local)

/** Upper lid edge, raised `up` above the closed seam; forward = inner -> outer corner. */
function upperLid(e: CanvasRenderingContext2D, up: number, forward: boolean): void {
  const c = EYE_SAG * K - up * K;
  if (forward) {
    e.moveTo(-EYE_HW, 0);
    e.bezierCurveTo(-EYE_HW * 0.42, c, EYE_HW * 0.5, c * 0.96, EYE_HW, 0);
  } else {
    e.lineTo(EYE_HW, 0);
    e.bezierCurveTo(EYE_HW * 0.5, c * 0.96, -EYE_HW * 0.42, c, -EYE_HW, 0);
  }
}

/** Lower lid edge from the outer corner back to the inner (continues the upper lid's path). */
function lowerLid(e: CanvasRenderingContext2D, dn: number): void {
  const c = EYE_SAG * K + dn * K;
  e.bezierCurveTo(EYE_HW * 0.45, c, -EYE_HW * 0.5, c, -EYE_HW, 0);
}

function lowerLidOnly(e: CanvasRenderingContext2D, dn: number): void {
  const c = EYE_SAG * K + dn * K;
  e.moveTo(-EYE_HW * 0.9, c * 0.2);
  e.bezierCurveTo(-EYE_HW * 0.5, c, EYE_HW * 0.45, c, EYE_HW * 0.92, c * 0.15);
}

/** The carved face again, deeper, clipped to the silhouette (drawn over the rock while awake). */
function bakeFace(pal: Palette, c: FaceColors): HTMLCanvasElement {
  const w = Math.ceil((FX1 - FX0) * FACE_PX);
  const h = Math.ceil((FY1 - FY0) * FACE_PX);
  const cv = makeCanvas(w, h);
  const ctx = context2d(cv);
  ctx.setTransform(FACE_PX, 0, 0, FACE_PX, -FX0 * FACE_PX, -FY0 * FACE_PX);
  paintFace(ctx, pal, c, 2);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#000';
  ctx.fill(ridgePath(MOUNTAINS, FX0, FX1, 0.01, 0));
  return cv;
}

/** Soft round puff (dust, pebbles): no hot core, unlike the glow sprite. */
function bakePuff(color: string, size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = context2d(c);
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, rgba(color, 0.9));
  g.addColorStop(0.35, rgba(color, 0.6));
  g.addColorStop(0.7, rgba(color, 0.18));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/**
 * Warm bounce light from the eye, a point light in the socket: the brow's underside (brightest at
 * the lip, fading up into the socket), the socket rim and the cheek's top edge, falling off with
 * distance from the eye, and clipped to the mountain's silhouette.
 */
function bakeLight(warm: string): HTMLCanvasElement {
  const w = Math.ceil((LX1 - LX0) * LIGHT_PX);
  const h = Math.ceil((LY1 - LY0) * LIGHT_PX);
  const c = makeCanvas(w, h);
  const ctx = context2d(c);
  ctx.setTransform(LIGHT_PX, 0, 0, LIGHT_PX, -LX0 * LIGHT_PX, -LY0 * LIGHT_PX);
  const fall = ctx.createRadialGradient(0.02, -0.05, 0, 0.02, -0.05, 0.72);
  fall.addColorStop(0, rgba(warm, 1));
  fall.addColorStop(0.45, rgba(warm, 0.55));
  fall.addColorStop(1, rgba(warm, 0));
  // Socket rim: a soft ring around the opening.
  ctx.save();
  ctx.scale(1, 0.5);
  const r = ctx.createRadialGradient(0, -0.04, 0, 0, -0.04, 0.8);
  r.addColorStop(0, rgba(warm, 0.26));
  r.addColorStop(0.4, rgba(warm, 0.26));
  r.addColorStop(0.75, rgba(warm, 0.08));
  r.addColorStop(1, rgba(warm, 0));
  ctx.fillStyle = r;
  ctx.fillRect(-0.9, -0.9, 1.8, 1.8);
  ctx.restore();
  // The brow's underside.
  ctx.lineCap = 'round';
  ctx.strokeStyle = fall;
  ctx.lineWidth = 0.03;
  for (let i = 0; i < 7; i++) {
    ctx.globalAlpha = 0.3 * (1 - i / 7) ** 1.5;
    ctx.beginPath();
    curve(ctx, BROW, 0, 0.012 + i * 0.02);
    ctx.stroke();
  }
  // Cheek ledge top edge (soft).
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 0.22 * (1 - i / 3);
    ctx.lineWidth = 0.022 + i * 0.025;
    ctx.beginPath();
    curve(ctx, CHEEK, 0, -0.006);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Only the rock catches it: clip to the silhouette (eye-local -> layer units).
  ctx.globalCompositeOperation = 'destination-in';
  ctx.rotate(-EYE_TILT);
  ctx.translate(-EYE_X, EYE_H);
  ctx.fillStyle = '#000';
  ctx.fill(ridgePath(MOUNTAINS, EYE_X - 1.3, EYE_X + 1.3, 0.01, 0));
  return c;
}
