// Contract: what the rest of the game may ask of the dragon renderer (scene.dragon).
// Owned by render/dragon. Add methods freely; never change or remove existing ones.
import type { Rect, Vec2 } from '../../lib/vec';

export interface DragonView {
  /**
   * What a click at world point (wx, wy) hits on the live (animated) pose. 'weak' only while the
   * weak spot is showing. Must stay forgiving at small sizes (use a minimum screen radius).
   */
  hitTest(wx: number, wy: number): 'weak' | 'body' | null;
  /** A random point on the live body (world m): impact point for un-aimed clicks and army hits. */
  impactPoint(out: Vec2): Vec2;
  /** World position of the glowing weak spot, or null when it isn't showing. */
  weakSpot(out: Vec2): Vec2 | null;
  /** Head / mouth (fire origin). */
  headPoint(out: Vec2): Vec2;
  /**
   * Stable framing box (world AABB) for the camera director and crowd targeting: the rest pose at
   * the current size, where the dragon will stand once it has entered. Ignores transient motion.
   */
  bounds(out: Rect): Rect;
  /**
   * Live tail-tip position (world m). During a swipe the tail lashes low along the ground through
   * the army's front ranks (roughly 50-450 ms into the phase): fling knights as it passes them.
   * Optional so null objects stay valid; the real dragon always implements it.
   */
  tailPoint?(out: Vec2): Vec2;
  /**
   * World x of the far (army-side) end of the flame at full extent for the current dragon: only
   * knights at x >= breathReachX() are in the fire's path. Optional (see tailPoint).
   */
  breathReachX?(): number;
}
