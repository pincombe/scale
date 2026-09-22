// One shared wind field for the whole meadow: grass, flowers, the windmill, seeds and fireflies all
// read it so everything moves together. Pure and allocation-free (safe for anyone to import).
//
//   wind(x, t): lean strength at position x (meters-ish) and time t (s). > 0 blows toward +x.
//   Roughly 0.1..1.6: a slow breeze plus gust fronts that travel left to right, plus flutter.
import { Noise } from '../../lib/noise';

const N = new Noise(0x3a17d);

/** Slowly varying global breeze, ~0.2..0.7. */
export function breeze(t: number): number {
  return 0.45 + 0.2 * N.n1(t * 0.07) + 0.07 * N.n1(t * 0.31 + 11.3);
}

/** Gust envelope at x, t (0..~1.3): fronts roll across the meadow at ~5 m/s. */
export function gust(x: number, t: number): number {
  const g = N.n1(x * 0.09 - t * 0.45 + 40.7);
  return g > 0 ? g * g * 1.3 : 0;
}

/** Full wind at x, t: breeze + travelling gusts + fine flutter. */
export function wind(x: number, t: number): number {
  return breeze(t) + gust(x, t) + 0.1 * N.n1(x * 1.3 + t * 2.3 + 90.1);
}
