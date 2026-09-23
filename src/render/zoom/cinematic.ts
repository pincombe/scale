// The zoom cinematic (PLAN §4.5, ARCHITECTURE §14): the controller. It runs on its own wall clock,
// takes the camera from the in-tier director, drives the three core stages (it reacts to begin,
// dispatches switch after the snapshot and end after the card), fires the beats, and hands every
// service back so play resumes without a pop.
//
//   rally / fusion   old tier: the camera eases to the flash framing (both boots of the coming
//                    colossus span the stage); the army piles up on the hero; light leaks, it rises
//   flash            the old world is snapshotted (crowd fused away) and the core switches tiers
//                    under the flash; the colossus stands in the meadow, its boots filling the screen
//   pullback         new tier: one log-space zoom-out from the boots to the base framing; the meadow
//                    shrinks into one scale of the hide, the hide becomes the ridge, the range beyond
//   reveal / roar    the world wyrm's head rises over the range, its eye opens, it roars
//   card / done      II · THE MOUNTAIN; then the camera, the UI and the crowd are handed back, the
//                    colossus cross-fades into the crowd's hero at the same spot, size and pose
//
// State is the truth: on every resync (and at startup) the director reconciles with state.zoom, so
// a zoom begun during a silent catch-up (a hidden tab) still plays, and a stray 'switched' is ended.
import type { Scene } from '../../app/scene';
import type { View } from '../types';
import type { GameState } from '../../core';
import type { Heraldry } from '../crowd/api';
import type { ZoomBeat } from './api';
import type { WyrmPose } from '../backdrop/api';
import type { Layer } from '../types';
import { D } from '../../core/decimal';
import { ZOOM_BEATS, pullEase, span, zoomTimeline, type ZoomTimeline } from './timeline';
import { HERO_UNIT, HERO_Y, PullBack, computeFlashFraming, flashFraming } from './geometry';
import { Colossus, type FigTransform } from './colossus';
import { MeadowShot } from './meadow';
import { Pile } from './pile';
import { PUFF_DUST, PUFF_EMBER, PUFF_GLOW, Puffs, Streaks, Trail, bakeColumn, bakeRise, registerStreak } from './effects';
import { StandinHead } from './standin';
import { heroStandOff } from '../crowd/formation';
import { defaultHeraldry } from '../crowd/banner';
import { coatOf, heraldryFor, heraldryHash } from '../heraldry';
import { framing } from '../director';
import { paletteFor, type Palette } from '../palette';
import { drawHide, hideBaseColor, hidePitch, hideRowAt, hideRowY, hideScaleAt } from '../backdrop/hide';
import { TierCard } from '../../ui/tierCard';
import { KNIGHT_HEIGHT } from '../world';
import { mixHex } from '../../lib/color';
import { rect, vec2 } from '../../lib/vec';

/** Longest cinematic step per frame (s): a hitch never skips a beat's look. */
const MAX_STEP = 1 / 20;
/**
 * Tuning (live-editable under ?debug through window.__zoom.cin.knobs):
 *   haze          the mist over the ridge while the live backdrop is magnified past holding
 *   frame0/1      the pull-back progress over which the meadow's scale closes around it
 *   tdx, tdy      where the meadow's scale is, from the new hero's feet (new-tier m)
 *   streaks/trail speed effects
 */
export interface ZoomKnobs {
  haze: number;
  frame0: number;
  frame1: number;
  tdx: number;
  tdy: number;
  streaks: number;
  trail: number;
}
/** The meadow's horizon band (sun, hills, ground line), as a fraction of its height, and where in
 *  its scale's exposed face (a fraction of the row pitch below the scale's top) it shows. */
const HORIZON = 0.62;
const FACE_SHOW = 0.55;
/** The Meadow's low sun sits this many view heights right of the stage center (mirrors backdrop/meadow.ts SUN_DX). */
const SUN_DX = 0.27;
/** The hide overlay covers the live ground while the camera is closer than this (x its end zoom). */
const HIDE_UNTIL = 1.012;

export interface ZoomStart {
  from: number;
  to: number;
  /** The colossus's height (display m): the next tier's knights. */
  height: number;
  /** Debug fake: the core does not know about this zoom (fall back to a debug tier jump). */
  fake: boolean;
}

/** Per-beat CPU (ms per frame): the loop's whole frame, and this layer's share. */
export class BeatPerf {
  static readonly NAMES = ['rally', 'fusion', 'flash', 'pullback', 'reveal', 'card', 'outro'] as const;
  readonly n = new Float64Array(7);
  readonly sum = new Float64Array(7);
  readonly max = new Float64Array(7);
  readonly own = new Float64Array(7);
  readonly samples: Float32Array[] = [];
  constructor() {
    for (let i = 0; i < 7; i++) this.samples.push(new Float32Array(900));
  }
  reset(): void {
    this.n.fill(0);
    this.sum.fill(0);
    this.max.fill(0);
    this.own.fill(0);
  }
  add(seg: number, frameMs: number, ownMs: number): void {
    const i = this.n[seg]!;
    if (i < 900) this.samples[seg]![i] = frameMs;
    this.n[seg] = i + 1;
    this.sum[seg]! += frameMs;
    this.own[seg]! += ownMs;
    if (frameMs > this.max[seg]!) this.max[seg] = frameMs;
  }
  /** A readable report (debug). */
  report(): string {
    let s = '';
    for (let i = 0; i < 7; i++) {
      const n = this.n[i]!;
      if (!n) continue;
      const k = Math.min(900, n);
      const a = Array.from(this.samples[i]!.subarray(0, k)).sort((x, y) => x - y);
      const p95 = a[Math.min(k - 1, Math.floor(0.95 * (k - 1)))]!;
      s += `${BeatPerf.NAMES[i]}: ${(this.sum[i]! / n).toFixed(2)} avg / ${p95.toFixed(2)} p95 / ${this.max[i]!.toFixed(2)} max ms (zoom layer ${(this.own[i]! / n).toFixed(2)}), ${n} frames\n`;
    }
    return s;
  }
}

