// Render contracts: View (per-frame read-only context) and Layer (one slot of the stack).
import type { GameState } from '../core';
import type { Camera } from './camera';
import type { Palette } from './palette';

/**
 * Everything a layer needs to draw one frame. The renderer reuses one View object for the main
 * canvas; the M2 zoom director builds others (different camera, state or palette) and calls
 * drawScene() with them, so layers must read everything from the view they are given.
 */
export interface View {
  state: Readonly<GameState>;
  /** Interpolation between the last logic tick and the next, in [0, 1). */
  alpha: number;
  /** Scaled seconds this frame (0 during hit-stop/pause) and since start. */
  dt: number;
  time: number;
  /** Wall-clock seconds this frame and since start (for grain, UI, shake). */
  realDt: number;
  realTime: number;
  camera: Camera;
  palette: Palette;
  /** Viewport in CSS px; the canvas backing store is width*dpr x height*dpr. */
  width: number;
  height: number;
  dpr: number;
  /** Frame counter (for staggering work). */
  frame: number;
}

/**
 * One slot of the layer stack.
 * - update(view): advance animation/simulation. Called exactly once per rendered frame on the
 *   main view, for every layer (visible or not), before any draw.
 * - draw(ctx, view): paint. Must not advance state: it may run several times per frame (M2 draws
 *   two tiers at once into offscreen canvases). The renderer resets ctx before each layer to:
 *   transform = scale(dpr) (so you draw in CSS px), globalAlpha = 1, composite = 'source-over'.
 *   To draw in world meters call view.camera.apply(ctx) (or applyParallax for backdrop depth).
 * - resize(w, h, dpr): rebuild caches (gradients, offscreen canvases) for a new viewport.
 */
export interface Layer {
  readonly name: string;
  visible: boolean;
  resize?(w: number, h: number, dpr: number): void;
  update?(view: View): void;
  draw(ctx: CanvasRenderingContext2D, view: View): void;
}
