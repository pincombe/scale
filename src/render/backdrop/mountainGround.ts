// The Mountain's ground (depth 1, y >= 0): the world wyrm's hide (hide.ts), baked into a cache
// of the visible band at a zoom bucket like the ridge layers (re-baked, at most once per frame,
// when the zoom drifts or the view pans past the slack), plus a screen-space haze where the hide
// recedes into the distance at the ridge line, and the afterglow's sheen along it.
//
// While frozen (the zoom flies the camera) it never re-bakes: magnified past ~1.3x it draws the
// hide as vectors (crisp, and exactly what the zoom's own close-up draws), otherwise the cache
// scaled.
import type { Palette } from '../palette';
import type { View } from '../types';
import type { Rect } from '../../lib/vec';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { drawHide, hideBaseColor, HIDE_S0 } from './hide';

/** The crest's scales rise this far above the ridge line (m): the bake starts here. */
const CREST = -HIDE_S0 * 0.9;

/** Re-bake once the zoom leaves [reqZ / DOWN, reqZ * UP] (as the ridges). */
const REBAKE_UP = 1.02;
const REBAKE_DOWN = 1.32;
const HEADROOM = 1.1;
const SLACK = 0.08;
const MAX_BAKE_PX = 8192;
const MAX_BAKE_AREA = 12e6;
/** Magnification (vs the cache) past which a frozen ground draws vectors. */
const VECTOR_MAG = 1.3;

export class MountainGround {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private palette: Palette | null = null;
  private x0 = 0;
  private x1 = 0;
  private y1 = 0;
  /** Device px per meter of the bake, and the zoom it was asked for. */
  private k = 0;
  private reqZ = 0;
  private dpr = 0;
  private haze: HTMLCanvasElement | null = null;
  private hazePal: Palette | null = null;

  /** 0 fine, 1 should re-bake (resolution), 2 must (coverage, palette, dpr). */
  need(pal: Palette, zoom: number, vis: Rect, dpr: number): number {
    if (!this.canvas || this.palette !== pal || this.dpr !== dpr) return 2;
    if (vis.x < this.x0 || vis.x + vis.w > this.x1 || vis.y + vis.h > this.y1) return 2;
    if (zoom > this.reqZ * REBAKE_UP || zoom < this.reqZ / REBAKE_DOWN) return 1;
    return 0;
  }

  get baked(): boolean {
    return this.canvas !== null;
  }

  bakedFor(pal: Palette): boolean {
    return this.canvas !== null && this.palette === pal;
  }

  bake(pal: Palette, zoom: number, vis: Rect, dpr: number): void {
    const z = zoom * HEADROOM;
    const slack = vis.w * SLACK;
    const x0 = vis.x - slack;
    const x1 = vis.x + vis.w + slack;
    const y1 = Math.max(0.05, vis.y + vis.h + vis.h * 0.04);
    let k = z * dpr;
    const big = Math.max((x1 - x0) * k, (y1 - CREST) * k) / MAX_BAKE_PX;
    if (big > 1) k /= big;
    const area = (x1 - x0) * (y1 - CREST) * k * k;
    if (area > MAX_BAKE_AREA) k *= Math.sqrt(MAX_BAKE_AREA / area);
    const cw = Math.max(1, Math.ceil((x1 - x0) * k));
    const ch = Math.max(1, Math.ceil((y1 - CREST) * k));
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
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.canvas!.width, this.canvas!.height);
    ctx.setTransform(k, 0, 0, k, -x0 * k, -CREST * k);
    drawHide(ctx, pal, x0, CREST, x1, y1, k / dpr, pal.light.x, pal.light.y);
    this.palette = pal;
    this.x0 = x0;
    this.x1 = x1;
    this.y1 = y1;
    this.k = k;
    this.reqZ = z;
    this.dpr = dpr;
  }

  free(): void {
    for (const c of [this.canvas, this.haze]) if (c) c.width = c.height = 0;
    this.canvas = null;
    this.ctx = null;
    this.palette = null;
    this.haze = null;
    this.hazePal = null;
  }

  bytes(): number {
    let b = 0;
    for (const c of [this.canvas, this.haze]) if (c) b += c.width * c.height * 4;
    return b;
  }

  /** Bake the small palette art (call from update). */
  ensureHaze(pal: Palette): HTMLCanvasElement {
    if (this.haze && this.hazePal === pal) return this.haze;
    const c = this.haze ?? makeCanvas(2, 128);
    const g2 = context2d(c);
    g2.clearRect(0, 0, 2, 128);
    const g = g2.createLinearGradient(0, 0, 0, 128);
    const col = mixHex(pal.haze, pal.depthTint ?? pal.haze, 0.35);
    g.addColorStop(0, rgba(col, 0.62));
    g.addColorStop(0.25, rgba(col, 0.3));
    g.addColorStop(0.6, rgba(col, 0.08));
    g.addColorStop(1, rgba(col, 0));
    g2.fillStyle = g;
    g2.fillRect(0, 0, 2, 128);
    this.haze = c;
    this.hazePal = pal;
    return c;
  }

  /**
   * Draw the ground for this view: `vis` = the viewport's world rect (incl. margin); `frozen` =
   * the zoom flies the camera; `sunX` / `glow` = the afterglow's screen x and a soft glow sprite.
   */
  draw(ctx: CanvasRenderingContext2D, view: View, vis: Rect, frozen: boolean, sunX: number, glow: HTMLCanvasElement): void {
    const cam = view.camera;
    const pal = view.palette;
    const bottom = vis.y + vis.h;
    if (bottom <= 0) return;
    ctx.save();
    cam.apply(ctx);
    const c = this.canvas;
    const mag = c ? (cam.zoomEff * view.dpr) / this.k : Infinity;
    const covered = c !== null && this.palette === pal && vis.x >= this.x0 && vis.x + vis.w <= this.x1 && bottom <= this.y1;
    if (!covered || (frozen && mag > VECTOR_MAG)) {
      // Vectors: a foreign view outside the cache, or the zoom's magnified landing.
      drawHide(ctx, pal, vis.x, Math.max(CREST, vis.y), vis.x + vis.w, bottom, cam.zoomEff, pal.light.x, pal.light.y);
    } else {
      const s = 1 / this.k;
      ctx.drawImage(c!, 0, 0, c!.width, c!.height, this.x0, CREST, c!.width * s, c!.height * s);
      if (bottom > this.y1) {
        ctx.fillStyle = hideBaseColor(pal);
        ctx.fillRect(vis.x, this.y1 - 0.01, vis.w, bottom - this.y1 + 0.01);
      }
    }
    ctx.restore();
    // The hide recedes into haze at the ridge line, and the afterglow skims along it.
    const gy = cam.worldToScreen(cam.x, 0, tmpP).y;
    const H = view.height;
    const band = Math.min(H * 0.11, Math.max(0, H - gy));
    if (band > 1 && this.haze && this.hazePal === pal) {
      ctx.drawImage(this.haze, -80, gy - 1, view.width + 160, band);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16;
    ctx.drawImage(glow, sunX - H * 0.9, gy - H * 0.03, H * 1.8, H * 0.12);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

const tmpP = { x: 0, y: 0 };
