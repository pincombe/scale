// Small animated props drawn per frame on top of their cached layers, in that layer's parallax
// coordinates: the windmill's sails and the village's lit windows (the wyrm's eye is eye.ts).
import { TAU } from '../../lib/math';

// ---------------------------------------------------------------- windmill

const SAIL_LEN = 0.37;

/** Four lattice sails turning about the hub (layer meters). Fill color + rim via shadow offset. */
export function drawSails(ctx: CanvasRenderingContext2D, hx: number, hy: number, angle: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = angle + (i * TAU) / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Perpendicular (trailing side)
    const px = -s;
    const py = c;
    // Spar
    const sw = 0.006;
    ctx.moveTo(hx + px * sw, hy + py * sw);
    ctx.lineTo(hx + c * SAIL_LEN + px * sw, hy + s * SAIL_LEN + py * sw);
    ctx.lineTo(hx + c * SAIL_LEN - px * sw, hy + s * SAIL_LEN - py * sw);
    ctx.lineTo(hx - px * sw, hy - py * sw);
    ctx.closePath();
    // Sail frame: an outer rail and three bars read as lattice at this size.
    const r0 = 0.07;
    const r1 = SAIL_LEN - 0.01;
    const w0 = 0.004;
    const w1 = 0.058;
    const rail = 0.007;
    quad(ctx, hx, hy, c, s, px, py, r0, r1, w1 - rail, w1);
    for (let k = 0; k < 5; k++) {
      const r = r0 + ((r1 - r0) * k) / 4;
      quad(ctx, hx, hy, c, s, px, py, r - 0.005, r + 0.005, w0, w1);
    }
    // Cloth on the inner half of the lattice.
    quad(ctx, hx, hy, c, s, px, py, r0, r1, w0, w0 + (w1 - w0) * 0.55);
  }
  ctx.fill();
  // Hub
  ctx.beginPath();
  ctx.arc(hx, hy, 0.018, 0, TAU);
  ctx.fill();
}

function quad(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  c: number,
  s: number,
  px: number,
  py: number,
  r0: number,
  r1: number,
  w0: number,
  w1: number,
): void {
  ctx.moveTo(hx + c * r0 + px * w0, hy + s * r0 + py * w0);
  ctx.lineTo(hx + c * r1 + px * w0, hy + s * r1 + py * w0);
  ctx.lineTo(hx + c * r1 + px * w1, hy + s * r1 + py * w1);
  ctx.lineTo(hx + c * r0 + px * w1, hy + s * r0 + py * w1);
  ctx.closePath();
}

// ---------------------------------------------------------------- windows

export function drawWindows(
  ctx: CanvasRenderingContext2D,
  xs: readonly (readonly [number, number])[],
  layer: { height(x: number): number },
  glow: HTMLCanvasElement,
  t: number,
): void {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < xs.length; i++) {
    const w = xs[i]!;
    const x = w[0];
    const y = -layer.height(x) - w[1];
    const f = 0.75 + 0.25 * Math.sin(t * (1.1 + i * 0.37) + i * 2.1) * Math.sin(t * 2.3 + i);
    ctx.globalAlpha = 0.5 * f;
    ctx.drawImage(glow, x - 0.07, y - 0.07, 0.14, 0.14);
    ctx.globalAlpha = 0.95 * f;
    ctx.fillStyle = '#ffcf6a';
    ctx.fillRect(x - 0.008, y - 0.011, 0.016, 0.022);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
