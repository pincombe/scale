// Juice time dilation for the sim. In the game, hit-stop and slow-mo scale the logic clock too
// (ARCHITECTURE §2), so every crit and kill costs the economy a little wall time. The sim drives
// the real TimeDirector (src/app/time.ts: pure, no DOM) with the juice requests the fx layer makes.
//
// The request values are COPIED from src/render/fx/index.ts (WP 1.4), which touches the DOM and
// can't be imported here; CRIT_STOP_GAP comes from the pure render/fx/tuning.ts. Keep in sync:
//   strike handler:  on a crit, if (wall clock - last crit >= CRIT_STOP_GAP)
//                    time.hitStop(e.stagger ? 0.08 : 0.07); every crit resets the last-crit clock
//   dragonDeath:     time.hitStop(0.08); time.slowMo(0.25, 0.55)
// TimeDirector itself caps a hit-stop at 0.12 s and ignores one within 0.3 s of the previous one.
import { TimeDirector } from '../app/time';
import { CRIT_STOP_GAP } from '../render/fx/tuning';
import type { GameEvent } from '../core';

export const JUICE = {
  /** Hit-stop on a weak-spot crit (s, wall), only after CRIT_STOP_GAP s without crits. */
  critHitStop: 0.07,
  /** Hit-stop on a crit that staggers. */
  staggerHitStop: 0.08,
  /** Hit-stop on a kill. */
  killHitStop: 0.08,
  /** Kill slow-mo: starts at this scale and eases back to 1 over killSlowMoDur (wall s). */
  killSlowMo: 0.25,
  killSlowMoDur: 0.55,
} as const;

/**
 * The game's clock as the sim sees it. With `enabled` false it runs at 1× (logic time = wall time);
 * otherwise juice events feed the real TimeDirector, whose scale then drives the tick accumulator.
 */
export class JuiceClock {
  readonly time = new TimeDirector();
  /** Wall clock (s) and the last crit's time on it (a crit spree only hit-stops on its first crit). */
  private wall = 0;
  private lastCrit = -Infinity;

  constructor(readonly enabled: boolean) {}

  /** Advance one frame of wall time; returns the logic seconds it's worth. */
  update(realDt: number): number {
    this.wall += realDt;
    if (!this.enabled) return realDt;
    this.time.update(realDt);
    return this.time.dt;
  }

  /** React to a drained event the way render/fx does (only the time-scale part). */
  onEvent(e: GameEvent): void {
    if (!this.enabled) return;
    if (e.type === 'strike') {
      if (!e.crit) return;
      if (this.wall - this.lastCrit >= CRIT_STOP_GAP) this.time.hitStop(e.stagger ? JUICE.staggerHitStop : JUICE.critHitStop);
      this.lastCrit = this.wall;
    } else if (e.type === 'dragonDeath') {
      this.time.hitStop(JUICE.killHitStop);
      this.time.slowMo(JUICE.killSlowMo, JUICE.killSlowMoDur);
    }
  }
}
