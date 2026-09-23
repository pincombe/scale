// Procedural sprites owned by the juice WP, baked once into the shared atlas:
//   slash  - a hot crescent streak (colored: white core, gold glow), points along +x
//   star   - a 4-point glint (white, tint it)
//   beam   - a soft vertical light shaft laid along +x (rotate -PI/2 to stand it up)
//   groundRing - a flat, ground-hugging shockwave ellipse (white, tint it; WP 2.2)
//   coin   - COIN_FRAMES consecutive frames of a spinning gold coin (a particle `ramp`)
import type { SpriteAtlas } from '../atlas';
import { context2d, makeCanvas } from '../atlas';

/** Distinct frames in half a coin revolution (the back looks like the front). */
const COIN_HALF = 8;
/** Half-revolutions baked into the ramp: over a 2 s life that's ~6 flips a second. */
const COIN_HALVES = 12;
export const COIN_FRAMES = COIN_HALF * COIN_HALVES;
const COIN_PX = 56;

export interface FxSprites {
  slash: number;
  star: number;
  beam: number;
  groundRing: number;
  /** First of COIN_FRAMES consecutive ids. */
  coin: number;
}

let cached: { atlas: SpriteAtlas; ids: FxSprites } | null = null;

export function fxSprites(atlas: SpriteAtlas): FxSprites {
  if (cached && cached.atlas === atlas) return cached.ids;
  const ids: FxSprites = {
    slash: atlas.register('fx.slash', 256, 88, drawSlash),
    star: atlas.register('fx.star', 64, 64, drawStar),
    beam: atlas.register('fx.beam', 256, 48, drawBeam),
    groundRing: atlas.register('fx.groundRing', 256, 40, drawGroundRing),
    coin: registerCoin(atlas),
  };
  cached = { atlas, ids };
  return ids;
}

function crescent(ctx: CanvasRenderingContext2D, w: number, h: number, thick: number): void {
  // Outer arc bulges up; inner arc is flatter, so the blade is thickest in the middle.
  const y0 = h * 0.62;
  ctx.beginPath();
  ctx.moveTo(w * 0.04, y0);
  ctx.quadraticCurveTo(w * 0.5, y0 - h * 0.5 - thick, w * 0.96, y0);
  ctx.quadraticCurveTo(w * 0.5, y0 - h * 0.5 + thick, w * 0.04, y0);
  ctx.closePath();
}

function drawSlash(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Gold glow body, then a white-hot core; alpha tapers toward both tips.
  ctx.shadowColor = 'rgba(255,190,80,0.9)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = 'rgba(255,214,120,0.95)';
  crescent(ctx, w, h, h * 0.26);
  ctx.fill();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  crescent(ctx, w, h, h * 0.12);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.3, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.62, 'rgba(0,0,0,1)');
  g.addColorStop(0.85, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** A thin elliptical ring (aspect ~0.14) with a soft glow: a shockwave seen low across the ground. */
function drawGroundRing(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(1, (h - 12) / (w - 12));
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(0, 0, (w - 12) / 2 - 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.2, 'rgba(255,255,255,0.35)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  const ray = (len: number, wid: number, ang: number): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.quadraticCurveTo(0, -wid, len, 0);
    ctx.quadraticCurveTo(0, wid, -len, 0);
    ctx.fill();
    ctx.restore();
  };
  ray(w * 0.5, w * 0.07, 0);
  ray(w * 0.5, w * 0.07, Math.PI / 2);
  ctx.globalAlpha = 0.55;
  ray(w * 0.26, w * 0.05, Math.PI / 4);
  ray(w * 0.26, w * 0.05, -Math.PI / 4);
}

function drawBeam(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  const f = ctx.createLinearGradient(0, 0, w, 0);
  f.addColorStop(0, 'rgba(0,0,0,0.9)');
  f.addColorStop(0.35, 'rgba(0,0,0,0.6)');
  f.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = f;
  ctx.fillRect(0, 0, w, h);
}

/** One flat coin face (front == back), drawn at full width. */
function coinFace(): HTMLCanvasElement {
  const c = makeCanvas(COIN_PX, COIN_PX);
  const ctx = context2d(c);
  const cx = COIN_PX / 2;
  const cy = COIN_PX / 2;
  const r = COIN_PX / 2 - 2;
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r);
  body.addColorStop(0, '#fff7cf');
  body.addColorStop(0.3, '#ffd85e');
  body.addColorStop(0.78, '#e39a1f');
  body.addColorStop(1, '#9c5a0c');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Raised rim and an embossed ring.
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = 'rgba(120,64,8,0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = r * 0.07;
  ctx.strokeStyle = 'rgba(255,240,180,0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.7, Math.PI * 0.9, Math.PI * 1.9);
  ctx.stroke();
  // A little embossed crown-ish star.
  ctx.fillStyle = 'rgba(150,84,10,0.6)';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.2 : r * 0.44;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr + 1);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(255,236,160,0.85)';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.2 : r * 0.44;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.fill();
  return c;
}

function registerCoin(atlas: SpriteAtlas): number {
  if (atlas.has('fx.coin.0')) return atlas.id('fx.coin.0');
  const face = coinFace();
  const frames: HTMLCanvasElement[] = [];
  for (let f = 0; f < COIN_HALF; f++) {
    const phase = (f / COIN_HALF) * Math.PI; // 0 = face-on, PI/2 = edge-on
    const sx = Math.max(0.1, Math.abs(Math.cos(phase)));
    const c = makeCanvas(COIN_PX, COIN_PX);
    const ctx = context2d(c);
    const cx = COIN_PX / 2;
    const r = COIN_PX / 2 - 2;
    // Edge thickness: a darker disc peeking out on the side the coin turns away from.
    const edge = Math.sin(phase) * r * 0.16 * (f < COIN_HALF / 2 ? 1 : -1);
    ctx.fillStyle = '#8a4e0a';
    ctx.beginPath();
    ctx.ellipse(cx + edge, cx, r * sx, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(face, cx - cx * sx, 0, COIN_PX * sx, COIN_PX);
    // Specular sweep: brightest when the face turns toward the light.
    const glint = Math.max(0, Math.cos(phase * 2 - 0.6));
    if (glint > 0.05) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = glint * 0.28;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, COIN_PX, COIN_PX);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    frames.push(c);
  }
  let first = -1;
  for (let i = 0; i < COIN_FRAMES; i++) {
    const id = atlas.add(`fx.coin.${i}`, frames[i % COIN_HALF]!);
    if (i === 0) first = id;
  }
  return first;
}
