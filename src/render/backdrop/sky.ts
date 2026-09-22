// Sky art, baked once per viewport size + palette: the dithered gradient, the sun (disc, halo,
// bloom sprites), the god-ray wedge texture and the painterly cloud banks lit from below.
import type { Palette } from '../palette';
import { makeCanvas, context2d } from '../atlas';
import { parseHex, mixHex, rgba, toHex, type RGB } from '../../lib/color';
import { Noise } from '../../lib/noise';
import { Rng } from '../../lib/rng';
import { TAU } from '../../lib/math';

// ---------------------------------------------------------------- sky gradient

const tmpA: RGB = { r: 0, g: 0, b: 0 };
const tmpB: RGB = { r: 0, g: 0, b: 0 };

/** Sky color at `frac` (0 = top, 1 = horizon, clamped) as floats in out. */
export function skyAt(p: Palette, frac: number, out: RGB): RGB {
  const s = p.sky;
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  let i = 0;
  while (i < s.length - 2 && f > s[i + 1]!.at) i++;
  const a = s[i]!;
  const b = s[Math.min(i + 1, s.length - 1)]!;
  const t = b.at > a.at ? Math.min(1, Math.max(0, (f - a.at) / (b.at - a.at))) : 0;
  parseHex(a.color, tmpA);
  parseHex(b.color, tmpB);
  out.r = tmpA.r + (tmpB.r - tmpA.r) * t;
  out.g = tmpA.g + (tmpB.g - tmpA.g) * t;
  out.b = tmpA.b + (tmpB.b - tmpA.b) * t;
  return out;
}

export function skyHexAt(p: Palette, frac: number): string {
  const c = skyAt(p, frac, { r: 0, g: 0, b: 0 });
  return toHex(c.r, c.g, c.b);
}

/** Glow falloff (fraction of radius -> alpha), shared by the glow sprite and the baked sky glow. */
const GLOW_STOPS = [
  [0, 1],
  [0.06, 0.78],
  [0.14, 0.5],
  [0.26, 0.27],
  [0.42, 0.12],
  [0.62, 0.045],
  [0.82, 0.012],
  [1, 0],
] as const;

function glowLut(n: number): Float32Array {
  const lut = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    let k = 0;
    while (k < GLOW_STOPS.length - 2 && f > GLOW_STOPS[k + 1]![0]) k++;
    const a = GLOW_STOPS[k]!;
    const b = GLOW_STOPS[k + 1]!;
    lut[i] = a[1] + ((b[1] - a[1]) * (f - a[0])) / (b[0] - a[0]);
  }
  return lut;
}

/** Where the sun glow is baked into the sky (CSS px) and how strong it is. */
export interface SkyGlow {
  x: number;
  y: number;
  /** Glow radius (px); the horizon band is 2.4 G wide and 0.32 G tall. */
  r: number;
  /** Alpha of the round glow and of the horizon band ('lighter' of the sun glow color). */
  a: number;
  band: number;
}

/**
 * The sky gradient at CSS resolution, computed per pixel with triangular dither (no 8-bit
 * banding in Safari/Firefox either), a faint painterly mottle, and the sun's big glow and
 * horizon band added in (so they cost no fill per frame). The canvas is `extra` px wider than
 * the view: the gradient is horizontally uniform, so the draw slides the source window to keep
 * the baked glow under the sun when the stage center moves (panel open).
 */
