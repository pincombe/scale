// Species- and boss-specific choreography (the styles in BehaviorTuning / BossDef), used by
// Choreo.apply (./choreo.ts). Pure: each move writes pose-channel targets on the rig for phase
// progress e.k; the rig smooths them. Rig frame: +x toward the tail (the dragon faces -x), +y
// down; C_X/C_Y move the root in that frame (so a turned-around dragon, C_FACE = -1, walks away
// from the army with C_X < 0).
//
//   enter  'glide'  swoops in from the upper right on spread wings, flares and lands (wyvern)
//          'walk'   walks in with heavy, slow steps and bellows (the Elder Newt)
//   leave  'fly'    turns, crouches and takes off, climbing away to the upper right
//          'walk'   turns and walks off with dignity; 'scuttle' scurries off (the newt)
//   swipe  'slam'   hops in and whips the coiled tail over its back onto the front line
//   breath (wing-arms) rears up on its hind legs, wings spread, and pours fire down
import type { DragonRig } from './rig';
import type { ChoreoEnv } from './choreo';
import {
  C_AIR,
  C_ANGER,
  C_ARCH,
  C_BUZZ,
  C_CHEST,
  C_CROUCH,
  C_DROOP,
  C_FACE,
  C_GLOW,
  C_HLEVEL,
  C_HPITCH,
  C_JAW,
  C_LOOK,
  C_LOOKX,
  C_LOOKY,
  C_NCURL,
  C_NRAISE,
  C_PITCH,
  C_PIVOT,
  C_RUN,
  C_SHIFT,
  C_SQUINT,
  C_SWAY,
  C_TCURL,
  C_THROAT,
  C_TIK,
  C_TIKX,
  C_TIKY,
  C_TRAISE,
  C_TSTIFF,
  C_TUCK,
  C_WFLAP,
  C_WLIFT,
  C_WSPREAD,
  C_X,
  C_Y,
  LEG_BN,
} from './rig';

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function sstep(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

function hump(x: number): number {
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x);
}

/** Wing beats per second: big wings beat slowly. */
function flapHz(rig: DragonRig, base: number): number {
  return base * Math.max(0.5, Math.sqrt(rig.tempo));
}

/** Tune the run cycle so the feet keep pace with a body moving `speed` u/s. */
function paceRun(rig: DragonRig, speed: number, stride: number, lo: number, hi: number): void {
  const reach = Math.max(1e-4, rig.legA[LEG_BN]! + rig.legB[LEG_BN]!);
  rig.runStride = stride;
  const hz = Math.abs(speed) / (Math.PI * 2 * stride * reach);
  rig.runHz = hz < lo ? lo : hz > hi ? hi : hz;
}

// ---------------------------------------------------------------------------------------------
// Entrances
// ---------------------------------------------------------------------------------------------

/**
 * The glide-in: from the upper right on spread wings (a few big beats, then a held glide), the
 * flare (nose up, wings cupped, legs reaching), touchdown (the host kicks up dust and snow on the
 * C_AIR drop), the wings fold onto their wrists. A boss lands sooner and rears up with a roar.
 */
