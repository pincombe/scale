// Dragon painter: turns the rig's live pose into a rim-lit silhouette plus the few colored bits
// (eyes, fire glow, weak spot). Canvas 2D, allocation-free per frame.
//
// The look (PLAN §4.1): a near-black warm silhouette with a rim light on the edges facing the
// light. Every part is filled twice: once shifted toward the light in the rim color, then in
// place in the silhouette color, so only the lit outer edge shows as a crisp rim whose width is
// in screen px (it stays thin and sharp at any zoom). Far-side limbs are painted first in a
// slightly hazier tone for depth. Draws in rig units (u) through ctx transforms.
import { HORN_PTS, MOUTH_Y, type HeadShape } from './head';
import { C_ANGER, C_DIZZY, C_DROOP, C_FACE, C_GLOW, C_SHIFT, C_THROAT, LEG_FN, MAX_FINGERS, MAX_NODES, NECK_N, type DragonRig, type WingPose } from './rig';
import { mixHex, type ColorRamp } from '../../lib/color';
import { capsule } from './shapes';
import { armBonesPath, armMembranePath, beardPath, faceScarPath, mossPath, platesPath, rockClubPath, scarsPath, snowPath, type DressLayout } from './parts';

const TAU = Math.PI * 2;

/** Palette-derived colors and baked sprites (rebuilt when the palette changes). */
export interface PaintRes {
  silhouette: string;
  far: string;
  rim: string;
  /** Rim color by hit-flash heat 0..1 (rim -> white-gold -> white). */
  rimHot: ColorRamp;
  /** Rim color while burning away (dying). */
  rimBurn: ColorRamp;
  glowFire: HTMLCanvasElement;
  glowHot: HTMLCanvasElement;
  glowCyan: HTMLCanvasElement;
  glowWhite: HTMLCanvasElement;
  glowEye: HTMLCanvasElement;
  glowDark: HTMLCanvasElement;
  glowEmber: HTMLCanvasElement;
  scale: HTMLCanvasElement;
  star: HTMLCanvasElement;
  eye: string;
  /** Palette haze (aerial perspective target). */
  haze: string;
  /** Throat pouch fill and the weak spot's cyan (rims, halos). */
  pouch: string;
  cyan: string;
  /** Far-side tone by bigness 0..1 (hazier for huge dragons: aerial perspective). */
  farRamp: ColorRamp;
  /** Wing-arm membrane by how far the wing is open: dark folded, faintly translucent spread wide. */
  membrane: ColorRamp;
  /** Boss dressings: moss and lichen, old scars, snow (near and far). */
  moss: string;
  scar: string;
  snow: string;
  snowFar: string;
}

/** Per-frame paint inputs computed in update (the painter itself never advances state). */
export interface PaintState {
  /** World placement: x_w = originX + x_u * L, y_w = y_u * L. */
  originX: number;
  L: number;
  /** 0..1 hit flash, 0..1 weak-spot hover, 0..1 body hover. */
  hot: number;
  hover: number;
  hoverBody: number;
  /** Live weak-spot marker (u): visibility 0..1, position, drawn radius, body tangent angle. */
  weakOn: number;
  weakX: number;
  weakY: number;
  weakR: number;
  weakA: number;
  /** Which marker (weakspot.ts WEAK_*), and whether a swipe target sits on the head (tight halo). */
  weakMode: number;
  weakOnHead: number;
  /** The previous marker fading out after a switch (loose scale -> throat, etc.). */
  weak2On: number;
  weak2X: number;
  weak2Y: number;
  weak2A: number;
  weak2Mode: number;
  /** Pupil target (u). */
  lookX: number;
  lookY: number;
  /** Fire: intensity 0..1, ground point (u) and the size of its light pool (u). */
  fire: number;
  fireX: number;
  fireY: number;
  fireR: number;
  /** 0..1 burning (dying): rim turns to embers. */
  burn: number;
  /** Tongue out 0..1. */
  tongue: number;
  time: number;
  /** Overall alpha (fades the last embers). */
  alpha: number;
  /** 0 (<= 4 m) .. 1 (40 m): drives the huge-dragon scale cues (haze, shadow). */
  big: number;
  /** Cached aerial-perspective fill for the current individual + palette (built lazily). */
  hazeGrad: CanvasGradient | null;
  hazeFor: unknown;
  hazeRes: PaintRes | null;
  /** Height of the body above the ground (u) while flying: the contact shadow shrinks and fades. */
  lift: number;
  /** The boss dressings' per-individual layout (null: none). */
  dress: DressLayout | null;
}

export function createPaintState(): PaintState {
  return {
    originX: 0,
    L: 1,
    hot: 0,
    hover: 0,
    hoverBody: 0,
    weakOn: 0,
    weakX: 0,
    weakY: 0,
    weakR: 0.02,
    weakA: 0,
    weakMode: 0,
    weakOnHead: 0,
    weak2On: 0,
    weak2X: 0,
    weak2Y: 0,
    weak2A: 0,
    weak2Mode: 0,
    lookX: -1,
    lookY: 0,
    fire: 0,
    fireX: -1,
    fireY: 0,
    fireR: 1,
    burn: 0,
    tongue: 0,
    time: 0,
    alpha: 1,
    big: 0,
    hazeGrad: null,
    hazeFor: null,
    hazeRes: null,
    lift: 0,
    dress: null,
  };
}

// Scratch buffers (module scope; the painter is single-threaded and re-entrant per call).
const poly = new Float32Array(2 * (2 * MAX_NODES + 16));
const wingScratch: WingPose = { n: 0, pts: new Float32Array(2 * (MAX_FINGERS + 3)) };
const tmpP = { x: 0, y: 0 };

/** Smooth closed curve through poly[0..n) (midpoint quadratics). */
function closedCurve(ctx: CanvasRenderingContext2D, n: number): void {
  const lx = poly[(n - 1) * 2]!;
  const ly = poly[(n - 1) * 2 + 1]!;
  ctx.moveTo((lx + poly[0]!) * 0.5, (ly + poly[1]!) * 0.5);
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    const px = poly[i * 2]!;
    const py = poly[i * 2 + 1]!;
    ctx.quadraticCurveTo(px, py, (px + poly[j * 2]!) * 0.5, (py + poly[j * 2 + 1]!) * 0.5);
  }
  ctx.closePath();
}

/** Dissolve cut as a fractional main-chain index (n - 1 = intact). */
function cutIndex(rig: DragonRig): number {
  return rig.dissolve >= 1 ? rig.n - 1 : rig.indexOfS(rig.dissolve);
}

/** Main body tube (neck + torso + tail) up to the dissolve cut. */
function bodyPath(ctx: CanvasRenderingContext2D, rig: DragonRig): void {
  const cut = cutIndex(rig);
  if (cut < 0.5) return;
  const last = Math.floor(cut);
  let m = 0;
  for (let i = 0; i <= last; i++) {
    poly[m++] = rig.bx[i]!;
    poly[m++] = rig.by[i]!;
  }
  if (cut < rig.n - 1) {
    // Burnt edge: interpolate the cut and add a ragged middle point.
    const t = cut - last;
    const i1 = Math.min(rig.n - 1, last + 1);
    const bx = rig.bx[last]! + (rig.bx[i1]! - rig.bx[last]!) * t;
    const by = rig.by[last]! + (rig.by[i1]! - rig.by[last]!) * t;
    const ux = rig.ux[last]! + (rig.ux[i1]! - rig.ux[last]!) * t;
    const uy = rig.uy[last]! + (rig.uy[i1]! - rig.uy[last]!) * t;
    poly[m++] = bx;
    poly[m++] = by;
    const cx = (bx + ux) * 0.5 - (rig.ny[last]! * 0.4 + 0.25) * (Math.abs(by - uy) + Math.abs(bx - ux)) * 0.25;
    const cy = (by + uy) * 0.5;
    poly[m++] = cx;
    poly[m++] = cy;
    poly[m++] = ux;
    poly[m++] = uy;
  }
  for (let i = last; i >= 0; i--) {
    poly[m++] = rig.ux[i]!;
    poly[m++] = rig.uy[i]!;
  }
  closedCurve(ctx, m >> 1);
}

