// Dragon layer (slot 1) + DragonView (scene.dragon): the procedural rig brought to life.
//
//   species.ts   parameter sets (the meadow newt) + per-individual variation from the seed
//   wyvern.ts    the craggy mountain wyvern (tier 1): wing-arms, rock plates, a crown, a club
//   bosses.ts    the tier bosses as data: morph overrides, dressings, tempo, entrance/exit styles
//   head.ts      head geometry (skull, jaw, teeth, horns, gills, frill, crown) in head units
//   rig.ts       spine chain + dynamics, leg IK, stepping and run cycle, wings and wing-arms, rock
//                plates, heads; pure math
//   choreo.ts    phases and idle micro-behaviors -> pose channels (moves.ts: species/boss styles)
//   weakspot.ts  which weak spot is live (loose scale or plate / throat / tail) and where
//   paint.ts     rim-lit silhouette, eyes, glows, weak spot (parts.ts: wing-arms, plates, dressings)
//   effects.ts   fire, smoke, embers, ash, dust, snow
//   tuning.ts    named tuning constants (hit radii, weak-spot shifting, caches, landing shake)
//   lab.html     dev-only species lab (not in the build): /src/render/dragon/lab.html
//
// State is the truth: the individual is rebuilt whenever state.dragon's id, size, species or boss
// changes (so debug edits to the live state take effect), the pose is a function of the phase and
// its progress (phaseT + alpha * TICK_DT), and events only add one-shot reactions (flinches,
// flashes, particles). The rig works in body lengths (u); world meters are
// x = CLASH_X + rig.placeX(x_u) * L, y = y_u * L, with L = state.dragon.size (placeX applies the
// swipe's and the exit's turn-around mirror and world shift; identity otherwise).
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { DragonView } from './api';
import type { Palette } from '../palette';
import type { Rect, Vec2 } from '../../lib/vec';
import type { DragonPhase } from '../../core';
import { CLASH_X } from '../world';
import { TICK_DT } from '../../core/formulas';
import { ColorRamp, mixHex } from '../../lib/color';
import { buildIndividual, speciesOf, type Morph } from './species';
import { BODY_N, C_AIR, C_TONGUE, DragonRig, LEG_FN, type SpineSample } from './rig';
import { Choreo, type ChoreoEnv } from './choreo';
import { createPaintState, paintDragon, type PaintRes } from './paint';
import { DressLayout } from './parts';
import { BoundedCache } from './cache';
import { buildDragonFx, emitFire, groundBlast, type DragonFx } from './effects';
import {
  BODY_HIT_PAD_PX,
  LAND_SHAKE,
  LAND_SHAKE_BOSS,
  LAND_SHAKE_GROW,
  LAND_SHAKE_SIZE,
  RES_CACHE_MAX,
  RIDGE_SPOT_MIN_PX,
  TORSO_SPOT_MIN_PX,
  WEAK_DRAW_FRAC,
  WEAK_DRAW_MIN_PX,
  WEAK_HIT_MIN_PX,
  WEAK_HIT_SCALE,
  WEAK_SHIFT_ON_CRIT,
} from './tuning';
import { WEAK_SCALE, WEAK_TAIL, WeakSpot, swipeSpotFor, weakLiveFor, weakModeFor } from './weakspot';
import { makeCanvas, context2d } from '../atlas';

export interface DragonRender {
  layer: Layer;
  view: DragonView;
  /**
   * Override morph fields for every dragon from now on (mutations such as { heads: 3 }, dev
   * checks); undefined clears. The current dragon is rebuilt on the next frame.
   */
  setOverride(over: Partial<Morph> | undefined): void;
}

/** The weak spot's cool halo (contrasts with the golden sky and the warm fire). */
export const WEAK_CYAN = '#6be9ff';

/** Animation speed by size: newts are quick, 40 m wyrms are ponderous (a scale cue in itself). */
function tempoFor(size: number): number {
  const t = Math.pow(Math.max(0.05, size), -0.3);
  return t < 0.3 ? 0.3 : t > 1.25 ? 1.25 : t;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function sstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** A loose scale: a rounded, slightly pointed plate, white-hot at the center. */
function paintScale(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.36;
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.05, cy);
  ctx.quadraticCurveTo(cx - r * 0.7, cy - r * 0.95, cx + r * 0.2, cy - r * 0.78);
  ctx.quadraticCurveTo(cx + r * 1.05, cy - r * 0.35, cx + r * 1.2, cy);
  ctx.quadraticCurveTo(cx + r * 1.05, cy + r * 0.35, cx + r * 0.2, cy + r * 0.78);
  ctx.quadraticCurveTo(cx - r * 0.7, cy + r * 0.95, cx - r * 1.05, cy);
  ctx.closePath();
  const g = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.1, 0, cx, cy, r * 1.2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#fffbe8');
  g.addColorStop(0.7, '#ffe9a6');
  g.addColorStop(1, '#9ef3ff');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = w * 0.035;
  ctx.strokeStyle = 'rgba(80,220,255,0.9)';
  ctx.stroke();
  // A ridge line down the middle of the scale.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, cy);
  ctx.lineTo(cx + r * 0.95, cy);
  ctx.lineWidth = w * 0.03;
  ctx.strokeStyle = 'rgba(255,214,120,0.7)';
  ctx.stroke();
}

