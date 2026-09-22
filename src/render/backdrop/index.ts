// The Meadow backdrop (WP 1.1): a painted golden-hour valley.
//
//   backdrop.back  (slot 0): dithered sky, drifting cloud banks lit from below, the low sun with
//                  layered bloom and slowly turning god rays, five parallax silhouette layers
//                  (mountains, the wyrm hill with its eye, windmill hills, tree line + village,
//                  near hills) with atmospheric perspective and backlit rims, valley mist, birds,
//                  far fireflies and the grassy battlefield ground at y = 0.
//   backdrop.front (slot 4): near fireflies, pollen and seeds, and the foreground grass frame.
//
// Caching: the sky, sun and clouds are baked per viewport; each silhouette layer is baked at a
// zoom bucket (re-baked, at most one per frame, when the camera zoom drifts > ~30% or pans past
// the baked slack), so a frame is mostly drawImage calls. Everything animated is small.
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { Palette } from '../palette';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { rect, vec2, type Vec2 } from '../../lib/vec';
import { hash2f } from '../../lib/math';
import { SAFE_MARGIN } from '../world';
import { bakeClouds, bakeGlow, bakeRays, bakeSky, bakeSun, SUN_SPRITE_R, type CloudBank } from './sky';
import { FAR_HILLS, HILLS, RIDGES, RidgeCache, TREELINE, WINDMILL_TOWER, WINDMILL_X, WINDOWS, WYRM_EYE_X, type Light } from './ridges';
import { Ground } from './ground';
import { Foreground } from './foreground';
import { Ambient } from './ambient';
import { drawEye, drawSails, drawWindows, makeIris, type EyeArt } from './props';
import { createEyeSchedule, eyeClosed, eyePose, stepEyeSchedule, EYE_DURATION, type EyePose } from './eyeTimeline';
import { breeze, gust } from './wind';

export interface Backdrop {
  back: Layer;
  front: Layer;
  /** Open the eye in the hills now (no-op while it is already open). */
  openEye(): void;
  /** Send a flock of birds across the sky now. */
  birds(): void;
  /** Rolling CPU cost of the two layers' draw() (ms, main view), and silhouette re-bakes. */
  readonly stats: { backMs: number; frontMs: number; bakes: number; bakeMsMax: number };
}

const STARS = 46;

/** The sun sits this many viewport heights right of the stage center. */
export const SUN_DX = 0.27;

interface SkyArt {
  palette: Palette;
  w: number;
  h: number;
  dpr: number;
  sky: HTMLCanvasElement;
  sun: HTMLCanvasElement;
  sunGlow: HTMLCanvasElement;
  clouds: CloudBank[];
  mist: HTMLCanvasElement;
  birdColor: string;
}

function bakeMist(color: string): HTMLCanvasElement {
  const c = makeCanvas(2, 128);
  const ctx = context2d(c);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.55, rgba(color, 0.55));
  g.addColorStop(0.8, rgba(color, 0.4));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 128);
  return c;
}

