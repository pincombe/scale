import { describe, expect, it, vi } from 'vitest';
import { Game } from './game';
import { createInitialState, TICK_DT } from '../core';
import type { GameEvent } from '../core';

function newGame(): Game {
  return new Game(createInitialState(1));
}

describe('Game facade + bus', () => {
  it('applies actions immediately but delivers events only on drain, in order', () => {
    const g = newGame();
    const seen: string[] = [];
    g.onAny((e) => seen.push(e.type));
    g.dispatch({ type: 'strike', weak: false, aimed: true, x: 0, y: 0 });
    expect(g.state.dragon.hp.eq(9)).toBe(true);
    expect(seen).toEqual([]);
    g.dispatch({ type: 'debug', op: 'kill' });
    g.drain();
    expect(seen).toEqual(['strike', 'dragonDeath', 'dragonPhase']);
    g.drain();
    expect(seen.length).toBe(3);
  });

  it('typed subscribers get only their type; unsubscribe works mid-drain', () => {
    const g = newGame();
    const strikes: number[] = [];
    const off = g.on('strike', (e) => {
      strikes.push(e.damage.toNumber());
      off(); // unsubscribing while draining must not skip other handlers
    });
    const other = vi.fn();
    g.on('strike', other);
    g.dispatch({ type: 'strike', weak: false, aimed: true, x: 0, y: 0 });
    g.dispatch({ type: 'strike', weak: true, aimed: true, x: 0, y: 0 });
    g.drain();
    expect(strikes).toEqual([1]);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it('events raised while draining are delivered in the same drain', () => {
    const g = newGame();
    const seen: string[] = [];
    g.on('strike', () => {
      if (seen.length === 0) g.dispatch({ type: 'debug', op: 'gold', amount: 5 });
    });
    g.onAny((e) => seen.push(e.type));
    g.dispatch({ type: 'strike', weak: false, aimed: true, x: 0, y: 0 });
    g.drain();
    expect(seen).toEqual(['strike', 'goldGain']);
  });

  it('a nested drain() from a handler is a no-op (no double delivery)', () => {
    const g = newGame();
    const seen: string[] = [];
    g.onAny((e) => {
      seen.push(e.type);
      g.drain();
    });
    g.dispatch({ type: 'debug', op: 'kill' });
    g.drain();
    expect(seen).toEqual(['dragonDeath', 'dragonPhase']);
  });

  it('a throwing handler does not break delivery to others', () => {
    const g = newGame();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    g.on('strike', () => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    g.on('strike', ok);
    g.dispatch({ type: 'strike', weak: false, aimed: true, x: 0, y: 0 });
    g.drain();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('catchUp simulates silently and queues exactly one resync', () => {
    const g = newGame();
    g.dispatch({ type: 'debug', op: 'units', unit: 'footman', amount: 50 });
    g.drain();
    const seen: GameEvent[] = [];
    g.onAny((e) => seen.push(e));
    const simulated = g.catchUp(120);
    expect(simulated).toBeCloseTo(120, 6);
    expect(g.state.t).toBeCloseTo(120, 6);
    expect(g.state.kills).toBeGreaterThan(3);
    expect(g.pending).toBe(1);
    g.drain();
    expect(seen.map((e) => e.type)).toEqual(['resync']);
  });

  it('catchUp is capped', () => {
    const g = newGame();
    expect(g.catchUp(1e9, 30)).toBeCloseTo(30, 6);
    expect(g.state.t).toBeCloseTo(30, 6);
  });

  it('replaceState discards pending events and queues a resync', () => {
    const g = newGame();
    g.dispatch({ type: 'strike', weak: false, aimed: true, x: 0, y: 0 });
    const seen: string[] = [];
    g.onAny((e) => seen.push(e.type));
    g.replaceState(createInitialState(2));
    g.drain();
    expect(seen).toEqual(['resync']);
    expect(g.state.seed).toBe(2);
  });

  it('tick defaults to the fixed step', () => {
    const g = newGame();
    g.tick();
    expect(g.state.t).toBeCloseTo(TICK_DT, 9);
  });
});
