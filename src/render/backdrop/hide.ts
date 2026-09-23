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
/**
 * Close-up (the zoom's hide beat): rows whose pitch spans NEAR0..NEAR1 px ease into their close
 * look (the haze of distance lifts, the rim sharpens, snow shows packed in the notches, each scale
 * keeled). Below NEAR0 the hide is drawn as it always was: in-tier only the last row, at the foot
 * of the screen (~43 px at 1440 x 900), comes near it.
 */
const NEAR0 = 42;
const NEAR1 = 110;
/**
 * Close up, the drifts over whole crowns are gone by this much of the close look (each caps its
 * crown out to the shoulders, past the notches: up close those tips would show on the neighbours).
 */
const DRIFT_NEAR = 0.35;
/** Height of the snow drifted against a row's crowns (fraction of its pitch). */
const CREVICE = 0.13;
/** Arc height of a scale's rounded top, as a fraction of its row's pitch. */
const ARC = 0.6;
/** A plate reaches this many pitches below its row's top (the next rows cover the rest). */
const PLATE_BOTTOM = 2.15;

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

/** One scale's whole plate in world meters (as traceRow draws it, before the next rows cover it). */
export interface ScaleShape {
  /** Row and index in the row. */
  n: number;
  i: number;
  /** Center x, half-width, and the lean of its crown (m). */
  cx: number;
  sx: number;
  lean: number;
  /** Top of the crown, the arc's height, and the plate's bottom (world y, m). */
  top: number;
  ry: number;
  bottom: number;
  /** The row's top line and pitch (m). */
  rowY: number;
  pitch: number;
}

export function scaleShape(): ScaleShape {
  return { n: 0, i: 0, cx: 0, sx: 0, lean: 0, top: 0, ry: 0, bottom: 0, rowY: 0, pitch: 1 };
}

/** Scale i of row n (see hideScaleShape). */
export function hideScaleOf(n: number, i: number, out: ScaleShape): ScaleShape {
  const pitch = hidePitch(n);
  const w = hideWidth(n);
  const g = scaleGeom(n, i, w, rowOffset(n, w), geom);
  const rowY = hideRowY(n);
  out.n = n;
  out.i = i;
  out.cx = g.cx;
  out.sx = g.sx;
  out.lean = g.lean;
  out.top = rowY + g.top * pitch;
  out.ry = g.ry * pitch;
  out.bottom = rowY + PLATE_BOTTOM * pitch;
  out.rowY = rowY;
  out.pitch = pitch;
  return out;
}

/** The scale containing world point (wx, wy), as its whole plate. */
export function hideScaleShape(wx: number, wy: number, out: ScaleShape): ScaleShape {
  const n = hideRowAt(wy);
  const w = hideWidth(n);
  return hideScaleOf(n, Math.floor((wx - rowOffset(n, w)) / w), out);
}

/** Index of the scale of row n whose slot holds world x. */
export function hideIndexAt(n: number, wx: number): number {
  const w = hideWidth(n);
  return Math.floor((wx - rowOffset(n, w)) / w);
}

/**
 * Emit one scale's whole plate into the current path, in world meters (the caller applies its
 * camera), shifted by (dx, dy): the same curves traceRow draws. `lift` (pitches) raises the crown
 * while the plate still reaches down under the rows in front: a scale sitting proud of its row.
 */
export function traceScale(ctx: CanvasRenderingContext2D, s: ScaleShape, dx = 0, dy = 0, lift = 0): void {
  const cx = s.cx + dx;
  const sx = s.sx;
  const top = s.top + dy - lift * s.pitch;
  const ry = s.ry;
  const lean = s.lean;
  ctx.moveTo(cx - sx, top + ry);
  ctx.bezierCurveTo(cx - sx, top + ry * 0.35, cx - sx * 0.45 + lean, top, cx + lean * 0.6, top);
  ctx.bezierCurveTo(cx + sx * 0.45 + lean, top, cx + sx, top + ry * 0.35, cx + sx, top + ry);
  ctx.lineTo(cx + sx * 0.8, s.bottom + dy);
  ctx.lineTo(cx - sx * 0.8, s.bottom + dy);
  ctx.closePath();
}

/** A snapshot's horizon sits this far down it (the in-tier director's ground line). */
const PICTURE_HORIZON = 0.78;
const faceProbe: ScaleGeom = { cx: 0, sx: 0, top: 0, ry: 0, lean: 0 };

