// The zoom's own effects, drawn in its layer (so they sit over the snapshot and the hide):
//   Puffs    a small pool of dust clouds and embers in world meters: the rally's tremor, the pile's
//            sparks, the colossus's landing (a ring of dust rolling out from the soles)
//   Streaks  radial speed lines converging on the pull-back's focus, as long as the zoom is fast
//   Trail    motion trails: the frame so far, echoed a little larger behind itself (the world was
//            bigger a moment ago), only while the zoom is at speed
// Fixed pools, baked sprites, cached strings: nothing allocates per frame.
import type { Camera } from '../camera';
import type { SpriteAtlas } from '../atlas';
import { context2d, makeCanvas } from '../atlas';

const PUFFS = 96;
export const PUFF_DUST = 0;
export const PUFF_EMBER = 1;
/** Sunlit dust: additive, a smooth swell and fade (drawn with a warm glow sprite). */
export const PUFF_GLOW = 2;

export class Puffs {
  readonly x = new Float64Array(PUFFS);
  readonly y = new Float64Array(PUFFS);
  readonly vx = new Float64Array(PUFFS);
  readonly vy = new Float64Array(PUFFS);
  /** Radius (m), its growth (m/s), age and life (s), peak alpha, kind, front (over the colossus). */
  readonly r = new Float64Array(PUFFS);
  readonly dr = new Float64Array(PUFFS);
  readonly age = new Float64Array(PUFFS);
  readonly life = new Float64Array(PUFFS);
  readonly a = new Float32Array(PUFFS);
  readonly kind = new Uint8Array(PUFFS);
  readonly front = new Uint8Array(PUFFS);
  readonly rot = new Float32Array(PUFFS);
  private next = 0;
  count = 0;

  clear(): void {
    this.life.fill(0);
    this.count = 0;
  }

  spawn(kind: number, x: number, y: number, vx: number, vy: number, r: number, dr: number, life: number, alpha: number, front: boolean): void {
    const i = this.next;
    this.next = (i + 1) % PUFFS;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.r[i] = r;
    this.dr[i] = dr;
    this.age[i] = 0;
    this.life[i] = life;
    this.a[i] = alpha;
    this.front[i] = front ? 1 : 0;
    this.rot[i] = Math.random() * 6.283;
  }

  update(dt: number): void {
    let n = 0;
    for (let i = 0; i < PUFFS; i++) {
      if (this.life[i]! <= 0) continue;
      const age = this.age[i]! + dt;
      if (age >= this.life[i]!) {
        this.life[i] = 0;
        continue;
      }
      this.age[i] = age;
      n++;
      const k = this.kind[i]!;
      // Dust slows as it rolls out; embers drift up and slow.
      const drag = Math.exp(-(k === PUFF_EMBER ? 0.9 : 1.6) * dt);
      this.vx[i]! *= drag;
      this.vy[i]! *= drag;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.r[i]! += this.dr[i]! * dt;
      this.dr[i]! *= Math.exp(-0.7 * dt);
    }
    this.count = n;
  }

