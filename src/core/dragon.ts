// Dragon lifecycle: spawn, phase machine, damage and death, and (M2) the Wyrm Gauge and the tier's
// boss. Core owns the phases because rewards depend on them (stagger bonus, the boss timer); render
// only animates them.
import { D } from './decimal';
import type { Decimal } from './decimal';
import { nextFloat, nextRange, nextU32, seedRng } from '../lib/rng';
import { BALANCE, BOSS_TEXT, PHASE, dragonName, speciesOf } from './content';
import { bossAt, bossMaxHp, bossOf, canZoom, dragonMaxHp, dragonSize, dyingDuration, enterDuration, killGold } from './formulas';
import { beginZoom } from './zoom';
import type { DragonAttack, DragonPhase, DragonState, Emit, GameState } from './types';

export function addGold(state: GameState, amount: Decimal): void {
  state.gold = state.gold.add(amount);
  state.lifetimeGold = state.lifetimeGold.add(amount);
}

/** Build a fresh dragon (draws from state.rng). `boss` = the tier's boss id, or null. Does not emit. */
export function makeDragon(state: GameState, index: number, phase: DragonPhase, phaseDur: number, boss: string | null = null): DragonState {
  const rng = state.rng;
  const maxHp = boss ? bossMaxHp(state.tier) : dragonMaxHp(state.tier, index);
  const species = speciesOf(state.tier);
  // Names draw from their own stream seeded by state.rng, so however many numbers the writer's
  // dragonName() consumes, the main stream (and everything after it) stays put.
  const nameRng = seedRng(nextU32(rng));
  let { name, epithet } = dragonName(() => nextFloat(nameRng), species, index);
  const text = boss ? BOSS_TEXT[boss] : undefined;
  if (text) {
    name = text.name;
    epithet = text.epithet;
  }
  const size = dragonSize(state.tier, index) * (boss ? BALANCE.boss.sizeMult : 1);
  return {
    id: state.nextDragonId++,
    index,
    species,
    name,
    epithet,
    size,
    seed: nextU32(rng),
    hp: maxHp,
    maxHp,
    phase,
    phaseT: 0,
    phaseDur,
    attack: 'breath',
    staggers: 0,
    boss,
  };
}

export function spawnDragon(state: GameState, index: number, emit: Emit, boss: string | null = null): void {
  const d = makeDragon(state, index, 'enter', 0, boss);
  d.phaseDur = enterDuration(d.size);
  state.dragon = d;
  emit({ type: 'dragonSpawn', id: d.id });
  emit({ type: 'dragonPhase', id: d.id, phase: 'enter', dur: d.phaseDur });
}

/** The gauge is full: announce the tier's boss and bring it on as dragon #index. */
export function summonBoss(state: GameState, index: number, emit: Emit): void {
  const boss = bossOf(state.tier);
  const w = state.wyrm;
  w.bossDur = BALANCE.boss.timer;
  w.bossT = w.bossDur;
  emit({ type: 'bossSummon', boss, dur: w.bossDur });
  spawnDragon(state, index, emit, boss);
}

export function setPhase(state: GameState, phase: DragonPhase, dur: number, emit: Emit): void {
  const d = state.dragon;
  d.phase = phase;
  d.phaseT = 0;
  d.phaseDur = dur;
  emit({ type: 'dragonPhase', id: d.id, phase, dur });
}

/** The dragon retreats off stage (an escaping boss, or a fighting dragon when a zoom begins). */
export function startLeave(state: GameState, emit: Emit): void {
  setPhase(state, 'leave', enterDuration(state.dragon.size), emit);
}

function idleDuration(state: GameState): number {
  return nextRange(state.rng, PHASE.idleMin, PHASE.idleMax);
}

export function startWindup(state: GameState, attack: DragonAttack, emit: Emit): void {
  state.dragon.attack = attack;
  setPhase(state, 'windup', PHASE.windup, emit);
}

/** Phases in which the boss can be hit, so its timer runs (not arriving, dying or leaving). */
export function bossClockRuns(phase: DragonPhase): boolean {
  return phase !== 'enter' && phase !== 'dying' && phase !== 'leave';
}

