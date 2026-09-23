// The zoom's rally pile (pure, allocation-free after construction): where every knight ends up when
// the army rushes together and climbs onto itself into one living pyramid, the moment before the
// zoom's flash turns it into the colossus.
//
// Spots fill bottom-up, each layer from the middle outward, so the knights who arrive first (the
// nearest) form the base and the latecomers climb to the top. Layer l holds base - l knights, so
// each layer stands in the gaps of the one below (a knight's feet on two pairs of shoulders).
// A little deterministic jitter keeps it a heap of people, not a wall of bricks.

/** Horizontal spacing (m) in a layer, and the rise per layer (m): shoulders onto shoulders. */
export const PILE_DX = 0.5;
export const PILE_DY = 0.92;

function jitter(i: number, salt: number): number {
  let h = Math.imul(i ^ salt, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296 - 0.5;
}

/** Knights in the base layer for a pile of n (the smallest b with b(b+1)/2 >= n). */
export function pileBase(n: number): number {
  if (n <= 0) return 0;
  return Math.ceil((Math.sqrt(8 * n + 1) - 1) / 2);
}

export class PileLayout {
  readonly cap: number;
  /** Spot offsets from the pile's center (m) and heights above the ground (m, >= 0). */
  readonly x: Float32Array;
  readonly h: Float32Array;
  readonly layer: Uint8Array;
  n = 0;
  base = 0;
  layers = 0;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.h = new Float32Array(cap);
    this.layer = new Uint8Array(cap);
  }

  /** Lay out n spots (clamped to the capacity). */
  build(n: number): void {
    n = Math.max(0, Math.min(this.cap, Math.floor(n)));
    this.n = n;
    const base = pileBase(n);
    this.base = base;
    let i = 0;
    let l = 0;
    while (i < n) {
      const c = Math.max(1, base - l);
      // Middle outward: 0, +1, -1, +2, -2... around the layer's center.
      for (let s = 0; s < c && i < n; s++) {
        const k = s === 0 ? 0 : s & 1 ? (s + 1) >> 1 : -(s >> 1);
        // Centre the layer's slots (an even count sits half a spacing off the axis).
        const off = c & 1 ? 0 : 0.5;
        const slot = Math.max(-(c - 1) / 2, Math.min((c - 1) / 2, k - off));
        this.x[i] = slot * PILE_DX + jitter(i, 0x51) * 0.14;
        this.h[i] = l * PILE_DY + Math.abs(jitter(i, 0x77)) * 0.1;
        this.layer[i] = l;
        i++;
      }
      l++;
    }
    this.layers = l;
  }

  /** Height of the top of the pile (m): where the next knight (or the hero) stands. */
  topHeight(layersSettled: number): number {
    return layersSettled <= 0 ? 0 : layersSettled * PILE_DY + 0.25;
  }

  /** Half the base's width (m). */
  halfWidth(): number {
    return Math.max(0.5, this.base * PILE_DX * 0.5);
  }
}
