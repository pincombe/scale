// The dragon's acting: maps (phase, progress, clock) to pose-channel targets on the rig.
// Pure (no DOM); randomness comes from a seeded Rng so a dragon's idle life is repeatable.
//
// Every frame starts from the rest pose, layers the always-on life (breathing, tail sway, blinks,
// looking around), then the phase's choreography. The rig smooths every channel, so phase
// changes and interruptions (death mid-swipe) never pop. Species and bosses pick their entrance,
// exit, breath and swipe styles (Individual.enter/leave/breath/swipe); the styles beyond the
// newt's own live in ./moves.ts.
import type { DragonAttack, DragonPhase } from '../../core';
import { Rng } from '../../lib/rng';
import type { BehaviorTuning } from './species';
import {
  breathRear,
  dyingWinged,
  enterGlide,
  enterWalk,
  leaveFly,
  leaveScuttle,
  leaveWalk,
  staggerWings,
  stretchWings,
  swipeSlam,
  windupRear,
  windupSlam,
} from './moves';
import {
  C_AIR,
  C_ANGER,
  C_ARCH,
  C_BUZZ,
  C_CHEST,
  C_CROUCH,
  C_DIZZY,
  C_DROOP,
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
  C_FACE,
  C_SHIFT,
  C_SQUINT,
  C_SWAY,
  C_TCURL,
  C_THROAT,
  C_TONGUE,
  C_TRAISE,
  C_TSTIFF,
  C_WFLAP,
  C_WLIFT,
  C_WSPREAD,
  C_X,
  C_Y,
  MAX_HEADS,
  type DragonRig,
} from './rig';

export interface ChoreoEnv {
  phase: DragonPhase;
  attack: DragonAttack;
  /** Phase progress 0..1 and seconds into the phase (interpolated with view.alpha). */
  k: number;
  t: number;
  /** Scaled frame dt and clock. */
  dt: number;
  time: number;
  /** Where to look (u) and how compelling it is (cursor = 1, army = 0.6). */
  lookX: number;
  lookY: number;
  lookPull: number;
  /** Enter: distance to travel (u). Swipe: lunge toward the army (u). Breath: fire aim point (u). */
  enterDist: number;
  lunge: number;
  aimX: number;
  aimY: number;
  /** Phase duration (s). */
  dur: number;
  /** Glide-in: start height above the ground (u). */
  enterH: number;
  /** Leave: distance to off stage right (u) and, for fliers, the climb (u). */
  exitDist: number;
  exitH: number;
  /** Tail slam: where the club lands (rig x, u, before the lunge shift). */
  slamX: number;
}

type ActKey = keyof BehaviorTuning['acts'];
type Act = 'rest' | ActKey;
const ACTS: readonly ActKey[] = ['look', 'sniff', 'buzz', 'yawn', 'wag', 'stretch'];

function sstep(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

function hump(x: number): number {
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x);
}

export class Choreo {
  private readonly rng = new Rng(1);
  private breathPh = 0;
  private act: Act = 'rest';
  private actT = 0;
  private actDur = 1.5;
  /** Blink timers per head: time to next blink, blink clock (-1 = eyes open). */
  private readonly blinkIn = new Float64Array(MAX_HEADS);
  private readonly blinkT = new Float64Array(MAX_HEADS);
  private readonly blinkTwice = new Uint8Array(MAX_HEADS);
  /** Squint impulse from hits (decays). */
  private hurt = 0;
  /** Yelp: the jaw pops open on a crit. */
  private yelp = 0;
  /** Saccade: small random look offsets. */
  private sacX = 0;
  private sacY = 0;
  private sacIn = 0;
  /** One-shot flags the host reads (nostril puff, tongue flick). */
  puff = false;
  private puffIn = 3;
  private tongueFlick = 0;

