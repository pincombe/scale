// Easing curves: t in [0, 1] -> [0, 1] (back/elastic overshoot). Pure and allocation-free.

export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;

export const inQuad: Ease = (t) => t * t;
export const outQuad: Ease = (t) => t * (2 - t);
export const inOutQuad: Ease = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

export const inCubic: Ease = (t) => t * t * t;
export const outCubic: Ease = (t) => {
  const u = 1 - t;
  return 1 - u * u * u;
};
export const inOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - 4 * (1 - t) * (1 - t) * (1 - t));

export const outQuart: Ease = (t) => {
  const u = 1 - t;
  return 1 - u * u * u * u;
};
export const outQuint: Ease = (t) => {
  const u = 1 - t;
  return 1 - u * u * u * u * u;
};

export const inExpo: Ease = (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10));
export const outExpo: Ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export const inOutSine: Ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
export const outSine: Ease = (t) => Math.sin((Math.PI * t) / 2);

/** Overshoots then settles; ~10% overshoot. */
export const outBack: Ease = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

export const outElastic: Ease = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};

/** 0 -> 1 -> 0 hump (sin), handy for one-shot pulses. */
export const pulse: Ease = (t) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));
