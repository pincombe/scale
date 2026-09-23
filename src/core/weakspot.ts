// The weak-spot rule: which glowing target a dragon shows, and whether any can be hit right now.
// A game rule (a weak hit crits ×5 and, during a windup, staggers), so it lives in core: applyAction
// enforces it, and the dragon rig (render/dragon/weakspot.ts) imports it for its hit test and glow.
//
//   phase               live weak spot
//   windup (breath)     'throat'   the glowing gular pouch (the loose scale dims out)
//   windup (swipe)      'tail'     the tail base, glowing as the tail loads
//   everything else     'scale'    the loose scale
//   enter               none until ENTER_WEAK_FROM of the entrance (the dragon is still arriving)
//   dying, leave        none (a dying or leaving dragon, boss or not, can't be crit)
import type { DragonAttack, DragonPhase, DragonState } from './types';

export type WeakSpotKind = 'scale' | 'throat' | 'tail';

/** Share of the `enter` phase after which the weak spot can be hit (the newt has arrived). */
export const ENTER_WEAK_FROM = 0.72;

/** Which weak spot a dragon in this phase shows (windups move it off the loose scale). */
export function weakSpotFor(phase: DragonPhase, attack: DragonAttack): WeakSpotKind {
  if (phase === 'windup') return attack === 'breath' ? 'throat' : 'tail';
  return 'scale';
}

/** Whether a weak spot can be hit in this phase at progress k (0..1 of the phase). */
export function weakSpotLive(phase: DragonPhase, k: number): boolean {
  if (phase === 'dying' || phase === 'leave') return false;
  if (phase === 'enter') return k > ENTER_WEAK_FROM;
  return true;
}

/** How far the dragon is through its current phase (0..1; 1 when the phase has no length). */
export function phaseProgress(d: DragonState): number {
  return d.phaseDur > 0 ? d.phaseT / d.phaseDur : 1;
}

/** Whether a click on the weak spot counts right now (applyAction('strike') uses this). */
export function weakSpotHittable(d: DragonState): boolean {
  return weakSpotLive(d.phase, phaseProgress(d));
}