  reset(seed: number): void {
    this.rng.reseed(seed ^ 0xc0e0);
    this.breathPh = this.rng.float() * 6.28;
    this.act = 'rest';
    this.actT = 0;
    this.actDur = 0.8 + this.rng.float();
    for (let h = 0; h < MAX_HEADS; h++) {
      this.blinkIn[h] = 0.5 + this.rng.float() * 2;
      this.blinkT[h] = -1;
      this.blinkTwice[h] = 0;
    }
    this.hurt = 0;
    this.yelp = 0;
    this.puffIn = 1 + this.rng.float() * 3;
    this.tongueFlick = 0;
  }

  /** A hit landed: squint, and a crit makes it yelp. */
  hit(crit: boolean): void {
    this.hurt = Math.max(this.hurt, crit ? 1 : 0.6);
    if (crit) this.yelp = 1;
  }

  /** Write channel targets for this frame. */
  apply(rig: DragonRig, e: ChoreoEnv): void {
    const tg = rig.target;
    const ind = rig.ind;
    const beh = ind.species.behavior;
    rig.restChannels(tg);
    rig.carry = false;
    const dt = e.dt;
    const tempo = rig.tempo;

    // ---- always-on life ----
    this.breathPh += dt * beh.breathHz * Math.PI * 2 * tempo * 1.3;
    if (this.breathPh > 1e4) this.breathPh -= 6283.185307179586;
    const br = Math.sin(this.breathPh);
    const deep = 1 + 0.6 * ind.grand;
    tg[C_CHEST] = 0.1 * br * deep;
    tg[C_Y] = -0.005 * br * deep;
    tg[C_NRAISE] += 0.035 * Math.sin(this.breathPh - 0.6);
    tg[C_HPITCH] += 0.025 * Math.sin(this.breathPh - 1);
    tg[C_SWAY] = beh.swayAmp;
    rig.swayHz = beh.swayHz;
    rig.flapHz = 4;
    rig.buzzHz = 23;

    // Looking: saccades around the target of interest.
    this.sacIn -= dt;
    if (this.sacIn <= 0) {
      this.sacIn = 0.4 + this.rng.float() * 1.6;
      this.sacX = (this.rng.float() - 0.5) * 0.4;
      this.sacY = (this.rng.float() - 0.5) * 0.2;
    }
    tg[C_LOOKX] = e.lookX + this.sacX;
    tg[C_LOOKY] = e.lookY + this.sacY;
    // The eyes always track; the head only leans toward it (more when it's the cursor).
    tg[C_LOOK] = 0.12 + 0.2 * e.lookPull;

    // Hurt squint and yelp decay.
    this.hurt = Math.max(0, this.hurt - dt * 4);
    this.yelp = Math.max(0, this.yelp - dt * 5);
    tg[C_SQUINT] = this.hurt * 0.8;
    tg[C_JAW] = this.yelp * 0.55;

    switch (e.phase) {
      case 'idle':
        this.idle(rig, e);
        break;
      case 'enter':
        if (ind.enter === 'glide') enterGlide(rig, e);
        else if (ind.enter === 'walk') enterWalk(rig, e);
        else this.enter(rig, e);
        break;
      case 'windup':
        if (e.attack === 'breath') {
          if (ind.breath === 'rear') windupRear(rig, e);
          else this.windupBreath(rig, e);
        } else if (ind.swipe === 'slam') windupSlam(rig, e);
        else this.windupSwipe(rig, e);
        break;
      case 'breath':
        if (ind.breath === 'rear') breathRear(rig, e);
        else this.breath(rig, e);
        break;
      case 'swipe':
        if (ind.swipe === 'slam') swipeSlam(rig, e);
        else this.swipe(rig, e);
        break;
      case 'stagger':
        this.stagger(rig, e);
        if (rig.armWing) staggerWings(rig, e);
        break;
      case 'dying':
        if (rig.armWing) dyingWinged(rig, e);
        else this.dying(rig, e);
        break;
      case 'leave':
        if (ind.leave === 'fly') leaveFly(rig, e);
        else if (ind.leave === 'walk') leaveWalk(rig, e);
        else leaveScuttle(rig, e);
        break;
    }

    // Nostril puffs at rest; faster and darker when a breath is building.
    this.puff = false;
    if (e.phase === 'idle' || e.phase === 'windup') {
      this.puffIn -= dt * (e.phase === 'windup' && e.attack === 'breath' ? 5 : 1);
      if (this.puffIn <= 0) {
        this.puff = true;
        this.puffIn = (1.5 + this.rng.float() * 2.6) * (1 + rig.ind.maturity * 0.6);
      }
    }
  }

