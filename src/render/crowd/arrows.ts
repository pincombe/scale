// Arrows: a fixed pool of analytic ballistic arcs. Each arrow is scheduled at the volley with a
// launch time (the archer's loose) and a flight time chosen so it lands on its target at exactly
// volley time + flight, when the core applies the damage. Position is a closed-form function of
// time, so hit-stop, slow-mo and frame rate never shift the landing.
import { context2d, makeCanvas } from '../atlas';
import type { View } from '../types';
import type { Palette } from '../palette';

const CAP = 256;
/** Seconds an arrow stays stuck in its target after landing, fading. */
const STICK = 0.32;
/** Fade time (s) for arrows whose target died. */
const FADE = 0.25;
/** Arrow length in meters, and minimum on-screen length in CSS px. */
const ARROW_M = 0.82;
const ARROW_MIN_PX = 11;

export class Arrows {
  private readonly x0 = new Float32Array(CAP);
  private readonly y0 = new Float32Array(CAP);
  private readonly vx = new Float32Array(CAP);
  private readonly vy = new Float32Array(CAP);
  private readonly g = new Float32Array(CAP);
  private readonly t0 = new Float64Array(CAP);
  private readonly T = new Float32Array(CAP);
  private readonly live = new Uint8Array(CAP);
  /** Live-target anchor at fire time (the dragon's head): arrows follow it as the dragon moves. */
  private readonly ax = new Float32Array(CAP);
  private readonly ay = new Float32Array(CAP);
  /** Time the arrow started fading (target gone), or Infinity. */
  private readonly dieAt = new Float64Array(CAP).fill(Infinity);
  private head = 0;
  count = 0;
  private sprite: HTMLCanvasElement | null = null;
  private trail: HTMLCanvasElement | null = null;
  private pal: Palette | null = null;

  /**
   * Schedule an arrow: leaves (x, y) at time `launch`, lands on (tx, ty) at `launch + T`.
   * The arc peaks roughly `lift` m above the higher end.
   */
  fire(x: number, y: number, tx: number, ty: number, launch: number, T: number, lift: number, anchorX: number, anchorY: number): void {
    let i = this.head;
    for (let k = 0; k < CAP; k++) {
      const j = (this.head + k) % CAP;
      if (!this.live[j]) {
        i = j;
        break;
      }
    }
    this.head = (i + 1) % CAP;
    if (!this.live[i]) this.count++;
    const t = Math.max(0.15, T);
    const g = (8 * Math.max(0.3, lift)) / (t * t);
    this.x0[i] = x;
    this.y0[i] = y;
    this.vx[i] = (tx - x) / t;
    this.vy[i] = (ty - y) / t - 0.5 * g * t;
    this.g[i] = g;
    this.t0[i] = launch;
    this.T[i] = t;
    this.live[i] = 1;
    this.ax[i] = anchorX;
    this.ay[i] = anchorY;
    this.dieAt[i] = Infinity;
  }

  /** The target is gone (dragon died / despawned): arrows in the air fade, unlaunched ones vanish. */
  fadeAll(now: number): void {
    for (let i = 0; i < CAP; i++) {
      if (!this.live[i]) continue;
      if (now < this.t0[i]!) {
        this.live[i] = 0;
        this.count--;
      } else if (this.dieAt[i] === Infinity) this.dieAt[i] = now;
    }
  }

  clear(): void {
    this.live.fill(0);
    this.count = 0;
  }

  update(now: number): void {
    if (this.count === 0) return;
    for (let i = 0; i < CAP; i++) {
      if (this.live[i] && (now > this.t0[i]! + this.T[i]! + STICK || now > this.dieAt[i]! + FADE)) {
        this.live[i] = 0;
        this.count--;
      }
    }
  }