/** An extra neck (heads 2 and 3) from its head joint down into the shoulder. */
function extraNeckPath(ctx: CanvasRenderingContext2D, rig: DragonRig, h: number): void {
  const b = rig.headNode[h]!;
  let m = 0;
  for (let k = 0; k < NECK_N; k++) {
    poly[m++] = rig.bx[b + k]!;
    poly[m++] = rig.by[b + k]!;
  }
  // Blend into the body a little behind the shoulder.
  const s = rig.iS + 1;
  poly[m++] = rig.bx[s]!;
  poly[m++] = rig.by[s]!;
  poly[m++] = rig.x[s]!;
  poly[m++] = rig.y[s]!;
  poly[m++] = rig.ux[rig.iS]!;
  poly[m++] = rig.uy[rig.iS]!;
  for (let k = NECK_N - 1; k >= 0; k--) {
    poly[m++] = rig.ux[b + k]!;
    poly[m++] = rig.uy[b + k]!;
  }
  closedCurve(ctx, m >> 1);
}

/** Dorsal crest: a soft wavy newt crest, or separate spikes leaning toward the tail. */
function crestPath(ctx: CanvasRenderingContext2D, rig: DragonRig, detail: boolean): void {
  const ind = rig.ind;
  if (ind.crest <= 0 || ind.crestSpikes < 1) return;
  const i0 = rig.indexOfS(ind.crestFrom);
  const iEnd = rig.indexOfS(ind.crestTo);
  const i1 = Math.min(iEnd, cutIndex(rig));
  if (i1 <= i0 + 0.5) return;
  const sharp = ind.crestSharp > 0.5;
  // Big on screen: a smaller spike between each pair (more detail, same silhouette rhythm).
  const fine = detail && sharp;
  const count = ind.crestSpikes * (fine ? 2 : 1);
  const step = (iEnd - i0) / count;
  const sp = sampleA;
  const n = rig.n;
  // Edge points: valley, tip, valley, tip, ... (valleys sink a little into the back).
  let m = 0;
  for (let k = 0; k <= count * 2; k++) {
    let f = i0 + (k * step) / 2;
    if (f > i1) f = i1;
    const tip = (k & 1) === 1;
    if (tip && sharp) f = Math.min(i1, f + step * 0.3);
    rig.spineAt(f, sp);
    let h = tip ? rig.crestHeightAt(Math.min(n - 1, Math.round(f))) : -sp.back * 0.2;
    if (fine && tip && (k & 2) === 0) h *= 0.45;
    poly[m++] = sp.x + sp.nx * (sp.back + h);
    poly[m++] = sp.y + sp.ny * (sp.back + h);
    if (f >= i1) break;
  }
  const edge = m >> 1;
  if (edge < 2) return;
  ctx.moveTo(poly[0]!, poly[1]!);
  if (sharp) {
    for (let i = 1; i < edge; i++) ctx.lineTo(poly[i * 2]!, poly[i * 2 + 1]!);
  } else {
    for (let i = 1; i < edge - 1; i++) {
      const px = poly[i * 2]!;
      const py = poly[i * 2 + 1]!;
      ctx.quadraticCurveTo(px, py, (px + poly[i * 2 + 2]!) * 0.5, (py + poly[i * 2 + 3]!) * 0.5);
    }
    ctx.lineTo(poly[(edge - 1) * 2]!, poly[(edge - 1) * 2 + 1]!);
  }
  // Close back along the inside of the back.
  for (let f = i1; f >= i0; f -= step * 0.5) {
    rig.spineAt(f, sp);
    ctx.lineTo(sp.x + sp.nx * sp.back * 0.4, sp.y + sp.ny * sp.back * 0.4);
  }
  ctx.closePath();
}

const sampleA = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };
const sampleB = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };

/** Newt paddle fin along the tail, top and bottom. */
function tailFinPath(ctx: CanvasRenderingContext2D, rig: DragonRig, top: boolean): void {
  if (rig.finH <= 1e-4) return;
  const cut = cutIndex(rig);
  const a = rig.iH - 0.5;
  const b = Math.min(rig.n - 1.05, cut);
  if (b <= a + 1) return;
  const H = rig.finH * (top ? 1 : 0.7);
  const sp = sampleA;
  const steps = 14;
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const f = a + (b - a) * u;
    rig.spineAt(f, sp);
    const t = Math.max(0, (f - rig.iH) / (rig.n - 1 - rig.iH));
    // Rises smoothly from the tail root, peaks early, tapers to the tip, gently wavy.
    const rise = t < 0.3 ? (t / 0.3) * (t / 0.3) * (3 - 2 * (t / 0.3)) : 1;
    const h = H * rise * Math.pow(1 - t, 0.75) * (0.92 + 0.08 * Math.sin(t * 23));
    const side = top ? sp.back + h : -(sp.belly + h);
    const px = sp.x + sp.nx * side;
    const py = sp.y + sp.ny * side;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  for (let k = steps; k >= 0; k--) {
    const f = a + ((b - a) * k) / steps;
    rig.spineAt(f, sp);
    const side = top ? sp.back * 0.3 : -sp.belly * 0.3;
    ctx.lineTo(sp.x + sp.nx * side, sp.y + sp.ny * side);
  }
  ctx.closePath();
}

/** Spade / club at the tail tip. */
function tailTipPath(ctx: CanvasRenderingContext2D, rig: DragonRig): void {
  const ind = rig.ind;
  if (rig.dissolve < 0.995) return;
  const n = rig.n;
  const i = n - 1;
  const j = n - 3;
  let dx = rig.x[i]! - rig.x[j]!;
  let dy = rig.y[i]! - rig.y[j]!;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= d;
  dy /= d;
  const nx = dy;
  const ny = -dx;
  const tx = rig.x[i]!;
  const ty = rig.y[i]!;
  if (rig.spadeLen > 1e-4) {
    const s = rig.spadeLen;
    ctx.moveTo(tx - dx * s * 0.2, ty - dy * s * 0.2);
    ctx.lineTo(tx - dx * s * 0.75 + nx * s * 0.62, ty - dy * s * 0.75 + ny * s * 0.62);
    ctx.quadraticCurveTo(tx + dx * s * 0.2 + nx * s * 0.45, ty + dy * s * 0.2 + ny * s * 0.45, tx + dx * s * 0.95, ty + dy * s * 0.95);
    ctx.quadraticCurveTo(tx + dx * s * 0.2 - nx * s * 0.45, ty + dy * s * 0.2 - ny * s * 0.45, tx - dx * s * 0.75 - nx * s * 0.62, ty - dy * s * 0.75 - ny * s * 0.62);
    ctx.closePath();
  }
  if (rig.clubR > 1e-4 && ind.clubJag > 0.01) {
    rockClubPath(ctx, rig, tx, ty, dx, dy, rig.clubR * 0.95);
  } else if (rig.clubR > 1e-4) {
    const r = rig.clubR;
    ctx.moveTo(tx + r, ty);
    ctx.arc(tx, ty, r, 0, TAU);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + 0.4;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      ctx.moveTo(tx + cx * r * 0.8 - cy * r * 0.3, ty + cy * r * 0.8 + cx * r * 0.3);
      ctx.lineTo(tx + cx * r * 1.7, ty + cy * r * 1.7);
      ctx.lineTo(tx + cx * r * 0.8 + cy * r * 0.3, ty + cy * r * 0.8 - cx * r * 0.3);
      ctx.closePath();
    }
  }
}