  /** After rig.update: per-head jaw and eyelids from the smoothed channels + blinks. */
  post(rig: DragonRig, e: ChoreoEnv): void {
    const dt = e.dt;
    const beh = rig.ind.species.behavior;
    const jaw = rig.ch[C_JAW]!;
    const squint = rig.ch[C_SQUINT]!;
    for (let h = 0; h < rig.heads; h++) {
      // Extra heads chatter out of sync.
      const off = h === 0 ? 0 : 0.12 * Math.max(0, Math.sin(e.time * (3.1 + h) + h * 2));
      rig.jaw[h] = Math.min(1, Math.max(0, jaw + off));
      // Blink: close 0.06 s, open 0.08 s.
      let lid = 0;
      if (this.blinkT[h]! >= 0) {
        const t = this.blinkT[h]! + dt;
        this.blinkT[h] = t;
        if (t < 0.06) lid = t / 0.06;
        else if (t < 0.14) lid = 1 - (t - 0.06) / 0.08;
        else {
          this.blinkT[h] = -1;
          if (this.blinkTwice[h]) {
            this.blinkTwice[h] = 0;
            this.blinkIn[h] = 0.12;
          }
        }
      } else {
        this.blinkIn[h] = this.blinkIn[h]! - dt;
        if (this.blinkIn[h]! <= 0) {
          this.blinkT[h] = 0;
          this.blinkIn[h] = beh.blinkMin + this.rng.float() * (beh.blinkMax - beh.blinkMin);
          this.blinkTwice[h] = this.rng.float() < 0.2 ? 1 : 0;
        }
      }
      rig.lid[h] = Math.max(lid, Math.min(1, squint));
    }
  }

  // ---------------------------------------------------------------------------------------------

  private chooseAct(rig: DragonRig): void {
    const acts = rig.ind.species.behavior.acts;
    const m = rig.ind.maturity;
    if (this.act !== 'rest' && this.rng.float() < 0.35 + 0.3 * m) {
      this.act = 'rest';
      this.actT = 0;
      this.actDur = (0.35 + this.rng.float() * 0.8) * (1 + m);
      return;
    }
    let total = 0;
    for (let i = 0; i < ACTS.length; i++) total += acts[ACTS[i]!];
    let r = this.rng.float() * total;
    let pick: ActKey = 'look';
    for (let i = 0; i < ACTS.length; i++) {
      const a = ACTS[i]!;
      r -= acts[a];
      if (r <= 0) {
        pick = a;
        break;
      }
    }
    // Never yawn twice in a row.
    if (pick === this.act) pick = 'look';
    this.act = pick;
    this.actT = 0;
    switch (pick) {
      case 'look':
        this.actDur = 1.8 + this.rng.float() * 1.8;
        break;
      case 'sniff':
        this.actDur = 2 + this.rng.float() * 0.9;
        break;
      case 'buzz':
        this.actDur = 0.7 + this.rng.float() * 0.5;
        break;
      case 'yawn':
        this.actDur = 1.8;
        break;
      case 'wag':
        this.actDur = 1.2 + this.rng.float() * 0.8;
        break;
      case 'stretch':
        this.actDur = 2.2 + this.rng.float() * 0.6;
        break;
      default:
        this.actDur = 1;
    }
  }

