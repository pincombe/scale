// The backdrop (WP 1.1, 1.12; tier-aware since WP 2.3): one pair of layers that paints the
// active tier's world. Tier 0 is the Meadow (meadow.ts, unchanged), tier 1 the Mountain
// (mountain.ts). The tier follows view.state.tier (its palette arrives with the resync from the
// zoom's switch or a debug jump); only the active tier keeps its caches: the other's canvases are
// freed on a switch and re-bake lazily on the way back.
//
//   backdrop.back  (slot 0): sky, parallax silhouettes, the tier's wyrm, the ground at y = 0.
//   backdrop.front (slot 4): foreground framing and ambient life in front of the army.
//
// scene.backdrop (api.ts): openEye (the active tier's eye), onEyeOpen (either eye starts to open),
// setTransition (the zoom flies the camera: never re-bake, draw cached layers scaled), wyrmPose
// (the Mountain's world wyrm, posed by the zoom's reveal; null hands it back to its schedule),
// setGrade (WP 2.2: a painter run at the end of backdrop.back, over the backdrop's art only).
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { BackdropApi, WyrmPose } from './api';
import type { BackdropHost, BackdropStats, TierBackdrop } from './tier';
import { createMeadow } from './meadow';
import { createMountain } from './mountain';
import { drawHide, hideScaleAt } from './hide';
import { MOUNTAIN } from '../palette';

export { drawHide, hideScaleAt, hideBaseColor, hidePitch, hideRowY, hideRowAt, HIDE_S0, HIDE_K, HIDE_ASPECT } from './hide';

export interface Backdrop extends BackdropApi {
  back: Layer;
  front: Layer;
  /** Open the active tier's eye now (no-op while it is already open). */
  openEye(): void;
  onEyeOpen(fn: () => void): () => void;
  setTransition(on: boolean): void;
  wyrmPose(pose: WyrmPose | null): void;
  drawHide(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, pxPerM: number): void;
  hideScaleAt(x: number, y: number, out: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number };
  /** Send a flock of birds across the sky now. */
  birds(): void;
  /** Rolling CPU cost of the two layers' draw() (ms, main view), and silhouette re-bakes. */
  readonly stats: BackdropStats;
  /** Canvas memory owned by the backdrop (MB of backing store). */
  memMB(): number;
}

/** Tier index -> which backdrop draws it (tiers past the Mountain reuse it until M3). */
function worldOf(tier: number): 0 | 1 {
  return tier >= 1 ? 1 : 0;
}

