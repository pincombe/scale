// Small aggregate helpers for the sim's tables and targets.

/** -1 means "never happened": read as +Infinity so it sorts as the worst time. */
export function never(x: number): number {
  return x < 0 ? Infinity : x;
}

/** Median (mean of the middle two for even counts). NaN for an empty list. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

export function max(xs: readonly number[]): number {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  return m;
}

export function min(xs: readonly number[]): number {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return m;
}

/** Whole-run clock as m:ss (or "never"). */
export function clock(sec: number): string {
  if (!Number.isFinite(sec)) return 'never';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
