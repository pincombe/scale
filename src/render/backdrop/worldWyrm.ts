// The world wyrm (WP 2.3): the Mountain's "eye in the hills" and the zoom reveal's star. Its head
// rests behind the saddle at the end of the range, snout toward the fight, only the brow, the
// snow-capped skull and the horns showing over the ridge: crags, until the eye opens. Posed by
// the zoom (rise, eye, jaw) or by its own idle schedule (wyrmSchedule.ts).
//
// The head and the lower jaw are baked sprites (vector, painted like the range at the range's
// resolution: same haze, same snow, same rim, so it is the mountain), transformed per frame. The
// neck is a live path from the skull down behind the saddle, carrying the range's dorsal plates.
// The eye is rendered into a small buffer at the head's resolution and blitted, glowing through
// the haze (never a sticker). Mist puffs (breath, the roar's plume, snow shaken off the skull) and
// avalanches down the plates on a roar are small fixed pools.
//
// Coordinates: spine-layer units (x right, y down; the caller applies the spine's transform).
// Head-local units are the same scale, origin at the back of the skull (the rise pivot).
import type { Palette } from '../palette';
import type { WyrmPose } from './api';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { clamp01, hash2f, smoothstep, TAU } from '../../lib/math';
import { brushTexture, toneColor } from './ridges';
import { SPINE, SPINE_PLATES, spineHeight, type Plate } from './mountainRidges';

// ---------------------------------------------------------------- placement

/** Head origin at rest (layer x, height above the ground line) and reared, and the tilt. */
export const REST_X = 3.8;
export const REST_H = 0.84;
const REAR_X = 3.38;
const REAR_H = 3.35;
const REST_A = 0.05;
const REAR_A = -0.1;
/** Extra tilt (head thrown back) at a full roar, and the jaw's opening angle. */
const ROAR_TILT = 0.2;
const JAW_OPEN = 0.52;

// ---------------------------------------------------------------- head-local geometry

/** Skull and upper jaw outline (closed, smoothed), snout to the left. */
const SKULL = [
  0.12, 0.3, 0.42, -0.08, 0.46, -0.44, 0.26, -0.72, -0.2, -0.86, -0.68, -0.88, -1.0, -0.87, -1.22, -0.93, -1.4, -0.8, -1.52, -0.63,
  -1.9, -0.55, -2.4, -0.48, -2.68, -0.49, -2.88, -0.41, -3.05, -0.27, -3.13, -0.08, -3.1, 0.07, -2.98, 0.14, -2.6, 0.13, -2.0,
  0.12, -1.4, 0.1, -0.9, 0.09, -0.62, 0.14, -0.36, 0.23,
];
/** Lower jaw outline (closed, smoothed); pivots about HINGE. */
const JAW = [
  -0.42, 0.1, -1.2, 0.15, -2.0, 0.16, -2.62, 0.17, -2.9, 0.21, -2.9, 0.32, -2.72, 0.42, -2.0, 0.46, -1.2, 0.52, -0.38, 0.57, 0.08, 0.46,
  0.06, 0.26,
];
const HINGE_X = -0.5;
const HINGE_Y = 0.12;
/** Tapered horns and spikes: root x, y, control x, y, tip x, y, root half-width. */
const HORNS: readonly (readonly number[])[] = [
  [-0.5, -0.8, -0.05, -1.38, 0.95, -1.42, 0.21],
  [0.02, -0.56, 0.42, -0.9, 1.08, -0.82, 0.13],
  [0.36, -0.3, 0.66, -0.3, 0.92, -0.2, 0.08],
  [0.38, 0.02, 0.62, 0.08, 0.8, 0.2, 0.07],
  [-1.2, -0.88, -1.22, -1.0, -1.12, -1.1, 0.06],
  [-2.58, -0.49, -2.6, -0.58, -2.52, -0.66, 0.045],
];
/** Upper fangs (x, length) hanging from the lip, and lower fangs rising from the jaw. */
const FANGS_UP: readonly (readonly [number, number])[] = [
  [-2.86, 0.15],
  [-2.5, 0.08],
  [-2.16, 0.07],
  [-1.78, 0.06],
];
const FANGS_DOWN: readonly (readonly [number, number])[] = [
  [-2.74, 0.12],
  [-2.32, 0.07],
  [-1.9, 0.06],
];
/** Jaw spikes along the jawline (root x, y, tip x, y, half-width). */
const JAW_SPIKES: readonly (readonly number[])[] = [
  [-0.3, 0.55, 0.36, 0.74, 0.07],
  [-0.85, 0.5, -0.35, 0.7, 0.055],
  [-1.4, 0.49, -1.0, 0.64, 0.04],
];
/** The eye (head-local), its half extents and tilt; the nostril; the mouth's front corner. */
export const EYE_LX = -1.13;
export const EYE_LY = -0.6;
const EYE_HW = 0.165;
const EYE_HH = 0.068;
const EYE_TILT = -0.12;
const NOSTRIL_X = -2.8;
const NOSTRIL_Y = -0.36;
const MOUTH_X = -2.95;
const MOUTH_Y = 0.13;

/** Sprite boxes (head-local units). */
const HX0 = -3.3;
const HX1 = 1.35;
const HY0 = -2.05;
const HY1 = 0.62;
const JX0 = -3.05;
const JX1 = 0.9;
const JY0 = 0.0;
const JY1 = 0.82;
/** Eye buffer box (eye-local) and the bounce-light box. */
const EX0 = -0.24;
const EX1 = 0.24;
const EY0 = -0.18;
const EY1 = 0.14;
const LX0 = -0.95;
const LX1 = 0.85;
const LY0 = -0.6;
const LY1 = 0.55;

/** Light on the head: the afterglow is low on its left (unit vector toward it, head-local). */
const HLX = -0.8;
const HLY = -0.6;

// ---------------------------------------------------------------- path helpers

type Pather = CanvasRenderingContext2D | Path2D;

