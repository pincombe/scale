// Parallax silhouette layers: procedural height functions in layer meters (world meters at the
// reference framing; +y down, so a hill of height h has its top at y = -h), plus decorations
// (trees, windmill tower, village, the wyrm's head). Each layer is baked to an offscreen canvas at
// a zoom bucket and blitted through camera.applyParallax, so per frame it costs one drawImage.
import type { Palette } from '../palette';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { Noise } from '../../lib/noise';
import { hash2f, TAU } from '../../lib/math';
import { paintFace, wyrmHeight, type FaceColors } from './wyrm';

/** Layer x of the valley the sun sets into (the sun sits at refX + 0.27 H / refZoom ~ 1.93 m). */
export const VALLEY_X = 1.95;

function valley(x: number, depth: number, width: number): number {
  const u = (x - VALLEY_X) / width;
  return 1 - depth * Math.exp(-u * u);
}

function bump(x: number, cx: number, w: number): number {
  const u = (x - cx) / w;
  return Math.exp(-u * u);
}

/** Smooth max (blends two silhouettes without a crease). */
function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

export interface RidgeDef {
  readonly name: string;
  /** Parallax depth (0 sky .. 1 stage). */
  readonly p: number;
  /** Tallest point (m above the ground line), decorations included. */
  readonly maxH: number;
  /** How far decorations can rise above the height function (m): trims the baked canvas. */
  readonly decoH: number;
  /** Atmospheric tone of the crest: 0 = haze .. 1 = silhouette. */
  readonly tone: number;
  /** Tone at the base (valley mist), lighter than the crest. */
  readonly baseTone: number;
  /** Rim light strength on the crest (backlight from the low sun) and its width in CSS px. */
  readonly rim: number;
  readonly rimPx: number;
  /** Strength of the lit faces on slopes turned toward the sun (0 = flat silhouette). */
  readonly faces?: number;
  /** Painterly extras: thin lit edge on sun-facing ridgelines, brush texture, and how far the
   *  base (valley mist) leans toward the horizon sky color. */
  readonly edge?: number;
  readonly texture?: number;
  readonly baseSky?: number;
  /** Bake resolution caps: far, hazy layers bake at DPR 1 with no zoom headroom (memory). */
  readonly maxDpr?: number;
  readonly headroom?: number;
  /** Height of the silhouette at x (m). */
  height(x: number): number;
  /** Adds decoration subpaths (trees, buildings) intersecting [x0, x1]. */
  deco?(path: Path2D, x0: number, x1: number): void;
  /** Extra painting baked over the silhouette (layer units, source-atop), before the texture. */
  paint?(ctx: CanvasRenderingContext2D, pal: Palette, colors: FaceColors): void;
}

/** haze -> depthTint -> silhouette. */
export function toneColor(p: Palette, t: number): string {
  const mid = p.depthTint ?? mixHex(p.haze, p.silhouette, 0.5);
  return t < 0.5 ? mixHex(p.haze, mid, t / 0.5) : mixHex(mid, p.silhouette, (t - 0.5) / 0.5);
}

// ---------------------------------------------------------------- layer definitions

const nM = new Noise(101);
const nH = new Noise(202);
const nW = new Noise(303);
const nT = new Noise(404);
const nN = new Noise(505);

function ridged(n: Noise, x: number, y: number): number {
  const v = 1 - Math.abs(n.simplex2(x, y));
  return v * v;
}

export const MOUNTAINS: RidgeDef = {
  name: 'mountains',
  decoH: 0.05,
  p: 0.06,
  maxH: 4.8,
  faces: 0.3,
  edge: 0.55,
  texture: 0.07,
  baseSky: 0.4,
  maxDpr: 1,
  headroom: 1,
  tone: 0.17,
  baseTone: 0,
  rim: 0.55,
  rimPx: 1.2,
  height(x) {
    const crag = 0.8 * ridged(nM, x * 0.38, 5.5) + 0.3 * ridged(nM, x * 0.95, 9.1) + 0.05 * nM.simplex2(x * 5, 3);
    const h = 1.95 + 0.7 * nM.fbm2(x * 0.14, 1.3, 3) + crag;
    return smax(h * valley(x, 0.62, 2.1) + 0.1 * Math.min(Math.abs(x - VALLEY_X), 10), wyrmHeight(x), 0.3);
  },
  paint: paintFace,
};

