// The eye in the hills: when it opens (schedule) and what it looks like at time t (pose). Pure, so
// it is unit-tested; eye.ts draws it.
import { clamp01, smoothstep } from '../../lib/math';

// ---------------------------------------------------------------- schedule

/** Seconds after the 3rd kill before the first opening (lets the kill slow-mo finish). */
export const EYE_FIRST_DELAY = 2.2;
export const EYE_MIN_GAP = 45;
export const EYE_MAX_GAP = 90;
export const EYE_FIRST_KILLS = 3;

export interface EyeSchedule {
  /** The kill-triggered first opening has happened; random openings run after it. */
  firstShown: boolean;
  /** Game time (s) of the next opening, Infinity when none is scheduled. */
  nextAt: number;
  /** Kills seen last step: a drop (reset game, new tier) restarts the schedule. */
  kills: number;
}

export function createEyeSchedule(): EyeSchedule {
  return { firstShown: false, nextAt: Infinity, kills: 0 };
}

/**
 * Advance the schedule. Returns true when the eye should open now. `busy` = the eye is already
 * animating (a due opening then waits until it closes).
 */
export function stepEyeSchedule(s: EyeSchedule, kills: number, now: number, busy: boolean): boolean {
  if (kills < s.kills) {
    s.firstShown = false;
    s.nextAt = Infinity;
  }
  s.kills = kills;
  if (!s.firstShown && s.nextAt === Infinity && kills >= EYE_FIRST_KILLS) s.nextAt = now + EYE_FIRST_DELAY;
  if (!busy && now >= s.nextAt) {
    s.firstShown = true;
    s.nextAt = Infinity;
    return true;
  }
  return false;
}

/** Call when an opening finishes: schedules the next random one (after the first has happened). */
export function eyeClosed(s: EyeSchedule, now: number, rand: number): void {
  if (s.firstShown) s.nextAt = now + EYE_MIN_GAP + clamp01(rand) * (EYE_MAX_GAP - EYE_MIN_GAP);
}

// ---------------------------------------------------------------- pose

/** Total length of one opening, in seconds. */
export const EYE_DURATION = 10.2;

export interface EyePose {
  /** Lid aperture 0 (shut) .. 1 (wide). */
  open: number;
  /** Pupil offset toward the fight, 0 (straight ahead) .. 1 (fully turned). */
  look: number;
  /** Slit width as a fraction of the eye height (dilated when it first opens, then a thin slit). */
  pupil: number;
  /** Glow strength 0..1. */
  glow: number;
}

function ease(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Pose at t seconds into an opening. The lids part with a hesitation, it gazes ahead, slides its
 * pupil toward the fight, blinks once, stares, then slowly closes. t outside [0, EYE_DURATION]
 * returns a closed eye.
 */
export function eyePose(t: number, out: EyePose): EyePose {
  if (!(t > 0 && t < EYE_DURATION)) {
    out.open = 0;
    out.look = 0;
    out.pupil = 0.4;
    out.glow = 0;
    return out;
  }
  // Lids: crack open to 0.28, hold (did I see that?), then open wide; blink at 5.6; close from 7.4.
  let open = 0.28 * ease(t / 0.9) + 0.72 * ease((t - 1.5) / 1.3);
  const blink = t - 5.6;
  if (blink > 0 && blink < 0.42) open *= Math.abs(Math.cos((blink / 0.42) * Math.PI)) * 0.94 + 0.06;
  open *= 1 - ease((t - 7.4) / 2.6);
  out.open = clamp01(open);
  // Gaze: ahead, then a slow slide toward the fight at ~3.4 s, drifting back as it closes.
  out.look = ease((t - 3.2) / 0.9) * (1 - 0.6 * ease((t - 7.6) / 2.2));
  // Pupil: dilated in the dark, contracts to a slit as it wakes.
  out.pupil = 0.42 - 0.3 * smoothstep(1.6, 3.4, t) + 0.08 * smoothstep(7.4, 9.5, t);
  out.glow = out.open;
  return out;
}
