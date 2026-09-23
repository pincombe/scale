// The cloud bank on the ridge line: while the meadow closes into its scale and holds, everything
// beyond the hide (the ridge, the range, the sky) is lost in cloud, so the order of discovery is the
// meadow -> its scale in the hide -> the land beyond. A bank of the Mountain's own vapor (tops lit
// rose by the afterglow, violet shade, stratus layers with lit crests, a warm glow low down where
// the light behind comes through), sitting on the ridge line in world meters: as the camera pulls
// back it shrinks with the world and sinks below the frame's top, the range and the sky rise out of
// it, and it thins away into the backdrop's own low cloud bank as the camera lands.
//
// One horizontally periodic strip, baked once per palette (vapor is soft: a modest resolution,
// drawn scaled), filled as a repeat-x pattern so no tile seam ever shows; one fill a frame.
import type { Palette } from '../palette';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { Noise } from '../../lib/noise';
import { Rng } from '../../lib/rng';
import { TAU } from '../../lib/math';

/** Bank geometry (world m): the billows' mean height above the ridge line, their amplitude, the strip's period, how far below the ridge it fades out. */
const TOP = 0.95;
const BILLOW = 0.075;
const TILE = 2.6;
const BELOW = 0.07;
/** Bake resolution (px per m). */
const PX_PER_M = 200;
/** Drift (m / s). */
const SPEED = 0.018;
/** Stratus layers inside the bank: height above the ridge (m), thickness, strength. */
const STRATA: readonly (readonly [number, number, number])[] = [
  [0.2, 0.09, 0.55],
  [0.43, 0.12, 0.45],
  [0.68, 0.14, 0.35],
];

export class MistBank {
  canvas: HTMLCanvasElement | null = null;
  private pal: Palette | null = null;
  private pattern: CanvasPattern | null = null;
  private patternCtx: CanvasRenderingContext2D | null = null;
  /** Canvas covers world y in [y0, y1]. */
  private y0 = 0;
  private y1 = 0;