/** Closed Catmull-Rom curve through flat [x, y, ...] points. */
function smoothClosed(p: Pather, pts: readonly number[], dx = 0, dy = 0): void {
  const n = pts.length / 2;
  const X = (i: number): number => pts[((i + n) % n) * 2]! + dx;
  const Y = (i: number): number => pts[((i + n) % n) * 2 + 1]! + dy;
  p.moveTo(X(0), Y(0));
  for (let i = 0; i < n; i++) {
    const c1x = X(i) + (X(i + 1) - X(i - 1)) / 6;
    const c1y = Y(i) + (Y(i + 1) - Y(i - 1)) / 6;
    const c2x = X(i + 1) - (X(i + 2) - X(i)) / 6;
    const c2y = Y(i + 1) - (Y(i + 2) - Y(i)) / 6;
    p.bezierCurveTo(c1x, c1y, c2x, c2y, X(i + 1), Y(i + 1));
  }
  p.closePath();
}

/** A tapered, curved horn along a quadratic centerline. */
function horn(p: Pather, h: readonly number[], dx = 0, dy = 0): void {
  const [rx, ry, cx, cy, tx, ty, w] = h as [number, number, number, number, number, number, number];
  const N = 14;
  const L: number[] = [];
  const R: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u * u * rx + 2 * u * t * cx + t * t * tx;
    const y = u * u * ry + 2 * u * t * cy + t * t * ty;
    const gx = 2 * u * (cx - rx) + 2 * t * (tx - cx);
    const gy = 2 * u * (cy - ry) + 2 * t * (ty - cy);
    const gl = Math.hypot(gx, gy) || 1;
    const hw = w * Math.pow(1 - t, 0.85);
    L.push(x - (gy / gl) * hw + dx, y + (gx / gl) * hw + dy);
    R.push(x + (gy / gl) * hw + dx, y - (gx / gl) * hw + dy);
  }
  p.moveTo(L[0]!, L[1]!);
  for (let i = 1; i <= N; i++) p.lineTo(L[i * 2]!, L[i * 2 + 1]!);
  for (let i = N; i >= 0; i--) p.lineTo(R[i * 2]!, R[i * 2 + 1]!);
  p.closePath();
}

function fang(p: Pather, x: number, y: number, len: number, dir: number, dx = 0, dy = 0): void {
  const w = len * 0.32;
  p.moveTo(x - w + dx, y + dy);
  p.quadraticCurveTo(x - w * 0.2 + dx, y + dir * len * 0.6 + dy, x + w * 0.35 + dx, y + dir * len + dy);
  p.quadraticCurveTo(x + w * 0.5 + dx, y + dir * len * 0.4 + dy, x + w + dx, y + dy);
  p.closePath();
}

function spike(p: Pather, s: readonly number[], dx = 0, dy = 0): void {
  const [rx, ry, tx, ty, w] = s as [number, number, number, number, number];
  const gx = tx - rx;
  const gy = ty - ry;
  const gl = Math.hypot(gx, gy) || 1;
  const nx = (-gy / gl) * w;
  const ny = (gx / gl) * w;
  p.moveTo(rx + nx + dx, ry + ny + dy);
  p.quadraticCurveTo(rx + gx * 0.5 + nx * 0.4 + dx, ry + gy * 0.5 + ny * 0.4 + dy, tx + dx, ty + dy);
  p.quadraticCurveTo(rx + gx * 0.4 - nx * 0.2 + dx, ry + gy * 0.4 - ny * 0.2 + dy, rx - nx + dx, ry - ny + dy);
  p.closePath();
}

/** Every part of the skull sprite, as separate fills (horns overlap: no winding holes). */
function skullParts(dx: number, dy: number): Path2D[] {
  const parts: Path2D[] = [];
  const s = new Path2D();
  smoothClosed(s, SKULL, dx, dy);
  parts.push(s);
  for (const h of HORNS) {
    const p = new Path2D();
    horn(p, h, dx, dy);
    parts.push(p);
  }
  const f = new Path2D();
  for (const [x, len] of FANGS_UP) fang(f, x, 0.12, len, 1, dx, dy);
  parts.push(f);
  return parts;
}

function jawParts(dx: number, dy: number): Path2D[] {
  const parts: Path2D[] = [];
  const j = new Path2D();
  smoothClosed(j, JAW, dx, dy);
  parts.push(j);
  for (const s of JAW_SPIKES) {
    const p = new Path2D();
    spike(p, s, dx, dy);
    parts.push(p);
  }
  const f = new Path2D();
  for (const [x, len] of FANGS_DOWN) fang(f, x, 0.17, len, -1, dx, dy);
  parts.push(f);
  return parts;
}

// ---------------------------------------------------------------- colors

interface WyrmColors {
  /** The spine layer's body gradient stops (layer y from -0.75 maxH to the ground line). */
  ridge: string;
  base: string;
  body: string;
  top: string;
  under: string;
  rim: string;
  shade: string;
  snowLit: string;
  snowShade: string;
  mist: string;
  mouth: string;
}

function wyrmColors(pal: Palette): WyrmColors {
  const crest = toneColor(pal, SPINE.tone);
  const shade = mixHex(crest, pal.silhouette, 0.5);
  // Exactly the spine bake's body colors (RidgeCache.bake), so at rest the head is the mountain.
  const base = mixHex(toneColor(pal, SPINE.baseTone), pal.sky[pal.sky.length - 1]!.color, SPINE.baseSky ?? 0);
  const ridge = mixHex(crest, mixHex(pal.sun.glow, pal.accent.ember, 0.5), 0.12);
  return {
    ridge,
    base,
    body: crest,
    top: mixHex(crest, pal.haze, 0.12),
    under: mixHex(crest, pal.silhouette, 0.28),
    rim: mixHex(pal.rim, pal.haze, 0.55 * (1 - SPINE.tone)),

    shade: mixHex(shade, pal.depthTint ?? shade, 0.35),
    snowLit: mixHex(mixHex('#ffd6c2', pal.rim, 0.35), pal.haze, 0.18),
    snowShade: mixHex('#8a93d0', pal.depthTint ?? pal.haze, 0.35),
    mist: mixHex(mixHex('#d9d2f0', pal.haze, 0.4), pal.rim, 0.12),
    mouth: mixHex(pal.silhouette, '#5a1830', 0.35),
  };
}

// ---------------------------------------------------------------- baking

