// Seeded coherent noise. Build one Noise per use-site at init (it owns a permutation table),
// then sample it every frame allocation-free. All outputs are roughly in [-1, 1].
import { seedRng, nextFloat } from './rng';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
// 12 gradient directions for 2D simplex (the classic set, z dropped).
const GRAD_X = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]);
const GRAD_Y = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1]);

export class Noise {
  /** Permutation table, doubled to avoid index wrapping. */
  private readonly perm = new Uint8Array(512);
  /** Per-lattice random values in [-1, 1) for value noise. */
  private readonly vals = new Float64Array(256);
  /** Per-lattice gradients in [-1, 1) for 1D gradient noise. */
  private readonly grads1 = new Float64Array(256);

  constructor(seed = 1) {
    const s = seedRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(nextFloat(s) * (i + 1));
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    for (let i = 0; i < 256; i++) {
      this.vals[i] = nextFloat(s) * 2 - 1;
      this.grads1[i] = nextFloat(s) * 2 - 1;
    }
  }

  /** 1D gradient (Perlin-style) noise, smooth with C2 continuity. Range ~[-0.5, 0.5] scaled to ~[-1, 1]. */
  n1(x: number): number {
    const xi = Math.floor(x);
    const xf = x - xi;
    const i0 = xi & 255;
    const g0 = this.grads1[this.perm[i0]!]!;
    const g1 = this.grads1[this.perm[i0 + 1]!]!;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const a = g0 * xf;
    const b = g1 * (xf - 1);
    return (a + (b - a) * u) * 2;
  }

  /** 2D value noise (bilinear on lattice values with quintic fade). Range [-1, 1]. */
  value2(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const perm = this.perm;
    const vals = this.vals;
    const v00 = vals[perm[perm[X]! + Y]!]!;
    const v10 = vals[perm[perm[X + 1]! + Y]!]!;
    const v01 = vals[perm[perm[X]! + Y + 1]!]!;
    const v11 = vals[perm[perm[X + 1]! + Y + 1]!]!;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = v00 + (v10 - v00) * u;
    const b = v01 + (v11 - v01) * u;
    return a + (b - a) * v;
  }

  /** 2D simplex noise. Range ~[-1, 1]. */
  simplex2(xin: number, yin: number): number {
    const perm = this.perm;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1: number;
    let j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const g = perm[ii + perm[jj]!]! % 12;
      t0 *= t0;
      n0 = t0 * t0 * (GRAD_X[g]! * x0 + GRAD_Y[g]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const g = perm[ii + i1 + perm[jj + j1]!]! % 12;
      t1 *= t1;
      n1 = t1 * t1 * (GRAD_X[g]! * x1 + GRAD_Y[g]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const g = perm[ii + 1 + perm[jj + 1]!]! % 12;
      t2 *= t2;
      n2 = t2 * t2 * (GRAD_X[g]! * x2 + GRAD_Y[g]! * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** Fractal sum of simplex octaves (lacunarity 2, gain 0.5). Range ~[-1, 1]. */
  fbm2(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.simplex2(x * f, y * f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}