/** Four-point sparkle (white; tinted later). */
function paintStar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const R = w * 0.48;
  const r = w * 0.11;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? R : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.3);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function createDragon(scene: Scene): DragonRender {
  const rig = new DragonRig();
  const choreo = new Choreo();
  const st = createPaintState();
  const dress = new DressLayout();
  // Palette resources and particle specs, keyed by palette name and bounded (RES_CACHE_MAX).
  const resCache = new BoundedCache<PaintRes>(RES_CACHE_MAX);
  const fxCache = new BoundedCache<DragonFx>(RES_CACHE_MAX);
  let fx: DragonFx | null = null;
  let fxKey = '';
  let starId = -1;
  let scaleCanvas: HTMLCanvasElement | null = null;

  // Identity / phase tracking.
  let curId = -1;
  let curSize = 0;
  let curSpecies = '';
  let curBoss: string | null = null;
  let over: Partial<Morph> | undefined;
  let needSnap = true;
  let lastPhase: DragonPhase | '' = '';
  let phaseEvents = 0;
  let seenEvents = 0;
  let lastK = 0;

  // Weak spot (which target is live, fades; see weakspot.ts).
  const weak = new WeakSpot();
  const weakAng = { a: 0 };

  // Reactions.
  let hot = 0;
  let prevAir = 0;
  let slamDone = false;
  let lastDissolve = 1;
  let lastBurn = 0;
  // Swipe shockwave: a dust wave rolling out through the ranks from where the tail lands.
  let waveT = -1;
  let waveX0 = 0;
  let waveX1 = 0;
  let waveDur = 0.35;
  let waveAcc = 0;
  // Swoosh trail behind the lashing tail tip (world m), newest first.
  const TRAIL = 12;
  const trailX = new Float64Array(TRAIL);
  const trailY = new Float64Array(TRAIL);
  let trailN = 0;
  let trailA = 0;
  let fireAcc = 0;
  let deathAcc = 0;
  let showBones = false;

  const env: ChoreoEnv = {
    phase: 'idle',
    attack: 'breath',
    k: 0,
    t: 0,
    dt: 0,
    time: 0,
    lookX: -1,
    lookY: -0.2,
    lookPull: 0.5,
    enterDist: 4,
    lunge: 0,
    aimX: -2,
    aimY: 0,
    dur: 1,
    enterH: 2,
    exitDist: 3,
    exitH: 2,
    slamX: 0,
  };

  const tmp: Vec2 = { x: 0, y: 0 };
  const tmp2: Vec2 = { x: 0, y: 0 };
  const box: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const sp: SpineSample = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };
  let perfAcc = 0;
  let perfN = 0;
  let perfShow = 0;

  // ---- identity ----

  const ensureIndividual = (): void => {
    const d = scene.game.state.dragon;
    const boss = d.boss ?? null;
    if (d.id === curId && d.size === curSize && d.species === curSpecies && boss === curBoss) return;
    curId = d.id;
    curSize = d.size;
    curSpecies = d.species;
    curBoss = boss;
    const ind = buildIndividual(speciesOf(d.species), d.seed, d.size, over, boss);
    rig.setup(ind);
    rig.tempo = tempoFor(d.size) * (ind.boss ? ind.boss.tempo : 1);
    choreo.reset(d.seed);
    dress.layout(rig);
    const dr = ind.dress;
    st.dress = dr.moss > 0 || dr.scars > 0 || dr.torn > 0 ? dress : null;
    weak.reset();
    weak.snap(d.phase, d.attack, d.phaseDur > 0 ? d.phaseT / d.phaseDur : 1);
    hot = 0;
    slamDone = false;
    lastDissolve = 1;
    lastBurn = 0;
    needSnap = true;
    lastPhase = '';
    seenEvents = phaseEvents;
  };

  const L = (): number => scene.game.state.dragon.size;
  // World <-> rig units, through the turn-around mirror and world shift (rig.placeX).
  const toU = (wx: number, wy: number, out: Vec2): Vec2 => {
    const l = L();
    out.x = rig.unplaceX((wx - CLASH_X) / l);
    out.y = wy / l;
    return out;
  };
  const toWorld = (ux: number, uy: number, out: Vec2): Vec2 => {
    const l = L();
    out.x = CLASH_X + rig.placeX(ux) * l;
    out.y = uy * l;
    return out;
  };

  // ---- palette resources ----

  const ensureRes = (p: Palette): PaintRes => {
    const { atlas, sprites } = scene;
    if (!scaleCanvas) {
      scaleCanvas = makeCanvas(64, 64);
      paintScale(context2d(scaleCanvas), 64, 64);
      starId = atlas.register('dragon.star', 32, 32, paintStar);
    }
    const scale: HTMLCanvasElement = scaleCanvas;
    // (get first: the builder closure is only made on a miss, never per frame)
    const r = resCache.get(p.name) ?? resCache.getOrBuild(p.name, (): PaintRes => {
      const eye = rig.ind ? rig.ind.eye : p.accent.gold;
      // Clearly whiter and brighter than any sky behind it (else it reads as holes in the
      // silhouette), just touched by the rim light's color.
      const snow = mixHex('#f6f8ff', p.rim, 0.16);
      return {
        silhouette: p.silhouette,
        far: mixHex(p.silhouette, p.haze, 0.17),
        rim: p.rim,
        rimHot: new ColorRamp([p.rim, p.accent.glow, '#ffffff'], 24),
        rimBurn: new ColorRamp([p.rim, p.accent.fire, p.accent.ember], 24),
        glowFire: atlas.canvas(atlas.tint(sprites.glow, p.accent.fire, 0.35)),
        glowHot: atlas.canvas(atlas.tint(sprites.glow, '#fff0c0', 0.8)),
        glowCyan: atlas.canvas(atlas.tint(sprites.glow, WEAK_CYAN, 0.25)),
        glowWhite: atlas.canvas(sprites.glow),
        glowEye: atlas.canvas(atlas.tint(sprites.glow, eye, 0.5)),
        glowDark: atlas.canvas(atlas.tint(sprites.glow, p.silhouette)),
        glowEmber: atlas.canvas(atlas.tint(sprites.glow, p.accent.ember, 0.5)),
        scale,
        star: atlas.canvas(atlas.tint(starId, p.accent.gold, 0.7)),
        eye,
        haze: p.haze,
        pouch: mixHex('#ffe3a8', p.accent.fire, 0.35),
        cyan: WEAK_CYAN,
        farRamp: new ColorRamp([mixHex(p.silhouette, p.haze, 0.17), mixHex(p.silhouette, p.haze, 0.42)], 16),
        membrane: new ColorRamp([p.silhouette, mixHex(p.silhouette, p.haze, 0.22)], 16),
        moss: mixHex(p.silhouette, '#5a6a2c', 0.34),
        scar: mixHex(p.silhouette, p.rim, 0.42),
        snow,
        snowFar: mixHex(snow, p.haze, 0.3),
      };
    });
    // The eye glow follows the individual (atlas tints are cached, so this is cheap).
    if (rig.ind && r.eye !== rig.ind.eye) {
      r.eye = rig.ind.eye;
      r.glowEye = atlas.canvas(atlas.tint(sprites.glow, rig.ind.eye, 0.5));
    }
    if (!fx || fxKey !== p.name) {
      fx = fxCache.getOrBuild(p.name, () => buildDragonFx(atlas, sprites, p, atlas.tint(starId, p.accent.gold, 0.6)));
      fxKey = p.name;
    }
    return r;
  };

  // ---- fire geometry (shared by the emitter and breathReachX) ----

  /** Where the flame lands (world x): a newt's puff licks the front rank; a wyrm's torrent pours across the field. */
  const fireAimX = (l: number): number => scene.crowd.frontX() - Math.max(0.45, l * 0.3);
  /** Flame thickness at the mouth (m): sized to the head, so it scales with the dragon on screen. */
  const fireWidth = (l: number, pxM: number): number => Math.max(rig.headLen * l * 0.42, 4 * pxM);
  /** Particles per second and life multiplier: a cute puff when young, a torrent when grown. */
  const fireRate = (): number => 120 + 220 * rig.ind.maturity;
  const fireLife = (): number => 0.75 + 0.6 * rig.ind.maturity;

  /** Screen px per body length at the director's TARGET framing (stable while the camera eases). */
  const targetPxPerU = (): number => {
    const dir = scene.director;
    const z = dir.enabled && dir.target.zoom > 1 ? dir.target.zoom : scene.camera.zoomEff;
    return z * L();
  };

  // ---- weak spot ----

  /** Loose-scale candidates allowed at this on-screen size (see tuning.ts). */
  const weakCandidates = (): number => {
    const n = rig.ind.weakSpots.length;
    const ppu = targetPxPerU();
    return Math.min(n, ppu >= RIDGE_SPOT_MIN_PX ? 4 : ppu >= TORSO_SPOT_MIN_PX ? 3 : 2);
  };

  const weakPos = (out: Vec2): Vec2 => weak.pos(rig, sp, out, weakAng);

  /**
   * The weak spot clicks can hit right now, straight from state (not from last frame's fades):
   * during a breath windup only the throat, during a swipe windup only the tail.
   */
  const liveWeak = (out: Vec2): Vec2 | null => {
    const d = scene.game.state.dragon;
    const k = d.phaseDur > 0 ? d.phaseT / d.phaseDur : 1;
    if (!weakLiveFor(d.phase, k)) return null;
    weak.swipeSpot = swipeSpotFor(targetPxPerU());
    const idx = weak.idx < weakCandidates() ? weak.idx : 0;
    return weak.pos(rig, sp, out, weakAng, weakModeFor(d.phase, d.attack), idx);
  };

  const weakHitRadiusU = (): number => {
    const ppu = Math.max(1e-6, scene.camera.zoomEff * L());
    const drawn = Math.max(WEAK_DRAW_FRAC, WEAK_DRAW_MIN_PX / ppu);
    return Math.max(drawn * WEAK_HIT_SCALE, WEAK_HIT_MIN_PX / ppu);
  };

  // ---- events ----

  scene.game.on('dragonPhase', (e) => {
    if (e.id === scene.game.state.dragon.id) phaseEvents++;
  });

  scene.game.on('strike', (e) => {
    ensureIndividual();
    if (e.auto) {
      // Rally's auto-strikes (~8/s) carry no impact point (x = y = 0): a light shiver somewhere on
      // the body, no squint or head kick, so a volley of them never jitters the dragon.
      hot = Math.max(hot, 0.28);
      view.impactPoint(tmp);
      const q = toU(tmp.x, tmp.y, tmp);
      rig.impulse(q.x, q.y, 0.3, -0.06, 0.28);
      return;
    }
    const crit = e.crit;
    hot = Math.max(hot, crit ? 1 : 0.62);
    const p = toU(e.x, e.y, tmp);
    // Recoil away from the army and away from the blow.
    rig.impulse(p.x, p.y, crit ? 2.4 : 1.25, crit ? -0.5 : -0.25, 0.32);
    rig.kickHead(0, crit ? -3.2 : -1.3);
    choreo.hit(crit);
    if (crit && fx && weak.live) {
      weakPos(tmp2);
      const w = toWorld(tmp2.x, tmp2.y, tmp2);
      const s = 1 / scene.camera.zoomEff;
      scene.particles.world.burst(fx.spark, w.x, w.y, 14, -Math.PI / 2, 90 * s);
      if (!e.stagger && Math.random() < WEAK_SHIFT_ON_CRIT) weak.shiftSoon(0.45);
    }
    if (e.stagger && fx) {
      rig.headToU(0, -0.3, -0.6, tmp2);
      const w = toWorld(tmp2.x, tmp2.y, tmp2);
      const s = 1 / scene.camera.zoomEff;
      scene.particles.world.burst(fx.star, w.x, w.y, 7, -Math.PI / 2, 60 * s);
    }
  });

  scene.game.on('armyHit', (e) => {
    ensureIndividual();
    const f = Math.min(1, e.hits / 10);
    hot = Math.max(hot, 0.18 + 0.12 * f);
    rig.spineAtBody(0.1 + Math.random() * 0.3, sp);
    rig.impulse(sp.x, sp.y, 0.35 + 0.35 * f, -0.1, 0.3);
  });

  scene.game.on('resync', () => {
    curId = -1;
    ensureIndividual();
    needSnap = true;
    hot = 0;
  });

  // ---- phase starts (one-shot setup) ----

  const onPhaseStart = (phase: DragonPhase): void => {
    const l = L();
    const cam = scene.camera;
    const dir = scene.director;
    const half = cam.stageW * 0.5;
    if (phase === 'enter' || phase === 'leave') {
      // Past the right edge of both the current and the upcoming framing.
      const edgeNow = cam.x + half / cam.zoomEff;
      const edgeNext = dir.target.x + half / Math.max(1e-6, dir.target.zoom);
      const edge = Math.max(edgeNow, edgeNext);
      // The top of the stage (world y, up is negative) in the current and the upcoming framing.
      const topNow = cam.y - (cam.viewH * 0.5) / cam.zoomEff;
      const topNext = -((dir.groundFrac || 0.76) * cam.viewH) / Math.max(1e-6, dir.target.zoom);
      const top = Math.min(topNow, topNext);
      if (phase === 'enter') {
        env.enterDist = Math.max(1.4, (edge - CLASH_X) / l + 0.12);
        // A glider comes in from the upper right: from about the top of the frame.
        env.enterH = Math.max(0.6, (-top / l) * 0.85);
      } else {
        // Turned around it spans the mirrored rest pose: clear the edge with all of it.
        env.exitDist = Math.max(1.6, (edge - CLASH_X) / l + (rig.restMaxX - rig.restMinX) + 0.2);
        env.exitH = Math.max(0.8, -top / l + 0.35);
      }
    }
    if (phase === 'swipe' || phase === 'windup') {
      const front = (scene.crowd.frontX() - 0.2 - CLASH_X) / l;
      if (rig.ind.swipe === 'slam') {
        // Over the back, the club reaches about this far forward: hop in until that's the front line.
        const reachX = rig.x[rig.iH]! - rig.tailLen * 0.6;
        env.slamX = front;
        env.lunge = Math.max(0, Math.min(1.2, reachX - front));
      } else {
        // Lunge so the lashing tail (turned around: hip mirrored about the middle, tail out front)
        // reaches into the army's front ranks.
        const hipMirrored = 2 * rig.midX - rig.x[rig.iH]!;
        const tipReach = hipMirrored - rig.tailLen * 0.95;
        env.lunge = Math.max(0, Math.min(1.4, tipReach - front));
      }
      slamDone = false;
    }
    if (phase === 'dying') {
      lastDissolve = 1;
      lastBurn = 0;
      deathAcc = 0;
    }
  };

  // ---- the view ----

  const view: DragonView = {
    hitTest(wx, wy) {
      ensureIndividual();
      const d = scene.game.state.dragon;
      if (d.phase === 'dying' && rig.dissolve < 0.85) return null;
      // Gone (flown or walked off stage): nothing to hit.
      if (d.phase === 'leave' && d.phaseDur > 0 && d.phaseT / d.phaseDur > 0.9) return null;
      const p = toU(wx, wy, tmp);
      const w = liveWeak(tmp2);
      if (w) {
        const r = weakHitRadiusU();
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        if (dx * dx + dy * dy <= r * r) return 'weak';
      }
      const pad = BODY_HIT_PAD_PX / Math.max(1e-6, scene.camera.zoomEff * L());
      return rig.hitBody(p.x, p.y, pad) ? 'body' : null;
    },
    weakRadius() {
      return weakHitRadiusU() * L();
    },
    impactPoint(out) {
      ensureIndividual();
      const r = Math.random();
      if (r < 0.2 && rig.legOn[0]) {
        // Front leg (a wyvern's wing-arm), where swords reach.
        const t = 0.2 + Math.random() * 0.7;
        const x = rig.kneeX[0]! + (rig.ankX[0]! - rig.kneeX[0]!) * t;
        const y = rig.kneeY[0]! + (rig.ankY[0]! - rig.kneeY[0]!) * t;
        return toWorld(x, y, out);
      }
      let at: number;
      let side: number;
      if (r < 0.65) {
        at = -0.15 + Math.random() * 0.55; // chest and front body
        side = -0.75 + Math.random() * 1.3;
      } else if (r < 0.8) {
        rig.spineAt(rig.iS * (0.2 + Math.random() * 0.7), sp); // neck, lower half
        side = -0.7 + Math.random() * 0.8;
        const s2 = side >= 0 ? side * sp.back : side * sp.belly;
        return toWorld(sp.x + sp.nx * s2, sp.y + sp.ny * s2, out);
      } else {
        at = 0.3 + Math.random() * 0.9;
        side = -0.6 + Math.random() * 1.2;
      }
      rig.spineAtBody(at, sp);
      const s = side >= 0 ? side * sp.back : side * sp.belly;
      return toWorld(sp.x + sp.nx * s, sp.y + sp.ny * s, out);
    },
    weakSpot(out) {
      ensureIndividual();
      const w = liveWeak(tmp2);
      return w ? toWorld(w.x, w.y, out) : null;
    },
    headPoint(out) {
      ensureIndividual();
      rig.mouth(0, tmp2);
      return toWorld(tmp2.x, tmp2.y, out);
    },
    tailPoint(out) {
      ensureIndividual();
      return toWorld(rig.x[rig.n - 1]!, rig.y[rig.n - 1]!, out);
    },
    breathReachX() {
      ensureIndividual();
      const l = L();
      const ax = fireAimX(l);
      rig.mouth(0, tmp2);
      toWorld(tmp2.x, tmp2.y, tmp2);
      const w = fireWidth(l, 1 / Math.max(1e-6, scene.camera.zoomEff));
      // Particles overshoot the aim by ~12% and grow to ~3.6 widths across; the soft edge sits
      // about 2.5 widths past the overshoot.
      return tmp2.x + (ax - tmp2.x) * 1.12 - w * 2.5;
    },
    bounds(out) {
      ensureIndividual();
      const l = L();
      out.x = CLASH_X + rig.restMinX * l;
      out.y = rig.restMinY * l;
      out.w = (rig.restMaxX - rig.restMinX) * l;
      out.h = (rig.restMaxY - rig.restMinY) * l;
      return out;
    },
  };

  // ---- per frame ----

  const update = (v: View): void => {
    const t0 = performance.now();
    ensureIndividual();
    ensureRes(v.palette);
    const d = v.state.dragon;
    const l = d.size;
    const dt = v.dt;
    const cam = v.camera;
    rig.pxPerU = cam.zoomEff * l;
    const t = Math.min(d.phaseT + v.alpha * TICK_DT, d.phaseDur);
    const k = d.phaseDur > 0 ? clamp01(t / d.phaseDur) : 1;

    if (d.phase !== lastPhase || phaseEvents !== seenEvents) {
      seenEvents = phaseEvents;
      lastPhase = d.phase;
      onPhaseStart(d.phase);
      lastK = 0;
    }

    env.phase = d.phase;
    env.attack = d.attack;
    env.k = k;
    env.t = t;
    env.dt = dt;
    env.time = v.time;
    env.dur = d.phaseDur;

    // What to look at: the cursor when it's over the stage, else the hero.
    const ptr = scene.input.pointer;
    if (ptr.x >= 0) {
      cam.screenToWorld(ptr.x, ptr.y, tmp);
      toU(tmp.x, tmp.y, tmp);
      env.lookPull = 1;
    } else {
      scene.crowd.heroPoint(tmp);
      toU(tmp.x, tmp.y, tmp);
      env.lookPull = 0.55;
    }
    env.lookX = tmp.x;
    env.lookY = tmp.y;
    st.lookX = tmp.x;
    st.lookY = tmp.y;

    // Fire aim: the ground in front of the army, further out for bigger dragons (a newt's flame
    // licks the front rank; a wyrm's torrent pours down across the field).
    const aimW = fireAimX(l);
    toU(aimW, 0, tmp);
    env.aimX = tmp.x;
    env.aimY = 0;

    choreo.apply(rig, env);
    if (needSnap) {
      rig.ch.set(rig.target);
      rig.solveTargets();
      rig.snap();
      needSnap = false;
      prevAir = rig.ch[C_AIR]!;
    }
    rig.update(dt);
    choreo.post(rig, env);

    // ---- reactions & effects ----
    hot = Math.max(0, hot - v.realDt * 9);
    const world = scene.particles.world;
    const f = fx!;
    const zoom = cam.zoomEff;
    const px = 1 / zoom; // meters per CSS px
    const snowy = rig.ind.species.behavior.snow;

    // Weak spot: the loose scale, or the throat / tail base during windups (weakspot.ts).
    const prevIdx = weak.idx;
    const prevMode = weak.mode;
    weak.swipeSpot = swipeSpotFor(targetPxPerU());
    weak.update(dt, d.phase, d.attack, k, weakCandidates());
    if (weak.mode === WEAK_SCALE && prevMode === WEAK_SCALE && weak.idx !== prevIdx && weak.vis > 0.3) {
      // The scale shook loose and moved: a little cyan burst where it was.
      weak.pos(rig, sp, tmp2, weakAng, WEAK_SCALE, prevIdx);
      toWorld(tmp2.x, tmp2.y, tmp2);
      world.burst(f.spark, tmp2.x, tmp2.y, 8, -Math.PI / 2, 60 * px);
    }
    const baseR = Math.max(WEAK_DRAW_FRAC, WEAK_DRAW_MIN_PX / Math.max(1e-6, rig.pxPerU));
    weakPos(tmp2);
    st.weakOn = weak.vis * sstep(0, 1, weak.fadeIn);
    st.weakX = tmp2.x;
    st.weakY = tmp2.y;
    st.weakA = weakAng.a;
    st.weakR = baseR;
    st.weakMode = weak.mode;
    st.weakOnHead = weak.mode === WEAK_TAIL && weak.onHead(rig) ? 1 : 0;
    if (weak.prevFade > 0.01) {
      weak.pos(rig, sp, tmp2, weakAng, weak.prevMode, weak.prevIdx);
      st.weak2On = weak.vis * weak.prevFade;
      st.weak2X = tmp2.x;
      st.weak2Y = tmp2.y;
      st.weak2A = weakAng.a;
      st.weak2Mode = weak.prevMode;
    } else st.weak2On = 0;

    // Hover.
    let hv = 0;
    let hb = 0;
    if (ptr.x >= 0) {
      cam.screenToWorld(ptr.x, ptr.y, tmp);
      const h = view.hitTest(tmp.x, tmp.y);
      hv = h === 'weak' ? 1 : 0;
      hb = h === 'body' ? 1 : 0;
    }
    st.hover += (hv - st.hover) * (1 - Math.exp(-14 * v.realDt));
    st.hoverBody += (hb - st.hoverBody) * (1 - Math.exp(-10 * v.realDt));

    // Nostril puffs (dark and ember-flecked before a breath).
    if (choreo.puff && rig.dissolve > 0.5) {
      const hs = rig.head;
      rig.headToU(0, hs.nostrilX, hs.nostrilY, tmp2);
      toWorld(tmp2.x, tmp2.y, tmp2);
      const s = Math.max(l * rig.headLen * 0.35, 5 * px);
      const dark = d.phase === 'windup';
      world.burst(dark ? f.puffDark : f.puff, tmp2.x, tmp2.y, dark ? 3 : 2, -Math.PI / 2 - 0.6, s);
      if (dark) world.burst(f.ember, tmp2.x, tmp2.y, 2, -Math.PI / 2, s * 0.8);
    }

    // Fire breath.
    const fireOn = d.phase === 'breath' ? sstep(0.04, 0.12, k) * (1 - sstep(0.72, 0.92, k)) : 0;
    st.fire += (fireOn - st.fire) * (1 - Math.exp(-10 * dt));
    if (fireOn > 0.01 && dt > 0) {
      rig.mouth(0, tmp2);
      toWorld(tmp2.x, tmp2.y, tmp2);
      const mx = tmp2.x;
      const my = tmp2.y;
      const ax = aimW;
      const ay = 0;
      const width = fireWidth(l, px);
      fireAcc += dt * fireRate() * fireOn;
      const n = Math.floor(fireAcc);
      fireAcc -= n;
      if (n > 0) emitFire(world, f, mx, my, ax, ay, n, width, 0.6 + 0.4 * fireOn, dt, fireLife());
      // Smoke billows where it lands.
      if (Math.random() < dt * 14 * fireOn) world.burst(f.smoke, ax + (Math.random() - 0.3) * width * 3, -width * 0.5, 1, -Math.PI / 2, width);
      st.fireX = (ax - CLASH_X) / l;
      st.fireY = 0;
      st.fireR = (width * 5) / l;
    }
    // Smoke curling from the mouth after the breath.
    if (d.phase === 'breath' && k > 0.8 && Math.random() < dt * 10) {
      rig.mouth(0, tmp2);
      toWorld(tmp2.x, tmp2.y, tmp2);
      world.burst(f.puffDark, tmp2.x, tmp2.y, 1, -Math.PI / 2 - 0.4, Math.max(l * rig.headLen * 0.4, 6 * px));
    }

    // Landing dust (the flutter-in touchdown and the pounce); a glider's landing is a shockwave.
    const air = rig.ch[C_AIR]!;
    if (prevAir > 0.5 && air < 0.5) {
      if (d.phase === 'enter' && rig.armWing) landingBlast(l, px);
      else dustAtFeet(1);
    }
    prevAir = air;
    // A flier's shadow spreads and fades with its height.
    st.lift = rig.armWing && air > 0.5 ? Math.max(0, rig.restAy - rig.y[rig.iS]!) : 0;

    // Swipe: the tail slaps down in front mid-flip (or on landing at the latest), and a dust
    // shockwave rolls out through the front ranks, near to far, as the crowd goes flying.
    if (d.phase === 'swipe' && !slamDone && k > 0.1) {
      const tip = rig.n - 1;
      const mid = rig.iS + (BODY_N >> 1);
      const tipX = rig.placeX(rig.x[tip]!);
      const down = rig.y[tip]! > -0.06 && tipX < rig.placeX(rig.x[mid]!);
      if (down || k > (rig.ind.swipe === 'slam' ? 0.5 : 0.3)) {
        slamDone = true;
        toWorld(rig.x[tip]!, 0, tmp2);
        const s = Math.max(l * 0.07, 9 * px);
        world.burst(f.dust, tmp2.x, 0, 16, -Math.PI / 2, s * 1.2);
        world.burst(f.clod, tmp2.x, -s * 0.2, 10, f.clod.angle, s * 0.6);
        if (snowy > 0) {
          world.burst(f.snow, tmp2.x, 0, 12, -Math.PI / 2, s * 1.1);
          world.burst(f.flake, tmp2.x, -s * 0.2, 10, -Math.PI / 2, s * 0.9);
        }
        cam.addTrauma(0.14 + 0.3 * Math.min(1, l / 25) + (rig.ind.swipe === 'slam' ? 0.06 : 0));
        // A gust carries the impact a little past the tail tip into the ranks.
        waveX0 = tmp2.x;
        waveX1 = tmp2.x - Math.max(0.8, 0.35 * l);
        waveDur = 0.34;
        waveT = 0;
        waveAcc = 0;
      }
    }
    if (d.phase !== 'swipe') slamDone = false;
    // Record the tail tip while it lashes (world space, so the trail stays where the air was cut).
    const lashing = d.phase === 'swipe' && k > 0.03 && k < 0.5;
    trailA += ((lashing ? 1 : 0) - trailA) * (1 - Math.exp(-(lashing ? 30 : 8) * dt));
    if (dt > 0) {
      if (trailA > 0.01) {
        for (let q = TRAIL - 1; q > 0; q--) {
          trailX[q] = trailX[q - 1]!;
          trailY[q] = trailY[q - 1]!;
        }
        toWorld(rig.x[rig.n - 1]!, rig.y[rig.n - 1]!, tmp2);
        trailX[0] = tmp2.x;
        trailY[0] = tmp2.y;
        if (trailN < TRAIL) trailN++;
      } else trailN = 0;
    }
    if (waveT >= 0 && dt > 0) {
      waveT += dt;
      const u = Math.min(1, waveT / waveDur);
      const e = 1 - (1 - u) * (1 - u);
      const wx = waveX0 + (waveX1 - waveX0) * e;
      waveAcc += dt * 90;
      const n = Math.floor(waveAcc);
      waveAcc -= n;
      const s = Math.max(l * 0.06, 9 * px) * (1 - 0.35 * u);
      for (let q = 0; q < n; q++) {
        const jx = wx + (Math.random() - 0.5) * s * 2;
        world.burst(snowy > 0 && q % 2 === 1 ? f.snow : f.dust, jx, 0, 1, -Math.PI / 2 - 0.5, s * 1.3);
        if (q % 2 === 0) world.burst(f.streak, jx, -Math.random() * s * 1.2, 1, Math.PI, s * 0.8);
        if (q % 3 === 0) world.burst(f.clod, jx, 0, 1, f.clod.angle, s * 0.45);
      }
      if (u >= 1) waveT = -1;
    }
    lastK = k;

    // Heavy footsteps for big dragons (never on frozen frames: the landing already happened); a
    // boss's tread shakes the ground harder.
    if (l >= 5 && dt > 0) {
      for (let q = 0; q < 4; q++) {
        if (!rig.landed[q]) continue;
        toWorld(rig.footX[q]!, 0, tmp2);
        world.burst(f.dust, tmp2.x, 0, 4, -Math.PI / 2, Math.max(l * 0.03, 6 * px));
        if (snowy > 0) world.burst(f.snow, tmp2.x, 0, 3, -Math.PI / 2, Math.max(l * 0.03, 6 * px));
        cam.addTrauma(0.05 * Math.min(1, l / 30) * (1 + 1.4 * rig.ind.grand));
      }
    }

    // Dying: the burn front throws embers and ash; the rim catches fire.
    st.burn = d.phase === 'dying' ? sstep(0.15, 0.5, k) : 0;
    if (d.phase === 'dying' && dt > 0) {
      const front = rig.dissolve;
      if (front < 0.999) {
        const cut = rig.indexOfS(front);
        rig.spineAt(cut, sp);
        const w = sp.back + sp.belly;
        deathAcc += dt * (90 + 240 * w) * (1 + rig.ind.grand);
        const n = Math.min(12, Math.floor(deathAcc));
        deathAcc -= n;
        for (let q = 0; q < n; q++) {
          const side = (Math.random() * 2 - 1) * 0.9;
          const o = side >= 0 ? side * sp.back : side * sp.belly;
          toWorld(sp.x + sp.nx * o, sp.y + sp.ny * o, tmp2);
          const s = Math.max(l * 0.12, 8 * px);
          world.burst(q % 3 === 0 ? f.ash : f.ember, tmp2.x, tmp2.y, 1, -Math.PI / 2, s);
        }
        // Limbs flare as the burn passes them.
        for (let q = 0; q < 4; q++) {
          if (!rig.legOn[q]) continue;
          const s = rig.s[Math.round(rig.iS + rig.legAt[q]! * BODY_N)]!;
          if (s <= lastDissolve && s > front) {
            toWorld(rig.kneeX[q]!, rig.kneeY[q]!, tmp2);
            world.burst(f.ember, tmp2.x, tmp2.y, 10, -Math.PI / 2, Math.max(l * 0.1, 8 * px));
          }
        }
        if (lastDissolve > 0.02 && front <= 0.02) {
          // The head goes last, in a puff.
          rig.mouth(0, tmp2);
          toWorld(tmp2.x, tmp2.y, tmp2);
          world.burst(f.ember, tmp2.x, tmp2.y, 18, -Math.PI / 2, Math.max(l * 0.14, 10 * px));
          world.burst(f.ash, tmp2.x, tmp2.y, 8, -Math.PI / 2, Math.max(l * 0.12, 8 * px));
        }
      }
      lastDissolve = front;
      // Wing-arm membranes burn away (the fingers shrink to the wrists) as the front nears the shoulders.
      if (rig.armWing) {
        const sh = rig.s[Math.round(rig.iS + rig.legAt[LEG_FN]! * BODY_N)]!;
        const burn = 1 - clamp01((front - sh) / 0.35);
        rig.wingBurn = burn;
        if (burn > lastBurn + 0.02) {
          for (let a = 0; a < 2; a++) {
            const pts = rig.armPose[a]!.pts;
            const F = rig.fingers;
            for (let q = 0; q < F; q++) {
              toWorld(pts[6 + q * 2]!, pts[7 + q * 2]!, tmp2);
              world.burst(q % 2 === 0 ? f.ember : f.ash, tmp2.x, tmp2.y, 2, -Math.PI / 2, Math.max(l * 0.1, 8 * px));
            }
          }
          lastBurn = burn;
        }
      }
    }
    if (d.phase !== 'dying') {
      rig.dissolve = 1;
      rig.wingBurn = 0;
    }
    // Dying: the last embers fade. Leaving: it fades once it's off stage (and stays gone).
    st.alpha = d.phase === 'dying' ? 1 - sstep(0.985, 1, k) : d.phase === 'leave' ? 1 - sstep(0.86, 0.98, k) : 1;

    st.hot = hot;
    st.tongue = rig.ch[C_TONGUE]!;
    st.time = v.time;
    st.L = l;
    st.originX = CLASH_X;
    st.big = clamp01(Math.log(Math.max(1e-6, l) / 4) / Math.log(10));

    const t1 = performance.now();
    perfAcc += t1 - t0;
  };

  const dustAtFeet = (scale: number): void => {
    if (!fx) return;
    const l = L();
    const px = 1 / scene.camera.zoomEff;
    for (let q = 0; q < 4; q++) {
      if (!rig.legOn[q]) continue;
      toWorld(rig.footX[q]!, 0, tmp2);
      scene.particles.world.burst(fx.dust, tmp2.x, 0, 3, -Math.PI / 2, Math.max(l * 0.05, 6 * px) * scale);
    }
  };

  /**
   * A flier's touchdown: a shockwave of dust (and snow) rolling out both ways under it, flakes and
   * snow shaken off its back, and a camera shake scaled by its size (a boss's lands harder).
   */
  const landingBlast = (l: number, px: number): void => {
    const fxs = fx;
    if (!fxs) return;
    const world = scene.particles.world;
    const snowy = rig.ind.species.behavior.snow;
    const grand = rig.ind.grand;
    toWorld(rig.x[rig.iS + (BODY_N >> 1)]!, 0, tmp2);
    const s = Math.max(l * 0.075, 9 * px);
    groundBlast(world, fxs, tmp2.x, l * 0.35, s, 44 + Math.round(24 * grand), snowy);
    dustAtFeet(1.5);
    if (snowy > 0) {
      // Snow shaken loose from the plates (a boss's mantle sheds a flurry).
      for (let p = 0; p < rig.plateN; p += grand > 0 ? 1 : 2) {
        rig.platePeak(p, sp);
        toWorld(sp.x, sp.y, tmp2);
        world.burst(fxs.flake, tmp2.x, tmp2.y, grand > 0 ? 5 : 2, -Math.PI / 2, Math.max(l * 0.03, 6 * px));
      }
    }
    scene.camera.addTrauma(LAND_SHAKE + LAND_SHAKE_GROW * Math.min(1, l / LAND_SHAKE_SIZE) + LAND_SHAKE_BOSS * grand);
  };

  const draw = (ctx: CanvasRenderingContext2D, v: View): void => {
    const t0 = performance.now();
    const res = ensureRes(v.palette);
    paintDragon(ctx, rig, st, res, v.camera, v.palette.light, v.palette.rimWidth);
    if (trailN > 2 && trailA > 0.02) drawTrail(ctx, v, res);
    if (showBones) drawBones(ctx, v);
    perfAcc += performance.now() - t0;
    perfN++;
    if (perfN >= 60) {
      perfShow = (perfAcc / perfN) * 1000;
      perfAcc = 0;
      perfN = 0;
    }
  };

  /** The swoosh: a tapering bright ribbon along the tail tip's recent path. */
  const drawTrail = (ctx: CanvasRenderingContext2D, v: View, res: PaintRes): void => {
    const cam = v.camera;
    ctx.save();
    cam.apply(ctx);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = res.rim;
    const w0 = Math.max(rig.back[rig.n - 4]! * L() * 2.2, 3 / cam.zoomEff);
    for (let q = 0; q < trailN - 1; q++) {
      const f = 1 - q / (trailN - 1);
      ctx.globalAlpha = trailA * 0.55 * f * f;
      ctx.lineWidth = w0 * (0.3 + 0.7 * f);
      ctx.beginPath();
      ctx.moveTo(trailX[q]!, trailY[q]!);
      ctx.lineTo(trailX[q + 1]!, trailY[q + 1]!);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawBones = (ctx: CanvasRenderingContext2D, v: View): void => {
    const l = L();
    ctx.save();
    v.camera.apply(ctx);
    ctx.translate(CLASH_X, 0);
    ctx.scale(l, l);
    const lw = 1.2 / (v.camera.zoomEff * l);
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(80,255,160,0.9)';
    ctx.beginPath();
    for (let i = 0; i < rig.n; i++) {
      if (i === 0) ctx.moveTo(rig.x[i]!, rig.y[i]!);
      else ctx.lineTo(rig.x[i]!, rig.y[i]!);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,90,200,0.8)';
    ctx.beginPath();
    for (let i = 0; i < rig.n; i++) {
      if (i === 0) ctx.moveTo(rig.tx[i]!, rig.ty[i]!);
      else ctx.lineTo(rig.tx[i]!, rig.ty[i]!);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,200,255,0.9)';
    for (let q = 0; q < 4; q++) {
      if (!rig.legOn[q]) continue;
      ctx.beginPath();
      ctx.moveTo(rig.hipX[q]!, rig.hipY[q]!);
      ctx.lineTo(rig.kneeX[q]!, rig.kneeY[q]!);
      ctx.lineTo(rig.ankX[q]!, rig.ankY[q]!);
      ctx.stroke();
    }
    // Bounds.
    ctx.strokeStyle = 'rgba(255,255,0,0.6)';
    ctx.strokeRect(rig.restMinX, rig.restMinY, rig.restMaxX - rig.restMinX, rig.restMaxY - rig.restMinY);
    ctx.restore();
  };

  const layer: Layer = { name: 'dragon', visible: true, update, draw };

  // ---- debug ----
  const dbg = scene.debug;
  if (dbg.enabled) (window as unknown as { __dragon: unknown }).__dragon = { rig, choreo, st, env };
  dbg.section('Dragon rig');
  dbg.watch('rig', () => `${perfShow.toFixed(0)} us/frame  ${rig.pxPerU.toFixed(0)} px/L  m${rig.ind ? rig.ind.maturity.toFixed(2) : '-'}`);
  dbg.watch('species', () => (rig.ind ? `${rig.ind.species.id}${rig.ind.boss ? ' / ' + rig.ind.boss.id : ''}` : '-'));
  dbg.toggle('show bones', () => showBones, (v) => (showBones = v));
  dbg.toggle('three heads', () => over?.heads === 3, (v) => {
    over = v ? { heads: 3 } : undefined;
    curId = -1;
  });
  dbg.button('shift weak spot', () => weak.shiftSoon(0));

  const setOverride = (o: Partial<Morph> | undefined): void => {
    over = o;
    curId = -1;
  };

  return { layer, view, setOverride };
}