export class Cinematic {
  /** From zoomBegin until play resumes ('done'). */
  active = false;
  /** From zoomBegin until the last of its art has faded ('end'). */
  running = false;
  /** Seconds since zoomBegin (-1 when idle). */
  t = -1;
  /** Debug: freeze the clock at this time (-1 = run). */
  hold = -1;
  tl: ZoomTimeline = zoomTimeline(false);
  fake = false;
  /** Frame CPU source (debug: the loop's last frame), for the per-beat report. */
  frameCpu: (() => number) | null = null;
  readonly perf = new BeatPerf();
  readonly knobs: ZoomKnobs = { haze: 0, frame0: 0.55, frame1: 0.92, tdx: 0.62, tdy: 0.6, streaks: 1, trail: 0 };

  private from = 0;
  private to = 1;
  private ratio = 100;
  private gentle = false;
  private heroX0 = 0;
  private cam0Zoom = 1;
  private cam0RX = 0;
  private readonly ff = flashFraming();
  readonly geo = new PullBack();
  private rootX1 = 0;
  private readonly target = rect();
  private readonly probe = rect();
  /** The meadow's scale: its row, the row's top line and pitch, and the bottom of its exposed face (m). */
  private targetRow = 0;
  private rowTop = 0;
  private rowPitch = 1;
  private faceBottom = 0;
  private fused = false;
  private switched = false;
  private handed = false;
  private uiBack = false;
  private crowdBack = false;
  private poseOut = false;
  private cardShown = false;
  private touched = false;
  private beatIdx = 0;
  private reconciled = false;
  private hidCrowd = false;
  /** The crowd piles up itself (CrowdView.rally): the zoom only adds the light. Else the stand-in pile. */
  private realPile = false;
  /** The crowd was brought back (hidden) after the switch, so its bounds frame the new tier. */
  private crowdLive = false;
  private justSwitched = false;
  private hidDragon = false;
  private hidText = false;
  /** World layers hidden for the switch frame only (the snapshot covers the screen 1:1). */
  private readonly muted: Layer[] = [];
  private her: Heraldry | null = null;
  private herHash = Number.NaN;
  private pal: Palette | null = null;
  private dustSprite: HTMLCanvasElement | null = null;
  /** The old world's dust (warm, sunlit) and its glow; the meadow's low sun in snapshot px. */
  private warmDust: HTMLCanvasElement | null = null;
  private warmGlow: HTMLCanvasElement | null = null;
  private sunX = 0;
  private sunY = 0;
  private emberSprite: HTMLCanvasElement | null = null;
  private glowSprite: HTMLCanvasElement | null = null;
  private streakSprite: HTMLCanvasElement | null = null;
  private haze: HTMLCanvasElement | null = null;
  private column: HTMLCanvasElement | null = null;
  private hideBase = '#000';
  private whiteRamp = '#fff';
  private prevZ = 0;
  private prevRX = 0;
  private prevRY = 0;
  private focusX = 0;
  private focusY = 0;
  private speed = 0;
  private stretch = 0;
  private lastSeg = -1;
  private ownMs = 0;
  private tremorT = 0;
  private readonly pose: WyrmPose = { rise: 0, eye: 0, jaw: 0 };
  /** Debug timings (ms): the snapshot capture and the core switch, on the flash frame. */
  captureMs = 0;
  switchMs = 0;

  readonly colossus = new Colossus();
  readonly meadow = new MeadowShot();
  readonly pile = new Pile();
  readonly puffs = new Puffs();
  readonly streaks = new Streaks();
  readonly trail = new Trail();
  readonly head = new StandinHead();
  readonly card: TierCard;

  private readonly beatFns: ((beat: ZoomBeat) => void)[] = [];
  private readonly Db = rect();
  private readonly Cb = rect();
  private readonly fr = framing();
  private readonly tmp = vec2();
  private readonly vis = rect();
  private readonly tf: FigTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  constructor(private readonly scene: Scene) {
    this.card = new TierCard(scene.ui.regions.overlay);
  }

  onBeat(fn: (beat: ZoomBeat) => void): () => void {
    this.beatFns.push(fn);
    return () => {
      const i = this.beatFns.indexOf(fn);
      if (i >= 0) this.beatFns.splice(i, 1);
    };
  }

  // ---------------------------------------------------------------- start, reconcile, abort

  /** Begin the cinematic (from zoomBegin, or reconciled from state). */
  start(z: ZoomStart): void {
    if (this.running) return;
    const s = this.scene;
    const st = s.game.state;
    const cam = s.camera;
    this.gentle = s.settings.get('reduceMotion');
    this.tl = zoomTimeline(this.gentle);
    this.from = z.from;
    this.to = z.to;
    this.fake = z.fake;
    const oldHeight = st.height > 0 ? st.height : KNIGHT_HEIGHT;
    this.ratio = Math.max(2, z.height / oldHeight);
    // The hero's feet, where the army fuses (the crowd's hero point is its chest).
    s.crowd.heroPoint(this.tmp);
    this.heroX0 = this.tmp.x - 0.02;
    this.cam0Zoom = cam.zoom;
    cam.worldToScreen(this.heroX0, HERO_Y, this.tmp);
    this.cam0RX = this.tmp.x;
    const H = cam.viewH;
    const W = cam.viewW;
    const baseZoom = (s.director.heroFrac * H) / KNIGHT_HEIGHT;
    computeFlashFraming(W, H, W / 2, H / 2, this.heroX0, this.ratio, s.director.groundFrac, baseZoom, this.ff);

    // Take the camera, the UI and the backdrop.
    s.director.enabled = false;
    s.ui.setCinematic?.(true);
    s.backdrop.setTransition?.(true);
    this.realPile = typeof s.crowd.rally === 'function';
    s.crowd.rally?.(this.heroX0, this.tl.flash - 0.35);
    if (this.fake) {
      // The core is not holding: hide the fight that goes on without it.
      this.hidDragon = this.hide('dragon');
      this.hidText = this.hide('fx.text');
    }

    // Resources: the snapshot buffer now (never on the flash frame), the pile, the coat of arms.
    this.meadow.prepare(s.renderer.view);
    let n = 0;
    for (const k in st.units) n += st.units[k as keyof GameState['units']] ?? 0;
    if (!this.realPile) this.pile.bake(Math.max(6, n), this.ff.zoom * s.renderer.view.dpr * 1.2, paletteFor(this.from));
    this.her = this.heraldryOf(st);
    this.colossus.reset();
    this.puffs.clear();
    this.perf.reset();

    this.t = 0;
    this.beatIdx = 0;
    this.fused = this.switched = this.handed = this.uiBack = this.crowdBack = this.poseOut = this.cardShown = false;
    this.crowdLive = false;
    this.touched = false;
    this.prevZ = 0;
    this.lastSeg = -1;
    this.tremorT = 0;
    this.running = true;
    this.active = true;
  }