export function enterGlide(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  rig.carry = true;
  const ind = rig.ind;
  const k = e.k;
  const grand = ind.grand;
  const tLand = grand > 0 ? 0.5 : 0.6;
  const u = clamp01(k / tLand);
  // Decelerating along x (the flare brakes), descending in a swoop that levels out.
  const ex = 1 - Math.pow(1 - u, 2.1);
  const ey = 1 - Math.pow(1 - u, 1.25);
  tg[C_X] = e.enterDist * (1 - ex);
  tg[C_Y] += -e.enterH * (1 - ey);
  const air = k < tLand;
  tg[C_AIR] = air ? 1 : 0;
  const flare = sstep(0.62, 0.95, u) * (air ? 1 : 0);
  // Wings: beats coming in, a held glide, cupped for the flare; after touchdown they fold down.
  const fold = sstep(tLand + 0.04, tLand + 0.2, k);
  tg[C_WSPREAD] = 1 - fold;
  const beats = 1 - sstep(0.18, 0.36, u);
  tg[C_WFLAP] = air ? 0.75 * beats + 0.06 + 0.3 * flare : 0;
  rig.flapHz = flapHz(rig, 2.3);
  // Held out and swept back in the glide; forward and up in the flare.
  tg[C_WLIFT] = air ? 0.38 * (1 - beats) * (1 - flare) - 0.55 * flare : 0.25 * (1 - fold);
  tg[C_TUCK] = air ? 1 - 2 * sstep(0.5, 0.8, u) : 0;
  // Body: level and streamlined in the glide, nose up in the flare, a squash on touchdown.
  tg[C_PIVOT] = 0.85;
  tg[C_PITCH] = air ? -0.08 * (1 - flare) + 0.42 * flare : 0;
  tg[C_NRAISE] = ind.neckRaise - 0.35 * (1 - flare) * (air ? 1 : 0);
  tg[C_NCURL] = ind.neckCurl - 0.2 * (air ? 1 : 0);
  tg[C_HLEVEL] = air ? 0.9 : 0.65;
  const squash = hump((k - tLand) / 0.22);
  tg[C_CROUCH] = 0.5 * squash;
  tg[C_HPITCH] += -0.1 * squash;
  // In the air the tail streams straight out behind (stiff enough to keep up with the swoop);
  // it swings down and relaxes once it lands.
  const aft = air ? 1 : 1 - sstep(tLand, tLand + 0.25, k);
  tg[C_TRAISE] = ind.tailDroop - 0.12 * aft;
  tg[C_TCURL] = ind.tailCurl * (1 - 0.75 * aft);
  tg[C_TSTIFF] = (0.9 + 1.6 * aft) / Math.max(0.35, rig.tempo);
  tg[C_SWAY] *= air ? 0.4 : 1;
  tg[C_LOOK] = 0.7;
  // A boss rears up and roars once it has landed, wings wide.
  if (grand > 0) {
    const roar = sstep(tLand + 0.14, tLand + 0.24, k) * (1 - sstep(0.86, 0.98, k));
    tg[C_WSPREAD] = Math.max(tg[C_WSPREAD]!, roar);
    tg[C_WLIFT] = tg[C_WLIFT]! - 0.3 * roar;
    tg[C_WFLAP] = Math.max(tg[C_WFLAP]!, 0.1 * roar);
    tg[C_PIVOT] = 0.95;
    tg[C_PITCH] = tg[C_PITCH]! + 0.3 * roar;
    tg[C_JAW] = Math.max(tg[C_JAW]!, roar);
    tg[C_NRAISE] = tg[C_NRAISE]! + 0.3 * roar;
    tg[C_HPITCH] = tg[C_HPITCH]! + 0.45 * roar;
    tg[C_ANGER] = roar;
    tg[C_LOOK] = 0.7 * (1 - roar);
  }
}

/**
 * Walks in: the run cycle at a slow, heavy pace (the host shakes the ground on each footfall),
 * head low; arrived by ~70%, then a deep bellow, head raised.
 */
export function enterWalk(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  rig.carry = true;
  const ind = rig.ind;
  const k = e.k;
  const arrive = 0.68;
  const u = clamp01(k / arrive);
  const p = 1 - Math.pow(1 - u, 1.5);
  tg[C_X] = e.enterDist * (1 - p);
  const speed = u < 1 ? (e.enterDist * 1.5 * Math.pow(1 - u, 0.5)) / Math.max(0.1, arrive * e.dur) : 0;
  paceRun(rig, speed, 0.5, 0.7, 3);
  tg[C_RUN] = 1 - sstep(0.8, 1, u);
  // Heavy: a low stance, a bob on every step, the head swinging low.
  tg[C_CROUCH] = 0.15 * (1 - u);
  tg[C_Y] += -0.006 * Math.abs(Math.sin(rig.runPhase)) * tg[C_RUN]!;
  tg[C_NRAISE] = ind.neckRaise - 0.22 * (1 - u);
  tg[C_HPITCH] += -0.12 * (1 - u) + 0.05 * Math.sin(rig.runPhase) * (1 - u);
  tg[C_TRAISE] = ind.tailDroop + 0.08;
  tg[C_LOOK] = 0.55;
  // The bellow.
  const bellow = sstep(0.72, 0.8, k) * (1 - sstep(0.93, 1, k));
  tg[C_JAW] = Math.max(tg[C_JAW]!, 0.85 * bellow);
  tg[C_NRAISE] = tg[C_NRAISE]! + 0.28 * bellow;
  tg[C_HPITCH] = tg[C_HPITCH]! + 0.4 * bellow;
  tg[C_CHEST] = tg[C_CHEST]! + 0.4 * bellow;
  tg[C_ANGER] = bellow;
  tg[C_SQUINT] = Math.max(tg[C_SQUINT]!, 0.4 * bellow);
}

