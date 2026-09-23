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

/** Seconds a coat-change flourish takes to sweep a banner or the hero's shield. */
export const FLOURISH_S = 0.85;

/**
 * Baked flag cloth: [size][shade] with size 0 = near, 1 = far; shade 0 (deep fold) .. 2 (base) ..
 * 4 (lit), and 5 = the cloth gilded by the flourish's light.
 */
export class BannerArt {
  readonly tex: HTMLCanvasElement[][] = [];
  /** Device px per figure unit each size was baked at. */
  static readonly SCALE = [3.2, 0.9] as const;
  /** Milliseconds the last (re)bake took (debug readout). */
  bakeMs = 0;
  /** The flourish: pending until the next drawFlag stamps its start time (-1 = none). */
  flourishPending = false;
  flourishT0 = -100;
  private her: Heraldry | null = null;
  private pal: Palette | null = null;

  /** (Re)bake if the heraldry or palette object changed (compared by identity: no per-frame work). */
  update(h: Heraldry, p: Palette): void {
    if (h === this.her && p === this.pal) return;
    const t0 = performance.now();
    if (h.flourish === true && this.her !== null) this.flourishPending = true;
    // The same coat again (a purchase past the ladder): play the flourish, skip the bake.
    if (p === this.pal && h.coat !== undefined && h.coat.key === this.her?.coat?.key && this.tex.length > 0) {
      this.her = h;
      return;
    }
    this.her = h;
    this.pal = p;
    for (let i = 0; i < BannerArt.SCALE.length; i++) {
      const s = BannerArt.SCALE[i]!;
      this.tex[i] = bakeCloth(h, p, Math.ceil(FLAG_W * s), Math.ceil(FLAG_H * s), i === 0 ? undefined : 0, this.tex[i]);
    }
    this.bakeMs = performance.now() - t0;
  }
}

/** Kite face (figure units) the hero's shield is drawn into: x -15..15, y -23..31. */
const FACE_X = -15;
const FACE_Y = -23;
const FACE_W = 30;
const FACE_H = 54;

/**
 * The hero's shield face: the coat in the kite at four levels of detail (6, 2.4, 1 and 0.4 device
 * px per figure unit), so the face is never shrunk more than ~2.5x (no shimmer as the shield tilts),
 * each with a gilded twin for the purchase flourish. Re-baked once per coat or palette change.
 */
export class ShieldArt {
  static readonly SCALE = [6, 2.4, 1, 0.4] as const;
  static readonly LOD = [2, 1, 0, 0] as const;
  readonly faces: HTMLCanvasElement[] = [];
  readonly lit: HTMLCanvasElement[] = [];
  /** Which level of detail holds the current coat (baked lazily: only the one the hero needs). */
  private readonly fresh: boolean[] = [false, false, false, false];
  bakeMs = 0;
  private her: Heraldry | null = null;
  private pal: Palette | null = null;
  private pending = false;
  private t0 = -100;

  update(h: Heraldry, p: Palette): void {
    if (h === this.her && p === this.pal) return;
    if (h.flourish === true && this.her !== null) this.pending = true;
    if (p === this.pal && h.coat !== undefined && h.coat.key === this.her?.coat?.key) {
      this.her = h;
      return;
    }
    this.her = h;
    this.pal = p;
    this.fresh.fill(false);
  }

  /** Bake level of detail i for the current coat (once per change). */
  private bake(i: number): void {
    const h = this.her;
    const p = this.pal;
    if (!h || !p) return;
    const t0 = performance.now();
    const k = SHIELD_FACE_SCALE;
    const s = ShieldArt.SCALE[i]!;
    const c = reuse(this.faces[i], FACE_W * s, FACE_H * s);
    this.faces[i] = c;
    const x = context2d(c);
    drawCoat(x, h.coat ?? M1_COAT, -FACE_X * s, (-FACE_Y + 4 * k) * s, 42 * k * s, { shape: 'kite', mirror: true, lod: ShieldArt.LOD[i]!, px: 42 * k * s });
    // Turned away from the sun: the face sits in the silhouette's shade.
    x.globalCompositeOperation = 'source-atop';
    x.globalAlpha = 0.34;
    x.fillStyle = p.silhouette;
    x.fillRect(0, 0, c.width, c.height);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    this.lit[i] = gild(c, this.lit[i]);
    this.fresh[i] = true;
    this.bakeMs = performance.now() - t0;
  }

