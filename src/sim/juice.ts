// Juice time dilation for the sim. In the game, hit-stop and slow-mo scale the logic clock too
// (ARCHITECTURE §2), so every crit and kill costs the economy a little wall time. The sim drives
// the real TimeDirector (src/app/time.ts: pure, no DOM) with the juice requests the fx layer makes
// (src/render/fx/index.ts), using the same constants from the pure render/fx/tuning.ts:
//   strike handler:  on a crit, if (wall clock - last crit >= CRIT_STOP_GAP)
//                    hitStop(stagger ? STAGGER_HIT_STOP : CRIT_HIT_STOP); every crit resets the clock
//   dragonDeath:     hitStop(KILL_HIT_STOP); slowMo(KILL_SLOW_MO, KILL_SLOW_MO_DUR)
// TimeDirector itself caps a hit-stop at 0.12 s and ignores one within 0.3 s of the previous one.
import { TimeDirector } from '../app/time';
import { CRIT_HIT_STOP, CRIT_STOP_GAP, KILL_HIT_STOP, KILL_SLOW_MO, KILL_SLOW_MO_DUR, STAGGER_HIT_STOP } from '../render/fx/tuning';
import type { GameEvent } from '../core';

/** The fx layer's time effects (wall s), as the sim applies them. */
export const JUICE = {
  critHitStop: CRIT_HIT_STOP,
  staggerHitStop: STAGGER_HIT_STOP,
  killHitStop: KILL_HIT_STOP,
  killSlowMo: KILL_SLOW_MO,
  killSlowMoDur: KILL_SLOW_MO_DUR,
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
