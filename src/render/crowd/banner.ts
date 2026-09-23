// Banners: the army's main color accent. A flag streams from the top of a bearer's pole, rippling
// in the wind (drawn as vertical strips of a baked cloth texture, each strip offset by a travelling
// wave and shaded lit / base / shadow by the wave's phase, so it reads as folds catching the sun).
//
// Heraldry: every banner and the hero's shield fly the player's coat of arms (render/heraldry
// drawCoat). The cloth is re-baked once per coat change (BannerArt.update); nothing per frame.
import { context2d, makeCanvas } from '../atlas';
import { mixHex } from '../../lib/color';
import type { Palette } from '../palette';
import type { Heraldry } from './api';
import { fmt } from '../../core/format';
import { M1_COAT } from '../heraldry/coat';
import { drawCoat, tinctureColor } from '../heraldry/draw';

export type { Heraldry } from './api';

/** Flag size in figure units (a knight is 100 tall). Archer back-banners fly at FLAG_SMALL. */
export const FLAG_W = 46;
export const FLAG_H = 31;
export const FLAG_SMALL = 0.72;
/** Pole length above the grip, and below it (figure units). */
export const POLE_UP = 108;
export const POLE_DOWN = 34;

/** Fraction of the flag's length taken by the swallowtail at the fly end. */
const NOTCH = 0.2;

export function defaultHeraldry(p: Palette): Heraldry {
  return { field: p.accent.banner, tincture: p.accent.gold, charge: 'sword', coat: M1_COAT };
}

/**
 * Paint a coat of arms into the rect (0, 0, w, h) (a banner of arms). Legacy descriptions without
 * a `coat` paint a plain field and the M1 sword.
 */
export function drawEmblem(ctx: CanvasRenderingContext2D, h: Heraldry, w: number, hh: number): void {
  if (h.coat) {
    drawCoat(ctx, h.coat, w / 2, hh / 2, hh, { shape: 'banner', aspect: w / hh });
    return;
  }
  ctx.fillStyle = h.field;
  ctx.fillRect(0, 0, w, hh);
  if (h.charge === 'none') return;
  drawCoat(ctx, M1_COAT, w / 2, hh / 2, hh, { shape: 'banner', aspect: w / hh, finish: false });
}

/**
 * The hero's kite shield face: the coat centred on (cx, cy), `height` tall (ctx units), mirrored so
 * its beasts face the way the hero does (toward the dragon).
 */
export function drawShieldFace(ctx: CanvasRenderingContext2D, h: Heraldry, cx: number, cy: number, height: number): void {
  drawCoat(ctx, h.coat ?? M1_COAT, cx, cy, height, { shape: 'kite', mirror: true });
}

/** Baked flag cloth: [size][shade] with size 0 = near, 1 = far; shade 0 (deep fold) .. 2 (base) .. 4 (lit). */
export class BannerArt {
  readonly tex: HTMLCanvasElement[][] = [];
  /** Device px per figure unit each size was baked at. */
  static readonly SCALE = [3.2, 0.9] as const;
  /** Milliseconds the last (re)bake took (debug readout). */
  bakeMs = 0;
  private her: Heraldry | null = null;
  private pal: Palette | null = null;

  /** (Re)bake if the heraldry or palette object changed (compared by identity: no per-frame work). */
  update(h: Heraldry, p: Palette): void {
    if (h === this.her && p === this.pal) return;
    const t0 = performance.now();
    this.her = h;
    this.pal = p;
    this.tex.length = 0;
    for (let i = 0; i < BannerArt.SCALE.length; i++) {
      const s = BannerArt.SCALE[i]!;
      this.tex.push(bakeCloth(h, p, Math.ceil(FLAG_W * s), Math.ceil(FLAG_H * s), i === 0 ? undefined : 0));
    }
    this.bakeMs = performance.now() - t0;
  }
}

function clothPath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Hoist at the right edge (x = w), swallowtail fly end at the left.
  const notch = w * NOTCH;
  ctx.beginPath();
  ctx.moveTo(w, 0);
  ctx.lineTo(0, 0);
  ctx.lineTo(notch, h * 0.5);
  ctx.lineTo(0, h);
  ctx.lineTo(w, h);
  ctx.closePath();
}

function bakeCloth(h: Heraldry, p: Palette, w: number, hh: number, lod?: 0 | 1 | 2): HTMLCanvasElement[] {
  const base = makeCanvas(w, hh);
  const b = context2d(base);
  clothPath(b, w, hh);
  b.save();
  b.clip();
  // A banner of arms: the coat fills the cloth, mirrored so its beasts face the hoist (and the
  // dragon), the principal centred on the body of the flag (away from the swallowtail notch).
  const coat = h.coat;
  if (coat) {
    drawCoat(b, coat, w / 2, hh / 2, hh, { shape: 'banner', aspect: w / hh, mirror: true, openFly: true, focus: (1 + NOTCH * 1.2) / 2, px: hh, lod });
  } else {
    const ew = w * 0.72;
    b.save();
    b.translate(w - ew, 0);
    drawEmblem(b, h, ew, hh);
    b.restore();
    b.fillStyle = h.field;
    b.fillRect(0, 0, w - ew + 1, hh);
  }
  // Trim: a gilt edge along the top and bottom, a dark sleeve at the hoist.
  const field = coat ? tinctureColor(coat.field) : h.field;
  const t = Math.max(1, hh * 0.05);
  b.fillStyle = mixHex(coat ? tinctureColor('or') : h.tincture, field, 0.3);
  b.fillRect(0, 0, w, t);
  b.fillRect(0, hh - t, w, t);
  b.fillStyle = mixHex(field, p.silhouette, 0.55);
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

/** Squad size plates ("×25", "×2.50K") for banners once one sprite stands for many knights. */
export class CountLabels {
  private readonly cache = new Map<number, HTMLCanvasElement>();
  private pal: Palette | null = null;

  /** Cached per count, for the current palette (a new palette clears the cache). */
  get(n: number, p: Palette): HTMLCanvasElement {
    if (p !== this.pal) {
      this.pal = p;
      this.cache.clear();
    }
    let c = this.cache.get(n);
    if (c) return c;
    const text = '×' + fmt(n);
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