/** The boss's time ran out: it leaves, and the gauge drops back. */
function bossEscapes(state: GameState, emit: Emit): void {
  const d = state.dragon;
  const w = state.wyrm;
  w.bossT = 0;
  w.escapes++;
  w.charge = Math.min(w.charge, Math.floor(bossAt(state.tier) * BALANCE.boss.escapeCharge));
  emit({ type: 'bossEscaped', boss: d.boss! });
  startLeave(state, emit);
}

/** What comes after a death or a departure: the boss (gauge full), the first zoom, or the next dragon. */
function nextDragon(state: GameState, emit: Emit): void {
  const d = state.dragon;
  const w = state.wyrm;
  // The first boss of a save that has never zoomed: the zoom begins by itself (no new dragon).
  if (d.boss && d.phase === 'dying' && state.zoom.count === 0 && canZoom(state)) {
    beginZoom(state, emit);
    return;
  }
  if (!d.boss && !w.cleared && w.charge >= bossAt(state.tier)) summonBoss(state, d.index + 1, emit);
  else spawnDragon(state, d.index + 1, emit);
}

/**
 * Advance the phase machine by dt seconds. During a zoom's hold nothing transitions: in 'begin' a
 * leaving or dying dragon's phaseT still runs (clamped to phaseDur) so its animation finishes; in
 * 'switched' the new tier's dragon #0 stays frozen at the start of its entrance.
 */
export function updateDragon(state: GameState, dt: number, emit: Emit): void {
  const d = state.dragon;
  const stage = state.zoom.stage;
  if (stage !== null) {
    if (stage === 'begin') d.phaseT = Math.max(d.phaseT, Math.min(d.phaseDur, d.phaseT + dt));
    return;
  }
  d.phaseT += dt;

  if (d.boss && bossClockRuns(d.phase)) {
    state.wyrm.bossT = Math.max(0, state.wyrm.bossT - dt);
    if (state.wyrm.bossT <= 1e-9 && !state.flags['debug.immortal']) {
      bossEscapes(state, emit);
      return;
    }
  }

  if (d.phaseT < d.phaseDur - 1e-9) return;

  if (state.flags['debug.loopPhase']) {
    setPhase(state, d.phase, d.phaseDur, emit);
    return;
  }

  switch (d.phase) {
    case 'enter':
      setPhase(state, 'idle', PHASE.idleAfterEnter, emit);
      break;
    case 'breath':
    case 'swipe':
    case 'stagger':
      setPhase(state, 'idle', idleDuration(state), emit);
      break;
    case 'idle':
      startWindup(state, nextFloat(state.rng) < PHASE.breathChance ? 'breath' : 'swipe', emit);
      break;
    case 'windup':
      setPhase(state, d.attack, d.attack === 'breath' ? PHASE.breath : PHASE.swipe, emit);
      break;
    case 'dying':
    case 'leave':
      nextDragon(state, emit);
      break;
  }
}

export function killDragon(state: GameState, emit: Emit): void {
  const d = state.dragon;
  d.hp = D(0);
  state.kills++;
  const gold = killGold(state);
  addGold(state, gold);
  emit({ type: 'dragonDeath', id: d.id, gold });
  const w = state.wyrm;
  if (d.boss) {
    const flag = 'bossDefeated.' + d.boss;
    const first = !state.flags[flag];
    state.flags[flag] = true;
    w.bossT = 0;
    w.cleared = true;
    w.clearedAt = state.kills;
    emit({ type: 'bossDefeated', boss: d.boss, first });
  } else if (!w.cleared) {
    w.charge = Math.min(bossAt(state.tier), w.charge + 1);
  }
  setPhase(state, 'dying', dyingDuration(d.size), emit);
}

/** A dragon that can take damage: not dying, not leaving (an escaping boss or a zoom's retreat). */
export function dragonHittable(phase: DragonPhase): boolean {
  return phase !== 'dying' && phase !== 'leave';
}

/** Apply damage; returns true if this killed the dragon. No effect while dying or leaving. */
export function damageDragon(state: GameState, amount: Decimal, emit: Emit): boolean {
  const d = state.dragon;
  if (!dragonHittable(d.phase)) return false;
  d.hp = d.hp.sub(amount);
  if (d.hp.gt(0)) return false;
  if (state.flags['debug.immortal']) {
    d.hp = d.maxHp;
    return false;
  }
  killDragon(state, emit);
  return true;
}
