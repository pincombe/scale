// Scalar math helpers. Pure, allocation-free, safe to use from core and hot render paths.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse of lerp: where x sits between a and b (unclamped). Returns 0 when a === b. */
export function invLerp(a: number, b: number, x: number): number {
  return a === b ? 0 : (x - a) / (b - a);
}

/** Map x from [a0, a1] to [b0, b1] (unclamped). */
export function remap(x: number, a0: number, a1: number, b0: number, b1: number): number {
  return b0 + (b1 - b0) * invLerp(a0, a1, x);
}

/** Hermite smoothstep of x between edges e0 and e1, clamped to [0, 1]. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01(invLerp(e0, e1, x));
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent exponential smoothing toward a target.
 * `lambda` is the rate in 1/s: after 1/lambda seconds ~63% of the gap is closed.
 * damp(x, t, l, a) then damp(.., b) equals one call with dt = a + b.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Velocity carrier for smoothDamp. Allocate once per animated value, reuse forever. */
export interface Spring {
  v: number;
}

/**
 * Critically damped spring toward a target (Game Programming Gems 4, "SmoothDamp").
 * Continuous velocity: retargeting mid-flight never pops. `smoothTime` ~ time to reach the target.
 * Mutates `spring.v`; returns the new value.
 */
export function smoothDamp(current: number, target: number, spring: Spring, smoothTime: number, dt: number): number {
  if (dt <= 0) return current;
  const st = smoothTime < 1e-4 ? 1e-4 : smoothTime;
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (spring.v + omega * change) * dt;
  spring.v = (spring.v - omega * temp) * exp;
  let out = target + (change + temp) * exp;
  // Prevent overshoot.
  if (target - current > 0 === out > target) {
    out = target;
    spring.v = (out - target) / dt;
  }
  return out;
}

/** Move x toward target by at most maxDelta. */
export function approach(x: number, target: number, maxDelta: number): number {
  return x < target ? Math.min(x + maxDelta, target) : Math.max(x - maxDelta, target);
}

/** Wrap x into [lo, hi). */
export function wrap(x: number, lo: number, hi: number): number {
  const r = hi - lo;
  return lo + ((((x - lo) % r) + r) % r);
}

/** Shortest signed angular difference b - a, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  return wrap(b - a + Math.PI, 0, TAU) - Math.PI;
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

/** 32-bit integer hash (lowbias32). Deterministic; returns uint32. */
export function hash32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d);
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** Hash of two ints to a float in [0, 1). */
export function hash2f(x: number, y: number): number {
  return hash32((Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0) / 4294967296;
}
