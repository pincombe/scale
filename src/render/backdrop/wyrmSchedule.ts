// The Mountain's world wyrm, left to itself: it dozes behind the ridge, breathes out a slow mist,
// and now and then lifts a heavy lid to watch the fight (a drowsy look and a slow blink), then
// sleeps again. And the hand-back: when the zoom lets go of a posed wyrm, it settles back to rest
// instead of snapping. Pure (no DOM), so it is unit-tested; worldWyrm.ts draws it.
import { clamp01, smoothstep } from '../../lib/math';
import type { WyrmPose } from './api';

/** Seconds between breaths (mist on each exhale). */
export const BREATH_PERIOD = 7.5;
/** First look after the tier starts (s), then every MIN..MAX s. */
export const WAKE_FIRST = 24;
export const WAKE_MIN_GAP = 38;
export const WAKE_MAX_GAP = 70;
/** Length of one drowsy look (s) and how far the lid lifts. */
export const WAKE_DURATION = 11;
export const WAKE_OPEN = 0.55;

export interface WyrmIdle {
  /** Seconds since the schedule started (tier entered / pose released). */
  t: number;
  /** Time of the next look; -1 while one is playing. */
  nextWake: number;
  /** Seconds into the current look (-1 when none). */
  wakeT: number;
  /** Breath phase 0..1 (exhale starts at 0). */
  breath: number;
}

export function createWyrmIdle(): WyrmIdle {
  return { t: 0, nextWake: WAKE_FIRST, wakeT: -1, breath: 0.3 };
}

/** Restart (new tier, or after the zoom hands the wyrm back): the next look waits a full gap. */
export function resetWyrmIdle(s: WyrmIdle, firstIn = WAKE_FIRST): void {
  s.t = 0;
  s.nextWake = firstIn;
  s.wakeT = -1;
  s.breath = 0.3;
}

/** Events of one step: an exhale began, the eye began to open. */
export interface WyrmIdleEvents {
  exhale: boolean;
  eyeOpens: boolean;
}

/** Advance by dt. `rand` in [0, 1) picks the next gap. `force` starts a look now (debug, openEye). */
export function stepWyrmIdle(s: WyrmIdle, dt: number, rand: number, force: boolean, ev: WyrmIdleEvents): WyrmIdleEvents {
  ev.exhale = false;
  ev.eyeOpens = false;
  if (!(dt > 0)) dt = 0;
  s.t += dt;
  const b = s.breath + dt / BREATH_PERIOD;
  if (b >= 1) ev.exhale = true;
  s.breath = b % 1;
  if (s.wakeT >= 0) {
    s.wakeT += dt;
    if (s.wakeT >= WAKE_DURATION) {
      s.wakeT = -1;
      s.nextWake = s.t + WAKE_MIN_GAP + clamp01(rand) * (WAKE_MAX_GAP - WAKE_MIN_GAP);
    }
  } else if (force || s.t >= s.nextWake) {
    s.wakeT = 0;
    s.nextWake = -1;
    ev.eyeOpens = true;
  }
  return ev;
}

function ease(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * The resting pose for the schedule: the lid lifts slowly to a drowsy half-open (did something
 * move?), holds, blinks once slowly, and sinks shut. Rise and jaw stay at rest; `breath` is the
 * exhale envelope 0..1 (the head settles a hair as it breathes out).
 */
export function idlePose(s: WyrmIdle, out: WyrmPose): WyrmPose {
  out.rise = 0;
  out.jaw = 0;
  let eye = 0;
  const w = s.wakeT;
  if (w >= 0 && w < WAKE_DURATION) {
    eye = WAKE_OPEN * ease(w / 2.6) * (1 - ease((w - 7.6) / 3));
    const blink = w - 5.2;
    if (blink > 0 && blink < 1.1) eye *= 0.08 + 0.92 * Math.abs(Math.cos((blink / 1.1) * Math.PI));
  }
  out.eye = clamp01(eye);
  return out;
}

/** Exhale envelope 0..1 for the breath phase (quick swell, slow release). */
export function exhale(breath: number): number {
  return smoothstep(0, 0.12, breath) * (1 - smoothstep(0.12, 0.6, breath));
}

/**
 * Follow a target pose. Driven (the zoom posing it): exact. Released: settle with the given
 * rates (1/s): a reared wyrm lowers its head slowly, the jaw shuts faster, the eye closes last.
 */
export function followPose(cur: WyrmPose, target: WyrmPose, driven: boolean, dt: number): void {
  if (driven) {
    cur.rise = clamp01(target.rise);
    cur.eye = clamp01(target.eye);
    cur.jaw = clamp01(target.jaw);
    return;
  }
  const t = Math.max(0, dt);
  cur.rise += (target.rise - cur.rise) * (1 - Math.exp(-0.9 * t));
  cur.jaw += (target.jaw - cur.jaw) * (1 - Math.exp(-3.2 * t));
  cur.eye += (target.eye - cur.eye) * (1 - Math.exp(-(cur.rise > 0.3 ? 0.35 : 1.4) * t));
  if (Math.abs(cur.rise - target.rise) < 1e-4) cur.rise = target.rise;
  if (Math.abs(cur.jaw - target.jaw) < 1e-4) cur.jaw = target.jaw;
  if (Math.abs(cur.eye - target.eye) < 1e-4) cur.eye = target.eye;
}
