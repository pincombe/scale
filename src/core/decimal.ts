// The one place the big-number library is imported. Everyone else imports Decimal from here.
//
// Rules for break_infinity Decimals:
// - Treat them as immutable values: use a.add(b), a.mul(b) etc. (they return new Decimals).
//   Never call the mutating methods (fromValue, fromNumber, normalize...) on a shared instance.
// - Compare with a.lt(b) / a.gte(b) / a.eq(b). NEVER use < > + on Decimals: valueOf() returns a
//   string, so `a < b` compiles and silently compares strings.
// - Convert for display with fmt() (core/format.ts), for animation with toNumber() (may be Infinity).
import Decimal from 'break_infinity.js';

export { Decimal };
export type { DecimalSource } from 'break_infinity.js';

/** Shorthand constructor: D(5), D('1e300'), D(otherDecimal). */
export function D(x: number | string | Decimal): Decimal {
  return new Decimal(x);
}

export function isDecimal(x: unknown): x is Decimal {
  return x instanceof Decimal;
}
