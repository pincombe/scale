// Contract: what the rest of the game may ask of the backdrop (scene.backdrop). Owned by
// render/backdrop. Add members freely; never change or remove existing ones.
import type { View } from '../types';

/** The world wyrm's head on the Mountain horizon, as the zoom's reveal poses it (all 0..1). */
export interface WyrmPose {
  /** 0 = resting behind the ridge, 1 = reared high over it. */
  rise: number;
  /** 0 = shut, 1 = wide open. */
  eye: number;
  /** 0 = shut, 1 = roaring. */
  jaw: number;
}

export interface BackdropApi {
  /** Open the eye in the hills now (no-op while it is already open). */
  openEye(): void;
  /** Fires when an eye starts to open (audio hangs a rumble on it). Returns an unsubscribe. */
  onEyeOpen?(fn: () => void): () => void;
  /**
   * While on, never re-bake cached layers: the zoom director flies the camera through huge zoom
   * ranges, so draw the cached art scaled (soft is fine; the cinematic's motion hides it).
   */
  setTransition?(on: boolean): void;
  /** Pose the Mountain's world wyrm (the zoom's reveal); null hands it back to its own schedule. */
  wyrmPose?(pose: WyrmPose | null): void;
  /**
   * M2 (WP 2.2): a grade painted over the backdrop's own art (sky, silhouettes, ground) at the end
   * of backdrop.back's draw, so it never touches the dragon, crowd or particles (the boss's darkened
   * sky, fx/post.ts). The painter resets the transform itself; null removes it.
   */
  setGrade?(paint: ((ctx: CanvasRenderingContext2D, view: View) => void) | null): void;
  /**
   * Draw the Mountain's hide (the world wyrm's scales: its ground, y >= 0) over the world rect
   * [x0, x1] x [y0, y1] in ctx's current transform (world meters: apply your camera first).
   * `pxPerM` = on-screen CSS px per meter (level of detail). The very art of the Mountain's ground
   * layer at any magnification, so the zoom's close-up hands off to it without a seam.
   * Allocation-free per call.
   */
  drawHide?(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, pxPerM: number): void;
  /**
   * The hide's scale around world point (x, y >= 0), as drawn: writes its exposed face into `out`
   * (x, w = its span; y = its top edge; h = its row's pitch, the height left uncovered by the next
   * row) and returns it. Scales near the ridge line hold a whole Meadow view after a x100-x120
   * pull-back: put the snapshot in one.
   */
  hideScaleAt?(x: number, y: number, out: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number };
}