/** One leg: thigh, shin and a foot of toes (pads when young, claws when old). */
function legPath(ctx: CanvasRenderingContext2D, rig: DragonRig, k: number): void {
  const rH = rig.legR[k]!;
  const rK = rH * 0.68;
  const rA = rH * 0.55;
  const hx = rig.hipX[k]!;
  const hy = rig.hipY[k]!;
  const kx = rig.kneeX[k]!;
  const ky = rig.kneeY[k]!;
  const ax = rig.ankX[k]!;
  const ay = rig.ankY[k]!;
  capsule(ctx, hx, hy, rH * 1.25, kx, ky, rK);
  capsule(ctx, kx, ky, rK, ax, ay, rA);
  // Toes: fan forward along the ground; curl down while the foot is in the air.
  const ind = rig.ind;
  const toes = ind.toes;
  const len = rig.legFoot[k]!;
  const lifted = rig.footY[k]! < -1e-4 || rig.legAir[k] === 1;
  const curl = lifted ? 0.9 : 0.12;
  const rt = rA * 0.42;
  for (let t = 0; t < toes; t++) {
    const f = toes === 1 ? 0.5 : t / (toes - 1);
    const a = Math.PI - 0.28 + f * 0.5 - curl * 0.5 + (rig.legFar[k] ? 0.08 : 0);
    const l = len * (t === 1 ? 1 : 0.78);
    const ex = ax + Math.cos(a) * l;
    const ey = Math.min(ay + Math.sin(a) * l * (lifted ? 1 : 0.15) + rA * 0.55, rig.footY[k]! - rt * 0.4);
    capsule(ctx, ax, ay + rA * 0.3, rA * 0.7, ex, ey, rt);
    if (ind.claws > 0.05) {
      // A small hooked claw past the toe tip.
      const cl = len * 0.35 * ind.claws;
      ctx.moveTo(ex + rt * 0.5, ey - rt);
      ctx.quadraticCurveTo(ex - cl * 0.7, ey - rt * 1.2, ex - cl, ey + rt * 0.9);
      ctx.lineTo(ex + rt * 0.2, ey + rt * 0.6);
      ctx.closePath();
    } else {
      // Round toe pad (newt).
      ctx.moveTo(ex + rt * 1.35, ey);
      ctx.arc(ex, ey, rt * 1.35, 0, TAU);
    }
  }
}

/** Wing membrane (scalloped between finger tips). */
function wingMembrane(ctx: CanvasRenderingContext2D, rig: DragonRig, w: WingPose): void {
  const p = w.pts;
  const F = rig.fingers;
  const sc = rig.wingScallop;
  ctx.moveTo(p[0]!, p[1]!);
  ctx.lineTo(p[2]!, p[3]!);
  ctx.lineTo(p[4]!, p[5]!);
  for (let f = 0; f < F; f++) {
    const ax = p[4 + f * 2]!;
    const ay = p[5 + f * 2]!;
    const nxt = f + 1 < F ? 4 + (f + 1) * 2 : 4 + F * 2;
    const bx = p[nxt]!;
    const by = p[nxt + 1]!;
    // Pull the edge toward the wrist for a bat-wing scallop.
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const s = f + 1 < F ? sc : sc * 0.6;
    ctx.quadraticCurveTo(mx + (p[2]! - mx) * s, my + (p[3]! - my) * s, bx, by);
  }
  ctx.closePath();
}

/** Wing bones: arm and fingers as thin tapered capsules (they poke past the membrane). */
function wingBones(ctx: CanvasRenderingContext2D, rig: DragonRig, w: WingPose, r: number): void {
  const p = w.pts;
  capsule(ctx, p[0]!, p[1]!, r * 1.3, p[2]!, p[3]!, r);
  for (let f = 0; f < rig.fingers; f++) {
    capsule(ctx, p[2]!, p[3]!, r * 0.85, p[4 + f * 2]!, p[5 + f * 2]!, r * 0.25);
  }
}

// ---- heads ----

/** Enter head h's frame (u -> head units). Caller saves/restores. */
function headFrame(ctx: CanvasRenderingContext2D, rig: DragonRig, h: number): void {
  ctx.translate(rig.headX[h]!, rig.headY[h]!);
  ctx.rotate(rig.headA[h]!);
  ctx.scale(rig.headLen, rig.headLen);
}

function jawAngle(rig: DragonRig, h: number): number {
  return rig.jaw[h]! * (0.62 + 0.3 * rig.ind.maturity);
}

