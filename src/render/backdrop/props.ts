// Small animated props drawn per frame on top of their cached layers, in that layer's parallax
// coordinates: the windmill's sails, the village's lit windows, and the eye in the wyrm hill.
import type { EyePose } from './eyeTimeline';
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

// ---------------------------------------------------------------- the eye

/** Half-width and max half-height of the eye opening (m on the far-hills layer). */
const EYE_HW = 0.27;
const EYE_HH = 0.1;
const EYE_TILT = -0.12;

function almond(ctx: CanvasRenderingContext2D, hw: number, hh: number): void {
  // Reptile eye: the upper lid arcs higher than the lower, corners slightly hooded.
  ctx.moveTo(-hw, hh * 0.1);
  ctx.bezierCurveTo(-hw * 0.55, -hh * 1.25, hw * 0.45, -hh * 1.35, hw, -hh * 0.05);
  ctx.bezierCurveTo(hw * 0.5, hh * 1.05, -hw * 0.5, hh * 1.1, -hw, hh * 0.1);
  ctx.closePath();
}

export interface EyeArt {
  /** Amber glow sprite. */
  glow: HTMLCanvasElement;
  /** Iris gradient centered at the origin (created once). */
  iris: CanvasGradient;
}

export function makeIris(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, EYE_HW * 1.05);
  g.addColorStop(0, '#fff6b8');
  g.addColorStop(0.22, '#ffd04a');
  g.addColorStop(0.5, '#ff9420');
  g.addColorStop(0.8, '#d2480f');
  g.addColorStop(1, '#6a1606');
  return g;
}

/**
 * Draw the eye at (x, y) in far-hills layer meters. `lx, ly` is the unit direction toward the
 * fight (layer space); `lid` is the hill's crest color, `t` the time (for the glow flicker).
 */
export function drawEye(
  ctx: CanvasRenderingContext2D,
  pose: EyePose,
  x: number,
  y: number,
  lx: number,
  ly: number,
  art: EyeArt,
  lid: string,
  t: number,
): void {
  const o = pose.open;
  if (o < 0.003) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(EYE_TILT);
  const flick = 0.9 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
  // Glow bleeding into the hill and the haze around it.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5 * pose.glow * flick;
  ctx.drawImage(art.glow, -1.1, -1.1, 2.2, 2.2);
  ctx.globalAlpha = 0.6 * pose.glow * flick;
  ctx.drawImage(art.glow, -0.42, -0.36, 0.84, 0.72);
  ctx.globalCompositeOperation = 'source-over';
  // Lid folds: a dark crease that deepens as the lids part.
  ctx.globalAlpha = Math.min(1, o * 5) * 0.75;
  ctx.fillStyle = lid;
  ctx.beginPath();
  almond(ctx, EYE_HW * 1.14, EYE_HH * (0.25 + 1.2 * o));
  ctx.fill();
  ctx.globalAlpha = 1;
  // The eye itself.
  const hh = EYE_HH * o;
  const px = lx * pose.look * EYE_HW * 0.42;
  const py = ly * pose.look * EYE_HH * 0.35;
  ctx.beginPath();
  almond(ctx, EYE_HW, hh);
  ctx.save();
  ctx.clip();
  ctx.translate(px, py);
  ctx.fillStyle = art.iris;
  ctx.fillRect(-EYE_HW * 1.6, -EYE_HH * 1.6, EYE_HW * 3.2, EYE_HH * 3.2);
  // Slit pupil
  ctx.fillStyle = '#160604';
  ctx.beginPath();
  ctx.ellipse(0, 0, EYE_HW * pose.pupil * 0.34, EYE_HH * 1.3, 0, 0, TAU);
  ctx.fill();
  // Wet highlight
  ctx.fillStyle = 'rgba(255,250,225,0.8)';
  ctx.beginPath();
  ctx.ellipse(-EYE_HW * 0.3 - px * 0.5, -hh * 0.35, EYE_HW * 0.07, EYE_HH * 0.16, -0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
  // Lid edge line
  ctx.strokeStyle = lid;
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  almond(ctx, EYE_HW, hh);
  ctx.stroke();
  ctx.restore();
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