  /** State is the truth (a resync, or startup): start a zoom the events never announced, end a stray one, abort a cancelled one. */
  reconcile(): void {
    const st = this.scene.game.state;
    const z = st.zoom;
    if (!z) return;
    if (this.running) {
      if (this.fake || this.handed) return;
      const tierOk = st.tier === (this.switched ? this.to : this.from);
      const stageOk = this.switched ? z.stage === 'switched' : z.stage === 'begin';
      if (!tierOk || !stageOk) this.abort();
      return;
    }
    if (z.stage === 'begin' && z.pending) {
      this.start({ from: st.tier, to: st.tier + 1, height: z.pending.height, fake: false });
    } else if (z.stage === 'switched') {
      this.scene.game.dispatch({ type: 'zoom', stage: 'end' });
    }
  }

  /**
   * Debug: freeze the clock at `at` s (it plays on to it if it is ahead). Going back is possible
   * within the new tier only (the old tier is gone after the switch), before play resumes.
   */
  scrub(at: number): void {
    if (!(at >= 0)) {
      this.hold = -1;
      return;
    }
    this.hold = at;
    if (this.running && at < this.t && this.switched && !this.handed) this.t = Math.max(this.tl.flash, at);
  }

  /** Stage flags (debug readouts). */
  get stage(): string {
    if (!this.running) return 'idle';
    if (!this.switched) return this.t < this.tl.fuse ? 'rally' : 'fusion';
    if (!this.handed) return this.t < this.tl.pullEnd ? 'pullback' : this.t < this.tl.beats.card ? 'reveal' : 'card';
    return 'outro';
  }

  /** Canvas memory held by the zoom right now (MB). */
  memMB(): number {
    return (this.meadow.bytes() + this.pile.bytes()) / (1024 * 1024);
  }

  /**
   * Stop now and hand everything back (state changed under the zoom, or a debug abort). The core
   * never stays holding: a zoom still at 'begin' completes its switch, and 'switched' ends.
   */
  abort(): void {
    if (!this.running) return;
    const g = this.scene.game;
    const stage = (): string | null => g.state.zoom?.stage ?? null;
    if (stage() === 'begin') g.dispatch({ type: 'zoom', stage: 'switch' });
    if (stage() === 'switched') g.dispatch({ type: 'zoom', stage: 'end' });
    this.handBack(false);
    this.showCrowd();
    this.scene.ui.setCinematic?.(false);
    if (!this.poseOut) this.scene.backdrop.wyrmPose?.(null);
    this.finish();
  }

  // ---------------------------------------------------------------- per frame

  update(view: View): void {
    if (!this.reconciled) {
      this.reconciled = true;
      this.reconcile();
    }
    if (!this.running) return;
    const c0 = performance.now();
    const s = this.scene;
    let dt = view.realDt > MAX_STEP ? MAX_STEP : view.realDt;
    dt = s.time.paused ? 0 : dt * s.time.debugScale;
    if (this.hold >= 0) {
      if (this.t >= this.hold) dt = 0;
      else if (this.t + dt > this.hold) dt = this.hold - this.t;
    }
    this.t += dt;
    const t = this.t;
    const tl = this.tl;
    this.unmuteWorld();

    while (this.beatIdx < ZOOM_BEATS.length && t >= tl.beats[ZOOM_BEATS[this.beatIdx]!]) this.fire(ZOOM_BEATS[this.beatIdx++]!);

    if (!this.fused && t >= tl.fuse && !this.realPile) this.fuse();
    if (!this.switched) this.updateRally(view, dt, Math.min(t, tl.flash));
    if (!this.switched && t >= tl.flash) {
      this.doSwitch(view);
      this.justSwitched = true;
    }
    if (this.switched) {
      if (!this.crowdLive && !this.justSwitched) this.liveCrowd();
      this.justSwitched = false;
      this.updatePull(view, dt, t);
    }

    // Reveal: pose the world wyrm (or the stand-in), then let it settle and hand it back.
    if (this.switched && t >= tl.beats.reveal && !this.poseOut) {
      this.poseWyrm(t);
      if (s.backdrop.wyrmPose) s.backdrop.wyrmPose(this.pose);
      if (t >= tl.beats.done + 1.0) {
        this.poseOut = true;
        s.backdrop.wyrmPose?.(null);
      }
    }
    if (this.cardShown) {
      const out = t - (tl.beats.done + 0.15);
      this.card.update(t - tl.beats.card, out);
      if (out > 1.1) {
        this.card.hide();
        this.cardShown = false;
      }
    }
    if (!this.crowdBack && t >= tl.handoff0) this.showCrowd();
    if (this.handed && !this.uiBack && t >= tl.beats.done + 0.12) {
      this.uiBack = true;
      s.ui.setCinematic?.(false);
    }
    this.puffs.update(dt);
    if (t >= tl.end) this.finish();

    const own = performance.now() - c0 + this.ownMs;
    if (this.frameCpu && this.lastSeg >= 0) this.perf.add(this.lastSeg, this.frameCpu(), own);
    this.lastSeg = this.segment(t);
    this.ownMs = 0;
  }

