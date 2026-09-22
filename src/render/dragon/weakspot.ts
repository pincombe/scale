// The weak spot: which glowing target is live, where it sits on the rig, and its fades.
// Which spot is live, and when any can be hit, is a game rule owned by core (core/weakspot.ts,
// enforced in applyAction): this file maps it onto the rig.
//
//   phase                 live weak spot
//   windup (breath)       the glowing THROAT pouch only (the loose scale dims out and can't be hit)
//   windup (swipe)        the raised TAIL CURL as the tail loads; on small on-screen dragons, where
//                         the curl would sit on top of the tail-mounted loose scale, the gill-crown
//                         NAPE (or the nasal bridge when tiny) instead (see tuning.ts SWIPE_*)
//   everything else       the LOOSE SCALE (one of the individual's candidates; shifts now and then)
//   enter (in flight), dying   none
//
// The hit position switches the instant the phase changes; only the visuals cross-fade.
import { weakSpotFor, weakSpotLive } from '../../core';
import type { DragonAttack, DragonPhase } from '../../core';
import type { DragonRig, SpineSample } from './rig';
import { SWIPE_CURL_MIN_PX, SWIPE_NAPE_MIN_PX, WEAK_SHIFT_MAX, WEAK_SHIFT_MIN } from './tuning';
import { MOUTH_Y } from './head';

export const WEAK_SCALE = 0;
export const WEAK_THROAT = 1;
export const WEAK_TAIL = 2;

/** Swipe-windup target tiers (WeakSpot.swipeSpot). */
export const SWIPE_CURL = 0;
export const SWIPE_NAPE = 1;
export const SWIPE_BROW = 2;
/** The raised tail curl: this far along the tail (0 root .. 1 tip), on the back edge. */
const CURL_T = 0.8;

/** Which swipe target fits a dragon this many px per body length on screen. */
export function swipeSpotFor(pxPerU: number): number {
  return pxPerU >= SWIPE_CURL_MIN_PX ? SWIPE_CURL : pxPerU >= SWIPE_NAPE_MIN_PX ? SWIPE_NAPE : SWIPE_BROW;
}
/** Fade times (s). */
const FADE_IN = 0.18;
const FADE_OUT = 0.12;

/** The rig's marker mode for core's live weak spot in this phase. */
export function weakModeFor(phase: DragonPhase, attack: DragonAttack): number {
  const kind = weakSpotFor(phase, attack);
  return kind === 'throat' ? WEAK_THROAT : kind === 'tail' ? WEAK_TAIL : WEAK_SCALE;
}

/** Whether a weak spot can be hit in this phase at progress k (0..1): core's rule. Clicks use this, not fades. */
export const weakLiveFor = weakSpotLive;

/** The glowing throat (u): the gular pouch under the jaw of the main head (moves with the head). */
export function throatPoint(rig: DragonRig, out: { x: number; y: number }): { x: number; y: number } {
  return rig.headToU(0, rig.head.hingeX - 0.12, MOUTH_Y + 1.02 * rig.ind.jaw, out);
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
  /** Swipe-windup target tier (SWIPE_*), chosen by the host from the on-screen size. */
  swipeSpot = SWIPE_NAPE;
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
    } else if (mode === WEAK_TAIL && this.swipeSpot !== SWIPE_CURL) {
      // Small on screen: on the head, as far from the tail-mounted loose scale as it gets.
      const hs = rig.head;
      if (this.swipeSpot === SWIPE_NAPE) rig.headToU(0, 0.02, -0.95 * rig.ind.cranium, out);
      else rig.headToU(0, hs.nostrilX + 0.2, hs.nostrilY - 0.02, out);
      rig.spineAt(0, sp);
      angle.a = rig.headA[0]! + Math.PI;
      return out;
    } else if (mode === WEAK_TAIL) {
      // The raised tail curl (up high in the loaded scorpion pose).
      rig.spineAt(rig.iH + CURL_T * (rig.n - 1 - rig.iH), sp);
      out.x = sp.x + sp.nx * sp.back * 0.8;
      out.y = sp.y + sp.ny * sp.back * 0.8;
    } else {
      const spots = rig.ind.weakSpots;
      const s = spots[idx < spots.length ? idx : 0]!;
      rig.spineAtBody(s.at, sp);
      const o = (s.side >= 0 ? s.side * sp.back : s.side * sp.belly) * 0.82;
      out.x = sp.x + sp.nx * o;
      out.y = sp.y + sp.ny * o;
    }
    angle.a = Math.atan2(sp.nx, -sp.ny);
    return out;
  }
}