  ensure(pal: Palette): void {
    if (this.canvas && this.pal === pal) return;
    this.pal = pal;
    this.pattern = null;
    this.patternCtx = null;
    const k = PX_PER_M;
    const pad = BILLOW * 3 + 0.08;
    this.y0 = -(TOP + pad);
    this.y1 = BELOW;
    const w = Math.round(TILE * k);
    const h = Math.ceil((this.y1 - this.y0) * k);
    const c = this.canvas ?? makeCanvas(1, 1);
    c.width = w;
    c.height = h;
    this.canvas = c;
    const ctx = context2d(c);
    ctx.setTransform(k, 0, 0, k, 0, -this.y0 * k);

    const n = new Noise(0x3a17);
    const rng = new Rng(0x51e7);
    const per = (x: number, f: number, s: number): number => n.simplex2(Math.cos((x / TILE) * TAU) * f, Math.sin((x / TILE) * TAU) * f + s);
    const tint = pal.depthTint ?? pal.haze;
    const violet = mixHex(pal.haze, tint, 0.55);
    const lit = mixHex(mixHex(pal.haze, pal.rim, 0.62), '#ffffff', 0.1);
    const glow = mixHex(mixHex(pal.haze, pal.sun.glow, 0.42), pal.rim, 0.25);
    const low = mixHex(pal.haze, pal.rim, 0.22);

    // The bank's body: a billowy top edge, violet shade above, warming to a glow at the ridge.
    const topAt = (x: number): number => TOP + BILLOW * (0.6 * per(x, 1.2, 2.3) + 0.4 * per(x, 3.3, 5.9));
    const path = new Path2D();
    path.moveTo(-0.3, BELOW + 0.1);
    for (let x = -0.3; x <= TILE + 0.3; x += 0.02) path.lineTo(x, -topAt(x));
    path.lineTo(TILE + 0.3, BELOW + 0.1);
    path.closePath();
    const lobes = 22;
    for (let i = 0; i < lobes; i++) {
      const x = ((i + rng.float() * 0.8) / lobes) * TILE;
      const r = BILLOW * (0.45 + 0.9 * rng.float()) + 0.03;
      const y = -topAt(x) + r * 0.5;
      for (const o of [-TILE, 0, TILE]) {
        path.moveTo(x + o + r * 1.8, y);
        path.ellipse(x + o, y, r * 1.8, r, 0, 0, TAU);
      }
    }
    const span = TOP + BILLOW + BELOW;
    const at = (y: number): number => Math.min(1, Math.max(0, (y + TOP + BILLOW) / span));
    const body = ctx.createLinearGradient(0, -(TOP + BILLOW), 0, BELOW);
    body.addColorStop(0, lit);
    body.addColorStop(at(-(TOP - 0.06)), mixHex(lit, violet, 0.6));
    body.addColorStop(at(-(TOP - 0.2)), violet);
    body.addColorStop(at(-0.5), mixHex(violet, low, 0.4));
    body.addColorStop(at(-0.22), mixHex(low, glow, 0.45));
    body.addColorStop(at(-0.03), rgba(glow, 1));
    body.addColorStop(at(BELOW * 0.45), rgba(mixHex(glow, pal.haze, 0.5), 0.55));
    body.addColorStop(1, rgba(pal.haze, 0));
    ctx.save();
    ctx.shadowColor = rgba(lit, 0.6);
    ctx.shadowBlur = Math.max(2, 0.06 * k);
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = rgba(lit, 0.45);
    ctx.fill(path);
    ctx.translate(0.012, 0.04);
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.translate(-0.012, -0.04);

    // Stratus layers: each a band of vapor with a billowed crest lit rose, fading down into the
    // bank, so it reads as depth (layer beyond layer), not a wash.
    for (let li = 0; li < STRATA.length; li++) {
      const [hgt, thick, str] = STRATA[li]!;
      const crest = (x: number): number => hgt + thick * 0.35 * (0.6 * per(x, 1.7 + li, 11.3 + li * 3.1) + 0.4 * per(x, 4.1 + li, 17.9 + li));
      const band = new Path2D();
      band.moveTo(-0.3, -(hgt - thick * 1.4));
      for (let x = -0.3; x <= TILE + 0.3; x += 0.02) band.lineTo(x, -crest(x));
      band.lineTo(TILE + 0.3, -(hgt - thick * 1.4));
      band.closePath();
      const g = ctx.createLinearGradient(0, -(hgt + thick * 0.4), 0, -(hgt - thick * 1.4));
      const crestCol = mixHex(lit, glow, 0.35 + 0.15 * li);
      g.addColorStop(0, rgba(crestCol, 0.55 * str));
      g.addColorStop(0.12, rgba(mixHex(crestCol, violet, 0.4), 0.42 * str));
      g.addColorStop(0.5, rgba(violet, 0.22 * str));
      g.addColorStop(1, rgba(violet, 0));
      ctx.fillStyle = g;
      ctx.fill(band);
      // A lit hairline along the crest.
      ctx.translate(0, 0.006);
      ctx.fillStyle = rgba(violet, 0.18 * str);
      ctx.fill(band);
      ctx.translate(0, -0.006);
    }
    // Soft puffs (lighter and darker) inside the bank.
    for (let i = 0; i < 40; i++) {
      const x = rng.float() * TILE;
      const y = -(0.08 + rng.float() * (TOP - 0.16));
      const rx = 0.14 + rng.float() * 0.36;
      const ry = rx * (0.22 + rng.float() * 0.16);
      const light = rng.float() < 0.55;
      const col = light ? mixHex(lit, glow, 0.5) : mixHex(violet, pal.silhouette, 0.2);
      const a = (light ? 0.09 : 0.08) + rng.float() * 0.07;
      for (const o of [-TILE, 0, TILE]) {
        const cx = x + o;
        if (cx + rx < -0.2 || cx - rx > TILE + 0.2) continue;
        ctx.save();
        ctx.translate(cx, y);
        ctx.scale(1, ry / rx);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        rg.addColorStop(0, rgba(col, a));
        rg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
        ctx.restore();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Fill the bank across world x [x0, x1] (the caller applied its camera: world meters). */
  draw(ctx: CanvasRenderingContext2D, x0: number, x1: number, t: number, alpha: number): void {
    const c = this.canvas;
    if (!c || alpha <= 0.002) return;
    if (!this.pattern || this.patternCtx !== ctx) {
      this.pattern = ctx.createPattern(c, 'repeat-x');
      this.patternCtx = ctx;
      if (!this.pattern) return;
    }
    const k = PX_PER_M;
    const off = t * SPEED;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(off, this.y0);
    ctx.scale(1 / k, 1 / k);
    ctx.fillStyle = this.pattern;
    ctx.fillRect((x0 - off) * k, 0, (x1 - x0) * k, c.height);
    ctx.restore();
  }

  bytes(): number {
    return this.canvas ? this.canvas.width * this.canvas.height * 4 : 0;
  }

  release(): void {
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.pattern = null;
    this.patternCtx = null;
    this.pal = null;
  }
}
