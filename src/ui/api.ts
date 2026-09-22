// Contract: DOM UI services other modules may use (scene.ui). Owned by src/ui.
// Add members freely; never change or remove existing ones.
import type { Vec2 } from '../lib/vec';

export interface UiAnchors {
  /**
   * Screen position (CSS px) of a named HUD element's center, e.g. 'gold' (the coin icon), so
   * effects can fly to it. Cached; refreshed on layout changes. null if unknown or hidden.
   */
  anchor(name: string, out: Vec2): Vec2 | null;
}

export interface UiRegions {
  /** Top bar: gold (top-left), dragon name + HP (top-center). */
  hud: HTMLElement;
  /** Right panel (340 px), hidden until needed; its width feeds camera.insetRightTarget. */
  panel: HTMLElement;
  toasts: HTMLElement;
  /** Title screen and cards. */
  overlay: HTMLElement;
  /** ?debug panel (bottom-left). */
  debug: HTMLElement;
}

export interface Ui extends UiAnchors {
  readonly regions: UiRegions;
  /** Register an element as a named anchor. */
  registerAnchor(name: string, el: HTMLElement): void;
  /** Mark cached anchor rects stale (call after layout changes the HUD). */
  invalidateAnchors(): void;
  /** Brief bump animation on the anchored element (coins landed, counter changed). */
  pulse(name: string): void;
  readonly panelOpen: boolean;
  /** Show/hide the right panel; the camera re-frames the stage into the uncovered area. */
  setPanelOpen(open: boolean): void;
  /** Short message under the HUD. */
  toast(text: string, kind?: 'unlock' | 'milestone' | 'info'): void;
  /** Run fn ~10 times per second (wall clock): the place for DOM text updates. */
  onRefresh(fn: () => void): void;
}
