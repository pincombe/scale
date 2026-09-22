// Foreground framing (backdrop.front): tall grass, wildflowers and backlit dandelion clocks rooted
// just below the bottom edge, swaying in the shared wind. Tall at the screen edges, low in the
// middle so the hero and the dragon's feet stay clear.
//
// Clumps are pre-baked sprites (vector-drawn at two resolutions, rim light included) and sway by
// shearing about their roots, so a frame is ~100 drawImage calls instead of ~1,000 curves.
// Its own transform: it pans faster than the stage (depth ~1.3) but only gently shrinks as the
// camera pulls back, so it keeps framing the bottom edge at every zoom.
import type { View } from '../types';
import type { Palette } from '../palette';
import { makeCanvas, context2d } from '../atlas';
import { rgba } from '../../lib/color';
import { Rng } from '../../lib/rng';
import { hash2f, smoothstep, TAU } from '../../lib/math';
import { wind } from './wind';

/** Screen-pan factor relative to the stage (> 1 = in front). */
const PAN = 1.3;
/** How strongly the foreground shrinks with the camera (0 = fixed size, 1 = like the stage). */
const SHRINK = 0.3;
/** Clump spacing in foreground units (m at the base framing). */
const CELL = 0.24;
const VARIANTS = 16;
/** Sprite extent in clump units (a clump is ~1 unit tall): x in [-HALF_W, HALF_W], y in [-TALL, 0]. */
const HALF_W = 0.5;
const TALL = 1.32;
/** Bake heights (device px for TALL units) of the two levels of detail. */
const LOD_HI = 520;
const LOD_LO = 130;

interface Clump {
  hi: HTMLCanvasElement;
  lo: HTMLCanvasElement;
  /** Dandelion clock center and radius in clump units (r = 0: none). */
  px: number;
  py: number;
  pr: number;
}

function blade(ctx: CanvasRenderingContext2D, x: number, h: number, w: number, lean: number): void {
  const tipX = x + lean * h;
  const tipY = -h * (1 - 0.18 * lean * lean);
  const midX = x + lean * h * 0.2;
  const midY = -h * 0.55;
  ctx.moveTo(x - w * 0.5, 0.02);
  ctx.quadraticCurveTo(midX - w * 0.32, midY, tipX, tipY);
  ctx.quadraticCurveTo(midX + w * 0.32, midY, x + w * 0.5, 0.02);
  ctx.closePath();
}

/** One clump's shapes (blades + optional flower) into ctx's current path; returns the puff. */
function clumpShape(ctx: CanvasRenderingContext2D, v: number, out: Clump): void {
  const rng = new Rng(0xc1a0 + v * 101);
  const n = 3 + rng.int(5);
  for (let j = 0; j < n; j++) {
    const dx = rng.range(-0.08, 0.08);
    const h = rng.range(0.5, 1);
    blade(ctx, dx, h, rng.range(0.03, 0.055), rng.range(-0.28, 0.32) + dx * 1.8);
  }
  out.pr = 0;
  const kind = v % 4;
  if (kind === 0) return;
  const lean = rng.range(-0.12, 0.2);
  const h = rng.range(1.02, 1.2);
  const sx = rng.range(-0.04, 0.05);
  blade(ctx, sx, h, 0.014, lean);
  const tx = sx + lean * h;
  const ty = -h * (1 - 0.18 * lean * lean);
  if (kind === 1) {
    // Dandelion clock: a small seed core; the fluff is stroked after the fill.
    const r = rng.range(0.07, 0.09);
    ctx.moveTo(tx + r * 0.28, ty);
    ctx.arc(tx, ty, r * 0.28, 0, TAU);
    out.px = tx;
    out.py = ty;
    out.pr = r;
  } else if (kind === 2) {
    // Poppy / daisy head.
    ctx.moveTo(tx + 0.045, ty);
    ctx.ellipse(tx, ty, 0.045, 0.028, lean * 0.6, 0, TAU);
  } else {
    // Oat-like seed head: grains along a drooping tip.
    for (let k = 0; k < 6; k++) {
      const gx = tx + k * 0.011 + lean * 0.02;
      const gy = ty + k * 0.024;
      ctx.moveTo(gx + 0.009, gy);
      ctx.ellipse(gx, gy, 0.009, 0.022, 0.5 + lean, 0, TAU);
    }
  }
}

