// The meadow: the old tier, snapshotted at the flash (renderer.drawScene of the world layers, the
// crowd already fused away) and flown into one scale of the new tier's hide.
//
// One buffer the size of the main canvas (~20 MB at 1440x900 DPR 2), allocated at zoomBegin so
// the allocation never lands on the flash frame, released when the zoom is over. Its edges are
// feathered right after the capture: when it starts to shrink, the meadow dissolves into the
// bigger world instead of showing a rectangle. As it nears its scale's size, a frame closes in:
// the plate's rounded top, and the rim light on its lit edge, like every scale around it.
import type { Palette } from '../palette';
import type { Renderer } from '../renderer';
import { WORLD_LAST } from '../renderer';
import type { View } from '../types';
import { context2d, makeCanvas } from '../atlas';
import { AlphaRamp } from '../../lib/color';

/** Feathered margin, as a fraction of the snapshot's shorter side. */
const FEATHER = 0.05;
/** Elliptical vignette strength (0 = none): how far the old world's corners melt away. */
const VIGNETTE = 1;

export class MeadowShot {
  canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  /** CSS size of the view it was captured from. */
  w = 1;
  h = 1;
  captured = false;
  private pal: Palette | null = null;
  private rimRamp: AlphaRamp | null = null;

  /** Allocate the buffer for a view (ahead of the flash). */
  prepare(view: View): void {
    const W = Math.max(1, Math.round(view.width * view.dpr));
    const H = Math.max(1, Math.round(view.height * view.dpr));
    if (!this.canvas || this.canvas.width !== W || this.canvas.height !== H) {
      this.release();
      this.canvas = makeCanvas(W, H);
      this.g = context2d(this.canvas);
    }
    this.captured = false;
  }

  /** Make the browser allocate the backing store now (it is lazy), on a quiet frame before the flash. */
  touch(): void {
    if (this.g) this.g.clearRect(0, 0, 1, 1);
  }

  /** Paint the old tier's world into the buffer (the zoom layer and above are not in it). */
  capture(renderer: Renderer, view: View): void {
    this.prepare(view);
    const g = this.g!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    renderer.drawScene(g, view, 0, WORLD_LAST);
    this.w = view.width;
    this.h = view.height;
    this.feather();
    this.captured = true;
  }

  /**
   * Fade the buffer's edges to transparent (once, right after the capture): an elliptical vignette
   * (the old world as a pool of its own light, not a framed picture) and a thin rectangular feather
   * so no hard edge survives anywhere.
   */
  private feather(): void {
    const g = this.g!;
    const c = this.canvas!;
    const W = c.width;
    const H = c.height;
    const f = Math.max(2, Math.round(FEATHER * Math.min(W, H)));
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    if (VIGNETTE > 0) {
      g.setTransform(W / 2, 0, 0, H / 2, W / 2, H * 0.52);
      const rg = g.createRadialGradient(0, 0, 0.78, 0, 0, 1.42);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(0.45, `rgba(0,0,0,${0.35 * VIGNETTE})`);
      rg.addColorStop(1, `rgba(0,0,0,${VIGNETTE})`);
      g.fillStyle = rg;
      g.fillRect(-1.2, -1.2, 2.4, 2.4);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number): void => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(0.35, 'rgba(0,0,0,0.55)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(rx, ry, rw, rh);
    };
    edge(0, 0, f, 0, 0, 0, f, H);
    edge(W, 0, W - f, 0, W - f, 0, f, H);
    edge(0, 0, 0, f, 0, 0, W, f);
    edge(0, H, 0, H - f, 0, H - f, W, f);
    g.restore();
  }

  release(): void {
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.g = null;
    this.captured = false;
  }

  bytes(): number {
    return this.canvas ? this.canvas.width * this.canvas.height * 4 : 0;
  }

  /**
   * Draw the meadow image at (x, y, w, h) CSS px, inside its plate (px, py, pw, ph): `frame` 0..1
   * closes the plate around it (0 = no clip, the feathered image as it is; 1 = the scale's face,
   * rounded top, the rim on its lit edge); `base` is the plate's own dark tone behind the image.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    px: number,
    py: number,
    pw: number,
    ph: number,
    frame: number,
    pal: Palette,
    base: string,
    alpha: number,
  ): void {
    const c = this.canvas;
    if (!c || !this.captured || alpha <= 0.002) return;
    if (pal !== this.pal) {
      this.pal = pal;
      this.rimRamp = new AlphaRamp(pal.rim);
    }
    ctx.globalAlpha = alpha;
    if (frame <= 0.001) {
      ctx.drawImage(c, x, y, w, h);
      ctx.globalAlpha = 1;
      return;
    }
    // The plate: its lit rim, a dark seat (the feathered meadow melts into it), then the meadow.
    const r = Math.max(1.2, Math.min(4, pw * 0.035)) * frame;
    const lx = pal.light.x;
    const ly = pal.light.y;
    ctx.fillStyle = this.rimRamp!.at(0.9 * frame);
    ctx.beginPath();
    tracePlate(ctx, px, py, pw, ph, frame);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    tracePlate(ctx, px - lx * r, py - ly * r, pw, ph, frame);
    ctx.clip();
    ctx.fillStyle = base;
    ctx.globalAlpha = alpha * Math.min(1, frame * 1.5);
    ctx.fillRect(px - lx * r - 1, py - ly * r - 1, pw + 2, ph + 2);
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, x - lx * r, y - ly * r, w, h);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

/** The plate: a rect whose top corners round off (`m` 0 = square, 1 = a full rounded top). */
export function tracePlate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, m: number): void {
  const rt = m * Math.min(0.5 * w, 0.85 * h);
  const rb = m * 0.06 * w;
  ctx.moveTo(x, y + rt);
  ctx.bezierCurveTo(x, y + rt * 0.45, x + rt * 0.55, y, x + rt, y);
  ctx.lineTo(x + w - rt, y);
  ctx.bezierCurveTo(x + w - rt * 0.55, y, x + w, y + rt * 0.45, x + w, y + rt);
  ctx.lineTo(x + w, y + h - rb);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rb, y + h);
  ctx.lineTo(x + rb, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rb);
  ctx.closePath();
}
