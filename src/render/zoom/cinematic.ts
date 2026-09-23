// The zoom cinematic (PLAN §4.5, ARCHITECTURE §14): the controller. It runs on its own wall clock,
// takes the camera from the in-tier director, drives the three core stages (it reacts to begin,
// dispatches switch after the snapshot and end after the card), fires the beats, and hands every
// service back so play resumes without a pop.
//
//   rally / fusion   old tier: the camera eases to the flash framing (both boots of the coming
//                    colossus span the stage); the army piles up on the hero; light leaks, it rises
//   flash            the old world is snapshotted (crowd fused away) and the core switches tiers
//                    under the flash; the colossus stands in the meadow, its boots filling the screen
//   boots            the camera rests on them: the meadow all around (the snapshot is the screen)
//   pullback         the camera pulls back and the meadow closes into one scale of the hide, just in
//                    front of the colossus's toes: its frame morphs from the screen's rectangle into
//                    the scale's plate while the hide fills in around it, the land beyond lost in
//                    cloud; the scale holds (a slow drift, a sheen sweeping across it, its warm light
//                    on the boots); then the pull-back resumes, the rows in front settle over it, the
//                    cloud sinks and the ridge, the range and the sky rise out of it
//   reveal / roar    the world wyrm's head rises over the range, its eye opens, it roars
//   card / done      II · THE MOUNTAIN; then the camera, the UI and the crowd are handed back, the
//                    colossus cross-fades into the crowd's hero at the same spot, size and pose, the
//                    knee mist over both; the backdrop keeps the meadow's scale faintly warm
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
import { ZOOM_BEATS, span, zoomTimeline, type ZoomTimeline } from './timeline';
import { CameraPath, HERO_UNIT, HERO_Y, MeadowMorph, Stroke, computeFlashFraming, flashFraming, smootherstep } from './geometry';
import { Colossus, type FigTransform } from './colossus';
import { MeadowShot } from './meadow';
import { LIFT, MeadowPlate } from './plate';
import { MistBank } from './mist';
import { PUFF_DUST, PUFF_EMBER, PUFF_GLOW, Puffs, Streaks, bakeColumn, registerStreak } from './effects';
import { heroStandOff } from '../crowd/formation';
import { defaultHeraldry } from '../crowd/banner';
import { coatOf, heraldryFor, heraldryHash } from '../heraldry';
import { framing } from '../director';
import { paletteFor, type Palette } from '../palette';
import { drawHide, traceRows } from '../backdrop/hide';
import { TierCard } from '../../ui/tierCard';
import { KNIGHT_HEIGHT } from '../world';
import { mixHex } from '../../lib/color';
import { rect, vec2 } from '../../lib/vec';

/** Longest cinematic step per frame (s): a hitch never skips a beat's look. */
const MAX_STEP = 1 / 20;
/** The meadow in its scale fades to this as the camera lands (the backdrop's keepsake: hide.ts). */
const KEEPSAKE = 0.4;
/**
 * Tuning (live-editable under ?debug through window.__zoom.cin.knobs):
 *   holdW         the meadow's scale at its hold, as a fraction of the stage width
 *   holdX, holdY  where its center sits then (fractions of the stage width, the view height)
 *   drift         how far the camera drifts back during the hold (zoom ratio)
 *   streaks       speed lines through the fast part of the pull-back
 */