  private segment(t: number): number {
    const b = this.tl.beats;
    return t < b.fusion ? 0 : t < b.flash ? 1 : t < b.pullback ? 2 : t < b.reveal ? 3 : t < b.card ? 4 : t < b.done ? 5 : 6;
  }

  private fire(beat: ZoomBeat): void {
    const s = this.scene;
    const rm = this.gentle;
    if (beat === 'roar' && !rm) s.camera.addTrauma(0.42);
    if (beat === 'card') {
      this.card.show(this.to);
      this.cardShown = true;
    }
    if (beat === 'done') this.handBack(true);
    for (let i = 0; i < this.beatFns.length; i++) {
      try {
        this.beatFns[i]!(beat);
      } catch (err) {
        console.error(`zoom beat '${beat}' listener failed:`, err);
      }
    }
  }

  /** The army is the colossus now: the crowd hides (the zoom draws it). */
  private fuse(): void {
    if (this.fused) return;
    this.fused = true;
    const crowd = this.scene.crowd;
    if (crowd.setFused) crowd.setFused(true);
    else this.hidCrowd = this.hide('crowd');
  }

  /**
   * After the switch: the crowd comes back from the new tier's state but stays hidden (the colossus
   * stands in for it) so its bounds, which the in-tier director frames by, are the new tier's.
   */
  private liveCrowd(): void {
    if (this.crowdLive) return;
    this.crowdLive = true;
    const crowd = this.scene.crowd;
    if (!crowd.setFused) return;
    if (!this.hidCrowd) this.hidCrowd = this.hide('crowd');
    crowd.setFused(false);
  }

  private showCrowd(): void {
    if (this.crowdBack) return;
    this.crowdBack = true;
    if (this.hidCrowd) this.show('crowd');
    this.hidCrowd = false;
    if (!this.crowdLive) this.scene.crowd.setFused?.(false);
    this.crowdLive = true;
  }

  /** The old tier's camera: ease from the in-tier framing to the flash framing, pushing in at the end. */
  private updateRally(view: View, dt: number, t: number): void {
    const s = this.scene;
    const cam = s.camera;
    const tl = this.tl;
    const u = smoother(span(t, 0, tl.flash - 0.4));
    const push = smoother(span(t, tl.flash - 0.55, tl.flash));
    const lz = Math.log(this.cam0Zoom) + (Math.log(this.ff.zoom) - Math.log(this.cam0Zoom)) * u + Math.log(1 + 0.035 * push);
    const z = Math.exp(lz);
    const rsx = this.cam0RX + (this.ff.rootSX - this.cam0RX) * u;
    cam.zoom = z;
    cam.x = this.heroX0 - (rsx - cam.stageCX) / z;
    cam.y = -(s.director.groundFrac * cam.viewH - cam.stageCY) / z;
    cam.derive();

    // The ground trembles under the rally (footfalls), then rumbles as the pile rises.
    if (!this.gentle && dt > 0) {
      if (t < tl.beats.fusion) {
        this.tremorT -= dt;
        if (this.tremorT <= 0) {
          this.tremorT = 0.21 + Math.random() * 0.08;
          cam.addTrauma(0.09 + 0.06 * (t / tl.beats.fusion));
        }
      } else cam.addTrauma(dt * (0.12 + 0.5 * span(t, tl.beats.fusion, tl.flash)));
    }
    // Dust from the rushing army, embers and motes rising out of the pile.
    if (dt > 0) {
      if (t < tl.fuse + 0.2 && Math.random() < dt * 22) {
        const x = (Math.random() - 0.7) * 16;
        this.puffs.spawn(PUFF_DUST, x, 0.1, (Math.random() + 0.2) * 1.6 * Math.sign(-x || 1), -0.25, 0.35 + Math.random() * 0.35, 0.5, 1.4, 0.32, Math.random() < 0.4);
      }
      if (t > tl.fuse - 0.2 && Math.random() < dt * (16 + 60 * span(t, tl.fuse, tl.flash))) {
        const w = this.pile.w;
        this.puffs.spawn(PUFF_EMBER, (Math.random() - 0.5) * w * 1.4, -Math.random() * this.pile.h * 0.8, (Math.random() - 0.5) * 1.2, -2 - Math.random() * 5, 0.06 + Math.random() * 0.1, 0.02, 0.9 + Math.random() * 0.8, 0.9, true);
      }
    }
    // Bake the shield face ahead of the flash (one level per frame), and let the snapshot's backing
    // store be allocated on a quiet frame of the fusion rather than on the flash's.
    if (this.her) this.colossus.prepareFace(this.her, paletteFor(this.to));
    if (!this.touched && t >= tl.beats.fusion + 0.3) {
      this.touched = true;
      this.meadow.touch();
    }
  }

