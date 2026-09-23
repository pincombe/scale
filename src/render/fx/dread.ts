// Pure curves for the Wyrm Gauge's dread and the boss fight (no DOM, unit-tested): how hard the
// ground trembles after a kill, the heartbeat's rate and shape, and the envelopes the boss module
// (./boss.ts) plays them with. None of these touch the time scale (see tuning.ts for those).
import { clamp01, lerp } from '../../lib/math';
import { TREMOR_DELAY, TREMOR_EXP } from './tuning';

// ---- tremors ----

export { TREMOR_DELAY, TREMOR_EXP };
/** Peak camera sway (Camera.sway, CSS px at a 900 px tall view) of a full-strength tremor. */
export const TREMOR_PX = 12;

/**
 * Tremor strength 0..1 from the gauge after a kill: barely there at 10% (0.02), clear by 50%
 * (0.29), unmistakable at 90% (0.83), full when the boss is next.
 */
export function tremorStrength(gauge: number): number {
  const g = clamp01(gauge);
  return Math.pow(g, TREMOR_EXP);
}

/** How long a tremor of this strength rolls (wall s). */
export function tremorDuration(strength: number): number {
  return 1.1 + 1.5 * clamp01(strength);
}

/**
 * The tremor's envelope at u = elapsed / duration: a soft swell (the wave arriving), then a long
 * decay, so it reads as something heavy shifting underground, never as a hit.
 */
export function tremorEnvelope(u: number): number {
  if (!(u > 0 && u < 1)) return 0;
  const rise = u < 0.18 ? u / 0.18 : 1;
  const r = rise * rise * (3 - 2 * rise);
  return r * (1 - u);
}

// ---- the boss's heartbeat ----

/** Heartbeat period (s) through the fight, and at the very end of the timer. */
export const HEART_PERIOD = 1.15;
export const HEART_PERIOD_URGENT = 0.5;
/** The heartbeat quickens over the timer's last this-many seconds. */
export const HEART_URGENT_FROM = 10;

/** Urgency 0..1 from the boss's time left: 0 until the last HEART_URGENT_FROM s, 1 at the end. */
export function bossUrgency(timeLeft: number): number {
  if (!(timeLeft > 0)) return 0;
  return clamp01(1 - timeLeft / HEART_URGENT_FROM);
}

/** Seconds between beats at this urgency (eases in, so the last seconds race). */
export function heartPeriod(urgency: number): number {
  const u = clamp01(urgency);
  return lerp(HEART_PERIOD, HEART_PERIOD_URGENT, u * (0.55 + 0.45 * u));
}

/** Seconds from the "lub" to the "dub". */
export const HEART_DUB = 0.21;

function beat(t: number, attack: number, decay: number): number {
  if (t <= 0) return 0;
  if (t < attack) {
    const x = t / attack;
    return x * x * (3 - 2 * x);
  }
  return Math.exp(-(t - attack) / decay);
}

/** Pulse 0..1 at t seconds after a beat started: a strong lub, then a softer dub. */
export function heartPulse(t: number): number {
  const lub = beat(t, 0.04, 0.15);
  const dub = 0.6 * beat(t - HEART_DUB, 0.035, 0.13);
  return lub > dub ? lub : dub;
}

// ---- the camera push when the boss engages ----

/** Push envelope (0..1) at t wall seconds after the boss became hittable. */
export const PUSH_DUR = 1.2;
export function pushEnvelope(t: number): number {
  if (!(t > 0 && t < PUSH_DUR)) return 0;
  if (t < 0.16) {
    const x = t / 0.16;
    return 1 - (1 - x) * (1 - x);
  }
  if (t < 0.4) return 1;
  const x = (t - 0.4) / (PUSH_DUR - 0.4);
  return 1 - x * x * (3 - 2 * x);
}
