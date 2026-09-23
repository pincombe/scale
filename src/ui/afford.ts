// Shared affordability states for buy buttons and cards (Army, Upgrades, Champions, Heraldry):
// `.can` / `.off`, plus a one-shot `.fresh` shimmer on each false → true edge.
import { setClass } from './dom';

/** How long a just-affordable button shimmers (ms). */
export const FRESH_MS = 1400;

/** Tracks affordability to flash "just became affordable" once per false → true edge. */
export class Afford {
  private was = false;
  private until = 0;
  constructor(private readonly target: HTMLElement) {}
  set(can: boolean, now: number): void {
    if (can && !this.was) this.until = now + FRESH_MS;
    this.was = can;
    setClass(this.target, 'can', can);
    setClass(this.target, 'off', !can);
    setClass(this.target, 'fresh', can && now < this.until);
  }
}