  private idle(rig: DragonRig, e: ChoreoEnv): void {
    const tg = rig.target;
    const dt = e.dt;
    this.actT += dt * rig.tempo;
    if (this.actT >= this.actDur) this.chooseAct(rig);
    const u = this.actDur > 0 ? Math.min(1, this.actT / this.actDur) : 1;
    this.tongueFlick = Math.max(0, this.tongueFlick - dt * 6);
    switch (this.act) {
      case 'look': {
        tg[C_LOOK] = 0.75;
        // A curious head tilt partway through.
        tg[C_HPITCH] += 0.1 * hump(Math.min(1, u * 1.6));
        break;
      }
      case 'sniff': {
        const down = sstep(0, 0.2, u) * (1 - sstep(0.82, 1, u));
        tg[C_NRAISE] -= 0.5 * down;
        tg[C_NCURL] += 0.12 * down;
        tg[C_HPITCH] -= 0.4 * down;
        tg[C_HLEVEL] = 0.65 - 0.25 * down;
        tg[C_LOOK] *= 1 - down;
        // Quick sniffs in two bursts.
        const burst = (u > 0.25 && u < 0.45) || (u > 0.55 && u < 0.75) ? 1 : 0;
        tg[C_HPITCH] += 0.07 * burst * Math.max(0, Math.sin(this.actT * 38));
        tg[C_CHEST] += 0.05 * burst;
        if (u > 0.46 && u < 0.5) this.tongueFlick = 1;
        if (u > 0.78 && u < 0.8) this.puffIn = Math.min(this.puffIn, 0.01);
        break;
      }
      case 'buzz': {
        tg[C_BUZZ] = 1;
        tg[C_WSPREAD] = 0.9;
        tg[C_WLIFT] = -0.35;
        // A hopeful little hop that goes nowhere.
        tg[C_Y] -= 0.035 * hump(u) * rig.ind.buzz * Math.max(0, 1 - rig.ind.maturity * 1.6);
        tg[C_HPITCH] += 0.12 * hump(u);
        tg[C_SWAY] *= 1.6;
        break;
      }
      case 'yawn': {
        const open = sstep(0, 0.45, u) * (1 - sstep(0.72, 0.8, u));
        tg[C_JAW] = Math.max(tg[C_JAW]!, open);
        tg[C_HPITCH] += 0.4 * open;
        tg[C_NRAISE] += 0.12 * open;
        tg[C_SQUINT] = Math.max(tg[C_SQUINT]!, 0.95 * sstep(0.15, 0.35, u) * (1 - sstep(0.8, 0.9, u)));
        tg[C_CHEST] += 0.25 * open;
        tg[C_LOOK] = 0;
        // Head shake after the snap.
        if (u > 0.8) tg[C_HPITCH] += 0.06 * Math.sin(this.actT * 40) * (1 - u) * 5;
        break;
      }
      case 'wag': {
        tg[C_SWAY] *= 2.3;
        rig.swayHz *= 2.4;
        tg[C_TRAISE] -= 0.15;
        tg[C_HPITCH] += 0.05;
        break;
      }
      case 'stretch':
        stretchWings(rig, u);
        break;
      default:
        break;
    }
    // Occasional tongue flick while looking at the army.
    if (this.act === 'look' && u > 0.6 && u < 0.62) this.tongueFlick = 1;
    tg[C_TONGUE] = this.tongueFlick > 0 ? 0.4 + 0.6 * hump(1 - this.tongueFlick) : 0;
  }