/**
 * Where a picture of aspect `aspect` (height / width) sits in scale `s` (crown raised `lift`
 * pitches): as wide as the plate, placed so its horizon runs just above the next row's crowns,
 * which leaves its sunset band (the sky, the sun, the range, the horizon) in the face that shows;
 * the crown's arc takes the sky's corners, the rows in front its ground. The zoom's meadow and the
 * backdrop's keepsake share it.
 */
export function scalePictureRect(s: ScaleShape, lift: number, aspect: number, out: Rect): Rect {
  const w = s.sx * 2 * 1.02;
  const h = w * aspect;
  const crown = s.top - lift * s.pitch;
  // The face ends at the highest of the next row's crowns in front of this scale's middle.
  const n1 = s.n + 1;
  const p1 = hidePitch(n1);
  const w1 = hideWidth(n1);
  const off1 = rowOffset(n1, w1);
  const y1 = hideRowY(n1);
  let face = Infinity;
  for (let k = 0; k < 5; k++) {
    const x = s.cx + s.sx * (-0.6 + 0.3 * k);
    const g = scaleGeom(n1, Math.floor((x - off1) / w1), w1, off1, faceProbe);
    const top = y1 + g.top * p1;
    if (top < face) face = top;
  }
  out.x = s.cx - w * 0.5;
  out.y = Math.min(face - PICTURE_HORIZON * h, crown - 0.04 * h);
  out.w = w;
  out.h = h;
  return out;
}

// ---------------------------------------------------------------- colors (per palette)