  private bake(p: Palette): void {
    if (p === this.pal) return;
    this.pal = p;
    // Shaft, head and fletching pointing along +x; a lit top edge.
    const w = 96;
    const h = 14;
    const c = makeCanvas(w, h);
    const x = context2d(c);
    const y = h / 2;
    const shape = (col: string, dy: number): void => {
      x.fillStyle = col;
      x.fillRect(10, y - 1.3 + dy, w - 26, 2.6);
      x.beginPath();
      x.moveTo(w - 1, y + dy);
      x.lineTo(w - 18, y - 5 + dy);
      x.lineTo(w - 14, y + dy);
      x.lineTo(w - 18, y + 5 + dy);
      x.closePath();
      x.fill();
      x.beginPath();
      x.moveTo(0, y - 5.5 + dy);
      x.lineTo(14, y - 1 + dy);
      x.lineTo(20, y - 1 + dy);
      x.lineTo(8, y - 6 + dy);
      x.closePath();
      x.moveTo(0, y + 5.5 + dy);
      x.lineTo(14, y + 1 + dy);
      x.lineTo(20, y + 1 + dy);
      x.lineTo(8, y + 6 + dy);
      x.closePath();
      x.fill();
    };
    shape(p.rim, -0.9);
    shape(p.silhouette, 0.5);
    this.sprite = c;
    // Faint warm streak behind the arrow.
    const tw = 128;
    const th = 8;
    const t = makeCanvas(tw, th);
    const tx = context2d(t);
    const gr = tx.createLinearGradient(0, 0, tw, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,0.9)');
    tx.fillStyle = gr;
    tx.beginPath();
    tx.moveTo(0, th / 2);
    tx.lineTo(tw, th / 2 - 1.6);
    tx.lineTo(tw, th / 2 + 1.6);
    tx.closePath();
    tx.fill();
    tx.globalCompositeOperation = 'source-atop';
    tx.fillStyle = p.accent.glow;
    tx.fillRect(0, 0, tw, th);
    this.trail = t;
  }

  /**
   * Draw live arrows (the caller resets the transform afterwards). (hx, hy) is the live anchor:
   * each arrow's arc bends smoothly toward where its target has moved since it was loosed.
   */
  draw(ctx: CanvasRenderingContext2D, v: View, now: number, hx: number, hy: number): void {
    if (this.count === 0) return;
    this.bake(v.palette);
    const spr = this.sprite!;
    const trail = this.trail!;
    const cam = v.camera;
    const dpr = v.dpr;
    const A = cam.a * dpr;
    const B = cam.b * dpr;
    const C = cam.c * dpr;
    const D = cam.d * dpr;
    const E = cam.e * dpr;
    const F = cam.f * dpr;
    const lenPx = Math.max(ARROW_M * cam.zoomEff, ARROW_MIN_PX) * dpr;
    const k = lenPx / spr.width;
    // Pass 1: additive trails. Pass 2: the arrows themselves.
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass === 0 ? 'lighter' : 'source-over';
      for (let i = 0; i < CAP; i++) {
        if (!this.live[i]) continue;
        let tau = now - this.t0[i]!;
        if (tau < 0) continue;
        const T = this.T[i]!;
        let alpha = 1;
        if (tau > T) {
          if (pass === 0) continue;
          alpha = 1 - (tau - T) / STICK;
          tau = T;
        }
        const dAt = this.dieAt[i]!;
        if (now > dAt) {
          alpha *= 1 - (now - dAt) / FADE;
          if (alpha <= 0.01) continue;
        }
        const g = this.g[i]!;
        // Retarget: blend in the anchor's motion with a smoothstep over the flight (velocity
        // stays tangent: the added term's slope is 0 at launch and at landing).
        const u = tau / T;
        const bl = u * u * (3 - 2 * u);
        const dbl = (6 * u * (1 - u)) / T;
        const offX = hx - this.ax[i]!;
        const offY = hy - this.ay[i]!;
        const vx = this.vx[i]! + offX * dbl;
        const vy = this.vy[i]! + g * tau + offY * dbl;
        const wx = this.x0[i]! + this.vx[i]! * tau + offX * bl;
        const wy = this.y0[i]! + this.vy[i]! * tau + 0.5 * g * tau * tau + offY * bl;
        const sx = A * wx + C * wy + E;
        const sy = B * wx + D * wy + F;
        // Screen-space direction of travel.
        let dx = A * vx + C * vy;
        let dy = B * vx + D * vy;
        const dl = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= dl;
        dy /= dl;
        if (pass === 0) {
          const tk = (lenPx * 2.2) / trail.width;
          ctx.globalAlpha = 0.32 * Math.min(1, tau * 6);
          ctx.setTransform(dx * tk, dy * tk, -dy * tk, dx * tk, sx, sy);
          ctx.drawImage(trail, -trail.width, -trail.height / 2);
        } else {
          ctx.globalAlpha = alpha;
          ctx.setTransform(dx * k, dy * k, -dy * k, dx * k, sx, sy);
          // Stuck arrows sink a little into the hide.
          ctx.drawImage(spr, tau >= T ? -spr.width * 0.78 : -spr.width, -spr.height / 2);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
