// Contract: what the rest of the game may ask of the backdrop (scene.backdrop). Owned by
// render/backdrop. Add members freely; never change or remove existing ones.
import type { View } from '../types';
import type { Vec2 } from '../../lib/vec';

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
  drawHide?(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, pxPerM: number, opts?: HideDrawOpts): void;
  /**
   * The hide's scale around world point (x, y >= 0), as drawn: writes its exposed face into `out`
   * (x, w = its span; y = its top edge; h = its row's pitch, the height left uncovered by the next
   * row) and returns it. Scales near the ridge line hold a whole Meadow view after a x100-x120
   * pull-back: put the snapshot in one.
   */
  hideScaleAt?(x: number, y: number, out: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number };
  /**
   * WP 2.1B: start baking `tier`'s art now, a piece per frame, so the zoom's switch finds it ready
   * (the zoom calls it at zoomBegin with the tier it is flying to). null cancels, freeing whatever
   * was baked for a tier that is not on screen.
   */
  prepare?(tier: number | null): void;
  /**
   * WP 2.1B: the meadow's scale. The hide scale around world point (x, y) keeps the old tier in
   * it, faintly warm (`picture`: a small snapshot the backdrop keeps; null = just the warmth), for
   * the rest of the tier, sitting `lift` row pitches proud of its row (as the zoom left it). null
   * clears it. The Mountain only.
   */
  markScale?(mark: { x: number; y: number; picture: HTMLCanvasElement | null; lift?: number } | null): void;
  /**
   * WP 2.1B: the mist the active tier draws in front of the army (the Mountain's knee-deep wisps),
   * in world meters through view.camera, into ctx's current transform (device px: scale(dpr), or a
   * buffer's offset). The zoom lays it over the colossus as it becomes the hero. No-op elsewhere.
   */
  drawKneeMist?(ctx: CanvasRenderingContext2D, view: View): void;
  /** WP 2.1B: the active tier's sun (the Mountain: its afterglow) on the main view, CSS px. */
  sunPoint?(out: Vec2): Vec2;
}

/** drawHide options (WP 2.1B). */
export interface HideDrawOpts {
  /** Opacity of everything drawn (default 1). */
  alpha?: number;
  /** Skip rows before this one (default 0): redraw the rows in front of a scale over it. */
  rowMin?: number;
  /** Paint the base tone under the rows (default true); false when drawing over existing hide. */
  base?: boolean;
}