  private enter(rig: DragonRig, e: ChoreoEnv): void {
    const tg = rig.target;
    const k = e.k;
    const fly = k < 0.7;
    const land = sstep(0.55, 0.72, k);
    const travel = Math.min(1, k / 0.78);
    const eased = 1 - (1 - travel) * (1 - travel) * (1 - travel);
    tg[C_X] = e.enterDist * (1 - eased);
    tg[C_Y] += -0.16 * (1 - land) + (fly ? 0.018 * Math.sin(e.time * 34) : 0);
    tg[C_AIR] = fly ? 1 : 0;
    tg[C_BUZZ] = k < 0.74 ? 1 : 0;
    tg[C_WSPREAD] = k < 0.74 ? 1 : 0.25;
    tg[C_WLIFT] = k < 0.74 ? -0.45 : 0;
    tg[C_PITCH] = fly ? -0.1 : 0;
    // Touchdown squash, then a proud little settle.
    const squash = hump((k - 0.7) / 0.2);
    tg[C_CROUCH] = 0.8 * squash;
    tg[C_HPITCH] += -0.12 * squash + 0.1 * hump((k - 0.85) / 0.15);
    tg[C_SWAY] *= fly ? 2 : 1;
    tg[C_LOOK] = 0.7;
    tg[C_TSTIFF] = 0.8;
  }

  private windupBreath(rig: DragonRig, e: ChoreoEnv): void {
    const tg = rig.target;
    const ind = rig.ind;
    const k = e.k;
    const a = sstep(0, 0.35, k);
    const fl = 0.85 + 0.15 * Math.sin(e.time * 31) * Math.sin(e.time * 17);
    tg[C_PIVOT] = 0.95;
    tg[C_PITCH] = 0.26 * a;
    tg[C_X] = 0.035 * a;
    tg[C_Y] += -0.012 * a;
    tg[C_NRAISE] = ind.neckRaise + 0.38 * a;
    tg[C_NCURL] = ind.neckCurl + 0.3 * a;
    tg[C_HLEVEL] = 0.45;
    tg[C_HPITCH] = ind.headTilt + 0.2 * a;
    tg[C_JAW] = Math.max(tg[C_JAW]!, (0.1 + 0.06 * Math.sin(e.time * 23)) * a);
    tg[C_CHEST] = 1.05 * sstep(0.05, 0.9, k);
    tg[C_THROAT] = 1 * sstep(0.1, 0.85, k);
    tg[C_GLOW] = sstep(0.05, 0.8, k) * fl;
    tg[C_ANGER] = a;
    tg[C_SQUINT] = Math.max(tg[C_SQUINT]!, 0.3 * a);
    tg[C_WSPREAD] = a;
    tg[C_WLIFT] = -0.55 * a;
    tg[C_BUZZ] = 0.35 * sstep(0.4, 1, k) * ind.buzz;
    tg[C_TRAISE] = ind.tailDroop - 0.35 * a;
    tg[C_SWAY] *= 0.4;
    tg[C_LOOK] = 0.25;
    tg[C_ARCH] = ind.arch + 0.05 * a;
  }

  private windupSwipe(rig: DragonRig, e: ChoreoEnv): void {
    const tg = rig.target;
    const ind = rig.ind;
    const k = e.k;
    const a = sstep(0, 0.4, k);
    tg[C_CROUCH] = 0.75 * a;
    tg[C_PIVOT] = 0.15;
    tg[C_PITCH] = -0.1 * a;
    tg[C_NRAISE] = ind.neckRaise - 0.3 * a;
    tg[C_HPITCH] = ind.headTilt - 0.06 * a;
    tg[C_HLEVEL] = 0.8;
    // Load the tail: up and curled over the back like a scorpion, tip quivering.
    tg[C_TRAISE] = ind.tailDroop - 1.55 * a;
    tg[C_TCURL] = ind.tailCurl - 1.5 * a;
    tg[C_SWAY] = 0.1 + 0.1 * a;
    rig.swayHz = 3 + 5 * k;
    tg[C_TSTIFF] = 1 + 0.6 * a;
    // Butt wiggle, building up, like a cat about to pounce.
    const wig = sstep(0.35, 0.6, k);
    const f = 3 + 6 * k;
    tg[C_X] += 0.014 * Math.sin(e.t * f * Math.PI * 2) * wig;
    tg[C_Y] += 0.006 * Math.abs(Math.sin(e.t * f * Math.PI * 2)) * wig;
    tg[C_ANGER] = a;
    tg[C_SQUINT] = Math.max(tg[C_SQUINT]!, 0.45 * a);
    tg[C_WSPREAD] = 0;
    tg[C_WLIFT] = 0.25 * a;
    tg[C_LOOK] = 0.9;
  }

