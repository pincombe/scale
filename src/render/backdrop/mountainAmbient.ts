// The Mountain's ambient life. Snow blown across the stage on the shared wind (screen space,
// depth-sized, fixed pool), and cloud wisps drifting at the army's knees: knights here are ~200 m
// tall, so the weather is ankle-deep. Wisps live in world meters (they scale with the knights at
// every framing); most drift behind the army (drawn at the end of backdrop.back), a few in front
// of it (backdrop.front), thin enough never to hide the fight.
import type { View } from '../types';
import type { Palette } from '../palette';
import type { Rect } from '../../lib/vec';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { Noise } from '../../lib/noise';
import { Rng } from '../../lib/rng';
import { clamp01, TAU } from '../../lib/math';
import { wind } from './wind';

const FLAKES = 96;
const MARGIN = 40;
const N = new Noise(0x5a0f);

export class Snow {
  private readonly x = new Float32Array(FLAKES);
  private readonly y = new Float32Array(FLAKES);
  private readonly d = new Float32Array(FLAKES);
  private readonly seed = new Float32Array(FLAKES);
  private w = 0;
  private h = 0;
  private lastPan = NaN;
  /** Gust strength 0..1 (drawn as streaks when high). */
  private gusty = 0;

  private reset(W: number, H: number): void {
    this.w = W;
    this.h = H;
    for (let i = 0; i < FLAKES; i++) {
      this.seed[i] = i * 3.71 + 1;
      this.d[i] = 0.35 + 1.5 * Math.random() * Math.random();
      this.x[i] = Math.random() * W;
      this.y[i] = Math.random() * H;
    }
  }

  update(view: View, panX: number): void {
    const W = view.width;
    const H = view.height;
    if (W !== this.w || H !== this.h) this.reset(W, H);
    const dt = view.dt;
    const t = view.time;
    let pan = Number.isNaN(this.lastPan) ? 0 : panX - this.lastPan;
    if (Math.abs(pan) > W * 0.5) pan = 0;
    this.lastPan = panX;
    this.gusty = clamp01((wind(0, t) - 0.7) * 1.4);
    const span = W + MARGIN * 2;
    for (let i = 0; i < FLAKES; i++) {
      const s = this.seed[i]!;
      const d = this.d[i]!;
      const wv = wind(this.x[i]! / 120, t);
      const vx = (40 + 110 * wv + 14 * N.n1(t * 0.5 + s)) * d;
      const vy = (14 + 10 * N.n1(t * 0.37 + s * 1.3)) * d;
      let nx = this.x[i]! + vx * dt + pan * d;
      let ny = this.y[i]! + vy * dt;
      if (nx > W + MARGIN) nx -= span;
      else if (nx < -MARGIN) nx += span;
      if (ny > H + MARGIN) {
        ny -= H + MARGIN * 2;
        nx = Math.random() * W;
      }
      this.x[i] = nx;
      this.y[i] = ny;
    }
  }

