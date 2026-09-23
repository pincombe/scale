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
export const RETURN_MS = 650;

/**
 * A zoom's landing, staged (ms after the UI is back, i.e. `after()` delays), so the return from the
 * cinematic reads as a sequence, not a pileup: (a) the height headline counts up alone, the
 * payoff; (b) the Scales count up; (c) on the first zoom, the panel slides in on Heraldry with its
 * coach; (d) the abilities dock rises, and its "Press 1" coach waits until the player has bought a
 * charge or left Heraldry, or COACH_WAIT has passed.
 */
export const LANDING = { headline: 150, scales: 1900, panel: 3100, dock: 4500, coachWait: 10000 } as const;

/** Named one-way signals between UI modules (e.g. 'heraldryLeft': the player moved on from Heraldry). */
export type LandingSignal = 'heraldryLeft' | 'coachShown' | 'landingEnd';

/** After the "Press 1" coach shows, let it be read before the held toasts start (ms). */
const COACH_READ_MS = 1400;
/** A landing never holds toasts longer than this after the UI is back (the coach may not come). */
const LANDING_MAX_MS = LANDING.dock + LANDING.coachWait + 2500;
/** A later zoom (no Heraldry coach): the landing is over once the dock has risen. */
const LANDING_LATER_MS = LANDING.dock + 1200;

export interface Cinematic {
  /** True while the zoom cinematic owns the screen. */
  readonly on: boolean;
  /** Run fn now (after `delayMs`), or once the cinematic is over (after RETURN_MS + `delayMs`). */
  after(fn: () => void, delayMs?: number): void;
  /**
   * True from a zoom's switch until its staged landing is over (the dock has risen and, on the first
   * zoom, the "Press 1" coach has shown): unlock and milestone toasts hold until 'landingEnd'.
   */
  readonly landing: boolean;
  /** Raise a signal (listeners run synchronously). */
  signal(name: LandingSignal): void;
  /** Listen for a signal; returns an unsubscribe. */
  listen(name: LandingSignal, fn: () => void): () => void;
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
  const listeners = new Map<LandingSignal, Set<() => void>>();
  let landing = false;
  let landingTimer = 0;
  const endLanding = (): void => {
    if (!landing) return;
    landing = false;
    window.clearTimeout(landingTimer);
    c!.signal('landingEnd');
  };
  c = {
    get on() {
      return live();
    },
    get landing() {
      return landing;
    },
    signal(name) {
      const set = listeners.get(name);
      if (set) for (const fn of [...set]) fn();
    },
    listen(name, fn) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(fn);
      return () => set!.delete(fn);
    },
    after(fn, delayMs = 0) {
      if (live()) queue.push({ fn, delay: delayMs });
      else run(fn, delayMs);
    },
  };
  cache.set(ui, c);

  // The landing: from the switch (under the cinematic) until the "Press 1" coach has been read (the
  // first zoom) or the dock has risen (later zooms), with a cap either way.
  const self = c;
  scene.game.on('zoomSwitch', () => {
    landing = true;
    window.clearTimeout(landingTimer);
    const first = scene.game.state.zoom.count === 1;
    self.after(() => {
      landingTimer = window.setTimeout(endLanding, first ? LANDING_MAX_MS : LANDING_LATER_MS);
    }, 0);
  });
  self.listen('coachShown', () => {
    if (!landing) return;
    window.clearTimeout(landingTimer);
    landingTimer = window.setTimeout(endLanding, COACH_READ_MS);
  });
  return c;
}