export const FAR_HILLS: RidgeDef = {
  name: 'farHills',
  decoH: 0.05,
  p: 0.12,
  maxH: 1.9,
  faces: 0.25,
  edge: 0.4,
  texture: 0.06,
  baseSky: 0.15,
  maxDpr: 1,
  headroom: 1,
  tone: 0.34,
  baseTone: 0.1,
  rim: 0.5,
  rimPx: 1.3,
  height(x) {
    const hills = (1.02 + 0.38 * nH.fbm2(x * 0.26, 2.1, 3)) * valley(x, 0.68, 1.55) + 0.05 * Math.min(Math.abs(x - VALLEY_X), 8);
    return hills;
  },
};

/** Windmill position (layer x) on the rolling hills. */
export const WINDMILL_X = 4.3;
export const WINDMILL_TOWER = 0.42;

export const HILLS: RidgeDef = {
  name: 'hills',
  decoH: 0.62,
  p: 0.26,
  maxH: 1.9,
  headroom: 1,
  tone: 0.57,
  baseTone: 0.3,
  rim: 0.6,
  rimPx: 1.4,
  height(x) {
    const h = (0.6 + 0.3 * nW.fbm2(x * 0.38, 3.7, 3)) * valley(x, 0.74, 1.45);
    return h + 0.36 * bump(x, WINDMILL_X, 0.75);
  },
  deco(path, x0, x1) {
    // Windmill tower and cap (the sails turn per frame, see windmill.ts).
    if (x0 < WINDMILL_X + 0.6 && x1 > WINDMILL_X - 0.6) {
      const g = -this.height(WINDMILL_X);
      const t = g - WINDMILL_TOWER;
      path.moveTo(WINDMILL_X - 0.088, g + 0.06);
      path.lineTo(WINDMILL_X - 0.052, t);
      path.lineTo(WINDMILL_X + 0.052, t);
      path.lineTo(WINDMILL_X + 0.088, g + 0.06);
      path.closePath();
      path.moveTo(WINDMILL_X - 0.072, t + 0.012);
      path.quadraticCurveTo(WINDMILL_X - 0.03, t - 0.1, WINDMILL_X + 0.012, t - 0.1);
      path.quadraticCurveTo(WINDMILL_X + 0.06, t - 0.07, WINDMILL_X + 0.072, t + 0.012);
      path.closePath();
      // A little outbuilding.
      path.rect(WINDMILL_X + 0.1, g - 0.07, 0.12, 0.1);
      path.moveTo(WINDMILL_X + 0.09, g - 0.07);
      path.lineTo(WINDMILL_X + 0.16, g - 0.12);
      path.lineTo(WINDMILL_X + 0.23, g - 0.07);
      path.closePath();
    }
    // Sparse round trees along the crests.
    const cell = 0.85;
    for (let i = Math.floor(x0 / cell) - 1; i <= Math.ceil(x1 / cell); i++) {
      if (hash2f(i, 31) > 0.34) continue;
      const x = (i + 0.2 + 0.6 * hash2f(i, 32)) * cell;
      if (Math.abs(x - WINDMILL_X) < 0.5 || Math.abs(x - VALLEY_X) < 0.9) continue;
      const r = 0.05 + 0.05 * hash2f(i, 33);
      const g = -this.height(x);
      path.rect(x - 0.008, g - r * 1.6, 0.016, r * 1.7);
      path.moveTo(x + r, g - r * 1.9);
      path.arc(x, g - r * 1.9, r, 0, TAU);
      path.moveTo(x + r * 0.5 + r * 0.7, g - r * 1.5);
      path.arc(x + r * 0.5, g - r * 1.5, r * 0.7, 0, TAU);
    }
  },
};

/** Village + castle on the tree line; windows glow per frame. */
export const VILLAGE_X = -2.85;
/** Window positions in layer meters relative to the ground under VILLAGE_X (x, dy up). */
export const WINDOWS: readonly (readonly [number, number])[] = [
  [-3.32, 0.045],
  [-3.13, 0.04],
  [-2.99, 0.12],
  [-2.91, 0.12],
  [-2.95, 0.23],
  [-2.74, 0.29],
  [-2.52, 0.045],
  [-2.34, 0.035],
];

