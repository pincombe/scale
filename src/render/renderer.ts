// Renderer: owns the main canvas (full window, DPR capped at 2), the ordered layer stack and the
// main View. drawScene(ctx, view) is re-entrant: it paints the whole stack into any 2D context
// for any view (the M2 zoom director uses it to snapshot a tier into an offscreen canvas).
import type { GameState } from '../core';
import type { Camera } from './camera';
import type { Palette } from './palette';
import type { Layer, View } from './types';

export const MAX_DPR = 2;

/** Stack order. Each slot is a separate Layer owned by the named module. */
export const LAYER_ORDER = [
  'backdrop.back', // 0 sky, sun, god rays, parallax silhouettes, the eye      (render/backdrop)
  'dragon', //        1                                                          (render/dragon)
  'crowd', //         2 hero, footmen, archers, arrows, banners                  (render/crowd)
  'particles.world', // 3                                                        (render/particles)
  'backdrop.front', // 4 foreground grass, fog                                   (render/backdrop)
  'fx.text', //       5 damage numbers                                           (render/fx)
  'post', //          6 vignette, grain, flash, chromatic kick                   (render/post.ts)
  'particles.screen', // 7 coins flying to the HUD                               (render/particles)
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly view: View;
  width = 1;
  height = 1;
  dpr = 1;
  private layers: Layer[] = [];
  private readonly resizeListeners: ((w: number, h: number, dpr: number) => void)[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    camera: Camera,
    palette: Palette,
    state: GameState,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.view = {
      state,
      alpha: 0,
      dt: 0,
      time: 0,
      realDt: 0,
      realTime: 0,
      camera,
      palette,
      width: 1,
      height: 1,
      dpr: 1,
      frame: 0,
    };
    window.addEventListener('resize', () => this.resize());
    this.watchDpr();
    this.resize();
  }

  /** Install the stack (must follow LAYER_ORDER). Calls resize on each layer. */
  setLayers(layers: Layer[]): void {
    for (let i = 0; i < layers.length; i++) {
      const expected = LAYER_ORDER[i];
      if (layers[i]!.name !== expected) throw new Error(`layer ${i} is '${layers[i]!.name}', expected '${expected}'`);
    }
    this.layers = layers.slice();
    for (const l of this.layers) l.resize?.(this.width, this.height, this.dpr);
  }

  get layerList(): readonly Layer[] {
    return this.layers;
  }

  layer(name: string): Layer | undefined {
    for (const l of this.layers) if (l.name === name) return l;
    return undefined;
  }

  onResize(fn: (w: number, h: number, dpr: number) => void): void {
    this.resizeListeners.push(fn);
  }

  /** Re-measure the window and DPR; resize the backing store and every layer if they changed. */
  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const v = this.view;
    v.width = w;
    v.height = h;
    v.dpr = dpr;
    v.camera.setViewport(w, h);
    for (const l of this.layers) l.resize?.(w, h, dpr);
    for (const fn of this.resizeListeners) fn(w, h, dpr);
  }

  /** DPR changes (window moved to another display, browser zoom) don't always fire 'resize'. */
  private watchDpr(): void {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onChange = (): void => {
      q.removeEventListener('change', onChange);
      this.resize();
      this.watchDpr();
    };
    q.addEventListener('change', onChange);
  }

  /**
   * Per frame: fill the main view, run every layer's update(), then draw the stack to the canvas.
   * The caller has already advanced time, ticks, events and the camera.
   */
  frame(state: GameState, alpha: number, dt: number, time: number, realDt: number, realTime: number, frame: number): void {
    const v = this.view;
    v.state = state;
    v.alpha = alpha;
    v.dt = dt;
    v.time = time;
    v.realDt = realDt;
    v.realTime = realTime;
    v.frame = frame;
    const layers = this.layers;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]!;
      if (l.update) l.update(v);
    }
    this.drawScene(this.ctx, v);
  }

  /**
   * Paint every visible layer, in order, into ctx for this view. Re-entrant and side-effect free
   * apart from drawing. Before each layer ctx is reset to scale(dpr), alpha 1, source-over.
   */
  drawScene(ctx: CanvasRenderingContext2D, view: View): void {
    const dpr = view.dpr;
    const layers = this.layers;
    // backdrop.back paints every pixel by contract; only clear when it's hidden (debug solo views,
    // cleared to the haze color so silhouettes stay readable).
    if (layers.length === 0 || !layers[0]!.visible) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = view.palette.haze;
      ctx.fillRect(0, 0, view.width * dpr, view.height * dpr);
    }
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]!;
      if (!l.visible) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      l.draw(ctx, view);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
