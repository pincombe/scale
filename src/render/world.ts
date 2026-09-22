// World conventions shared by every render module.
//
// Units are tier-local meters. Ground at y = 0, +y is DOWN (canvas convention), sky is y < 0.
// The dragon stands on the right facing left with its rest-pose front at x = CLASH_X; the army
// stands on the left (x < CLASH_X) facing right. Dragons grow within a tier and the camera pulls
// back to frame them, so knights shrink on screen as dragons grow.

/** Knight height in meters (the scale reference of the whole game). */
export const KNIGHT_HEIGHT = 1.8;
export const GROUND_Y = 0;
/** Where the dragon's rest-pose front edge sits; the hero stands just left of it. */
export const CLASH_X = 0;
/** Layers that fill the screen should overdraw this many CSS px past each edge (shake, roll). */
export const SAFE_MARGIN = 64;
