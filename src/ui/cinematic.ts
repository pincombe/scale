// The zoom cinematic, as the UI sees it. While a zoom plays (core's zoom.stage is set, or the zoom
// director says it's active) the HUD, panel and toasts are hidden (Ui.setCinematic, WP 2.1), so
// nothing new may pop: M2 moments that happen under the cinematic (the switch's unlocks, the
// Scales it pays, the new tier's headline) are deferred with `after()` and play once the UI is back.
//
// Works with the zoom stub too (begin → switch → end in one drain): anything queued while the
// stage is set flushes on the next frame.
import type { Scene } from '../app/scene';
import { setClass } from './dom';
import type { UiRoot } from './mount';

/** Grace after the cinematic ends before deferred moments play (the HUD fades back in first). */
const RETURN_MS = 650;

export interface Cinematic {
  /** True while the zoom cinematic owns the screen. */
  readonly on: boolean;
  /** Run fn now (after `delayMs`), or once the cinematic is over (after RETURN_MS + `delayMs`). */
  after(fn: () => void, delayMs?: number): void;
}

const cache = new WeakMap<UiRoot, Cinematic>();

/** The cinematic watcher for this UI (one per UiRoot). */
export function cinematicOf(scene: Scene, ui: UiRoot): Cinematic {
  let c = cache.get(ui);
  if (c) return c;
  const live = (): boolean => scene.game.state.zoom.stage !== null || scene.zoom.active;
  let queue: { fn: () => void; delay: number }[] = [];
  const run = (fn: () => void, ms: number): void => {
    if (ms <= 0) fn();
    else window.setTimeout(fn, ms);
  };
  ui.onFrame(() => {
    const on = live();
    setClass(ui.root, 'ui-zoom-hold', on);
    if (on || queue.length === 0) return;
    const q = queue;
    queue = [];
    for (const { fn, delay } of q) run(fn, RETURN_MS + delay);
  });
  c = {
    get on() {
      return live();
    },
    after(fn, delayMs = 0) {
      if (live()) queue.push({ fn, delay: delayMs });
      else run(fn, delayMs);
    },
  };
  cache.set(ui, c);
  return c;
}
