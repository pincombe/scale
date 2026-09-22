// Ambient life in screen space: fireflies (glow, blink, drift), pollen and seeds catching the
// light, and the occasional flock of birds across the far sky. Tiny fixed pools, no allocations
// per frame. Positions are CSS px; each mote has a depth that sets its size and how much it pans
// with the stage, so the meadow keeps its depth as the camera moves.
import type { View } from '../types';
import { Noise } from '../../lib/noise';
import { clamp01, smoothstep, TAU } from '../../lib/math';
import { wind } from './wind';

const FLIES = 34;
const MOTES = 56;
const BIRDS = 11;
const MARGIN = 40;

const N = new Noise(0xf1ef);

export class Ambient {
  // Fireflies
  private readonly fx = new Float32Array(FLIES);
  private readonly fy = new Float32Array(FLIES);
  private readonly fd = new Float32Array(FLIES);
  private readonly fSeed = new Float32Array(FLIES);
  private readonly fBright = new Float32Array(FLIES);
  // Motes (pollen, dandelion seeds)
  private readonly mx = new Float32Array(MOTES);
  private readonly my = new Float32Array(MOTES);
  private readonly md = new Float32Array(MOTES);
  private readonly mSeed = new Float32Array(MOTES);
  private readonly mBright = new Float32Array(MOTES);
  // Birds
  private readonly bdx = new Float32Array(BIRDS);
  private readonly bdy = new Float32Array(BIRDS);
  private readonly bPhase = new Float32Array(BIRDS);
  private birdCount = 0;
  private birdX = 0;
  private birdY = 0;
  private birdVX = 0;
  private birdSize = 6;
  private birdT = 0;
  private nextBirds = 9;

  private lastPan = NaN;
  private w = 0;
  private h = 0;

  private seed(W: number, H: number, ay: number): void {
    this.w = W;
    this.h = H;
    for (let i = 0; i < FLIES; i++) {
      this.fSeed[i] = i * 13.37 + 1;
      this.fd[i] = 0.55 + 0.95 * Math.random();
      this.fx[i] = Math.random() * W;
      this.fy[i] = ay - H * (0.02 + 0.3 * Math.random() * Math.random()) + H * 0.12 * Math.random();
    }
    for (let i = 0; i < MOTES; i++) {
      this.mSeed[i] = i * 7.77 + 3;
      this.md[i] = 0.4 + 1.8 * Math.random() * Math.random();
      this.mx[i] = Math.random() * W;
      this.my[i] = H * (0.25 + 0.7 * Math.random());
    }
  }

  /** Start a flock now (debug). */
  birds(W: number, H: number): void {
    const n = 5 + ((Math.random() * 6) | 0);
    this.birdCount = n;
    const dir = Math.random() < 0.6 ? -1 : 1;
    this.birdVX = dir * H * (0.045 + 0.025 * Math.random());
    this.birdX = dir < 0 ? W + 60 : -60;
    this.birdY = H * (0.14 + 0.24 * Math.random());
    this.birdSize = H * (0.0055 + 0.003 * Math.random());
    this.birdT = 0;
    for (let i = 0; i < n; i++) {
      // Loose V trailing behind the leader.
      const rank = Math.ceil(i / 2);
      const side = i % 2 === 0 ? 1 : -1;
      this.bdx[i] = -dir * rank * this.birdSize * (3.2 + Math.random() * 1.5);
      this.bdy[i] = side * rank * this.birdSize * (1.6 + Math.random()) + (Math.random() - 0.5) * this.birdSize * 2;
      this.bPhase[i] = Math.random() * TAU;
    }
  }

