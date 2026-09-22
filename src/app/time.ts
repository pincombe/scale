// TimeDirector: one effective time scale for logic and render.
//   scale = debugScale x slowMo (eases back to 1) x hitStop (0 while frozen), or 0 when paused.
// Scaled dt drives ticks, animation and particles; realDt drives UI, grain, shake and the
// timers of slowMo/hitStop themselves (so a 1 s slow-mo lasts 1 s of wall time).
import { clamp01, lerp } from '../lib/math';
import { inQuad } from '../lib/ease';
import { TICK_DT } from '../core/formulas';

export class TimeDirector {
  /** Debug multiplier (0-20). */
  debugScale = 1;
  paused = false;

  /** Effective scale this frame. */
  scale = 1;
  /** Scaled seconds this frame / since start. */
  dt = 0;
  time = 0;
  /** Unscaled (wall) seconds this frame / since start. */
  realDt = 0;
  realTime = 0;
  frame = 0;

  private slowFactor = 1;
  private slowElapsed = 0;
  private slowDur = 0;
  private stopLeft = 0;
  private steps = 0;

  /**
   * Slow time to `factor` (e.g. 0.3) and ease back to 1 over `seconds` of wall time.
   * Overlapping calls keep whichever is slower right now.
   */
  slowMo(factor: number, seconds: number): void {
    const f = clamp01(factor);
    if (seconds <= 0) return;
    if (f <= this.currentSlow()) {
      this.slowFactor = f;
      this.slowDur = seconds;
      this.slowElapsed = 0;
    }
  }

  /** Freeze time completely for `seconds` of wall time (max-merged with any freeze in progress). */
  hitStop(seconds: number): void {
    if (seconds > this.stopLeft) this.stopLeft = seconds;
  }

  private static readonly EPS = 1e-6;

  /** While paused: advance exactly one logic tick on the next frame. */
  step(): void {
    this.steps++;
  }

  get frozen(): boolean {
    return this.stopLeft > TimeDirector.EPS;
  }

  private currentSlow(): number {
    if (this.slowElapsed >= this.slowDur) return 1;
    // Hold near the target, then ease back: most of the duration feels slow.
    return lerp(this.slowFactor, 1, inQuad(clamp01(this.slowElapsed / this.slowDur)));
  }

  /** Called once per frame by the loop with the clamped wall-clock delta. */
  update(realDt: number): void {
    this.frame++;
    this.realDt = realDt;
    this.realTime += realDt;
    const slow = this.currentSlow();
    if (this.slowElapsed < this.slowDur) this.slowElapsed += realDt;
    let stop = 1;
    if (this.stopLeft > TimeDirector.EPS) {
      this.stopLeft -= realDt;
      stop = 0;
    }
    if (this.stopLeft <= TimeDirector.EPS) this.stopLeft = 0;
    if (this.paused) {
      if (this.steps > 0) {
        this.steps--;
        this.scale = 0;
        this.dt = TICK_DT;
      } else {
        this.scale = 0;
        this.dt = 0;
      }
    } else {
      this.steps = 0;
      this.scale = this.debugScale * slow * stop;
      this.dt = realDt * this.scale;
    }
    this.time += this.dt;
  }
}