export function createBackdrop(scene: Scene): Backdrop {
  const caches = RIDGES.map((d) => new RidgeCache(d));
  const cacheOf = (name: string): RidgeCache => caches.find((c) => c.def.name === name)!;
  const farHills = cacheOf(FAR_HILLS.name);
  const hills = cacheOf(HILLS.name);
  const treeline = cacheOf(TREELINE.name);
  const ground = new Ground();
  const fg = new Foreground();
  const ambient = new Ambient();
  const rays = bakeRays(7);
  const amberGlow = bakeGlow('#ffa22a', 128);
  const warmGlow = bakeGlow('#ffc766', 64);
  let eyeArt: EyeArt | null = null;
  let sky: SkyArt | null = null;
  let flyGlow: HTMLCanvasElement | null = null;
  let flyCore: HTMLCanvasElement | null = null;
  let moteCore: HTMLCanvasElement | null = null;
  let puffGlow: HTMLCanvasElement | null = null;

  const sun: Vec2 = vec2();
  const anchor: Vec2 = vec2();
  const origin: Vec2 = vec2();
  const tmp: Vec2 = vec2();
  const vis = rect();
  const light: Light = { x: 0, y: 0 };
  const pose: EyePose = { open: 0, look: 0, pupil: 0.4, glow: 0 };
  const schedule = createEyeSchedule();
  let eyeT = -1;
  let millAngle = 0.3;
  const stats = { backMs: 0, frontMs: 0, bakes: 0, bakeMsMax: 0 };

  const ensureSky = (view: View): SkyArt => {
    const p = view.palette;
    const s = sky;
    if (s && s.palette === p && s.w === view.width && s.h === view.height && s.dpr === view.dpr) return s;
    const h = view.height;
    const art: SkyArt = {
      palette: p,
      w: view.width,
      h,
      dpr: view.dpr,
      sky: bakeSky(p, view.width, h),
      sun: bakeSun(p, p.sun.radius * h, view.dpr),
      sunGlow: bakeGlow(p.sun.glow, 256),
      clouds: bakeClouds(p, view.width, h, view.dpr),
      mist: bakeMist(mixHex(p.haze, p.sun.glow, 0.25)),
      birdColor: mixHex(p.silhouette, p.depthTint ?? p.haze, 0.3),
    };
    sky = art;
    return art;
  };

  const ensureSprites = (): void => {
    if (flyGlow) return;
    const atlas = scene.atlas;
    const sp = scene.sprites;
    const p = scene.palette;
    flyGlow = atlas.canvas(atlas.tint(sp.glow, mixHex(p.ambient, '#c9ff5c', 0.45)));
    flyCore = atlas.canvas(atlas.tint(sp.ember, mixHex(p.ambient, '#f4ffc0', 0.5)));
    moteCore = atlas.canvas(atlas.tint(sp.ember, p.ambient));
    puffGlow = atlas.canvas(atlas.tint(sp.glow, p.rim));
    const c = makeCanvas(1, 1);
    eyeArt = { glow: amberGlow, iris: makeIris(context2d(c)) };
  };

  /** Screen position of the sun for this view. */
  const sunPos = (view: View, out: Vec2): Vec2 => {
    const cam = view.camera;
    cam.parallaxToScreen(0, cam.refX, 0, out);
    out.x += SUN_DX * view.height;
    out.y += (view.palette.sun.y - cam.anchorFrac) * view.height;
    return out;
  };

  /** Visible layer-x range at depth p (ignores roll; the slack covers it). Writes tmp.x/.y. */
  const layerRange = (view: View, p: number, out: Vec2): Vec2 => {
    const cam = view.camera;
    cam.parallaxToScreen(p, 0, 0, origin);
    const z = cam.parallaxZoom(p);
    const m = SAFE_MARGIN + 48;
    out.x = (-m - origin.x) / z;
    out.y = (view.width + m - origin.x) / z;
    return out;
  };

  const bakeCache = (c: RidgeCache, view: View, zBase: number, x0: number, x1: number): void => {
    const cam = view.camera;
    const p = c.def.p;
    sunPos(view, sun);
    cam.parallaxToScreen(p, 0, 0, origin);
    const z = cam.parallaxZoom(p);
    light.x = (sun.x - origin.x) / z;
    light.y = (sun.y - origin.y) / z;
    const t0 = performance.now();
    c.bake(view.palette, zBase, x0, x1, view.dpr, light);
    stats.bakes++;
    stats.bakeMsMax = Math.max(stats.bakeMsMax, performance.now() - t0);
  };

  const openEye = (): void => {
    if (eyeT < 0) eyeT = 0.0001;
  };

  const drawRidge = (ctx: CanvasRenderingContext2D, view: View, c: RidgeCache): void => {
    const cam = view.camera;
    const p = c.def.p;
    layerRange(view, p, tmp);
    ctx.save();
    cam.applyParallax(ctx, p);
    if (!c.covers(tmp.x, tmp.y) || c.palette !== view.palette) {
      // A foreign view (M2 snapshot) outside the cache: bake would mutate, so fall back to a
      // flat vector fill of the silhouette.
      ctx.fillStyle = c.crest;
      const step = 2 / cam.parallaxZoom(p);
      ctx.beginPath();
      ctx.moveTo(tmp.x, 2);
      for (let x = tmp.x; x < tmp.y; x += step) ctx.lineTo(x, -c.def.height(x));
      ctx.lineTo(tmp.y, 2);
      ctx.fill();
    } else {
      c.blit(ctx);
    }
    // Per-layer animated props, in the same coordinates.
    if (c === hills) {
      const hx = WINDMILL_X + 0.012;
      const hy = -HILLS.height(WINDMILL_X) - WINDMILL_TOWER + 0.03;
      ctx.shadowColor = rgba(c.rimColor, 0.7);
      ctx.shadowOffsetX = view.palette.light.x * 1.1;
      ctx.shadowOffsetY = view.palette.light.y * 1.1;
      drawSails(ctx, hx, hy, millAngle, c.crest);
      ctx.shadowColor = 'rgba(0,0,0,0)';
    } else if (c === treeline) {
      drawWindows(ctx, WINDOWS, TREELINE, warmGlow, view.time);
    } else if (c === farHills && eyeT >= 0 && eyeArt) {
      eyePose(eyeT, pose);
      const ex = WYRM_EYE_X;
      const ey = -FAR_HILLS.height(WYRM_EYE_X) + 0.34;
      // Look toward the fight (stage center, a little above the ground line).
      cam.parallaxToScreen(p, ex, ey, origin);
      const dx = cam.stageCX - origin.x;
      const dy = cam.anchorFrac * view.height - view.height * 0.08 - origin.y;
      const l = Math.hypot(dx, dy) || 1;
      drawEye(ctx, pose, ex, ey, dx / l, dy / l, eyeArt, c.crest, view.time);
    }
    ctx.restore();
  };

  const drawMist = (ctx: CanvasRenderingContext2D, view: View, art: SkyArt, above: number, below: number, alpha: number): void => {
    const cam = view.camera;
    cam.parallaxToScreen(0.5, 0, 0, anchor);
    const h = view.height;
    ctx.globalAlpha = alpha;
    ctx.drawImage(art.mist, -SAFE_MARGIN, anchor.y - above * h, view.width + SAFE_MARGIN * 2, (above + below) * h);
    ctx.globalAlpha = 1;
  };

  const back: Layer = {
    name: 'backdrop.back',
    visible: true,
    resize() {
      for (const c of caches) c.invalidate();
    },
    update(view: View) {
      ensureSprites();
      ensureSky(view);
      const cam = view.camera;
      ground.bake(view.palette, cam.refZoom, view.dpr);
      // Silhouette caches: re-bake what must be, plus at most one optional (resolution) bake.
      let optional = true;
      for (let i = 0; i < caches.length; i++) {
        const c = caches[i]!;
        const p = c.def.p;
        layerRange(view, p, tmp);
        const zBase = cam.refZoom * Math.pow(cam.zoom / cam.refZoom, p);
        const need = c.need(zBase, tmp.x, tmp.y, view.dpr, view.palette);
        if (need === 2 || (need === 1 && optional)) {
          if (need === 1) optional = false;
          bakeCache(c, view, zBase, tmp.x, tmp.y);
        }
      }
      // Windmill: sails spin with the breeze.
      const t = view.time;
      millAngle += view.dt * (0.45 + 0.9 * breeze(t) + 0.5 * gust(WINDMILL_X * 3, t));
      // The eye.
      if (stepEyeSchedule(schedule, view.state.kills, t, eyeT >= 0)) openEye();
      if (eyeT >= 0) {
        eyeT += view.dt;
        if (eyeT > EYE_DURATION) {
          eyeT = -1;
          eyeClosed(schedule, t, Math.random());
        }
      }
      cam.worldToScreen(cam.refX, 0, tmp);
      cam.parallaxToScreen(0, cam.refX, 0, anchor);
      ambient.update(view, anchor.x, anchor.y, tmp.x);
    },
    draw(ctx: CanvasRenderingContext2D, view: View) {
      const t0 = performance.now();
      ensureSprites();
      const art = ensureSkyForDraw(view);
      const W = view.width;
      const H = view.height;
      const t = view.time;
      const pal = view.palette;
      // Sky, and the first stars of dusk overhead.
      ctx.drawImage(art.sky, 0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < STARS; i++) {
        const fy = hash2f(i, 92);
        const y = fy * fy * H * 0.34;
        const x = hash2f(i, 91) * W;
        const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + hash2f(i, 93) * 2.2) + i * 1.7);
        const big = hash2f(i, 94);
        ctx.globalAlpha = (1 - y / (H * 0.34)) * (0.3 + 0.6 * big) * tw;
        const r = 1.1 + 2.2 * big * big;
        ctx.drawImage(moteCore!, x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < art.clouds.length; i++) {
        const b = art.clouds[i]!;
        const period = W + b.w;
        let x = (b.x0 + t * b.speed) % period;
        if (x < 0) x += period;
        ctx.drawImage(b.canvas, x - b.w, b.y, b.w, b.h);
      }
      // Sun: glow, horizon band, rays, disc.
      sunPos(view, sun);
      const G = pal.sun.glowRadius * H;
      const breath = 1 + 0.04 * Math.sin(t * 0.6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 * breath;
      ctx.drawImage(art.sunGlow, sun.x - G, sun.y - G, G * 2, G * 2);
      ctx.globalAlpha = 0.32;
      ctx.drawImage(art.sunGlow, sun.x - G * 2.4, sun.y - G * 0.32, G * 4.8, G * 0.64);
      ctx.save();
      ctx.translate(sun.x, sun.y);
      const R = H * 1.2;
      ctx.rotate(t * 0.011);
      ctx.globalAlpha = 0.085 * breath;
      ctx.drawImage(rays, -R, -R, R * 2, R * 2);
      ctx.rotate(-t * 0.026 + 1.3);
      ctx.globalAlpha = 0.06;
      ctx.drawImage(rays, -R * 0.8, -R * 0.8, R * 1.6, R * 1.6);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const sr = pal.sun.radius * H * SUN_SPRITE_R;
      ctx.drawImage(art.sun, sun.x - sr, sun.y - sr, sr * 2, sr * 2);

      // Far land
      drawRidge(ctx, view, caches[0]!);
      drawRidge(ctx, view, caches[1]!);
      // Bloom washing over the far ridges around the sun.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3 * breath;
      const B = H * 0.3;
      ctx.drawImage(art.sunGlow, sun.x - B, sun.y - B, B * 2, B * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ambient.drawBirds(ctx, art.birdColor, t);
      drawRidge(ctx, view, caches[2]!);
      drawMist(ctx, view, art, 0.13, 0.02, 0.55);
      drawRidge(ctx, view, caches[3]!);
      drawMist(ctx, view, art, 0.06, 0.01, 0.4);
      ambient.drawFlies(ctx, flyGlow!, flyCore!, 0, 0.8);
      drawRidge(ctx, view, caches[4]!);
      ambient.drawFlies(ctx, flyGlow!, flyCore!, 0.8, 1.1);

      // Battlefield ground
      const cam = view.camera;
      cam.visibleRect(vis, SAFE_MARGIN);
      const shear = 0.05 + 0.1 * (breeze(t) + gust(cam.x, t));
      ground.draw(ctx, view, vis, shear, sun.x, art.sunGlow);

      if (isMain(view)) stats.backMs = stats.backMs * 0.97 + (performance.now() - t0) * 0.03;
    },
  };

  const isMain = (view: View): boolean => view === scene.renderer.view;
  const ensureSkyForDraw = (view: View): SkyArt =>
    // A foreign view (M2 snapshot) reuses the cached sky; only a missing one is baked here.
    sky && sky.palette === view.palette ? sky : ensureSky(view);

  const front: Layer = {
    name: 'backdrop.front',
    visible: true,
    draw(ctx: CanvasRenderingContext2D, view: View) {
      const t0 = performance.now();
      if (!flyGlow) return;
      ambient.drawFlies(ctx, flyGlow, flyCore!, 1.1, 99);
      ambient.drawMotes(ctx, moteCore!);
      fg.draw(ctx, view, puffGlow!);
      if (isMain(view)) stats.frontMs = stats.frontMs * 0.97 + (performance.now() - t0) * 0.03;
    },
  };

  const api: Backdrop = {
    back,
    front,
    openEye,
    birds: () => ambient.birds(scene.camera.viewW, scene.camera.viewH),
    stats,
  };

  const dbg = scene.debug;
  dbg.section('backdrop');
  dbg.button('open eye', openEye, 'y');
  dbg.button('birds', api.birds);
  dbg.watch('backdrop ms', () => `${stats.backMs.toFixed(2)} + ${stats.frontMs.toFixed(2)}`);
  if (dbg.enabled) Object.assign(window, { __backdrop: api });

  return api;
}
