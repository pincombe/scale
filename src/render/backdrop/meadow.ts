// The Meadow backdrop (WP 1.1, 1.12): a painted golden-hour valley. Moved out of index.ts
// unchanged for the tier-aware backdrop (WP 2.3); index.ts dispatches to it in tier 0.
//
//   back   dithered sky, drifting cloud banks lit from below, the low sun with layered bloom and
//          slowly turning god rays, five parallax silhouette layers (mountains, the wyrm hill with
//          its eye, windmill hills, tree line + village, near hills) with atmospheric perspective
//          and backlit rims, valley mist, birds, far fireflies and the grassy ground at y = 0.
//   front  near fireflies, pollen and seeds, and the foreground grass frame.
//
// Caching: the sky, sun and clouds are baked per viewport; each silhouette layer is baked at a
// zoom bucket (re-baked, at most one per frame, when the camera zoom drifts > ~30% or pans past
// the baked slack), so a frame is mostly drawImage calls. Everything animated is small. While
// the host is frozen (the zoom flies the camera) nothing re-bakes: layers draw scaled.
import type { View } from '../types';
import type { Palette } from '../palette';
import type { BackdropHost, TierBackdrop } from './tier';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { vec2, rect, type Vec2 } from '../../lib/vec';
import { hash2f } from '../../lib/math';
import { SAFE_MARGIN } from '../world';
import { bakeClouds, bakeGlow, bakeRays, bakeSky, bakeSun, SUN_SPRITE_R, type CloudBank } from './sky';
import { HILLS, MOUNTAINS, RIDGES, RidgeCache, TREELINE, WINDMILL_TOWER, WINDMILL_X, WINDOWS, type Light } from './ridges';
import { Ground } from './ground';
import { Foreground } from './foreground';
import { Ambient } from './ambient';
import { drawSails, drawWindows } from './props';
import { createEyeSchedule, eyeClosed, eyePose, stepEyeSchedule, EYE_CRACK_T, EYE_DURATION, EYE_WIDE_T, type EyePose } from './eyeTimeline';
import { WyrmEye } from './eye';
import { EYE_H, EYE_X } from './wyrm';
import { breeze, gust } from './wind';

const STARS = 46;
/** Silhouette layer unit as a fraction of the view height. */
const LAYER_UNIT = 1 / 9;
/** Clouds are soft: baked at this DPR at most (memory). */
const CLOUD_DPR = 1.25;
const RESIZE_SETTLE_MS = 220;

/** The sun sits this many viewport heights right of the stage center. */
export const SUN_DX = 0.27;