  private breath(rig: DragonRig, e: ChoreoEnv): void {
    const tg = rig.target;
    const ind = rig.ind;
    const k = e.k;
    const a = sstep(0, 0.1, k);
    const r = sstep(0.8, 1, k);
    const on = a * (1 - r);
    tg[C_PIVOT] = 0.95;
    tg[C_PITCH] = 0.26 * (1 - a) + 0.1 * on;
    tg[C_X] = 0.035 * (1 - a) - 0.015 * on + 0.004 * Math.sin(e.time * 57) * on;
    // Neck up and forward: the fire pours down from a raised head onto the front line.
    tg[C_NRAISE] = ind.neckRaise + 0.2 * on;
    tg[C_NCURL] = ind.neckCurl - 0.25 * on;
    tg[C_HLEVEL] = 0.2;
    // Aim at the ground in front of the army, sweeping a little across the front line.
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
    tg[C_WSPREAD] = 1 - r;
    tg[C_WLIFT] = -0.3 * on;
    tg[C_WFLAP] = 0.12 * on;
    rig.flapHz = 7;
    tg[C_TRAISE] = ind.tailDroop - 0.2 * on;
    tg[C_SWAY] *= 0.5;
  }

  /**
   * The swipe: it whips around (a quick mirror turn), hops in, and lashes its tail low along the
   * ground through the front ranks, then turns back and hops home. Everything below is in the rig's
   * own frame: while turned (C_FACE = -1) the tail, which points +x, sweeps toward the army.
   */
  private swipe(rig: DragonRig, e: ChoreoEnv): void {
    const tg = rig.target;
    const ind = rig.ind;
    const k = e.k;
    const turn = sstep(0, 0.1, k);
    const turnBack = sstep(0.6, 0.7, k);
    tg[C_FACE] = Math.cos(Math.PI * turn * (1 - turnBack));
    // World shift toward the army (a hop in, a hop home).
    tg[C_SHIFT] = -e.lunge * sstep(0, 0.14, k) * (1 - sstep(0.72, 0.94, k));
    const hopIn = k < 0.14 ? Math.sin((Math.PI * k) / 0.14) : 0;
    const hopHome = k > 0.72 && k < 0.94 ? Math.sin((Math.PI * (k - 0.72)) / 0.22) : 0;
    tg[C_AIR] = (k > 0.01 && k < 0.13) || (k > 0.73 && k < 0.93) ? 1 : 0;
    tg[C_Y] += -0.08 * hopIn - 0.06 * hopHome;
    // The lash: from the loaded scorpion arc down and out along the ground, whipping through.
    const lash = sstep(0.05, 0.19, k);
    const relax = sstep(0.4, 0.62, k);
    const on = lash * (1 - relax);
    tg[C_TRAISE] = ind.tailDroop - 1.55 * (1 - lash) + 0.35 * on;
    tg[C_TCURL] = ind.tailCurl - 1.5 * (1 - lash) + (0.25 - ind.tailCurl) * on;
    tg[C_TSTIFF] = 1.3 + 1.2 * on;
    tg[C_SWAY] = 0.05;
    // Lean into it: rear low, head high, looking back over its shoulder.
    tg[C_PIVOT] = 0.5;
    tg[C_PITCH] = 0.14 * on;
    tg[C_CROUCH] = 0.55 * (1 - turn) + 0.45 * on;
    tg[C_NRAISE] = ind.neckRaise + 0.25 * on;
    tg[C_HPITCH] = ind.headTilt + 0.15 * on;
    tg[C_HLEVEL] = 0.7;
    tg[C_LOOK] = 0;
    tg[C_SQUINT] = Math.max(tg[C_SQUINT]!, 0.6 * on);
    tg[C_JAW] = Math.max(tg[C_JAW]!, 0.3 * on);
    tg[C_ANGER] = 1 - relax;
    tg[C_WSPREAD] = 0.35 + 0.6 * on;
    tg[C_WLIFT] = -0.35 * on;
    tg[C_BUZZ] = tg[C_AIR]! > 0.5 ? 0.8 : 0;
  }

