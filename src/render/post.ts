// Post FX layer (slot 7), owned by the juice WP (1.4). In order:
//   1. Chromatic kick: for big moments the red and blue channels split radially from the stage
//      center for ~0.3 s (a lens "hit"). Pure Canvas 2D compositing, no ctx.filter: the frame so
//      far is copied into two half-res buffers, each masked to one channel with 'multiply'; the
//      main canvas keeps only green ('multiply' #0f0), then the red and blue buffers are added
//      back ('lighter'), both scaled outward (red more), so no channel loses the screen edge. Green (most of the luminance) stays
//      full-res and sharp. Only runs while a kick is live.
//   2. Vignette: an elliptical radial gradient baked once per size/palette into a small canvas.
//      It stays in canvas (one source-over drawImage of a cached 256 px canvas, no blend mode)
//      because the HUD coin fountain (particles.screen, slot 8) must fly OVER it into the
//      top-left gold counter at full brightness; a CSS vignette would dim every coin as it lands.
//   3. Flash: a full-screen additive wash that fades out (the stronger of overlapping flashes wins).
// Film grain is NOT a canvas pass: it's a CSS overlay (fx/grain.ts), composited for free and kept
// out of M2 snapshots. Its visibility follows this layer's `visible` flag.
// settings.reduceFlashes scales flashes and kicks down; reduceMotion scales the kick's zoom punch
// (via camera.motionScale) and the chromatic split.
import type { Scene } from '../app/scene';
import type { Layer, View } from './types';
import type { Palette } from './palette';
import { makeCanvas, context2d } from './atlas';
import { rgba } from '../lib/color';
import { createGrain } from './fx/grain';

export interface PostLayer extends Layer {
  flash(color: string, alpha: number, seconds: number): void;
  /** Momentary punch (0..1): zoom punch plus a chromatic split. */
  kick(strength: number): void;
}

const KICK_DUR = 0.34;
/** Max radial channel split at kick 1, as a fraction of the half-diagonal. */
const KICK_SPLIT = 0.014;
const VIGNETTE_PX = 256;