function house(path: Path2D, x: number, g: number, w: number, h: number): void {
  path.rect(x - w / 2, g - h, w, h + 0.05);
  path.moveTo(x - w / 2 - 0.012, g - h + 0.002);
  path.lineTo(x, g - h - w * 0.55);
  path.lineTo(x + w / 2 + 0.012, g - h + 0.002);
  path.closePath();
}

export const TREELINE: RidgeDef = {
  name: 'treeline',
  decoH: 0.62,
  p: 0.42,
  maxH: 1.25,
  tone: 0.73,
  baseTone: 0.5,
  rim: 0.7,
  rimPx: 1.5,
  height(x) {
    const h = (0.33 + 0.15 * nT.fbm2(x * 0.5, 4.4, 3)) * valley(x, 0.78, 1.3);
    return h + 0.2 * bump(x, VILLAGE_X, 0.85);
  },
  deco(path, x0, x1) {
    // Village: cottages, a church, and a small keep with two turrets and a pennant.
    if (x0 < -2.0 && x1 > -3.6) {
      const G = (x: number): number => -this.height(x);
      house(path, -3.32, G(-3.32), 0.13, 0.075);
      house(path, -3.13, G(-3.13), 0.11, 0.07);
      house(path, -2.52, G(-2.52), 0.12, 0.08);
      house(path, -2.34, G(-2.34), 0.1, 0.065);
      // Keep
      const k = G(-2.95);
      path.rect(-3.06, k - 0.2, 0.22, 0.25);
      for (let i = 0; i < 5; i++) path.rect(-3.06 + i * 0.05, k - 0.235, 0.024, 0.04);
      for (const tx of [-3.08, -2.82]) {
        path.rect(tx - 0.035, k - 0.3, 0.07, 0.35);
        path.moveTo(tx - 0.046, k - 0.3);
        path.lineTo(tx, k - 0.42);
        path.lineTo(tx + 0.046, k - 0.3);
        path.closePath();
      }
      path.rect(-2.822, k - 0.52, 0.005, 0.12);
      path.moveTo(-2.817, k - 0.52);
      path.lineTo(-2.76, k - 0.5);
      path.lineTo(-2.817, k - 0.48);
      path.closePath();
      // Church
      const c = G(-2.72);
      path.rect(-2.72, c - 0.1, 0.14, 0.14);
      path.rect(-2.765, c - 0.26, 0.055, 0.3);
      path.moveTo(-2.77, c - 0.26);
      path.lineTo(-2.7375, c - 0.4);
      path.lineTo(-2.705, c - 0.26);
      path.closePath();
    }
    // Hedgerows (rows of round crowns with gaps for fields) and poplars.
    const cell = 0.1;
    for (let i = Math.floor(x0 / cell) - 2; i <= Math.ceil(x1 / cell) + 2; i++) {
      const x = (i + 0.5 * hash2f(i, 41)) * cell;
      if (x > -3.55 && x < -2.1) continue;
      const hedge = nT.simplex2(x * 0.45, 17.3);
      if (hedge < -0.05) continue;
      const r = 0.06 + 0.07 * hash2f(i, 42) * Math.min(1, (hedge + 0.05) * 3);
      const g = -this.height(x);
      path.moveTo(x + r, g - r * 0.55);
      path.arc(x, g - r * 0.55, r, 0, TAU);
    }
    const pc = 0.7;
    for (let i = Math.floor(x0 / pc) - 1; i <= Math.ceil(x1 / pc) + 1; i++) {
      if (hash2f(i, 43) > 0.3) continue;
      const x = (i + hash2f(i, 44)) * pc;
      if ((x > -3.6 && x < -2.0) || Math.abs(x - VALLEY_X) < 0.7) continue;
      const hgt = 0.2 + 0.12 * hash2f(i, 45);
      const g = -this.height(x);
      path.moveTo(x + 0.045, g - hgt * 0.5);
      path.ellipse(x, g - hgt * 0.5, 0.045, hgt * 0.5 + 0.02, 0, 0, TAU);
    }
  },
};