  /** The flash: snapshot the old world, switch tiers, the colossus lands. */
  private doSwitch(view: View): void {
    const s = this.scene;
    const cam = s.camera;
    cam.worldToScreen(this.heroX0, HERO_Y, this.tmp);
    const sx0 = this.tmp.x;
    const sy0 = this.tmp.y;
    const zFlash = cam.zoom;
    // The army becomes the colossus: fused away before the old world is snapshotted.
    this.fuse();
    // The old world's low sun, where the backdrop placed it in the snapshot (for the halation).
    this.sunX = cam.stageCX + SUN_DX * view.height;
    this.sunY = paletteFor(this.from).sun.y * view.height;
    const c0 = performance.now();
    this.meadow.capture(s.renderer, view);
    this.captureMs = performance.now() - c0;
    s.game.dispatch({ type: 'zoom', stage: 'switch' });
    this.switchMs = performance.now() - c0 - this.captureMs;
    if (s.game.state.tier !== this.to) {
      // No core zoom (debug fake, or the core refused): jump the tier directly.
      s.game.dispatch({ type: 'debug', op: 'tier', amount: this.to });
      this.fake = true;
    }
    this.switched = true;
    // This frame the world layers updated for the old tier and the old camera; drawing them at the
    // new tier's camera would be wasted (and slow): the snapshot covers the screen 1:1 anyway.
    this.muteWorld();
    const pal = paletteFor(this.to);
    s.fx.flash(pal.accent.glow, 0.9, 1.3);
    s.fx.kick(1);
    if (!this.gentle) cam.addTrauma(0.55);
    // The pull-back starts exactly where the old camera was: same screen, the new tier's meters.
    const g = this.geo;
    g.snapW = this.meadow.w;
    g.snapH = this.meadow.h;
    g.sx0 = sx0;
    g.sy0 = sy0;
    g.z0 = zFlash * this.ratio;
    this.prevZ = 0;
    // The landing: a ring of dust rolling out from both soles (root-local, new-tier meters), the
    // old meadow's warm dust, some of it lit by its low sun.
    this.puffs.clear();
    const u = HERO_UNIT;
    for (let i = 0; i < 64; i++) {
      const side = i & 1 ? 1 : -1;
      const foot = i % 4 < 2 ? 11 : -10;
      const x = (foot + (Math.random() * 22 - 6)) * u;
      const v = (0.25 + Math.random() * 0.75) * side;
      const lit = i % 5 === 0;
      this.puffs.spawn(
        lit ? PUFF_GLOW : PUFF_DUST,
        x,
        -Math.random() * 0.03,
        v * (lit ? 0.6 : 1),
        -0.015 - Math.random() * 0.05,
        0.05 + Math.random() * 0.08,
        0.06 + Math.random() * 0.08,
        2.4 + Math.random() * 1.8,
        lit ? 0.26 : 0.34 + Math.random() * 0.2,
        Math.random() < 0.3,
      );
    }
  }

  /** The new tier: the pull-back camera, the colossus, the landing's dust, the streaks. */
  private updatePull(view: View, dt: number, t: number): void {
    const s = this.scene;
    const cam = s.camera;
    const st = s.game.state;
    const tl = this.tl;
    // The new hero's feet (the dragon's bounds settle a frame after the switch).
    s.dragon.bounds(this.Db);
    this.rootX1 = this.Db.x - heroStandOff(st.dragon.size);
    // The in-tier director's framing, exactly as it will frame once it takes over.
    s.crowd.bounds(this.Cb);
    const f = s.director.frame(Math.max(1, cam.viewW - cam.insetRightTarget), Math.max(1, cam.viewH), this.Db, this.Cb, this.fr);
    const ze = f.zoom;
    const camXe = f.clashX + ((0.5 - f.clashFrac) * cam.stageW) / ze;
    const camYe = -((s.director.groundFrac - 0.5) * cam.viewH) / ze;
    const g = this.geo;
    g.stageCX = cam.stageCX;
    g.stageCY = cam.stageCY;
    g.rootX = this.rootX1;
    g.rootY = HERO_Y;
    g.ze = ze;
    g.sxe = cam.stageCX + (this.rootX1 - camXe) * ze;
    g.sye = cam.stageCY + (HERO_Y - camYe) * ze;
    // The meadow's scale on the hide: ahead of the toes, a few rows toward the viewer.
    const ty = HERO_Y + this.knobs.tdy;
    const tg = hideScaleAt(this.rootX1 + this.knobs.tdx, ty, this.target);
    const n = hideRowAt(ty);
    this.targetRow = n;
    this.rowTop = hideRowY(n);
    this.rowPitch = hidePitch(n);
    // Its exposed face ends where the next row's (undulating) tops begin across its width.
    const next = hideRowY(n + 1) + 1e-4;
    let fb = Infinity;
    for (let s = 0; s < 5; s++) {
      const p = hideScaleAt(tg.x + tg.w * (0.1 + 0.2 * s), next, this.probe);
      if (p.y < fb) fb = p.y;
    }
    const fh = Math.max(0.35 * tg.h, fb - tg.y);
    this.faceBottom = tg.y + fh;
    // The face is wide and short: the meadow fills its width and sits so its horizon band (the
    // sun, the hills, the ground line) is what shows in it.
    g.ew = tg.w * 1.02;
    g.ex = tg.x - tg.w * 0.01;
    g.ey = tg.y + FACE_SHOW * fh - HORIZON * g.ew * (g.snapH / g.snapW);
    const u = span(t, tl.pullStart, tl.pullEnd);
    g.at(pullEase(u));
    cam.zoom = g.zoom;
    cam.x = g.camX;
    cam.y = g.camY;
    const groundY = g.stageCY - g.camY * g.zoom;
    cam.anchorFrac = groundY / Math.max(1, cam.viewH);
    cam.derive();

    // The zoom's fixed point (streaks converge there) and speed.
    const z = g.zoom;
    if (this.prevZ > 0 && dt > 0) {
      const dz = this.prevZ - z;
      if (dz > z * 1e-5) {
        const k = this.prevZ / dz;
        const fx = this.prevRX + k * (g.rootSX - this.prevRX);
        const fy = this.prevRY + k * (g.rootSY - this.prevRY);
        const W = cam.viewW;
        const H = cam.viewH;
        const cx = fx < -0.1 * W ? -0.1 * W : fx > 1.1 * W ? 1.1 * W : fx;
        const cy = fy < -0.1 * H ? -0.1 * H : fy > 1.1 * H ? 1.1 * H : fy;
        const a = 1 - Math.exp(-dt * 10);
        this.focusX += (cx - this.focusX) * a;
        this.focusY += (cy - this.focusY) * a;
      }
      this.speed = Math.log(this.prevZ / z) / dt;
      this.streaks.update(Math.pow(z / this.prevZ, 3));
      this.stretch = this.prevZ / z - 1;
    } else {
      this.focusX = g.rootSX;
      this.focusY = g.rootSY;
      this.speed = 0;
      this.stretch = 0;
    }
    this.prevZ = z;
    this.prevRX = g.rootSX;
    this.prevRY = g.rootSY;

    this.colossus.settle = span(t, tl.flash, tl.flash + 1.8);
    this.colossus.update(dt, view.time);
  }