interface HideColors {
  palette: Palette;
  /** Average hide tone (the base fill: what tiny rows blend into). */
  base: string;
  rim: string;
  /** The close-up rim: brighter, nearly opaque. */
  rimNear: string;
  /** Close up: snow drifted against each row's crowns, and its lit crest. */
  crevice: string;
  creviceLit: string;
  /** Close up: the dark seam each crown casts on the row behind, and a scale's shadowed half. */
  occlusion: string;
  shade: string;
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
/** The close-up body (the pockets' soft snow band gives way to the mounds), cached the same way. */
const nearCtx: (CanvasRenderingContext2D | null)[] = [null, null];
const nearVal: (CanvasGradient | null)[] = [null, null];
const nearPal: (Palette | null)[] = [null, null];
let nearNext = 0;


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
    rimNear: rgba(mixHex(pal.rim, '#ffe8dc', 0.3), 0.9),
    crevice: mixHex(mixHex('#aab3ea', tint, 0.18), pal.silhouette, 0.2),
    creviceLit: mixHex(mixHex('#e6eaff', pal.rim, 0.25), tint, 0.05),
    occlusion: rgba(pal.silhouette, 0.72),
    shade: rgba(mixHex(pal.silhouette, '#000000', 0.3), 0.5),
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

/**
 * The body close up: darker than far off (no distance in it), sky light on the bulges, then
 * near-black on down (no soft snow band in the pockets: the notches hold the snow). One slow ramp
 * over every height a crown takes in its row (crowns rise and sink up to most of a pitch around
 * the row's line): any tighter band would cut across the scales, the same height on all of them.
 */
function nearGradient(ctx: CanvasRenderingContext2D, pal: Palette): CanvasGradient {
  for (let i = 0; i < 2; i++) if (nearCtx[i] === ctx && nearPal[i] === pal) return nearVal[i]!;
  const tint = pal.depthTint ?? pal.haze;
  const dark = mixHex(pal.silhouette, tint, 0.05);
  const g = ctx.createLinearGradient(0, -0.9, 0, 2.1);
  const at = (y: number): number => (y + 0.9) / 3;
  g.addColorStop(0, mixHex(mixHex(dark, tint, 0.3), pal.rim, 0.1));
  g.addColorStop(at(-0.2), mixHex(dark, tint, 0.24));
  g.addColorStop(at(0.35), mixHex(dark, tint, 0.11));
  g.addColorStop(at(0.85), dark);
  g.addColorStop(at(1.35), mixHex(dark, pal.silhouette, 0.7));
  g.addColorStop(1, pal.silhouette);
  const slot = nearNext;
  nearNext = (nearNext + 1) & 1;
  nearCtx[slot] = ctx;
  nearVal[slot] = g;
  nearPal[slot] = pal;
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

// ---------------------------------------------------------------- close up: notches and keels

/** One coordinate of a cubic Bezier at t. */
function bez(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * (u * p0 + 3 * t * p1) + t * t * (3 * u * p2 + t * p3);
}

/** The t at which a cubic whose x rises monotonically reaches x (clamped to 0..1). */
function bezAt(p0: number, p1: number, p2: number, p3: number, x: number): number {
  if (x <= p0) return 0;
  if (x >= p3) return 1;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 13; k++) {
    const m = (lo + hi) * 0.5;
    if (bez(p0, p1, p2, p3, m) < x) lo = m;
    else hi = m;
  }
  return (lo + hi) * 0.5;
}

// A crown is two cubics (traceRow's): the left half from the shoulder up to the apex (x rising,
// y falling), the right half from the apex down to the other shoulder (x and y rising).
/** Row-local y of scale g's left half-crown at x, and the t there (crownT). */
let crownT = 0;
function leftCrownY(g: ScaleGeom, x: number): number {
  const t = bezAt(g.cx - g.sx, g.cx - g.sx, g.cx - g.sx * 0.45 + g.lean, g.cx + g.lean * 0.6, x);
  crownT = t;
  return bez(g.top + g.ry, g.top + g.ry * 0.35, g.top, g.top, t);
}
function rightCrownY(g: ScaleGeom, x: number): number {
  const t = bezAt(g.cx + g.lean * 0.6, g.cx + g.sx * 0.45 + g.lean, g.cx + g.sx, g.cx + g.sx, x);
  crownT = t;
  return bez(g.top, g.top, g.top + g.ry * 0.35, g.top + g.ry, t);
}

/**
 * The notch between scales i and i + 1 of each close row: where the right half of i's crown meets
 * the left half of i + 1's (or, where one sits much lower, the foot of the other's side), solved on
 * the true curves. Static geometry, so cached by (row, index) in a two-way set-associative table:
 * the solve is a few hundred curve evaluations, the lookup free. Row-local (x m, y pitches).
 */
const V_SETS = 2048;
const vKey = new Float64Array(V_SETS * 2).fill(NaN);
const vAge = new Uint32Array(V_SETS * 2);
/** The notch point, the t on i's right half-crown and on i + 1's left one, and the pair's overlap. */
const vX = new Float64Array(V_SETS * 2);
const vY = new Float64Array(V_SETS * 2);
const vTA = new Float64Array(V_SETS * 2);
const vTB = new Float64Array(V_SETS * 2);
const vGap = new Float64Array(V_SETS * 2);
let vClock = 0;
const notchA: ScaleGeom = { cx: 0, sx: 0, top: 0, ry: 0, lean: 0 };
const notchB: ScaleGeom = { cx: 0, sx: 0, top: 0, ry: 0, lean: 0 };

/** Slot of the notch between scales i and i + 1 of row n (solved on a miss). */
function notch(n: number, i: number, w: number, off: number): number {
  const key = n * 4194304 + i;
  const set = ((Math.imul(n, 0x9e3779b1) ^ Math.imul(i, 0x85ebca6b)) >>> 0) & (V_SETS - 1);
  let s = set * 2;
  if (vKey[s] === key) return s;
  if (vKey[s + 1] === key) return s + 1;
  if (vAge[s + 1] < vAge[s]) s++;
  vKey[s] = key;
  vAge[s] = ++vClock;
  const a = scaleGeom(n, i, w, off, notchA);
  const b = scaleGeom(n, i + 1, w, off, notchB);
  // The crossing lies between i's apex and right shoulder and between i + 1's left shoulder and
  // apex; on that span a's crown falls as b's rises (a single root, or none: a side shows).
  const lo0 = Math.max(a.cx + a.lean * 0.6, b.cx - b.sx);
  const hi0 = Math.min(a.cx + a.sx, b.cx + b.lean * 0.6);
  let x: number;
  if (!(hi0 > lo0) || rightCrownY(a, lo0) >= leftCrownY(b, lo0)) x = lo0;
  else if (rightCrownY(a, hi0) <= leftCrownY(b, hi0)) x = hi0;
  else {
    let lo = lo0;
    let hi = hi0;
    for (let k = 0; k < 13; k++) {
      const m = (lo + hi) * 0.5;
      if (rightCrownY(a, m) < leftCrownY(b, m)) lo = m;
      else hi = m;
    }
    x = (lo + hi) * 0.5;
  }
  const ya = rightCrownY(a, x);
  vTA[s] = crownT;
  const yb = leftCrownY(b, x);
  vTB[s] = crownT;
  vX[s] = x;
  vY[s] = Math.max(ya, yb);
  vGap[s] = Math.min(a.cx + a.sx - (b.cx - b.sx), (a.sx + b.sx) * 0.5);
  return s;
}

/** The notch between scales i and i + 1 of row n, in world meters (the close look's V). */
export function hideNotchAt(n: number, i: number, out: { x: number; y: number }): { x: number; y: number } {
  const w = hideWidth(n);
  const s = notch(n, i, w, rowOffset(n, w));
  out.x = vX[s]!;
  out.y = hideRowY(n) + vY[s]! * hidePitch(n);
  return out;
}

/**
 * Close up: the half of each scale of row n turned away from the light (`lx` > 0: its left) in
 * shadow, in row-local y: a keel runs down from the crown's apex, and the shadow reaches out along
 * the crown to the notch and straight down from it (a crease between the scales: each keeps to its
 * own face, never over its neighbour's).
 */
function traceKeels(ctx: CanvasRenderingContext2D, n: number, w: number, off: number, i0: number, i1: number, dx: number, dy: number, lx: number): void {
  const left = lx >= 0;
  const bottom = PLATE_BOTTOM + dy;
  for (let i = i0; i <= i1; i++) {
    const s = notch(n, left ? i - 1 : i, w, off);
    const g = scaleGeom(n, i, w, off, geom);
    const top = g.top + dy;
    const ry = g.ry;
    const ax = g.cx + g.lean * 0.6 + dx;
    ctx.moveTo(ax, top);
    if (left) {
      // The left half-crown (shoulder P0 .. apex P3) from its notch t up to the apex, walked back
      // down from the apex: de Casteljau's right part at t, reversed.
      const t = vTB[s];
      const p0x = g.cx - g.sx + dx;
      const p2x = g.cx - g.sx * 0.45 + g.lean + dx;
      const p0y = top + ry;
      const p1y = top + ry * 0.35;
      const q12x = p0x + (p2x - p0x) * t;
      const q12y = p1y + (top - p1y) * t;
      const r2x = p2x + (ax - p2x) * t;
      const r1x = q12x + (r2x - q12x) * t;
      const r1y = q12y + (top - q12y) * t;
      const s0x = p0x;
      const s0y = p0y + (p1y - p0y) * t;
      const q01x = s0x + (q12x - s0x) * t;
      const q01y = s0y + (q12y - s0y) * t;
      ctx.bezierCurveTo(r2x, top, r1x, r1y, q01x + (r1x - q01x) * t, q01y + (r1y - q01y) * t);
    } else {
      // The right half-crown (apex Q0 .. shoulder Q3) from the apex to its notch t: de Casteljau's
      // left part at t.
      const t = vTA[s];
      const q1x = g.cx + g.sx * 0.45 + g.lean + dx;
      const q2x = g.cx + g.sx + dx;
      const q2y = top + ry * 0.35;
      const q3y = top + ry;
      const l1x = ax + (q1x - ax) * t;
      const m12x = q1x + (q2x - q1x) * t;
      const m12y = top + (q2y - top) * t;
      const l2x = l1x + (m12x - l1x) * t;
      const l2y = top + (m12y - top) * t;
      const m23x = q2x;
      const m23y = q2y + (q3y - q2y) * t;
      const r1x = m12x + (m23x - m12x) * t;
      const r1y = m12y + (m23y - m12y) * t;
      ctx.bezierCurveTo(l1x, top, l2x, l2y, l2x + (r1x - l2x) * t, l2y + (r1y - l2y) * t);
    }
    ctx.lineTo(vX[s] + dx, bottom);
    ctx.lineTo(g.cx + g.lean * 0.15 + dx, bottom);
    ctx.closePath();
  }
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
      ctx.lineTo(cx + sx * 0.8, PLATE_BOTTOM + dy);
      ctx.lineTo(cx - sx * 0.8, PLATE_BOTTOM + dy);
    }
    ctx.closePath();
  }
}