export function createBackdrop(scene: Scene): Backdrop {
  const stats: BackdropStats = { backMs: 0, frontMs: 0, eyeMs: 0, bakes: 0, bakeMsMax: 0 };
  const listeners: (() => void)[] = [];
  let transition = false;
  /** A grade over the back layer's art (WP 2.2: the boss's darkened sky), or null. */
  let grade: ((ctx: CanvasRenderingContext2D, view: View) => void) | null = null;

  const host: BackdropHost = {
    scene,
    stats,
    frozen: () => transition,
    eyeOpened() {
      for (let i = 0; i < listeners.length; i++) {
        try {
          listeners[i]!();
        } catch (err) {
          console.error('onEyeOpen listener failed', err);
        }
      }
    },
    isMain: (view: View) => view === scene.renderer.view,
  };
  const meadow = createMeadow(host);
  const mountain = createMountain(host);
  const worlds: TierBackdrop[] = [meadow, mountain];
  let active = worldOf(scene.game.state.tier);

  /** The world for this view; a switch frees the old world's canvases. */
  const worldFor = (view: View): TierBackdrop => {
    const w = worldOf(view.state.tier);
    if (w !== active && view === scene.renderer.view) {
      worlds[active]!.free();
      active = w;
    }
    return worlds[w]!;
  };

  const back: Layer = {
    name: 'backdrop.back',
    visible: true,
    update(view: View) {
      worldFor(view).update(view);
    },
    draw(ctx: CanvasRenderingContext2D, view: View) {
      const t0 = performance.now();
      worlds[worldOf(view.state.tier)]!.drawBack(ctx, view);
      if (grade) grade(ctx, view);
      if (host.isMain(view)) stats.backMs = stats.backMs * 0.97 + (performance.now() - t0) * 0.03;
    },
  };

  const front: Layer = {
    name: 'backdrop.front',
    visible: true,
    draw(ctx: CanvasRenderingContext2D, view: View) {
      const t0 = performance.now();
      worlds[worldOf(view.state.tier)]!.drawFront(ctx, view);
      if (host.isMain(view)) stats.frontMs = stats.frontMs * 0.97 + (performance.now() - t0) * 0.03;
    },
  };

  const api: Backdrop = {
    back,
    front,
    openEye: () => worlds[active]!.openEye(),
    onEyeOpen(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    setTransition(on) {
      transition = on;
    },
    setGrade(paint) {
      grade = paint;
    },
    wyrmPose(pose) {
      mountain.pose(pose);
    },
    drawHide(ctx, x0, y0, x1, y1, pxPerM) {
      drawHide(ctx, MOUNTAIN, x0, y0, x1, y1, pxPerM, MOUNTAIN.light.x, MOUNTAIN.light.y);
    },
    hideScaleAt,
    birds: () => worlds[active]!.birds(),
    stats,
    memMB() {
      let b = 0;
      for (const w of worlds) b += w.bytes();
      return b / (1024 * 1024);
    },
  };

  // ---- debug
  const dbg = scene.debug;
  dbg.section('backdrop');
  dbg.button('open eye', api.openEye, 'y');
  dbg.button('birds', api.birds);
  dbg.watch('backdrop ms', () => `${stats.backMs.toFixed(2)} + ${stats.frontMs.toFixed(2)}`);
  dbg.watch('backdrop MB', () => `${api.memMB().toFixed(1)} (${active === 0 ? 'meadow' : 'mountain'})`);
  dbg.watch('bakes', () => `${stats.bakes}, max ${stats.bakeMsMax.toFixed(1)} ms ${stats.bakeWorst ?? ''}`);
  dbg.watch('eye', () => worlds[active]!.eyeState());
  dbg.toggle('zoom transition', () => transition, (v) => (transition = v));
  // The world wyrm, posed by hand (as the zoom will) or by a scripted reveal.
  const hand: WyrmPose = { rise: 0, eye: 0, jaw: 0 };
  let posing = false;
  let reveal = -1;
  const applyHand = (): void => api.wyrmPose(posing ? hand : null);
  dbg.toggle('pose wyrm', () => posing, (v) => {
    posing = v;
    applyHand();
  });
  dbg.slider('wyrm rise', 0, 1, 0.01, () => hand.rise, (v) => {
    hand.rise = v;
    applyHand();
  });
  dbg.slider('wyrm eye', 0, 1, 0.01, () => hand.eye, (v) => {
    hand.eye = v;
    applyHand();
  });
  dbg.slider('wyrm jaw', 0, 1, 0.01, () => hand.jaw, (v) => {
    hand.jaw = v;
    applyHand();
  });
  dbg.button('wyrm reveal', () => (reveal = 0), 'j');
  dbg.button('avalanche', () => mountain.avalanche());
  // The scripted reveal: ~1.5 s like the zoom's (rise, eye, roar), a held stare, then release.
  const revealPose: WyrmPose = { rise: 0, eye: 0, jaw: 0 };
  scene.game.on('resync', () => (reveal = -1));
  const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const tick = back.update!;
  back.update = (view: View) => {
    if (reveal >= 0) {
      reveal += view.dt;
      const r = reveal;
      revealPose.rise = ease(r / 1.0);
      revealPose.eye = ease((r - 0.55) / 0.5);
      revealPose.jaw = ease((r - 0.95) / 0.3) * (1 - ease((r - 2.4) / 0.7));
      api.wyrmPose(revealPose);
      if (r > 4.6) {
        reveal = -1;
        applyHand();
      }
    }
    tick(view);
  };
  if (dbg.enabled) Object.assign(window, { __backdrop: api });

  return api;
}