  /**
   * Draw one kind (and one side of the colossus) through the camera. Puffs live in coordinates
   * local to (ox, oy) world m (the colossus's feet), so they follow it across the tier switch.
   */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, sprite: HTMLCanvasElement, kind: number, front: number, gain: number, ox: number, oy: number): void {
    if (gain <= 0.002) return;
    const A = cam.a * dpr;
    const B = cam.b * dpr;
    const C = cam.c * dpr;
    const D = cam.d * dpr;
    const E = cam.e * dpr;
    const F = cam.f * dpr;
    const z = cam.zoomEff * dpr;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    for (let i = 0; i < PUFFS; i++) {
      if (this.life[i]! <= 0 || this.kind[i] !== kind || this.front[i] !== front) continue;
      const u = this.age[i]! / this.life[i]!;
      // Dust: quick in, long fade. Embers: flicker in, fade out. Lit dust: swell, then fade.
      const env =
        kind === PUFF_DUST
          ? Math.min(1, u * 8) * (1 - u) * (1 - u)
          : kind === PUFF_GLOW
            ? Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u)
            : Math.min(1, u * 5) * (1 - u) * (0.7 + 0.3 * Math.sin(this.rot[i]! * 7 + u * 40));
      const al = env * this.a[i]! * gain;
      if (al < 0.01) continue;
      const wx = ox + this.x[i]!;
      const wy = oy + this.y[i]!;
      const sx = A * wx + C * wy + E;
      const sy = B * wx + D * wy + F;
      const s = this.r[i]! * z * 2;
      if (sx + s < 0 || sy + s < 0 || sx - s > W || sy - s > H) continue;
      ctx.globalAlpha = al > 1 ? 1 : al;
      const cr = Math.cos(this.rot[i]!);
      const sr = Math.sin(this.rot[i]!);
      ctx.setTransform(cr * s / sprite.width, sr * s / sprite.width, -sr * s / sprite.width, cr * s / sprite.width, sx, sy);
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- streaks

const STREAKS = 64;

/** A soft white line along +x (tinted by the atlas), baked once. */
export function registerStreak(atlas: SpriteAtlas): number {
  return atlas.register('zoom.streak', 128, 8, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.92, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.3, w, h * 0.4);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(w * 0.3, h * 0.15, w * 0.68, h * 0.7);
  });
}

export class Streaks {
  private readonly ang = new Float32Array(STREAKS);
  /** Distance from the focus as a fraction of the screen's half-diagonal. */
  private readonly rad = new Float32Array(STREAKS);
  private readonly len = new Float32Array(STREAKS);
  private readonly bright = new Float32Array(STREAKS);
  private seeded = false;

  private seed(i: number, outer: boolean): void {
    this.ang[i] = Math.random() * Math.PI * 2;
    this.rad[i] = outer ? 0.85 + Math.random() * 0.5 : 0.2 + Math.random() * 1.1;
    this.len[i] = 0.5 + Math.random() * 0.9;
    this.bright[i] = 0.35 + Math.random() * 0.65;
  }

  /** The world shrank by `ratio` (< 1) toward the focus this frame. */
  update(ratio: number): void {
    if (!this.seeded) {
      this.seeded = true;
      for (let i = 0; i < STREAKS; i++) this.seed(i, false);
    }
    for (let i = 0; i < STREAKS; i++) {
      this.rad[i]! *= ratio;
      if (this.rad[i]! < 0.12) this.seed(i, true);
    }
  }

