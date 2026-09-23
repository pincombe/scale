// The world wyrm's hide: the Mountain's ground (y >= 0, world meters) is the back of a wyrm so
// big that the Meadow was one of its scales. Rows of rim-lit scales with snow in the pockets
// between them, in world space, so the zoom director can draw the very same pattern at any
// magnification (drawHide) and place the Meadow snapshot inside one scale (hideScaleAt).
//
// Geometry (pure, tested): row pitch grows linearly with depth below the ridge line,
// pitch(y) = S0 + K y, so rows form a geometric series: pitch_n = S0 (1 + K)^n and row n starts at
// y_n = (pitch_n - S0) / K. On screen that is a receding plane at any zoom: the K y part is
// zoom-invariant (perspective), the S0 part magnifies (the zoom's close-up near the feet).
// Row n holds scales of width hideWidth(n): wide near the ridge line (foreshortened, seen at a
// grazing angle), rounder toward the viewer; each row starts at its own hashed phase.
//
// Drawing: far rows first (the ridge line), each nearer row over the last. Each scale is a
// rounded-top plate: a warm rim on the edges facing the light, a dark body catching a little sky
// on its bulge, and blue snow in the pockets that the next row's rounded tops leave uncovered.
// Allocation-free per call once the palette's colors are cached (no Path2D: the path is re-emitted
// per pass), so the zoom may call it every frame.
import type { Palette } from '../palette';
import type { Rect } from '../../lib/vec';
import { mixHex, rgba } from '../../lib/color';
import { hash2f } from '../../lib/math';
import { Noise } from '../../lib/noise';

const nDrift = new Noise(0xd21f7);

/** Row pitch at the ridge line (m) and its growth per meter below it. */
export const HIDE_S0 = 0.07;
export const HIDE_K = 0.15;
/** Scale width / row pitch at the ridge line; it falls toward the viewer (width ~ pitch^0.55). */
export const HIDE_ASPECT = 3.1;
const WIDTH_EXP = 0.55;
/** Rows whose pitch is below this many px are not drawn (the base tone stands for them). */
const MIN_PX = 4;
/** ...and fade in up to this pitch, so a continuous zoom never pops. */
const FADE_PX = 7;
/** Rim and snow-cap passes only on rows at least this tall (px): below, they are just texture. */
const DETAIL_PX = 8;
/** Safety cap on scales per call (a debug camera at an absurd zoom-out: bounded cost). */
const MAX_SCALES = 2500;
/** Deep rows never get narrower than this (width / pitch). */
const MIN_ASPECT = 1.2;
/** Arc height of a scale's rounded top, as a fraction of its row's pitch. */
const ARC = 0.6;

const LOG_GROWTH = Math.log(1 + HIDE_K);

/** Pitch (m) of row n. */
export function hidePitch(n: number): number {
  return HIDE_S0 * Math.pow(1 + HIDE_K, n);
}

/** Top y (m) of row n. */
export function hideRowY(n: number): number {
  return (hidePitch(n) - HIDE_S0) / HIDE_K;
}

/** Scale width (m) in row n. */
export function hideWidth(n: number): number {
  return Math.max(MIN_ASPECT * hidePitch(n), HIDE_ASPECT * HIDE_S0 * Math.pow(1 + HIDE_K, n * WIDTH_EXP));
}

/** Row index containing world y (y < 0 counts as row 0). */
export function hideRowAt(y: number): number {
  if (!(y > 0)) return 0;
  return Math.floor(Math.log(1 + (HIDE_K * y) / HIDE_S0) / LOG_GROWTH + 1e-9);
}

/** Horizontal phase of row n (m): a hashed fraction of a scale, so no diagonal grid lines. */
function rowOffset(n: number, w: number): number {
  return hash2f(n, 811) * w;
}

/**
 * Rows undulate (the body curves under them): a scale's top is offset by this many pitches.
 * Scale-invariant (x measured in scale widths), different per row, so rows drift together and
 * apart like scales on a living flank.
 */
function warp(n: number, u: number): number {
  return 0.3 * Math.sin(u * 0.31 + n * 0.83) + 0.22 * Math.sin(u * 0.087 + n * 1.91 + 1.3);
}

/** Geometry of scale i in row n (row-local y: 0 = the row's top, units of pitch). */
interface ScaleGeom {
  cx: number;
  sx: number;
  top: number;
  ry: number;
  lean: number;
}
const geom: ScaleGeom = { cx: 0, sx: 0, top: 0, ry: 0, lean: 0 };

function scaleGeom(n: number, i: number, w: number, off: number, out: ScaleGeom): ScaleGeom {
  const j = hash2f(i, n * 7 + 3);
  const k = hash2f(i, n * 7 + 4);
  // Irregular plates: width, height and lean vary; a few sit proud of their row.
  // Neighbors always overlap (no slots down to the row behind).
  out.cx = off + (i + 0.5) * w + (j - 0.5) * 0.14 * w;
  out.sx = w * (0.6 + 0.16 * k);
  out.top = (hash2f(i, n * 7 + 5) - 0.5) * 0.34 - (k > 0.9 ? 0.18 : 0) + warp(n, i + 0.5);
  out.ry = ARC * (0.8 + 0.4 * j);
  out.lean = (hash2f(i, n * 7 + 6) - 0.5) * 0.5 * out.sx;
  return out;
}