export function bakeSky(p: Palette, w: number, h: number, glow: SkyGlow, extra: number): HTMLCanvasElement {
  const c = makeCanvas(w + extra, h);
  const ctx = context2d(c);
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  const W = c.width;
  const H = c.height;
  const rows = new Float32Array(H * 3);
  const col: RGB = { r: 0, g: 0, b: 0 };
  const horizonPx = Math.max(1, p.horizon * H);
  for (let y = 0; y < H; y++) {
    skyAt(p, y / horizonPx, col);
    rows[y * 3] = col.r;
    rows[y * 3 + 1] = col.g;
    rows[y * 3 + 2] = col.b;
  }
  // Low-frequency mottle (a painted wash, not flat vector): coarse grid, bilinear.
  const n = new Noise(0x5c7);
  const GRID = 48;
  const gw = Math.ceil(W / GRID) + 2;
  const gh = Math.ceil(H / GRID) + 2;
  const grid = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) grid[j * gw + i] = n.fbm2(i * 0.35, j * 0.5, 3);
  let s = 0x9e3779b9 | 0;
  const LN = 512;
  const lut = glowLut(LN);
  const gc = parseHex(p.sun.glow, { r: 0, g: 0, b: 0 });
  const G = Math.max(1, glow.r);
  const iG = 1 / G;
  const iBx = 1 / (2.4 * G);
  const iBy = 1 / (0.32 * G);
  for (let y = 0; y < H; y++) {
    let r0 = rows[y * 3]!;
    let g0 = rows[y * 3 + 1]!;
    let b0 = rows[y * 3 + 2]!;
    const dy = y - glow.y;
    const inGlow = Math.abs(dy) < G;
    const rowR = r0;
    const rowG = g0;
    const rowB = b0;
    const gy = y / GRID;
    const j = gy | 0;
    const fy = gy - j;
    // Mottle strongest mid-sky, gone at the horizon glow.
    const mAmp = 5 * (1 - Math.min(1, y / horizonPx) ** 3);
    for (let x = 0; x < W; x++) {
      r0 = rowR;
      g0 = rowG;
      b0 = rowB;
      if (inGlow) {
        const dx = x - glow.x;
        let a = 0;
        const q = Math.sqrt(dx * dx + dy * dy) * iG;
        if (q < 1) a += glow.a * lut[(q * LN) | 0]!;
        const bx = dx * iBx;
        const by = dy * iBy;
        const qb = Math.sqrt(bx * bx + by * by);
        if (qb < 1) a += glow.band * lut[(qb * LN) | 0]!;
        r0 += gc.r * a;
        g0 += gc.g * a;
        b0 += gc.b * a;
      }
      const gx = x / GRID;
      const i = gx | 0;
      const fx = gx - i;
      const k = j * gw + i;
      const m0 = grid[k]! + (grid[k + 1]! - grid[k]!) * fx;
      const m1 = grid[k + gw]! + (grid[k + gw + 1]! - grid[k + gw]!) * fx;
      const m = (m0 + (m1 - m0) * fy) * mAmp;
      // xorshift32 x2 -> triangular dither in (-1, 1)
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const u1 = (s >>> 0) / 4294967296;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const u2 = (s >>> 0) / 4294967296;
      const dz = u1 - u2;
      const o = (y * W + x) * 4;
      d[o] = r0 + m + dz * 1.2 + 0.5;
      d[o + 1] = g0 + m * 0.8 + dz * 1.2 + 0.5;
      d[o + 2] = b0 + m * 1.1 + dz * 1.2 + 0.5;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- sun

/** Soft radial glow sprite in one color (alpha falls off roughly exponentially). */
export function bakeGlow(color: string, size = 256): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = context2d(c);
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const [at, a] of GLOW_STOPS) g.addColorStop(at, rgba(color, a));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** Sun disc + tight halo, at device resolution. The sprite spans `SUN_SPRITE_R` sun radii. */
export const SUN_SPRITE_R = 3.4;

export function bakeSun(p: Palette, radiusCss: number, dpr: number): HTMLCanvasElement {
  const R = radiusCss * SUN_SPRITE_R;
  const c = makeCanvas(R * 2 * dpr, R * 2 * dpr);
  const ctx = context2d(c);
  ctx.scale(dpr, dpr);
  const cx = R;
  const r = radiusCss;
  const halo = ctx.createRadialGradient(cx, cx, r * 0.8, cx, cx, R);
  halo.addColorStop(0, rgba(p.sun.color, 0.85));
  halo.addColorStop(0.12, rgba(p.sun.glow, 0.5));
  halo.addColorStop(0.35, rgba(p.sun.glow, 0.16));
  halo.addColorStop(0.7, rgba(p.sun.glow, 0.04));
  halo.addColorStop(1, rgba(p.sun.glow, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, R * 2, R * 2);
  const disc = ctx.createRadialGradient(cx - r * 0.12, cx - r * 0.18, 0, cx, cx, r);
  disc.addColorStop(0, '#ffffff');
  disc.addColorStop(0.55, '#fffaf0');
  disc.addColorStop(0.86, p.sun.color);
  disc.addColorStop(1, mixHex(p.sun.color, p.sun.glow, 0.45));
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cx, r, 0, TAU);
  ctx.fill();
  return c;
}

/** God-ray wedges fanning from the center, white, soft-edged. Drawn additive and rotated. */
export function bakeRays(seed: number, size = 768, count = 22): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = context2d(c);
  const rng = new Rng(seed);
  const r = size / 2;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng.range(-0.12, 0.12);
    const half = rng.range(0.012, 0.05);
    const len = r * rng.range(0.55, 1);
    const alpha = rng.range(0.35, 1);
    const g = ctx.createRadialGradient(r, r, 0, r, r, len);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`);
    g.addColorStop(0.25, `rgba(255,255,255,${0.45 * alpha})`);
    g.addColorStop(0.6, `rgba(255,255,255,${0.12 * alpha})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    // Three nested wedges fake a soft edge.
    for (let k = 0; k < 3; k++) {
      const hw = half * (1 - k * 0.33);
      ctx.globalAlpha = 0.34;
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.lineTo(r + Math.cos(a - hw) * len, r + Math.sin(a - hw) * len);
      ctx.lineTo(r + Math.cos(a + hw) * len, r + Math.sin(a + hw) * len);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // Hollow the center so the rays start at the sun's rim, not a white blob.
  ctx.globalCompositeOperation = 'destination-out';
  const hole = ctx.createRadialGradient(r, r, 0, r, r, r * 0.09);
  hole.addColorStop(0, 'rgba(0,0,0,1)');
  hole.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hole;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// ---------------------------------------------------------------- clouds

export interface CloudBank {
  canvas: HTMLCanvasElement;
  /** CSS size and top y. */
  w: number;
  h: number;
  y: number;
  /** Drift in CSS px/s (+x) and phase offset (px). */
  speed: number;
  x0: number;
}

interface CloudSpec {
  /** Base line (flat lit underside) as a fraction of view height. */
  y: number;
  /** Width and puff thickness as fractions of view height. */
  w: number;
  thick: number;
  /** Drift, fractions of view height per second. */
  speed: number;
  /** Start position as a fraction of view width. */
  x: number;
  seed: number;
  /** 0 = puffy bank, 1 = long thin streaks. */
  streak: number;
  /** Underside light 0..1 (closer to the horizon glow = brighter). */
  lit: number;
}

const CLOUDS: readonly CloudSpec[] = [
  { y: 0.085, w: 1.7, thick: 0.03, speed: 0.0032, x: -0.1, seed: 3, streak: 1, lit: 0.3 },
  { y: 0.17, w: 0.9, thick: 0.055, speed: 0.0045, x: 0.55, seed: 7, streak: 0.35, lit: 0.5 },
  { y: 0.27, w: 1.05, thick: 0.08, speed: 0.0065, x: -0.18, seed: 11, streak: 0.12, lit: 0.8 },
  { y: 0.36, w: 0.62, thick: 0.05, speed: 0.0095, x: 0.62, seed: 19, streak: 0.45, lit: 1 },
];

interface Lobe {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** Cloud lobes: many small billows with a bumpy top, occasional towers, bottoms near a base. */
function cloudLobes(spec: CloudSpec, cw: number, base: number, th: number): Lobe[] {
  const rng = new Rng(spec.seed * 7919);
  const n = new Noise(spec.seed);
  const lobes: Lobe[] = [];
  const flat = 1 + spec.streak * 4.5;
  const pad = th * 0.9 * flat;
  let x = pad + rng.float() * th;
  while (x < cw - pad) {
    const u = x / cw;
    const env = Math.pow(Math.sin(Math.PI * u), 0.6) * (0.3 + 0.7 * (0.5 + 0.5 * n.fbm2(u * 3.2, 1.7, 2)));
    const tower = Math.max(0, n.simplex2(u * 7, 4.2));
    const r = th * (0.3 + 0.35 * rng.float()) * env * (1 + 0.8 * tower * (1 - spec.streak));
    if (r > th * 0.08) {
      const rx = r * (1.1 + rng.float() * 0.5) * flat;
      const ry = r * (1 - spec.streak * 0.65);
      const lift = spec.streak > 0.5 ? 0.3 : 1;
      const y = base - ry * (0.15 + 0.95 * rng.float() * lift);
      lobes.push({ x, y, rx, ry });
    }
    x += th * (0.16 + 0.26 * rng.float()) * (1 + spec.streak * 2.2);
  }
  // Thin lit streaks trailing below the bank.
  for (let i = 0; i < 4; i++) {
    const cx = pad + rng.float() * (cw - 2 * pad);
    const r = th * (0.1 + 0.12 * rng.float());
    const cy = base + th * (0.3 + 0.55 * rng.float());
    lobes.push({ x: cx, y: cy, rx: r * (5 + 6 * rng.float()), ry: r * 0.22 });
  }
  return lobes;
}

/** Flat-ish underside: clip below the base line with a gentle wave. */
function baseClip(spec: CloudSpec, cw: number, base: number, th: number): Path2D {
  const n = new Noise(spec.seed + 101);
  const clip = new Path2D();
  clip.moveTo(0, 0);
  clip.lineTo(cw, 0);
  // Lobes hanging below the base are cut flat, except cloudlets well below it.
  for (let x = cw; x >= 0; x -= 6) clip.lineTo(x, base + th * 0.12 * n.fbm2(x / (th * 3), 0.7, 2));
  clip.lineTo(0, base);
  clip.closePath();
  clip.rect(0, base + th * 0.2, cw, th * 2);
  clip.closePath();
  return clip;
}

export function bakeClouds(p: Palette, w: number, h: number, dpr: number): CloudBank[] {
  const banks: CloudBank[] = [];
  const sky: RGB = { r: 0, g: 0, b: 0 };
  for (const spec of CLOUDS) {
    const th = spec.thick * h;
    const cw = spec.w * h;
    const ch = th * 4.2;
    const base = ch * 0.62;
    const top = spec.y * h - base;
    const c = makeCanvas(cw * dpr, ch * dpr);
    const ctx = context2d(c);
    ctx.scale(dpr, dpr);

    skyAt(p, spec.y / p.horizon, sky);
    const skyHex = toHex(sky.r, sky.g, sky.b);
    // Tops face away from the low sun (cool, dark); undersides catch it (warm, bright).
    const topCol = mixHex(skyHex, '#1a1030', 0.3);
    const lowCol = mixHex(mixHex(skyHex, '#c85a6e', 0.45), '#ff9a62', 0.35 * spec.lit);
    const rimCol = mixHex('#ff9c8e', '#ffe2a0', spec.lit);
    const glowCol = mixHex(lowCol, rimCol, 0.45);

    const path = new Path2D();
    for (const l of cloudLobes(spec, cw, base, th)) {
      path.moveTo(l.x + l.rx, l.y);
      path.ellipse(l.x, l.y, l.rx, l.ry, 0, 0, TAU);
    }
    const body = ctx.createLinearGradient(0, base - th * 1.5, 0, base + th * 0.5);
    body.addColorStop(0, topCol);
    body.addColorStop(0.55, mixHex(topCol, lowCol, 0.35));
    body.addColorStop(0.8, lowCol);
    body.addColorStop(1, lowCol);
    const glow = ctx.createLinearGradient(0, base - th * 0.45, 0, base);
    glow.addColorStop(0, rgba(glowCol, 0));
    glow.addColorStop(1, rgba(glowCol, 0.35 + 0.3 * spec.lit));

    ctx.save();
    ctx.clip(baseClip(spec, cw, base, th));
    // Body with a soft halo so edges read as vapor, not cut paper.
    ctx.shadowColor = rgba(mixHex(topCol, lowCol, 0.55), 0.6);
    ctx.shadowBlur = 8 * dpr;
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'rgba(0,0,0,0)';
    // Underside rim lit by the low sun: light everything, then repaint the body over the shape
    // shifted up so only the bottom edges keep it. Then a broad warm glow toward the base.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = rgba(rimCol, 0.95);
    ctx.fill(path);
    ctx.save();
    ctx.translate(0, -1.6);
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.fillStyle = rgba(rimCol, 0.3);
    ctx.fill(path);
    ctx.translate(0, -3.5);
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.restore();
    ctx.fillStyle = glow;
    ctx.fill(path);
    ctx.restore();

    banks.push({ canvas: c, w: cw, h: ch, y: top, speed: spec.speed * h, x0: spec.x * w });
  }
  return banks;
}