// ---------------------------------------------------------------------------------------------
// Exits (the 'leave' phase): the dragon ends off stage right; the host fades it out at the end
// ---------------------------------------------------------------------------------------------

/** Takes off: turns, crouches, springs up on a great downstroke and climbs away to the upper right. */
export function leaveFly(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  rig.carry = true;
  const ind = rig.ind;
  const k = e.k;
  const grand = ind.grand;
  const turn = sstep(0, grand > 0 ? 0.2 : 0.14, k);
  tg[C_FACE] = Math.cos(Math.PI * turn);
  const tUp = grand > 0 ? 0.36 : 0.28;
  const crouch = hump((k - 0.06) / (tUp - 0.02));
  tg[C_CROUCH] = 0.45 * crouch;
  tg[C_WSPREAD] = sstep(0.1, tUp - 0.04, k);
  tg[C_WLIFT] = -0.35 * sstep(0.1, tUp, k) * (1 - sstep(tUp, tUp + 0.1, k));
  const air = k > tUp;
  tg[C_AIR] = air ? 1 : 0;
  const u = clamp01((k - tUp) / (1 - tUp));
  tg[C_Y] += -e.exitH * Math.pow(u, 1.45);
  tg[C_X] = -e.exitDist * Math.pow(u, 1.7);
  tg[C_WFLAP] = air ? 0.85 : 0;
  rig.flapHz = flapHz(rig, 2.5);
  tg[C_TUCK] = air ? sstep(0, 0.25, u) : 0;
  tg[C_PIVOT] = 0.85;
  tg[C_PITCH] = 0.32 * sstep(tUp - 0.06, tUp + 0.08, k) * (1 - 0.4 * u);
  tg[C_NRAISE] = ind.neckRaise + 0.1 - 0.3 * u;
  tg[C_HLEVEL] = 0.85;
  tg[C_TRAISE] = ind.tailDroop - 0.1 * u;
  tg[C_TCURL] = ind.tailCurl * (1 - 0.75 * sstep(tUp - 0.05, tUp + 0.1, k));
  tg[C_TSTIFF] = (1.1 + 1.4 * sstep(tUp - 0.05, tUp + 0.1, k)) / Math.max(0.35, rig.tempo);
  tg[C_LOOK] = 0;
  // A boss roars at the army before it goes.
  if (grand > 0) {
    const roar = sstep(0.05, 0.12, k) * (1 - sstep(0.26, 0.34, k));
    tg[C_JAW] = Math.max(tg[C_JAW]!, roar);
    tg[C_HPITCH] = tg[C_HPITCH]! + 0.4 * roar;
    tg[C_NRAISE] = tg[C_NRAISE]! + 0.25 * roar;
    tg[C_ANGER] = roar;
  }
}

/** Scurries off: a quick turn, then legs a-blur (the run cycle), belly low, wings buzzing. */
export function leaveScuttle(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  rig.carry = true;
  const ind = rig.ind;
  const k = e.k;
  tg[C_FACE] = Math.cos(Math.PI * sstep(0, 0.12, k));
  const go = sstep(0.08, 0.2, k);
  const p = sstep(0.1, 1, k);
  tg[C_X] = -e.exitDist * Math.pow(p, 1.25);
  const speed = (e.exitDist * 1.8) / Math.max(0.1, e.dur);
  paceRun(rig, speed, 0.5, 3, 11);
  tg[C_RUN] = go;
  tg[C_Y] += -0.018 * Math.abs(Math.sin(rig.runPhase)) * go;
  tg[C_CROUCH] = 0.25 * go;
  tg[C_NRAISE] = ind.neckRaise - 0.15 * go;
  tg[C_BUZZ] = go;
  tg[C_WSPREAD] = 0.9 * go;
  tg[C_SWAY] *= 1 + 1.5 * go;
  rig.swayHz *= 1 + 2 * go;
  tg[C_LOOK] = 0;
}