/**
 * The scale containing world point (wx, wy): writes the rect of its exposed face (x, y = its top
 * edge, w = its width, h = its row pitch; the rounded top spans the full width, the bottom is
 * covered by the next row) and returns it. The zoom places the Meadow snapshot in one of these.
 */
export function hideScaleAt(wx: number, wy: number, out: Rect): Rect {
  const n = hideRowAt(wy);
  const pitch = hidePitch(n);
  const w = hideWidth(n);
  const off = rowOffset(n, w);
  const i = Math.floor((wx - off) / w);
  const g = scaleGeom(n, i, w, off, geom);
  out.x = g.cx - g.sx;
  out.y = hideRowY(n) + g.top * pitch;
  out.w = g.sx * 2;
  out.h = pitch;
  return out;
}

// ---------------------------------------------------------------- colors (per palette)

interface HideColors {
  palette: Palette;
  /** Average hide tone (the base fill: what tiny rows blend into). */
  base: string;
  rim: string;
  /** Snow over drifted scales (a top-lit gradient would need a context: flat, translucent). */
  drift: string;
  /** Body stops (row-local 0..2), and the atmospheric haze per row. */
  body: readonly (readonly [number, string])[];
  haze: string;
  hazeRamp: readonly string[];
}

let colors: HideColors | null = null;
/** Row-local body gradients, cached per context (the bake canvas and the zoom's main canvas). */
const gradCtx: (CanvasRenderingContext2D | null)[] = [null, null];
const gradVal: (CanvasGradient | null)[] = [null, null];
const gradPal: (Palette | null)[] = [null, null];
let gradNext = 0;

function hideColors(pal: Palette): HideColors {
  if (colors && colors.palette === pal) return colors;
  const tint = pal.depthTint ?? pal.haze;
  const dark = mixHex(pal.silhouette, tint, 0.07);
  const bulge = mixHex(dark, tint, 0.18);
  const snow = mixHex(mixHex('#7580b6', tint, 0.2), pal.silhouette, 0.42);
  const snowDeep = mixHex(mixHex('#3e4570', pal.silhouette, 0.55), tint, 0.08);
  const haze = mixHex(pal.haze, tint, 0.6);
  const hazeRamp: string[] = [];
  for (let i = 0; i <= 16; i++) hazeRamp.push(rgba(haze, i / 16));
  colors = {
    palette: pal,
    base: mixHex(dark, snowDeep, 0.3),
    rim: rgba(mixHex(pal.rim, '#ffd9c8', 0.1), 0.5),
    drift: rgba(mixHex(snow, '#b3bbe8', 0.45), 0.34),
    body: [
      [0, mixHex(bulge, pal.rim, 0.05)],
      [0.1, bulge],
      [0.45, mixHex(dark, bulge, 0.3)],
      [0.8, dark],
      [1.05, mixHex(dark, pal.silhouette, 0.6)],
      [1.28, mixHex(dark, snowDeep, 0.5)],
      [1.42, snow],
      [1.62, mixHex(snow, snowDeep, 0.5)],
      [2.1, mixHex(snowDeep, pal.silhouette, 0.6)],
    ],
    haze,
    hazeRamp,
  };
  return colors;
}

/** Body gradient in row-local units (y 0 = the row's top, 1 = the next row's top, up to 2.1). */
function bodyGradient(ctx: CanvasRenderingContext2D, pal: Palette): CanvasGradient {
  for (let i = 0; i < 2; i++) if (gradCtx[i] === ctx && gradPal[i] === pal) return gradVal[i]!;
  const c = hideColors(pal);
  const g = ctx.createLinearGradient(0, 0, 0, 2.1);
  for (const [at, col] of c.body) g.addColorStop(at / 2.1, col);
  const slot = gradNext;
  gradNext = (gradNext + 1) & 1;
  gradCtx[slot] = ctx;
  gradVal[slot] = g;
  gradPal[slot] = pal;
  return g;
}

/** Haze strength of row n (far rows near the ridge line lean into the atmosphere). */
function rowHaze(pitch: number): number {
  const u = (pitch - HIDE_S0) / 0.2;
  return u >= 1 ? 0 : 0.55 * (1 - u) * (1 - u);
}

/** The base tone: what the hide averages to (draw under tiny rows; the ground layer's fill). */
export function hideBaseColor(pal: Palette): string {
  return hideColors(pal).base;
}

// ---------------------------------------------------------------- drawing