/** Upper head + lower jaw + gape + teeth + horns (+ frill, gills, tongue) in head units. */
function headPaths(ctx: CanvasRenderingContext2D, rig: DragonRig, h: number, st: PaintState): void {
  const hs = rig.head;
  const anger = rig.ch[C_ANGER]!;
  // Upper head (the brow drops a little when angry).
  let n = 0;
  for (let i = 0; i < hs.upperN; i++) {
    poly[n++] = hs.upper[i * 2]!;
    poly[n++] = hs.upper[i * 2 + 1]! + (i === 4 ? anger * 0.05 : 0);
  }
  ctx.beginPath();
  closedCurve(ctx, hs.upperN);
  // Horns share the fill (smooth, or gnarled and snapped), and the crown of stony spikes.
  if (hs.gnarled) {
    const P = hs.hornPoly;
    for (let k = 0; k < hs.hornN; k++) {
      const o = k * HORN_PTS * 2;
      ctx.moveTo(P[o]!, P[o + 1]!);
      for (let i = 1; i < HORN_PTS; i++) ctx.lineTo(P[o + i * 2]!, P[o + i * 2 + 1]!);
      ctx.closePath();
    }
  } else {
    for (let k = 0; k < hs.hornN; k++) {
      const o = k * 10;
      const H = hs.horns;
      ctx.moveTo(H[o]!, H[o + 1]!);
      ctx.quadraticCurveTo(H[o + 2]!, H[o + 3]!, H[o + 4]!, H[o + 5]!);
      ctx.quadraticCurveTo(H[o + 6]!, H[o + 7]!, H[o + 8]!, H[o + 9]!);
      ctx.closePath();
    }
  }
  for (let k = 0; k < hs.crownN; k++) {
    const c = hs.crown;
    ctx.moveTo(c[k * 6]!, c[k * 6 + 1]!);
    ctx.lineTo(c[k * 6 + 2]!, c[k * 6 + 3]!);
    ctx.lineTo(c[k * 6 + 4]!, c[k * 6 + 5]!);
    ctx.closePath();
  }
  ctx.fill();

  // Lower jaw, rotated about the hinge.
  const ja = jawAngle(rig, h);
  const c = Math.cos(-ja);
  const s = Math.sin(-ja);
  const hx = hs.hingeX;
  const hy = hs.hingeY;
  n = 0;
  for (let i = 0; i < hs.jawN; i++) {
    const px = hs.jaw[i * 2]! - hx;
    const py = hs.jaw[i * 2 + 1]! - hy;
    poly[n++] = hx + px * c - py * s;
    poly[n++] = hy + px * s + py * c;
  }
  ctx.beginPath();
  closedCurve(ctx, hs.jawN);
  if (ja > 0.02) {
    // Cheek membrane at the back of the gape, and teeth.
    const g = hs.gapeX;
    const ux = hx + (hs.lipX - hx) * g;
    const lx0 = hx + (hs.chinX - hx) * g - hx;
    const ly0 = MOUTH_Y + 0.004 - hy;
    ctx.moveTo(hx + 0.03, hy - 0.02);
    ctx.lineTo(ux, MOUTH_Y + 0.01);
    ctx.lineTo(hx + lx0 * c - ly0 * s, hy + lx0 * s + ly0 * c);
    ctx.closePath();
    for (let t = 0; t < hs.teethLN; t++) {
      const o = t * 6;
      const T = hs.teethL;
      for (let v = 0; v < 3; v++) {
        const px = T[o + v * 2]! - hx;
        const py = T[o + v * 2 + 1]! - hy;
        const qx = hx + px * c - py * s;
        const qy = hy + px * s + py * c;
        if (v === 0) ctx.moveTo(qx, qy);
        else ctx.lineTo(qx, qy);
      }
      ctx.closePath();
    }
    for (let t = 0; t < hs.teethUN; t++) {
      const o = t * 6;
      const T = hs.teethU;
      ctx.moveTo(T[o]!, T[o + 1]!);
      ctx.lineTo(T[o + 2]!, T[o + 3]!);
      ctx.lineTo(T[o + 4]!, T[o + 5]!);
      ctx.closePath();
    }
  }
  // Lichen beard hanging from the jaw (the Elder Newt).
  if (h === 0 && st.dress !== null && st.dress.beardN > 0) beardPath(ctx, hs, st.dress, rig.ind.jaw, st.time, rig.ch[C_DROOP]!, c, s);
  ctx.fill();

  // Gills: feathery stalks that lag behind head motion.
  if (hs.gillN > 0) {
    ctx.beginPath();
    const sway = rig.gillSway[h]!;
    const droop = rig.ch[C_DROOP]!;
    for (let k = 0; k < hs.gillN; k++) {
      const o = k * 5;
      const rx = hs.gills[o]!;
      const ry = hs.gills[o + 1]!;
      const a = hs.gills[o + 2]! + sway * (0.6 + 0.25 * k) + droop * 0.5 + 0.06 * Math.sin(st.time * 2.3 + k * 1.7);
      gillStalk(ctx, rx, ry, a, hs.gills[o + 3]!, hs.gills[o + 4]!);
    }
    ctx.fill();
  }

  if (hs.frill > 0.01) {
    ctx.beginPath();
    frillPath(ctx, hs, rig.ch[C_DROOP]!);
    ctx.fill();
  }

  if (hs.whisker > 0.01) {
    ctx.beginPath();
    const sway = rig.gillSway[h]! * 0.6 + rig.ch[C_DROOP]! * 0.5;
    whiskerPath(ctx, hs, hs.whisker, 0.45 + sway, st.time, 0);
    whiskerPath(ctx, hs, hs.whisker * 0.8, 0.9 + sway, st.time, 1.7);
    ctx.fill();
  }

  if (st.tongue > 0.02 && h === 0) tonguePath(ctx, hs, st.tongue, ja, st.time, rig.ch[C_DROOP]!);
}

/**
 * A feathery gill frond (axolotl): a curved stalk whose outline is a tapering feather with a
 * scalloped fringe and a rounded tip. One closed path; reads as fluff when small.
 */
function gillStalk(ctx: CanvasRenderingContext2D, rx: number, ry: number, a: number, len: number, w: number): void {
  // Stalk: quadratic Bezier that curls up toward the tip.
  const cx = rx + Math.cos(a) * len * 0.55;
  const cy = ry + Math.sin(a) * len * 0.55;
  const ta = a - 0.5;
  const ex = cx + Math.cos(ta) * len * 0.5;
  const ey = cy + Math.sin(ta) * len * 0.5;
  const N = 6;
  let px = 0;
  let py = 0;
  for (let side = 1; side >= -1; side -= 2) {
    for (let i = 0; i <= N; i++) {
      const t = side === 1 ? i / N : 1 - i / N;
      const u = 1 - t;
      const bx = u * u * rx + 2 * u * t * cx + t * t * ex;
      const by = u * u * ry + 2 * u * t * cy + t * t * ey;
      let tx = 2 * u * (cx - rx) + 2 * t * (ex - cx);
      let ty = 2 * u * (cy - ry) + 2 * t * (ey - cy);
      const tl = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= tl;
      ty /= tl;
      const nx = -ty * side;
      const ny = tx * side;
      const W = w * (0.3 + 0.85 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95))) * (1 - 0.25 * t);
      const qx = bx + nx * W;
      const qy = by + ny * W;
      if (side === 1 && i === 0) ctx.moveTo(qx, qy);
      else if (side === -1 && i === 0) {
        // Round the tip.
        ctx.quadraticCurveTo(ex + tx * w * 0.9, ey + ty * w * 0.9, qx, qy);
      } else {
        // Scallop: bulge outward between fringe points.
        const mx = (px + qx) * 0.5 + nx * W * 0.55;
        const my = (py + qy) * 0.5 + ny * W * 0.55;
        ctx.quadraticCurveTo(mx, my, qx, qy);
      }
      px = qx;
      py = qy;
    }
  }
  ctx.closePath();
}

/** A collar frill behind the jaw (frilled-lizard style): spiky ribs fanning up, back and down. */
function frillPath(ctx: CanvasRenderingContext2D, hs: HeadShape, droop: number): void {
  const r = hs.frill;
  const cx = hs.hingeX + 0.14;
  const cy = MOUTH_Y - 0.04;
  const ribs = hs.frillRibs + 2;
  const a0 = -2.2 + droop * 0.5;
  const a1 = 1.25 + droop * 0.3;
  const step = (a1 - a0) / ribs;
  ctx.moveTo(cx + Math.cos(a0) * r * 0.2, cy + Math.sin(a0) * r * 0.2);
  for (let i = 0; i <= ribs; i++) {
    const a = a0 + step * i;
    // Rib tip, then the membrane sags between ribs.
    const len = r * (0.85 + 0.15 * Math.sin(i * 1.9));
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    if (i < ribs) {
      const am = a + step * 0.5;
      ctx.quadraticCurveTo(cx + Math.cos(am) * r * 0.62, cy + Math.sin(am) * r * 0.62, cx + Math.cos(a + step) * r * 0.78, cy + Math.sin(a + step) * r * 0.78);
    }
  }
  ctx.lineTo(cx + Math.cos(a1) * r * 0.2, cy + Math.sin(a1) * r * 0.2);
  ctx.closePath();
}

/**
 * A long whisker (barbel) from the upper lip: a thin tapering strand that sweeps back and down in
 * a lazy S, drifting slowly. `a` is its base angle (0 = straight back, + = down).
 */