  /**
   * Draw around (fx, fy) CSS px; `speed` = the zoom's log-speed (1/s), `amount` 0..1 (fewer and
   * fainter with reduce motion). Streak length follows the speed: they are where points were.
   */
  draw(ctx: CanvasRenderingContext2D, dpr: number, fx: number, fy: number, halfDiag: number, speed: number, amount: number, sprite: HTMLCanvasElement): void {
    if (amount <= 0.01 || speed <= 0.05) return;
    const n = Math.round(STREAKS * amount);
    const k = Math.min(1, speed / 1.2);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const r = this.rad[i]! * halfDiag;
      if (r < 20) continue;
      const L = Math.min(r * 0.9, r * (1 - Math.exp(-speed * 0.22)) * this.len[i]! * 2.2);
      if (L < 6) continue;
      const a = this.ang[i]!;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      // Fade in from the screen edge inward, out near the focus.
      const edge = Math.min(1, (this.rad[i]! - 0.12) * 4) * Math.min(1, (1.35 - this.rad[i]!) * 3);
      const al = 0.3 * k * this.bright[i]! * edge * amount;
      if (al < 0.01) continue;
      ctx.globalAlpha = al > 1 ? 1 : al;
      // The sprite's bright head points to the focus: it runs from r + L (tail) to r (head).
      const sx = (L / sprite.width) * dpr;
      const sy = (Math.max(1.2, 0.012 * r) / sprite.height) * dpr * 2.2;
      ctx.setTransform(-cs * sx, -sn * sx, -sn * sy, cs * sy, (fx + cs * (r + L)) * dpr, (fy + sn * (r + L)) * dpr);
      ctx.drawImage(sprite, 0, -sprite.height / 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---------------------------------------------------------------- trail

/**
 * Motion trails for the fast part of the pull-back: the frame so far (ctx.canvas, as drawn this
 * frame up to the zoom layer), copied into a half-resolution buffer and laid back over itself
 * scaled up about the focus, twice, faintly. Reads as the world streaming inward. ~2 full-screen
 * blits at half resolution.
 */
export class Trail {
  private buf: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;

  draw(ctx: CanvasRenderingContext2D, fx: number, fy: number, dpr: number, stretch: number, amount: number): void {
    if (amount <= 0.02 || stretch <= 0.002) return;
    const src = ctx.canvas as HTMLCanvasElement;
    const W = src.width;
    const H = src.height;
    const bw = Math.max(1, Math.ceil(W / 2));
    const bh = Math.max(1, Math.ceil(H / 2));
    if (!this.buf || this.buf.width !== bw || this.buf.height !== bh) {
      this.release();
      this.buf = makeCanvas(bw, bh);
      this.g = context2d(this.buf);
    }
    const g = this.g!;
    g.globalCompositeOperation = 'copy';
    g.drawImage(src, 0, 0, bw, bh);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = fx * dpr;
    const cy = fy * dpr;
    for (let i = 1; i <= 2; i++) {
      const s = 1 + stretch * i;
      ctx.globalAlpha = amount * (i === 1 ? 0.3 : 0.16);
      ctx.drawImage(this.buf, 0, 0, bw, bh, cx - cx * s, cy - cy * s, W * s, H * s);
    }
    ctx.restore();
  }

  release(): void {
    if (this.buf) {
      this.buf.width = 0;
      this.buf.height = 0;
    }
    this.buf = null;
    this.g = null;
  }
}

/**
 * A soft column of light (64 x 256): a gaussian across, bright at the base fading upward. `color`
 * at `a0`. Stretch it over a rect; its sides are soft at any width.
 */
export function bakeColumn(color: string, a0: number): HTMLCanvasElement {
  const c = makeCanvas(64, 256);
  const g = context2d(c);
  const across = g.createLinearGradient(0, 0, 64, 0);
  for (let i = 0; i <= 12; i++) {
    const u = (i / 12) * 2 - 1;
    // A gaussian that reaches exactly zero at both sides (no edge survives additive blending).
    const k = Math.max(0, Math.exp(-u * u * 4.2) - Math.exp(-4.2)) / (1 - Math.exp(-4.2));
    across.addColorStop(i / 12, rgbaHex(color, a0 * k));
  }
  g.fillStyle = across;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const up = g.createLinearGradient(0, 256, 0, 0);
  up.addColorStop(0, 'rgba(0,0,0,0)');
  up.addColorStop(0.1, 'rgba(0,0,0,1)');
  up.addColorStop(0.35, 'rgba(0,0,0,0.8)');
  up.addColorStop(0.75, 'rgba(0,0,0,0.3)');
  up.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = up;
  g.fillRect(0, 0, 64, 256);
  return c;
}

/** A vertical gradient strip (2 x 256): `color` rising from `a0` at the bottom to 0 at the top. */
export function bakeRise(color: string, a0: number): HTMLCanvasElement {
  const c = makeCanvas(2, 256);
  const g = context2d(c);
  const gr = g.createLinearGradient(0, 256, 0, 0);
  gr.addColorStop(0, rgbaHex(color, a0));
  gr.addColorStop(0.35, rgbaHex(color, a0 * 0.75));
  gr.addColorStop(1, rgbaHex(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, 2, 256);
  return c;
}

function rgbaHex(hex: string, a: number): string {
  const h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
