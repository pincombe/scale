// The Mountain's foreground frame (backdrop.front): the nearest scales of the wyrm's back, huge
// and dark, rising from below the bottom edge, with now and then a dorsal spike; rim-lit by the
// afterglow and capped with snow. Tall at the screen edges, low around the fight (as the Meadow's
// grass frame), so the stage stays clear.
//
// Pieces are baked sprites (two resolutions, rim and snow included); a frame is ~20 drawImage
// calls. Its own transform, as the Meadow's grass: it pans faster than the stage (depth ~1.3)
// and only gently shrinks as the camera pulls back, so it keeps framing the bottom edge.
import type { View } from '../types';
import type { Palette } from '../palette';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { Rng } from '../../lib/rng';
import { hash2f, smoothstep, TAU } from '../../lib/math';

const PAN = 1.3;
const SHRINK = 0.3;
/** Piece spacing in foreground units (a unit = 1/9 of the view height at the base framing). */
const CELL = 0.62;
const VARIANTS = 8;
/** Sprite extent in piece units: x in [-HALF_W, HALF_W], y in [-TALL, 0]. */
const HALF_W = 0.75;
const TALL = 2.4;
const LOD_HI = 560;
const LOD_LO = 150;
const CLEAR_FADE = 160;

interface Piece {
  hi: HTMLCanvasElement;
  lo: HTMLCanvasElement;
}

/** One plate (rounded top, flaring down past the bottom), into the current path. */
function plate(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number, lean: number): void {
  ctx.moveTo(cx - w, 0.05);
  ctx.bezierCurveTo(cx - w * 1.02, top * 0.45, cx - w * 0.55 + lean, top, cx + lean * 0.5, top);
  ctx.bezierCurveTo(cx + w * 0.55 + lean, top, cx + w * 1.02, top * 0.45, cx + w, 0.05);
  ctx.closePath();
}

/** A dorsal spike: tall, leaning back (left), slightly curved. */
function spike(ctx: CanvasRenderingContext2D, cx: number, h: number, w: number): void {
  ctx.moveTo(cx - w, 0.05);
  ctx.quadraticCurveTo(cx - w * 0.6, -h * 0.55, cx - w * 0.9, -h);
  ctx.quadraticCurveTo(cx + w * 0.2, -h * 0.5, cx + w, 0.05);
  ctx.closePath();
}

/** The shapes of variant v (piece units, bottom at y = 0), as a list of top-arc plates. */
function shapes(ctx: CanvasRenderingContext2D, v: number): void {
  const rng = new Rng(0x5ca1 + v * 31);
  const kind = v % 4;
  if (kind === 3) {
    // A dorsal spike of the back we stand on, leaning toward the tail, plates at its root.
    spike(ctx, rng.range(-0.1, 0.1), rng.range(1.2, 1.6), rng.range(0.3, 0.38));
    plate(ctx, rng.range(0.2, 0.35), -rng.range(0.4, 0.55), rng.range(0.3, 0.38), rng.range(-0.05, 0.05));
    plate(ctx, -rng.range(0.3, 0.4), -rng.range(0.3, 0.42), rng.range(0.25, 0.32), rng.range(-0.05, 0.05));
    return;
  }
  // Two or three overlapping plates (kept inside the sprite's +-HALF_W).
  const n = kind === 1 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const cx = (i - (n - 1) / 2) * (n === 3 ? rng.range(0.28, 0.34) : rng.range(0.38, 0.5)) + rng.range(-0.05, 0.05);
    const h = rng.range(0.45, 0.95) * (i === 0 ? 1 : 0.8);
    plate(ctx, cx, -h, n === 3 ? rng.range(0.24, 0.3) : rng.range(0.28, 0.4) - 0.1 * Math.abs(cx), rng.range(-0.08, 0.08));
  }
}