/** Walks off with dignity: a slow turn, a heavy walk, head held high. */
export function leaveWalk(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  rig.carry = true;
  const ind = rig.ind;
  const k = e.k;
  tg[C_FACE] = Math.cos(Math.PI * sstep(0, 0.26, k));
  const go = sstep(0.18, 0.3, k);
  const p = sstep(0.2, 1, k);
  tg[C_X] = -e.exitDist * p;
  const speed = (e.exitDist * 1.5) / Math.max(0.1, 0.8 * e.dur);
  paceRun(rig, speed, 0.5, 0.7, 3);
  tg[C_RUN] = go;
  tg[C_Y] += -0.006 * Math.abs(Math.sin(rig.runPhase)) * go;
  tg[C_NRAISE] = ind.neckRaise + 0.12 * go;
  tg[C_HPITCH] += 0.08 * go;
  tg[C_TRAISE] = ind.tailDroop + 0.06;
  tg[C_LOOK] = 0;
}

// ---------------------------------------------------------------------------------------------
// Attacks with wing-arms: the rear-up breath and the tail slam
// ---------------------------------------------------------------------------------------------

/** Breath windup, reared: up on its hind legs, wings spread in display, neck drawn back, throat aglow. */
export function windupRear(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  const ind = rig.ind;
  const k = e.k;
  const a = sstep(0, 0.35, k);
  const fl = 0.85 + 0.15 * Math.sin(e.time * 31) * Math.sin(e.time * 17);
  tg[C_PIVOT] = 0.95;
  tg[C_PITCH] = 0.42 * a;
  tg[C_WSPREAD] = a;
  tg[C_WLIFT] = -0.28 * a;
  tg[C_WFLAP] = 0.1 * a;
  rig.flapHz = flapHz(rig, 3.2);
  tg[C_NRAISE] = ind.neckRaise + 0.2 * a;
  tg[C_NCURL] = ind.neckCurl + 0.45 * a;
  tg[C_HLEVEL] = 0.5;
  tg[C_HPITCH] = ind.headTilt + 0.18 * a;
  tg[C_JAW] = Math.max(tg[C_JAW]!, (0.1 + 0.06 * Math.sin(e.time * 23)) * a);
  tg[C_CHEST] = 1.05 * sstep(0.05, 0.9, k);
  tg[C_THROAT] = sstep(0.1, 0.85, k);
  tg[C_GLOW] = sstep(0.05, 0.8, k) * fl;
  tg[C_ANGER] = a;
  tg[C_SQUINT] = Math.max(tg[C_SQUINT]!, 0.3 * a);
  tg[C_TRAISE] = ind.tailDroop - 0.25 * a;
  tg[C_SWAY] *= 0.4;
  tg[C_LOOK] = 0.25;
  tg[C_ARCH] = ind.arch + 0.05 * a;
}

/** Breath, reared: still up on its hind legs, wings wide and beating slowly, pouring fire down on the army. */
export function breathRear(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  const ind = rig.ind;
  const k = e.k;
  const a = sstep(0, 0.1, k);
  const r = sstep(0.8, 1, k);
  const on = a * (1 - r);
  tg[C_PIVOT] = 0.95;
  tg[C_PITCH] = 0.42 * (1 - a) + 0.28 * on;
  tg[C_WSPREAD] = 1 - r;
  tg[C_WLIFT] = -0.22 * on;
  tg[C_WFLAP] = 0.2 * on;
  rig.flapHz = flapHz(rig, 1.8);
  tg[C_NRAISE] = ind.neckRaise + 0.1 * on;
  tg[C_NCURL] = ind.neckCurl - 0.3 * on;
  tg[C_HLEVEL] = 0.2;
  tg[C_LOOKX] = e.aimX;
  tg[C_LOOKY] = e.aimY;
  tg[C_LOOK] = 0.95 * on;
  tg[C_HPITCH] = ind.headTilt - 0.05 * on + 0.07 * Math.sin(k * Math.PI * 2.2) * on;
  tg[C_JAW] = Math.max(tg[C_JAW]!, on);
  tg[C_CHEST] = 1.05 * (1 - sstep(0, 0.9, k));
  tg[C_THROAT] = 1 - sstep(0, 0.7, k);
  tg[C_GLOW] = 1 - sstep(0.04, 0.5, k);
  tg[C_ANGER] = 1 - r;
  tg[C_SQUINT] = Math.max(tg[C_SQUINT]!, 0.5 * on);
  tg[C_TRAISE] = ind.tailDroop - 0.2 * on;
  tg[C_SWAY] *= 0.5;
}

