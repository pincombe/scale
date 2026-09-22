// Post FX layer (slot 6). STUB quality (WP 0.2): vignette, animated film grain, full-screen flash.
// The juice WP (1.4) owns this file and adds the chromatic kick, color grading, etc.
// Canvas 2D only: no ctx.filter (Chrome-only). Grain uses the 'overlay' composite mode.
import type { Scene } from '../app/scene';
import type { Layer, View } from './types';
import type { Palette } from './palette';
import { makeCanvas, context2d } from './atlas';
import { rgba } from '../lib/color';

export interface PostLayer extends Layer {
  flash(color: string, alpha: number, seconds: number): void;
  /** Momentary punch (0..1): zoom punch now; chromatic kick later (juice WP). */
  kick(strength: number): void;
}

const GRAIN_SIZE = 128;
const GRAIN_FPS = 24;

export function createPost(scene: Scene): PostLayer {
  let vignette: HTMLCanvasElement | null = null;
  let vW = 0;
  let vH = 0;
  let vPalette: Palette | null = null;

  // Grain tile: gray noise around mid-gray so 'overlay' both lightens and darkens.
  const tile = makeCanvas(GRAIN_SIZE, GRAIN_SIZE);
  const tctx = context2d(tile);
  const img = tctx.createImageData(GRAIN_SIZE, GRAIN_SIZE);
  let s = 0x3c6ef372;
  for (let i = 0; i < img.data.length; i += 4) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const v = 128 + (((s >>> 0) / 4294967296 - 0.5) * 2) * 110;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  const pattern = tctx.createPattern(tile, 'repeat');
  let grainX = 0;
  let grainY = 0;
  let grainClock = 0;

  let flashColor = '#ffffff';
  let flashA0 = 0;
  let flashDur = 1;
  let flashT = 1;

  const bakeVignette = (w: number, h: number, p: Palette): void => {
    vPalette = p;
    vW = w;
    vH = h;
    const k = 0.25; // quarter resolution; smooth gradients upscale cleanly
    vignette = makeCanvas(w * k, h * k);
    const ctx = context2d(vignette);
    ctx.scale(k, k);
    const cx = w * 0.5;
    const cy = h * 0.46;
    const r = Math.hypot(w, h) * 0.5;
    const g = ctx.createRadialGradient(cx, cy, r * 0.42, cx, cy, r * 1.02);
    g.addColorStop(0, rgba(p.vignette, 0));
    g.addColorStop(0.55, rgba(p.vignette, p.vignetteStrength * 0.45));
    g.addColorStop(1, rgba(p.vignette, p.vignetteStrength));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };

  const layer: PostLayer = {
    name: 'post',
    visible: true,
    flash(color, alpha, seconds) {
      const a = alpha * (scene.settings.get('reduceFlashes') ? 0.3 : 1);
      // Keep the stronger of an ongoing flash and the new one.
      const cur = flashT < flashDur ? flashA0 * (1 - flashT / flashDur) : 0;
      if (a < cur) return;
      flashColor = color;
      flashA0 = a;
      flashDur = Math.max(0.01, seconds);
      flashT = 0;
    },
    kick(strength) {
      scene.camera.punchZoom(0.06 * strength);
    },
    update(v: View) {
      flashT += v.realDt;
      grainClock += v.realDt;
      if (grainClock >= 1 / GRAIN_FPS) {
        grainClock %= 1 / GRAIN_FPS;
        grainX = Math.floor(Math.random() * GRAIN_SIZE);
        grainY = Math.floor(Math.random() * GRAIN_SIZE);
      }
    },
    draw(ctx: CanvasRenderingContext2D, v: View) {
      const { width: w, height: h, dpr } = v;
      if (!vignette || vPalette !== v.palette || vW !== w || vH !== h) bakeVignette(w, h, v.palette);
      ctx.drawImage(vignette!, 0, 0, w, h);

      // Film grain in device pixels so it stays fine on Retina.
      if (pattern) {
        ctx.setTransform(1, 0, 0, 1, -grainX, -grainY);
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = pattern;
        ctx.fillRect(grainX, grainY, w * dpr, h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      if (flashT < flashDur) {
        const k = 1 - flashT / flashDur;
        ctx.globalAlpha = flashA0 * k * k;
        ctx.fillStyle = flashColor;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    },
  };
  return layer;
}