  private poseWyrm(t: number): void {
    const b = this.tl.beats;
    const p = this.pose;
    const rise = smoother(span(t, b.reveal, b.reveal + 1.0));
    const settle = smoother(span(t, b.done - 0.4, b.done + 0.9));
    p.rise = rise * (1 - 0.3 * settle);
    p.eye = smoother(span(t, b.reveal + 0.5, b.reveal + 0.95)) * (1 - 0.15 * settle);
    const open = smoother(span(t, b.roar - 0.2, b.roar + 0.08));
    const shut = smoother(span(t, b.roar + 0.75, b.roar + 1.3));
    p.jaw = open * (1 - 0.85 * shut);
  }

  /** Play resumes: the core ends the zoom, the in-tier director takes the camera exactly where it is. */
  private handBack(dispatchEnd: boolean): void {
    if (this.handed) return;
    this.handed = true;
    this.active = false;
    const s = this.scene;
    if (dispatchEnd && s.game.state.zoom?.stage === 'switched') s.game.dispatch({ type: 'zoom', stage: 'end' });
    s.director.snap();
    s.director.enabled = true;
    s.backdrop.setTransition?.(false);
    if (this.hidDragon) this.show('dragon');
    if (this.hidText) this.show('fx.text');
    this.hidDragon = this.hidText = false;
  }

  private finish(): void {
    this.unmuteWorld();
    if (!this.handed) this.handBack(false);
    if (!this.crowdBack) this.showCrowd();
    if (!this.uiBack) {
      this.uiBack = true;
      this.scene.ui.setCinematic?.(false);
    }
    if (!this.poseOut) {
      this.poseOut = true;
      this.scene.backdrop.wyrmPose?.(null);
    }
    if (this.beatIdx < ZOOM_BEATS.length) {
      // Aborted: never leave a listener waiting for 'done'.
      this.beatIdx = ZOOM_BEATS.length;
      for (let i = 0; i < this.beatFns.length; i++) this.beatFns[i]!('done');
    }
    this.card.hide();
    this.cardShown = false;
    this.meadow.release();
    this.pile.release();
    this.colossus.release();
    this.trail.release();
    this.puffs.clear();
    this.running = false;
    this.active = false;
    this.t = -1;
    this.hold = -1;
  }

  private muteWorld(): void {
    const list = this.scene.renderer.layerList;
    for (let i = 0; i <= 4 && i < list.length; i++) {
      const l = list[i]!;
      if (l.visible) {
        l.visible = false;
        this.muted.push(l);
      }
    }
  }

  private unmuteWorld(): void {
    const m = this.muted;
    for (let i = 0; i < m.length; i++) m[i]!.visible = true;
    m.length = 0;
  }

  private hide(name: string): boolean {
    const l: Layer | undefined = this.scene.renderer.layer(name);
    if (!l || !l.visible) return false;
    l.visible = false;
    return true;
  }

  private show(name: string): void {
    const l = this.scene.renderer.layer(name);
    if (l) l.visible = true;
  }

  private heraldryOf(st: GameState): Heraldry {
    const h = st.heraldry;
    const hash = h ? heraldryHash(h) : 0;
    if (this.her && hash === this.herHash) return this.her;
    this.herHash = hash;
    try {
      return h ? heraldryFor(coatOf(h)) : defaultHeraldry(paletteFor(this.to));
    } catch {
      return defaultHeraldry(paletteFor(this.to));
    }
  }

  // ---------------------------------------------------------------- drawing