/** Swipe windup, slam: low at the shoulders, the tail coiled high over the back, the club quivering. */
export function windupSlam(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  const ind = rig.ind;
  const k = e.k;
  const a = sstep(0, 0.4, k);
  tg[C_PIVOT] = 0.2;
  tg[C_PITCH] = -0.1 * a;
  tg[C_CROUCH] = 0.25 * a;
  tg[C_NRAISE] = ind.neckRaise - 0.25 * a;
  tg[C_HPITCH] = ind.headTilt - 0.05 * a;
  tg[C_HLEVEL] = 0.8;
  tg[C_TRAISE] = ind.tailDroop - 1.6 * a;
  tg[C_TCURL] = ind.tailCurl - 1.7 * a;
  tg[C_SWAY] = 0.08 + 0.08 * a;
  rig.swayHz = 3 + 5 * k;
  tg[C_TSTIFF] = 1 + 0.7 * a;
  tg[C_ANGER] = a;
  tg[C_SQUINT] = Math.max(tg[C_SQUINT]!, 0.45 * a);
  tg[C_WSPREAD] = 0;
  tg[C_LOOK] = 0.9;
}

/**
 * The slam: a wing-assisted hop toward the army (C_SHIFT, e.lunge), the coiled tail whips over the
 * back and smashes its club down on the front line (tail IK onto e.slamX on the ground, ~0.25-0.3
 * of the phase), a heavy beat, then it drags the tail back and hops home.
 */
export function swipeSlam(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  const ind = rig.ind;
  const k = e.k;
  tg[C_SHIFT] = -e.lunge * sstep(0, 0.16, k) * (1 - sstep(0.66, 0.92, k));
  const hopIn = k < 0.16 ? Math.sin((Math.PI * k) / 0.16) : 0;
  const hopHome = k > 0.66 && k < 0.9 ? Math.sin((Math.PI * (k - 0.66)) / 0.24) : 0;
  tg[C_AIR] = (k > 0.02 && k < 0.14) || (k > 0.68 && k < 0.88) ? 1 : 0;
  tg[C_Y] += -0.07 * hopIn - 0.05 * hopHome;
  // The wing-arms flick open for the hops.
  tg[C_WSPREAD] = 0.7 * Math.max(hopIn, hopHome);
  tg[C_WLIFT] = -0.2;
  // The whip over the top (the root swings forward, the tip stays pointed down at the front
  // line), then the strike onto the target, then the drag back.
  const whip = sstep(0.04, 0.2, k);
  const strike = sstep(0.13, 0.23, k) * (1 - sstep(0.46, 0.64, k));
  const relax = sstep(0.5, 0.8, k);
  const held = 1 - relax;
  tg[C_TRAISE] = ind.tailDroop - (1.6 + 0.75 * whip) * held;
  tg[C_TCURL] = ind.tailCurl - (1.7 - 0.25 * whip) * held;
  // The swipe lasts the same 0.9 s at every size, so the tail's springs keep pace with it
  // (tempo slows big dragons' springs everywhere else).
  tg[C_TSTIFF] = (1.8 + 2.6 * Math.max(whip, strike)) / Math.max(0.35, rig.tempo);
  tg[C_SWAY] = 0.04;
  tg[C_TIK] = strike;
  tg[C_TIKX] = e.slamX - rig.ch[C_SHIFT]!;
  tg[C_TIKY] = rig.groundY - rig.tailLen * 0.02;
  // Rear kicked up, head ducked low and forward out of the tail's way.
  tg[C_PIVOT] = 0.15;
  tg[C_PITCH] = -0.3 * strike;
  tg[C_CROUCH] = 0.2 * strike;
  tg[C_NRAISE] = ind.neckRaise - 0.45 * strike;
  tg[C_HPITCH] = ind.headTilt - 0.15 * strike;
  tg[C_HLEVEL] = 0.75;
  tg[C_LOOK] = 0;
  tg[C_SQUINT] = Math.max(tg[C_SQUINT]!, 0.6 * strike);
  tg[C_JAW] = Math.max(tg[C_JAW]!, 0.35 * strike);
  tg[C_ANGER] = 1 - relax;
}

