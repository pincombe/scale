// STAND-IN until the Mountain backdrop poses its world wyrm (BackdropApi.wyrmPose, WP 2.3): a head
// rising over the ridge at the right of the frame, its eye opening, its jaw dropping on the roar.
// Screen space, rim-lit like every silhouette, clipped to above the ground line. Only drawn when
// scene.backdrop.wyrmPose is missing; its timing is the reveal's, so the beats can be judged.
import type { Palette } from '../palette';
import type { WyrmPose } from '../backdrop/api';
import { mixHex } from '../../lib/color';

/** Head-local outline (x: snout at -3, back of the skull at +0.4; y down), and the jaw. */
const SKULL = [0.1, 0.3, 0.42, -0.08, 0.46, -0.44, 0.24, -0.74, -0.24, -0.88, -0.72, -0.86, -1.1, -0.9, -1.4, -0.78, -1.9, -0.6, -2.45, -0.5, -2.85, -0.4, -3.06, -0.22, -3.1, 0.02, -2.95, 0.13, -2.4, 0.12, -1.6, 0.11, -0.9, 0.1, -0.35, 0.22];
const JAW = [-0.42, 0.1, -1.3, 0.14, -2.3, 0.16, -2.85, 0.2, -2.9, 0.33, -2.6, 0.44, -1.8, 0.47, -0.9, 0.52, -0.2, 0.56, 0.1, 0.42];
const HINGE_X = -0.45;
const HINGE_Y = 0.12;
const HORNS = [
  [-0.35, -0.82, 0.35, -1.35, 1.05, -1.8, 0.16],
  [0.05, -0.6, 0.6, -0.74, 1.25, -0.96, 0.11],
] as const;

export class StandinHead {
  private pal: Palette | null = null;
  private mid = '#444';
  private eyeCore = '#fff';

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, groundY: number, pose: WyrmPose, p: Palette, t: number, alpha: number): void {
    if (alpha <= 0.002 || pose.rise <= 0.002) return;
    if (p !== this.pal) {
      this.pal = p;
      this.mid = mixHex(p.rim, p.silhouette, 0.6);
      this.eyeCore = mixHex(p.accent.fire, '#fff6c0', 0.55);
    }
    const S = H * 0.2;
    const rise = pose.rise;
    const px = W * 0.9;
    const py = groundY + H * 0.08 + (1 - rise) * S * 1.9;
    const tilt = -0.08 - 0.22 * pose.jaw + 0.03 * Math.sin(t * 1.3);
    const cs = Math.cos(tilt) * S;
    const sn = Math.sin(tilt) * S;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(-10, -10, W + 20, groundY + 10);
    ctx.clip();
    const lx = p.light.x;
    const ly = p.light.y;
    for (let pass = 0; pass < 3; pass++) {
      const off = pass === 0 ? 0 : pass === 1 ? 1.6 : 3.4;
      ctx.setTransform(cs, sn, -sn, cs, px - lx * off, py - ly * off);
      ctx.fillStyle = pass === 0 ? p.rim : pass === 1 ? this.mid : p.silhouette;
      ctx.beginPath();
      poly(ctx, SKULL, 0, 0, 0);
      poly(ctx, JAW, HINGE_X, HINGE_Y, 0.6 * pose.jaw);
      for (let hi = 0; hi < HORNS.length; hi++) {
        const h = HORNS[hi]!;
        ctx.moveTo(h[0], h[1] - h[6]);
        ctx.quadraticCurveTo(h[2], h[3], h[4], h[5]);
        ctx.quadraticCurveTo(h[2], h[3] + h[6] * 1.2, h[0], h[1] + h[6]);
        ctx.closePath();
      }
      // The neck, down behind the ridge.
      ctx.moveTo(0.3, -0.6);
      ctx.quadraticCurveTo(1.4, -0.2, 1.6, 2.4);
      ctx.lineTo(-0.3, 2.4);
      ctx.quadraticCurveTo(-0.2, 0.8, -0.6, 0.35);
      ctx.closePath();
      ctx.fill();
    }
    // The eye: an ember slit that widens, glowing through the dusk.
    const e = pose.eye;
    if (e > 0.01) {
      ctx.setTransform(cs, sn, -sn, cs, px, py);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.accent.fire;
      ctx.globalAlpha = alpha * 0.35 * e;
      ctx.beginPath();
      ctx.ellipse(-1.05, -0.5, 0.32, 0.22, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.eyeCore;
      ctx.beginPath();
      ctx.ellipse(-1.05, -0.5, 0.17, 0.02 + 0.07 * e, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.silhouette;
      ctx.beginPath();
      ctx.ellipse(-1.09, -0.5, 0.025, 0.012 + 0.055 * e, -0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function poly(ctx: CanvasRenderingContext2D, pts: readonly number[], hx: number, hy: number, rot: number): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const n = pts.length / 2;
  for (let i = 0; i <= n; i++) {
    const k = (i % n) * 2;
    const x0 = pts[k]! - hx;
    const y0 = pts[k + 1]! - hy;
    const x = hx + x0 * c - y0 * s;
    const y = hy + x0 * s + y0 * c;
    // Smooth through the midpoints.
    const k2 = ((i + 1) % n) * 2;
    const x1 = pts[k2]! - hx;
    const y1 = pts[k2 + 1]! - hy;
    const mx = hx + ((x0 + x1) * 0.5) * c - ((y0 + y1) * 0.5) * s;
    const my = hy + ((x0 + x1) * 0.5) * s + ((y0 + y1) * 0.5) * c;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.quadraticCurveTo(x, y, mx, my);
  }
  ctx.closePath();
}
