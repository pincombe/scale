// JSON (de)serialization with exact Decimal round-trips. This is the save format from M3 on.
// Decimals are written as {"$d":[mantissa, exponent]} (doubles round-trip exactly through JSON).
import { Decimal } from './decimal';
import { STATE_VERSION } from './state';
import type { GameState } from './types';

const TAG = '$d';

function replacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  // JSON.stringify calls Decimal.toJSON() before the replacer sees `value`, so read the raw holder.
  const raw = this[key];
  if (raw instanceof Decimal) return { [TAG]: [raw.mantissa, raw.exponent] };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const tagged = (value as Record<string, unknown>)[TAG];
    if (Array.isArray(tagged) && tagged.length === 2 && Object.keys(value).length === 1) {
      return Decimal.fromMantissaExponent(Number(tagged[0]), Number(tagged[1]));
    }
  }
  return value;
}

/** Any JSON-able value containing Decimals (state, events, action logs). */
export function toJSON(value: unknown): string {
  return JSON.stringify(value, replacer);
}

export function fromJSON<T>(text: string): T {
  return JSON.parse(text, reviver) as T;
}

export function serialize(state: GameState): string {
  return toJSON(state);
}

export function deserialize(text: string): GameState {
  const state = fromJSON<GameState>(text);
  if (state === null || typeof state !== 'object' || typeof state.v !== 'number') {
    throw new Error('deserialize: not a SCALE save');
  }
  if (state.v !== STATE_VERSION) {
    throw new Error(`deserialize: save version ${state.v} is not supported (expected ${STATE_VERSION})`);
  }
  return state;
}
