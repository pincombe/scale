// Procedural SpriteAtlas: pre-rendered offscreen canvases addressed by integer id.
// Canvas 2D can't tint drawImage per call, so tinted variants are baked once and cached.
// Register at init (or lazily once), keep the returned ids, and pass ids around in hot paths.
import { mixHex } from '../lib/color';

export type SpriteDraw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

export class SpriteAtlas {
  /** Sprite canvases by id (index directly in hot loops). */
  readonly canvases: HTMLCanvasElement[] = [];
  private readonly byName = new Map<string, number>();

  /**
   * Render a sprite once and return its id. Draw white/grayscale art if you want to tint it.
   * Registering an existing name returns the existing id (idempotent).
   */
  register(name: string, w: number, h: number, draw: SpriteDraw): number {
    const existing = this.byName.get(name);
    if (existing !== undefined) return existing;
    const c = makeCanvas(w, h);
    const ctx = context2d(c);
    draw(ctx, c.width, c.height);
    return this.add(name, c);
  }

  /** Add an already-rendered canvas under a name. */
  add(name: string, canvas: HTMLCanvasElement): number {
    const id = this.canvases.length;
    this.canvases.push(canvas);
    this.byName.set(name, id);
    return id;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  id(name: string): number {
    const id = this.byName.get(name);
    if (id === undefined) throw new Error(`atlas: no sprite named '${name}'`);
    return id;
  }

  canvas(id: number): HTMLCanvasElement {
    const c = this.canvases[id];
    if (!c) throw new Error(`atlas: no sprite with id ${id}`);
    return c;
  }

  get size(): number {
    return this.canvases.length;
  }

  /**
   * A tinted copy of sprite `id` (keeps its alpha, replaces its color). `core` (0..1) adds the
   * original back on top with 'lighter', keeping a hot white center (fire, sparks). Cached.
   */
  tint(id: number, color: string, core = 0): number {
    const key = `${id}|${color}|${core}`;
    const existing = this.byName.get(key);
    if (existing !== undefined) return existing;
    const src = this.canvas(id);
    const c = makeCanvas(src.width, src.height);
    const ctx = context2d(c);
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    if (core > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = core;
      ctx.drawImage(src, 0, 0);
    }
    return this.add(key, c);
  }

  /**
   * `steps` consecutive tinted variants of `id`, sweeping through `colors` (evenly spaced stops).
   * Returns the first id; particles with `ramp: steps` step through them over their life.
   */
  ramp(id: number, colors: readonly string[], steps = colors.length, core = 0): number {
    const key = `ramp:${id}|${colors.join(',')}|${steps}|${core}`;
    const existing = this.byName.get(key);
    if (existing !== undefined) return existing;
    const first = this.canvases.length;
    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 0 : i / (steps - 1);
      const f = t * (colors.length - 1);
      const k = Math.min(colors.length - 2, Math.floor(f));
      const color = colors.length === 1 ? colors[0]! : mixHex(colors[k]!, colors[k + 1]!, f - k);
      const src = this.canvas(id);
      const c = makeCanvas(src.width, src.height);
      const ctx = context2d(c);
      ctx.drawImage(src, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, c.width, c.height);
      if (core > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = core * (1 - t);
        ctx.drawImage(src, 0, 0);
      }
      this.canvases.push(c);
    }
    this.byName.set(key, first);
    return first;
  }
}

/** Ids of the sprites every atlas starts with. */
export interface BuiltinSprites {
  /** Soft round glow, white. Additive light, flashes, halos. */
  glow: number;
  /** Streak 4:1, bright head at +x. Use with `align` so it points along its velocity. */
  spark: number;
  /** Small hot dot with a hard core, white. */
  ember: number;
  /** Irregular soft puff, white (tint it). */
  smoke: number;
  /** Small soft puff, white (tint it with the palette). */
  dust: number;
  /** Gold coin, already colored. */
  coin: number;
  /** Thin ring, white. Shockwaves. */
  ring: number;
}

export function registerBuiltinSprites(atlas: SpriteAtlas): BuiltinSprites {
  const glow = atlas.register('glow', 64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  const spark = atlas.register('spark', 64, 16, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.92, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.quadraticCurveTo(w * 0.8, h * 0.08, w, h / 2);
    ctx.quadraticCurveTo(w * 0.8, h * 0.92, 0, h / 2);
    ctx.fill();
  });

  const ember = atlas.register('ember', 16, 16, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  const smoke = atlas.register('smoke', 64, 64, (ctx, w, h) => {
    // A few offset soft blobs make an irregular, non-circular puff.
    const blobs = [
      [0.5, 0.52, 0.34, 0.9],
      [0.36, 0.44, 0.24, 0.7],
      [0.64, 0.42, 0.22, 0.65],
      [0.46, 0.64, 0.22, 0.6],
      [0.62, 0.62, 0.2, 0.55],
    ] as const;
    for (const [bx, by, br, ba] of blobs) {
      const g = ctx.createRadialGradient(bx * w, by * h, 0, bx * w, by * h, br * w);
      g.addColorStop(0, `rgba(255,255,255,${ba * 0.55})`);
      g.addColorStop(0.6, `rgba(255,255,255,${ba * 0.25})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });

  const dust = atlas.register('dust', 32, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  const coin = atlas.register('coin', 32, 32, (ctx, w, h) => {
    const r = w / 2 - 1.5;
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = '#7a4a0c';
    ctx.beginPath();
    ctx.arc(cx, cy + 0.8, r, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.35, '#ffd65a');
    g.addColorStop(0.8, '#e0961e');
    g.addColorStop(1, '#a8640e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(122,74,12,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,240,0.9)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.35, cy - r * 0.42, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2);
    ctx.fill();
  });

  const ring = atlas.register('ring', 64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  return { glow, spark, ember, smoke, dust, coin, ring };
}
