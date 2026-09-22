// Backdrop STUB (WP 0.2). The backdrop WP (1.1) replaces this folder: sky, sun, god rays,
// parallax silhouettes, the eye in the hills, foreground grass and fog.
//
// Contract kept by any replacement: createBackdrop(scene) returns two layers named
// 'backdrop.back' (slot 0, behind everything; must paint every pixel) and 'backdrop.front'
// (slot 4, in front of the dragon, crowd and world particles).
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { Palette } from '../palette';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { Noise } from '../../lib/noise';
import { rect, vec2 } from '../../lib/vec';
import { SAFE_MARGIN } from '../world';

export interface Backdrop {
  back: Layer;
  front: Layer;
}

/** A ridge silhouette in layer meters (at the reference framing), baked once as a Path2D. */
function ridge(seed: number, x0: number, x1: number, step: number, base: number, amp: number, freq: number): Path2D {
  const n = new Noise(seed);
  const p = new Path2D();
  p.moveTo(x0, 50);
  for (let x = x0; x <= x1; x += step) {
    const h = base + amp * (0.6 * n.fbm2(x * freq, 0.5, 3) + 0.4 * Math.abs(n.simplex2(x * freq * 2.3, 7.1)));
    p.lineTo(x, -h);
  }
  p.lineTo(x1, 50);
  p.closePath();
  return p;
}

function grass(seed: number, x0: number, x1: number): Path2D {
  const n = new Noise(seed);
  const p = new Path2D();
  p.moveTo(x0, 40);
  let x = x0;
  while (x < x1) {
    const w = 0.05 + 0.05 * (0.5 + 0.5 * n.value2(x * 13, 1));
    const h = 0.12 + 0.3 * (0.5 + 0.5 * n.fbm2(x * 1.7, 3.3, 2)) + 0.1 * (0.5 + 0.5 * n.value2(x * 29, 5));
    const lean = 0.06 * n.value2(x * 7, 9);
    const baseY = 0.42 + 0.08 * n.value2(x * 0.9, 2);
    p.lineTo(x, baseY);
    p.lineTo(x + w * 0.5 + lean, baseY - h);
    p.lineTo(x + w, baseY);
    x += w * 0.8;
  }
  p.lineTo(x1, 40);
  p.closePath();
  return p;
}

export function createBackdrop(_scene: Scene): Backdrop {
  const visible = rect();
  const tmp = vec2();
  let sky: HTMLCanvasElement | null = null;
  let skyPalette: Palette | null = null;
  let skyW = 0;
  let skyH = 0;
  let farColor = '';
  let midColor = '';
  let fogStrip: HTMLCanvasElement | null = null;

  // Hills are authored in layer meters around the base framing (a knight is 1.8 m there).
  const far = ridge(11, -400, 400, 0.6, 0.9, 1.1, 0.045);
  const mid = ridge(23, -400, 400, 0.35, 0.25, 0.8, 0.09);
  const fore = grass(37, -300, 300);

  const bake = (p: Palette, w: number, h: number): void => {
    skyPalette = p;
    skyW = w;
    skyH = h;
    // Sky + sun live at depth 0 (screen-fixed), so they are baked once per size/palette at
    // half resolution (smooth gradients upscale invisibly).
    const s = 0.5;
    sky = makeCanvas(w * s, h * s);
    const ctx = context2d(sky);
    ctx.scale(s, s);
    const g = ctx.createLinearGradient(0, 0, 0, h * p.horizon);
    for (const stop of p.sky) g.addColorStop(stop.at, stop.color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const sx = p.sun.x * w;
    const sy = p.sun.y * h;
    const gr = p.sun.glowRadius * h;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    glow.addColorStop(0, rgba(p.sun.glow, 0.8));
    glow.addColorStop(0.25, rgba(p.sun.glow, 0.33));
    glow.addColorStop(1, rgba(p.sun.glow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    const r = p.sun.radius * h;
    const disc = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    disc.addColorStop(0, '#ffffff');
    disc.addColorStop(0.7, p.sun.color);
    disc.addColorStop(1, rgba(p.sun.color, 0));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();

    farColor = mixHex(p.silhouette, p.haze, 0.62);
    midColor = mixHex(p.silhouette, p.haze, 0.3);

    // Low haze where the land meets the sky, drawn along the ground line each frame.
    fogStrip = makeCanvas(4, 128);
    const f = context2d(fogStrip);
    const fg = f.createLinearGradient(0, 0, 0, 128);
    fg.addColorStop(0, rgba(p.haze, 0));
    fg.addColorStop(0.55, rgba(p.haze, 0.33));
    fg.addColorStop(1, rgba(p.haze, 0));
    f.fillStyle = fg;
    f.fillRect(0, 0, 4, 128);
  };

  const back: Layer = {
    name: 'backdrop.back',
    visible: true,
    resize() {
      skyW = skyH = 0; // re-bake lazily with the view's palette
    },
    draw(ctx: CanvasRenderingContext2D, view: View) {
      const { width: w, height: h, palette: p, camera: cam } = view;
      if (!sky || skyPalette !== p || skyW !== w || skyH !== h) bake(p, w, h);
      ctx.drawImage(sky!, 0, 0, w, h);

      ctx.save();
      cam.applyParallax(ctx, 0.18);
      ctx.fillStyle = farColor;
      ctx.fill(far);
      ctx.restore();

      ctx.save();
      cam.applyParallax(ctx, 0.42);
      ctx.fillStyle = midColor;
      ctx.fill(mid);
      ctx.restore();

      // Haze band along the stage ground line, then the ground itself (depth 1).
      const gy = cam.worldToScreen(cam.x, 0, tmp).y;
      const band = h * 0.1;
      ctx.drawImage(fogStrip!, -SAFE_MARGIN, gy - band * 0.7, w + 2 * SAFE_MARGIN, band);
      const r = cam.visibleRect(visible, SAFE_MARGIN);
      ctx.save();
      cam.apply(ctx);
      ctx.fillStyle = p.ground;
      ctx.fillRect(r.x, 0, r.w, Math.max(0, r.y + r.h));
      ctx.restore();
    },
  };

  const front: Layer = {
    name: 'backdrop.front',
    visible: true,
    draw(ctx: CanvasRenderingContext2D, view: View) {
      const cam = view.camera;
      ctx.save();
      cam.applyParallax(ctx, 1.35);
      ctx.fillStyle = view.palette.silhouette;
      ctx.fill(fore);
      ctx.restore();
    },
  };

  return { back, front };
}