function whiskerPath(ctx: CanvasRenderingContext2D, hs: HeadShape, len: number, a: number, time: number, phase: number): void {
  const x0 = hs.lipX + 0.12;
  const y0 = MOUTH_Y - 0.02;
  const w = 0.028;
  const drift = 0.18 * Math.sin(time * 1.3 + phase);
  // Two quadratic legs: out and back from the lip, then curling up at the tip.
  const mx = x0 + Math.cos(a) * len * 0.5;
  const my = y0 + Math.sin(a) * len * 0.5 + drift * len * 0.3;
  const ta = a - 0.9 - drift;
  const ex = mx + Math.cos(ta) * len * 0.5;
  const ey = my + Math.sin(ta) * len * 0.5;
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  ctx.moveTo(x0 - nx * w, y0 - ny * w);
  ctx.quadraticCurveTo(mx - nx * w * 0.6, my - ny * w * 0.6, ex, ey);
  ctx.quadraticCurveTo(mx + nx * w * 0.6, my + ny * w * 0.6, x0 + nx * w, y0 + ny * w);
  ctx.closePath();
}

/** Forked tongue: a quick straight flick, or (droop > 0) hanging limp from a dazed mouth. */
function tonguePath(ctx: CanvasRenderingContext2D, hs: HeadShape, t: number, ja: number, time: number, droop: number): void {
  const len = (0.55 - 0.2 * droop) * t;
  const x0 = hs.lipX + 0.1;
  const y0 = MOUTH_Y + 0.02 + ja * 0.15;
  const wig = (0.05 - 0.03 * droop) * Math.sin(time * (40 - 34 * droop)) * t;
  const ex = x0 - len * (1 - 0.55 * droop);
  const ey = y0 + 0.03 + wig + len * 0.95 * droop;
  const cx = x0 - len * 0.55;
  const cy = y0 - 0.02 + wig + len * 0.2 * droop;
  // Fork direction follows the end of the curve.
  let dx = ex - cx;
  let dy = ey - cy;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= d;
  dy /= d;
  const nx = -dy;
  const ny = dx;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 0.018);
  ctx.quadraticCurveTo(cx, cy, ex + nx * 0.012, ey + ny * 0.012);
  ctx.lineTo(ex + dx * 0.07 + nx * 0.045, ey + dy * 0.07 + ny * 0.045);
  ctx.lineTo(ex + dx * 0.02, ey + dy * 0.02);
  ctx.lineTo(ex + dx * 0.07 - nx * 0.045, ey + dy * 0.07 - ny * 0.045);
  ctx.lineTo(ex - nx * 0.012, ey - ny * 0.012);
  ctx.quadraticCurveTo(cx, cy + 0.035, x0, y0 + 0.018);
  ctx.closePath();
  ctx.fill();
}

/**
 * Rows of shingled scale edges along the back, catching the rim light (only when the dragon is big
 * on screen, as texture). Stroked by the caller.
 */
function scaleRows(ctx: CanvasRenderingContext2D, rig: DragonRig): void {
  const a = rig.iS - 1;
  const b = Math.min(rig.iH + 6, cutIndex(rig));
  const sp = sampleA;
  const spacing = 0.022;
  for (let row = 0; row < 2; row++) {
    const depth = row === 0 ? 0.74 : 0.44;
    let f = a + row * 0.5 * (spacing / Math.max(1e-6, rig.segLen[rig.iS + 1]!));
    while (f < b) {
      rig.spineAt(f, sp);
      // Tangent toward the tail from the normal (tangent = (-ny, nx)).
      const tx = -sp.ny;
      const ty = sp.nx;
      const cx = sp.x + sp.nx * sp.back * depth;
      const cy = sp.y + sp.ny * sp.back * depth;
      const h = spacing * 0.5;
      // A ')' shape: convex toward the tail, like overlapping shingles.
      ctx.moveTo(cx - tx * h * 0.3 + sp.nx * h, cy - ty * h * 0.3 + sp.ny * h);
      ctx.quadraticCurveTo(cx + tx * h * 0.9, cy + ty * h * 0.9, cx - tx * h * 0.3 - sp.nx * h, cy - ty * h * 0.3 - sp.ny * h);
      const seg = rig.segLen[Math.min(rig.n - 1, Math.round(f) + 1)]! || 0.03;
      f += spacing / seg;
    }
  }
}

// ---- parts in the two silhouette passes ----

/**
 * The near side's silhouette parts. `memb` (the body pass only) fills wing-arm membranes with
 * their faint translucency, then `fill` is restored for the bones; rim passes pass null.
 */
function nearParts(
  ctx: CanvasRenderingContext2D,
  rig: DragonRig,
  st: PaintState,
  alpha: number,
  ghostAlpha: number,
  detail: boolean,
  memb: ColorRamp | null,
  fill: string | CanvasGradient,
): void {
  const cut = rig.dissolve;
  // Tail fin and spade.
  ctx.beginPath();
  tailFinPath(ctx, rig, true);
  tailFinPath(ctx, rig, false);
  ctx.fill();
  ctx.beginPath();
  tailTipPath(ctx, rig);
  ctx.fill();
  // Crest.
  ctx.beginPath();
  crestPath(ctx, rig, detail);
  ctx.fill();
  // Rock plates and moss (their bases sink into the back: the body covers them).
  if (rig.plateN > 0) {
    ctx.beginPath();
    platesPath(ctx, rig, false);
    ctx.fill();
  }
  if (st.dress !== null && st.dress.mossN > 0) {
    ctx.beginPath();
    mossPath(ctx, rig, st.dress);
    ctx.fill();
  }
  // Body.
  ctx.beginPath();
  bodyPath(ctx, rig);
  ctx.fill();
  // Near legs (attached parts vanish once the burn passes them).
  for (let k = 0; k < 4; k++) {
    if (!rig.legOn[k] || rig.legFar[k]) continue;
    if (rig.armWing && k < 2) continue;
    if (rig.s[Math.round(rig.iS + rig.legAt[k]! * 8)]! > cut) continue;
    ctx.beginPath();
    legPath(ctx, rig, k);
    ctx.fill();
  }
  // Heads: main, then the near extra head (the far one is painted in the far pass).
  if (cut > 0.015) {
    for (let h = 0; h < rig.heads; h++) {
      if (h === 1) continue;
      if (h === 2) {
        ctx.beginPath();
        extraNeckPath(ctx, rig, h);
        ctx.fill();
      }
      ctx.save();
      headFrame(ctx, rig, h);
      headPaths(ctx, rig, h, st);
      ctx.restore();
    }
  }
  // Near wing (with a buzz blur).
  if (rig.wingOn && rig.s[Math.round(rig.iS + rig.wingAt * 8)]! < cut) {
    const w = rig.wingPose;
    const r = rig.legR[0]! * 0.35;
    if (rig.buzzSpread > 0.02 && ghostAlpha > 0) {
      ctx.globalAlpha = alpha * ghostAlpha;
      for (let g = -1; g <= 1; g += 2) {
        rig.wingPoints(rig.wingAngle + g * rig.buzzSpread, 0, wingScratch);
        ctx.beginPath();
        wingMembrane(ctx, rig, wingScratch);
        ctx.fill();
      }
      ctx.globalAlpha = alpha;
    }
    ctx.beginPath();
    wingMembrane(ctx, rig, w);
    ctx.fill();
    ctx.beginPath();
    wingBones(ctx, rig, w, r);
    ctx.fill();
  }
  // Near wing-arm: the membrane over the flank, then the arm and finger bones.
  if (rig.armWing && rig.s[Math.round(rig.iS + rig.legAt[LEG_FN]! * 8)]! < cut) armWingParts(ctx, rig, st, 0, memb, fill);
}

