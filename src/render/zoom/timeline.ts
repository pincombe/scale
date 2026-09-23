// The zoom cinematic's timeline (pure, tested): when each beat fires, the camera's phases, and the
// log-zoom easing. Times are seconds after zoomBegin on the cinematic's own wall clock.
//
//   0.0   rally     horns; the army rushes to the hero; the ground trembles       (old tier)
//   1.0   fusion    the pile gathers, glows and rises                              (old tier)
//   2.2   flash     snapshot + switch under the flash: the colossus's boots in the meadow
//   3.05  pullback  the camera pulls back and the meadow closes into one scale of the hide
//   4.25            ...the scale holds (~0.9 s): the colossus stands by the luminous scale
//   5.15            ...and the pull-back resumes: the hide, then the ridge, the range, the sky
//   6.4   reveal    the world wyrm's head rises over the range, its eye opens (landing at 6.7)
//   7.3   roar
//   7.9   card      II · THE MOUNTAIN
//   10.5  done      play resumes; the colossus hands over to the crowd's hero
//   11.45 end       the last of the zoom's art has faded; the snapshot is released
import type { ZoomBeat } from './api';

export const ZOOM_BEATS: readonly ZoomBeat[] = ['rally', 'fusion', 'flash', 'pullback', 'reveal', 'roar', 'card', 'done'];

export interface ZoomTimeline {
  /** Beat times (s after zoomBegin). */
  readonly beats: Readonly<Record<ZoomBeat, number>>;
  /** The crowd fuses into the pile. */
  readonly fuse: number;
  /** Snapshot + switch: the colossus appears (= beats.flash). */
  readonly flash: number;
  /**
   * The camera rests on the boots from the flash to pullStart (the meadow all around them); then
   * one log-space pull-back in three strokes: [pullStart, holdStart] the meadow closes into its
   * scale, [holdStart, holdEnd] the scale holds (a slow drift), [holdEnd, pullEnd] the hide, the
   * ridge, the range and the sky, landing at rest on the in-tier director's framing.
   */
  readonly pullStart: number;
  readonly holdStart: number;
  readonly holdEnd: number;
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
  const pullStart = flash + 0.85 * s;
  const holdStart = pullStart + 1.2 * s;
  const holdEnd = holdStart + 0.9 * s;
  const pullEnd = holdEnd + 1.55 * s;
  const reveal = pullEnd - 0.3 * s;
  const roar = reveal + 0.9 * s;
  const card = reveal + 1.5 * s;
  const done = card + 2.6 * s;
  return {
    beats: {
      rally: 0,
      fusion: 1.0,
      flash,
      pullback: pullStart,
      reveal,
      roar,
      card,
      done,
    },
    fuse: 1.3,
    flash,
    pullStart,
    holdStart,
    holdEnd,
    pullEnd,
    handoff0: done - 0.3,
    handoff1: done + 0.25,
    end: done + 1.2 * s,
  };
}

/** When the core switches tiers, and when play resumes (the core's 'end'), for the balance sim. */
export function zoomSwitchAt(gentle = false): number {
  return zoomTimeline(gentle).flash;
}

export function zoomDoneAt(gentle = false): number {
  return zoomTimeline(gentle).beats.done;
}

/** Fraction of the way through [a, b], clamped to 0..1. */
export function span(t: number, a: number, b: number): number {
  if (b <= a) return t >= b ? 1 : 0;
  const u = (t - a) / (b - a);
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/**
 * Progress 0 -> 1 for u = the fraction of a stroke's time: a trapezoid velocity profile with
 * cosine ramps (starts and lands at rest, zero acceleration at both ends, so strokes chain without
 * a jolt). `a`, `b` = the ramp-in and ramp-out spans (a + b <= 1).
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

/** d(pullEase)/du: the stroke's speed profile (for streaks and motion blur). */
export function pullSpeed(u: number, a = 0.3, b = 0.36): number {
  if (u <= 0 || u >= 1) return 0;
  const v = 1 / (1 - (a + b) / 2);
  if (u < a) return (v * (1 - Math.cos((Math.PI * u) / a))) / 2;
  if (u <= 1 - b) return v;
  return (v * (1 + Math.cos((Math.PI * (u - (1 - b))) / b))) / 2;
}
