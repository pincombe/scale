// Shared helpers for core tests (M2): event recording and the usual setups (a boss on stage, a
// save that has zoomed into the Mountain). Pure, like the rest of core.
import { applyAction } from '../actions';
import { TICK_DT } from '../formulas';
import { createInitialState } from '../state';
import { tick } from '../tick';
import type { EventOf, GameEvent, GameEventType, GameState } from '../types';

export function recorder(): { events: GameEvent[]; emit: (e: GameEvent) => void } {
  const events: GameEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

export function ofType<T extends GameEventType>(events: readonly GameEvent[], type: T): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

export const noop = (_e: GameEvent): void => {};

/** Tick for `seconds` of sim time. */
export function runFor(state: GameState, seconds: number, emit: (e: GameEvent) => void = noop): void {
  const n = Math.round(seconds / TICK_DT);
  for (let i = 0; i < n; i++) tick(state, TICK_DT, emit);
}

/** Tick until `done` (at most `maxSeconds`); returns the sim seconds it took. */
export function runUntil(state: GameState, done: () => boolean, emit: (e: GameEvent) => void = noop, maxSeconds = 120): number {
  let t = 0;
  while (!done() && t < maxSeconds) {
    tick(state, TICK_DT, emit);
    t += TICK_DT;
  }
  return t;
}

/** Kill the current dragon (debug) and tick until the next one is on stage (or a zoom holds). */
export function killAndNext(state: GameState, emit: (e: GameEvent) => void = noop): void {
  applyAction(state, { type: 'debug', op: 'kill' }, emit);
  runUntil(state, () => state.dragon.phase !== 'dying' || state.zoom.stage !== null, emit);
}

/** Make the current dragon practically unkillable (for measuring damage). */
export function tank(state: GameState): void {
  state.dragon.hp = state.dragon.maxHp = state.dragon.maxHp.mul(1e15);
}

/** A fresh save whose tier-0 boss has just arrived (still entering). */
export function withBoss(seed = 1, emit: (e: GameEvent) => void = noop): GameState {
  const s = createInitialState(seed);
  applyAction(s, { type: 'debug', op: 'boss' }, emit);
  killAndNext(s, emit);
  return s;
}

/** Play a zoom's cinematic stages at once (as the stub director does). */
export function finishZoom(state: GameState, emit: (e: GameEvent) => void = noop): void {
  applyAction(state, { type: 'zoom', stage: 'switch' }, emit);
  applyAction(state, { type: 'zoom', stage: 'end' }, emit);
}

/** A save that has really zoomed into the Mountain (first zoom begun by core, then switch + end). */
export function inMountain(seed = 1, emit: (e: GameEvent) => void = noop): GameState {
  const s = createInitialState(seed);
  applyAction(s, { type: 'debug', op: 'cleared' }, emit); // never zoomed: begins at once
  finishZoom(s, emit);
  return s;
}
