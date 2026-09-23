// tick: advance the simulation by one fixed step. Deterministic: same state + same dt + same
// actions in the same order always produce the same state and the same events.
// During a zoom's hold (zoom.stage !== null) only the dragon's running animation advances: the
// army, champions, abilities and the boss timer all pause.
import { updateAbilities } from './abilities';
import { updateArmy } from './army';
import { updateDragon } from './dragon';
import { checkUnlocks } from './progress';
import type { Emit, GameState } from './types';

export function tick(state: GameState, dt: number, emit: Emit): void {
  state.t += dt;
  updateDragon(state, dt, emit);
  if (state.zoom.stage === null) updateAbilities(state, dt, emit);
  if (state.zoom.stage === null) updateArmy(state, dt, emit);
  checkUnlocks(state, emit);
}
