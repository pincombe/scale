// Seeded PRNG: sfc32 (Small Fast Counting, 128-bit state). Deterministic across JS engines.
// The state is a plain array of four uint32s so it serializes as JSON (core keeps it in GameState.rng).

export type RngState = [number, number, number, number];

/** splitmix32 step, used only to expand a 32-bit seed into four well-mixed words. */
function splitmix32(a: number): number {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}

/** Fresh state from any 32-bit seed (warmed up so nearby seeds diverge immediately). */
export function seedRng(seed: number): RngState {
  const s = seed >>> 0;
  const st: RngState = [splitmix32(s), splitmix32(s ^ 0x6a09e667), splitmix32(s ^ 0xbb67ae85), splitmix32(s ^ 0x3c6ef372)];
  for (let i = 0; i < 12; i++) nextU32(st);
  return st;
}

/** Next uint32; advances the state in place. */
export function nextU32(s: RngState): number {
  let a = s[0] | 0;
  let b = s[1] | 0;
  let c = s[2] | 0;
  let d = s[3] | 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a >>> 0;
  s[1] = b >>> 0;
  s[2] = c >>> 0;
  s[3] = d >>> 0;
  return t >>> 0;
}

/** Float in [0, 1). */
export function nextFloat(s: RngState): number {
  return nextU32(s) / 4294967296;
}

/** Float in [lo, hi). */
export function nextRange(s: RngState, lo: number, hi: number): number {
  return lo + (hi - lo) * nextFloat(s);
}

/** Integer in [0, n). */
export function nextInt(s: RngState, n: number): number {
  return Math.floor(nextFloat(s) * n);
}

/** FNV-1a hash of a string to uint32 (stable seeds from names/ids). */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Object wrapper for render-side seeded variation (e.g. a dragon's look from DragonState.seed).
 * Not for core: core keeps its RNG state inside GameState so saves stay deterministic.
 */
export class Rng {
  readonly s: RngState;

  constructor(seed = 1) {
    this.s = seedRng(seed);
  }

  reseed(seed: number): this {
    const n = seedRng(seed);
    this.s[0] = n[0];
    this.s[1] = n[1];
    this.s[2] = n[2];
    this.s[3] = n[3];
    return this;
  }

  u32(): number {
    return nextU32(this.s);
  }

  /** [0, 1) */
  float(): number {
    return nextFloat(this.s);
  }

  /** [lo, hi) */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * nextFloat(this.s);
  }

  /** [0, n) */
  int(n: number): number {
    return Math.floor(nextFloat(this.s) * n);
  }

  /** -1 or +1 */
  sign(): number {
    return nextFloat(this.s) < 0.5 ? -1 : 1;
  }

  chance(p: number): boolean {
    return nextFloat(this.s) < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(nextFloat(this.s) * arr.length)] as T;
  }
}
