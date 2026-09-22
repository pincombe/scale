// Game facade + event bus. Owns the live GameState. Actions apply immediately; every event
// (from ticks and dispatches) is queued and drained once per frame, in order, after the ticks
// and before rendering. Subscribers may dispatch while draining; those events drain the same frame.
import { applyAction, createInitialState, tick, TICK_DT } from '../core';
import type { Action, EventOf, GameEvent, GameEventType, GameState } from '../core';

export type Unsubscribe = () => void;
type Handler = (e: GameEvent) => void;

/** Longest stretch catchUp() simulates (M3 replaces this with real offline progress). */
export const CATCH_UP_CAP = 10 * 60;

export class Game {
  state: GameState;
  /** Total events delivered (debug stat). */
  delivered = 0;

  private readonly queue: GameEvent[] = [];
  private readonly typed = new Map<GameEventType, Handler[]>();
  private any: Handler[] = [];
  private readonly enqueue = (e: GameEvent): void => {
    this.queue.push(e);
  };
  private readonly drop = (_e: GameEvent): void => {};
  private draining = false;

  constructor(state: GameState = createInitialState((Math.random() * 0x100000000) >>> 0)) {
    this.state = state;
  }

  /** Apply an action now; its events are delivered at the next drain. */
  dispatch(action: Action): void {
    applyAction(this.state, action, this.enqueue);
  }

  /** One fixed logic step. */
  tick(dt: number = TICK_DT): void {
    tick(this.state, dt, this.enqueue);
  }

  /**
   * Simulate `seconds` (capped) with events dropped, then queue one 'resync' so visuals rebuild
   * from state instead of replaying thousands of hits. Returns the seconds simulated.
   */
  catchUp(seconds: number, cap = CATCH_UP_CAP): number {
    const total = Math.min(Math.max(0, seconds), cap);
    const n = Math.floor(total / TICK_DT);
    for (let i = 0; i < n; i++) tick(this.state, TICK_DT, this.drop);
    if (n > 0) this.queue.push({ type: 'resync' });
    return n * TICK_DT;
  }

  /** Swap in a whole new state (load, reset, debug). Pending events are discarded. */
  replaceState(state: GameState): void {
    this.state = state;
    // Mid-drain (a handler reset the game): let the drain finish, the resync goes last.
    if (!this.draining) this.queue.length = 0;
    this.queue.push({ type: 'resync' });
  }

  /** Queue an event from outside core (app-level only; e.g. 'resync'). */
  post(e: GameEvent): void {
    this.queue.push(e);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Deliver queued events in order. Called once per frame by the loop (nested calls are no-ops). */
  drain(): void {
    if (this.draining) return;
    this.draining = true;
    const q = this.queue;
    // Index loop: handlers may push more events, which are delivered in this same drain.
    for (let i = 0; i < q.length; i++) {
      const e = q[i]!;
      const list = this.typed.get(e.type);
      if (list !== undefined) for (let j = 0; j < list.length; j++) call(list[j]!, e);
      const any = this.any;
      for (let j = 0; j < any.length; j++) call(any[j]!, e);
      this.delivered++;
      if (i > 100000) {
        console.error('Game.drain: runaway event loop, dropping the rest');
        break;
      }
    }
    q.length = 0;
    this.draining = false;
  }

  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends GameEventType>(type: T, fn: (e: EventOf<T>) => void): Unsubscribe {
    const h = fn as Handler;
    // Copy-on-write so (un)subscribing mid-drain never disturbs the iteration in progress.
    this.typed.set(type, [...(this.typed.get(type) ?? []), h]);
    return () => {
      const list = this.typed.get(type);
      if (list) this.typed.set(type, list.filter((x) => x !== h));
    };
  }

  /** Subscribe to every event. Returns an unsubscribe function. */
  onAny(fn: (e: GameEvent) => void): Unsubscribe {
    this.any = [...this.any, fn];
    return () => {
      this.any = this.any.filter((x) => x !== fn);
    };
  }
}

function call(fn: Handler, e: GameEvent): void {
  try {
    fn(e);
  } catch (err) {
    console.error(`Game event handler failed on '${e.type}':`, err);
  }
}