function bakeClump(pal: Palette, v: number, heightPx: number, out: Clump): HTMLCanvasElement {
  const k = heightPx / TALL;
  const c = makeCanvas(HALF_W * 2 * k, TALL * k);
  const ctx = context2d(c);
  const rimPx = Math.max(1.2, heightPx / 160);
  // Rim underlay (offset toward the light), then the silhouette on top.
  for (let pass = 0; pass < 2; pass++) {
    ctx.setTransform(k, 0, 0, k, HALF_W * k + (pass === 0 ? pal.light.x * rimPx : 0), TALL * k + (pass === 0 ? pal.light.y * rimPx : 0));
    ctx.beginPath();
    clumpShape(ctx, v, out);
    ctx.fillStyle = pass === 0 ? rgba(pal.rim, 0.8) : pal.silhouette;
    ctx.fill();
  }
  if (out.pr > 0) {
    // Backlit fluff: a ring of fine filaments.
    ctx.setTransform(k, 0, 0, k, HALF_W * k, TALL * k);
    ctx.strokeStyle = rgba(pal.rim, 0.7);
    ctx.lineWidth = Math.max(0.6, heightPx / 500) / k;
    ctx.beginPath();
    const rays = 22;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU + v;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      ctx.moveTo(out.px + cs * out.pr * 0.3, out.py + sn * out.pr * 0.3);
      ctx.lineTo(out.px + cs * out.pr, out.py + sn * out.pr);
    }
    ctx.stroke();
  }
  return c;
}

export class Foreground {
  private clumps: Clump[] = [];
  private palette: Palette | null = null;

  private bake(pal: Palette): void {
    this.palette = pal;
    this.clumps = [];
    for (let v = 0; v < VARIANTS; v++) {
      const c: Clump = { hi: null as unknown as HTMLCanvasElement, lo: null as unknown as HTMLCanvasElement, px: 0, py: 0, pr: 0 };
      c.hi = bakeClump(pal, v, LOD_HI, c);
      c.lo = bakeClump(pal, v, LOD_LO, c);
      this.clumps.push(c);
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: View, glow: HTMLCanvasElement): void {
    const pal = view.palette;
    if (this.palette !== pal) this.bake(pal);
    const cam = view.camera;
    const W = view.width;
    const H = view.height;
    const d = view.dpr;
    const s = cam.refZoom * Math.pow(cam.zoomEff / cam.refZoom, SHRINK);
    const ox = cam.stageCX + cam.shakeX * PAN - PAN * (cam.x - cam.refX) * cam.zoomEff;
    const oy = H + 10 + cam.shakeY * PAN;
    const t = view.time;
    const margin = 120;
    const step = s * CELL;
    const i0 = Math.floor((-margin - ox) / step) - 1;
    const i1 = Math.ceil((W + margin - ox) / step) + 1;
    const half = W * 0.5;
    let puffs = 0;
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) {
        if (puffs === 0) break;
        ctx.setTransform(d, 0, 0, d, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.32;
      }
      for (let i = i0; i <= i1; i++) {
        const rx = hash2f(i, 1);
        const cx = ox + (i + rx) * step;
        // Edge weighting: tall at the screen edges, short in the middle.
        const u = Math.abs(cx - half) / half;
        const edge = 0.18 + 0.82 * Math.pow(smoothstep(0.18, 1.05, u), 1.3);
        const sc = (0.8 + 1.7 * Math.pow(hash2f(i, 2), 1.3)) * edge * s;
        if (sc < 7) continue;
        const clump = this.clumps[(hash2f(i, 3) * VARIANTS) | 0]!;
        const w0 = wind((i + rx) * CELL * 0.7, t);
        const lean = (hash2f(i, 4) - 0.5) * 0.2 + w0 * 0.26 + 0.05 * Math.sin(t * (1.9 + rx) + i * 1.3);
        if (pass === 0) {
          const k = sc * d;
          const img = sc * TALL * d > LOD_LO * 1.1 ? clump.hi : clump.lo;
          ctx.setTransform(k, 0, -k * lean, k, cx * d, oy * d);
          ctx.drawImage(img, -HALF_W, -TALL, HALF_W * 2, TALL);
          if (clump.pr > 0) puffs++;
        } else if (clump.pr > 0) {
          const px = cx + sc * (clump.px - lean * clump.py);
          const py = oy + sc * clump.py;
          const r = sc * clump.pr * 2.2;
          ctx.drawImage(glow, px - r, py - r, r * 2, r * 2);
        }
      }
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
