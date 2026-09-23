// The zoom cinematic's timeline (pure, tested): when each beat fires, the pull-back's span, and the
// log-zoom easing. Times are seconds after zoomBegin on the cinematic's own wall clock.
//
//   0.0  rally     horns; the army rushes to the hero; the ground trembles       (old tier)
//   1.0  fusion    the pile gathers, glows and rises                              (old tier)
//   2.2  flash     snapshot + switch under the flash: the colossus's boots
//   2.55 pullback  the zoom-out is under way (it eases in from the flash)         (new tier)
//   6.1  reveal    the world wyrm's head rises over the range, its eye opens
//   7.0  roar
//   7.6  card      II · THE MOUNTAIN
//   10.2 done      play resumes; the colossus hands over to the crowd's hero
//   11.4 end       the last of the zoom's art has faded; the snapshot is released
import type { ZoomBeat } from './api';

export const ZOOM_BEATS: readonly ZoomBeat[] = ['rally', 'fusion', 'flash', 'pullback', 'reveal', 'roar', 'card', 'done'];

export interface ZoomTimeline {
  /** Beat times (s after zoomBegin). */
  readonly beats: Readonly<Record<ZoomBeat, number>>;
  /** The crowd fuses into the pile (the stand-in hides the crowd layer here). */
  readonly fuse: number;
  /** Snapshot + switch: the colossus appears (= beats.flash). */
  readonly flash: number;
  /** The pull-back: one log-space zoom from the boots to the new tier's base framing. */
  readonly pullStart: number;
  readonly pullEnd: number;
  /** The colossus cross-fades into the crowd's hero over [handoff0, handoff1]. */
  readonly handoff0: number;
  readonly handoff1: number;
  /** Everything of the zoom's is gone (the hide overlay, the meadow scale); the snapshot is freed. */
  readonly end: number;
}

/** Normal timings; `gentle` (settings.reduceMotion) plays everything after the flash slower. */
export function zoomTimeline(gentle = false): ZoomTimeline {
  const s = gentle ? 1.22 : 1;
  const flash = 2.2;
  const pullStart = flash;
  const pullEnd = flash + 4.2 * s;
  const reveal = flash + 3.9 * s;
  const roar = reveal + 0.9 * s;
  const card = reveal + 1.5 * s;
  const done = card + 2.6 * s;
  return {
    beats: {
      rally: 0,
      fusion: 1.0,
      flash,
      pullback: flash + 0.35 * s,
      reveal,
      roar,
      card,
      done,
    },
    fuse: 1.3,
    flash,
    pullStart,
    pullEnd,
    handoff0: done - 0.3,
    handoff1: done + 0.25,
    end: done + 1.2 * s,
  };
}

/** Fraction of the way through [a, b], clamped to 0..1. */
export function span(t: number, a: number, b: number): number {
  if (b <= a) return t >= b ? 1 : 0;
  const u = (t - a) / (b - a);
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/**
 * The pull-back's progress in log-zoom (0 at the boots, 1 at the base framing) for u = the
 * fraction of its time. A trapezoid velocity profile with cosine ramps: a slow start (the boots
 * read before they shrink), a long stretch of constant perceived speed, and a landing with zero
 * velocity (the in-tier director takes over at rest). `a`, `b` = the ramp-in and ramp-out spans.
 */
export function pullEase(u: number, a = 0.3, b = 0.36): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const v = 1 / (1 - (a + b) / 2);
  if (u < a) return v * (u / 2 - (a / (2 * Math.PI)) * Math.sin((Math.PI * u) / a));
  const mid = 1 - a - b;
  if (u <= a + mid) return v * (a / 2 + (u - a));
  const w = u - (a + mid);
  return v * (a / 2 + mid + w / 2 + (b / (2 * Math.PI)) * Math.sin((Math.PI * w) / b));
}

/** d(pullEase)/du: the zoom's speed profile (for streaks and motion blur). */
export function pullSpeed(u: number, a = 0.3, b = 0.36): number {
  if (u <= 0 || u >= 1) return 0;
  const v = 1 / (1 - (a + b) / 2);
  if (u < a) return (v * (1 - Math.cos((Math.PI * u) / a))) / 2;
  if (u <= 1 - b) return v;
  return (v * (1 + Math.cos((Math.PI * (u - (1 - b))) / b))) / 2;
}
