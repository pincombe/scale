// tick: advance the simulation by one fixed step. Deterministic: same state + same dt + same
// actions in the same order always produce the same state and the same events.
import { updateArmy } from './army';
import { updateDragon } from './dragon';
import { checkUnlocks } from './progress';
import type { Emit, GameState } from './types';

export function tick(state: GameState, dt: number, emit: Emit): void {
  state.t += dt;
  updateDragon(state, dt, emit);
  updateArmy(state, dt, emit);
  checkUnlocks(state, emit);
}