/** Stagger with wing-arms: the wings sag half open and droop. */
export function staggerWings(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  const w = 1 - sstep(0.72, 1, e.k);
  tg[C_WSPREAD] = 0.62 * w;
  tg[C_WLIFT] = -0.25 * w;
  tg[C_CROUCH] = 0.25 * w;
}

/**
 * Death with wing-arms: a last roar reared up with the wings flung wide, then the collapse, the
 * wings crumpling half open as it falls; the burn eats it from the tail to the head. A boss roars
 * longer and falls slower.
 */
export function dyingWinged(rig: DragonRig, e: ChoreoEnv): void {
  const tg = rig.target;
  const ind = rig.ind;
  const k = e.k;
  const g = ind.grand;
  const roar = sstep(0, 0.1, k) * (1 - sstep(0.28 + 0.1 * g, 0.42 + 0.1 * g, k));
  const fold = sstep(0.24 + 0.1 * g, 0.62 + 0.08 * g, k);
  tg[C_JAW] = Math.max(roar, 0.3 * fold);
  tg[C_NRAISE] = ind.neckRaise + 0.45 * roar - 0.8 * fold;
  tg[C_NCURL] = ind.neckCurl + 0.2 * roar;
  tg[C_HPITCH] = ind.headTilt + 0.55 * roar - 0.35 * fold;
  tg[C_HLEVEL] = 0.3;
  tg[C_PIVOT] = 0.95;
  tg[C_PITCH] = 0.36 * roar - 0.04 * fold;
  tg[C_X] = 0.007 * Math.sin(e.t * 71) * roar;
  tg[C_CROUCH] = 1.1 * fold;
  tg[C_Y] = 0.03 * fold;
  tg[C_WSPREAD] = Math.max(roar, 0.62 * fold);
  tg[C_WLIFT] = -0.5 * roar + 0.15 * fold;
  tg[C_WFLAP] = 0.15 * roar;
  rig.flapHz = flapHz(rig, 3);
  tg[C_DROOP] = fold;
  tg[C_SQUINT] = Math.min(1, 0.55 * roar + fold);
  tg[C_TRAISE] = ind.tailDroop - 0.45 * roar + 0.3 * fold;
  tg[C_SWAY] = 0;
  tg[C_LOOK] = 0;
  tg[C_ANGER] = roar;
  tg[C_TSTIFF] = 0.7;
  rig.dissolve = 1 - sstep(0.4 + 0.06 * g, 0.97, k);
}

/** Idle act 'stretch': the wings spread wide, a couple of slow beats, then fold away. u = 0..1. */
export function stretchWings(rig: DragonRig, u: number): void {
  const tg = rig.target;
  const open = sstep(0, 0.22, u) * (1 - sstep(0.8, 1, u));
  tg[C_WSPREAD] = open;
  tg[C_WLIFT] = -0.3 * open;
  tg[C_WFLAP] = 0.35 * open * sstep(0.28, 0.4, u) * (1 - sstep(0.66, 0.78, u));
  rig.flapHz = flapHz(rig, 1.5);
  tg[C_PIVOT] = 0.95;
  tg[C_PITCH] = 0.12 * open;
  tg[C_NRAISE] += 0.15 * open;
  tg[C_HPITCH] += 0.18 * open;
  tg[C_LOOK] *= 1 - 0.6 * open;
}
