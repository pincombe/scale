// When the coach marks show (pure, unit-tested; ./coach.ts draws them). Two lessons, each taught
// once and remembered through saves via state.stats (no state of its own survives a reload):
//
//   weak     "strike the glow = ×5": COACH_WEAK_DELAY s after the session's first strike, while
//            stats.crits === 0 and a weak spot is live. The label fades after COACH_LABEL_MAX s on
//            screen (the ring stays: it's the core verb), comes back once on the next dragon, then
//            the ring carries on alone. The first crit ends it for good.
//   stagger  "hit the glow mid-windup": on a windup that starts once the weak lesson is learned
//            (crits >= 1, COACH_STAGGER_AFTER s since, kills >= COACH_STAGGER_KILLS), until the
//            first stagger, for at most COACH_STAGGER_MAX windups. Ring and label for the windup.
//
// Nothing shows before the first gesture (the title screen).
import type { DragonPhase } from '../../core/types';

/** Seconds after the first strike of the session before the weak-spot coach appears. */
export const COACH_WEAK_DELAY = 0.8;
/** Seconds the weak-spot label stays on screen before only the ring remains. */
export const COACH_LABEL_MAX = 10;
/** Seconds after the first crit before a windup teaches the stagger. */
export const COACH_STAGGER_AFTER = 4;
/** Tier kills needed before the stagger lesson (the player has seen a few windups by then). */
export const COACH_STAGGER_KILLS = 2;
/** Windups the stagger coach shows on before it gives up. */
export const COACH_STAGGER_MAX = 3;

export const COACH_NONE = 0;
export const COACH_WEAK = 1;
export const COACH_STAGGER = 2;

export interface CoachInput {
  /** The first gesture happened (the title is gone). */
  started: boolean;
  /** Wall-clock seconds. */
  now: number;
  strikes: number;
  crits: number;
  staggers: number;
  /** Kills this tier. */
  kills: number;
  dragonId: number;
  phase: DragonPhase;
  /** A weak spot is live and showing (DragonView.weakSpot() is not null). */
  spotLive: boolean;
}

export interface CoachTimeline {
  // ---- outputs (read after step) ----
  /** Which coach is up: COACH_NONE, COACH_WEAK or COACH_STAGGER. */
  mode: number;
  /** Whether its label is on. */
  label: boolean;
  /** The lesson learned on this step (COACH_WEAK: first crit, COACH_STAGGER: first stagger), else 0. */
  learned: number;
  // ---- memory ----
  inited: boolean;
  lastNow: number;
  prevStrikes: number;
  prevCrits: number;
  prevStaggers: number;
  prevPhase: DragonPhase | '';
  prevDragon: number;
  /** Wall time of the session's first strike (Infinity until then). */
  firstStrikeAt: number;
  /** Wall time of the first crit (-Infinity if it happened before this session). */
  learnedAt: number;
  /** Seconds the weak label has been on screen since it last (re)appeared. */
  labelT: number;
  labelExpired: boolean;
  /** Dragon the label expired on; the next dragon brings it back once. */
  labelDragon: number;
  labelEncore: boolean;
  /** Windups the stagger coach has shown on. */
  windups: number;
  /** The current windup carries the stagger coach. */
  windupOn: boolean;
}

export function createCoachTimeline(): CoachTimeline {
  return {
    mode: COACH_NONE,
    label: false,
    learned: 0,
    inited: false,
    lastNow: 0,
    prevStrikes: 0,
    prevCrits: 0,
    prevStaggers: 0,
    prevPhase: '',
    prevDragon: -1,
    firstStrikeAt: Infinity,
    learnedAt: Infinity,
    labelT: 0,
    labelExpired: false,
    labelDragon: -1,
    labelEncore: false,
    windups: 0,
    windupOn: false,
  };
}

/** Forget the session (first step, or stats went backwards: a hard reset or a loaded save). */
function restart(tl: CoachTimeline, s: CoachInput): void {
  tl.inited = true;
  tl.lastNow = s.now;
  tl.prevStrikes = s.strikes;
  tl.prevCrits = s.crits;
  tl.prevStaggers = s.staggers;
  tl.prevPhase = s.phase;
  tl.prevDragon = s.dragonId;
  tl.firstStrikeAt = Infinity;
  tl.learnedAt = s.crits > 0 ? -Infinity : Infinity;
  tl.labelT = 0;
  tl.labelExpired = false;
  tl.labelDragon = -1;
  tl.labelEncore = false;
  tl.windups = 0;
  tl.windupOn = false;
}

/** Advance to `s` (call once per frame). Writes mode, label and learned. */
export function stepCoach(tl: CoachTimeline, s: CoachInput): CoachTimeline {
  if (!tl.inited || s.strikes < tl.prevStrikes || s.crits < tl.prevCrits || s.staggers < tl.prevStaggers) restart(tl, s);
  const dt = s.now > tl.lastNow ? s.now - tl.lastNow : 0;
  tl.lastNow = s.now;

  tl.learned = 0;
  if (s.strikes > tl.prevStrikes && tl.firstStrikeAt === Infinity && s.started) tl.firstStrikeAt = s.now;
  if (s.crits > 0 && tl.prevCrits === 0) {
    tl.learned = COACH_WEAK;
    tl.learnedAt = s.now;
  }
  if (s.staggers > 0 && tl.prevStaggers === 0) tl.learned = COACH_STAGGER;
  const newDragon = s.dragonId !== tl.prevDragon;
  const newWindup = s.phase === 'windup' && (tl.prevPhase !== 'windup' || newDragon);

  tl.mode = COACH_NONE;
  tl.label = false;

  // ---- weak spot ----
  if (s.started && s.crits === 0 && s.now >= tl.firstStrikeAt + COACH_WEAK_DELAY) {
    if (tl.labelExpired && !tl.labelEncore && s.dragonId !== tl.labelDragon) {
      tl.labelExpired = false;
      tl.labelEncore = true;
      tl.labelT = 0;
    }
    if (s.spotLive) {
      tl.mode = COACH_WEAK;
      if (!tl.labelExpired) {
        tl.labelT += dt;
        if (tl.labelT >= COACH_LABEL_MAX) {
          tl.labelExpired = true;
          tl.labelDragon = s.dragonId;
        } else tl.label = true;
      }
    }
  }

  // ---- stagger ----
  if (s.phase !== 'windup' || newDragon || s.staggers > 0) tl.windupOn = false;
  if (
    newWindup &&
    s.started &&
    s.crits > 0 &&
    s.staggers === 0 &&
    s.kills >= COACH_STAGGER_KILLS &&
    s.now >= tl.learnedAt + COACH_STAGGER_AFTER &&
    tl.windups < COACH_STAGGER_MAX
  ) {
    tl.windupOn = true;
    tl.windups++;
  }
  if (tl.windupOn && s.spotLive) {
    tl.mode = COACH_STAGGER;
    tl.label = true;
  }

  tl.prevStrikes = s.strikes;
  tl.prevCrits = s.crits;
  tl.prevStaggers = s.staggers;
  tl.prevPhase = s.phase;
  tl.prevDragon = s.dragonId;
  return tl;
}
