// The eye in the hills: when it opens (schedule) and what it looks like at time t (pose). Pure, so
// it is unit-tested; eye.ts draws it.
import { clamp01, smoothstep } from '../../lib/math';
import { sel, type GameState } from '../../core';

// ---------------------------------------------------------------- schedule

/**
 * The first opening is the PLAN §2 foreshadowing beat (~2:00-2:30), tied to the Wyrm Gauge (WP
 * 2.2): it opens once the gauge reaches EYE_GAUGE (the tremors are unmistakable by then), but never
 * before EYE_EARLIEST s of play, and at EYE_FALLBACK s at the latest (once the player has started),
 * so a casual player (boss at ~4:30) sees it well before the boss. After that it opens every
 * EYE_MIN_GAP-EYE_MAX_GAP s, and whenever a boss is summoned it opens to watch the fight (and
 * reopens EYE_BOSS_GAP s after each closing while the boss fights). The sim (src/sim/play.ts)
 * runs this same schedule for its "eye first opens" target.
 */
export const EYE_GAUGE = 0.7;
/** Play time (state.t, s) before which the gauge alone never opens it. */
export const EYE_EARLIEST = 120;
/** Play time (state.t, s) at which it opens anyway (the player has struck at least once). */
export const EYE_FALLBACK = 165;
/** Seconds after the kill that filled the gauge to EYE_GAUGE (lets the kill's slow-mo finish). */
export const EYE_FIRST_DELAY = 2.2;
export const EYE_MIN_GAP = 45;
export const EYE_MAX_GAP = 90;
/** While a boss fights, the eye reopens this soon after it closes. */
export const EYE_BOSS_GAP = 3.5;

export interface EyeSchedule {
  /** The first opening has happened; random openings run after it. */
  firstShown: boolean;
  /** Game time (s, the caller's clock) of the next opening, Infinity when none is scheduled. */
  nextAt: number;
  /** Kills and play time seen last step: a drop (reset game, new tier) restarts the schedule. */
  kills: number;
  t: number;
  /** The boss (dragon id) the eye already opened for, and whether a boss is fighting now. */
  bossId: number;
  bossUp: boolean;
}

export function createEyeSchedule(): EyeSchedule {
  return { firstShown: false, nextAt: Infinity, kills: 0, t: 0, bossId: -1, bossUp: false };
}

/**
 * Advance the schedule. Returns true when the eye should open now. `now` is the caller's clock
 * (game-scaled seconds; it only needs to be consistent); `busy` = the eye is already animating (a
 * due opening then waits until it closes).
 */
export function stepEyeSchedule(s: EyeSchedule, state: GameState, now: number, busy: boolean): boolean {
  if (state.kills < s.kills || state.t < s.t) {
    s.firstShown = false;
    s.nextAt = Infinity;
    s.bossId = -1;
  }
  s.kills = state.kills;
  s.t = state.t;
  const d = state.dragon;
  s.bossUp = d.boss !== null && d.phase !== 'dying' && d.phase !== 'leave';
  // A boss is summoned: the eye opens to watch the fight.
  if (s.bossUp && d.id !== s.bossId) {
    s.bossId = d.id;
    s.nextAt = Math.min(s.nextAt, now);
  }
  if (!s.firstShown && s.nextAt === Infinity) {
    if (sel.gauge(state) >= EYE_GAUGE) s.nextAt = now + Math.max(EYE_FIRST_DELAY, EYE_EARLIEST - state.t);
    else if (state.t >= EYE_FALLBACK && state.stats.strikes > 0) s.nextAt = now;
  }
  if (now >= s.nextAt) {
    if (busy) {
      // Already open (a boss arrived mid-opening, or a manual one): it counts.
      if (s.bossUp) {
        s.firstShown = true;
        s.nextAt = Infinity;
      }
      return false;
    }
    s.firstShown = true;
    s.nextAt = Infinity;
    return true;
  }
  return false;
}

/** Call when an opening finishes: schedules the next one (after the first has happened). */
export function eyeClosed(s: EyeSchedule, now: number, rand: number): void {
  if (s.bossUp) s.nextAt = now + EYE_BOSS_GAP;
  else if (s.firstShown) s.nextAt = now + EYE_MIN_GAP + clamp01(rand) * (EYE_MAX_GAP - EYE_MIN_GAP);
}

// ---------------------------------------------------------------- pose

/** Total length of one opening, in seconds. */
export const EYE_DURATION = 10.2;
/** Moments the lids move enough to shake stones loose: the first crack, and opening wide. */
export const EYE_CRACK_T = 0.35;
export const EYE_WIDE_T = 1.6;

export interface EyePose {
  /** Lid aperture 0 (shut) .. 1 (wide). */
  open: number;
  /** Pupil offset toward the fight, 0 (straight ahead) .. 1 (fully turned). */
  look: number;
  /** Slit width as a fraction of the eye height (dilated when it first opens, then a thin slit). */
  pupil: number;
  /** Glow strength 0..1. */
  glow: number;
  /** How far the face has surfaced from the rock, 0..1: builds as it wakes, holds through the
   *  blink, fades as it goes back to sleep. */
  awake: number;
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
    out.awake = 0;
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
  out.awake = ease((t - 0.4) / 2.4) * (1 - ease((t - 7.2) / 2.8));
  return out;
}
