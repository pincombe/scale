// The wyrm in the mountains (WP 1.12): the valley's right wall is a sleeping head resting beside
// the setting sun, snout toward the valley and the fight, horns swept back, its spine trailing off
// as the range. This module holds the head's silhouette and the face carved into the rock (brow
// ledge, socket, cheek, mouth seam, nostril cave, the shut eye's seam), baked into the mountains
// layer so it costs nothing per frame and reads as plain strata until the eye opens.
//
// Coordinates: mountains-layer units (x right, height up; the bake draws at y = -height).
import type { Palette } from '../palette';
import { mixHex, rgba } from '../../lib/color';
import { Noise } from '../../lib/noise';
import { hash2f } from '../../lib/math';

// ---------------------------------------------------------------- the eye's socket

/** Eye center (layer x, height above the ground line): ~40% down the screen, center-right. */
export const EYE_X = 3.95;
export const EYE_H = 2.98;
/** Half-width and max half-height of the opening. */
export const EYE_HW = 0.35;
export const EYE_HH = 0.13;
/** The head faces left: the front corner dips toward the snout, the back corner sweeps up. */
export const EYE_TILT = -0.13;
/** Closed-lid seam sag at the center (the lower lid rises to meet the upper). */
export const EYE_SAG = 0.02;
/** Nostril cave on the nose. */
const NOSTRIL_X = 2.27;
const NOSTRIL_H = 1.74;

/** A quadratic curve (layer or eye-local units, y down). */
interface Curve {
  readonly x0: number;
  readonly y0: number;
  readonly cx: number;
  readonly cy: number;
  readonly x1: number;
  readonly y1: number;
}

/** Brow ledge: the overhang above the eye, front (low) to back (high), eye-local. */
export const BROW: Curve = { x0: -0.5, y0: -0.19, cx: 0.05, cy: -0.35, x1: 0.62, y1: -0.3 };
/** Cheek ledge under the eye, sweeping back and up toward the jaw hinge, eye-local. */
export const CHEEK: Curve = { x0: -0.32, y0: 0.2, cx: 0.12, cy: 0.3, x1: 0.6, y1: 0.12 };
/** Mouth seam, layer units: from under the nose back along the jaw. */
const MOUTH: Curve = { x0: 2.1, y0: -1.3, cx: 3.3, cy: -1.48, x1: 4.3, y1: -2.0 };
/** Where it fades out past the jaw hinge. */
const MOUTH_END: Curve = { x0: 4.3, y0: -2.0, cx: 4.46, cy: -2.1, x1: 4.6, y1: -2.14 };
/** Crease where the horns root into the skull, layer units. */
const HORN_ROOT: Curve = { x0: 4.62, y0: -3.42, cx: 4.98, cy: -3.52, x1: 5.32, y1: -3.84 };

export function curve(ctx: CanvasRenderingContext2D, c: Curve, dx = 0, dy = 0): void {
  ctx.moveTo(c.x0 + dx, c.y0 + dy);
  ctx.quadraticCurveTo(c.cx + dx, c.cy + dy, c.x1 + dx, c.y1 + dy);
}

// ---------------------------------------------------------------- silhouette

// Profile of the head, snout tip (left, by the sun) to the neck. The crest line reads as rock
// until you know: a rounded nose with a nostril bump, a long nasal ridge sloping toward the valley,
// a stop, a heavy brow directly over the eye, the skull dome, backswept horns, the nape. It starts
// well below the range (x = 1.6) so the smooth max blends it in without a step.
const HEAD_X = [1.6, 1.96, 2.06, 2.18, 2.32, 2.48, 2.78, 3.08, 3.3, 3.52, 3.74, 3.96, 4.18, 4.46, 4.78, 5.1, 5.46, 5.95, 6.6, 7.4, 8.3, 9.1];
const HEAD_Y = [0.25, 0.95, 1.5, 1.8, 1.95, 1.94, 2.1, 2.36, 2.62, 3.0, 3.4, 3.62, 3.58, 3.66, 3.78, 3.72, 3.5, 3.3, 3.16, 2.95, 2.7, 2.45];