/** Head-local y range of the body gradient: the skull's crown down the neck to the clouds. */
const GRAD_Y0 = -1.9;
const GRAD_Y1 = 3.6;

/**
 * The head's (and the neck's) body gradient in head-local units: dark as the range's shadowed
 * faces at the crown (it must read as a silhouette when it rears), hazier down the throat and the
 * neck as they sink toward the cloud sea. Shared by the skull bake and the live neck: no seam.
 */
function headGradient(ctx: CanvasRenderingContext2D, c: WyrmColors): CanvasGradient {
  const g = ctx.createLinearGradient(0, GRAD_Y0, 0, GRAD_Y1);
  const at = (y: number): number => (y - GRAD_Y0) / (GRAD_Y1 - GRAD_Y0);
  g.addColorStop(0, c.ridge);
  g.addColorStop(at(-0.85), c.body);
  g.addColorStop(at(0.7), mixHex(c.body, c.base, 0.22));
  g.addColorStop(1, mixHex(c.body, c.base, 0.6));
  return g;
}

/**
 * Body, snow caps and rim light for a sprite's parts (ctx is in head-local units, `ox, oy` =
 * the box's top-left). Caps and rims are bands (the shape minus itself shifted), built in a
 * scratch canvas, so they stack instead of repainting each other.
 */
function paintParts(
  ctx: CanvasRenderingContext2D,
  parts: readonly Path2D[],
  shifted: (dx: number, dy: number) => Path2D[],
  c: WyrmColors,
  k: number,
  snow: number,
  ox: number,
  oy: number,
): void {
  const body = headGradient(ctx, c);
  ctx.fillStyle = body;
  for (const p of parts) ctx.fill(p);
  const cv = ctx.canvas;
  const scratch = makeCanvas(cv.width, cv.height);
  const s = context2d(scratch);
  const band = (fill: string | CanvasGradient, dx: number, dy: number, alpha: number, only = -1): void => {
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, scratch.width, scratch.height);
    s.setTransform(k, 0, 0, k, -ox * k, -oy * k);
    s.fillStyle = fill;
    for (let i = 0; i < parts.length; i++) if (only < 0 || i === only) s.fill(parts[i]!);
    s.globalCompositeOperation = 'destination-out';
    s.fillStyle = '#000';
    const sh = shifted(dx, dy);
    for (let i = 0; i < sh.length; i++) if (only < 0 || i === only) s.fill(sh[i]!);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  };
  ctx.globalCompositeOperation = 'source-atop';
  if (snow > 0) {
    // Snow caps on every upward face, lit pink toward the afterglow, blue away from it.
    const sg = ctx.createLinearGradient(-3.2, 0, 1.4, 0);
    sg.addColorStop(0, c.snowLit);
    sg.addColorStop(0.45, mixHex(c.snowLit, c.snowShade, 0.5));
    sg.addColorStop(1, c.snowShade);
    // (the skull only: snow on the horns made them glow like outlines)
    band(sg, 0.012, snow, 0.85, 0);
    band(sg, 0.03, snow * 2.2, 0.2, 0);
  }
  // Rim light on the edges facing the afterglow: a crisp band and a softer, wider one.
  const d = 1.5 / k;
  band(c.rim, -HLX * d, -HLY * d, 0.7);
  band(c.rim, -HLX * d * 3.5, -HLY * d * 3.5, 0.12);
  ctx.globalCompositeOperation = 'source-over';
  scratch.width = 0;
  scratch.height = 0;
}

/** Soft stroke: a wide faint pass under a narrow one. */
function soft(ctx: CanvasRenderingContext2D, color: string, alpha: number, width: number): void {
  ctx.strokeStyle = rgba(color, alpha * 0.4);
  ctx.lineWidth = width * 2.4;
  ctx.stroke();
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Carved features over the skull: socket, brow ledge, the shut eye's seam, cheek, nostril, lip. */
function carveSkull(ctx: CanvasRenderingContext2D, c: WyrmColors): void {
  ctx.lineCap = 'round';
  // Socket.
  ctx.save();
  ctx.translate(EYE_LX, EYE_LY);
  ctx.scale(1, 0.55);
  const sock = ctx.createRadialGradient(0.02, -0.04, 0, 0.02, -0.04, 0.36);
  sock.addColorStop(0, rgba(c.shade, 0.5));
  sock.addColorStop(0.6, rgba(c.shade, 0.22));
  sock.addColorStop(1, rgba(c.shade, 0));
  ctx.fillStyle = sock;
  ctx.fillRect(-0.4, -0.4, 0.8, 0.8);
  ctx.restore();
  // Brow ledge: shadow hanging under it.
  for (let i = 1; i <= 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-1.52, -0.7 + i * 0.018);
    ctx.quadraticCurveTo(-1.15, -0.8 + i * 0.02, -0.75, -0.76 + i * 0.016);
    ctx.strokeStyle = rgba(c.shade, 0.32 * (1 - (i - 1) / 5));
    ctx.lineWidth = 0.03;
    ctx.stroke();
  }
  // The shut eye's seam.
  ctx.save();
  ctx.translate(EYE_LX, EYE_LY);
  ctx.rotate(EYE_TILT);
  ctx.beginPath();
  ctx.moveTo(-EYE_HW, 0);
  ctx.bezierCurveTo(-EYE_HW * 0.4, 0.035, EYE_HW * 0.5, 0.03, EYE_HW, -0.005);
  soft(ctx, c.shade, 0.55, 0.014);
  ctx.restore();
  // Cheek ridge and the scales' rows along the snout.
  ctx.beginPath();
  ctx.moveTo(-1.75, -0.22);
  ctx.quadraticCurveTo(-1.05, -0.3, -0.35, -0.12);
  soft(ctx, c.shade, 0.35, 0.02);
  ctx.beginPath();
  ctx.moveTo(-1.7, -0.25);
  ctx.quadraticCurveTo(-1.05, -0.34, -0.38, -0.16);
  soft(ctx, c.rim, 0.14, 0.012);
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 16; i++) {
      const x = -2.75 + i * 0.13 + (r & 1) * 0.065;
      const y = -0.3 + r * 0.11 + 0.02 * Math.sin(i);
      if (x > -1.5 && r === 0) continue;
      ctx.beginPath();
      ctx.arc(x, y, 0.05, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.strokeStyle = rgba(c.shade, 0.22);
      ctx.lineWidth = 0.012;
      ctx.stroke();
    }
  }
  // Nostril.
  ctx.save();
  ctx.translate(NOSTRIL_X, NOSTRIL_Y);
  ctx.rotate(-0.35);
  ctx.scale(1, 0.5);
  const nos = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.09);
  nos.addColorStop(0, rgba(c.shade, 0.8));
  nos.addColorStop(1, rgba(c.shade, 0));
  ctx.fillStyle = nos;
  ctx.fillRect(-0.1, -0.1, 0.2, 0.2);
  ctx.restore();
  // Lip line.
  ctx.beginPath();
  ctx.moveTo(-3.0, 0.12);
  ctx.quadraticCurveTo(-1.8, 0.14, -0.62, 0.13);
  soft(ctx, c.shade, 0.5, 0.018);
}

