// The Mountain backdrop (WP 2.3): alpenglow dusk on the back of the world wyrm.
//
//   back   the dithered dusk sky with the afterglow band baked in, the first stars and the
//          evening star, high cirrus catching the last light, faint crepuscular rays; the far
//          coils (serpent humps in the horizon's cloud) with the afterglow washing over them;
//          the world wyrm's head behind the saddle; the range (its spine: dorsal plates as snowy
//          peaks in alpenglow); a sea of cloud; forested slopes with a speck of a castle; a lower
//          cloud bank at the ridge line; the hide we stand on; wisps at the army's knees; eagles.
//   front  a few wisps in front of the army, wind-blown snow, and the nearest scales of the
//          wyrm's back framing the bottom edge.
//
// Caching as the Meadow: sky per viewport, silhouettes per zoom bucket (layers never re-bake
// while the zoom flies the camera: they draw scaled, baking only what is missing, for the
// director's home framing). At most one heavy bake per frame: until a layer's first bake lands
// it draws as a flat vector silhouette (under the zoom's cover, or a debug tier jump).
import type { View } from '../types';
import type { Palette } from '../palette';
import type { WyrmPose } from './api';
import type { BackdropHost, TierBackdrop } from './tier';
import { Camera } from '../camera';
import { context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { rect, vec2, type Vec2 } from '../../lib/vec';
import { clamp01, hash2f, smoothstep } from '../../lib/math';
import { SAFE_MARGIN } from '../world';
import { bakeClouds, bakeGlow, bakeRays, SkyBaker, type CloudBank, type CloudSpec, type SkyGlow } from './sky';
import { RidgeCache, type Light } from './ridges';
import { CASTLE_X, FAR_COIL, SLOPES, SPINE, slopesHeight } from './mountainRidges';
import { CloudSea } from './cloudSea';
import { MountainGround } from './mountainGround';
import { drawMarkedScale, hideScaleShape, scaleShape, type ScaleShape } from './hide';
import { MOUNTAIN } from '../palette';
import { Snow, Wisps } from './mountainAmbient';
import { MountainForeground } from './mountainForeground';
import { Flock } from './ambient';
import { REST_BOX_H0, REST_BOX_H1, REST_BOX_X0, REST_BOX_X1, WorldWyrm } from './worldWyrm';
import { createWyrmIdle, exhale, followPose, idlePose, resetWyrmIdle, stepWyrmIdle, WAKE_MIN_GAP, type WyrmIdleEvents } from './wyrmSchedule';
import { applyLayer, homeFraming, layerRange, layerToScreen, layerZoom, unitF } from './layerSpace';
import { breeze } from './wind';

/** The afterglow sits this many view heights right of the stage center (y: palette.sun.y). */
export const GLOW_DX = 0.14;
const STARS = 110;
/** Stars brighter than this twinkle live; the rest are baked into the sky. */
const STAR_LIVE = 0.62;
const STAR_BAND = 0.5;
const RESIZE_SETTLE_MS = 220;
/** High cirrus: thin streaks catching the last light. */
const CIRRUS: readonly CloudSpec[] = [
  { y: 0.16, w: 1.3, thick: 0.034, speed: 0.0026, x: 0.05, seed: 29, streak: 0.62, lit: 0.45 },
  { y: 0.31, w: 0.8, thick: 0.03, speed: 0.004, x: 0.62, seed: 31, streak: 0.55, lit: 0.85 },
];

interface SkyArt {
  palette: Palette;
  w: number;
  h: number;
  dpr: number;
  sky: HTMLCanvasElement;
  extra: number;
  glowX0: number;
  glow: HTMLCanvasElement;
  clouds: CloudBank[];
  birdColor: string;
}

/** Layers the Mountain bakes, in bake priority (the landing first). */
const enum Bake {
  Ground,
  Spine,
  Wyrm,
  Far,
  Slopes,
}

export function createMountain(host: BackdropHost): TierBackdrop & {
  pose(p: WyrmPose | null): void;
  avalanche(): void;
  poseNow(): WyrmPose;
  markScale(mark: { x: number; y: number; picture: HTMLCanvasElement | null; lift?: number } | null): void;
  drawKneeMist(ctx: CanvasRenderingContext2D, view: View): void;
  /** Milliseconds of the prepare pieces baked so far (debug), and the worst one. */
  readonly prepStats: { pieces: number; ms: number; worst: number; worstName: string };
} {
  const scene = host.scene;
  const stats = host.stats;
  const far = new RidgeCache(FAR_COIL);
  const spine = new RidgeCache(SPINE);
  const slopes = new RidgeCache(SLOPES);
  const ridges = [far, spine, slopes];
  const seaHigh = new CloudSea({ top: 1.22, billow: 0.1, depth: 1.0, tile: 17, speed: 0.012, lit: 1, tone: 0.3, floor: 1, seed: 11 });
  const seaFar = new CloudSea({ top: 0.98, billow: 0.05, depth: 0.5, tile: 23, speed: 0.006, lit: 0.8, tone: 0.2, floor: 1, seed: 5 });
  const seaLow = new CloudSea({ top: 0.62, billow: 0.09, depth: 0.8, tile: 13, speed: 0.02, lit: 0.7, tone: 0.55, floor: 0.35, seed: 3 });
  const SEA_FAR_P = 0.05;
  const SEA_HIGH_P = 0.13;
  const SEA_LOW_P = 0.3;
  const ground = new MountainGround();
  const wyrm = new WorldWyrm();
  const snow = new Snow();
  const wisps = new Wisps();
  const fg = new MountainForeground();
  const eagles = new Flock();
  let nextEagles = 14;
  let sky: SkyArt | null = null;
  let rays: HTMLCanvasElement | null = null;
  let amberGlow: HTMLCanvasElement | null = null;
  let flake: HTMLCanvasElement | null = null;
  let spark: HTMLCanvasElement | null = null;
  let pendW = 0;
  let pendH = 0;
  let pendSince = 0;

  // The meadow's scale (the zoom's easter egg): kept faintly warm for the rest of the tier.
  const mark: ScaleShape = scaleShape();
  let marked = false;
  let markPic: HTMLCanvasElement | null = null;
  let markLift = 0;
  // Preparing (the zoom's rally, while the Meadow is still on screen): one piece per frame.
  let prepView: View | null = null;
  const prepStats = { pieces: 0, ms: 0, worst: 0, worstName: '' };

  const home = new Camera();
  const tmp: Vec2 = vec2();
  const origin: Vec2 = vec2();
  const sun: Vec2 = vec2();
  const anchor: Vec2 = vec2();
  const vis = rect();
  const clearA: Vec2 = vec2();
  const clearR = rect();
  const light: Light = { x: 0, y: 0 };

  // The world wyrm's pose: driven by the zoom, or its own idle schedule.
  const idle = createWyrmIdle();
  const ev: WyrmIdleEvents = { exhale: false, eyeOpens: false };
  const cur: WyrmPose = { rise: 0, eye: 0, jaw: 0 };
  const target: WyrmPose = { rise: 0, eye: 0, jaw: 0 };
  const driven: WyrmPose = { rise: 0, eye: 0, jaw: 0 };
  let isDriven = false;
  let wasDriven = false;
  let forceWake = false;
  let eyeArmed = true;
  let roarArmed = true;
  let shedArmed = true;
  /** How far the resting head is sunk behind the saddle (eased), and scratch for the test. */
  let sink = 0;
  const dragonR = rect();
  const headA: Vec2 = vec2();
  const headB: Vec2 = vec2();

  // ---- sky

  const ensureSky = (view: View): SkyArt => {
    const p = view.palette;
    const s = sky;
    const w = view.width;
    const h = view.height;
    if (s && s.palette === p) {
      if (s.w === w && s.h === h && s.dpr === view.dpr) return s;
      const now = performance.now();
      if (pendW !== w || pendH !== h) {
        pendW = w;
        pendH = h;
        pendSince = now;
      }
      if (now - pendSince < RESIZE_SETTLE_MS) return s;
    }
    const b = skyBakerFor(view);
    b.step(Infinity);
    return adoptSky(view, b);
  };

  // The sky gradient is the Mountain's biggest bake (~25 ms): the zoom's rally bakes it a slice per
  // frame (prepare), then adopts it with the small sky art.
  let skyBaker: SkyBaker | null = null;
  let skyBakerPal: Palette | null = null;
  let skyBakerW = 0;
  let skyBakerH = 0;
  const skyGlow: SkyGlow = { x: 0, y: 0, r: 1, a: 0.42, band: 0.62 };
  const skyBakerFor = (view: View): SkyBaker => {
    const p = view.palette;
    const w = view.width;
    const h = view.height;
    if (skyBaker && skyBakerPal === p && skyBakerW === w && skyBakerH === h) return skyBaker;
    skyBakerPal = p;
    skyBakerW = w;
    skyBakerH = h;
    // The afterglow: a soft round glow and a wide band along the horizon.
    skyGlow.x = w * 0.5 + GLOW_DX * h;
    skyGlow.y = p.sun.y * h;
    skyGlow.r = p.sun.glowRadius * h;
    skyBaker = new SkyBaker(p, w, h, skyGlow, Math.ceil(w * 0.4));
    return skyBaker;
  };
  /** The finished gradient, with the rest of the sky art (the glow sprite, cirrus, the dim stars). */
  const adoptSky = (view: View, b: SkyBaker): SkyArt => {
    const p = view.palette;
    const w = view.width;
    const h = view.height;
    const s = sky;
    if (s) {
      s.sky.width = s.sky.height = 0;
      for (const c of s.clouds) c.canvas.width = c.canvas.height = 0;
    }
    const extra = Math.ceil(w * 0.4);
    const art: SkyArt = {
      palette: p,
      w,
      h,
      dpr: view.dpr,
      sky: b.canvas,
      extra,
      glowX0: w * 0.5 + GLOW_DX * h,
      glow: bakeGlow(p.sun.glow, 256),
      clouds: bakeClouds(p, w, h, Math.min(view.dpr, 1.25), CIRRUS),
      birdColor: mixHex(p.silhouette, p.depthTint ?? p.haze, 0.35),
    };
    bakeStars(art.sky, w, h, extra);
    sky = art;
    skyBaker = null;
    skyBakerPal = null;
    return art;
  };

  /** The dim stars, baked (they barely twinkle at that brightness). */
  const bakeStars = (c: HTMLCanvasElement, w: number, h: number, extra: number): void => {
    const g = context2d(c);
    const band = h * STAR_BAND;
    for (let i = 0; i < STARS; i++) {
      const big = hash2f(i, 194);
      if (big >= STAR_LIVE) continue;
      const fy = hash2f(i, 192);
      const y = fy * fy * band;
      // Spread over the slide margin too (the sky's source window moves with the stage center).
      const x = hash2f(i, 191) * (w + extra);
      const r = 0.6 + 1.2 * big * big;
      g.fillStyle = rgba('#f1ecff', (1 - y / band) * (0.18 + 0.5 * big * big));
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  };

  const ensureSprites = (view: View): void => {
    if (rays) return;
    rays = bakeRays(13, 512, 16);
    amberGlow = bakeGlow('#ffa22a', 128);
    const atlas = scene.atlas;
    flake = atlas.canvas(atlas.tint(scene.sprites.ember, view.palette.ambient));
    spark = atlas.canvas(atlas.tint(scene.sprites.glow, mixHex(view.palette.ambient, '#fff2d8', 0.5)));
  };

  /** Screen position of the afterglow (below the far coils). */
  const glowPos = (view: View, out: Vec2): Vec2 => {
    const cam = view.camera;
    cam.parallaxToScreen(0, cam.refX, 0, out);
    out.x += GLOW_DX * view.height;
    out.y += (view.palette.sun.y - cam.anchorFrac) * view.height;
    return out;
  };

  const lightIn = (view: View, cam: Camera, p: number): Light => {
    // layerRange() for p ran first on this camera (origin).
    const z = layerZoom(cam, view.height, p);
    cam.parallaxToScreen(0, cam.refX, 0, sun);
    sun.x += GLOW_DX * view.height;
    sun.y += (view.palette.sun.y - cam.anchorFrac) * view.height;
    light.x = (sun.x - origin.x) / z;
    light.y = (sun.y - origin.y) / z;
    return light;
  };

  // ---- baking

  const bakeRidge = (c: RidgeCache, view: View, cam: Camera, widen: number): void => {
    const p = c.def.p;
    const H = view.height;
    layerRange(cam, view.width, H, p, tmp, origin);
    const span = tmp.y - tmp.x;
    const x0 = tmp.x - span * widen;
    const x1 = tmp.y + span * widen;
    const zBase = unitF(cam, H) * cam.refZoom * Math.pow(cam.zoom / cam.refZoom, p);
    lightIn(view, cam, p);
    const t0 = performance.now();
    c.bake(view.palette, zBase, x0, x1, view.dpr, light);
    noteBake(c.def.name, t0);
  };

  const noteBake = (name: string, t0: number): void => {
    const ms = performance.now() - t0;
    stats.bakes++;
    if (ms > stats.bakeMsMax) {
      stats.bakeMsMax = ms;
      stats.bakeWorst = name;
    }
  };

  /** Need of a ridge on the live camera (0 fine, 1 resolution, 2 must). */
  const ridgeNeed = (c: RidgeCache, view: View): number => {
    const cam = view.camera;
    const p = c.def.p;
    const H = view.height;
    layerRange(cam, view.width, H, p, tmp, origin);
    const zBase = unitF(cam, H) * cam.refZoom * Math.pow(cam.zoom / cam.refZoom, p);
    lightIn(view, cam, p);
    return c.need(zBase, tmp.x, tmp.y, view.dpr, view.palette, light.x);
  };

  const wyrmK = (view: View): number => {
    const k = layerZoom(view.camera, view.height, SPINE.p);
    const ref = view.height / 9;
    return Math.max(ref, Math.min(k, ref * 1.6)) * Math.min(view.dpr, SPINE.maxDpr ?? 2);
  };

  /** Bakes for this frame: every must-bake first by priority (one heavy one per frame), then
   *  at most one optional one. Frozen: only what is missing, for the home framing. */
  const bakeStep = (view: View): void => {
    const frozen = host.frozen();
    const pal = view.palette;
    const cam = frozen ? homeFraming(home, view.camera, scene.director, view.width, view.height) : view.camera;
    // Small art: always now (cheap).
    seaHigh.ensure(pal, view.height);
    seaFar.ensure(pal, view.height);
    seaLow.ensure(pal, view.height);
    wisps.ensure(pal);
    fg.ensure(pal);
    ground.ensureHaze(pal);
    let optional = -1;
    for (let b = Bake.Ground; b <= Bake.Slopes; b++) {
      let need = 0;
      if (b === Bake.Ground) {
        cam.visibleRect(vis, SAFE_MARGIN);
        if (frozen) need = ground.bakedFor(pal) ? 0 : 2;
        else need = ground.need(pal, cam.zoom, vis, view.dpr);
        if (need === 2) {
          const t0 = performance.now();
          ground.bake(pal, cam.zoom, vis, view.dpr);
          noteBake('hide', t0);
          return;
        }
      } else if (b === Bake.Wyrm) {
        if (!wyrm.ready(pal)) {
          const t0 = performance.now();
          wyrm.ensure(pal, wyrmK(view), '#ffa84a');
          noteBake('wyrm', t0);
          return;
        }
        // A resolution re-bake (window resized): this frame's optional bake.
        if (!frozen && optional < 0 && wyrm.stale(wyrmK(view))) optional = b;
        continue;
      } else {
        const c = b === Bake.Spine ? spine : b === Bake.Far ? far : slopes;
        if (frozen) need = c.canvas && c.palette === pal ? 0 : 2;
        else need = ridgeNeed(c, view);
        if (need === 2) {
          bakeRidge(c, view, cam, frozen ? 0.25 : 0);
          return;
        }
      }
      if (need === 1 && optional < 0) optional = b;
    }
    if (optional < 0 || frozen) return;
    if (optional === Bake.Wyrm) {
      const t0 = performance.now();
      wyrm.ensure(pal, wyrmK(view), '#ffa84a');
      noteBake('wyrm', t0);
    } else if (optional === Bake.Ground) {
      view.camera.visibleRect(vis, SAFE_MARGIN);
      const t0 = performance.now();
      ground.bake(pal, view.camera.zoom, vis, view.dpr);
      noteBake('hide', t0);
    } else {
      const c = optional === Bake.Spine ? spine : optional === Bake.Far ? far : slopes;
      bakeRidge(c, view, view.camera, 0);
    }
  };

  // ---- drawing helpers

  // Flat silhouette colors for layers not baked yet (cached per palette: no per-frame strings).
  let fbPal: Palette | null = null;
  const fbCol = new Map<RidgeCache, string>();
  const fallbackColor = (pal: Palette, c: RidgeCache): string => {
    if (fbPal !== pal) {
      fbPal = pal;
      fbCol.clear();
    }
    let col = fbCol.get(c);
    if (col === undefined) {
      col = mixHex(pal.haze, pal.depthTint ?? pal.haze, c.def.tone);
      fbCol.set(c, col);
    }
    return col;
  };

  const drawRidge = (ctx: CanvasRenderingContext2D, view: View, c: RidgeCache): void => {
    const cam = view.camera;
    const p = c.def.p;
    const H = view.height;
    layerRange(cam, view.width, H, p, tmp, origin);
    ctx.save();
    applyLayer(ctx, cam, H, p);
    if (!c.covers(tmp.x, tmp.y) || c.palette !== view.palette) {
      // Not baked yet (first frames of the tier), or a foreign view: a flat vector silhouette.
      ctx.fillStyle = c.palette === view.palette ? c.crest : fallbackColor(view.palette, c);
      const step = 2 / layerZoom(cam, H, p);
      ctx.beginPath();
      ctx.moveTo(tmp.x, 2);
      for (let x = tmp.x; x < tmp.y; x += step) ctx.lineTo(x, -c.def.height(x));
      ctx.lineTo(tmp.y, 2);
      ctx.fill();
    } else {
      c.blit(ctx);
    }
    ctx.restore();
  };

  const drawSea = (ctx: CanvasRenderingContext2D, view: View, sea: CloudSea, p: number, t: number): void => {
    if (!sea.ready(view.palette)) return;
    const cam = view.camera;
    const H = view.height;
    layerRange(cam, view.width, H, p, tmp, origin);
    ctx.save();
    applyLayer(ctx, cam, H, p);
    sea.draw(ctx, tmp.x, tmp.y, t);
    ctx.restore();
  };

  /** The layer below the lowest cloud bank must reach the ground: fill under a sea's base. */
  const drawSeaFloor = (ctx: CanvasRenderingContext2D, view: View, p: number, below: number, color: string): void => {
    const cam = view.camera;
    layerToScreen(cam, view.height, p, 0, -below, tmp);
    ctx.fillStyle = color;
    ctx.fillRect(-SAFE_MARGIN, tmp.y - 1, view.width + SAFE_MARGIN * 2, view.height - tmp.y + SAFE_MARGIN + 1);
  };

  const castleGlint = (ctx: CanvasRenderingContext2D, view: View, t: number): void => {
    if (!spark) return;
    layerToScreen(view.camera, view.height, SLOPES.p, CASTLE_X - 0.004, -slopesHeight(CASTLE_X) - 0.036, tmp);
    const f = 0.75 + 0.25 * Math.sin(t * 1.7) * Math.sin(t * 3.1 + 1);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * f;
    ctx.drawImage(spark, tmp.x - 5, tmp.y - 5, 10, 10);
    ctx.globalAlpha = 0.9 * f;
    ctx.drawImage(spark, tmp.x - 1.3, tmp.y - 1.3, 2.6, 2.6);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  // ---- the wyrm's life

  /**
   * 0..1: how hidden the resting head should be. It is a foreshadowing element, strongest at the
   * base framing: it sinks behind the saddle as the camera pulls back past it, and whenever a dragon
   * (padded for wings and rearing) covers its place on screen, so its horns never read as spikes
   * on a big dragon's back.
   */
  const sinkTarget = (view: View): number => {
    const cam = view.camera;
    const dir = scene.director;
    const base = (dir.heroFrac * view.height) / 1.8;
    const pulled = smoothstep(1.5, 3.2, base / Math.max(1e-6, cam.zoom));
    // The head's resting box on screen vs the dragon's (rest bounds, padded).
    const H = view.height;
    layerToScreen(cam, H, SPINE.p, REST_BOX_X0, -REST_BOX_H1, headA);
    layerToScreen(cam, H, SPINE.p, REST_BOX_X1, -REST_BOX_H0, headB);
    scene.dragon.bounds(dragonR);
    const pad = 0.2 * Math.max(dragonR.w, dragonR.h);
    cam.worldToScreen(dragonR.x - pad, dragonR.y - pad * 1.5, tmp);
    const dx0 = tmp.x;
    const dy0 = tmp.y;
    cam.worldToScreen(dragonR.x + dragonR.w + pad, dragonR.y + dragonR.h, tmp);
    const ix = Math.min(headB.x, tmp.x) - Math.max(headA.x, dx0);
    const iy = Math.min(headB.y, tmp.y) - Math.max(headA.y, dy0);
    const area = Math.max(1, (headB.x - headA.x) * (headB.y - headA.y));
    const cover = ix > 0 && iy > 0 ? (ix * iy) / area : 0;
    return Math.max(pulled, smoothstep(0.03, 0.25, cover));
  };

  const stepWyrm = (view: View): void => {
    const dt = view.dt;
    // Sink or surface slowly (a sleeping head settling), never while the zoom poses it.
    if (isDriven) sink = 0;
    else {
      const s = sinkTarget(view);
      sink += (s - sink) * (1 - Math.exp(-(s > sink ? 1.6 : 0.6) * Math.max(0, dt)));
      // Hidden: no drowsy looks (onEyeOpen would rumble for an eye nobody can see).
      if (sink > 0.4 && idle.wakeT < 0) idle.nextWake = Math.max(idle.nextWake, idle.t + 6);
    }
    if (isDriven) {
      target.rise = driven.rise;
      target.eye = driven.eye;
      target.jaw = driven.jaw;
    } else {
      if (wasDriven) resetWyrmIdle(idle, WAKE_MIN_GAP);
      stepWyrmIdle(idle, dt, Math.random(), forceWake, ev);
      forceWake = false;
      idlePose(idle, target);
      if (ev.exhale && cur.rise < 0.3 && sink < 0.5) wyrm.breathe(1);
    }
    wasDriven = isDriven;
    const prevJaw = cur.jaw;
    const prevRise = cur.rise;
    followPose(cur, target, isDriven, dt);
    // The eye starting to open (either source): audio's cue.
    if (eyeArmed && target.eye > 0.04) {
      eyeArmed = false;
      host.eyeOpened();
    } else if (target.eye < 0.01) eyeArmed = true;
    // Lifting off the ridge shakes the snow off its skull.
    if (shedArmed && cur.rise > 0.06 && cur.rise > prevRise) {
      shedArmed = false;
      wyrm.shed(1.4);
    } else if (cur.rise < 0.02) shedArmed = true;
    // A strong roar: a plume of breath in the cold, and the peaks let go of their snow.
    if (roarArmed && cur.jaw > 0.72 && cur.jaw >= prevJaw) {
      roarArmed = false;
      wyrm.plume(1);
      const cam = view.camera;
      layerRange(cam, view.width, view.height, SPINE.p, tmp, origin);
      lightIn(view, cam, SPINE.p);
      wyrm.avalanche(tmp.x, Math.min(tmp.y, 2.4), light.x);
      if (!isDriven) cam.addTrauma(0.35);
    } else if (cur.jaw < 0.3) roarArmed = true;
    if (cur.jaw > 0.6 && Math.random() < dt * 3) wyrm.plume(0.4);
    wyrm.setPose(cur, isDriven ? 0 : exhale(idle.breath), sink);
    wyrm.update(dt, breeze(view.time));
  };

  // ---- the layer bodies

  const update = (view: View): void => {
    ensureSprites(view);
    ensureSky(view);
    bakeStep(view);
    stepWyrm(view);
    const cam = view.camera;
    const t = view.time;
    cam.visibleRect(vis, SAFE_MARGIN);
    wisps.update(view.dt, t, vis);
    cam.worldToScreen(cam.refX, 0, tmp);
    snow.update(view, tmp.x);
    // Eagles: a tiny flock crossing the far sky now and then.
    if (eagles.count > 0) {
      if (!eagles.update(view.dt, 0, view.width)) nextEagles = t + 26 + Math.random() * 30;
    } else if (t > nextEagles) {
      eagles.cross(view.width, view.height);
    }
  };

  const drawBack = (ctx: CanvasRenderingContext2D, view: View): void => {
    ensureSprites(view);
    const art = sky && sky.palette === view.palette ? sky : ensureSky(view);
    const W = view.width;
    const H = view.height;
    const t = view.time;
    const cam = view.camera;
    // Sky, slid so the baked afterglow stays under its point when the stage center moves.
    glowPos(view, sun);
    let sx = art.glowX0 - sun.x * (art.w / W);
    sx = sx < 0 ? 0 : sx > art.extra ? art.extra : sx;
    ctx.drawImage(art.sky, sx, 0, art.w, art.h, 0, 0, W, H);
    // The first stars, thickest overhead, gone into the afterglow; and the evening star.
    ctx.globalCompositeOperation = 'lighter';
    const band = H * STAR_BAND;
    for (let i = 0; i < STARS; i++) {
      const big = hash2f(i, 194);
      if (big < STAR_LIVE) continue;
      const fy = hash2f(i, 192);
      const y = fy * fy * band;
      const x = hash2f(i, 191) * W;
      const tw = 0.6 + 0.4 * Math.sin(t * (0.7 + hash2f(i, 193) * 2.4) + i * 1.7);
      ctx.globalAlpha = (1 - y / band) * (0.25 + 0.6 * big * big) * tw;
      const r = 0.9 + 1.9 * big * big * big;
      ctx.drawImage(flake!, x - r, y - r, r * 2, r * 2);
    }
    const vx = sun.x - H * 0.36;
    const vy = H * 0.3;
    ctx.globalAlpha = 0.45 + 0.08 * Math.sin(t * 1.3);
    ctx.drawImage(spark!, vx - 9, vy - 9, 18, 18);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(flake!, vx - 2.6, vy - 2.6, 5.2, 5.2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < art.clouds.length; i++) {
      const b = art.clouds[i]!;
      const period = W + b.w;
      let x = (b.x0 + t * b.speed) % period;
      if (x < 0) x += period;
      ctx.drawImage(b.canvas, x - b.w, b.y, b.w, b.h);
    }
    // Crepuscular rays fanning up from below the horizon (faint; clipped above the coils).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.rect(0, 0, W, sun.y - H * 0.02);
    ctx.clip();
    ctx.translate(sun.x, sun.y + H * 0.08);
    ctx.rotate(-0.12 + 0.02 * Math.sin(t * 0.05));
    ctx.globalAlpha = 0.07;
    const R = H * 1.1;
    ctx.drawImage(rays!, -R, -R, R * 2, R * 2);
    ctx.restore();

    // The far coils in the horizon's cloud, the afterglow washing over them.
    drawSea(ctx, view, seaFar, SEA_FAR_P, t);
    drawRidge(ctx, view, far);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.34;
    const B = H * 0.34;
    ctx.drawImage(art.glow, sun.x - B * 1.6, sun.y - B, B * 3.2, B * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    eagles.draw(ctx, art.birdColor, t);

    // The world wyrm's head behind the saddle, then the range (its spine), then its breath.
    const e0 = performance.now();
    if (wyrm.ready(view.palette)) {
      ctx.save();
      applyLayer(ctx, cam, H, SPINE.p);
      // The eye watches the fight: the clash point, a little above the ground.
      wyrm.eyeAt(tmp);
      layerToScreen(cam, H, SPINE.p, tmp.x, tmp.y, anchor);
      const dx = cam.stageCX - cam.stageW * 0.1 - anchor.x;
      const dy = cam.anchorFrac * H - H * 0.1 - anchor.y;
      const l = Math.hypot(dx, dy) || 1;
      wyrm.drawHead(ctx, cur.eye, dx / l, dy / l, layerZoom(cam, H, SPINE.p) * view.dpr, amberGlow!, t);
      ctx.restore();
    }
    const eyeMs = performance.now() - e0;
    drawRidge(ctx, view, spine);
    if (wyrm.ready(view.palette)) {
      ctx.save();
      applyLayer(ctx, cam, H, SPINE.p);
      wyrm.drawFront(ctx, layerZoom(cam, H, SPINE.p));
      ctx.restore();
    }
    if (host.isMain(view)) stats.eyeMs = stats.eyeMs * 0.95 + eyeMs * 0.05;

    // The sea of cloud, the slopes poking through it, the lower bank along the ridge line.
    drawSea(ctx, view, seaHigh, SEA_HIGH_P, t);
    drawRidge(ctx, view, slopes);
    castleGlint(ctx, view, t);
    drawSea(ctx, view, seaLow, SEA_LOW_P, t);
    if (!seaLow.ready(view.palette)) drawSeaFloor(ctx, view, SEA_LOW_P, 0.3, view.palette.haze);

    // The hide we stand on (with the meadow's scale in it), and the wisps drifting behind the army.
    cam.visibleRect(vis, SAFE_MARGIN);
    ground.draw(ctx, view, vis, host.frozen(), sun.x, art.glow);
    if (marked) drawMark(ctx, view, t);
    wisps.draw(ctx, view, 0, t);
  };

  /** The meadow's scale: the old tier faint inside it, a slow warm breath around it. */
  const drawMark = (ctx: CanvasRenderingContext2D, view: View, t: number): void => {
    const cam = view.camera;
    const pal = view.palette;
    if (mark.bottom < vis.y || mark.top - markLift * mark.pitch > vis.y + vis.h || mark.cx + mark.sx < vis.x || mark.cx - mark.sx > vis.x + vis.w) return;
    ctx.save();
    cam.apply(ctx);
    drawMarkedScale(ctx, pal, mark, markPic, cam.zoomEff, pal.light.x, pal.light.y, 1, markLift);
    ctx.restore();
    if (!amberGlow) return;
    cam.worldToScreen(mark.cx, mark.top + (mark.bottom - mark.top) * 0.35, tmp);
    const r = mark.sx * 2.6 * cam.zoomEff;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.07 + 0.035 * Math.sin(t * 0.9);
    ctx.drawImage(amberGlow, tmp.x - r, tmp.y - r * 0.55, r * 2, r * 1.1);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  /**
   * Bake the next piece of the Mountain's art for its first frame (the zoom's rally, the Meadow on
   * screen): the small art one piece a frame, then the silhouettes and the hide for the home framing
   * (bakeStep, frozen: the zoom holds the transition on). True when all of it is ready.
   */
  const prepare = (view: View): boolean => {
    const pal = MOUNTAIN;
    let pv = prepView;
    if (!pv) pv = prepView = { ...view, palette: pal };
    pv.state = view.state;
    pv.alpha = view.alpha;
    pv.dt = view.dt;
    pv.time = view.time;
    pv.realDt = view.realDt;
    pv.realTime = view.realTime;
    pv.camera = view.camera;
    pv.palette = pal;
    pv.width = view.width;
    pv.height = view.height;
    pv.dpr = view.dpr;
    pv.frame = view.frame;
    const t0 = performance.now();
    let name = '';
    if (!rays) {
      ensureSprites(pv);
      name = 'sprites';
    } else if (!sky || sky.palette !== pal || sky.w !== pv.width || sky.h !== pv.height || sky.dpr !== pv.dpr) {
      // A slice of the gradient per frame, then the rest of the sky art.
      const b = skyBakerFor(pv);
      if (b.done) {
        adoptSky(pv, b);
        name = 'sky art';
      } else {
        b.step(4);
        name = 'sky';
      }
    } else if (!seaHigh.ready(pal)) {
      seaHigh.ensure(pal, pv.height);
      name = 'seaHigh';
    } else if (!seaFar.ready(pal)) {
      seaFar.ensure(pal, pv.height);
      name = 'seaFar';
    } else if (!seaLow.ready(pal)) {
      seaLow.ensure(pal, pv.height);
      name = 'seaLow';
    } else if (!wisps.ready(pal)) {
      wisps.ensure(pal);
      name = 'wisps';
    } else if (!fg.ready(pal)) {
      fg.ensure(pal);
      name = 'foreground';
    } else if (!host.frozen()) {
      // The silhouettes bake for the home framing only while the zoom holds the transition.
      return true;
    } else {
      const before = stats.bakes;
      bakeStep(pv);
      if (stats.bakes === before) return true;
      name = stats.bakeWorst ?? 'bake';
    }
    const ms = performance.now() - t0;
    prepStats.pieces++;
    prepStats.ms += ms;
    if (ms > prepStats.worst) {
      prepStats.worst = ms;
      prepStats.worstName = name;
    }
    return false;
  };

  const drawFront = (ctx: CanvasRenderingContext2D, view: View): void => {
    if (!flake) return;
    wisps.draw(ctx, view, 1, view.time);
    snow.draw(ctx, flake, 0, 99, view.time);
    // The stage clearing: from just left of the hero to the dragon's far edge (read lazily).
    const cam = view.camera;
    scene.crowd.heroPoint(clearA);
    scene.dragon.bounds(clearR);
    cam.worldToScreen(Math.min(clearA.x - 0.6, clearR.x), 0, clearA);
    const c0 = clearA.x;
    const groundY = clearA.y;
    cam.worldToScreen(clearR.x + clearR.w, 0, clearA);
    const toes = Math.min(10, Math.max(2, 0.06 * clearR.h * cam.zoomEff));
    fg.draw(ctx, view, c0, clearA.x, groundY, toes);
  };

  const zero = (c: HTMLCanvasElement | null): void => {
    if (c) c.width = c.height = 0;
  };
  const cv = (c: HTMLCanvasElement | null): number => (c ? c.width * c.height * 4 : 0);

  return {
    update,
    drawBack,
    drawFront,
    prepare,
    prepStats,
    sunPoint: (view: View, out: Vec2) => glowPos(view, out),
    markScale(m) {
      if (!m) {
        marked = false;
        markPic = null;
        return;
      }
      hideScaleShape(m.x, m.y, mark);
      markPic = m.picture;
      markLift = m.lift ?? 0;
      marked = true;
    },
    drawKneeMist(ctx, view) {
      wisps.draw(ctx, view, 1, view.time);
    },
    openEye() {
      if (!isDriven) forceWake = true;
    },
    birds() {
      eagles.cross(scene.camera.viewW, scene.camera.viewH);
    },
    pose(p) {
      if (p) {
        isDriven = true;
        driven.rise = clamp01(p.rise);
        driven.eye = clamp01(p.eye);
        driven.jaw = clamp01(p.jaw);
      } else isDriven = false;
    },
    poseNow: () => cur,
    avalanche() {
      const cam = scene.camera;
      layerRange(cam, cam.viewW, cam.viewH, SPINE.p, tmp, origin);
      wyrm.avalanche(tmp.x, 2.4, 1.5);
    },
    eyeState: () =>
      `${isDriven ? 'posed' : idle.wakeT >= 0 ? `looking ${idle.wakeT.toFixed(1)} s` : 'dozing'} r${cur.rise.toFixed(2)} e${cur.eye.toFixed(2)} j${cur.jaw.toFixed(2)}, ${stats.eyeMs.toFixed(3)} ms`,
    bytes() {
      let b = ground.bytes() + wyrm.bytes() + wisps.bytes() + fg.bytes() + seaHigh.bytes() + seaFar.bytes() + seaLow.bytes();
      for (const r of ridges) b += r.bytes();
      b += cv(rays) + cv(amberGlow);
      if (sky) {
        b += cv(sky.sky) + cv(sky.glow);
        for (const c of sky.clouds) b += cv(c.canvas);
      }
      return b;
    },
    free() {
      if (skyBaker) skyBaker.canvas.width = skyBaker.canvas.height = 0;
      skyBaker = null;
      skyBakerPal = null;
      for (const r of ridges) r.free();
      ground.free();
      wyrm.free();
      wisps.free();
      fg.free();
      seaHigh.free();
      seaFar.free();
      seaLow.free();
      zero(rays);
      zero(amberGlow);
      rays = amberGlow = null;
      flake = spark = null;
      if (sky) {
        zero(sky.sky);
        zero(sky.glow);
        for (const c of sky.clouds) zero(c.canvas);
        sky = null;
      }
      // The meadow's scale belongs to this visit; a fresh visit starts the wyrm asleep.
      marked = false;
      markPic = null;
      resetWyrmIdle(idle);
      cur.rise = cur.eye = cur.jaw = 0;
      sink = 0;
      eyeArmed = roarArmed = shedArmed = true;
    },
  };
}
