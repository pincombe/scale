// Formation: where every knight stands, relative to the hero. Pure and allocation-free.
//
// Slots never depend on the army size, so a knight bought later never shoves anyone: the n-th
// footman always stands on the same spot. Pseudo-depth rows: row 0 is nearest the viewer (lowest
// on screen, full size); higher rows stand further back (higher, smaller, hazier). Footmen fill
// rows 0-2 behind and around the hero; archers stand in rows 3-4, the back ranks.

export const ROWS = 5;
/** Feet y offset (m, +down) per depth row: near rows sit lower on the ground plane. */
export const ROW_Y = [0.26, 0.15, 0.05, -0.04, -0.11] as const;
/** Size multiplier per depth row. */
export const ROW_SCALE = [1, 0.965, 0.93, 0.895, 0.86] as const;

/** Column spacing (m). */
export const COL_FOOT = 0.64;
export const COL_ARCH = 0.6;
/** Distance from the hero to the first footman column / archer column (m). */
export const FOOT_START = 0.8;
export const ARCH_START = 1.35;

/** Row per position in a footman column: the first recruit stands in the back row, so his banner rises behind the hero. */
const FOOT_ORDER = [2, 0, 1] as const;
const FOOT_ROW_X = [0.0, 0.34, 0.2] as const;

/** Where the hero stands relative to the dragon's front edge (m). */
export const HERO_GAP = 0.95;
/** Sprites drawn at most; past this, each sprite stands for a squad. */
export const SPRITE_CAP = 300;

export interface Slot {
  /** x relative to the hero (m, negative = behind). */
  x: number;
  row: number;
  col: number;
}

function jitter(i: number, salt: number): number {
  // Cheap deterministic hash -> [-0.5, 0.5).
  let h = Math.imul(i ^ salt, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) - 0.5;
}

export function footSlot(i: number, out: Slot): Slot {
  const col = Math.floor(i / 3);
  const k = i - col * 3;
  const row = FOOT_ORDER[k]!;
  out.col = col;
  out.row = row;
  out.x = -FOOT_START - col * COL_FOOT - FOOT_ROW_X[row]! + jitter(i, 0x51) * 0.12;
  return out;
}

export function archerSlot(i: number, out: Slot): Slot {
  const col = i >> 1;
  const row = 3 + (i & 1);
  out.col = col;
  out.row = row;
  out.x = -ARCH_START - col * COL_ARCH - (row === 4 ? 0.3 : 0) + jitter(i, 0xa7) * 0.12;
  return out;
}

/** Every ~8 footmen (starting with the very first) and every ~9 archers carry a banner. */
export function isBearer(archer: boolean, i: number): boolean {
  return archer ? i % 9 === 4 : i % 8 === 0;
}

const NICE = [1, 2, 3, 4, 5, 10, 20, 25, 50];

/**
 * Knights per sprite so at most `cap` sprites are drawn: 1 while it fits, then 2, 3, 4, 5, 10, 20,
 * 25, 50, 100, 200, 250, 500, ... (round numbers read well on a banner).
 */
export function squadSize(foot: number, archers: number, cap = SPRITE_CAP): number {
  const f = Math.max(0, Math.floor(foot));
  const a = Math.max(0, Math.floor(archers));
  let mag = 1;
  for (let guard = 0; guard < 400; guard++) {
    for (const n of NICE) {
      const k = n * mag;
      if (k < 1) continue;
      if (Math.ceil(f / k) + Math.ceil(a / k) <= cap) return k;
    }
    mag *= 10;
  }
  return Number.MAX_VALUE;
}

/** Sprites shown for `count` knights at squad size k. */
export function shownCount(count: number, k: number): number {
  return Math.ceil(Math.max(0, Math.floor(count)) / k);
}