  private stagger(rig: DragonRig, e: ChoreoEnv): void {
    const tg = rig.target;
    const ind = rig.ind;
    const k = e.k;
    const t = e.t;
    const w = 1 - sstep(0.72, 1, k);
    tg[C_DIZZY] = w;
    tg[C_NRAISE] = ind.neckRaise - 0.38 * w;
    tg[C_HLEVEL] = 0.35;
    tg[C_HPITCH] = ind.headTilt - 0.22 * w + 0.2 * Math.sin(t * 6.5) * w;
    tg[C_X] = 0.016 * Math.sin(t * 5.3) * w;
    tg[C_PITCH] = 0.06 * Math.sin(t * 4.1 + 1) * w;
    tg[C_PIVOT] = 0.5;
    tg[C_JAW] = Math.max(tg[C_JAW]!, 0.4 * w);
    tg[C_TONGUE] = 0.9 * w;
    tg[C_DROOP] = 0.85 * w;
    tg[C_CROUCH] = 0.4 * w;
    tg[C_SWAY] = 0.08;
    tg[C_LOOK] = 0;
    tg[C_SQUINT] = 0;
    rig.swayHz = 0.6;
    // Shake it off at the end.
    const shake = hump((k - 0.74) / 0.22);
    tg[C_HPITCH] += 0.14 * Math.sin(t * 34) * shake;
  }

  private dying(rig: DragonRig, e: ChoreoEnv): void {
    const tg = rig.target;
    const ind = rig.ind;
    const k = e.k;
    const g = ind.grand;
    const roar = sstep(0, 0.1, k) * (1 - sstep(0.28 + 0.1 * g, 0.42 + 0.1 * g, k));
    const fold = sstep(0.24 + 0.1 * g, 0.62 + 0.08 * g, k);
    tg[C_JAW] = Math.max(roar, 0.3 * fold);
    tg[C_NRAISE] = ind.neckRaise + 0.45 * roar - 0.75 * fold;
    tg[C_NCURL] = ind.neckCurl + 0.2 * roar;
    tg[C_HPITCH] = ind.headTilt + 0.55 * roar - 0.35 * fold;
    tg[C_HLEVEL] = 0.3;
    tg[C_PITCH] = 0.22 * roar;
    tg[C_PIVOT] = 0.9;
    tg[C_X] = 0.007 * Math.sin(e.t * 71) * roar;
    tg[C_CROUCH] = 1.4 * fold;
    tg[C_Y] = 0.04 * fold;
    tg[C_WSPREAD] = roar;
    tg[C_WLIFT] = -0.6 * roar;
    tg[C_DROOP] = fold;
    tg[C_SQUINT] = Math.min(1, 0.55 * roar + fold);
    tg[C_TRAISE] = ind.tailDroop - 0.45 * roar + 0.3 * fold;
    tg[C_SWAY] = 0;
    tg[C_LOOK] = 0;
    tg[C_ANGER] = roar;
    tg[C_TSTIFF] = 0.7;
    rig.dissolve = 1 - sstep(0.4 + 0.06 * g, 0.97, k);
  }
}