function oak(path: Path2D, x: number, g: number, s: number, seed: number): void {
  // Trunk flaring at the roots, then a crown of overlapping lobes.
  path.moveTo(x - 0.05 * s, g + 0.02);
  path.quadraticCurveTo(x - 0.018 * s, g - 0.08 * s, x - 0.02 * s, g - 0.42 * s);
  path.lineTo(x + 0.022 * s, g - 0.42 * s);
  path.quadraticCurveTo(x + 0.02 * s, g - 0.08 * s, x + 0.055 * s, g + 0.02);
  path.closePath();
  const lobes = 7;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI + Math.PI;
    const rr = (0.13 + 0.07 * hash2f(seed, i)) * s;
    const cx = x + Math.cos(a) * 0.2 * s * (0.8 + 0.4 * hash2f(seed, i + 9));
    const cy = g - 0.55 * s + Math.sin(a) * 0.17 * s;
    path.moveTo(cx + rr, cy);
    path.arc(cx, cy, rr, 0, TAU);
  }
  path.moveTo(x + 0.2 * s, g - 0.62 * s);
  path.arc(x, g - 0.62 * s, 0.2 * s, 0, TAU);
}

export const NEAR_HILLS: RidgeDef = {
  name: 'nearHills',
  decoH: 1.15,
  p: 0.65,
  maxH: 1.6,
  tone: 0.87,
  baseTone: 0.74,
  rim: 0.85,
  rimPx: 1.7,
  height(x) {
    return (0.3 + 0.22 * nN.fbm2(x * 0.2, 5.5, 3) + 0.03 * nN.simplex2(x * 3, 2)) * valley(x, 0.55, 1.5);
  },
  deco(path, x0, x1) {
    const cell = 2.7;
    for (let i = Math.floor(x0 / cell) - 1; i <= Math.ceil(x1 / cell) + 1; i++) {
      if (hash2f(i, 51) > 0.5) continue;
      const x = (i + 0.15 + 0.7 * hash2f(i, 52)) * cell;
      if (Math.abs(x - VALLEY_X) < 1.6 || Math.abs(x + 0.5) < 1.2) continue;
      oak(path, x, -this.height(x), 0.75 + 0.5 * hash2f(i, 53), i);
    }
  },
};

export const RIDGES: readonly RidgeDef[] = [MOUNTAINS, FAR_HILLS, HILLS, TREELINE, NEAR_HILLS];

// ---------------------------------------------------------------- baking + cache

/** Silhouette path over [x0, x1] sampled every `step` m, closed `bottom` m below the ground. */
export function ridgePath(def: RidgeDef, x0: number, x1: number, step: number, bottom: number): Path2D {
  const path = new Path2D();
  path.moveTo(x0, bottom);
  for (let x = x0; x < x1; x += step) path.lineTo(x, -def.height(x));
  path.lineTo(x1, -def.height(x1));
  path.lineTo(x1, bottom);
  path.closePath();
  def.deco?.(path, x0, x1);
  return path;
}

/** How far below the ground line (CSS px) a cached layer extends: covers shake and roll. */
const BOTTOM_PX = 90;
/** Near layers bake a bit sharper than needed so zoom punches stay crisp. */
const BAKE_HEADROOM = 1.1;
/** Re-bake once the sun has moved this far (CSS px) relative to the layer (panel open/close). */
const SUN_MOVE_PX = 24;
/** Re-bake once the zoom leaves [bakeZ / DOWN, bakeZ * UP]. */
const REBAKE_UP = 1.02;
const REBAKE_DOWN = 1.32;
/** Extra layer width baked on each side (fraction of the visible width) to absorb pans. */
const SLACK = 0.08;
/** Largest side and area of a baked layer (device px): far above any real framing (a 5K window
 *  at DPR 2 needs ~6,500 x 1,100), so only a debug camera at an absurd zoom ever hits them. */
const MAX_BAKE_PX = 8192;
const MAX_BAKE_AREA = 12e6;

export interface Light {
  /** Sun position in this layer's coordinates. */
  x: number;
  y: number;
}

