// Number formatting for everything the player reads.
//   below 1,000: plain ("7", "12.5", "0.25"); integers never show decimals
//   1,000 up to 1e36: three significant digits + suffix ("1.00K", "45.6M", "789B" ... "1.00Dc")
//   1e36 and up (or scientific notation): "1.23e45"
import { Decimal } from './decimal';

export type Notation = 'letters' | 'scientific';

const SUFFIXES: readonly string[] = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

let defaultNotation: Notation = 'letters';

/** Set the notation fmt() uses when none is passed (the UI calls this from settings). */
export function setNotation(n: Notation): void {
  defaultNotation = n;
}

export function getNotation(): Notation {
  return defaultNotation;
}

function plain(x: number): string {
  if (Number.isInteger(x)) return x === 0 ? '0' : String(x);
  const a = Math.abs(x);
  const decimals = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  let s = a.toFixed(decimals);
  if (s.indexOf('.') !== -1) {
    let end = s.length;
    while (s.charCodeAt(end - 1) === 48) end--; // trailing '0'
    if (s.charCodeAt(end - 1) === 46) end--; // trailing '.'
    s = s.slice(0, end);
  }
  if (s === '0') return '0';
  return (x < 0 ? '-' : '') + s;
}

/** m x 10^e with 1 <= |m| < 10, formatted for |value| >= 999.5. */
function big(m: number, e: number, notation: Notation): string {
  const sign = m < 0 ? '-' : '';
  let am = Math.abs(m);
  if (notation === 'letters' && e < 36) {
    let group = Math.floor(e / 3);
    const within = e - group * 3; // 0, 1 or 2 digits before the point
    const decimals = 2 - within;
    const p = Math.pow(10, decimals);
    // +1e-7 absorbs float noise so exact halves (999.5K) round up; v is in [100, 1000).
    let value = Math.round(am * Math.pow(10, within) * p + 1e-7) / p;
    let places = decimals;
    if (value >= 1000) {
      // 999.5K rounds up into the next group.
      group++;
      value = value / 1000;
      places = 2;
    }
    if (group < SUFFIXES.length) return sign + value.toFixed(places) + SUFFIXES[group];
    am = value; // fell off the suffix table: rounded up to exactly 1e36
    e = 36;
  }
  let r = Math.round(am * 100 + 1e-7) / 100;
  if (r >= 10) {
    r = r / 10;
    e++;
  }
  return sign + r.toFixed(2) + 'e' + e;
}

export function fmt(x: Decimal | number, notation: Notation = defaultNotation): string {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? '∞' : '-∞';
    const a = Math.abs(x);
    if (a < 999.5) return plain(x);
    let e = Math.floor(Math.log10(a));
    let m = x / Math.pow(10, e);
    if (Math.abs(m) >= 10) {
      m /= 10;
      e++;
    } else if (Math.abs(m) < 1) {
      m *= 10;
      e--;
    }
    return big(m, e, notation);
  }
  const m = x.mantissa;
  const e = x.exponent;
  if (!Number.isFinite(m) || !Number.isFinite(e)) return 'NaN';
  if (e < 3) {
    const n = x.toNumber();
    if (Math.abs(n) < 999.5) return plain(n);
  }
  return big(m, e, notation);
}