/** Options for drawHide (all optional). */
export interface HideOpts {
  /** Opacity of everything drawn (1). */
  alpha?: number;
  /** Skip rows before this one (0): redraw the rows in front of a scale over it. */
  rowMin?: number;
  /** Paint the base tone under the rows (true); off when drawing over existing hide. */
  base?: boolean;
}

/**
 * Emit the silhouettes of the rows from `rowMin` on that drawHide(..., { rowMin }) would draw over
 * the world rect, into the current path in world meters (the caller applied its camera): a clip
 * for light that must fall on those rows only.
 */
export function traceRows(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, pxPerM: number, rowMin: number): void {
  if (!(pxPerM > 0) || !(x1 > x0) || !(y1 > 0)) return;
  const top = y0 > 0 ? y0 : 0;
  const nEnd = hideRowAt(y1);
  for (let n = Math.max(rowMin, hideRowAt(top) - 2); n <= nEnd; n++) {
    const pitch = hidePitch(n);
    if (pitch * pxPerM < MIN_PX) continue;
    const yTop = hideRowY(n);
    if (yTop + pitch * 2.2 < top) continue;
    const w = hideWidth(n);
    const off = rowOffset(n, w);
    ctx.save();
    ctx.translate(0, yTop);
    ctx.scale(1, pitch);
    traceRow(ctx, n, w, off, Math.floor((x0 - off) / w) - 1, Math.ceil((x1 - off) / w), 0, 0);
    ctx.restore();
  }
}

