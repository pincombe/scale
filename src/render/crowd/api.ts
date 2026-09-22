// Contract: what the rest of the game may ask of the knight crowd renderer (scene.crowd).
// Owned by render/crowd. Add methods freely; never change or remove existing ones.
import type { Rect, Vec2 } from '../../lib/vec';

export interface CrowdView {
  /** The hero knight's chest (world m): origin for sword arcs and hero effects. */
  heroPoint(out: Vec2): Vec2;
  /** World x of the army's front line (the hero's sword tip at rest). */
  frontX(): number;
  /** World AABB of the part of the army worth framing (hero + visible formation). */
  bounds(out: Rect): Rect;
}