// ---------------------------------------------------------------- brush texture

const BRUSH_PX = 256;
/** One texture tile covers this many layer units (wide, short: horizontal strokes). */
const BRUSH_W = 4.5;
const BRUSH_H = 2.2;
let brush: HTMLCanvasElement | null = null;

/** Tileable dry-brush texture: light and dark horizontal strokes with fine grain, alpha only. */
export function brushTexture(): HTMLCanvasElement {
  if (brush) return brush;
  const N = BRUSH_PX;
  const c = makeCanvas(N, N);
  const ctx = context2d(c);
  const img = ctx.createImageData(N, N);
  const d = img.data;
  // Periodic value noise on lattices that divide the tile, so it repeats seamlessly.
  const layer = (x: number, y: number, cx: number, cy: number, seed: number): number => {
    const gx = (x / N) * cx;
    const gy = (y / N) * cy;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const h = (i: number, j: number): number => hash2f(((i % cx) + cx) % cx + seed * 977, ((j % cy) + cy) % cy) * 2 - 1;
    const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * u;
    const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * u;
    return a + (b - a) * v;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Strokes wobble a little vertically along their length.
      const yy = y + 9 * Math.sin((x / N) * TAU * 2) + 4 * Math.sin((x / N) * TAU * 5 + 1.3);
      // Broad soft mottle, a few long dry strokes, fine grain.
      const n = 0.55 * layer(x, y, 3, 4, 4) + 0.35 * layer(x, yy, 3, 9, 1) + 0.12 * layer(x, y, 64, 64, 3);
      const o = (y * N + x) * 4;
      const val = n > 0 ? 255 : 0;
      d[o] = val;
      d[o + 1] = val;
      d[o + 2] = val;
      d[o + 3] = Math.min(255, Math.abs(n) * 330);
    }
  }
  ctx.putImageData(img, 0, 0);
  brush = c;
  return c;
}

/** Scratch for lit-face bands, allocated per bake and freed after it. */
let scratch: HTMLCanvasElement | null = null;

/**
 * Lit faces: the part of the silhouette within `d` m of an edge that faces the sun horizontally
 * (S minus S shifted away from the sun), fading down from the crest. Left of the sun the lit
 * slopes face right, right of it they face left.
 */