/** A wing-arm (slot 0 near, 1 far): membrane (translucent in the body pass), then its bones. */
function armWingParts(ctx: CanvasRenderingContext2D, rig: DragonRig, st: PaintState, slot: number, memb: ColorRamp | null, fill: string | CanvasGradient): void {
  if (memb) ctx.fillStyle = memb.at(rig.armLift[slot]! * (1 - rig.wingBurn));
  ctx.beginPath();
  armMembranePath(ctx, rig, slot, st.dress, rig.ind.dress.torn);
  ctx.fill();
  if (memb) ctx.fillStyle = fill;
  ctx.beginPath();
  armBonesPath(ctx, rig, slot);
  ctx.fill();
}

function farParts(ctx: CanvasRenderingContext2D, rig: DragonRig, st: PaintState): void {
  const cut = rig.dissolve;
  // The far wing-arm and plate row, behind everything.
  if (rig.armWing && rig.s[Math.round(rig.iS + rig.legAt[LEG_FN]! * 8)]! < cut) armWingParts(ctx, rig, st, 1, null, '');
  if (rig.plateFarN > 0) {
    ctx.beginPath();
    platesPath(ctx, rig, true);
    ctx.fill();
  }
  if (rig.wingOn && rig.s[Math.round(rig.iS + rig.wingAt * 8)]! < cut) {
    rig.wingPoints(rig.wingAngle - 0.1, 1, wingScratch);
    ctx.beginPath();
    wingMembrane(ctx, rig, wingScratch);
    ctx.fill();
  }
  for (let k = 0; k < 4; k++) {
    if (!rig.legOn[k] || !rig.legFar[k]) continue;
    if (rig.armWing && k < 2) continue;
    if (rig.s[Math.round(rig.iS + rig.legAt[k]! * 8)]! > cut) continue;
    ctx.beginPath();
    legPath(ctx, rig, k);
    ctx.fill();
  }
  if (rig.heads > 1 && cut > 0.015) {
    ctx.beginPath();
    extraNeckPath(ctx, rig, 1);
    ctx.fill();
    ctx.save();
    headFrame(ctx, rig, 1);
    headPaths(ctx, rig, 1, st);
    ctx.restore();
  }
}

// ---- glows ----

function sprite(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, size: number): void {
  ctx.drawImage(img, x - size * 0.5, y - size * 0.5, size, size);
}

