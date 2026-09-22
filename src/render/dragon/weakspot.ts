// The weak spot: which glowing target is live, where it sits on the rig, and its fades.
// Pure logic (no DOM) so the balance-critical rules are testable:
//
//   phase                 live weak spot
//   windup (breath)       the glowing THROAT only (the loose scale dims out and can't be hit)
//   windup (swipe)        the TAIL BASE, glowing as the tail loads
//   everything else       the LOOSE SCALE (one of the individual's candidates; shifts now and then)
//   enter (in flight), dying   none
//
// The hit position switches the instant the phase changes; only the visuals cross-fade.
import type { DragonAttack, DragonPhase } from '../../core';
import type { DragonRig, SpineSample } from './rig';
import { WEAK_SHIFT_MAX, WEAK_SHIFT_MIN } from './tuning';
import { MOUTH_Y } from './head';

export const WEAK_SCALE = 0;
export const WEAK_THROAT = 1;
export const WEAK_TAIL = 2;

/** Where the tail-base spot sits (body fraction, side). */
const TAIL_AT = 1.42;
const TAIL_SIDE = 0.62;
/** Fade times (s). */
const FADE_IN = 0.18;
const FADE_OUT = 0.12;

export function weakModeFor(phase: DragonPhase, attack: DragonAttack): number {
  if (phase === 'windup') return attack === 'breath' ? WEAK_THROAT : WEAK_TAIL;
  return WEAK_SCALE;
}

/** Whether a weak spot can be hit in this phase at progress k (0..1). Clicks use this, not fades. */
export function weakLiveFor(phase: DragonPhase, k: number): boolean {
  if (phase === 'dying') return false;
  if (phase === 'enter') return k > 0.72;
  return true;
}

/** The glowing throat (u): the gular pouch under the jaw of the main head (moves with the head). */
export function throatPoint(rig: DragonRig, out: { x: number; y: number }): { x: number; y: number } {
  return rig.headToU(0, rig.head.hingeX - 0.16, MOUTH_Y + 0.9 * rig.ind.jaw, out);
}

export class WeakSpot {
  /** Live mode and loose-scale candidate. */
  mode = WEAK_SCALE;
  idx = 0;
  /** 0..1 fade-in of the live marker; the previous marker fades out. */
  fadeIn = 1;
  prevMode = WEAK_SCALE;
  prevIdx = 0;
  prevFade = 0;
  /** Phase gate 0..1 (hidden while flying in and while dying). */
  vis = 0;
  private shiftIn = 10;
  private rand: () => number = Math.random;

  reset(rand: () => number = Math.random): void {
    this.rand = rand;
    this.mode = WEAK_SCALE;
    this.idx = 0;
    this.fadeIn = 1;
    this.prevFade = 0;
    this.vis = 0;
    this.shiftIn = WEAK_SHIFT_MIN + rand() * (WEAK_SHIFT_MAX - WEAK_SHIFT_MIN);
  }

  /** True when a click can land on it. */
  get live(): boolean {
    return this.vis > 0.3;
  }

  /** Move the loose scale soon (e.g. after a crit). */
  shiftSoon(delay: number): void {
    this.shiftIn = Math.min(this.shiftIn, delay);
  }

  /**
   * Advance by dt. `candidates` is how many loose-scale spots may be used (the ridge spot only
   * when the dragon is big on screen).
   */
  update(dt: number, phase: DragonPhase, attack: DragonAttack, k: number, candidates: number): void {
    const want = weakModeFor(phase, attack);
    if (want !== this.mode) this.switchTo(want, this.idx);
    if (this.mode === WEAK_SCALE && dt > 0) {
      this.shiftIn -= dt;
      if (this.shiftIn <= 0) {
        this.shiftIn = WEAK_SHIFT_MIN + this.rand() * (WEAK_SHIFT_MAX - WEAK_SHIFT_MIN);
        if (candidates > 1) {
          let next = this.idx;
          for (let t = 0; t < 8 && next === this.idx; t++) next = Math.floor(this.rand() * candidates);
          if (next !== this.idx) this.switchTo(WEAK_SCALE, next);
        }
      }
    }
    if (this.idx >= candidates) this.idx = 0;
    this.fadeIn = Math.min(1, this.fadeIn + dt / FADE_IN);
    this.prevFade = Math.max(0, this.prevFade - dt / FADE_OUT);
    const gate = weakLiveFor(phase, k) ? 1 : 0;
    this.vis += (gate - this.vis) * (1 - Math.exp(-14 * dt));
    if (gate === 0 && this.vis < 0.02) this.vis = 0;
  }

  /** Snap to the phase's mode with no fades (new dragon, resync). */
  snap(phase: DragonPhase, attack: DragonAttack, k: number): void {
    this.mode = weakModeFor(phase, attack);
    this.fadeIn = 1;
    this.prevFade = 0;
    this.vis = weakLiveFor(phase, k) ? 1 : 0;
  }

  private switchTo(mode: number, idx: number): void {
    this.prevMode = this.mode;
    this.prevIdx = this.idx;
    this.prevFade = this.fadeIn;
    this.mode = mode;
    this.idx = idx;
    this.fadeIn = 0;
  }

  /**
   * Position (u) of a marker on the live rig; writes the body tangent angle to `angle.a`.
   * mode/idx default to the live marker.
   */
  pos(rig: DragonRig, sp: SpineSample, out: { x: number; y: number }, angle: { a: number }, mode = this.mode, idx = this.idx): { x: number; y: number } {
    if (mode === WEAK_THROAT) {
      // The throat pouch, just under the back of the jaw (it moves with the head).
      throatPoint(rig, out);
      rig.spineAt(rig.iS * 0.3, sp);
    } else {
      let at = TAIL_AT;
      let side = TAIL_SIDE;
      if (mode === WEAK_SCALE) {
        const spots = rig.ind.weakSpots;
        const s = spots[idx < spots.length ? idx : 0]!;
        at = s.at;
        side = s.side;
      }
      rig.spineAtBody(at, sp);
      const o = (side >= 0 ? side * sp.back : side * sp.belly) * 0.82;
      out.x = sp.x + sp.nx * o;
      out.y = sp.y + sp.ny * o;
    }
    angle.a = Math.atan2(sp.nx, -sp.ny);
    return out;
  }
}