function paintFaces(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  cw: number,
  ch: number,
  k: number,
  x0: number,
  top: number,
  sunX: number,
  d: number,
  fill: CanvasGradient,
  alpha: number,
): void {
  scratch = makeCanvas(cw, ch);
  const s = context2d(scratch);
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = 'source-over';
  s.clearRect(0, 0, cw, ch);
  s.setTransform(k, 0, 0, k, -x0 * k, -top * k);
  s.fillStyle = fill;
  s.fill(path);
  s.globalCompositeOperation = 'destination-out';
  s.fillStyle = '#000';
  for (let side = 0; side < 2; side++) {
    s.save();
    s.beginPath();
    if (side === 0) s.rect(x0 - 1, top - 1, sunX - x0 + 1, 1e3);
    else s.rect(sunX, top - 1, 1e3, 1e3);
    s.clip();
    s.translate(side === 0 ? -d : d, d * 0.35);
    s.fill(path);
    s.restore();
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = alpha;
  ctx.drawImage(scratch, 0, 0, cw, ch, 0, 0, cw, ch);
  ctx.restore();
  // Free the backing store right away (it is as big as the layer).
  scratch.width = 0;
  scratch.height = 0;
  scratch = null;
}

export class RidgeCache {
  canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  bakeZ = 0;
  /** The zoom the last bake asked for (equals bakeZ unless the size clamp softened it). */
  private reqZ = 0;
  dpr = 0;
  x0 = 0;
  x1 = 0;
  top = 0;
  bottom = 0;
  /** Used region of the canvas (device px). */
  cw = 0;
  ch = 0;
  palette: Palette | null = null;
  /** Colors derived from the palette at bake time (windmill sails, eye socket). */
  crest = '#000';
  base = '#000';
  rimColor = '#fff';
  /** Darker than the crest: the eye socket. */
  shade = '#000';
  /** Sun x in layer meters at bake time. */
  lightX = 0;

  constructor(readonly def: RidgeDef) {}

  invalidate(): void {
    this.palette = null;
  }

  /** Release the backing store (the tier is off screen); the next need() re-bakes. */
  free(): void {
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.ctx = null;
    this.palette = null;
  }

  /** Effective bake DPR for a view DPR. */
  bakeDpr(dpr: number): number {
    return Math.min(dpr, this.def.maxDpr ?? dpr);
  }

  /**
   * 0 = fine, 1 = should re-bake (resolution, sun moved), 2 = must re-bake (coverage, palette,
   * dpr). `lightX` is the sun's current x in this layer's meters.
   */
  need(zBase: number, vx0: number, vx1: number, dpr: number, pal: Palette, lightX: number): number {
    if (!this.canvas || this.palette !== pal || this.dpr !== this.bakeDpr(dpr)) return 2;
    if (vx0 < this.x0 || vx1 > this.x1) return 2;
    if (zBase > this.reqZ * REBAKE_UP || zBase < this.reqZ / REBAKE_DOWN) return 1;
    if (Math.abs(lightX - this.lightX) * zBase > SUN_MOVE_PX) return 1;
    return 0;
  }

  /** Backing-store bytes. */
  bytes(): number {
    return this.canvas ? this.canvas.width * this.canvas.height * 4 : 0;
  }

  covers(vx0: number, vx1: number): boolean {
    return this.canvas !== null && vx0 >= this.x0 && vx1 <= this.x1;
  }

  bake(pal: Palette, zBase: number, vx0: number, vx1: number, viewDpr: number, light: Light): void {
    const def = this.def;
    const dpr = this.bakeDpr(viewDpr);
    const z = zBase * (def.headroom ?? BAKE_HEADROOM);
    const slack = (vx1 - vx0) * SLACK;
    const x0 = vx0 - slack;
    const x1 = vx1 + slack;
    // Trim the canvas to what this range actually reaches.
    let hMax = 0;
    for (let x = x0; x <= x1; x += 0.04) hMax = Math.max(hMax, def.height(x));
    const top = -Math.min(def.maxH, hMax + def.decoH) - 0.06;
    const bottom = BOTTOM_PX / z;
    let k = z * dpr;
    // Extreme camera zooms (a debug camera, a cinematic) must never build a giant canvas: past
    // MAX_BAKE_PX the bake gets softer instead of bigger. (Never hit at the director's framings.)
    const big = Math.max((x1 - x0) * k, (bottom - top) * k) / MAX_BAKE_PX;
    if (big > 1) k /= big;
    const area = (x1 - x0) * (bottom - top) * k * k;
    if (area > MAX_BAKE_AREA) k *= Math.sqrt(MAX_BAKE_AREA / area);
    const cw = Math.ceil((x1 - x0) * k);
    const ch = Math.ceil((bottom - top) * k);
    // Exact size (reuse the canvas when it is already within 3%, to avoid reallocating).
    const c0 = this.canvas;
    if (!c0 || c0.width < cw || c0.height < ch || c0.width > cw * 1.03 + 2 || c0.height > ch * 1.03 + 2) {
      const c = c0 ?? makeCanvas(1, 1);
      c.width = cw;
      c.height = ch;
      this.canvas = c;
      this.ctx = context2d(c);
    }
    const ctx = this.ctx!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.canvas!.width, this.canvas!.height);
    ctx.setTransform(k, 0, 0, k, -x0 * k, -top * k);

    this.x0 = x0;
    this.x1 = x1;
    this.crest = toneColor(pal, def.tone);
    this.base = mixHex(toneColor(pal, def.baseTone), pal.sky[pal.sky.length - 1]!.color, def.baseSky ?? 0);
    this.rimColor = mixHex(pal.rim, pal.haze, 0.55 * (1 - def.tone));
    this.shade = mixHex(this.crest, pal.silhouette, 0.55);
    this.lightX = light.x;

    const path = ridgePath(def, x0, x1, Math.max(0.004, 1.4 / k), bottom);
    // Value gradient: a touch warmer and more saturated at the ridge, hazier toward the base.
    const ridgeCol = def.texture ? mixHex(this.crest, mixHex(pal.sun.glow, pal.accent.ember, 0.5), 0.12) : this.crest;
    const body = ctx.createLinearGradient(0, -def.maxH * 0.75, 0, 0.02);
    body.addColorStop(0, ridgeCol);
    body.addColorStop(0.3, this.crest);
    body.addColorStop(0.62, mixHex(this.crest, this.base, 0.4));
    body.addColorStop(1, this.base);
    const R = 11;
    const rimG = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, R);
    rimG.addColorStop(0, rgba(this.rimColor, def.rim));
    rimG.addColorStop(0.3, rgba(this.rimColor, def.rim * 0.55));
    rimG.addColorStop(1, rgba(this.rimColor, def.rim * 0.2));
    const rimSoft = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, R * 0.6);
    rimSoft.addColorStop(0, rgba(this.rimColor, def.rim * 0.16));
    rimSoft.addColorStop(1, rgba(this.rimColor, 0));
    // Sun-side scattering: land near the sun glows through the haze.
    const scatter = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, 5.5);
    scatter.addColorStop(0, rgba(pal.sun.glow, 0.34 * (1 - def.tone * 0.6)));
    scatter.addColorStop(0.45, rgba(pal.sun.glow, 0.1 * (1 - def.tone * 0.6)));
    scatter.addColorStop(1, rgba(pal.sun.glow, 0));

    const d1 = def.rimPx / z;
    const d2 = (def.rimPx * 3.5) / z;
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = rimG;
    ctx.fill(path);
    ctx.translate(0, d1);
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.fillStyle = rimSoft;
    ctx.fill(path);
    ctx.translate(0, d2 - d1);
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.translate(0, -d2);
    if (def.faces) {
      const lit = mixHex(this.crest, pal.sun.glow, 0.5);
      const fg = ctx.createLinearGradient(0, -def.maxH, 0, -def.maxH * 0.1);
      fg.addColorStop(0, lit);
      fg.addColorStop(0.5, rgba(lit, 0.6));
      fg.addColorStop(1, rgba(lit, 0));
      paintFaces(ctx, path, cw, ch, k, x0, top, light.x, 0.3, fg, def.faces);
      ctx.setTransform(k, 0, 0, k, -x0 * k, -top * k);
    }
    if (def.edge) {
      // Faint lit edge along the ridgelines that face the sun.
      const e = mixHex(pal.rim, this.crest, 0.35);
      const eg = ctx.createLinearGradient(0, -def.maxH, 0, -def.maxH * 0.25);
      eg.addColorStop(0, e);
      eg.addColorStop(1, rgba(e, 0.25));
      paintFaces(ctx, path, cw, ch, k, x0, top, light.x, Math.max(0.05, 2.2 / z), eg, def.edge);
      ctx.setTransform(k, 0, 0, k, -x0 * k, -top * k);
    }
    if (def.paint) {
      ctx.globalCompositeOperation = 'source-atop';
      def.paint(ctx, pal, this);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (def.texture) {
      // Dry-brush strokes baked in, fixed in layer space so re-bakes never shift them.
      const pat = ctx.createPattern(brushTexture(), 'repeat');
      if (pat) {
        pat.setTransform(new DOMMatrix([BRUSH_W / BRUSH_PX, 0, 0, BRUSH_H / BRUSH_PX, 0, 0]));
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = def.texture;
        ctx.fillStyle = pat;
        ctx.fillRect(x0, top, x1 - x0, bottom - top);
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = scatter;
    ctx.fill(path);
    ctx.globalCompositeOperation = 'source-over';

    this.palette = pal;
    this.bakeZ = k / dpr;
    this.reqZ = z;
    this.dpr = dpr;
    this.x0 = x0;
    this.x1 = x1;
    this.top = top;
    this.bottom = bottom;
    this.cw = cw;
    this.ch = ch;
  }

  /** Blit in layer coordinates (caller has applied the parallax transform). */
  blit(ctx: CanvasRenderingContext2D): void {
    if (!this.canvas) return;
    ctx.drawImage(this.canvas, 0, 0, this.cw, this.ch, this.x0, this.top, this.cw / (this.bakeZ * this.dpr), this.ch / (this.bakeZ * this.dpr));
  }
}
