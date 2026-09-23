// Formation: where every knight stands, relative to the hero. Pure and allocation-free.
//
// Slots never depend on the army size, so a knight bought later never shoves anyone: the n-th
// footman always stands on the same spot. Pseudo-depth rows: row 0 is nearest the viewer (lowest
// on screen, full size); higher rows stand further back (higher, smaller, hazier). Footmen fill
// rows 0-2 behind and around the hero; archers stand in rows 3-4, the back ranks; lancers (M2)
// form a squadron in rows 5-6 behind everyone, starting a few columns back so their horses and
// upright lances rise over the infantry without crowding the hero.
//
// Champions (M2) stand beside the hero in a place of honor; the ranks step back to make room
// (champRoom), the one thing a slot depends on besides its index.

/** Knight rows (footmen and archers). */
export const ROWS = 5;
/** Feet y offset (m, +down) per depth row: near rows sit lower on the ground plane. */
export const ROW_Y = [0.26, 0.15, 0.05, -0.04, -0.11, -0.19, -0.25] as const;
/** Size multiplier per depth row. */
export const ROW_SCALE = [1, 0.965, 0.93, 0.895, 0.86, 0.83, 0.8] as const;
/** The lancers' two rows. */
export const LANCE_ROW = 5;
/** Lancer column spacing (m) and distance from the hero to the first lancer (m). */
export const COL_LANCE = 1.75;
export const LANCE_START = 2.6;

/** Champion spots (m behind the hero), by join order. */
export const CHAMP_GAP = [1.05, 2.25] as const;
/** How far the ranks step back for `n` champions (m). */
export function champRoom(n: number): number {
  return n <= 0 ? 0 : 0.2 + 1.15 * Math.min(n, CHAMP_GAP.length);
}

/** Column spacing (m). */
export const COL_FOOT = 0.64;
export const COL_ARCH = 0.6;
/** Distance from the hero to the first footman column / archer column (m). */
export const FOOT_START = 0.8;
export const ARCH_START = 1.35;

/** Row per position in a footman column: the first recruit stands in the back row, so his banner rises behind the hero. */
const FOOT_ORDER = [2, 0, 1] as const;
const FOOT_ROW_X = [0.0, 0.34, 0.2] as const;

/** Where the hero stands relative to the dragon's front edge (m), for the smallest dragons. */
export const HERO_GAP = 0.95;

/**
 * The hero's stand-off from the dragon's front edge (m): grows with the dragon so the whole
 * silhouette (including a body that turns toward the army to swipe) stays clear of the hero, but
 * saturates so a huge dragon is still fought up close.
 */
export function heroStandOff(dragonSize: number): number {
  return HERO_GAP + 0.6 * Math.min(Math.max(dragonSize, 0), 2.5);
}
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

export function lancerSlot(i: number, out: Slot): Slot {
  const col = i >> 1;
  const row = LANCE_ROW + (i & 1);
  out.col = col;
  out.row = row;
  out.x = -LANCE_START - col * COL_LANCE - (row === LANCE_ROW + 1 ? COL_LANCE * 0.5 : 0) + jitter(i, 0x3d) * 0.2;
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
export function squadSize(foot: number, archers: number, cap = SPRITE_CAP, lancers = 0): number {
  const f = Math.max(0, Math.floor(foot));
  const a = Math.max(0, Math.floor(archers));
  // A horse takes the room of about two knights on screen.
  const l = Math.max(0, Math.floor(lancers));
  let mag = 1;
  for (let guard = 0; guard < 400; guard++) {
    for (const n of NICE) {
      const k = n * mag;
      if (k < 1) continue;
      if (Math.ceil(f / k) + Math.ceil(a / k) + 2 * Math.ceil(l / k) <= cap) return k;
    }
    mag *= 10;
  }
  return Number.MAX_VALUE;
}

/** Sprites shown for `count` knights at squad size k. */
export function shownCount(count: number, k: number): number {
  return Math.ceil(Math.max(0, Math.floor(count)) / k);
}