export interface ZoomKnobs {
  holdW: number;
  holdX: number;
  holdY: number;
  drift: number;
  streaks: number;
}

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
  static readonly NAMES = ['rally', 'fusion', 'switch', 'boots', 'closing', 'hold', 'landscape', 'card', 'outro'] as const;
  static readonly N = 9;
  readonly n = new Float64Array(BeatPerf.N);
  readonly sum = new Float64Array(BeatPerf.N);
  readonly max = new Float64Array(BeatPerf.N);
  readonly own = new Float64Array(BeatPerf.N);
  readonly samples: Float32Array[] = [];
  constructor() {
    for (let i = 0; i < BeatPerf.N; i++) this.samples.push(new Float32Array(900));
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
    for (let i = 0; i < BeatPerf.N; i++) {
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
  readonly knobs: ZoomKnobs = { holdW: 0.2, holdX: 0.54, holdY: 0.75, drift: 1.07, streaks: 0.7 };

  private from = 0;
  private to = 1;
  private ratio = 100;
  private gentle = false;
  private heroX0 = 0;
  private cam0Zoom = 1;
  private cam0RX = 0;
  private readonly ff = flashFraming();
  readonly path = new CameraPath();
  readonly morph = new MeadowMorph();
  readonly plate = new MeadowPlate();
  readonly mist = new MistBank();
  private rootX1 = 0;
  /** The meadow picture at the switch, relative to the root (world m): x, y offsets and size. */
  private r0x = 0;
  private r0y = 0;
  private r0w = 1;
  private r0h = 1;
  /** The old world's low sun in the snapshot (fractions of its size). */
  private sunU = 0.6;
  private sunV = 0.5;
  private fused = false;
  private switched = false;
  private handed = false;
  private uiBack = false;
  private crowdBack = false;
  private poseOut = false;
  private cardShown = false;
  private touched = false;
  private marked = false;
  private beatIdx = 0;
  private reconciled = false;
  private hidCrowd = false;
  /** The crowd was brought back (hidden) after the switch, so its bounds frame the new tier. */
  private crowdLive = false;
  private justSwitched = false;
  private hidDragon = false;
  private hidText = false;
  /** World layers hidden this frame (the zoom's own art covers the whole screen). */
  private readonly muted: Layer[] = [];
  private her: Heraldry | null = null;
  private herHash = Number.NaN;
  private pal: Palette | null = null;
  /** The old world's dust (warm, sunlit) and its glow. */
  private warmDust: HTMLCanvasElement | null = null;
  private warmGlow: HTMLCanvasElement | null = null;
  private emberSprite: HTMLCanvasElement | null = null;
  private glowSprite: HTMLCanvasElement | null = null;
  private streakSprite: HTMLCanvasElement | null = null;
  private column: HTMLCanvasElement | null = null;
  private whiteRamp = '#fff';
  private focusX = 0;
  private focusY = 0;
  private lastSeg = -1;
  private ownMs = 0;
  private tremorT = 0;
  private readonly pose: WyrmPose = { rise: 0, eye: 0, jaw: 0 };
  /** Debug timings (ms): the snapshot capture and the core switch, on the flash frame. */
  captureMs = 0;
  switchMs = 0;

  readonly colossus = new Colossus();
  readonly meadow = new MeadowShot();
  readonly puffs = new Puffs();
  readonly streaks = new Streaks();
  readonly card: TierCard;

  private readonly beatFns: ((beat: ZoomBeat) => void)[] = [];
  private readonly Db = rect();
  private readonly Cb = rect();
  private readonly fr = framing();
  private readonly tmp = vec2();
  private readonly vis = rect();
  private readonly tf: FigTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  /** The knee mist over the colossus as it becomes the hero (bound once: no per-frame closure). */
  private mistA = 0;
  private readonly kneeMist = (g: CanvasRenderingContext2D, ox: number, oy: number): void => {
    const s = this.scene;
    const v = s.renderer.view;
    if (!s.backdrop.drawKneeMist || this.mistA <= 0.002) return;
    g.setTransform(v.dpr, 0, 0, v.dpr, -ox, -oy);
    g.globalAlpha = this.mistA;
    s.backdrop.drawKneeMist(g, v);
  };

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

    // Take the camera, the UI and the backdrop; the next tier's art starts baking now.
    s.director.enabled = false;
    s.ui.setCinematic?.(true);
    s.backdrop.setTransition?.(true);
    s.backdrop.prepare?.(this.to);
    s.crowd.prepareTier?.(this.to);
    s.crowd.rally?.(this.heroX0, this.tl.flash - 0.35);
    if (this.fake) {
      // The core is not holding: hide the fight that goes on without it.
      this.hidDragon = this.hide('dragon');
      this.hidText = this.hide('fx.text');
    }

    // Resources: the snapshot buffer now (never on the flash frame), the coat of arms.
    this.meadow.prepare(s.renderer.view);
    this.her = this.heraldryOf(st);
    this.colossus.reset();
    this.puffs.clear();
    this.perf.reset();
    this.plate.chosen = false;

    this.t = 0;
    this.beatIdx = 0;
    this.fused = this.switched = this.handed = this.uiBack = this.crowdBack = this.poseOut = this.cardShown = false;
    this.crowdLive = false;
    this.touched = false;
    this.marked = false;
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
    if (!this.handed) {
      const t = this.t;
      const tl = this.tl;
      return t < tl.pullStart ? 'boots' : t < tl.holdStart ? 'closing' : t < tl.holdEnd ? 'hold' : t < tl.pullEnd ? 'landscape' : 'card';
    }
    return 'outro';
  }

  /** Canvas memory held by the zoom right now (MB). */
  memMB(): number {
    return (this.meadow.bytes() + this.mist.bytes()) / (1024 * 1024);
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
    if (!this.switched) this.scene.backdrop.prepare?.(null);
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

    // Reveal: pose the world wyrm, then let it settle and hand it back.
    if (this.switched && t >= tl.beats.reveal && !this.poseOut) {
      this.poseWyrm(t);
      s.backdrop.wyrmPose?.(this.pose);
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
    const tl = this.tl;
    const b = tl.beats;
    if (t < b.fusion) return 0;
    if (t < b.flash) return 1;
    if (t < b.flash + 0.05) return 2;
    if (t < tl.pullStart) return 3;
    if (t < tl.holdStart) return 4;
    if (t < tl.holdEnd) return 5;
    if (t < tl.pullEnd) return 6;
    return t < b.done ? 7 : 8;
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
        const w = 2.2;
        this.puffs.spawn(PUFF_EMBER, (Math.random() - 0.5) * w * 1.4, -Math.random() * this.pileHeight() * 0.8, (Math.random() - 0.5) * 1.2, -2 - Math.random() * 5, 0.06 + Math.random() * 0.1, 0.02, 0.9 + Math.random() * 0.8, 0.9, true);
      }
    }
    // Bake the shield face ahead of the flash (one level per frame), the mist bank and the plate's
    // sprites once, and let the snapshot's backing store be allocated on a quiet frame of the
    // fusion rather than on the flash's.
    const pal = paletteFor(this.to);
    if (this.her) this.colossus.prepareFace(this.her, pal);
    if (t >= tl.beats.fusion - 0.4 && !this.mist.canvas) this.mist.ensure(pal);
    else if (t >= tl.beats.fusion - 0.2) this.plate.ensureArt(pal, paletteFor(this.from));
    if (!this.touched && t >= tl.beats.fusion + 0.3) {
      this.touched = true;
      this.meadow.touch();
    }
  }

  /** The pile's height (m): how high the hero rides on the crowd's heap. */
  private pileHeight(): number {
    this.scene.crowd.heroPoint(this.tmp);
    return Math.max(1.6, HERO_Y - this.tmp.y + 0.5);
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
    // The old world's low sun in the snapshot (for the halation), from the backdrop itself.
    if (s.backdrop.sunPoint) {
      s.backdrop.sunPoint(this.tmp);
      this.sunU = this.tmp.x / Math.max(1, view.width);
      this.sunV = this.tmp.y / Math.max(1, view.height);
    }
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
    // This frame the world layers updated for the old tier and the old camera: the snapshot covers
    // the screen anyway (and the zoom's art keeps covering it until the land beyond shows).
    this.muteWorld();
    const pal = paletteFor(this.to);
    s.fx.flash(pal.accent.glow, 0.9, 1.3);
    s.fx.kick(1);
    if (!this.gentle) cam.addTrauma(0.55);
    // The camera path starts exactly where the old camera was: same screen, the new tier's meters.
    const P = this.path;
    const tl = this.tl;
    P.pullStart = tl.pullStart;
    P.holdStart = tl.holdStart;
    P.holdEnd = tl.holdEnd;
    P.pullEnd = tl.pullEnd;
    P.z0 = zFlash * this.ratio;
    P.sx0 = sx0;
    P.sy0 = sy0;
    // The meadow picture: the screen, a little larger about the colossus's feet (the flash's shake
    // never uncovers its edge), in the new tier's meters relative to his root.
    const W = view.width;
    const H = view.height;
    const q = 1 + Math.min(0.08, Math.max(0.02, 14 / Math.max(1, Math.min(sx0, W - sx0, sy0, H - sy0))));
    this.r0x = (-q * sx0) / P.z0;
    this.r0y = (-q * sy0) / P.z0;
    this.r0w = (q * W) / P.z0;
    this.r0h = (q * H) / P.z0;
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
        lit ? -0.005 - Math.random() * 0.015 : -0.015 - Math.random() * 0.05,
        lit ? 0.03 + Math.random() * 0.04 : 0.05 + Math.random() * 0.08,
        lit ? 0.03 + Math.random() * 0.04 : 0.06 + Math.random() * 0.08,
        lit ? 1.6 + Math.random() * 1.2 : 2.4 + Math.random() * 1.8,
        lit ? 0.16 : 0.34 + Math.random() * 0.2,
        Math.random() < 0.3,
      );
    }
  }

  /** The new tier: the camera path, the meadow closing into its scale, the colossus, the dust. */
  private updatePull(view: View, dt: number, t: number): void {
    const s = this.scene;
    const cam = s.camera;
    const st = s.game.state;
    const tl = this.tl;
    // The new hero's feet: where the crowd will stand him (the dragon's bounds settle a frame
    // after the switch, so this is read every frame until the plate is chosen).
    s.dragon.bounds(this.Db);
    if (s.crowd.heroRest) this.rootX1 = s.crowd.heroRest(this.tmp).x;
    else this.rootX1 = this.Db.x - heroStandOff(st.dragon.size);
    // The in-tier director's framing, exactly as it will frame once it takes over.
    s.crowd.bounds(this.Cb);
    const f = s.director.frame(Math.max(1, cam.viewW - cam.insetRightTarget), Math.max(1, cam.viewH), this.Db, this.Cb, this.fr);
    const ze = f.zoom;
    const camXe = f.clashX + ((0.5 - f.clashFrac) * cam.stageW) / ze;
    const camYe = -((s.director.groundFrac - 0.5) * cam.viewH) / ze;
    const P = this.path;
    P.rootX = this.rootX1;
    P.rootY = HERO_Y;
    P.stageCX = cam.stageCX;
    P.stageCY = cam.stageCY;
    P.ze = ze;
    P.sxe = cam.stageCX + (this.rootX1 - camXe) * ze;
    P.sye = cam.stageCY + (HERO_Y - camYe) * ze;

    // The meadow's scale, chosen as the pull-back starts (the new tier has settled by then).
    const pl = this.plate;
    const aspect = this.meadow.h / Math.max(1, this.meadow.w);
    if (!pl.chosen && t >= tl.pullStart - 0.25) {
      pl.choose(this.rootX1, HERO_Y, aspect);
      const m = this.morph;
      m.rootX = this.rootX1;
      m.rootY = HERO_Y;
      m.x1 = pl.x;
      m.y1 = pl.y;
      m.w1 = pl.w;
    }
    // The hold: the scale a fifth of the stage wide, low center; the colossus stands above it.
    const k = this.knobs;
    if (pl.chosen) {
      const zh = (k.holdW * cam.stageW) / (pl.s.sx * 2);
      const px = cam.stageCX + (k.holdX - 0.5) * cam.stageW;
      const py = k.holdY * cam.viewH;
      P.zh = zh;
      P.sxh = px + (this.rootX1 - pl.cx) * zh;
      P.syh = py + (HERO_Y - pl.cy) * zh;
      P.zh2 = zh / Math.max(1.0001, k.drift);
      P.fhx = px;
      P.fhy = py;
      if (!this.marked && t >= tl.holdStart) {
        // The backdrop keeps this scale warm, the old tier faint inside it, for the rest of the tier.
        this.marked = true;
        s.backdrop.markScale?.({ x: pl.s.cx, y: pl.s.rowY + pl.s.pitch * 0.5, picture: this.meadow.thumbnail(), lift: LIFT });
      }
    } else {
      P.zh = P.z0;
      P.sxh = P.sx0;
      P.syh = P.sy0;
      P.zh2 = P.z0;
      P.fhx = P.sx0;
      P.fhy = P.sy0;
    }
    P.at(t);
    cam.zoom = P.zoom;
    cam.x = P.camX;
    cam.y = P.camY;
    cam.anchorFrac = (P.stageCY - P.camY * P.zoom) / Math.max(1, cam.viewH);
    cam.derive();

    // The meadow picture (world rect), condensing into the scale over the first stroke.
    const m = this.morph;
    m.x0 = this.rootX1 + this.r0x;
    m.y0 = HERO_Y + this.r0y;
    m.w0 = this.r0w;
    m.h0 = this.r0h;
    m.rootX = this.rootX1;
    if (!pl.chosen) {
      m.x1 = m.x0;
      m.y1 = m.y0;
      m.w1 = m.w0;
    }
    m.at(span(t, tl.pullStart, tl.holdStart));

    // The zoom's fixed point (streaks converge there).
    if (P.speed < -0.01 && dt > 0) {
      const a = 1 - Math.exp(-dt * 10);
      this.focusX += (P.rootSX - this.focusX) * a;
      this.focusY += (P.rootSY - this.focusY) * a;
      this.streaks.update(Math.exp(P.speed * dt * 3));
    } else {
      this.focusX = P.rootSX;
      this.focusY = P.rootSY;
    }

    this.colossus.settle = span(t, tl.flash, tl.flash + 1.8);
    this.colossus.update(dt, view.time);
    this.meadow.step();
    // While the zoom's own art covers the whole screen (the meadow, then the hide and the cloud),
    // the world layers need not draw.
    if (t < tl.holdEnd + 0.2 && P.stage !== Stroke.Landed) this.muteWorld();
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
    this.mist.release();
    this.plate.release();
    this.colossus.release();
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
    this.emberSprite = atlas.canvas(atlas.tint(sp.glow, p.accent.glow));
    this.glowSprite = atlas.canvas(atlas.tint(sp.glow, mixHex(p.accent.glow, p.rim, 0.3)));
    this.streakSprite = atlas.canvas(atlas.tint(registerStreak(atlas), mixHex(p.rim, '#ffffff', 0.35)));
    this.column = bakeColumn(mixHex(p.accent.glow, '#ffffff', 0.4), 1);
    this.whiteRamp = mixHex(p.accent.glow, '#ffffff', 0.6);
    const old = paletteFor(this.from);
    this.warmDust = atlas.canvas(atlas.tint(sp.smoke, mixHex(old.haze, old.silhouette, 0.38)));
    this.warmGlow = atlas.canvas(atlas.tint(sp.glow, mixHex(old.sun.glow, '#fff2d6', 0.35)));
    this.plate.ensureArt(p, old);
    this.mist.ensure(p);
  }

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    if (!this.running) return;
    const c0 = performance.now();
    if (!this.switched) this.drawRally(ctx, view);
    else this.drawPull(ctx, view);
    this.ownMs += performance.now() - c0;
  }

  /** Old tier: the pile's light, the column rising, and the white-out into the flash. */
  private drawRally(ctx: CanvasRenderingContext2D, view: View): void {
    const t = this.t;
    const tl = this.tl;
    this.ensureArt(paletteFor(this.to));
    const cam = view.camera;
    const dpr = view.dpr;
    const grow = smoother(span(t, tl.fuse - 0.2, tl.fuse + 0.45));
    const lift = smoother(span(t, tl.flash - 0.75, tl.flash));
    const build = span(t, tl.fuse, tl.flash);
    // The dust of the rally around the crowd's pile.
    this.puffs.draw(ctx, cam, dpr, this.warmDust!, PUFF_DUST, 0, 1, this.heroX0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.puffs.draw(ctx, cam, dpr, this.warmDust!, PUFF_DUST, 1, 1, this.heroX0, 0);
    if (grow <= 0.001) return;
    // Light leaking from the pile: a hot core, rays between the bodies, then the rising column.
    // The pile carries the hero on top: its height is how high he rides.
    const z = cam.zoomEff;
    const pileH = this.pileHeight();
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

  /**
   * New tier, back to front: the hide and the cloud bank (once the meadow no longer covers the
   * screen), the scale's warm light on the hide, the meadow (the screen, closing into its plate),
   * the rows settling back over it, the colossus with the landing's dust and the scale's light on
   * his boots, the old sun's halation, the speed lines.
   */
  private drawPull(ctx: CanvasRenderingContext2D, view: View): void {
    const t = this.t;
    const tl = this.tl;
    const pal = paletteFor(this.to);
    this.ensureArt(pal);
    const cam = view.camera;
    const dpr = view.dpr;
    const W = view.width;
    const H = view.height;
    const P = this.path;
    const m = this.morph;
    const pl = this.plate;
    const lx = pal.light.x;
    const ly = pal.light.y;
    const zE = cam.zoomEff;
    cam.visibleRect(this.vis, 24);
    const v = this.vis;
    const booted = t < tl.pullStart;
    // The camera lands on the in-tier framing: the zoom's hide, and the meadow's scale in it, give
    // way to the live ground, which keeps the scale (backdrop.markScale) as the zoom leaves it.
    const land = 1 - smoother(span(t, tl.pullEnd - 0.12, tl.pullEnd + 0.35));
    // How lit the scale is: it kindles as its frame closes, blazes through the hold, settles to a
    // glow as the land beyond appears, and the picture in it fades to the keepsake's.
    const settleT = smoother(span(t, tl.holdEnd, tl.pullEnd));
    const lum = smootherstep(0.25, 1, m.frame) * (1 - 0.6 * settleT) * land;
    const picA = 1 - (1 - KEEPSAKE) * settleT;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cam.apply(ctx);
    if (!booted) {
      // The hide (the Mountain's own pattern, crisp at any zoom), fading into the live ground as
      // the camera lands on it; then the cloud bank on the ridge line.
      if (land > 0.002 && v.y + v.h > 0) drawHide(ctx, pal, v.x, Math.max(0, v.y), v.x + v.w, v.y + v.h, zE, lx, ly, { alpha: land });
      const mistA = 1 - smoother(span(t, tl.holdEnd + 0.3, tl.pullEnd - 0.05));
      if (mistA > 0.002) this.mist.draw(ctx, v.x, v.x + v.w, view.time, mistA);
    }

    // The scale's warm light on the hide around it (under the scale: the picture keeps its colors).
    if (pl.chosen && lum > 0.01) this.scaleLight(ctx, view, lum);

    // The meadow: the screen at the flash, closing into its scale.
    const devW = m.w * zE * dpr;
    const pic = this.meadow.pick(devW);
    if (pic && land > 0.002) this.drawMeadow(ctx, pic, pal, lum, land, picA, t);
    // The rows in front of the scale lie over its lower part, as over every scale's: it is one of
    // them (they close over it as its frame closes).
    if (pl.chosen && land > 0.002) {
      const rows = smootherstep(0.5, 0.95, m.frame) * land;
      if (rows > 0.002) {
        const s = pl.s;
        ctx.save();
        ctx.beginPath();
        // A little wider than the scale, so its rim (shifted from the light) is covered too.
        pl.traceFrame(ctx, pl.x, pl.y, pl.w, pl.h, 1, 1.05, 1.02);
        ctx.clip();
        const x0 = s.cx - s.sx * 1.2;
        const y0 = s.rowY + s.pitch * 0.5;
        const x1 = s.cx + s.sx * 1.2;
        const y1 = pl.rootY + s.pitch;
        drawHide(ctx, pal, x0, y0, x1, y1, zE, lx, ly, { rowMin: s.n + 1, base: false, alpha: rows });
        // ...and the scale's light falls on them as on their neighbors.
        if (lum > 0.01) {
          ctx.beginPath();
          traceRows(ctx, x0, y0, x1, y1, zE, s.n + 1);
          ctx.clip();
          ctx.globalAlpha = rows;
          this.scaleLight(ctx, view, lum);
        }
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The colossus, with the landing's dust around its soles; the knee mist over him as he lands
    // in the tier (the crowd's hero stands in it), the scale's warm light on his boots.
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
    const pxu = zE * dpr * k;
    const detail = smoother(clamp01((zE * k - 3.4) / 5));
    this.mistA = smoother(span(t, tl.pullEnd - 0.5, tl.handoff0));
    const her = this.her ?? defaultHeraldry(pal);
    this.colossus.draw(ctx, tf, pxu, dpr, pal, her, detail, cA, this.mistA > 0.002 && this.scene.backdrop.drawKneeMist ? this.kneeMist : null);
    if (pl.chosen && lum > 0.01 && cA > 0.01) this.uplight(ctx, view, lum * cA);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.puffs.draw(ctx, cam, dpr, this.warmDust!, PUFF_DUST, 1, cA, this.rootX1, 0);
    ctx.globalCompositeOperation = 'lighter';
    this.puffs.draw(ctx, cam, dpr, this.warmGlow!, PUFF_GLOW, 0, cA, this.rootX1, 0);
    this.puffs.draw(ctx, cam, dpr, this.warmGlow!, PUFF_GLOW, 1, cA, this.rootX1, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Halation: the old world's low sun, right behind the boots, blooms over the colossus's edges
    // while the meadow is still the world around him.
    const halo = 0.3 * (1 - smoothstep01(span(m.frame, 0, 0.6)));
    if (halo > 0.01) {
      cam.worldToScreen(m.x + this.sunU * m.w, m.y + this.sunV * m.h, this.tmp);
      const R = m.h * zE * 0.42;
      ctx.globalAlpha = halo;
      ctx.drawImage(this.warmGlow!, this.tmp.x - R, this.tmp.y - R, R * 2, R * 2);
      ctx.globalAlpha = halo * 0.8;
      ctx.drawImage(this.warmGlow!, this.tmp.x - R * 0.35, this.tmp.y - R * 0.35, R * 0.7, R * 0.7);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';

    // Speed: streaks converging on the pull-back's focus, through the land-revealing stroke.
    const speed = -P.speed;
    const pace = clamp01((speed - 0.25) / 0.9) * (P.stage === Stroke.Landscape ? 1 : 0.25);
    if (pace > 0.01) {
      const amount = (this.gentle ? 0.35 : 1) * pace * this.knobs.streaks;
      const halfDiag = 0.5 * Math.hypot(W, H);
      this.streaks.draw(ctx, dpr, this.focusX, this.focusY, halfDiag, speed, amount, this.streakSprite!);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /**
   * The meadow picture at its world rect, inside its frame: the bare picture while it is the screen,
   * then the plate closing around it (rim light, dark rim, inset picture, the enamel's shade, the
   * gloss on its crown, the sheen sweeping across). Camera transform applied (world meters).
   */
  private drawMeadow(ctx: CanvasRenderingContext2D, pic: HTMLCanvasElement, pal: Palette, lum: number, alpha: number, picA: number, t: number): void {
    const m = this.morph;
    const pl = this.plate;
    const tl = this.tl;
    const fr = pl.chosen ? m.frame : 0;
    ctx.globalAlpha = alpha;
    if (fr <= 0.001) {
      ctx.drawImage(pic, m.x, m.y, m.w, m.h);
      ctx.globalAlpha = 1;
      return;
    }
    const lx = pal.light.x;
    const ly = pal.light.y;
    const rim = pl.rim * fr;
    // The rim light on the lit edge, then the dark rim shifted away from the light.
    ctx.beginPath();
    pl.traceFrame(ctx, m.x, m.y, m.w, m.h, fr);
    ctx.fillStyle = pl.rimLight;
    ctx.globalAlpha = alpha * fr;
    ctx.fill();
    ctx.beginPath();
    pl.traceFrame(ctx, m.x, m.y, m.w, m.h, fr, 1, 1, -lx * rim * 0.45, -ly * rim * 0.45);
    ctx.fillStyle = pl.rimDark;
    ctx.fill();
    ctx.globalAlpha = alpha;
    // The picture inside the rim.
    ctx.save();
    const qx = 1 - (2 * rim) / m.w;
    const qy = 1 - (2 * rim) / m.h;
    ctx.beginPath();
    pl.traceFrame(ctx, m.x, m.y, m.w, m.h, fr, qx, qy, -lx * rim * 0.2, -ly * rim * 0.2);
    ctx.clip();
    // Where the picture ends above the scale's root (under the rows in front), the meadow's ground.
    ctx.fillStyle = pl.ground;
    ctx.fillRect(m.x, m.y + m.h * 0.9, m.w, m.h * 0.6);
    ctx.globalAlpha = alpha * (1 - fr * (1 - picA));
    ctx.drawImage(pic, m.x, m.y, m.w, m.h);
    ctx.globalAlpha = alpha * fr;
    ctx.drawImage(pl.shade!, m.x, m.y, m.w, m.h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * fr * (0.3 + 0.2 * lum);
    const crown = m.y + m.h * pl.crownV * fr;
    ctx.drawImage(pl.gloss!, m.x, crown - m.h * 0.02, m.w, m.h * 0.5);
    // The sheen: a polished glint sweeping across as the scale settles into its hold.
    const sweep = span(t, tl.holdStart - 0.15, tl.holdStart + 0.65);
    if (sweep > 0 && sweep < 1) {
      const strong = 1;
      const e = sweep * sweep * (3 - 2 * sweep);
      const bw = m.w * 0.3;
      const x = m.x - bw + (m.w + bw * 2) * e;
      ctx.globalAlpha = alpha * fr * strong * Math.sin(Math.PI * sweep) * 0.9;
      // A band leaning with the light, across the whole plate.
      ctx.save();
      ctx.translate(x, m.y + m.h * 0.5);
      ctx.transform(1, 0, -0.45, 1, 0, 0);
      ctx.drawImage(pl.sheen!, -bw * 0.5, -m.h * 0.7, bw, m.h * 1.4);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * The scale's warm light on the hide: a wide spill and a hotter core, centered on its face
   * (additive, screen space; restores the transform and composite it changes).
   */
  private scaleLight(ctx: CanvasRenderingContext2D, view: View, lum: number): void {
    const cam = view.camera;
    const pl = this.plate;
    const a = ctx.globalAlpha;
    ctx.save();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    cam.worldToScreen(pl.cx, pl.faceY, this.tmp);
    let R = pl.s.sx * 2 * cam.zoomEff * 1.9;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * 0.55 * lum;
    ctx.drawImage(this.warmGlow!, this.tmp.x - R, this.tmp.y - R * 0.5, R * 2, R);
    R *= 0.55;
    ctx.globalAlpha = a * 0.45 * lum;
    ctx.drawImage(this.warmGlow!, this.tmp.x - R, this.tmp.y - R * 0.55, R * 2, R * 1.1);
    ctx.restore();
  }

  /** The scale's warm light on the colossus: an upward glow inside his silhouette, from the scale. */
  private uplight(ctx: CanvasRenderingContext2D, view: View, amount: number): void {
    const cam = view.camera;
    const dpr = view.dpr;
    const pl = this.plate;
    const tf = this.tf;
    ctx.save();
    ctx.setTransform(tf.a, tf.b, tf.c, tf.d, tf.e, tf.f);
    ctx.beginPath();
    this.colossus.trace(ctx);
    ctx.clip();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cam.worldToScreen(pl.cx, pl.s.top - LIFT * pl.s.pitch, this.tmp);
    const R = pl.s.sx * 2 * cam.zoomEff * 1.6;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, 0.75 * amount);
    ctx.drawImage(this.warmGlow!, this.tmp.x - R, this.tmp.y - R * 1.1, R * 2, R * 1.6);
    ctx.restore();
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoother(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function smoothstep01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** A synthetic zoomBegin for the debug fake path (the core has no zoom rules yet). */
export function fakeZoomBegin(from: number): { type: 'zoomBegin'; from: number; to: number; scales: ReturnType<typeof D>; fusion: number; height: number } {
  return { type: 'zoomBegin', from, to: from + 1, scales: D(5), fusion: 2, height: 212 };
}
