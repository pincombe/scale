// In-tier camera director: frames the dragon and the army, pulling back as dragons grow.
// Critically damped (smoothDamp) on x and log-zoom, so retargeting (a bigger dragon spawns, the
// panel opens) never pops. The ground line stays locked at `groundFrac` of the stage height.
// The M2 zoom director sets `enabled = false` while it drives the camera itself.
import { smoothDamp, type Spring } from '../lib/math';
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

export class CameraDirector {
  enabled = true;
  /** Hero height as a fraction of stage height at the base (newt) framing. */
  heroFrac = 0.2;
  /** Dragon width as a fraction of stage width once dragons are big. */
  dragonFrac = 0.44;
  /** Ground line, as a fraction of stage height from the top. */
  groundFrac = 0.76;
  /** Keep the dragon's top at least this fraction of the sky-height below the top (HUD). */
  topMargin = 0.2;
  /** A big army may widen the frame by at most this factor. */
  armyWiden = 1.5;
  /** Seconds to settle (critically damped). */
  smoothTime = 0.85;
  /** Reference x (m) for parallax: the base framing's center. */
  refX = -0.5;

  /** Last computed target (for debug watches). */
  readonly target = { x: 0, zoom: 1 };

  private readonly springX: Spring = { v: 0 };
  private readonly springZ: Spring = { v: 0 };
  private readonly D: Rect = rect();
  private readonly C: Rect = rect();
  private snapNext = true;
  private logZ = Math.log(100);

  constructor(private readonly scene: DirectorTargets) {}

  /** Jump straight to the target framing on the next update (first frame, resync). */
  snap(): void {
    this.snapNext = true;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const { camera: cam, dragon, crowd } = this.scene;
    const stageW = Math.max(1, cam.viewW - cam.insetRightTarget);
    const stageH = Math.max(1, cam.viewH);
    const baseZoom = (this.heroFrac * stageH) / KNIGHT_HEIGHT;

    const D = dragon.bounds(this.D);
    const C = crowd.bounds(this.C);

    // Frame width in meters: the base framing, widened smoothly as the dragon grows.
    const w0 = stageW / baseZoom;
    const wd = D.w / this.dragonFrac;
    const wBase = Math.sqrt(w0 * w0 + wd * wd);
    const right = D.x + D.w + 0.06 * wBase;
    const left = Math.min(C.x, D.x) - 0.05 * wBase;
    const span = right - left;
    let w = span > wBase ? Math.min(span, wBase * this.armyWiden) : wBase;

    // Zoom: fit the width, keep the dragon's top clear of the HUD, never closer than the base.
    let zoom = stageW / w;
    const top = -D.y; // height of the dragon's top above the ground (m)
    if (top > 0) {
      const maxZoom = (this.groundFrac * stageH * (1 - this.topMargin)) / top;
      if (zoom > maxZoom) zoom = maxZoom;
    }
    if (zoom > baseZoom) zoom = baseZoom;
    w = stageW / zoom;

    // Horizontal: center the content if it fits, else keep the dragon in frame and crop the army.
    const x = span <= w ? (left + right) * 0.5 : right - w * 0.5;

    this.target.x = x;
    this.target.zoom = zoom;
    const tLogZ = Math.log(zoom);
    if (this.snapNext) {
      this.snapNext = false;
      cam.x = x;
      this.logZ = tLogZ;
      this.springX.v = 0;
      this.springZ.v = 0;
    } else {
      cam.x = smoothDamp(cam.x, x, this.springX, this.smoothTime, dt);
      this.logZ = smoothDamp(this.logZ, tLogZ, this.springZ, this.smoothTime, dt);
    }
    cam.zoom = Math.exp(this.logZ);
    // Ground locked at groundFrac of the stage height.
    cam.y = -((this.groundFrac - 0.5) * stageH) / cam.zoom;

    // Parallax: scale about the ground line; the reference is the base framing for this viewport.
    cam.anchorFrac = this.groundFrac;
    cam.refZoom = baseZoom;
    cam.refX = this.refX;
    cam.refY = 0;
  }
}
