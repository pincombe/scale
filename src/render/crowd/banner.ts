// Banners: the army's main color accent. A flag streams from the top of a bearer's pole, rippling
// in the wind (drawn as vertical strips of a baked cloth texture, each strip offset by a travelling
// wave and shaded lit / base / shadow by the wave's phase, so it reads as folds catching the sun).
//
// Heraldry: drawEmblem() is the ONE place a coat of arms is painted. M1 flies a placeholder (red
// field, gold sword); the M2 Heraldry WP swaps the description and extends drawEmblem.
import { context2d, makeCanvas } from '../atlas';
import { mixHex } from '../../lib/color';
import type { Palette } from '../palette';
import type { Heraldry } from './api';

export type { Heraldry } from './api';

/** Flag size in figure units (a knight is 100 tall). Archer back-banners fly at FLAG_SMALL. */
export const FLAG_W = 46;
export const FLAG_H = 31;
export const FLAG_SMALL = 0.72;
/** Pole length above the grip, and below it (figure units). */
export const POLE_UP = 108;
export const POLE_DOWN = 34;

export function defaultHeraldry(p: Palette): Heraldry {
  return { field: p.accent.banner, tincture: p.accent.gold, charge: 'sword' };
}

/**
 * Paint a coat of arms into the rect (0, 0, w, h): the field, then the charge. Shared by banners
 * and the hero's shield. Charges M1 knows: 'sword' (default), 'none'.
 */
export function drawEmblem(ctx: CanvasRenderingContext2D, h: Heraldry, w: number, hh: number): void {
  ctx.fillStyle = h.field;
  ctx.fillRect(0, 0, w, hh);
  if (h.charge === 'none') return;
  // A sword, point down: a gold cross from afar, a blade up close.
  const cx = w * 0.5;
  const s = Math.min(w, hh);
  const top = hh * 0.5 - s * 0.4;
  const bot = hh * 0.5 + s * 0.42;
  const bw = s * 0.07;
  ctx.fillStyle = h.tincture;
  ctx.beginPath();
  ctx.moveTo(cx - bw, top + s * 0.2);
  ctx.lineTo(cx + bw, top + s * 0.2);
  ctx.lineTo(cx + bw * 0.8, bot - s * 0.1);
  ctx.lineTo(cx, bot);
  ctx.lineTo(cx - bw * 0.8, bot - s * 0.1);
  ctx.closePath();
  ctx.fill();
  // Crossguard, grip, pommel.
  ctx.fillRect(cx - s * 0.24, top + s * 0.14, s * 0.48, s * 0.075);
  ctx.fillRect(cx - bw * 0.7, top + s * 0.02, bw * 1.4, s * 0.14);
  ctx.beginPath();
  ctx.arc(cx, top + s * 0.01, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

/** Baked flag cloth: [size][shade] with size 0 = near, 1 = far; shade 0 (deep fold) .. 2 (base) .. 4 (lit). */
export class BannerArt {
  readonly tex: HTMLCanvasElement[][] = [];
  /** Device px per figure unit each size was baked at. */
  static readonly SCALE = [3.2, 0.9] as const;
  private key = '';

  /** (Re)bake if the heraldry or palette changed. */
  update(h: Heraldry, p: Palette): void {
    const key = h.field + h.tincture + h.charge + p.rim + p.silhouette;
    if (key === this.key) return;
    this.key = key;
    this.tex.length = 0;
    for (const s of BannerArt.SCALE) this.tex.push(bakeCloth(h, p, Math.ceil(FLAG_W * s), Math.ceil(FLAG_H * s)));
  }
}

function clothPath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Hoist at the right edge (x = w), swallowtail fly end at the left.
  const notch = w * 0.2;
  ctx.beginPath();
  ctx.moveTo(w, 0);
  ctx.lineTo(0, 0);
  ctx.lineTo(notch, h * 0.5);
  ctx.lineTo(0, h);
  ctx.lineTo(w, h);
  ctx.closePath();
}

function bakeCloth(h: Heraldry, p: Palette, w: number, hh: number): HTMLCanvasElement[] {
  const base = makeCanvas(w, hh);
  const b = context2d(base);
  clothPath(b, w, hh);
  b.save();
  b.clip();
  // The emblem centered on the body of the flag (away from the swallowtail notch).
  const ew = w * 0.72;
  b.save();
  b.translate(w - ew, 0);
  drawEmblem(b, h, ew, hh);
  b.restore();
  b.fillStyle = h.field;
  b.fillRect(0, 0, w - ew + 1, hh);
  // Trim: gold edge along the top and bottom, a dark sleeve at the hoist.
  const t = Math.max(1, hh * 0.07);
  b.fillStyle = mixHex(h.tincture, h.field, 0.35);
  b.fillRect(0, 0, w, t);
  b.fillRect(0, hh - t, w, t);
  b.fillStyle = mixHex(h.field, p.silhouette, 0.55);
  b.fillRect(w - Math.max(1.5, w * 0.06), 0, w, hh);
  // Soft vertical shading: the cloth sags away from the edges.
  const g = b.createLinearGradient(0, 0, 0, hh);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.28)');
  b.fillStyle = g;
  b.fillRect(0, 0, w, hh);
  b.restore();

  const shaded = (color: string, alpha: number, op: GlobalCompositeOperation): HTMLCanvasElement => {
    const c = makeCanvas(w, hh);
    const x = context2d(c);
    x.drawImage(base, 0, 0);
    x.globalCompositeOperation = op;
    x.globalAlpha = alpha;
    x.fillStyle = color;
    x.fillRect(0, 0, w, hh);
    // Keep the cloth's alpha.
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(base, 0, 0);
    return x.canvas;
  };
  // Backlit cloth glows where it faces the sun; folds turned away go deep and warm.
  return [
    shaded(p.silhouette, 0.45, 'source-atop'),
    shaded(p.silhouette, 0.22, 'source-atop'),
    base,
    shaded(p.rim, 0.18, 'source-atop'),
    shaded(p.rim, 0.36, 'source-atop'),
  ];
}

