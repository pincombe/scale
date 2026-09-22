// In-tier camera director: a dragon-first, cinematic composition at every size.
//
// The shot is anchored on the clash point (the dragon's rest-pose front edge, where the hero
// fights): it sits at `clashFrac` of the stage width, so the dragon owns the right of the frame and
// the army the left, marching in from (and running off) the left edge. The zoom is the closest of:
//   - the base framing: the hero is `heroFrac` of the stage height (an intimate duel with a newt);
//   - the dragon's share of the stage width, ramping with size (`shareSmall` at `shareSizeSmall` m
//     to `shareBig` at `shareSizeBig` m and up), so the camera holds still while the first dragons
//     grow on screen, then pulls back just enough to keep each bigger one the star;
//   - the dragon's top (plus flight/rearing headroom) below the HUD band;
//   - the hero fully on stage left of the clash point.
// A growing army may then nudge the camera back by at most `armyWiden` (the host swells; the
// dragon never shrinks to a speck). Critically damped (smoothDamp) on log-zoom, the clash point's
// world x and its screen fraction, and the camera x is derived every frame from the live stage
// width, so panel slides, purchases and dragon swaps never pop. The ground stays at `groundFrac`.
// The M2 zoom director sets `enabled = false` while it drives the camera itself.
import { clamp01, lerp, smoothDamp, type Spring } from '../lib/math';
import { rect, type Rect } from '../lib/vec';
import type { Camera } from './camera';
import type { DragonView } from './dragon/api';
import type { CrowdView } from './crowd/api';
import { KNIGHT_HEIGHT } from './world';

export interface DirectorTargets {
  camera: Camera;
  dragon: DragonView;
  crowd: CrowdView;
}

/** One framing solution (see CameraDirector.frame). */
export interface Framing {
  /** CSS px per meter. */
  zoom: number;
  /** World x of the clash point, and where it sits on screen (fraction of the stage width). */
  clashX: number;
  clashFrac: number;
  /** Camera center x for this framing on this stage width. */
  x: number;
  /** Zoom of the base (closest) framing. */
  baseZoom: number;
}

export function framing(): Framing {
  return { zoom: 1, clashX: 0, clashFrac: 0.5, x: 0, baseZoom: 1 };
}

export class CameraDirector {
  enabled = true;
  /** Hero height as a fraction of stage height at the base (closest) framing. */
  heroFrac = 0.29;
  /**
   * Parallax reference framing (hero fraction): the backdrop's layers are authored in meters at
   * this framing, so far layers keep their composition however close the director goes.
   */
  refHeroFrac = 0.2;
  /** Dragon width as a fraction of stage width: `shareSmall` at `shareSizeSmall` m... */
  shareSmall = 0.25;
  shareSizeSmall = 1;
  /** ...ramping (log size) to `shareBig` at `shareSizeBig` m and up. */
  shareBig = 0.44;
  shareSizeBig = 10;
  /** Clash point as a fraction of the stage width from the left, for small and big dragons. */
  clashFracSmall = 0.39;
  clashFracBig = 0.4;
  /** Ground line, as a fraction of stage height from the top. */
  groundFrac = 0.76;
  /** Keep the dragon's top at least this fraction of the sky height below the top (HUD). */
  topMargin = 0.2;
  /** Headroom above the rest pose for fly-ins and rearing, as a fraction of the dragon's length. */
  headroom = 0.25;
  /** Stage room (m) kept left of the clash point: the hero (~1.4 m back) plus a first file. */
  heroRoom = 2.5;
  /** A big army may pull the camera back by at most this factor (small dragons; none at shareSizeBig). */
  armyWiden = 1.12;
  /** Seconds to settle (critically damped). */
  smoothTime = 0.85;
  /** Reference x (m) for parallax. */
  refX = -0.5;

  /** Last computed target (for debug watches and the dragon's enter): camera x and zoom. */
  readonly target = { x: 0, zoom: 1 };

  private readonly springX: Spring = { v: 0 };
  private readonly springZ: Spring = { v: 0 };
  private readonly springF: Spring = { v: 0 };
  private readonly D: Rect = rect();
  private readonly C: Rect = rect();
  private readonly f: Framing = framing();
  private snapNext = true;
  private logZ = Math.log(100);
  private clashX = 0;
  private clashFrac = 0.4;