function bakePiece(pal: Palette, v: number, heightPx: number): HTMLCanvasElement {
  const k = heightPx / TALL;
  const c = makeCanvas(HALF_W * 2 * k, TALL * k);
  const ctx = context2d(c);
  const rimPx = Math.max(1.6, heightPx / 110);
  const snowTop = mixHex(mixHex('#d4d8f6', pal.rim, 0.3), pal.silhouette, 0.05);
  const snowLow = mixHex('#59608e', pal.silhouette, 0.35);
  const body = mixHex(pal.silhouette, pal.depthTint ?? pal.silhouette, 0.1);
  const at = (dx: number, dy: number): void => ctx.setTransform(k, 0, 0, k, HALF_W * k + dx, TALL * k + dy);
  // Rim underlay toward the light, then the dark silhouette.
  at(pal.light.x * rimPx, pal.light.y * rimPx);
  ctx.beginPath();
  shapes(ctx, v);
  ctx.fillStyle = rgba(mixHex(pal.rim, '#ffffff', 0.15), 0.95);
  ctx.fill();
  at(0, 0);
  ctx.beginPath();
  shapes(ctx, v);
  ctx.fillStyle = body;
  ctx.fill();
  // Snow caps: the shapes again, light, minus the shapes shifted down (source-atop band).
  ctx.globalCompositeOperation = 'source-atop';
  const sg = ctx.createLinearGradient(-HALF_W, 0, HALF_W, 0);
  sg.addColorStop(0, snowLow);
  sg.addColorStop(1, snowTop);
  ctx.fillStyle = sg;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  at(0, (0.05 + 0.03 * (v % 3)) * k);
  ctx.beginPath();
  shapes(ctx, v);
  ctx.fillStyle = body;
  ctx.fill();
  // The plates' own edges: a faint lighter line where each overlaps the next, and speckled frost.
  at(0, 0);
  const rng = new Rng(0x71c3 + v);
  ctx.fillStyle = rgba(snowTop, 0.22);
  for (let i = 0; i < 40; i++) {
    const x = rng.range(-HALF_W, HALF_W);
    const y = -rng.range(0.02, 0.9) * rng.float();
    ctx.beginPath();
    ctx.arc(x, y, rng.range(0.004, 0.012), 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

export class MountainForeground {
  private pieces: Piece[] = [];
  private palette: Palette | null = null;

  ready(pal: Palette): boolean {
    return this.palette === pal && this.pieces.length > 0;
  }

  ensure(pal: Palette): void {
    if (this.palette === pal && this.pieces.length) return;
    this.free();
    this.palette = pal;
    for (let v = 0; v < VARIANTS; v++) this.pieces.push({ hi: bakePiece(pal, v, LOD_HI), lo: bakePiece(pal, v, LOD_LO) });
  }

  free(): void {
    for (const p of this.pieces) {
      p.hi.width = p.hi.height = 0;
      p.lo.width = p.lo.height = 0;
    }
    this.pieces = [];
    this.palette = null;
  }

  bytes(): number {
    let b = 0;
    for (const p of this.pieces) b += (p.hi.width * p.hi.height + p.lo.width * p.lo.height) * 4;
    return b;
  }

  /**
   * `clear0..clear1` (screen px) is the stage clearing (hero to the dragon's far edge): inside it
   * pieces stay below `groundY + toes`, fading back to full height over CLEAR_FADE px.
   */
  draw(ctx: CanvasRenderingContext2D, view: View, clear0: number, clear1: number, groundY: number, toes: number): void {
    if (!this.pieces.length || this.palette !== view.palette) return;
    const cam = view.camera;
    const W = view.width;
    const H = view.height;
    const d = view.dpr;
    const s = (H / 9) * Math.pow(cam.zoomEff / cam.refZoom, SHRINK);
    const ox = cam.stageCX + cam.shakeX * PAN - PAN * (cam.x - cam.refX) * cam.zoomEff;
    const oy = H + 14 + cam.shakeY * PAN;
    const step = s * CELL;
    const i0 = Math.floor((-160 - ox) / step) - 1;
    const i1 = Math.ceil((W + 160 - ox) / step) + 1;
    // Edges of the stage (the panel covers the rest).
    const half = cam.stageW * 0.5;
    const mid = cam.stageCX;
    for (let i = i0; i <= i1; i++) {
      const rx = hash2f(i, 11);
      const cx = ox + (i + rx) * step;
      // Tall at the stage's edges, low (mostly gone) in the middle.
      const u = Math.abs(cx - mid) / half;
      const edge = Math.pow(smoothstep(0.3, 1.05, u), 1.2);
      let sc = (0.75 + 0.9 * Math.pow(hash2f(i, 12), 1.4)) * edge * s;
      const inside = Math.min(smoothstep(clear0 - CLEAR_FADE, clear0, cx), 1 - smoothstep(clear1, clear1 + CLEAR_FADE, cx));
      if (inside > 0) {
        const cap = Math.max(0, (oy - groundY - toes) / (TALL * 1.05));
        if (sc > cap) sc += (cap - sc) * inside;
      }
      if (sc < 10) continue;
      const piece = this.pieces[(hash2f(i, 13) * VARIANTS) | 0]!;
      const img = sc * TALL * d > LOD_LO * 1.1 ? piece.hi : piece.lo;
      const k = sc * d;
      ctx.setTransform(k, 0, 0, k, cx * d, oy * d);
      ctx.drawImage(img, -HALF_W, -TALL, HALF_W * 2, TALL);
    }
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
}