const nW = new Noise(101);

function ridged(x: number, y: number): number {
  const v = 1 - Math.abs(nW.simplex2(x, y));
  return v * v;
}

/** Catmull-Rom through (xs, ys) (xs increasing); outside the range returns -Infinity. */
function spline(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (x < xs[0]! || x > xs[n - 1]!) return -Infinity;
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]!) i++;
  const x1 = xs[i]!;
  const x2 = xs[i + 1]!;
  const t = (x - x1) / (x2 - x1);
  const y0 = ys[Math.max(0, i - 1)]!;
  const y1 = ys[i]!;
  const y2 = ys[i + 1]!;
  const y3 = ys[Math.min(n - 1, i + 2)]!;
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
}

/** Backswept horn crag: rises gently from `base` rightward to a tip at `tip`, then drops. */
function horn(x: number, base: number, tip: number, h: number): number {
  if (x < base || x > tip + 0.12) return 0;
  if (x <= tip) return h * Math.pow((x - base) / (tip - base), 1.7);
  return h * (1 - (x - tip) / 0.12);
}

/** Height of the head and neck at x (-Infinity outside it). */
export function wyrmHeight(x: number): number {
  let h = spline(HEAD_X, HEAD_Y, x);
  if (h === -Infinity) return h;
  // Weathered crags so it reads as rock, not a mesa: light on the face, rougher on the skull.
  const rough = x < 3.2 ? 0.2 : x < 4.6 ? 0.2 + 0.8 * ((x - 3.2) / 1.4) ** 2 : 1;
  h += rough * (0.13 * ridged(x * 2.1, 3.3) - 0.065 + 0.035 * nW.simplex2(x * 7, 1.1));
  h += horn(x, 4.5, 5.42, 0.7) + horn(x, 5.0, 5.78, 0.4);
  if (x > 5.85 && x < 8.8) {
    // Spinal crags along the neck, like weathered rocks.
    const u = (x - 5.85) / 0.38;
    const f = u - Math.floor(u);
    const size = 0.08 + 0.12 * hash2f(Math.floor(u), 7);
    const env = Math.min(1, (x - 5.85) / 0.5, (8.8 - x) / 0.8);
    h += size * env * Math.max(0, 1 - Math.abs(f - 0.55) * 2.6);
  }
  return h;
}

// ---------------------------------------------------------------- the face, baked

/** Colors the mountains bake hands to the face painter. */
export interface FaceColors {
  crest: string;
  shade: string;
  rimColor: string;
  /** The sun's x in the layer's units at bake time (RidgeCache sets it before painting). */
  lightX?: number;
  /** The layer's base (valley haze) color at bake time. */
  base?: string;
  /** The x range being baked (layer units), so painters can skip what is off the canvas. */
  x0?: number;
  x1?: number;
}

/** The face's shadow and lit-edge colors: the layer's own shade and rim, hazed like the layer. */
export function faceShadow(pal: Palette, c: FaceColors): string {
  return mixHex(c.shade, pal.depthTint ?? c.shade, 0.35);
}

/**
 * Carve the face into the mountains layer, in layer units. The bake calls it (source-atop over
 * the silhouette, before the brush texture) at strength 1: shut, it reads as strata and a cave.
 * The eye's overlay repaints it on top while the eye is open, so the face surfaces as it wakes.
 */