function drawEye(ctx: CanvasRenderingContext2D, rig: DragonRig, h: number, st: PaintState, res: PaintRes, pxPerHead: number): void {
  const hs = rig.head;
  const lid = rig.lid[h]!;
  const dizzy = rig.ch[C_DIZZY]!;
  const anger = rig.ch[C_ANGER]!;
  // Readability: never smaller than ~2.2 px radius.
  const eR = Math.max(hs.eyeR, 2.2 / pxPerHead);
  const ex = hs.eyeX;
  const ey = hs.eyeY;
  const open = 1 - lid;
  const boost = rig.ind.dress.eyeGlow;
  const cat = rig.ind.dress.cataract;
  // Glow, even through a closed lid (dimmer); bosses' eyes burn brighter and wider.
  ctx.globalCompositeOperation = 'lighter';
  // (Cataracts glow softly: a pale, milky light rather than a burning one.)
  ctx.globalAlpha = st.alpha * (0.35 + 0.45 * open) * (1 - st.burn * 0.5) * (1 + 0.45 * boost) * (1 - 0.45 * cat);
  sprite(ctx, res.glowEye, ex, ey, Math.max(eR * 7, 16 / pxPerHead) * (1 + 0.7 * boost));
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = st.alpha;
  if (open < 0.08) {
    // Closed: a thin lit slit.
    ctx.fillStyle = res.eye;
    ctx.fillRect(ex - eR, ey - eR * 0.06, eR * 2, Math.max(eR * 0.12, 0.7 / pxPerHead));
    return;
  }
  const ry = eR * 0.82 * open;
  ctx.fillStyle = res.eye;
  ctx.beginPath();
  ctx.ellipse(ex, ey, eR * 1.1, ry, -0.12 - anger * 0.25, 0, TAU);
  ctx.fill();
  // Molten center: brighter toward the middle.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = st.alpha * 0.55;
  sprite(ctx, res.glowHot, ex + eR * 0.1, ey + ry * 0.1, eR * 2.2);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = st.alpha;
  ctx.fillStyle = res.silhouette;
  if (dizzy > 0.1) {
    // Spiral pupil.
    ctx.strokeStyle = res.silhouette;
    ctx.lineWidth = eR * 0.2;
    ctx.beginPath();
    const turns = 2.2;
    const spin = st.time * 9;
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const a = spin + t * turns * TAU;
      const r = eR * 0.8 * t;
      const px = ex + Math.cos(a) * r;
      const py = ey + Math.sin(a) * r * open;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else if (cat > 0.01) {
    // Cataract: a clouded pupil that no longer tracks anything, under a milky, glowing film.
    ctx.globalAlpha = st.alpha * 0.3;
    ctx.beginPath();
    ctx.ellipse(ex - eR * 0.12, ey + ry * 0.08, eR * 0.46, Math.min(ry * 0.8, eR * 0.52), 0, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = st.alpha * 0.4 * cat;
    sprite(ctx, res.glowWhite, ex - eR * 0.2, ey - ry * 0.2, eR * 2.6);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = st.alpha;
  } else {
    // Slit pupil, shifted toward what it's watching (in head space).
    const a = rig.headA[h]!;
    const wx = st.lookX - (rig.headX[h]! + ex * rig.headLen);
    const wy = st.lookY - (rig.headY[h]! + ey * rig.headLen);
    const c = Math.cos(-a);
    const s = Math.sin(-a);
    let lx = wx * c - wy * s;
    let ly = wx * s + wy * c;
    const l = Math.sqrt(lx * lx + ly * ly) || 1;
    lx /= l;
    ly /= l;
    const px = ex + lx * eR * 0.42;
    const py = ey + ly * eR * 0.28 * open;
    // Young newts have round, curious pupils; old wyrms have slits.
    const pw = eR * (0.42 - 0.24 * rig.ind.maturity) * (1 - anger * 0.35);
    ctx.beginPath();
    ctx.ellipse(px, py, pw, Math.min(ry * 0.92, eR * (0.55 + 0.17 * rig.ind.maturity)), 0, 0, TAU);
    ctx.fill();
    // A glint.
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = st.alpha * 0.8;
    ctx.beginPath();
    ctx.arc(ex - eR * 0.35, ey - ry * 0.35, eR * 0.16, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = st.alpha;
  }
  // Brow lid: an angled cut across the top of the iris (angry), clipped to the eye.
  if (anger > 0.02) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, ey, eR * 1.15, ry * 1.08 + eR * 0.02, -0.12 - anger * 0.25, 0, TAU);
    ctx.clip();
    ctx.fillStyle = res.silhouette;
    ctx.beginPath();
    const slant = 0.9 * anger;
    const top = ey - ry * (1 - anger * 0.62);
    ctx.moveTo(ex - eR * 1.3, top - eR * slant * 0.2);
    ctx.lineTo(ex + eR * 1.3, top + eR * slant);
    ctx.lineTo(ex + eR * 1.3, ey - eR * 1.5);
    ctx.lineTo(ex - eR * 1.3, ey - eR * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/**
 * A weak-spot marker. The loose scale (and the swipe target) is a white-hot scale with a cool cyan
 * halo; the breath-windup throat is a molten pouch under the jaw with a cyan rim, sized to the head
 * so it never swamps the eye. Markers on the head keep a tight halo for the same reason.
 */
function drawWeak(
  ctx: CanvasRenderingContext2D,
  rig: DragonRig,
  res: PaintRes,
  st: PaintState,
  x: number,
  y: number,
  ang: number,
  a: number,
  hov: number,
  mode: number,
  onHead: number,
  pxPerU: number,
): void {
  const pulse = 0.5 + 0.5 * Math.sin(st.time * 7.5);
  if (mode === WEAK_MODE_THROAT) {
    const rp = Math.max(rig.headLen * 0.16, 3.5 / pxPerU);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * (0.55 + 0.35 * pulse);
    sprite(ctx, res.glowFire, x, y, rp * 4.2);
    ctx.globalAlpha = a * (0.3 + 0.2 * pulse + 0.3 * hov);
    sprite(ctx, res.glowCyan, x, y, rp * (3.4 + hov));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    // The pouch: a swollen, molten bulge, then its cyan rim.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rig.headA[0]!);
    ctx.fillStyle = res.pouch;
    ctx.beginPath();
    ctx.ellipse(0, 0, rp * 1.25, rp * (0.8 + 0.08 * pulse), 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = res.cyan;
    ctx.lineWidth = Math.max(rp * 0.2, 1.3 / pxPerU);
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * (0.45 + 0.45 * pulse);
    sprite(ctx, res.glowHot, x, y, rp * (1.5 + 0.4 * pulse));
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  const r = st.weakR;
  const halo = onHead ? 3.2 : 5 + 1.6 * pulse;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a * (0.45 + 0.3 * pulse + 0.25 * hov);
  sprite(ctx, res.glowCyan, x, y, r * halo * (1 + hov * 0.4));
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = a;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang - 0.45 + 0.1 * Math.sin(st.time * 3.1));
  const s = r * (2.1 + 0.15 * pulse + hov * 0.4) * (onHead ? 0.85 : 1);
  ctx.drawImage(res.scale, -s * 0.5, -s * 0.5, s, s);
  ctx.restore();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a * (0.35 + 0.4 * pulse + 0.3 * hov);
  sprite(ctx, res.glowWhite, x, y, r * (1.3 + 0.5 * pulse));
  ctx.globalCompositeOperation = 'source-over';
}

/** Marker mode of the breath-windup throat (mirrors weakspot.ts WEAK_THROAT; kept local to avoid a cycle). */
const WEAK_MODE_THROAT = 1;

/**
 * Paint the dragon into ctx for view. Pure with respect to state: reads rig + st, draws.
 * `cam` provides the world transform; `pxPerU` is screen px per rig unit at this view.
 */
export function paintDragon(
  ctx: CanvasRenderingContext2D,
  rig: DragonRig,
  st: PaintState,
  res: PaintRes,
  cam: { apply(ctx: CanvasRenderingContext2D): void; zoomEff: number; rotEff: number },
  light: { x: number; y: number },
  rimWidthPx: number,
): void {
  if (st.alpha <= 0.004) return;
  const L = st.L;
  const pxPerU = cam.zoomEff * L;
  // Placement: the turn-around mirror about the body middle, then the world shift (rig.placeX).
  const face = rig.ch[C_FACE]!;
  ctx.save();
  cam.apply(ctx);
  ctx.translate(st.originX + (rig.midX + rig.ch[C_SHIFT]!) * L, 0);
  ctx.scale(L * face, L);
  ctx.translate(-rig.midX, 0);

  const lenPx = pxPerU;
  // Rim width grows gently with on-screen size, flares on hits and hover.
  let rimPx = rimWidthPx * (0.85 + Math.min(1.6, lenPx / 420));
  rimPx *= 1 + st.hot * 1.3 + st.hoverBody * 0.35;
  const rimU = rimPx / pxPerU;
  // Screen-space light direction -> rig space (undo camera roll).
  const cr = Math.cos(-cam.rotEff);
  const sr = Math.sin(-cam.rotEff);
  // Mirrored (turning around): flip the offset back to the lit side, and keep its screen width.
  const fx = face < 0 ? -1 / Math.max(0.35, -face) : 1 / Math.max(0.35, face);
  const lx = (light.x * cr - light.y * sr) * rimU * fx;
  const ly = (light.x * sr + light.y * cr) * rimU;

  // ---- fire light on the ground (under everything) ----
  if (st.fire > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, st.fire) * 0.55;
    ctx.save();
    ctx.translate(st.fireX, st.fireY);
    ctx.scale(1, 0.3);
    const g = st.fireR * (1.6 + 0.4 * Math.min(1, st.fire));
    sprite(ctx, res.glowFire, 0, 0, g);
    ctx.globalAlpha = Math.min(1, st.fire) * 0.3;
    sprite(ctx, res.glowHot, 0, 0, g * 0.35);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ---- contact shadow (heavier under huge dragons; spreads and fades under a flier) ----
  if (rig.dissolve > 0.3) {
    const fade = st.lift > 0 ? Math.max(0, 1 - st.lift * 2.2) : 1;
    const spread = st.lift > 0 ? 1 + Math.min(0.5, st.lift * 0.8) : 1;
    ctx.globalAlpha = (0.5 + 0.25 * st.big) * st.alpha * Math.min(1, (rig.dissolve - 0.3) * 3) * fade;
    ctx.save();
    const mid = rig.x[rig.iS + 4]!;
    ctx.translate(mid, rig.groundY);
    ctx.scale(1, 0.12 + 0.03 * st.big);
    sprite(ctx, res.glowDark, 0, 0, 0.95 * (1 + 0.35 * st.big) * spread);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  const detail = pxPerU > 380;
  // Aerial perspective: huge dragons fade toward the sky haze with height (built once per dragon).
  let bodyFill: string | CanvasGradient = res.silhouette;
  if (st.big > 0.02) {
    if (!st.hazeGrad || st.hazeFor !== rig.ind || st.hazeRes !== res) {
      const g = ctx.createLinearGradient(0, 0, 0, rig.restMinY * 1.15);
      g.addColorStop(0, res.silhouette);
      g.addColorStop(0.5, mixHex(res.silhouette, res.haze, 0.06 * st.big));
      g.addColorStop(1, mixHex(res.silhouette, res.haze, 0.2 * st.big));
      st.hazeGrad = g;
      st.hazeFor = rig.ind;
      st.hazeRes = res;
    }
    bodyFill = st.hazeGrad;
  }

  const alpha = st.alpha;
  ctx.globalAlpha = alpha;
  const rimColor = st.burn > 0.01 ? res.rimBurn.at(st.burn) : res.rimHot.at(Math.min(1, st.hot));

  // ---- far side (hazier), with its own rim ----
  ctx.save();
  ctx.translate(lx, ly);
  ctx.fillStyle = rimColor;
  farParts(ctx, rig, st);
  ctx.restore();
  ctx.fillStyle = res.farRamp.at(st.big);
  farParts(ctx, rig, st);
  const snow = rig.ind.dress.snow;
  if (snow > 0.01 && rig.plateFarN > 0) {
    ctx.fillStyle = res.snowFar;
    ctx.beginPath();
    snowPath(ctx, rig, true, snow);
    ctx.fill();
  }

  // ---- main silhouette: a soft wide rim (light wrapping the edge), the crisp rim, then the body ----
  if (lenPx > 90) {
    ctx.save();
    ctx.translate(lx * 2.4, ly * 2.4);
    ctx.globalAlpha = alpha * 0.22;
    ctx.fillStyle = rimColor;
    nearParts(ctx, rig, st, alpha * 0.22, 0, detail, null, rimColor);
    ctx.restore();
    ctx.globalAlpha = alpha;
  }
  ctx.save();
  ctx.translate(lx, ly);
  ctx.fillStyle = rimColor;
  nearParts(ctx, rig, st, alpha, 0, detail, null, rimColor);
  ctx.restore();
  ctx.fillStyle = bodyFill;
  nearParts(ctx, rig, st, alpha, 0.32, detail, rig.armWing ? res.membrane : null, bodyFill);

  // ---- boss dressings over the silhouette: moss, a snow mantle, old scars ----
  const dress = st.dress;
  if (dress !== null && dress.mossN > 0) {
    ctx.fillStyle = res.moss;
    ctx.globalAlpha = alpha * 0.9;
    ctx.beginPath();
    mossPath(ctx, rig, dress);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  if (snow > 0.01 && rig.plateN > 0) {
    ctx.fillStyle = res.snow;
    ctx.globalAlpha = alpha * 0.92;
    ctx.beginPath();
    snowPath(ctx, rig, false, snow);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  if (dress !== null && dress.scarN > 0 && rig.dissolve > 0.3) {
    ctx.strokeStyle = res.scar;
    ctx.globalAlpha = alpha * 0.42;
    ctx.lineWidth = Math.max(1.2 / pxPerU, 0.0028);
    ctx.lineCap = 'round';
    ctx.beginPath();
    scarsPath(ctx, rig, dress);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // ---- scale texture catching the light along the back (big on screen only) ----
  if (pxPerU > 420 && rig.dissolve > 0.6) {
    ctx.strokeStyle = rimColor;
    ctx.globalAlpha = alpha * 0.14 * Math.min(1, (pxPerU - 420) / 250);
    ctx.lineWidth = 1.1 / pxPerU;
    ctx.beginPath();
    scaleRows(ctx, rig);
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // ---- inner fire: the throat and chest glow through the hide ----
  const glow = rig.ch[C_GLOW]!;
  if (glow > 0.02 && rig.dissolve > 0.2) {
    ctx.save();
    ctx.beginPath();
    bodyPath(ctx, rig);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.85 + 0.15 * Math.sin(st.time * 37) * Math.sin(st.time * 23);
    // Throat: fire welling up the neck (belly side), hottest just under the jaw.
    rig.spineAt(rig.iS * 0.35, sampleA);
    const tw = (sampleA.belly + sampleA.back) * (1.2 + rig.ch[C_THROAT]! * 0.4);
    const gx = sampleA.x - sampleA.nx * sampleA.belly * 0.45;
    const gy = sampleA.y - sampleA.ny * sampleA.belly * 0.45;
    ctx.globalAlpha = Math.min(1, glow * flick);
    sprite(ctx, res.glowFire, gx, gy, tw * 2.6);
    ctx.globalAlpha = Math.min(1, glow * 0.75 * flick);
    sprite(ctx, res.glowHot, gx, gy, tw * 1.1);
    // Lower neck and chest: the fire sac.
    rig.spineAt(rig.iS * 0.85, sampleB);
    ctx.globalAlpha = Math.min(1, glow * 0.8);
    sprite(ctx, res.glowFire, sampleB.x - sampleB.nx * sampleB.belly * 0.5, sampleB.y - sampleB.ny * sampleB.belly * 0.5, (sampleB.belly + sampleB.back) * 2.2);
    rig.spineAt(rig.iS + 1.4, sampleB);
    ctx.globalAlpha = Math.min(1, glow * 0.55);
    sprite(ctx, res.glowFire, sampleB.x - sampleB.nx * sampleB.belly * 0.55, sampleB.y - sampleB.ny * sampleB.belly * 0.55, (sampleB.belly + sampleB.back) * 1.6);
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  // ---- crit flash: the whole silhouette glints ----
  if (st.hot > 0.55) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (st.hot - 0.55) * 0.9 * alpha;
    ctx.fillStyle = res.rim;
    ctx.beginPath();
    bodyPath(ctx, rig);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
  }

  // ---- eyes and the mouth fire ----
  if (rig.dissolve > 0.03) {
    const pxPerHead = pxPerU * rig.headLen;
    for (let h = 0; h < rig.heads; h++) {
      ctx.save();
      headFrame(ctx, rig, h);
      drawEye(ctx, rig, h, st, res, pxPerHead);
      if (h === 0 && st.dress !== null && st.dress.faceScar > 0) {
        ctx.strokeStyle = res.scar;
        ctx.globalAlpha = alpha * 0.6;
        ctx.lineWidth = Math.max(1.3 / pxPerHead, 0.018);
        ctx.lineCap = 'round';
        ctx.beginPath();
        faceScarPath(ctx, rig.head);
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
      // Fire in the mouth / smoke-glow leaking when the jaw opens with a hot throat.
      const heat = Math.max(glow, st.fire);
      if (heat > 0.02 && rig.jaw[h]! > 0.04) {
        const hs = rig.head;
        const ja = jawAngle(rig, h);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, heat * (0.6 + rig.jaw[h]! * 0.6)) * alpha;
        const mx = hs.lipX * 0.6 + hs.hingeX * 0.4;
        const my = MOUTH_Y + 0.05 + ja * 0.22;
        sprite(ctx, res.glowFire, mx, my, 0.7 + st.fire * 0.5);
        sprite(ctx, res.glowHot, mx - 0.12, my, 0.25 + st.fire * 0.3);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha;
      }
      ctx.restore();
    }
  }

  // ---- weak spot: a loose, white-hot scale with a cool cyan halo ----
  if (st.weak2On > 0.01) drawWeak(ctx, rig, res, st, st.weak2X, st.weak2Y, st.weak2A, st.weak2On * alpha, 0, st.weak2Mode, 0, pxPerU);
  if (st.weakOn > 0.01) drawWeak(ctx, rig, res, st, st.weakX, st.weakY, st.weakA, st.weakOn * alpha, st.hover, st.weakMode, st.weakOnHead, pxPerU);
  ctx.globalAlpha = alpha;

  // ---- dizzy stars circling the head ----
  const dizzy = rig.ch[C_DIZZY]!;
  if (dizzy > 0.05 && rig.dissolve > 0.1) {
    const hl = rig.headLen;
    rig.headToU(0, -0.35, -0.9, tmpP);
    const cx = tmpP.x;
    const cy = tmpP.y;
    const minS = 9 / pxPerU;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const ang = st.time * 4.2 + (k * TAU) / 4;
      const depth = 0.65 + 0.35 * Math.sin(ang);
      const sx = cx + Math.cos(ang) * hl * 0.75;
      const sy = cy + Math.sin(ang) * hl * 0.2;
      ctx.globalAlpha = dizzy * depth * alpha;
      const size = Math.max(hl * 0.36, minS) * depth;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(st.time * 3 + k);
      ctx.drawImage(res.star, -size * 0.5, -size * 0.5, size, size);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
  }

  // ---- the burning edge while dissolving ----
  if (rig.dissolve < 0.999 && rig.dissolve > 0.001) {
    const cut = cutIndex(rig);
    rig.spineAt(cut, sampleA);
    const w = sampleA.back + sampleA.belly;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const t = k / 3 - 0.5;
      const f = 0.75 + 0.25 * Math.sin(st.time * 23 + k * 2.1);
      ctx.globalAlpha = f * alpha;
      const px = sampleA.x + sampleA.nx * (t * w + (sampleA.back - sampleA.belly) * 0.5);
      const py = sampleA.y + sampleA.ny * (t * w + (sampleA.back - sampleA.belly) * 0.5);
      sprite(ctx, res.glowEmber, px, py, Math.max(w * 1.6, 10 / pxPerU));
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}
