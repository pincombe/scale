// TimeDirector: one effective time scale for logic and render.
//   scale = debugScale x slowMo (eases back to 1) x hitStop (0 while frozen), or 0 when paused.
// Scaled dt drives ticks, animation and particles; realDt drives UI, grain, shake and the
// timers of slowMo/hitStop themselves (so a 1 s slow-mo lasts 1 s of wall time).
//
// Juice costs logic time: the freeze scales the tick accumulator too (consistent world), so
// hit-stops are rate-limited (a new one within HIT_STOP_COOLDOWN s of the last start is ignored)
// and capped at HIT_STOP_MAX. `dilation` reports juice-scaled / wall time over ~30 s.
import { clamp01, lerp } from '../lib/math';
import { inQuad } from '../lib/ease';
import { TICK_DT } from '../core/formulas';

/** Longest single hit-stop (s). */
export const HIT_STOP_MAX = 0.12;
/** A hit-stop requested less than this (wall s) after the previous one started is ignored. */
export const HIT_STOP_COOLDOWN = 0.3;
/** Dilation window: DILATION_BUCKETS buckets of DILATION_BUCKET wall seconds. */
const DILATION_BUCKETS = 30;
const DILATION_BUCKET = 1;

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
  private stopStart = -Infinity;
  private readonly dilReal = new Float64Array(DILATION_BUCKETS);
  private readonly dilScaled = new Float64Array(DILATION_BUCKETS);
  private dilIdx = 0;

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

  /**
   * Freeze time completely for `seconds` (capped at HIT_STOP_MAX) of wall time. Ignored if another
   * hit-stop started less than HIT_STOP_COOLDOWN wall seconds ago; requests in the same frame as
   * the one that started are max-merged (a crit and a kill landing together).
   */
  hitStop(seconds: number): void {
    const s = seconds < HIT_STOP_MAX ? seconds : HIT_STOP_MAX;
    if (!(s > 0)) return;
    const since = this.realTime - this.stopStart;
    if (since === 0) {
      if (s > this.stopLeft) this.stopLeft = s;
      return;
    }
    if (since < HIT_STOP_COOLDOWN) return;
    this.stopStart = this.realTime;
    this.stopLeft = s;
  }

  /**
   * Juice-scaled time / wall time over the last ~30 s (1 = juice cost nothing). Ignores the debug
   * scale and pause: it measures what hit-stop and slow-mo take from the economy.
   */
  get dilation(): number {
    let r = 0;
    let sc = 0;
    for (let i = 0; i < DILATION_BUCKETS; i++) {
      r += this.dilReal[i]!;
      sc += this.dilScaled[i]!;
    }
    return r > 0 ? sc / r : 1;
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
    if (!this.paused) this.trackDilation(realDt, slow * stop);
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

  private trackDilation(realDt: number, juice: number): void {
    let i = this.dilIdx;
    if (this.dilReal[i]! >= DILATION_BUCKET) {
      i = this.dilIdx = (i + 1) % DILATION_BUCKETS;
      this.dilReal[i] = 0;
      this.dilScaled[i] = 0;
    }
    this.dilReal[i]! += realDt;
    this.dilScaled[i]! += realDt * juice;
  }
}