/** The underside falls into shadow (the light is low and behind the range). */
function underShade(ctx: CanvasRenderingContext2D, c: WyrmColors, y0: number, y1: number, x0: number, x1: number): void {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgba(c.shade, 0));
  g.addColorStop(1, rgba(c.shade, 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0 + 0.4);
}

function texture(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, alpha: number): void {
  const pat = ctx.createPattern(brushTexture(), 'repeat');
  if (!pat) return;
  pat.setTransform(new DOMMatrix([1.6 / 256, 0, 0, 0.8 / 256, 0, 0]));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.globalAlpha = 1;
}

function bakeSkull(c: WyrmColors, k: number): HTMLCanvasElement {
  const cv = makeCanvas((HX1 - HX0) * k, (HY1 - HY0) * k);
  const ctx = context2d(cv);
  ctx.setTransform(k, 0, 0, k, -HX0 * k, -HY0 * k);
  paintParts(ctx, skullParts(0, 0), skullParts, c, k, 0.045, HX0, HY0);
  ctx.globalCompositeOperation = 'source-atop';
  underShade(ctx, c, -0.25, 0.62, HX0, HX1);
  carveSkull(ctx, c);
  texture(ctx, HX0, HY0, HX1, HY1, 0.14);
  ctx.globalCompositeOperation = 'source-over';
  return cv;
}

function bakeJaw(c: WyrmColors, k: number): HTMLCanvasElement {
  const cv = makeCanvas((JX1 - JX0) * k, (JY1 - JY0) * k);
  const ctx = context2d(cv);
  ctx.setTransform(k, 0, 0, k, -JX0 * k, -JY0 * k);
  paintParts(ctx, jawParts(0, 0), jawParts, c, k, 0, JX0, JY0);
  ctx.globalCompositeOperation = 'source-atop';
  underShade(ctx, c, 0.15, 0.62, JX0, JX1);
  ctx.beginPath();
  ctx.moveTo(-2.85, 0.19);
  ctx.quadraticCurveTo(-1.7, 0.2, -0.5, 0.14);
  soft(ctx, c.shade, 0.4, 0.016);
  texture(ctx, JX0, JY0, JX1, JY1, 0.1);
  ctx.globalCompositeOperation = 'source-over';
  return cv;
}

/**
 * The haze veil: the skull's silhouette in the range's haze, thicker low down. Drawn over the
 * head at rest (it is far off, in the same air as the saddle) and lifted as it rears out of it.
 */
function bakeVeil(skull: HTMLCanvasElement, c: WyrmColors): HTMLCanvasElement {
  const cv = makeCanvas(skull.width, skull.height);
  const ctx = context2d(cv);
  const g = ctx.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, rgba(c.base, 0.45));
  g.addColorStop(0.55, rgba(c.base, 0.75));
  g.addColorStop(1, rgba(c.base, 0.95));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(skull, 0, 0);
  return cv;
}