interface SkyArt {
  palette: Palette;
  w: number;
  h: number;
  dpr: number;
  sky: HTMLCanvasElement;
  /** Sky canvas is this much wider than the view; the baked glow sits at sunX0 (panel closed). */
  extra: number;
  sunX0: number;
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

export function createMeadow(host: BackdropHost): TierBackdrop {
  const scene = host.scene;
  const stats = host.stats;
  const caches = RIDGES.map((d) => new RidgeCache(d));
  const cacheOf = (name: string): RidgeCache => caches.find((c) => c.def.name === name)!;
  const mountains = cacheOf(MOUNTAINS.name);
  const hills = cacheOf(HILLS.name);
  const treeline = cacheOf(TREELINE.name);
  const ground = new Ground();
  const fg = new Foreground();
  const ambient = new Ambient();
  let rays: HTMLCanvasElement | null = null;
  let amberGlow: HTMLCanvasElement | null = null;
  let warmGlow: HTMLCanvasElement | null = null;
  const eye = new WyrmEye();
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
  const clearA: Vec2 = vec2();
  const clearR = rect();
  const light: Light = { x: 0, y: 0 };
  const pose: EyePose = { open: 0, look: 0, pupil: 0.4, glow: 0, awake: 0 };
  const schedule = createEyeSchedule();
  let eyeT = -1;
  let millAngle = 0.3;
  let pendW = 0;
  let pendH = 0;
  let pendSince = 0;

  const ensureSky = (view: View): SkyArt => {
    const p = view.palette;
    const s = sky;
    const w = view.width;
    const h = view.height;
    if (s && s.palette === p) {
      if (s.w === w && s.h === h && s.dpr === view.dpr) return s;
      // Debounce: while the window is being dragged, keep drawing the old sky (stretched).
      const now = performance.now();
      if (pendW !== w || pendH !== h) {
        pendW = w;
        pendH = h;
        pendSince = now;
      }
      if (now - pendSince < RESIZE_SETTLE_MS) return s;
    }
    const extra = Math.ceil(w * 0.4);
    const sunX0 = w * 0.5 + SUN_DX * h;
    const G = p.sun.glowRadius * h;
    const art: SkyArt = {
      palette: p,
      w,
      h,
      dpr: view.dpr,
      sky: bakeSky(p, w, h, { x: sunX0, y: p.sun.y * h, r: G, a: 0.5, band: 0.32 }, extra),
      extra,
      sunX0,
      sun: bakeSun(p, p.sun.radius * h, view.dpr),
      sunGlow: bakeGlow(p.sun.glow, 256),
      clouds: bakeClouds(p, w, h, Math.min(view.dpr, CLOUD_DPR)),
      mist: bakeMist(mixHex(p.haze, p.sun.glow, 0.25)),
      birdColor: mixHex(p.silhouette, p.depthTint ?? p.haze, 0.3),
    };
    sky = art;
    return art;
  };

  const ensureSprites = (): void => {
    if (!rays) {
      rays = bakeRays(7);
      amberGlow = bakeGlow('#ffa22a', 128);
      warmGlow = bakeGlow('#ffc766', 64);
    }
    if (flyGlow) return;
    const atlas = scene.atlas;
    const sp = scene.sprites;
    const p = scene.palette;
    flyGlow = atlas.canvas(atlas.tint(sp.glow, mixHex(p.ambient, '#c9ff5c', 0.45)));
    flyCore = atlas.canvas(atlas.tint(sp.ember, mixHex(p.ambient, '#f4ffc0', 0.5)));
    moteCore = atlas.canvas(atlas.tint(sp.ember, p.ambient));
    puffGlow = atlas.canvas(atlas.tint(sp.glow, p.rim));
  };

  /** Screen position of the sun for this view. */
  const sunPos = (view: View, out: Vec2): Vec2 => {
    const cam = view.camera;
    cam.parallaxToScreen(0, cam.refX, 0, out);
    out.x += SUN_DX * view.height;
    out.y += (view.palette.sun.y - cam.anchorFrac) * view.height;
    return out;
  };

  // Layer units: silhouette layers are authored in units of 1/9 of the view height (the original
  // base framing, where a unit was a meter), anchored so u = -0.5 sits under the stage center at
  // the reference framing. Mapping u -> the camera's parallax meters L = refX + f (u + 0.5) keeps
  // the backdrop's composition fixed on screen whatever base framing the director picks.
  const unitF = (view: View): number => (view.height * LAYER_UNIT) / view.camera.refZoom;

  /** Layer point (u, v) at depth p -> screen. */
  const layerToScreen = (view: View, p: number, u: number, v: number, out: Vec2): Vec2 => {
    const cam = view.camera;
    const f = unitF(view);
    return cam.parallaxToScreen(p, cam.refX + f * (u + 0.5), f * v, out);
  };

  /** Multiply the layer transform (layer units) for depth p onto ctx. */
  const applyLayer = (ctx: CanvasRenderingContext2D, view: View, p: number): void => {
    const cam = view.camera;
    const f = unitF(view);
    cam.applyParallax(ctx, p);
    ctx.translate(cam.refX + 0.5 * f, 0);
    ctx.scale(f, f);
  };

  /** CSS px per layer unit at depth p (incl. punch). */
  const layerZoom = (view: View, p: number): number => view.camera.parallaxZoom(p) * unitF(view);

  /** Visible layer-x range at depth p (ignores roll; the slack covers it). Writes tmp.x/.y. */
  const layerRange = (view: View, p: number, out: Vec2): Vec2 => {
    layerToScreen(view, p, 0, 0, origin);
    const z = layerZoom(view, p);
    const m = SAFE_MARGIN + 48;
    out.x = (-m - origin.x) / z;
    out.y = (view.width + m - origin.x) / z;
    return out;
  };

  /** Sun position in layer-p meters (writes `light`); call layerRange for p first (origin). */
  const lightIn = (view: View, p: number): Light => {
    const z = layerZoom(view, p);
    sunPos(view, sun);
    light.x = (sun.x - origin.x) / z;
    light.y = (sun.y - origin.y) / z;
    return light;
  };

  const bakeCache = (c: RidgeCache, view: View, zBase: number, x0: number, x1: number): void => {
    const t0 = performance.now();
    c.bake(view.palette, zBase, x0, x1, view.dpr, light);
    stats.bakes++;
    stats.bakeMsMax = Math.max(stats.bakeMsMax, performance.now() - t0);
  };

  const openEye = (): void => {
    if (eyeT < 0) {
      eyeT = 0.0001;
      host.eyeOpened();
    }
  };

  /** The lids move: stones and dust shake loose, the ground trembles, birds lift off the skull. */
  const wake = (view: View, amount: number, trauma: number): void => {
    eye.crumble(amount);
    view.camera.addTrauma(trauma);
    if (amount < 1) {
      layerToScreen(view, MOUNTAINS.p, EYE_X + 0.75, -EYE_H - 0.72, tmp);
      ambient.birdsFrom(tmp.x, tmp.y, view.height);
    }
  };

  const drawRidge = (ctx: CanvasRenderingContext2D, view: View, c: RidgeCache): void => {
    const cam = view.camera;
    const p = c.def.p;
    layerRange(view, p, tmp);
    ctx.save();
    applyLayer(ctx, view, p);
    if (!c.covers(tmp.x, tmp.y) || c.palette !== view.palette) {
      // A foreign view (M2 snapshot) outside the cache: bake would mutate, so fall back to a
      // flat vector fill of the silhouette.
      ctx.fillStyle = c.crest;
      const step = 2 / layerZoom(view, p);
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
      drawWindows(ctx, WINDOWS, TREELINE, warmGlow!, view.time);
    } else if (c === mountains && (eyeT >= 0 || eye.busy) && c.palette === view.palette && eye.bakedFor(view.palette)) {
      // (A view with another palette, e.g. M2's blended snapshot, skips the eye: draw never bakes.)
      eyePose(eyeT, pose);
      // Look toward the fight (stage center, a little above the ground line).
      layerToScreen(view, p, EYE_X, -EYE_H, origin);
      const dx = cam.stageCX - origin.x;
      const dy = cam.anchorFrac * view.height - view.height * 0.08 - origin.y;
      const l = Math.hypot(dx, dy) || 1;
      const e0 = performance.now();
      eye.draw(ctx, pose, c.bakeZ * c.dpr, dx / l, dy / l, amberGlow!, view.time);
      if (isMain(view)) stats.eyeMs = stats.eyeMs * 0.95 + (performance.now() - e0) * 0.05;
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

  const back = {
    // No resize hook: caches re-bake from need() (coverage/zoom/dpr), the sky is debounced.
    update(view: View) {
      const frozen = host.frozen();
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
        const zBase = unitF(view) * cam.refZoom * Math.pow(cam.zoom / cam.refZoom, p);
        lightIn(view, p);
        const need = c.need(zBase, tmp.x, tmp.y, view.dpr, view.palette, light.x);
        // Frozen (the zoom flies the camera): only a missing or foreign-palette cache bakes.
        if (need > 0 && frozen && c.canvas && c.palette === view.palette) continue;
        if (need === 2 || (need === 1 && optional)) {
          if (need === 1) optional = false;
          bakeCache(c, view, zBase, tmp.x, tmp.y);
        }
      }
      // The eye's palette art is baked up front, so its first opening doesn't hitch.
      if (mountains.palette) eye.ensure(mountains.palette, mountains);
      // Windmill: sails spin with the breeze.
      const t = view.time;
      millAngle += view.dt * (0.45 + 0.9 * breeze(t) + 0.5 * gust(WINDMILL_X * 3, t));
      // The eye.
      if (stepEyeSchedule(schedule, view.state, t, eyeT >= 0)) openEye();
      if (eyeT >= 0) {
        const prev = eyeT;
        eyeT += view.dt;
        if (prev < EYE_CRACK_T && eyeT >= EYE_CRACK_T) wake(view, 0.6, 0.22);
        if (prev < EYE_WIDE_T && eyeT >= EYE_WIDE_T) wake(view, 1, 0.26);
        if (eyeT > EYE_DURATION) {
          eyeT = -1;
          eyeClosed(schedule, t, Math.random());
        }
      }
      eye.update(view.dt, breeze(t));
      cam.worldToScreen(cam.refX, 0, tmp);
      cam.parallaxToScreen(0, cam.refX, 0, anchor);
      ambient.update(view, anchor.x, anchor.y, tmp.x);
    },
    draw(ctx: CanvasRenderingContext2D, view: View) {
      ensureSprites();
      const art = ensureSkyForDraw(view);
      const W = view.width;
      const H = view.height;
      const t = view.time;
      const pal = view.palette;
      // Sky (with the sun's glow baked in, slid to follow the stage center), and the first stars.
      sunPos(view, sun);
      let sx = art.sunX0 - sun.x * (art.w / W);
      sx = sx < 0 ? 0 : sx > art.extra ? art.extra : sx;
      ctx.drawImage(art.sky, sx, 0, art.w, art.h, 0, 0, W, H);
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
      // Sun: god rays (clipped above the ridges, where they show), then the disc.
      const breath = 1 + 0.04 * Math.sin(t * 0.6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, sun.y + H * 0.08);
      ctx.clip();
      ctx.translate(sun.x, sun.y);
      const R = H * 1.2;
      ctx.rotate(t * 0.011);
      ctx.globalAlpha = 0.1 * breath;
      ctx.drawImage(rays!, -R, -R, R * 2, R * 2);
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
    },
  };

  const isMain = (view: View): boolean => host.isMain(view);
  const ensureSkyForDraw = (view: View): SkyArt =>
    // A foreign view (M2 snapshot) reuses the cached sky; only a missing one is baked here.
    sky && sky.palette === view.palette ? sky : ensureSky(view);

  const front = {
    draw(ctx: CanvasRenderingContext2D, view: View) {
      if (!flyGlow) return;
      ambient.drawFlies(ctx, flyGlow, flyCore!, 1.1, 99);
      ambient.drawMotes(ctx, moteCore!);
      // Stage clearing: from just left of the hero to the dragon's right edge (read lazily).
      const cam = view.camera;
      scene.crowd.heroPoint(clearA);
      scene.dragon.bounds(clearR);
      cam.worldToScreen(Math.min(clearA.x - 0.6, clearR.x), 0, clearA);
      const c0 = clearA.x;
      const groundY = clearA.y;
      cam.worldToScreen(clearR.x + clearR.w, 0, clearA);
      const toes = Math.min(10, Math.max(2, 0.06 * clearR.h * cam.zoomEff));
      fg.draw(ctx, view, puffGlow!, c0, clearA.x, groundY, toes);
    },
  };

  const cv = (c: HTMLCanvasElement | null): number => (c ? c.width * c.height * 4 : 0);
  const zero = (c: HTMLCanvasElement | null): void => {
    if (c) c.width = c.height = 0;
  };

  return {
    update: back.update,
    drawBack: back.draw,
    drawFront: front.draw,
    sunPoint: (view: View, out: Vec2) => sunPos(view, out),
    openEye,
    birds: () => ambient.birds(scene.camera.viewW, scene.camera.viewH),
    eyeState: () => (eyeT < 0 ? 'shut' : `${eyeT.toFixed(1)} s, ${stats.eyeMs.toFixed(3)} ms`),
    bytes() {
      let b = ground.bytes() + fg.bytes() + eye.bytes();
      for (let i = 0; i < caches.length; i++) b += caches[i]!.bytes();
      b += cv(rays) + cv(amberGlow) + cv(warmGlow);
      if (sky) {
        b += cv(sky.sky) + cv(sky.sun) + cv(sky.sunGlow) + cv(sky.mist);
        for (const cl of sky.clouds) b += cv(cl.canvas);
      }
      return b;
    },
    freeStep(i: number): boolean {
      // One small piece per call: the backdrop spreads a tier's release over frames.
      if (i === 0) {
        if (sky) {
          zero(sky.sky);
          zero(sky.sun);
          zero(sky.sunGlow);
          zero(sky.mist);
          for (const cl of sky.clouds) zero(cl.canvas);
          sky = null;
        }
      } else if (i === 1) {
        zero(rays);
        zero(amberGlow);
        zero(warmGlow);
        rays = amberGlow = warmGlow = null;
        // Atlas tints are shared and small: drop the references only.
        flyGlow = flyCore = moteCore = puffGlow = null;
      } else if (i < 2 + caches.length) caches[i - 2]!.free();
      else if (i === 2 + caches.length) ground.free();
      else if (i === 3 + caches.length) fg.free();
      else eye.dispose();
      return i >= 4 + caches.length;
    },
    free() {
      for (let i = 0; !this.freeStep(i); i++);
    },
  };
}
