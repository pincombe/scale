// The meadow: the old tier, snapshotted at the flash (renderer.drawScene of the world layers, the
// crowd already fused away) and flown into one scale of the new tier's hide.
//
// One buffer the size of the main canvas (~20 MB at 1440x900 DPR 2), allocated at zoomBegin so
// the allocation never lands on the flash frame; after the capture, one half-size level per frame
// (the plate is a fifth of the screen at its hold: drawing the full buffer that small would shimmer)
// and a thumbnail the backdrop keeps in the meadow's scale for the rest of the tier. The buffer and
// its levels are released when the zoom is over; the thumbnail belongs to the backdrop.
import type { Renderer } from '../renderer';
import { WORLD_LAST } from '../renderer';
import type { View } from '../types';
import { context2d, makeCanvas } from '../atlas';

/** Levels below the full buffer (each half the last). */
const LEVELS = 3;
/** The thumbnail's width (px). */
const THUMB_W = 240;

export class MeadowShot {
  canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  /** Half, quarter, eighth size (built after the capture, one per step()). */
  private readonly mips: (HTMLCanvasElement | null)[] = [null, null, null];
  private built = 0;
  /** CSS size of the view it was captured from. */
  w = 1;
  h = 1;
  captured = false;

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
    this.built = 0;
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
    this.captured = true;
    this.built = 0;
  }

  /** Build the next smaller level (call once per frame after the capture). True when all are built. */
  step(): boolean {
    if (!this.captured || this.built >= LEVELS) return this.built >= LEVELS;
    const src = this.built === 0 ? this.canvas! : this.mips[this.built - 1]!;
    const w = Math.max(1, Math.round(src.width / 2));
    const h = Math.max(1, Math.round(src.height / 2));
    let c = this.mips[this.built];
    if (!c || c.width !== w || c.height !== h) {
      c = makeCanvas(w, h);
      this.mips[this.built] = c;
    }
    const x = context2d(c);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'copy';
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, w, h);
    x.globalCompositeOperation = 'source-over';
    this.built++;
    return this.built >= LEVELS;
  }

  /** The level to draw at `devW` device px wide (at most ~1.5x downscaled; the full buffer when big). */
  pick(devW: number): HTMLCanvasElement | null {
    if (!this.captured) return null;
    let best: HTMLCanvasElement = this.canvas!;
    for (let i = 0; i < this.built; i++) {
      const m = this.mips[i]!;
      if (m.width >= devW * 0.66) best = m;
      else break;
    }
    return best;
  }

  /** A small copy for the backdrop to keep (a new canvas it owns), or null before the capture. */
  thumbnail(): HTMLCanvasElement | null {
    if (!this.captured) return null;
    const src = this.pick(THUMB_W * 2)!;
    const w = THUMB_W;
    const h = Math.max(1, Math.round((THUMB_W * src.height) / src.width));
    const c = makeCanvas(w, h);
    const x = context2d(c);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, w, h);
    return c;
  }

  release(): void {
    for (let i = 0; i < this.mips.length; i++) {
      const m = this.mips[i];
      if (m) m.width = m.height = 0;
      this.mips[i] = null;
    }
    this.built = 0;
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.g = null;
    this.captured = false;
  }

  bytes(): number {
    let b = this.canvas ? this.canvas.width * this.canvas.height * 4 : 0;
    for (const m of this.mips) if (m) b += m.width * m.height * 4;
    return b;
  }
}