  /**
   * Draw the face into the current transform (figure units, the shield's frame) for a render scale
   * of `pxu` device px per figure unit, with the flourish's sweep at time t (s). No allocations.
   */
  draw(ctx: CanvasRenderingContext2D, pxu: number, t: number): void {
    let i = 0;
    for (let j = ShieldArt.SCALE.length - 1; j >= 0; j--) {
      if (ShieldArt.SCALE[j]! >= pxu * 0.9) {
        i = j;
        break;
      }
    }
    if (!this.fresh[i]) this.bake(i);
    const face = this.faces[i];
    if (!face) return;
    ctx.drawImage(face, FACE_X, FACE_Y, FACE_W, FACE_H);
    if (this.pending) {
      this.pending = false;
      this.t0 = t;
    }
    const e = t - this.t0;
    if (e < 0 || e > FLOURISH_S) return;
    // A band of light sweeps across the face, dexter to sinister: vertical slices of the gilded twin.
    const lit = this.lit[i]!;
    const s = ShieldArt.SCALE[i]!;
    const u = e / FLOURISH_S;
    const env = Math.sin(Math.PI * Math.min(1, u * 1.15));
    const cxu = FACE_X - 6 + u * (FACE_W + 12);
    const a0 = ctx.globalAlpha;
    const n = 8;
    const sw = 2;
    for (let k = 0; k < n; k++) {
      const x0 = cxu + (k - n / 2) * sw;
      const a = (1 - Math.abs(k + 0.5 - n / 2) / (n / 2)) * env;
      const lo = Math.max(FACE_X, x0);
      const hi = Math.min(FACE_X + FACE_W, x0 + sw);
      if (hi <= lo || a <= 0.02) continue;
      ctx.globalAlpha = a0 * a;
      ctx.drawImage(lit, (lo - FACE_X) * s, 0, (hi - lo) * s, FACE_H * s, lo, FACE_Y, hi - lo, FACE_H);
    }
    ctx.globalAlpha = a0;
  }
}

/** The hero's kite as drawn by the rig (rig.ts SHIELD_SCALE x 0.9, the face inset from the rim). */
const SHIELD_FACE_SCALE = 1.12 * 0.9;

/** A gilded twin of a baked canvas (same alpha): the flourish's light. */
function gild(src: HTMLCanvasElement, into?: HTMLCanvasElement): HTMLCanvasElement {
  const c = reuse(into, src.width, src.height);
  const x = context2d(c);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'lighter';
  x.globalAlpha = 0.85;
  x.fillStyle = '#ffc860';
  x.fillRect(0, 0, c.width, c.height);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-over';
  return c;
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

/** A canvas of this size: `old` cleared if it fits, else a new one. */
function reuse(old: HTMLCanvasElement | undefined, w: number, h: number): HTMLCanvasElement {
  if (old && old.width === Math.max(1, Math.ceil(w)) && old.height === Math.max(1, Math.ceil(h))) {
    const x = context2d(old);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, old.width, old.height);
    return old;
  }
  return makeCanvas(w, h);
}

function bakeCloth(h: Heraldry, p: Palette, w: number, hh: number, lod: 0 | 1 | 2 | undefined, old: readonly HTMLCanvasElement[] | undefined): HTMLCanvasElement[] {
  const base = reuse(old?.[2], w, hh);
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

  const shaded = (i: number, color: string, alpha: number, op: GlobalCompositeOperation): HTMLCanvasElement => {
    const c = reuse(old?.[i], w, hh);
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
    shaded(0, p.silhouette, 0.45, 'source-atop'),
    shaded(1, p.silhouette, 0.22, 'source-atop'),
    base,
    shaded(3, p.rim, 0.18, 'source-atop'),
    shaded(4, p.rim, 0.36, 'source-atop'),
    gild(base, old?.[5]),
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
  // The flourish: a band of gold light runs from the hoist to the fly, each flag a little later.
  if (art.flourishPending) {
    art.flourishPending = false;
    art.flourishT0 = t;
  }
  const fe = t - art.flourishT0 - (((phase * 0.0917) % 1) + 1) % 1 * 0.35;
  const flo = fe >= 0 && fe <= FLOURISH_S;
  const fu = flo ? fe / FLOURISH_S : 0;
  const fpos = -0.35 + fu * 1.7;
  const fenv = flo ? Math.sin(Math.PI * Math.min(1, fu * 1.1)) : 0;
  const a0 = g.globalAlpha;
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
    if (flo) {
      const fa = Math.max(0, 1 - Math.abs(d0 + inv * 0.5 - fpos) / 0.3) * fenv;
      if (fa > 0.02) {
        g.globalAlpha = a0 * fa;
        g.drawImage(texes[5]!, (1 - d1) * tw, 0, tw * inv, th, xa - sw - ov, 0, sw + ov * 2, h);
        g.globalAlpha = a0;
      }
    }
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