  constructor(private readonly scene: DirectorTargets) {}

  /** Jump straight to the target framing on the next update (first frame, resync). */
  snap(): void {
    this.snapNext = true;
  }

  /** The dragon's target share of the stage width for a dragon `w` meters long. */
  share(w: number): number {
    return lerp(this.shareSmall, this.shareBig, this.sizeT(w));
  }

  /** 0 at `shareSizeSmall`, 1 at `shareSizeBig` (log size, clamped). */
  sizeT(w: number): number {
    return clamp01(Math.log(Math.max(1e-6, w) / this.shareSizeSmall) / Math.log(this.shareSizeBig / this.shareSizeSmall));
  }

  /**
   * Pure framing math: the target framing for a stage (CSS px), the dragon's rest bounds and the
   * army's bounds. Writes and returns `out`.
   */
  frame(stageW: number, stageH: number, D: Rect, C: Rect, out: Framing): Framing {
    const baseZoom = (this.heroFrac * stageH) / KNIGHT_HEIGHT;
    const t = this.sizeT(D.w);
    const frac = lerp(this.clashFracSmall, this.clashFracBig, t);
    const clashX = D.x;

    // The dragon: its share of the width, its top (with headroom) clear of the HUD band.
    let zoom = baseZoom;
    if (D.w > 0) zoom = Math.min(zoom, (this.share(D.w) * stageW) / D.w);
    const top = -D.y + this.headroom * D.w;
    if (top > 0) zoom = Math.min(zoom, (this.groundFrac * stageH * (1 - this.topMargin)) / top);
    // The hero stays whole on stage left of the clash point (narrow stages).
    zoom = Math.min(zoom, (frac * stageW) / this.heroRoom);

    // The army: fit its back ranks left of the clash point, but pull back at most armyWiden (fading
    // out as dragons grow: by then the host is a banner-dotted band and the dragon is the shot).
    const back = clashX - C.x;
    if (back > 0) {
      const armyZoom = (frac * stageW * 0.97) / back;
      const widen = 1 + (this.armyWiden - 1) * (1 - t);
      if (armyZoom < zoom) zoom = Math.max(armyZoom, zoom / widen);
    }

    out.zoom = zoom;
    out.clashX = clashX;
    out.clashFrac = frac;
    out.x = clashX + ((0.5 - frac) * stageW) / zoom;
    out.baseZoom = baseZoom;
    return out;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const { camera: cam, dragon, crowd } = this.scene;
    const stageH = Math.max(1, cam.viewH);
    const f = this.frame(
      Math.max(1, cam.viewW - cam.insetRightTarget),
      stageH,
      dragon.bounds(this.D),
      crowd.bounds(this.C),
      this.f,
    );

    this.target.x = f.x;
    this.target.zoom = f.zoom;
    const tLogZ = Math.log(f.zoom);
    if (this.snapNext) {
      this.snapNext = false;
      this.logZ = tLogZ;
      this.clashX = f.clashX;
      this.clashFrac = f.clashFrac;
      this.springX.v = this.springZ.v = this.springF.v = 0;
    } else {
      this.logZ = smoothDamp(this.logZ, tLogZ, this.springZ, this.smoothTime, dt);
      this.clashX = smoothDamp(this.clashX, f.clashX, this.springX, this.smoothTime, dt);
      this.clashFrac = smoothDamp(this.clashFrac, f.clashFrac, this.springF, this.smoothTime, dt);
    }
    const zoom = Math.exp(this.logZ);
    cam.zoom = zoom;
    // The clash point holds its place on the live (easing) stage, so the panel slides it smoothly.
    cam.x = this.clashX + ((0.5 - this.clashFrac) * cam.stageW) / zoom;
    // Ground locked at groundFrac of the stage height.
    cam.y = -((this.groundFrac - 0.5) * stageH) / zoom;

    // Parallax: scale about the ground line, relative to the backdrop's reference framing.
    cam.anchorFrac = this.groundFrac;
    cam.refZoom = (this.refHeroFrac * stageH) / KNIGHT_HEIGHT;
    cam.refX = this.refX;
    cam.refY = 0;
  }
}
