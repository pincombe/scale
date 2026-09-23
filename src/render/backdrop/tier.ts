// What index.ts needs from each tier's backdrop (the Meadow, the Mountain), and what it gives them.
import type { Scene } from '../../app/scene';
import type { View } from '../types';

export interface BackdropStats {
  backMs: number;
  frontMs: number;
  eyeMs: number;
  bakes: number;
  bakeMsMax: number;
  /** The layer behind bakeMsMax (debug). */
  bakeWorst?: string;
}

/** Services the dispatcher shares with the active tier. */
export interface BackdropHost {
  readonly scene: Scene;
  readonly stats: BackdropStats;
  /** True while the zoom flies the camera: draw cached layers scaled, never re-bake them. */
  frozen(): boolean;
  /** An eye started to open (audio hangs a rumble on it). */
  eyeOpened(): void;
  /** The main view (drawScene may also draw foreign views: snapshots). */
  isMain(view: View): boolean;
}

/** One tier's backdrop. Only the active tier keeps its caches; free() drops them all. */
export interface TierBackdrop {
  update(view: View): void;
  drawBack(ctx: CanvasRenderingContext2D, view: View): void;
  drawFront(ctx: CanvasRenderingContext2D, view: View): void;
  openEye(): void;
  birds(): void;
  free(): void;
  /** Canvas backing store owned by this tier (bytes). */
  bytes(): number;
  /** One-line state for the debug watch. */
  eyeState(): string;
}