/**
 * Draw a rippling flag. (ta..tf) is the figure-units -> device transform of the knight carrying it;
 * (x, y) is where the top of the hoist meets the pole (figure units); the flag streams toward -x.
 * Each vertical strip is sheared so its top and bottom edges meet the neighbours' exactly (no
 * stair steps), and shaded by the wave's phase so the folds catch the light.
 */
export function drawFlag(
  g: CanvasRenderingContext2D,
  art: BannerArt,
  size: number,
  ta: number,
  tb: number,
  tc: number,
  td: number,
  te: number,
  tf: number,
  x: number,
  y: number,
  scale: number,
  t: number,
  phase: number,
  strips: number,
  droop: number,
): void {
  const texes = art.tex[size];
  if (!texes) return;
  const tw = texes[2]!.width;
  const th = texes[2]!.height;
  const w = FLAG_W * scale;
  const h = FLAG_H * scale;
  const inv = 1 / strips;
  const amp = 3.4 * scale;
  const k = 5.4;
  const om = 7.2;
  const sw = w * inv;
  const ov = Math.min(0.35, sw * 0.08);
  let d0 = 0;
  let y0 = 0;
  for (let j = 0; j < strips; j++) {
    const d1 = d0 + inv;
    const ph1 = om * t - k * d1 + phase;
    const y1 = amp * d1 * Math.sin(ph1) + droop * d1 * d1 * h;
    // Strip spans x from xa (hoist side) to xb = xa - sw; its edges are sheared from y0 to y1.
    const xa = x - d0 * w;
    const sl = (y1 - y0) / -sw;
    const off = y + y0 - sl * xa;
    const c = Math.cos(om * t - k * (d0 + inv * 0.5) + phase);
    const shade = c > 0.6 ? 4 : c > 0.2 ? 3 : c > -0.2 ? 2 : c > -0.6 ? 1 : 0;
    g.setTransform(ta + tc * sl, tb + td * sl, tc, td, te + tc * off, tf + td * off);
    g.drawImage(texes[shade]!, (1 - d1) * tw, 0, tw * inv, th, xa - sw - ov, 0, sw + ov * 2, h);
    d0 = d1;
    y0 = y1;
  }
}

/** A tiny gold spearhead finial on a pole top (figure units, current transform). */
export function drawFinial(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, color: string): void {
  const px = -dy;
  const py = dx;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + dx * 10, y + dy * 10);
  ctx.lineTo(x + px * 3, y + py * 3);
  ctx.lineTo(x - dx * 2, y - dy * 2);
  ctx.lineTo(x - px * 3, y - py * 3);
  ctx.closePath();
  ctx.fill();
}

/** Squad size plates ("x25") for banners once one sprite stands for many knights. Cached per count. */
export class CountLabels {
  private readonly cache = new Map<number, HTMLCanvasElement>();

  get(n: number, p: Palette): HTMLCanvasElement {
    let c = this.cache.get(n);
    if (c) return c;
    const text = '×' + (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
    const fs = 40;
    c = makeCanvas(fs * (0.8 + text.length * 0.62), fs * 1.3);
    const x = context2d(c);
    x.fillStyle = mixHex(p.silhouette, '#000000', 0.2);
    x.globalAlpha = 0.78;
    const r = fs * 0.3;
    const W = c.width;
    const H = c.height;
    x.beginPath();
    x.moveTo(r, 0);
    x.arcTo(W, 0, W, H, r);
    x.arcTo(W, H, 0, H, r);
    x.arcTo(0, H, 0, 0, r);
    x.arcTo(0, 0, W, 0, r);
    x.closePath();
    x.fill();
    x.globalAlpha = 1;
    x.font = `700 ${fs}px "Cinzel Variable", Cinzel, Georgia, serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = p.accent.gold;
    x.fillText(text, c.width / 2, c.height / 2 + fs * 0.05);
    this.cache.set(n, c);
    return c;
  }
}