/**
 * Snow mounds in the notches of row n (row-local y, units of pitch), shifted up by dy: one where
 * each pair of neighboring crowns meet, sized and present by a hash (a third stay bare). Drawn
 * before the row, so its own crowns cover the mounds' lower halves.
 */
function traceNotches(ctx: CanvasRenderingContext2D, n: number, w: number, off: number, i0: number, i1: number, dy: number): void {
  for (let i = i0; i < i1; i++) {
    const h = hash2f(i, n * 7 + 9);
    if (h < 0.33) continue;
    const s = notch(n, i, w, off);
    const gap = vGap[s];
    if (!(gap > 0)) continue;
    const x = vX[s];
    const y = vY[s] + dy;
    const rx = gap * (0.3 + 0.22 * h);
    const ry = CREVICE * (0.42 + 0.45 * h);
    ctx.moveTo(x + rx, y);
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
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
  opts?: HideOpts,
): void {
  if (!(pxPerM > 0) || !(x1 > x0) || !(y1 > 0)) return;
  const alpha = opts?.alpha ?? 1;
  if (!(alpha > 0.002)) return;
  const c = hideColors(pal);
  // The base fill starts at the ridge line; the first rows' tops may rise a little above it.
  const top = y0 > 0 ? y0 : 0;
  if (opts?.base !== false) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = c.base;
    ctx.fillRect(x0, top, x1 - x0, y1 - top);
  }
  const grad = bodyGradient(ctx, pal);
  // Rows are drawn from the first one reaching into the rect (it may hang down into it).
  let n = Math.max(opts?.rowMin ?? 0, hideRowAt(top) - 2);
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
    const near = px <= NEAR0 ? 0 : px >= NEAR1 ? 1 : ((px - NEAR0) / (NEAR1 - NEAR0)) ** 2 * (3 - (2 * (px - NEAR0)) / (NEAR1 - NEAR0));
    ctx.save();
    ctx.translate(0, yTop);
    ctx.scale(1, pitch);
    ctx.globalAlpha = fade * alpha;
    // Rim: the whole shape in the rim color, then the body shifted away from the light.
    const detail = px >= DETAIL_PX;
    const d = detail ? Math.min(0.25, (rimPx * Math.max(1, px / 26)) / px) : 0;
    if (detail && near > 0.01 && n > 0) {
      // Close up: the seam each crown presses into the row behind (a dark line just above it: the
      // scales overlap), then snow lodged in the notches between the crowns (mounds laid on the row
      // behind, half covered by this row's crowns), some notches full, some bare.
      ctx.globalAlpha = fade * alpha * near;
      ctx.beginPath();
      traceRow(ctx, n, w, off, i0, i1, 0, -0.07);
      ctx.fillStyle = c.occlusion;
      ctx.fill();
      const sn = Math.min(1, near * 1.6);
      ctx.globalAlpha = fade * alpha * sn;
      ctx.beginPath();
      traceNotches(ctx, n, w, off, i0, i1, 0);
      ctx.fillStyle = c.crevice;
      ctx.fill();
      ctx.beginPath();
      traceNotches(ctx, n, w, off, i0, i1, -0.028);
      ctx.fillStyle = c.creviceLit;
      ctx.globalAlpha = fade * alpha * sn * 0.75;
      ctx.fill();
      ctx.globalAlpha = fade * alpha;
    }
    if (detail) {
      ctx.beginPath();
      traceRow(ctx, n, w, off, i0, i1, 0, 0);
      ctx.fillStyle = c.rim;
      ctx.fill();
      if (near > 0.01) {
        ctx.globalAlpha = fade * alpha * near;
        ctx.fillStyle = c.rimNear;
        ctx.fill();
        ctx.globalAlpha = fade * alpha;
      }
    }
    ctx.beginPath();
    traceRow(ctx, n, w, off, i0, i1, -lx * d * pitch, -ly * d);
    ctx.fillStyle = grad;
    ctx.fill();
    if (near > 0.01) {
      ctx.globalAlpha = fade * alpha * near;
      ctx.fillStyle = nearGradient(ctx, pal);
      ctx.fill();
      // Keeled: each scale's half away from the light in shadow.
      ctx.beginPath();
      traceKeels(ctx, n, w, off, i0, i1, -lx * d * pitch, -ly * d, lx);
      ctx.fillStyle = c.shade;
      ctx.fill();
      ctx.globalAlpha = fade * alpha;
    }
    // Drifts: snow lying over patches of scales (each only where its own top shows); close up the
    // snow keeps to the notches.
    const dr = near < DRIFT_NEAR ? (1 - near / DRIFT_NEAR) * (1 - near / DRIFT_NEAR) : 0;
    if (detail && dr > 0.01) {
      ctx.globalAlpha = fade * alpha * dr;
      ctx.beginPath();
      traceRow(ctx, n, w, off, i0, i1, -lx * d * pitch, -ly * d, 1);
      ctx.fillStyle = c.drift;
      ctx.fill();
      ctx.globalAlpha = fade * alpha;
    }
    // Atmosphere: far rows lean into the haze (lifting close up: the zoom brings them near).
    const h = rowHaze(pitch) * (1 - near) * (1 - near);
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

/**
 * The meadow's scale (the zoom leaves the old tier in one plate of the hide): scale `s` drawn as
 * the hide draws it (rim, then the body inset away from the light) with `picture` faint inside and
 * a warm cast, then the rows in front of it laid back over it, only where it is. World transform
 * applied by the caller; `warm` 0..1 scales the picture and the warmth. Allocation-free.
 */
export function drawMarkedScale(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  s: ScaleShape,
  picture: HTMLCanvasElement | null,
  pxPerM: number,
  lx: number,
  ly: number,
  warm: number,
  lift = 0,
): void {
  const px = s.pitch * pxPerM;
  if (px < MIN_PX || warm <= 0.002) return;
  const c = hideColors(pal);
  const d = px >= DETAIL_PX ? Math.min(0.25, (1.3 * Math.max(1, px / 26)) / px) : 0;
  ctx.save();
  ctx.beginPath();
  traceScale(ctx, s, 0, 0, lift);
  ctx.fillStyle = c.rim;
  ctx.fill();
  ctx.beginPath();
  traceScale(ctx, s, -lx * d * s.pitch, -ly * d * s.pitch, lift);
  ctx.clip();
  ctx.save();
  ctx.translate(0, s.rowY - lift * s.pitch);
  ctx.scale(1, s.pitch);
  ctx.fillStyle = bodyGradient(ctx, pal);
  ctx.fillRect(s.cx - s.sx - 0.1, -1, s.sx * 2 + 0.2, PLATE_BOTTOM + lift + 2);
  ctx.restore();
  if (picture && picture.width > 0) {
    const r = scalePictureRect(s, lift, picture.height / picture.width, markRect);
    ctx.globalAlpha = KEEPSAKE_PICTURE * warm;
    ctx.drawImage(picture, r.x, r.y, r.w, r.h);
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.1 * warm;
  ctx.fillStyle = pal.sun.glow;
  ctx.fillRect(s.cx - s.sx, s.top - lift * s.pitch, s.sx * 2, s.bottom - s.top + lift * s.pitch);
  ctx.restore();
  // The rows in front of it, back over it (only inside it: everything else is already drawn).
  ctx.save();
  ctx.beginPath();
  traceScale(ctx, s, 0, 0, lift);
  ctx.clip();
  markOpts.rowMin = s.n + 1;
  drawHide(ctx, pal, s.cx - s.sx * 1.2, s.rowY + s.pitch * 0.5, s.cx + s.sx * 1.2, s.bottom + s.pitch, pxPerM, lx, ly, markOpts);
  ctx.restore();
}

const markOpts: HideOpts = { rowMin: 0, base: false };

const markRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
/** How strongly the old tier shows in the meadow's scale (faint: an easter egg for who looks). */
const KEEPSAKE_PICTURE = 0.4;