  update(view: View, anchorX: number, anchorY: number, panX: number): void {
    const W = view.width;
    const H = view.height;
    if (W !== this.w || H !== this.h) this.seed(W, H, anchorY);
    const dt = view.dt;
    const t = view.time;
    // Stage pan since last frame (px): motes move with it scaled by their depth.
    let pan = Number.isNaN(this.lastPan) ? 0 : panX - this.lastPan;
    if (Math.abs(pan) > W * 0.5) pan = 0;
    this.lastPan = panX;
    const x0 = -MARGIN;
    const span = W + MARGIN * 2;

    // Fireflies: slow wander, hover in a band around the ground line, blink in soft pulses.
    const top = anchorY - H * 0.34;
    const bottom = anchorY + H * 0.16;
    for (let i = 0; i < FLIES; i++) {
      const s = this.fSeed[i]!;
      const d = this.fd[i]!;
      const x = this.fx[i]!;
      const y = this.fy[i]!;
      const wv = wind(x / 90, t);
      let vx = 16 * N.n1(t * 0.23 + s) + wv * 7 * d;
      let vy = 11 * N.n1(t * 0.29 + s * 1.7);
      if (y < top) vy += (top - y) * 0.8;
      if (y > bottom) vy -= (y - bottom) * 0.8;
      let nx = x + vx * dt * d + pan * d;
      if (nx < x0) nx += span;
      else if (nx > x0 + span) nx -= span;
      this.fx[i] = nx;
      this.fy[i] = y + vy * dt * d;
      // Blink: mostly dim, a smooth pulse every few seconds.
      const ph = t * (0.45 + 0.35 * ((s * 0.618) % 1)) + s;
      const pulse = smoothstep(0.6, 0.97, Math.sin(ph * TAU * 0.5));
      this.fBright[i] = 0.12 + 0.88 * pulse;
      void vx;
    }

    // Motes: drift with the wind, rise and fall lazily, glint when they turn to the sun.
    for (let i = 0; i < MOTES; i++) {
      const s = this.mSeed[i]!;
      const d = this.md[i]!;
      const x = this.mx[i]!;
      const y = this.my[i]!;
      const wv = wind(x / 90, t);
      const vx = (wv * 22 + 5 * N.n1(t * 0.4 + s)) * d;
      const vy = (7 * N.n1(t * 0.33 + s * 2.1) - 1.5 + (wv - 0.5) * -4) * d;
      let nx = x + vx * dt + pan * d;
      let ny = y + vy * dt;
      if (nx < x0) nx += span;
      else if (nx > x0 + span) nx -= span;
      if (ny < H * 0.2) ny += H * 0.72;
      else if (ny > H * 0.95) ny -= H * 0.72;
      this.mx[i] = nx;
      this.my[i] = ny;
      const glint = Math.sin(t * (1.3 + (s % 1.7)) + s * 3);
      this.mBright[i] = 0.25 + 0.75 * clamp01((glint - 0.55) * 2.6);
    }

    // Birds
    if (this.birdCount > 0) {
      this.birdT += dt;
      this.birdX += this.birdVX * dt + pan * 0.08;
      if ((this.birdVX < 0 && this.birdX < -W * 0.3) || (this.birdVX > 0 && this.birdX > W * 1.3)) {
        this.birdCount = 0;
        this.nextBirds = t + 22 + Math.random() * 30;
      }
    } else if (t > this.nextBirds) {
      this.birds(W, H);
    }
    void anchorX;
  }

  /** Fireflies with depth in [dMin, dMax), additive. */
  drawFlies(ctx: CanvasRenderingContext2D, glow: HTMLCanvasElement, core: HTMLCanvasElement, dMin: number, dMax: number): void {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < FLIES; i++) {
      const d = this.fd[i]!;
      if (d < dMin || d >= dMax) continue;
      const b = this.fBright[i]!;
      const x = this.fx[i]!;
      const y = this.fy[i]!;
      const g = (7 + 11 * d) * (0.7 + 0.3 * b);
      ctx.globalAlpha = 0.55 * b;
      ctx.drawImage(glow, x - g, y - g, g * 2, g * 2);
      const c = 1.2 + 1.3 * d;
      ctx.globalAlpha = 0.35 + 0.65 * b;
      ctx.drawImage(core, x - c, y - c, c * 2, c * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawMotes(ctx: CanvasRenderingContext2D, core: HTMLCanvasElement): void {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MOTES; i++) {
      const d = this.md[i]!;
      const b = this.mBright[i]!;
      const r = 0.7 + 1.1 * d * (0.6 + 0.4 * b);
      ctx.globalAlpha = (0.2 + 0.6 * b) * Math.min(1, 0.35 + d * 0.5);
      ctx.drawImage(core, this.mx[i]! - r, this.my[i]! - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawBirds(ctx: CanvasRenderingContext2D, color: string, t: number): void {
    if (this.birdCount === 0) return;
    const s = this.birdSize;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s * 0.28);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < this.birdCount; i++) {
      const ph = this.bPhase[i]! + t * 9;
      const flap = Math.sin(ph);
      // Glide now and then: wings held up in a shallow V.
      const glide = smoothstep(0.3, 0.8, Math.sin(t * 0.7 + this.bPhase[i]!));
      const wing = (flap * (1 - glide) + 0.35 * glide) * s * 0.9;
      const x = this.birdX + this.bdx[i]! + Math.sin(t * 0.9 + i) * s * 0.6;
      const y = this.birdY + this.bdy[i]! + Math.sin(t * 1.3 + i * 2) * s * 0.5 - flap * s * 0.12;
      ctx.moveTo(x - s, y - wing);
      ctx.quadraticCurveTo(x - s * 0.45, y - wing * 0.1 - s * 0.15, x, y);
      ctx.quadraticCurveTo(x + s * 0.45, y - wing * 0.1 - s * 0.15, x + s, y - wing);
    }
    ctx.stroke();
  }
}
