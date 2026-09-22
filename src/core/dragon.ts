// Dragon lifecycle: spawn, phase machine, damage and death. Core owns the phases because
// rewards depend on them (stagger bonus); render only animates them.
import { D } from './decimal';
import type { Decimal } from './decimal';
import { nextFloat, nextRange, nextU32, seedRng } from '../lib/rng';
import { PHASE, dragonName, speciesOf } from './content';
import { dragonMaxHp, dragonSize, killGold } from './formulas';
import type { DragonAttack, DragonPhase, DragonState, Emit, GameState } from './types';

export function addGold(state: GameState, amount: Decimal): void {
  state.gold = state.gold.add(amount);
  state.lifetimeGold = state.lifetimeGold.add(amount);
}

/** Build a fresh dragon (draws from state.rng). Does not emit. */
export function makeDragon(state: GameState, index: number, phase: DragonPhase, phaseDur: number): DragonState {
  const rng = state.rng;
  const maxHp = dragonMaxHp(state.tier, index);
  const species = speciesOf(state.tier);
  // Names draw from their own stream seeded by state.rng, so however many numbers the writer's
  // dragonName() consumes, the main stream (and everything after it) stays put.
  const nameRng = seedRng(nextU32(rng));
  const { name, epithet } = dragonName(() => nextFloat(nameRng), species, index);
  return {
    id: state.nextDragonId++,
    index,
    species,
    name,
    epithet,
    size: dragonSize(state.tier, index),
    seed: nextU32(rng),
    hp: maxHp,
    maxHp,
    phase,
    phaseT: 0,
    phaseDur,
    attack: 'breath',
  };
}

export function spawnDragon(state: GameState, index: number, emit: Emit): void {
  state.dragon = makeDragon(state, index, 'enter', PHASE.enter);
  emit({ type: 'dragonSpawn', id: state.dragon.id });
  emit({ type: 'dragonPhase', id: state.dragon.id, phase: 'enter', dur: PHASE.enter });
}

export function setPhase(state: GameState, phase: DragonPhase, dur: number, emit: Emit): void {
  const d = state.dragon;
  d.phase = phase;
  d.phaseT = 0;
  d.phaseDur = dur;
  emit({ type: 'dragonPhase', id: d.id, phase, dur });
}

function idleDuration(state: GameState): number {
  return nextRange(state.rng, PHASE.idleMin, PHASE.idleMax);
}

export function startWindup(state: GameState, attack: DragonAttack, emit: Emit): void {
  state.dragon.attack = attack;
  setPhase(state, 'windup', PHASE.windup, emit);
}

/** Advance the phase machine by dt seconds. */
export function updateDragon(state: GameState, dt: number, emit: Emit): void {
  const d = state.dragon;
  d.phaseT += dt;
  if (d.phaseT < d.phaseDur - 1e-9) return;

  if (state.flags['debug.loopPhase']) {
    setPhase(state, d.phase, d.phaseDur, emit);
    return;
  }

  switch (d.phase) {
    case 'enter':
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
      spawnDragon(state, d.index + 1, emit);
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
  setPhase(state, 'dying', PHASE.dying, emit);
}

/** Apply damage; returns true if this killed the dragon. No effect while dying. */
export function damageDragon(state: GameState, amount: Decimal, emit: Emit): boolean {
  const d = state.dragon;
  if (d.phase === 'dying') return false;
  d.hp = d.hp.sub(amount);
  if (d.hp.gt(0)) return false;
  if (state.flags['debug.immortal']) {
    d.hp = d.maxHp;
    return false;
  }
  killDragon(state, emit);
  return true;
}