export function paintFace(ctx: CanvasRenderingContext2D, pal: Palette, c: FaceColors, k = 1): void {
  const shadow = faceShadow(pal, c);
  const lit = mixHex(c.rimColor, c.crest, 0.3);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.translate(EYE_X, -EYE_H);
  ctx.rotate(EYE_TILT);

  // Socket: a shallow hollow the eye sits in.
  ctx.save();
  ctx.scale(1, 0.5);
  const sock = ctx.createRadialGradient(0.03, -0.08, 0, 0.03, -0.08, 0.64);
  sock.addColorStop(0, rgba(shadow, 0.13 * k));
  sock.addColorStop(0.55, rgba(shadow, 0.07 * k));
  sock.addColorStop(1, rgba(shadow, 0));
  ctx.fillStyle = sock;
  ctx.fillRect(-0.7, -0.8, 1.4, 1.6);
  ctx.restore();

  // Brow ledge: lit lip on top, its underside falling into soft shadow over the socket.
  shadowUnder(ctx, BROW, shadow, 0.075 * k, 6, 0.022);
  ctx.beginPath();
  curve(ctx, BROW, 0, -0.01);
  strokeSoft(ctx, lit, 0.22 * k, 0.02);
  // Cheek ledge.
  shadowUnder(ctx, CHEEK, shadow, 0.05 * k, 4, 0.02);
  ctx.beginPath();
  curve(ctx, CHEEK);
  strokeSoft(ctx, lit, 0.13 * k, 0.018);
  // The shut eye: a faint seam you only notice once you've seen it open.
  ctx.beginPath();
  ctx.moveTo(-EYE_HW, 0);
  ctx.bezierCurveTo(-EYE_HW * 0.42, EYE_SAG / 0.75, EYE_HW * 0.5, (EYE_SAG / 0.75) * 0.96, EYE_HW, 0);
  strokeSoft(ctx, shadow, 0.17 * k, 0.014);
  ctx.restore();

  // Mouth seam from under the nose back along the jaw, and the lip above it.
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  curve(ctx, MOUTH);
  strokeSoft(ctx, shadow, 0.14 * k, 0.024);
  ctx.beginPath();
  curve(ctx, MOUTH_END);
  strokeSoft(ctx, shadow, 0.06 * k, 0.02);
  shadowUnder(ctx, MOUTH, shadow, 0.03 * k, 3, 0.025);
  ctx.beginPath();
  curve(ctx, MOUTH, 0.01, -0.03);
  strokeSoft(ctx, lit, 0.08 * k, 0.016);
  // Nostril cave on the nose, with a lit rim.
  ctx.save();
  ctx.translate(NOSTRIL_X, -NOSTRIL_H);
  ctx.rotate(-0.25);
  ctx.scale(1, 0.55);
  const nos = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.1);
  nos.addColorStop(0, rgba(shadow, 0.36 * k));
  nos.addColorStop(0.6, rgba(shadow, 0.18 * k));
  nos.addColorStop(1, rgba(shadow, 0));
  ctx.fillStyle = nos;
  ctx.fillRect(-0.1, -0.1, 0.2, 0.2);
  ctx.beginPath();
  ctx.arc(0, 0.01, 0.075, Math.PI * 1.1, Math.PI * 1.95);
  ctx.restore();
  strokeSoft(ctx, lit, 0.15 * k, 0.014);
  // Where the horns root into the skull.
  ctx.beginPath();
  curve(ctx, HORN_ROOT);
  strokeSoft(ctx, shadow, 0.1 * k, 0.024);
  ctx.restore();
}

/** Soft shadow hanging under a ledge: the curve restroked a little lower each step, fading. */
function shadowUnder(ctx: CanvasRenderingContext2D, c: Curve, color: string, alpha: number, steps: number, step: number): void {
  ctx.lineWidth = step * 1.6;
  for (let i = 1; i <= steps; i++) {
    ctx.strokeStyle = rgba(color, alpha * (1 - (i - 1) / steps));
    ctx.beginPath();
    curve(ctx, c, 0, i * step);
    ctx.stroke();
  }
}

/** Soft stroke of the current path: a wide faint pass under a narrow one (reads blurred at DPR 1). */
function strokeSoft(ctx: CanvasRenderingContext2D, color: string, alpha: number, width: number): void {
  ctx.strokeStyle = rgba(color, alpha * 0.4);
  ctx.lineWidth = width * 2.4;
  ctx.stroke();
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = width;
  ctx.stroke();
}
