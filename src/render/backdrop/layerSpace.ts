// Parallax layer space, as the Meadow defines it (see meadow.ts): silhouette layers are authored
// in units of 1/9 of the view height, anchored so u = -0.5 sits under the stage center at the
// reference framing. Layer (u, v) at depth p maps to the camera's parallax meters
// L = refX + f (u + 0.5), f = unit / refZoom, so a backdrop keeps its composition whatever base
// framing the director picks. Camera-parametrized (the Mountain also bakes for a "home" camera
// while the zoom flies the real one) and allocation-free.
import type { Camera } from '../camera';
import type { Vec2 } from '../../lib/vec';
import { SAFE_MARGIN } from '../world';
import { KNIGHT_HEIGHT } from '../world';
import type { CameraDirector } from '../director';

/** A layer unit as a fraction of the view height. */
export const LAYER_UNIT = 1 / 9;

/** Parallax meters per layer unit. */
export function unitF(cam: Camera, H: number): number {
  return (H * LAYER_UNIT) / cam.refZoom;
}

/** Layer point (u, v) at depth p -> screen CSS px. */
export function layerToScreen(cam: Camera, H: number, p: number, u: number, v: number, out: Vec2): Vec2 {
  const f = unitF(cam, H);
  return cam.parallaxToScreen(p, cam.refX + f * (u + 0.5), f * v, out);
}

/** Multiply the layer transform (layer units) for depth p onto ctx. */
export function applyLayer(ctx: CanvasRenderingContext2D, cam: Camera, H: number, p: number): void {
  const f = unitF(cam, H);
  cam.applyParallax(ctx, p);
  ctx.translate(cam.refX + 0.5 * f, 0);
  ctx.scale(f, f);
}

/** CSS px per layer unit at depth p (incl. punch). */
export function layerZoom(cam: Camera, H: number, p: number): number {
  return cam.parallaxZoom(p) * unitF(cam, H);
}

/** Visible layer-x range at depth p (x = left, y = right; the slack covers roll). `origin` gets layer (0, 0) on screen. */
export function layerRange(cam: Camera, W: number, H: number, p: number, out: Vec2, origin: Vec2): Vec2 {
  layerToScreen(cam, H, p, 0, 0, origin);
  const z = layerZoom(cam, H, p);
  const m = SAFE_MARGIN + 48;
  out.x = (-m - origin.x) / z;
  out.y = (W + m - origin.x) / z;
  return out;
}

/**
 * Set `home` to the in-tier director's base framing for this view (small dragon, the hero at
 * its base size, the clash point where the director puts it): where the zoom lands. The Mountain
 * bakes for it while the zoom flies the live camera, so the landing needs no re-bake.
 */
export function homeFraming(home: Camera, live: Camera, dir: CameraDirector, W: number, H: number): Camera {
  home.viewW = W;
  home.viewH = H;
  home.insetRight = live.insetRightTarget;
  home.insetRightTarget = live.insetRightTarget;
  home.zoom = (dir.heroFrac * H) / KNIGHT_HEIGHT;
  home.x = 0 + ((0.5 - dir.clashFracSmall) * home.stageW) / home.zoom;
  home.y = -((dir.groundFrac - 0.5) * H) / home.zoom;
  home.rot = 0;
  home.anchorFrac = dir.groundFrac;
  home.refZoom = (dir.refHeroFrac * H) / KNIGHT_HEIGHT;
  home.refX = dir.refX;
  home.refY = 0;
  home.trauma = 0;
  home.derive();
  return home;
}
