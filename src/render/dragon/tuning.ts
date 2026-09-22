// Named tuning constants for the dragon (hit areas, readability). Tune after playtests.

/**
 * Minimum weak-spot hit radius in CSS px. Small enough that clicking the middle of a newt is a
 * normal hit and a crit takes a little aim; big dragons use WEAK_HIT_SCALE x the drawn scale.
 */
export const WEAK_HIT_MIN_PX = 11;
/** Weak-spot hit radius as a multiple of the drawn loose scale's radius (big dragons). */
export const WEAK_HIT_SCALE = 1.3;
/** Extra pad around the silhouette for body hits, in CSS px. */
export const BODY_HIT_PAD_PX = 10;
/**
 * Loose-scale candidates by on-screen body length (px): below TORSO_SPOT_MIN_PX only the tail
 * spots (a hit circle on the torso would cover the middle of a small newt); the withers from
 * there; the back ridge (nearest the middle) only above RIDGE_SPOT_MIN_PX.
 */
export const TORSO_SPOT_MIN_PX = 150;
export const RIDGE_SPOT_MIN_PX = 260;
/** Drawn weak-spot scale radius, as a fraction of the body length, and its minimum in CSS px. */
export const WEAK_DRAW_FRAC = 0.022;
export const WEAK_DRAW_MIN_PX = 5;
/** Seconds between idle weak-spot shifts (min, max). */
export const WEAK_SHIFT_MIN = 9;
export const WEAK_SHIFT_MAX = 15;
/** Chance a crit makes the loose scale move elsewhere. */
export const WEAK_SHIFT_ON_CRIT = 0.35;

/**
 * Swipe-windup target by on-screen body length (px, at the director's target zoom). It must sit at
 * least 2x WEAK_HIT_MIN_PX from wherever the loose scale is (tail-mounted on small dragons), or
 * mashing the old scale would stagger every swipe. Measured minimum separations in the loaded
 * scorpion pose: the raised tail curl ~0.09 u (so >= 250 px), the gill-crown nape ~0.33 u (>= 72 px);
 * below that the nasal bridge (~0.5 u).
 */
export const SWIPE_CURL_MIN_PX = 250;
export const SWIPE_NAPE_MIN_PX = 72;