  /** Flakes of depth in [dMin, dMax), additive. */
  draw(ctx: CanvasRenderingContext2D, core: HTMLCanvasElement, dMin: number, dMax: number, t: number): void {
    ctx.globalCompositeOperation = 'lighter';
    const streak = 1 + 2.2 * this.gusty;
    for (let i = 0; i < FLAKES; i++) {
      const d = this.d[i]!;
      if (d < dMin || d >= dMax) continue;
      const r = 0.6 + 1.25 * d;
      const tw = 0.75 + 0.25 * Math.sin(t * 3 + this.seed[i]!);
      ctx.globalAlpha = Math.min(1, 0.22 + 0.4 * d) * tw;
      ctx.drawImage(core, this.x[i]! - r * streak, this.y[i]! - r, r * 2 * streak, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---------------------------------------------------------------- wisps at the army's knees

const WISPS = 9;
const VARIANTS = 3;

interface WispArt {
  canvas: HTMLCanvasElement;
}

/** A long soft wisp: lit rose along its top, violet beneath, frayed at both ends. */
function bakeWisp(pal: Palette, v: number): HTMLCanvasElement {
  const W = 480;
  const Hh = 72;
  const c = makeCanvas(W, Hh);
  const ctx = context2d(c);
  const rng = new Rng(0x71 + v * 17);
  const top = mixHex(mixHex(pal.haze, pal.rim, 0.6), '#ffffff', 0.15);
  const low = mixHex(pal.haze, pal.depthTint ?? pal.haze, 0.55);
  const n = 26 + v * 6;
  for (let i = 0; i < n; i++) {
    const u = (i + rng.float()) / n;
    const env = Math.pow(Math.sin(Math.PI * u), 0.8);
    const x = u * W;
    const rx = (30 + 50 * rng.float()) * (0.5 + 0.5 * env);
    const ry = (8 + 14 * rng.float()) * env + 3;
    const y = Hh * 0.55 + (rng.float() - 0.5) * 10 * env;
    const g = ctx.createRadialGradient(x, y - ry * 0.35, 0, x, y, rx);
    g.addColorStop(0, rgba(top, 0.6 * env));
    g.addColorStop(0.45, rgba(mixHex(top, low, 0.5), 0.34 * env));
    g.addColorStop(1, rgba(low, 0));
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -y);
    ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
    ctx.restore();
  }
  return c;
}

export class Wisps {
  private readonly x = new Float32Array(WISPS);
  private readonly y = new Float32Array(WISPS);
  private readonly len = new Float32Array(WISPS);
  private readonly thick = new Float32Array(WISPS);
  private readonly speed = new Float32Array(WISPS);
  private readonly alpha = new Float32Array(WISPS);
  private readonly variant = new Uint8Array(WISPS);
  /** 1 = in front of the army. */
  private readonly front = new Uint8Array(WISPS);
  private art: WispArt[] = [];
  private palette: Palette | null = null;
  private seeded = false;

  ensure(pal: Palette): void {
    if (this.palette === pal && this.art.length) return;
    this.free();
    this.palette = pal;
    for (let v = 0; v < VARIANTS; v++) this.art.push({ canvas: bakeWisp(pal, v) });
  }

  free(): void {
    for (const a of this.art) a.canvas.width = a.canvas.height = 0;
    this.art = [];
    this.palette = null;
  }

  bytes(): number {
    let b = 0;
    for (const a of this.art) b += a.canvas.width * a.canvas.height * 4;
    return b;
  }

  private seed(vis: Rect): void {
    this.seeded = true;
    for (let i = 0; i < WISPS; i++) {
      const fr = i < 3 ? 1 : 0;
      this.front[i] = fr;
      this.len[i] = (2.6 + 3.4 * Math.random()) * (fr ? 0.8 : 1);
      this.thick[i] = 0.28 + 0.26 * Math.random();
      this.x[i] = vis.x + Math.random() * vis.w;
      // Knee height (a knight is 1.8 m): 0.2..0.8 m above the ridge line; front ones lower.
      this.y[i] = -(fr ? 0.12 + 0.3 * Math.random() : 0.25 + 0.55 * Math.random());
      this.speed[i] = 0.05 + 0.08 * Math.random();
      this.alpha[i] = fr ? 0.3 + 0.15 * Math.random() : 0.55 + 0.35 * Math.random();
      this.variant[i] = i % VARIANTS;
    }
  }

  /** Drift with the wind; wrap around the visible world rect (world meters). */
  update(dt: number, t: number, vis: Rect): void {
    if (!this.seeded) this.seed(vis);
    for (let i = 0; i < WISPS; i++) {
      const w = wind(this.x[i]! * 0.3, t);
      let x = this.x[i]! + this.speed[i]! * (0.6 + 0.8 * w) * dt;
      const L = this.len[i]!;
      if (x - L > vis.x + vis.w) x = vis.x - L - Math.random() * vis.w * 0.3;
      else if (x + L < vis.x - vis.w * 0.5) x = vis.x + vis.w + Math.random() * vis.w * 0.2;
      this.x[i] = x;
    }
  }

  /** Draw the wisps of one depth (0 behind the army, 1 in front), in world meters. */
  draw(ctx: CanvasRenderingContext2D, view: View, front: number, t: number): void {
    if (!this.art.length || !this.seeded) return;
    ctx.save();
    view.camera.apply(ctx);
    for (let i = 0; i < WISPS; i++) {
      if (this.front[i] !== front) continue;
      const L = this.len[i]!;
      const T = this.thick[i]! * (1 + 0.08 * Math.sin(t * 0.3 + i));
      ctx.globalAlpha = this.alpha[i]! * (0.85 + 0.15 * Math.sin(t * 0.21 + i * 2.1));
      ctx.drawImage(this.art[this.variant[i]!]!.canvas, this.x[i]! - L * 0.5, this.y[i]! - T * 0.55, L, T);
    }
    ctx.restore();
    void TAU;
  }
}