export function createPost(scene: Scene): PostLayer {
  let vignette: HTMLCanvasElement | null = null;
  let vPalette: Palette | null = null;

  const grain = createGrain();
  let grainShown = true;
  grain.setAnimated(!scene.settings.get('reduceMotion'));
  scene.settings.onChange((st, key) => {
    if (key === 'reduceMotion') grain.setAnimated(!st.reduceMotion);
  });

  let flashColor = '#ffffff';
  let flashA0 = 0;
  let flashDur = 1;
  let flashT = 1;

  let kickA0 = 0;
  let kickT = KICK_DUR;
  let kickNow = 0;

  // Chromatic scratch buffers (half-res, lazily sized to the target canvas).
  let bufR: HTMLCanvasElement | null = null;
  let bufB: HTMLCanvasElement | null = null;
  let ctxR: CanvasRenderingContext2D | null = null;
  let ctxB: CanvasRenderingContext2D | null = null;

  const bakeVignette = (p: Palette): void => {
    vPalette = p;
    // A square gradient stretched to the viewport gives an elliptical vignette at any aspect.
    const n = VIGNETTE_PX;
    vignette = makeCanvas(n, n);
    const ctx = context2d(vignette);
    const c = n / 2;
    const g = ctx.createRadialGradient(c, c * 0.94, n * 0.26, c, c * 0.94, n * 0.74);
    g.addColorStop(0, rgba(p.vignette, 0));
    g.addColorStop(0.35, rgba(p.vignette, p.vignetteStrength * 0.18));
    g.addColorStop(0.7, rgba(p.vignette, p.vignetteStrength * 0.62));
    g.addColorStop(1, rgba(p.vignette, p.vignetteStrength));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  };

  const ensureBuffers = (w: number, h: number): void => {
    const bw = Math.max(1, Math.ceil(w / 2));
    const bh = Math.max(1, Math.ceil(h / 2));
    if (bufR && bufR.width === bw && bufR.height === bh) return;
    bufR = makeCanvas(bw, bh);
    bufB = makeCanvas(bw, bh);
    ctxR = context2d(bufR);
    ctxB = context2d(bufB);
  };

  /** Split the red and blue channels of everything drawn so far (device px, identity transform). */
  const chromatic = (ctx: CanvasRenderingContext2D, amount: number): void => {
    const src = ctx.canvas as HTMLCanvasElement;
    const W = src.width;
    const H = src.height;
    ensureBuffers(W, H);
    const bw = bufR!.width;
    const bh = bufR!.height;
    const r = ctxR!;
    const b = ctxB!;
    r.globalCompositeOperation = 'copy';
    r.drawImage(src, 0, 0, bw, bh);
    r.globalCompositeOperation = 'multiply';
    r.fillStyle = '#ff0000';
    r.fillRect(0, 0, bw, bh);
    b.globalCompositeOperation = 'copy';
    b.drawImage(src, 0, 0, bw, bh);
    b.globalCompositeOperation = 'multiply';
    b.fillStyle = '#0000ff';
    b.fillRect(0, 0, bw, bh);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const cx = W * 0.5;
    const cy = H * 0.5;
    // Both channels scale outward (so neither leaves an uncovered edge), red more than blue:
    // warm outer / cool inner fringes like a lens hit.
    const kr = 1 + amount;
    const kb = 1 + amount * 0.35;
    ctx.drawImage(bufR!, 0, 0, bw, bh, cx - cx * kr, cy - cy * kr, W * kr, H * kr);
    ctx.drawImage(bufB!, 0, 0, bw, bh, cx - cx * kb, cy - cy * kb, W * kb, H * kb);
    ctx.globalCompositeOperation = 'source-over';
  };

  const reduceFlashes = (): boolean => scene.settings.get('reduceFlashes');

  const layer: PostLayer = {
    name: 'post',
    visible: true,
    flash(color, alpha, seconds) {
      const a = alpha * (reduceFlashes() ? 0.3 : 1);
      // Keep the stronger of an ongoing flash and the new one.
      const k = flashT < flashDur ? 1 - flashT / flashDur : 0;
      if (a < flashA0 * k * k) return;
      flashColor = color;
      flashA0 = a;
      flashDur = Math.max(0.01, seconds);
      flashT = 0;
    },
    kick(strength) {
      const st = Math.max(0, Math.min(1, strength));
      scene.camera.punchZoom(0.055 * st);
      let a = st;
      if (reduceFlashes()) a *= 0.3;
      if (scene.settings.get('reduceMotion')) a *= 0.5;
      if (a >= kickNow) {
        kickA0 = a;
        kickT = 0;
      }
    },
    update(v: View) {
      flashT += v.realDt;
      kickT += v.realDt;
      const kk = kickT < KICK_DUR ? 1 - kickT / KICK_DUR : 0;
      kickNow = kickA0 * kk * kk;
      if (grain.el && grainShown !== layer.visible) {
        grainShown = layer.visible;
        grain.el.style.display = grainShown ? '' : 'none';
      }
    },
    draw(ctx: CanvasRenderingContext2D, v: View) {
      const { width: w, height: h, dpr } = v;

      if (kickNow > 0.02) {
        chromatic(ctx, kickNow * KICK_SPLIT);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      if (!vignette || vPalette !== v.palette) bakeVignette(v.palette);
      ctx.drawImage(vignette!, 0, 0, w, h);

      if (flashT < flashDur) {
        const k = 1 - flashT / flashDur;
        const a = flashA0 * k * k;
        if (a > 0.004) {
          // Additive: brights bloom toward white instead of a flat gray wash.
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.fillStyle = flashColor;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    },
  };
  return layer;
}