/** Warm bounce light from the eye onto the brow and the socket rim, masked by the skull. */
function bakeBounce(skull: HTMLCanvasElement, k: number, warm: string): HTMLCanvasElement {
  const kb = Math.min(k, 90);
  const cv = makeCanvas((LX1 - LX0) * kb, (LY1 - LY0) * kb);
  const ctx = context2d(cv);
  ctx.setTransform(kb, 0, 0, kb, -LX0 * kb, -LY0 * kb);
  ctx.save();
  ctx.scale(1, 0.62);
  const g = ctx.createRadialGradient(0.02, -0.06, 0, 0.02, -0.06, 0.8);
  g.addColorStop(0, rgba(warm, 0.9));
  g.addColorStop(0.3, rgba(warm, 0.42));
  g.addColorStop(0.7, rgba(warm, 0.1));
  g.addColorStop(1, rgba(warm, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  // Only the rock catches it: mask by the skull sprite (eye-local -> head-local).
  ctx.globalCompositeOperation = 'destination-in';
  ctx.rotate(-EYE_TILT);
  ctx.translate(-EYE_LX, -EYE_LY);
  ctx.drawImage(skull, HX0, HY0, HX1 - HX0, HY1 - HY0);
  return cv;
}

function bakePuff(color: string, size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = context2d(c);
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, rgba(color, 0.85));
  g.addColorStop(0.35, rgba(color, 0.55));
  g.addColorStop(0.7, rgba(color, 0.16));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// ---------------------------------------------------------------- the wyrm

const PUFFS = 64;
/** Neck tube samples. */
const NECK_N = 16;
const SLIDES = 6;

export class WorldWyrm {
  private palette: Palette | null = null;
  private k = 0;
  private skull: HTMLCanvasElement | null = null;
  private jaw: HTMLCanvasElement | null = null;
  private bounce: HTMLCanvasElement | null = null;
  private veil: HTMLCanvasElement | null = null;
  private puff: HTMLCanvasElement | null = null;
  private snowPuff: HTMLCanvasElement | null = null;
  private eyeBuf: HTMLCanvasElement | null = null;
  private eyeCtx: CanvasRenderingContext2D | null = null;
  private eyeK = 0;
  private iris: CanvasGradient | null = null;
  private colors: WyrmColors | null = null;
  private neckGrad: CanvasGradient | null = null;
  private neckGradCtx: CanvasRenderingContext2D | null = null;
  private mouthGrad: CanvasGradient | null = null;
  private pupil = '#000';
  private lidShade = '#000';

  // Puffs (mist kind 0, snow powder kind 1), layer units.
  private readonly px = new Float32Array(PUFFS);
  private readonly py = new Float32Array(PUFFS);
  private readonly pvx = new Float32Array(PUFFS);
  private readonly pvy = new Float32Array(PUFFS);
  private readonly pAge = new Float32Array(PUFFS);
  private readonly pLife = new Float32Array(PUFFS);
  private readonly pSize = new Float32Array(PUFFS);
  private readonly pGrow = new Float32Array(PUFFS);
  private readonly pAlpha = new Float32Array(PUFFS);
  private readonly pKind = new Uint8Array(PUFFS);
  private puffNext = 0;
  // Avalanches: a plate, a side, a clock.
  private readonly slidePlate = new Int16Array(SLIDES).fill(-1);
  private readonly slideT = new Float32Array(SLIDES);
  private readonly slideDur = new Float32Array(SLIDES);
  private readonly slideSide = new Int8Array(SLIDES);

  /** Pose actually drawn (rise already eased) and derived transform, layer units. */
  private ox = REST_X;
  private oy = -REST_H;
  private ang = REST_A;
  private jawA = 0;
  /** Eased rise 0..1 (the neck arches with it). */
  private rise = 0;

  /** Bake the sprites for a palette at `k` device px per layer unit (no-op when current). */
  ensure(pal: Palette, k: number, warm: string): void {
    if (this.palette === pal && this.skull && Math.abs(k - this.k) < this.k * 0.2) return;
    this.free();
    this.palette = pal;
    this.k = k;
    const c = wyrmColors(pal);
    this.colors = c;
    this.skull = bakeSkull(c, k);
    this.jaw = bakeJaw(c, k);
    this.bounce = bakeBounce(this.skull, k, warm);
    this.veil = bakeVeil(this.skull, c);
    this.puff = bakePuff(c.mist, 64);
    this.snowPuff = bakePuff(mixHex(c.snowLit, '#ffffff', 0.2), 32);
    this.eyeBuf = makeCanvas(2, 2);
    this.eyeCtx = context2d(this.eyeBuf);
    this.eyeK = 0;
    const e = this.eyeCtx;
    const g = e.createRadialGradient(0, 0, 0, 0, 0, EYE_HW * 1.15);
    g.addColorStop(0, '#fff6cf');
    g.addColorStop(0.16, '#ffd970');
    g.addColorStop(0.45, '#ffa132');
    g.addColorStop(0.75, mixHex('#ec6a1e', pal.haze, 0.12));
    g.addColorStop(1, mixHex('#b8401c', pal.haze, 0.3));
    this.iris = g;
    this.pupil = mixHex(c.shade, pal.haze, 0.15);
    this.lidShade = c.shade;
  }

  ready(pal: Palette): boolean {
    return this.palette === pal && this.skull !== null;
  }

  /** Baked, but for a resolution more than 20% off `k` (ensure() would re-bake). */
  stale(k: number): boolean {
    return this.skull !== null && Math.abs(k - this.k) >= this.k * 0.2;
  }

  free(): void {
    for (const cv of [this.skull, this.jaw, this.bounce, this.veil, this.puff, this.snowPuff, this.eyeBuf]) {
      if (cv) {
        cv.width = 0;
        cv.height = 0;
      }
    }
    this.skull = this.jaw = this.bounce = this.veil = this.puff = this.snowPuff = this.eyeBuf = null;
    this.eyeCtx = null;
    this.iris = null;
    this.neckGrad = null;
    this.neckGradCtx = null;
    this.mouthGrad = null;
    this.palette = null;
  }

  bytes(): number {
    let b = 0;
    for (const cv of [this.skull, this.jaw, this.bounce, this.veil, this.puff, this.snowPuff, this.eyeBuf]) if (cv) b += cv.width * cv.height * 4;
    return b;
  }

  // ---- pose -> transform

  /** Resolve the pose into the head's transform (call once per frame, in update). */
  setPose(p: WyrmPose, breath: number): void {
    const r = smoothstep(0, 1, clamp01(p.rise));
    this.rise = r;
    const jaw = clamp01(p.jaw);
    this.ox = REST_X + (REAR_X - REST_X) * r;
    this.oy = -(REST_H + (REAR_H - REST_H) * r) + 0.012 * breath * (1 - r);
    this.ang = REST_A + (REAR_A - REST_A) * r + ROAR_TILT * jaw * (0.3 + 0.7 * r) - 0.01 * breath * (1 - r);
    this.jawA = JAW_OPEN * jaw * (0.6 + 0.4 * r) + 0.02 * breath * (1 - r);
  }

  /** Head-local point -> layer units (current pose). */
  toLayer(hx: number, hy: number, out: { x: number; y: number }): { x: number; y: number } {
    const c = Math.cos(this.ang);
    const s = Math.sin(this.ang);
    out.x = this.ox + hx * c - hy * s;
    out.y = this.oy + hx * s + hy * c;
    return out;
  }

  /** The eye's center in layer units (for the fight direction and debug). */
  eyeAt(out: { x: number; y: number }): { x: number; y: number } {
    return this.toLayer(EYE_LX, EYE_LY, out);
  }

  // ---- particles

  private spawn(kind: number, x: number, y: number, vx: number, vy: number, life: number, size: number, grow: number, alpha: number): void {
    const i = this.puffNext;
    this.puffNext = (i + 1) % PUFFS;
    this.pKind[i] = kind;
    this.px[i] = x;
    this.py[i] = y;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.pAge[i] = 0;
    this.pLife[i] = life;
    this.pSize[i] = size;
    this.pGrow[i] = grow;
    this.pAlpha[i] = alpha;
  }

  private readonly tp = { x: 0, y: 0 };

  /** A slow exhale: mist curling up from the nostril (behind the shoulder when resting). */
  breathe(strength: number): void {
    const p = this.toLayer(NOSTRIL_X, NOSTRIL_Y, this.tp);
    for (let i = 0; i < 4; i++) {
      this.spawn(0, p.x + (Math.random() - 0.5) * 0.2, p.y, -0.04 - 0.06 * Math.random(), -0.05 - 0.04 * Math.random(), 5 + 2 * Math.random(), 0.2 + 0.1 * Math.random(), 0.16, 0.2 * strength);
    }
  }

  /** The roar in cold air: a plume of breath from the open jaws. */
  plume(strength: number): void {
    const n = Math.round(3 + 7 * strength);
    for (let i = 0; i < n; i++) {
      // From somewhere in the open mouth, fanning forward (left) and a little up.
      const p = this.toLayer(MOUTH_X + 0.35 * Math.random(), MOUTH_Y + 0.12 + 0.2 * Math.random(), this.tp);
      const a = Math.PI + this.ang - 0.3 + 0.5 * Math.random();
      const v = (0.25 + 0.5 * Math.random()) * strength;
      this.spawn(0, p.x, p.y, Math.cos(a) * v, Math.sin(a) * v - 0.04, 2 + 1.6 * Math.random(), 0.05 + 0.05 * Math.random(), 0.35 + 0.3 * Math.random(), 0.07 + 0.06 * strength);
    }
  }

  /** Snow shaken off the skull and horns as the head lifts. */
  shed(amount: number): void {
    const n = Math.round(10 * amount);
    for (let i = 0; i < n; i++) {
      const hx = -2.6 + 3.4 * Math.random();
      const hy = -0.85 - 0.25 * Math.random();
      const p = this.toLayer(hx, hy, this.tp);
      this.spawn(1, p.x, p.y, (Math.random() - 0.5) * 0.12, 0.02 * Math.random(), 1.6 + Math.random(), 0.018 + 0.02 * Math.random(), 0.05, 0.75);
    }
  }

  /** Snow slides off the plates: a few of the big lit faces let go (a strong roar). */
  avalanche(x0: number, x1: number, lightX: number): void {
    let started = 0;
    for (let tries = 0; tries < 40 && started < 5; tries++) {
      const i = (Math.random() * SPINE_PLATES.length) | 0;
      const p = SPINE_PLATES[i]!;
      if (p.row !== 0 || p.h < 0.8 || p.x < x0 || p.x > x1) continue;
      let slot = -1;
      for (let s = 0; s < SLIDES; s++) {
        if (this.slidePlate[s] === i) {
          slot = -2;
          break;
        }
        if (slot === -1 && this.slidePlate[s]! < 0) slot = s;
      }
      if (slot < 0) continue;
      this.slidePlate[slot] = i;
      this.slideT[slot] = -0.3 * started - 0.2 * Math.random();
      this.slideDur[slot] = 1.9 + 0.8 * Math.random();
      this.slideSide[slot] = lightX >= p.x ? 1 : -1;
      started++;
    }
  }

  update(dt: number, wind: number): void {
    if (!(dt > 0)) return;
    for (let i = 0; i < PUFFS; i++) {
      if (this.pLife[i]! <= 0) continue;
      const a = (this.pAge[i] += dt);
      if (a >= this.pLife[i]!) {
        this.pLife[i] = 0;
        continue;
      }
      if (this.pKind[i] === 1) this.pvy[i] += 0.35 * dt;
      else {
        this.pvx[i] = this.pvx[i]! * (1 - 0.55 * dt) + 0.012 * wind * dt;
        this.pvy[i] = this.pvy[i]! * (1 - 0.55 * dt) - 0.008 * dt;
      }
      this.px[i] += this.pvx[i]! * dt;
      this.py[i] += this.pvy[i]! * dt;
    }
    for (let s = 0; s < SLIDES; s++) {
      if (this.slidePlate[s]! < 0) continue;
      this.slideT[s] += dt;
      if (this.slideT[s]! > this.slideDur[s]! + 1.6) this.slidePlate[s] = -1;
    }
  }

  // ---- drawing (all in spine-layer units; the caller applied the spine's transform)

  /** Neck, jaw, skull and eye: drawn before the spine, so the saddle hides the neck's root. */
  drawHead(ctx: CanvasRenderingContext2D, eye: number, lookX: number, lookY: number, pxPerUnit: number, glow: HTMLCanvasElement, t: number): void {
    const c = this.colors;
    if (!c || !this.skull) return;
    this.drawNeck(ctx, c, pxPerUnit);
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.rotate(this.ang);
    // Mouth: a dark gullet with a banked-coal glow, visible as the jaw drops.
    if (this.jawA > 0.02) {
      if (!this.mouthGrad) {
        const g = ctx.createRadialGradient(-0.9, 0.2, 0, -0.9, 0.2, 1.9);
        g.addColorStop(0, mixHex(c.mouth, '#ff7a2a', 0.45));
        g.addColorStop(0.5, c.mouth);
        g.addColorStop(1, mixHex(c.mouth, c.body, 0.3));
        this.mouthGrad = g;
      }
      // The jaw drops: a counter-clockwise turn about the hinge (the snout points left).
      const ca = Math.cos(-this.jawA);
      const sa = Math.sin(-this.jawA);
      const fx = -2.85 - HINGE_X;
      const fy = 0.2 - HINGE_Y;
      ctx.beginPath();
      ctx.moveTo(HINGE_X + 0.25, HINGE_Y - 0.02);
      ctx.lineTo(-3.0, 0.1);
      ctx.lineTo(HINGE_X + fx * ca - fy * sa, HINGE_Y + fx * sa + fy * ca);
      ctx.closePath();
      ctx.fillStyle = this.mouthGrad;
      ctx.fill();
    }
    ctx.save();
    ctx.translate(HINGE_X, HINGE_Y);
    ctx.rotate(-this.jawA);
    ctx.translate(-HINGE_X, -HINGE_Y);
    ctx.drawImage(this.jaw!, JX0, JY0, JX1 - JX0, JY1 - JY0);
    ctx.restore();
    ctx.drawImage(this.skull, HX0, HY0, HX1 - HX0, HY1 - HY0);
    // At rest it lies in the same air as the saddle; the haze lifts as it rears out of it.
    const veil = 0.42 * (1 - this.rise) * (1 - this.rise);
    if (veil > 0.01) {
      ctx.globalAlpha = veil;
      ctx.drawImage(this.veil!, HX0, HY0, HX1 - HX0, HY1 - HY0);
      ctx.globalAlpha = 1;
    }
    if (eye > 0.004) this.drawEye(ctx, eye, lookX, lookY, pxPerUnit, glow, t);
    ctx.restore();
  }

  private readonly neckX = new Float32Array(NECK_N + 1);
  private readonly neckY = new Float32Array(NECK_N + 1);
  private readonly neckNx = new Float32Array(NECK_N + 1);
  private readonly neckNy = new Float32Array(NECK_N + 1);
  private readonly neckW = new Float32Array(NECK_N + 1);

  /**
   * The neck: a tube from the back of the skull, arching as it rears (lying low at rest), down to
   * its root behind the saddle, with the range's dorsal plates along its crest.
   */
  private drawNeck(ctx: CanvasRenderingContext2D, c: WyrmColors, pxPerUnit: number): void {
    if (!this.neckGrad || this.neckGradCtx !== ctx) {
      this.neckGrad = headGradient(ctx, c);
      this.neckGradCtx = ctx;
    }
    const r = this.rise;
    const cs = Math.cos(this.ang);
    const sn = Math.sin(this.ang);
    // The centerline in head-local units (the path is drawn under the head's transform, so the
    // neck shares the skull's gradient: no seam where they meet).
    const x0 = 0.22;
    const y0 = -0.04;
    const x1 = x0 + 1.05;
    const y1 = y0 + 0.08;
    // The root behind the saddle (layer units) -> head-local.
    const bx2 = 5.05 + 0.85 * r - this.ox;
    const by2 = -0.95 - 1.6 * r - this.oy;
    const bx3 = 5.6 - this.ox;
    const by3 = -0.5 - this.oy;
    const x2 = cs * bx2 + sn * by2;
    const y2 = -sn * bx2 + cs * by2;
    const x3 = cs * bx3 + sn * by3;
    const y3 = -sn * bx3 + cs * by3;
    for (let i = 0; i <= NECK_N; i++) {
      const u = i / NECK_N;
      const v = 1 - u;
      this.neckX[i] = v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3;
      this.neckY[i] = v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3;
      const gx = 3 * v * v * (x1 - x0) + 6 * v * u * (x2 - x1) + 3 * u * u * (x3 - x2);
      const gy = 3 * v * v * (y1 - y0) + 6 * v * u * (y2 - y1) + 3 * u * u * (y3 - y2);
      const gl = Math.hypot(gx, gy) || 1;
      // Outer (crest) side: up where it runs back, back where it runs down.
      this.neckNx[i] = gy / gl;
      this.neckNy[i] = -gx / gl;
      this.neckW[i] = 0.5 * (1.0 + 0.5 * u);
    }
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.rotate(this.ang);
    // The light's direction in head-local units, for the rim offset.
    const d = 1.4 / pxPerUnit;
    const lx = HLX * cs + HLY * sn;
    const ly = -HLX * sn + HLY * cs;
    for (let pass = 0; pass < 2; pass++) {
      const ox = pass === 0 ? 0 : -lx * d;
      const oy = pass === 0 ? 0 : -ly * d;
      ctx.beginPath();
      for (let i = 0; i <= NECK_N; i++) {
        const x = this.neckX[i]! + this.neckNx[i]! * this.neckW[i]! + ox;
        const y = this.neckY[i]! + this.neckNy[i]! * this.neckW[i]! + oy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = NECK_N; i >= 0; i--) ctx.lineTo(this.neckX[i]! - this.neckNx[i]! * this.neckW[i]! + ox, this.neckY[i]! - this.neckNy[i]! * this.neckW[i]! + oy);
      ctx.closePath();
      // Dorsal plates along the crest: the range's plates, small, leaning back toward the body.
      for (let i = 1; i < NECK_N - 2; i += 2) {
        const u = i / NECK_N;
        const nx = this.neckNx[i]!;
        const ny = this.neckNy[i]!;
        const w = this.neckW[i]!;
        const bx = this.neckX[i]! + nx * w * 0.9 + ox;
        const by = this.neckY[i]! + ny * w * 0.9 + oy;
        const tx = -ny;
        const ty = nx;
        const h = (0.16 + 0.22 * u + 0.06 * hash2f(i, 17)) * (0.3 + 0.7 * r);
        const pw = 0.13 + 0.08 * u;
        ctx.moveTo(bx - tx * pw, by - ty * pw);
        ctx.lineTo(bx + nx * h + tx * pw * 0.7, by + ny * h + ty * pw * 0.7);
        ctx.lineTo(bx + tx * pw, by + ty * pw);
        ctx.closePath();
      }
      ctx.fillStyle = pass === 0 ? rgba(c.rim, 0.75) : this.neckGrad!;
      ctx.fill();
    }
    // Throat scutes: pale bands across the inner half of the neck.
    if (r > 0.02) {
      ctx.strokeStyle = rgba(c.base, 0.14 * r);
      ctx.lineWidth = 0.022;
      ctx.beginPath();
      for (let i = 2; i < NECK_N - 1; i++) {
        const nx = this.neckNx[i]!;
        const ny = this.neckNy[i]!;
        const w = this.neckW[i]!;
        const x = this.neckX[i]!;
        const y = this.neckY[i]!;
        // Slightly bowed, like belly plates wrapping the throat.
        ctx.moveTo(x - nx * w * 0.2, y - ny * w * 0.2);
        ctx.quadraticCurveTo(x - nx * w * 0.6 + ny * 0.05, y - ny * w * 0.6 - nx * 0.05, x - nx * w * 0.93, y - ny * w * 0.93);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEye(ctx: CanvasRenderingContext2D, open: number, lookX: number, lookY: number, pxPerUnit: number, glow: HTMLCanvasElement, t: number): void {
    const e = this.eyeCtx!;
    const buf = this.eyeBuf!;
    // Buffer resolution: the head's own (soft as the rock), capped by what the screen needs.
    const k = Math.max(8, Math.min(this.k, pxPerUnit * 1.2));
    if (Math.abs(k - this.eyeK) > this.eyeK * 0.05) {
      this.eyeK = k;
      const w = Math.ceil((EX1 - EX0) * k);
      const h = Math.ceil((EY1 - EY0) * k);
      if (buf.width < w || buf.height < h) {
        buf.width = w;
        buf.height = h;
      }
    }
    const bw = Math.ceil((EX1 - EX0) * k);
    const bh = Math.ceil((EY1 - EY0) * k);
    e.setTransform(1, 0, 0, 1, 0, 0);
    e.globalAlpha = 1;
    e.globalCompositeOperation = 'source-over';
    e.clearRect(0, 0, bw + 1, bh + 1);
    e.setTransform(k, 0, 0, k, -EX0 * k, -EY0 * k);
    const up = open * EYE_HH * 1.25;
    const dn = open * EYE_HH * 0.75;
    e.beginPath();
    e.moveTo(-EYE_HW, 0);
    e.bezierCurveTo(-EYE_HW * 0.4, -up * 1.33, EYE_HW * 0.5, -up * 1.28, EYE_HW, 0);
    e.bezierCurveTo(EYE_HW * 0.45, dn * 1.33, -EYE_HW * 0.5, dn * 1.33, -EYE_HW, 0);
    e.closePath();
    e.save();
    e.clip();
    const px = lookX * EYE_HW * 0.35;
    const py = lookY * EYE_HH * 0.3 + (dn - up) * 0.3;
    e.translate(px, py);
    e.fillStyle = this.iris!;
    e.fillRect(-EYE_HW * 2, -EYE_HH * 3, EYE_HW * 4, EYE_HH * 6);
    const pw = EYE_HW * (0.05 + 0.14 * (1 - open)) * (1 + 0.05 * Math.sin(t * 1.6));
    const ph = EYE_HH * 1.2;
    e.fillStyle = rgba(this.pupil, 0.3);
    e.beginPath();
    e.ellipse(0, 0, pw * 1.5, ph, 0, 0, TAU);
    e.fill();
    e.fillStyle = this.pupil;
    e.beginPath();
    e.moveTo(0, -ph);
    e.quadraticCurveTo(pw * 1.3, 0, 0, ph);
    e.quadraticCurveTo(-pw * 1.3, 0, 0, -ph);
    e.fill();
    e.translate(-px, -py);
    // The heavy upper lid shades the top of the eye.
    e.fillStyle = rgba(this.lidShade, 0.45);
    e.fillRect(-EYE_HW, -up - 0.01, EYE_HW * 2, up * 0.55 + 0.01);
    e.fillStyle = rgba('#fff4d8', 0.5 * clamp01(open * 4));
    e.beginPath();
    e.ellipse(-EYE_HW * 0.32, -up * 0.35, EYE_HW * 0.07, EYE_HH * 0.14, -0.3, 0, TAU);
    e.fill();
    e.restore();

    const flick = 0.93 + 0.07 * Math.sin(t * 5.3) * Math.sin(t * 1.9 + 1);
    const gl = open * flick;
    ctx.save();
    ctx.translate(EYE_LX, EYE_LY);
    ctx.rotate(EYE_TILT);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22 * gl;
    ctx.drawImage(glow, -1.2, -0.8, 2.4, 1.6);
    ctx.globalAlpha = 0.75 * gl;
    ctx.drawImage(this.bounce!, LX0, LY0, LX1 - LX0, LY1 - LY0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(buf, 0, 0, bw, bh, EX0, EY0, bw / k, bh / k);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.4 * gl;
    const h = EYE_HH * (0.7 + 1.8 * open);
    ctx.drawImage(glow, -EYE_HW * 1.4, -h * 1.1, EYE_HW * 2.8, h * 2.2);
    ctx.restore();
  }

  /** Mist, powder and avalanches: drawn after the spine (they rise over the ridge). */
  drawFront(ctx: CanvasRenderingContext2D, pxPerUnit: number): void {
    if (!this.puff) return;
    for (let i = 0; i < PUFFS; i++) {
      const life = this.pLife[i]!;
      if (life <= 0) continue;
      const f = this.pAge[i]! / life;
      const r = this.pSize[i]! + this.pGrow[i]! * this.pAge[i]!;
      if (this.pKind[i] === 0) {
        ctx.globalAlpha = this.pAlpha[i]! * Math.sin(Math.PI * Math.sqrt(f)) * (1 - f * 0.4);
        ctx.drawImage(this.puff, this.px[i]! - r * 1.4, this.py[i]! - r, r * 2.8, r * 2);
      } else {
        ctx.globalAlpha = this.pAlpha[i]! * (1 - f * f);
        ctx.drawImage(this.snowPuff!, this.px[i]! - r, this.py[i]! - r, r * 2, r * 2);
      }
    }
    // Avalanches: a powder front racing down the lit face, a trail of snow dust hanging behind
    // it all the way up to the summit, billowing and fading.
    for (let s = 0; s < SLIDES; s++) {
      const pi = this.slidePlate[s]!;
      if (pi < 0) continue;
      const p: Plate = SPINE_PLATES[pi]!;
      const T = this.slideT[s]!;
      if (T < 0) continue;
      const dur = this.slideDur[s]!;
      const side = this.slideSide[s]!;
      const w = side > 0 ? p.wr : p.wl;
      const u = Math.min(1, T / dur);
      const front = Math.pow(u, 1.25) * 0.85;
      const after = T > dur ? (T - dur) / 1.6 : 0;
      const fade = 1 - Math.min(1, after);
      for (let j = 0; j < 16; j++) {
        const k = j / 15;
        const run = front * (1 - k * 0.92);
        const x = p.x + side * w * run;
        // Down the face, not along the skyline: deeper below the edge as it descends.
        const y = -spineHeight(x) + 0.05 + p.h * 0.18 * run;
        const age = T * (0.3 + 0.7 * k);
        const r = (0.04 + 0.22 * run + 0.05 * hash2f(j, pi)) * (1 + 0.5 * age + after);
        ctx.globalAlpha = fade * (0.6 - 0.4 * k) * Math.min(1, T * 3);
        ctx.drawImage(this.snowPuff!, x - r * 1.4, y - r * 1.1, r * 2.8, r * 2);
      }
    }
    ctx.globalAlpha = 1;
    void pxPerUnit;
  }
}