/** Snow lying over scale i of row n, 0..1 (drifts across patches of the hide). */
function drift(n: number, i: number): number {
  const v = nDrift.value2(i * 0.16, n * 0.42) + 0.4 * nDrift.value2(i * 0.6 + 7.1, n * 1.3);
  return v < 0.28 ? 0 : Math.min(1, (v - 0.28) * 2.2);
}

/**
 * Emit the scales of row n over [i0, i1] into the current path, in row-local y. `snowy`: 0 = all,
 * 1 = only scales under a drift.
 */
function traceRow(ctx: CanvasRenderingContext2D, n: number, w: number, off: number, i0: number, i1: number, dx: number, dy: number, snowy = 0): void {
  for (let i = i0; i <= i1; i++) {
    if (snowy && drift(n, i) <= 0) continue;
    const g = scaleGeom(n, i, w, off, geom);
    const cx = g.cx + dx;
    const sx = g.sx;
    const top = g.top + dy;
    const ry = g.ry;
    const lean = g.lean;
    ctx.moveTo(cx - sx, top + ry);
    ctx.bezierCurveTo(cx - sx, top + ry * 0.35, cx - sx * 0.45 + lean, top, cx + lean * 0.6, top);
    ctx.bezierCurveTo(cx + sx * 0.45 + lean, top, cx + sx, top + ry * 0.35, cx + sx, top + ry);
    if (snowy) {
      // A snow cap: the crown only, a lens closing back under it.
      const d = drift(n, i);
      ctx.quadraticCurveTo(cx + lean * 0.3, top + ry * (0.25 + 0.5 * d), cx - sx, top + ry);
    } else {
      ctx.lineTo(cx + sx * 0.8, 2.15 + dy);
      ctx.lineTo(cx - sx * 0.8, 2.15 + dy);
    }
    ctx.closePath();
  }
}

/**
 * Draw the hide over the world rect [x0, x1] x [y0, y1] (y clamped to >= 0) in the current
 * transform (world meters; the caller applies its camera). `pxPerM` = on-screen px per meter
 * (device or CSS: it only sets the level of detail and the rim width). `lx, ly` = unit direction
 * toward the light (palette.light). Allocation-free after the first call per palette and context.
 */
export function drawHide(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pxPerM: number,
  lx: number,
  ly: number,
): void {
  if (!(pxPerM > 0) || !(x1 > x0) || !(y1 > 0)) return;
  const c = hideColors(pal);
  // The base fill starts at the ridge line; the first rows' tops may rise a little above it.
  const top = y0 > 0 ? y0 : 0;
  ctx.fillStyle = c.base;
  ctx.fillRect(x0, top, x1 - x0, y1 - top);
  const grad = bodyGradient(ctx, pal);
  // Rows are drawn from the first one reaching into the rect (it may hang down into it).
  let n = Math.max(0, hideRowAt(top) - 2);
  const nEnd = hideRowAt(y1);
  let budget = MAX_SCALES;
  const rimPx = 1.3;
  for (; n <= nEnd && budget > 0; n++) {
    const pitch = hidePitch(n);
    const px = pitch * pxPerM;
    if (px < MIN_PX) continue;
    const yTop = hideRowY(n);
    if (yTop + pitch * 2.2 < top) continue;
    const w = hideWidth(n);
    const off = rowOffset(n, w);
    const i0 = Math.floor((x0 - off) / w) - 1;
    let i1 = Math.ceil((x1 - off) / w);
    if (i1 - i0 > budget) i1 = i0 + budget;
    budget -= i1 - i0 + 1;
    const fade = px >= FADE_PX ? 1 : (px - MIN_PX) / (FADE_PX - MIN_PX);
    ctx.save();
    ctx.translate(0, yTop);
    ctx.scale(1, pitch);
    ctx.globalAlpha = fade;
    // Rim: the whole shape in the rim color, then the body shifted away from the light.
    const detail = px >= DETAIL_PX;
    const d = detail ? Math.min(0.25, (rimPx * Math.max(1, px / 26)) / px) : 0;
    if (detail) {
      ctx.beginPath();
      traceRow(ctx, n, w, off, i0, i1, 0, 0);
      ctx.fillStyle = c.rim;
      ctx.fill();
    }
    ctx.beginPath();
    traceRow(ctx, n, w, off, i0, i1, -lx * d * pitch, -ly * d);
    ctx.fillStyle = grad;
    ctx.fill();
    // Drifts: snow lying over patches of scales (each only where its own top shows).
    if (detail) {
      ctx.beginPath();
      traceRow(ctx, n, w, off, i0, i1, -lx * d * pitch, -ly * d, 1);
      ctx.fillStyle = c.drift;
      ctx.fill();
    }
    // Atmosphere: far rows lean into the haze.
    const h = rowHaze(pitch);
    if (h > 0.01) {
      ctx.beginPath();
      traceRow(ctx, n, w, off, i0, i1, 0, 0);
      ctx.fillStyle = c.hazeRamp[Math.min(16, Math.round(h * 16))]!;
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
