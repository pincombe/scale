// The Mountain's silhouette layers (WP 2.3). Mountains at first glance; a wyrm once you know:
//
//   farCoil  the wyrm's far coils rising out of the cloud sea like a sea serpent's humps, each
//            carrying a row of small plates, silhouetted against the afterglow the sun set behind
//   spine    the range: the back of the world wyrm, one colossal body arching from the far left
//            (small, dense plates: receding) to its shoulders, every peak a dorsal plate leaning
//            toward the tail, in a double row; snow, alpenglow on the faces toward the afterglow,
//            blue shadow on the others. Past the shoulders, a low saddle: the head rests behind it
//   slopes   nearer ridges poking out of the cloud sea, furred with pine forest (a moss, at this
//            scale) and a speck of a castle
//
// Coordinates: layer units (x right, height up; the bake draws at y = -height), as the Meadow.
import type { Palette } from '../palette';
import type { FaceColors } from './wyrm';
import type { RidgeDef } from './ridges';
import { mixHex, rgba } from '../../lib/color';
import { Noise } from '../../lib/noise';
import { clamp01, hash2f, smoothstep } from '../../lib/math';

// ---------------------------------------------------------------- shape helpers

/** Catmull-Rom through (xs, ys), clamped to the end values outside. */
export function spline(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
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

/** Smooth max (blends two silhouettes without a crease). */
function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

function ridged(n: Noise, x: number, y: number): number {
  const v = 1 - Math.abs(n.simplex2(x, y));
  return v * v;
}

/** One dorsal plate: apex x, height above the body, flank widths (tail side left, head side right). */
export interface Plate {
  x: number;
  /** Body height under the apex, and the plate's rise above it. */
  base: number;
  h: number;
  wl: number;
  wr: number;
  /** 0 = the near row, 1 = the far row (hazier, lower). */
  row: number;
  seed: number;
}

/**
 * Plate profile: sharp tip, slightly concave flanks, steep on the tail (left) side. `b` = the
 * body's height at x: each flank runs from the summit down to the body where it lands (so a plate
 * on a falling back has no step at its foot).
 */
function plateAt(p: Plate, x: number, b: number): number {
  const d = x - p.x;
  const top = p.base + p.h;
  if (d < 0) {
    const t = -d / p.wl;
    return t >= 1 ? -Infinity : b + (top - b) * Math.pow(1 - t, 1.12);
  }
  const t = d / p.wr;
  return t >= 1 ? -Infinity : b + (top - b) * Math.pow(1 - t, 1.45);
}

/** Plates along [x0, x1]: spacing and height from envelopes, a far row in the gaps. */
function makePlates(
  x0: number,
  x1: number,
  spacing: (x: number) => number,
  size: (x: number) => number,
  body: (x: number) => number,
  seed: number,
  farRow: number,
): Plate[] {
  const out: Plate[] = [];
  let x = x0;
  let i = 0;
  while (x < x1) {
    const d = spacing(x);
    const j = hash2f(i, seed);
    const h = size(x) * (0.72 + 0.5 * j);
    if (h > 0.02) out.push({ x, base: body(x), h, wl: d * (0.5 + 0.1 * j), wr: d * (0.9 + 0.14 * hash2f(i, seed + 1)), row: 0, seed: i });
    if (farRow > 0) {
      const xm = x + d * (0.5 + 0.14 * (hash2f(i, seed + 2) - 0.5));
      const hm = size(xm) * farRow * (0.8 + 0.4 * hash2f(i, seed + 3));
      if (hm > 0.02) out.push({ x: xm, base: body(xm), h: hm, wl: d * 0.42, wr: d * 0.72, row: 1, seed: i + 5000 });
    }
    x += d * (0.85 + 0.3 * hash2f(i, seed + 9));
    i++;
  }
  // Paint order: the far row first.
  out.sort((a, b) => a.row === b.row ? a.x - b.x : b.row - a.row);
  return out;
}

/** Highest plate at x (-Infinity if none): a linear scan over a short, sorted window. */
function platesAt(plates: readonly Plate[], x: number, reach: number, b: number): number {
  let h = -Infinity;
  for (let i = 0; i < plates.length; i++) {
    const p = plates[i]!;
    if (p.x < x - reach || p.x > x + reach) continue;
    const v = plateAt(p, x, b);
    if (v > h) h = v;
  }
  return h;
}

// ---------------------------------------------------------------- the far coils

const nF = new Noise(0x5eed1);

/** The horizon line the coils rise out of (the far cloud sea's top), layer units. */
const COIL_BASE = 0.9;
/** Humps: center, half-width, rise above COIL_BASE. */
const HUMPS: readonly (readonly [number, number, number])[] = [
  [-8.6, 2.6, 0.95],
  [-3.4, 2.3, 1.15],
  [1.9, 2.0, 0.85],
  [7.2, 2.4, 1.05],
  [12.4, 2.2, 0.8],
];

function coilBody(x: number): number {
  let h = COIL_BASE - 0.4;
  for (const [c, w, r] of HUMPS) {
    const u = (x - c) / w;
    if (u > -1 && u < 1) h = Math.max(h, COIL_BASE - 0.3 + (r + 0.3) * Math.sqrt(1 - u * u));
  }
  return h;
}

const COIL_PLATES = makePlates(
  -14,
  16,
  (x) => 0.42 + 0.14 * nF.n1(x * 0.4 + 3),
  (x) => {
    // Plates only where a hump rises clear of the clouds, biggest on its crown.
    const lift = coilBody(x) - COIL_BASE;
    return lift > 0 ? 0.42 * smoothstep(0.1, 0.7, lift) : 0;
  },
  coilBody,
  71,
  0,
);

export const FAR_COIL: RidgeDef = {
  name: 'farCoil',
  p: 0.035,
  maxH: 2.6,
  decoH: 0,
  tone: 0.3,
  baseTone: 0.12,
  rim: 0.95,
  rimPx: 1.3,
  edge: 0.5,
  texture: 0.05,
  baseSky: 0.55,
  maxDpr: 1,
  headroom: 1,
  height(x) {
    const b = coilBody(x) + 0.03 * nF.simplex2(x * 2.3, 1.7);
    return smax(b, platesAt(COIL_PLATES, x, 0.6, coilBody(x)), 0.05);
  },
};

// ---------------------------------------------------------------- the spine (the range)

const nS = new Noise(0x5b1e);

/** The back the plates rise from: low at the far left (receding), the shoulders, the saddle. */
const BODY_X = [-15, -11, -8, -5, -2.5, -0.5, 1.0, 2.0, 2.9, 3.8, 4.8, 6.0, 7.5, 10, 15];
const BODY_Y = [0.5, 0.72, 1.02, 1.36, 1.6, 1.7, 1.66, 1.46, 1.3, 1.26, 1.3, 1.44, 1.36, 1.05, 0.7];
/** Plate rise along the back: small far away, tallest mid-back, easing off at the shoulders. */
const SIZE_X = [-15, -11, -8, -5, -2.8, -1.2, 0.4, 1.5, 2.2];
const SIZE_Y = [0.35, 0.62, 1.05, 1.6, 2.2, 2.1, 1.45, 0.75, 0];
/** Plates end at the shoulders: past them the neck dips behind the saddle to the head. */
export const SPINE_END = 2.2;

export function spineBody(x: number): number {
  return spline(BODY_X, BODY_Y, x);
}

export const SPINE_PLATES = makePlates(
  -15,
  SPINE_END,
  (x) => 0.55 + 1.0 * smoothstep(-14, -0.5, x),
  (x) => Math.max(0, spline(SIZE_X, SIZE_Y, x)),
  spineBody,
  37,
  0.55,
);

/** Rise envelope at x (for crags scaled to the local plate size). */
function spineSize(x: number): number {
  return Math.max(0, spline(SIZE_X, SIZE_Y, Math.min(x, SPINE_END)));
}

/** Weathering so the plates read as rock: crags scaled to the plate, fine grit everywhere. */
function spineCrag(x: number): number {
  const env = spineSize(x);
  return (0.04 + 0.06 * env) * (ridged(nS, x * 2.6, 2.2) - 0.45) + 0.035 * env * (ridged(nS, x * 7.3, 6.6) - 0.45) + 0.01 * nS.simplex2(x * 17, 5.1);
}

export function spineHeight(x: number): number {
  const b = spineBody(x);
  return smax(b, platesAt(SPINE_PLATES, x, 1.8, b), 0.06) + spineCrag(x);
}

/** Painted faces, snow and rock over the spine's silhouette (source-atop, layer units). */
function paintSpine(ctx: CanvasRenderingContext2D, pal: Palette, c: FaceColors): void {
  paintPlates(ctx, pal, c, SPINE_PLATES, 1);
}

export const SPINE: RidgeDef = {
  name: 'spine',
  p: 0.085,
  maxH: 4.4,
  decoH: 0,
  tone: 0.6,
  baseTone: 0.22,
  rim: 0.75,
  rimPx: 1.3,
  texture: 0.16,
  baseSky: 0.35,
  maxDpr: 1.5,
  headroom: 1,
  height: spineHeight,
  paint: paintSpine,
};

// ---------------------------------------------------------------- plate painting

const nP = new Noise(0x9a1e);

/**
 * Alpenglow: the last light catches the upper faces turned toward the afterglow (pink-gold snow),
 * the rest of the range is in blue shadow; lower down, rock ribs break through the snow. Plates
 * paint left to right, each over its own profile, so nearer (right) plates occlude the ones
 * behind them, as the body recedes to the left.
 */
function paintPlates(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  c: FaceColors,
  plates: readonly Plate[],
  strength: number,
): void {
  const lightX = c.lightX ?? 0;
  const glowSnow = mixHex(mixHex('#fff1e2', pal.rim, 0.18), '#ffffff', 0.15);
  const gold = mixHex('#ffbe6e', pal.rim, 0.2);
  const rose = mixHex('#ec6f8c', pal.rim, 0.1);
  const shadeSnow = mixHex('#7f89c8', pal.depthTint ?? pal.haze, 0.3);
  const rockLit = mixHex('#6b3450', c.crest, 0.3);
  const rockShade = mixHex(pal.silhouette, c.crest, 0.45);
  const rim = mixHex(pal.rim, '#ffe6d6', 0.3);
  // The layer's own body gradient (as RidgeCache.bake), so plates occlude without a seam.
  const base = c.base ?? c.crest;
  const body = ctx.createLinearGradient(0, -SPINE.maxH * 0.75, 0, 0.02);
  body.addColorStop(0, mixHex(c.crest, mixHex(pal.sun.glow, pal.accent.ember, 0.5), 0.12));
  body.addColorStop(0.3, c.crest);
  body.addColorStop(0.62, mixHex(c.crest, base, 0.4));
  body.addColorStop(1, base);
  const bodyFar = ctx.createLinearGradient(0, -SPINE.maxH * 0.75, 0, 0.02);
  bodyFar.addColorStop(0, mixHex(c.crest, pal.haze, 0.2));
  bodyFar.addColorStop(0.62, mixHex(mixHex(c.crest, base, 0.4), pal.haze, 0.15));
  bodyFar.addColorStop(1, base);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let i = 0; i < plates.length; i++) {
    const p = plates[i]!;
    const far = p.row === 1;
    // How much of the last light this plate still gets: the tallest catch it, the far row less.
    const tall = clamp01((p.base + p.h - 1.7) / 2.0);
    const light = strength * (far ? 0.6 : 1) * (0.3 + 0.7 * tall);
    const apexY = -(p.base + p.h + spineCrag(p.x)) - 0.006;
    // Faces run on down under the cloud sea (no visible cut).
    const baseY = -p.base + 0.95;
    // Each plate's light is its own: some catch more gold, some more rose.
    const warm = hash2f(p.seed, 77);
    const s = lightX >= p.x ? 1 : -1;
    const wLit = s > 0 ? p.wr : p.wl;
    const wShade = s > 0 ? p.wl : p.wr;
    const snowLine = apexY + p.h * (0.52 + 0.16 * nP.n1(p.seed * 1.7 + (far ? 40 : 0)));
    // The arete: from the summit down across the face, drifting to the shade side.
    const ax = p.x - s * wShade * 0.22;

    // Shade face: opaque rock over our own flank (occludes the plate behind), cool snow on top.
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.moveTo(p.x, apexY);
      flank(ctx, p, -s, wShade);
      ctx.lineTo(ax, baseY);
      arete(ctx, p, ax, apexY, baseY, s);
      ctx.closePath();
      if (pass === 0) {
        ctx.fillStyle = far ? bodyFar : body;
      } else {
        const g = ctx.createLinearGradient(0, apexY, 0, snowLine + p.h * 0.12);
        g.addColorStop(0, rgba(shadeSnow, (far ? 0.45 : 0.7) * strength));
        g.addColorStop(0.5, rgba(shadeSnow, (far ? 0.2 : 0.34) * strength));
        g.addColorStop(1, rgba(shadeSnow, 0));
        ctx.fillStyle = g;
      }
      ctx.fill();
    }

    // Lit face: alpenglow snow at the summit, gold then rose lower, into shadow at the snow line.
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.moveTo(p.x, apexY);
      flank(ctx, p, s, wLit);
      ctx.lineTo(ax, baseY);
      arete(ctx, p, ax, apexY, baseY, s);
      ctx.closePath();
      if (pass === 0) {
        ctx.fillStyle = far ? bodyFar : body;
        ctx.fill();
        // Warm rock under the snow line, catching a little of the light too.
        // (fading out above the plate's foot, so it never meets the body in a seam)
        const r = ctx.createLinearGradient(0, snowLine - p.h * 0.2, 0, Math.min(snowLine + p.h * 0.45, -p.base - 0.12));
        r.addColorStop(0, rgba(rockLit, 0.55 * light));
        r.addColorStop(1, rgba(rockLit, 0));
        ctx.fillStyle = r;
      } else {
        const g = ctx.createLinearGradient(0, apexY, 0, snowLine + p.h * 0.25);
        g.addColorStop(0, rgba(glowSnow, light));
        g.addColorStop(0.1, rgba(mixHex(glowSnow, gold, 0.35 + 0.3 * warm), 0.96 * light));
        g.addColorStop(0.38, rgba(mixHex(gold, rose, 0.35 + 0.35 * (1 - warm)), 0.8 * light));
        g.addColorStop(0.72, rgba(rose, 0.4 * light));
        g.addColorStop(1, rgba(rose, 0));
        ctx.fillStyle = g;
      }
      ctx.fill();
    }

    // Rock ribs and snow chutes running down the face, parallel-ish to its flank.
    const ribs = 4 + Math.round(p.h * 3);
    for (let k = 0; k < ribs; k++) {
      const u = hash2f(p.seed * 13 + k, far ? 9 : 7);
      const onLit = hash2f(p.seed * 13 + k, 21) < 0.6;
      const side = onLit ? s : -s;
      const w = onLit ? wLit : wShade;
      const fx = p.x + side * w * (0.08 + 0.55 * u);
      const top = -plateAt(p, fx, spineBody(fx)) - spineCrag(fx);
      const chute = hash2f(k, p.seed + 11) < 0.4;
      const y0 = top + 0.03 + p.h * (chute ? 0.05 : 0.25) * hash2f(k, p.seed);
      const len = p.h * (chute ? 0.2 + 0.25 * hash2f(k, p.seed + 3) : 0.12 + 0.2 * hash2f(k, p.seed + 3));
      // Along the flank: dx/dy of the flank line, blended toward the fall line.
      const fl = (side * w) / p.h;
      const dxl = fl * 0.55 * len;
      const col = chute ? (onLit ? glowSnow : shadeSnow) : onLit ? rockLit : rockShade;
      const a = chute ? (onLit ? 0.3 * light : 0.25 * strength) : (far ? 0.18 : 0.3) * strength;
      ctx.strokeStyle = rgba(col, a);
      ctx.lineWidth = chute ? 0.02 + 0.02 * u : 0.012 + 0.012 * hash2f(k, p.seed + 7);
      ctx.beginPath();
      ctx.moveTo(fx, y0);
      ctx.quadraticCurveTo(fx + dxl * 0.35, y0 + len * 0.5, fx + dxl, y0 + len);
      ctx.stroke();
    }

    // The last light on the lit ridgeline: a crisp rim fading down the flank.
    const rg = ctx.createLinearGradient(0, apexY, 0, apexY + p.h * 0.7);
    rg.addColorStop(0, rgba(rim, 0.9 * light));
    rg.addColorStop(1, rgba(rim, 0));
    ctx.strokeStyle = rg;
    ctx.lineWidth = far ? 0.012 : 0.018;
    ctx.beginPath();
    ctx.moveTo(p.x, apexY);
    flank(ctx, p, s, wLit * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

/** Continue the path down plate p's own flank on side `side` (+1 right) for `w` units. */
function flank(ctx: CanvasRenderingContext2D, p: Plate, side: number, w: number): void {
  const n = 14;
  for (let k = 1; k <= n; k++) {
    const x = p.x + side * w * (k / n) * 0.999;
    ctx.lineTo(x, -plateAt(p, x, spineBody(x)) - spineCrag(x) - 0.006);
  }
}

/** The arete from the base back up to the summit (continues the current path). */
function arete(ctx: CanvasRenderingContext2D, p: Plate, ax: number, apexY: number, baseY: number, s: number): void {
  const n = 6;
  for (let k = n; k >= 0; k--) {
    const t = k / n;
    const jag = (hash2f(p.seed * 31 + k, 5) - 0.5) * 0.07 * p.h * (1 - Math.abs(2 * t - 1));
    const x = p.x + (ax - p.x) * Math.pow(t, 0.8) + jag - s * 0.03 * Math.sin(t * Math.PI);
    ctx.lineTo(x, apexY + (baseY - apexY) * t);
  }
}

// ---------------------------------------------------------------- slopes (pine moss, castle)

const nL = new Noise(0x51095);

/** A speck of a castle on a slopes crest (layer x). */
export const CASTLE_X = 0.95;

/** Where the slopes rise out of the cloud sea: a big forested massif on the left, a lower ridge
 *  under the fight, low under the wyrm's head (it must stay clear of it), rising again far right. */
const SLOPE_X = [-16, -10, -7, -4.5, -2.6, -1, 0.8, 2.2, 3.5, 5.2, 6.8, 9, 16];
const SLOPE_Y = [0.9, 1.3, 1.72, 1.55, 1.05, 0.95, 1.12, 0.92, 0.72, 0.78, 1.32, 1.5, 1.1];

export function slopesHeight(x: number): number {
  const h = spline(SLOPE_X, SLOPE_Y, x) + 0.16 * nL.fbm2(x * 0.45, 3.3, 3) + 0.14 * (ridged(nL, x * 0.8, 8.1) - 0.5) + 0.015 * nL.simplex2(x * 7, 1.2);
  // A little knoll for the castle.
  const u = (x - CASTLE_X) / 0.45;
  return h + 0.1 * Math.exp(-u * u);
}

/** 0..1 forest density at x (patches along the crests). */
function forest(x: number): number {
  return smoothstep(-0.15, 0.3, nL.simplex2(x * 0.7, 12.5));
}

export const SLOPES: RidgeDef = {
  name: 'slopes',
  p: 0.2,
  maxH: 2.1,
  decoH: 0.12,
  tone: 0.74,
  baseTone: 0.42,
  rim: 0.8,
  rimPx: 1.3,
  texture: 0.06,
  baseSky: 0.1,
  headroom: 1.05,
  maxDpr: 2,
  height: slopesHeight,
  deco(path, x0, x1) {
    // Pines: tiny spires along the crests, a fuzzy moss at this scale.
    const cell = 0.017;
    for (let i = Math.floor(x0 / cell); i <= Math.ceil(x1 / cell); i++) {
      const x = (i + 0.6 * hash2f(i, 61)) * cell;
      const f = forest(x);
      if (f <= 0 || hash2f(i, 62) > f * 0.92) continue;
      if (Math.abs(x - CASTLE_X) < 0.09) continue;
      const g = -slopesHeight(x);
      const h = 0.022 + 0.03 * hash2f(i, 63) * f;
      const w = h * 0.36;
      path.moveTo(x - w, g + 0.012);
      path.lineTo(x, g - h);
      path.lineTo(x + w, g + 0.012);
      path.closePath();
    }
    // The castle: a keep, two towers and a curtain wall, ~8 px tall.
    if (x0 < CASTLE_X + 0.2 && x1 > CASTLE_X - 0.2) {
      const g = -slopesHeight(CASTLE_X);
      path.rect(CASTLE_X - 0.05, g - 0.024, 0.1, 0.03);
      path.rect(CASTLE_X - 0.018, g - 0.06, 0.03, 0.066);
      path.rect(CASTLE_X - 0.058, g - 0.042, 0.016, 0.048);
      path.rect(CASTLE_X + 0.042, g - 0.038, 0.014, 0.044);
      path.moveTo(CASTLE_X - 0.021, g - 0.06);
      path.lineTo(CASTLE_X - 0.003, g - 0.085);
      path.lineTo(CASTLE_X + 0.015, g - 0.06);
      path.closePath();
    }
  },
  paint(ctx, pal, c) {
    // Forest on the slopes (darker, mottled) and snow in the clearings between.
    const snow = mixHex('#98a0d6', pal.depthTint ?? pal.haze, 0.35);
    const trees = mixHex(c.crest, pal.silhouette, 0.45);
    const r = 0.011;
    // ~120 specks per unit, only over the baked range (hashed per 1-unit cell: stable across bakes).
    const x0 = Math.floor(c.x0 ?? -13);
    const x1 = Math.ceil(c.x1 ?? 13);
    for (let cell = x0; cell < x1; cell++) for (let j = 0; j < 120; j++) {
      const i = (cell + 4096) * 120 + j;
      const x = cell + hash2f(i, 71);
      const top = -slopesHeight(x);
      const d = Math.pow(hash2f(i, 72), 1.6) * 0.75;
      const f = forest(x + d * 0.3) * (1 - d * 0.9);
      const tree = hash2f(i, 73) < f;
      ctx.fillStyle = tree ? rgba(trees, 0.55) : rgba(snow, 0.16 * (1 - d));
      ctx.fillRect(x, top + d + 0.01, tree ? r * 1.4 : r * 3, tree ? r * 2.2 : r * 0.8);
    }
    void pal;
  },
};

export const MOUNTAIN_RIDGES: readonly RidgeDef[] = [FAR_COIL, SPINE, SLOPES];