  private ensureArt(p: Palette): void {
    if (p === this.pal) return;
    this.pal = p;
    const atlas = this.scene.atlas;
    const sp = this.scene.sprites;
    this.dustSprite = atlas.canvas(atlas.tint(sp.smoke, mixHex(p.haze, p.silhouette, 0.45)));
    this.emberSprite = atlas.canvas(atlas.tint(sp.glow, p.accent.glow));
    this.glowSprite = atlas.canvas(atlas.tint(sp.glow, mixHex(p.accent.glow, p.rim, 0.3)));
    this.streakSprite = atlas.canvas(atlas.tint(registerStreak(atlas), mixHex(p.rim, '#ffffff', 0.35)));
    this.haze = bakeRise(mixHex(p.haze, p.depthTint ?? p.haze, 0.35), 0.94);
    this.column = bakeColumn(mixHex(p.accent.glow, '#ffffff', 0.4), 1);
    this.hideBase = hideBaseColor(p);
    this.whiteRamp = mixHex(p.accent.glow, '#ffffff', 0.6);
    const old = paletteFor(this.from);
    this.warmDust = atlas.canvas(atlas.tint(sp.smoke, mixHex(old.haze, old.silhouette, 0.38)));
    this.warmGlow = atlas.canvas(atlas.tint(sp.glow, mixHex(old.sun.glow, '#fff2d6', 0.35)));
  }

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    if (!this.running) return;
    const c0 = performance.now();
    if (!this.switched) this.drawRally(ctx, view);
    else this.drawPull(ctx, view);
    this.ownMs += performance.now() - c0;
  }

  /** Old tier: the pile, its light, the column rising, and the white-out into the flash. */
  private drawRally(ctx: CanvasRenderingContext2D, view: View): void {
    const t = this.t;
    const tl = this.tl;
    this.ensureArt(paletteFor(this.to));
    const cam = view.camera;
    const dpr = view.dpr;
    const A = cam.a * dpr;
    const B = cam.b * dpr;
    const C = cam.c * dpr;
    const Dd = cam.d * dpr;
    const E = cam.e * dpr;
    const F = cam.f * dpr;
    const grow = smoother(span(t, tl.fuse - 0.2, tl.fuse + 0.45));
    const lift = smoother(span(t, tl.flash - 0.75, tl.flash));
    const build = span(t, tl.fuse, tl.flash);
    // The dust of the rally (behind), the pile (the crowd's own, or the stand-in), the embers.
    this.puffs.draw(ctx, cam, dpr, this.warmDust!, PUFF_DUST, 0, 1, this.heroX0, 0);
    if (!this.realPile) this.pile.draw(ctx, A, B, C, Dd, E, F, this.heroX0, HERO_Y, grow, lift, 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.puffs.draw(ctx, cam, dpr, this.warmDust!, PUFF_DUST, 1, 1, this.heroX0, 0);
    if (grow <= 0.001) return;
    // Light leaking from the pile: a hot core, rays between the bodies, then the rising column.
    // The crowd's pile carries the hero on top: its height is how high he rides.
    const z = cam.zoomEff;
    let pileH = this.pile.h;
    if (this.realPile) {
      this.scene.crowd.heroPoint(this.tmp);
      pileH = Math.max(1.6, HERO_Y - this.tmp.y + 0.5);
    }
    cam.worldToScreen(this.heroX0, HERO_Y - pileH * 0.45 * (1 + 0.5 * lift), this.tmp);
    const cx = this.tmp.x;
    const cy = this.tmp.y;
    const ph = pileH * z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.85 + 0.15 * Math.sin(t * 31) * Math.sin(t * 17.3);
    const g = this.glowSprite!;
    let r = ph * (0.9 + 1.4 * build + 1.5 * lift);
    ctx.globalAlpha = Math.min(1, (0.25 + 0.75 * build) * flick * grow);
    ctx.drawImage(g, cx - r, cy - r, r * 2, r * 2);
    r *= 0.45;
    ctx.globalAlpha = Math.min(1, 0.4 + 0.6 * build);
    ctx.drawImage(g, cx - r, cy - r, r * 2, r * 2);
    // Rays: thin shafts fanning up out of the heap.
    const sp = this.streakSprite!;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.19 + 0.05 * Math.sin(t * 2.3 + i * 1.7);
      const L = ph * (1.2 + 2.2 * build + 4 * lift) * (0.7 + 0.3 * ((i * 37) % 5) / 4);
      const w = Math.max(2, ph * 0.08 * (1 + lift));
      ctx.globalAlpha = Math.min(1, 0.18 * build * (0.6 + 0.4 * Math.sin(t * (5 + i) + i)));
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      ctx.setTransform((cs * L * dpr) / sp.width, (sn * L * dpr) / sp.width, (-sn * w * dpr) / sp.height, (cs * w * dpr) / sp.height, cx * dpr, cy * dpr);
      ctx.drawImage(sp, 0, -sp.height / 2);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The column: the pile rising into light, up and off the top of the frame.
    if (lift > 0.001) {
      const col = this.column!;
      const w = ph * (0.9 + 2 * lift);
      ctx.globalAlpha = Math.min(1, lift);
      ctx.drawImage(col, cx - w / 2, -20, w, cy + 20 + ph * 0.25);
      ctx.globalAlpha = Math.min(1, lift * 0.55);
      ctx.drawImage(col, cx - w * 1.5, -20, w * 3, cy + 20 + ph * 0.2);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.puffs.draw(ctx, cam, dpr, this.emberSprite!, PUFF_EMBER, 1, 1, this.heroX0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // White-out into the flash (the post flash takes over at the switch).
    const wo = span(t, tl.flash - 0.16, tl.flash);
    if (wo > 0) {
      const soft = this.scene.settings.get('reduceFlashes') ? 0.3 : 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = wo * wo * 0.85 * soft;
      ctx.fillStyle = this.whiteRamp;
      ctx.fillRect(0, 0, view.width, view.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  /** New tier: the haze, the hide, the meadow in its scale, the colossus, dust, streaks, trails. */
  private drawPull(ctx: CanvasRenderingContext2D, view: View): void {
    const t = this.t;
    const tl = this.tl;
    const b = tl.beats;
    const pal = paletteFor(this.to);
    this.ensureArt(pal);
    const cam = view.camera;
    const dpr = view.dpr;
    const W = view.width;
    const H = view.height;
    const g = this.geo;
    const mag = g.zoom / g.ze;
    const groundY = cam.stageCY + (0 - cam.y) * cam.zoomEff + cam.shakeY;

    // Haze over the ridge: the live backdrop's middle distance, magnified past what it can hold.
    const hz = clamp01(Math.log(mag / 1.3) / Math.log(3.2)) * this.knobs.haze;
    if (hz > 0.002) {
      ctx.globalAlpha = hz;
      ctx.drawImage(this.haze!, -8, groundY - H * 1.05, W + 16, H * 1.05 + 2);
      ctx.globalAlpha = 1;
    }

    // The reveal's stand-in head (when the backdrop cannot pose its own).
    if (!this.scene.backdrop.wyrmPose && t >= b.reveal) {
      const fade = 1 - smoother(span(t, b.done + 0.2, b.done + 1.0));
      this.head.draw(ctx, W, H, groundY, this.pose, pal, t, fade);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // The hide, wherever the live ground is magnified past holding.
    if (mag > HIDE_UNTIL) {
      ctx.save();
      cam.apply(ctx);
      cam.visibleRect(this.vis, 16);
      const v = this.vis;
      if (v.y + v.h > 0) drawHide(ctx, pal, v.x, Math.max(0, v.y), v.x + v.w, v.y + v.h, cam.zoomEff, pal.light.x, pal.light.y);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // The meadow, closing into its scale; the next rows of the hide overlap its lower edge.
    const fade = 1 - smoother(span(t, b.done, b.done + 1.0));
    const e = pullEase(span(t, tl.pullStart, tl.pullEnd));
    const frame = smoother(span(e, this.knobs.frame0, this.knobs.frame1));
    const mw = g.k * g.snapW;
    const mh = g.k * g.snapH;
    const mx = g.ax + cam.shakeX;
    const my = g.ay + cam.shakeY;
    // The plate closes from the image's own rect onto its scale's exposed face. It is defined in the
    // image's coordinates (where the face will sit on the image once it lands), so while it closes it
    // stays on the meadow's golden horizon band, whatever the image and the camera are doing.
    const tg = this.target;
    const eh = g.ew * (g.snapH / g.snapW);
    const fu0 = (tg.x - g.ex) / g.ew;
    const fv0 = (tg.y - 0.04 * tg.h - g.ey) / eh;
    const fu1 = (tg.x + tg.w - g.ex) / g.ew;
    const fv1 = (this.faceBottom + 0.3 * tg.h - g.ey) / eh;
    const pu0 = fu0 * frame;
    const pv0 = fv0 * frame;
    const pxp = mx + mw * pu0;
    const pyp = my + mh * pv0;
    const pwp = mw * (1 + (fu1 - fu0 - 1) * frame);
    const php = mh * (1 + (fv1 - fv0 - 1) * frame);
    this.meadow.draw(ctx, mx, my, mw, mh, pxp, pyp, pwp, php, frame, pal, this.hideBase, fade);
    // The meadow is lit by its own low sun: a warm glow the eye can find on the hide, strongest as
    // it settles into its scale and while the card holds.
    const shine = fade * smoother(span(e, 0.5, 0.95)) * (0.8 + 0.2 * Math.sin(t * 2.4));
    if (shine > 0.01) {
      const gs = this.glowSprite!;
      const r = Math.max(pwp, 40) * 1.2;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.7 * shine;
      ctx.drawImage(gs, pxp + pwp * 0.5 - r, pyp + php * 0.4 - r * 0.62, r * 2, r * 1.24);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (frame > 0.5 && fade > 0.01) {
      ctx.save();
      cam.apply(ctx);
      cam.visibleRect(this.vis, 16);
      const bottom = this.vis.y + this.vis.h;
      // Rows below the meadow's own (drawHide skips a row whose shapes end above `top`).
      const top = this.rowTop + 2.2 * this.rowPitch + 1e-4;
      if (bottom > top) drawHide(ctx, pal, tg.x - tg.w * 0.7, top, tg.x + tg.w * 1.7, bottom, cam.zoomEff, pal.light.x, pal.light.y);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // The colossus, with the landing's dust around its soles.
    const cA = 1 - smoother(span(t, tl.handoff0, tl.handoff1));
    this.puffs.draw(ctx, cam, dpr, this.warmDust!, PUFF_DUST, 0, cA, this.rootX1, 0);
    const k = HERO_UNIT;
    const rx = this.rootX1;
    const ry = HERO_Y;
    const tf = this.tf;
    tf.a = cam.a * dpr * k;
    tf.b = cam.b * dpr * k;
    tf.c = cam.c * dpr * k;
    tf.d = cam.d * dpr * k;
    tf.e = (cam.a * rx + cam.c * ry + cam.e) * dpr;
    tf.f = (cam.b * rx + cam.d * ry + cam.f) * dpr;
    const pxu = cam.zoomEff * dpr * k;
    const detail = smoother(clamp01((cam.zoomEff * k - 3.4) / 5));
    this.colossus.draw(ctx, tf, pxu, dpr, pal, this.her ?? defaultHeraldry(pal), detail, cA);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.puffs.draw(ctx, cam, dpr, this.warmDust!, PUFF_DUST, 1, cA, this.rootX1, 0);
    ctx.globalCompositeOperation = 'lighter';
    this.puffs.draw(ctx, cam, dpr, this.warmGlow!, PUFF_GLOW, 0, cA, this.rootX1, 0);
    this.puffs.draw(ctx, cam, dpr, this.warmGlow!, PUFF_GLOW, 1, cA, this.rootX1, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Halation: the old world's low sun, right behind the boots, blooms over the colossus's edges.
    const halo = 0.3 * smoother(span(g.k, 0.22, 0.75)) * fade;
    if (halo > 0.01) {
      const hx = mx + g.k * this.sunX;
      const hy = my + g.k * this.sunY;
      const R = g.k * H * 0.42;
      ctx.globalAlpha = halo;
      ctx.drawImage(this.warmGlow!, hx - R, hy - R, R * 2, R * 2);
      ctx.globalAlpha = halo * 0.8;
      ctx.drawImage(this.warmGlow!, hx - R * 0.35, hy - R * 0.35, R * 0.7, R * 0.7);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';

    // Speed: streaks converging on the zoom's fixed point, and trails of the frame itself.
    const pace = clamp01((this.speed - 0.15) / 0.7);
    if (pace > 0.01) {
      const amount = (this.gentle ? 0.35 : 1) * pace * this.knobs.streaks;
      const halfDiag = 0.5 * Math.hypot(W, H);
      this.streaks.draw(ctx, dpr, this.focusX, this.focusY, halfDiag, this.speed, amount, this.streakSprite!);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!this.gentle) this.trail.draw(ctx, this.focusX, this.focusY, dpr, this.stretch * 2.5, pace * this.knobs.trail);
    }
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoother(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** A synthetic zoomBegin for the debug fake path (the core has no zoom rules yet). */
export function fakeZoomBegin(from: number): { type: 'zoomBegin'; from: number; to: number; scales: ReturnType<typeof D>; fusion: number; height: number } {
  return { type: 'zoomBegin', from, to: from + 1, scales: D(5), fusion: 2, height: 212 };
}
