// Fixed-step logic (20 Hz, accumulator) + requestAnimationFrame rendering with interpolation.
// Per frame: clamp dt -> time.update -> ticks -> game.drain -> onFrame(alpha) (camera, render, UI).
// A long gap (hidden tab, sleep) is caught up with events dropped, then one 'resync'.
import { TICK_DT } from '../core/formulas';
import type { Game } from './game';
import type { TimeDirector } from './time';

/** Longest frame delta fed to the simulation (s). Longer gaps are caught up instead. */
export const MAX_FRAME_DT = 0.1;
/** Frame gaps longer than this (s) count as "away" and trigger a silent catch-up. */
export const GAP_THRESHOLD = 1.0;
/** Safety valve for extreme debug time scales. */
const MAX_TICKS_PER_FRAME = 400;

export interface LoopStats {
  /** Wall ms between the last two frames. */
  frameMs: number;
  /** CPU ms spent inside the last frame callback (ticks + drain + render + UI). */
  cpuMs: number;
  /** Logic ticks run in the last frame. */
  ticks: number;
  /** Seconds simulated by the last catch-up (0 if none yet). */
  lastCatchUp: number;
}

export class Loop {
  readonly stats: LoopStats = { frameMs: 0, cpuMs: 0, ticks: 0, lastCatchUp: 0 };
  /** Interpolation factor in [0, 1): how far the render sits between the last tick and the next. */
  alpha = 0;
  running = false;

  private acc = 0;
  private last = -1;
  private raf = 0;
  private errors = 0;

  constructor(
    private readonly game: Game,
    private readonly time: TimeDirector,
    private readonly onFrame: (alpha: number) => void,
    private readonly onStats?: (stats: LoopStats) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const t0 = performance.now();
    try {
      this.step(now);
      this.errors = 0;
    } catch (err) {
      // Keep the loop alive but don't flood the console.
      if (this.errors++ < 3) console.error('frame failed:', err);
    }
    const stats = this.stats;
    stats.cpuMs = performance.now() - t0;
    if (this.onStats) this.onStats(stats);
  };

  private step(now: number): void {
    let raw = this.last < 0 ? 1 / 60 : (now - this.last) / 1000;
    this.last = now;
    if (raw < 0) raw = 0;
    this.stats.frameMs = raw * 1000;

    if (raw > GAP_THRESHOLD && !this.time.paused) {
      // Returning to the tab: simulate the gap silently, then rebuild visuals from state.
      this.stats.lastCatchUp = this.game.catchUp(raw - MAX_FRAME_DT);
      raw = MAX_FRAME_DT;
    }
    const realDt = raw > MAX_FRAME_DT ? MAX_FRAME_DT : raw;

    this.time.update(realDt);
    this.acc += this.time.dt;
    let ticks = 0;
    while (this.acc >= TICK_DT - 1e-9 && ticks < MAX_TICKS_PER_FRAME) {
      this.game.tick(TICK_DT);
      this.acc -= TICK_DT;
      ticks++;
    }
    if (ticks >= MAX_TICKS_PER_FRAME) this.acc = 0;
    if (this.acc < 0) this.acc = 0;
    this.stats.ticks = ticks;
    this.alpha = this.acc / TICK_DT;

    this.game.drain();
    this.onFrame(this.alpha);
  }
}
