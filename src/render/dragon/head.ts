// Head geometry in head units (pure; built once per individual, no per-frame work).
//
// Head frame: origin = the neck joint, forward (toward the snout) = -x, up = -y, head length 1
// (back of the skull at x = +0.16, snout tip at x = -0.84). The rig places the frame (pivot,
// pitch, scale = head length) and the painter draws these control points through it.
import { Rng } from '../../lib/rng';
import type { Individual } from './species';

const XB = 0.16;
const XS = -0.84;
/** Mouth line (y) in head units: slightly below the neck joint. */
export const MOUTH_Y = 0.08;

/** x of a point p (0 = back of the skull .. 1 = snout tip) along the head. */
function hx(p: number): number {
  return XB - p;
}

export const MAX_HORNS = 3;
export const MAX_GILLS = 4;
export const MAX_TEETH = 8;
export const MAX_CROWN = 10;
/** Points per gnarled horn outline: 7 along each edge + 3 across a broken end (or the tip). */
export const HORN_PTS = 17;

export class HeadShape {
  /** Upper head (skull + upper jaw) closed outline control points, x/y interleaved. */
  readonly upper = new Float32Array(32);
  upperN = 0;
  /** Lower jaw closed outline (unrotated), x/y interleaved. */
  readonly jaw = new Float32Array(16);
  jawN = 0;
  hingeX = 0;
  hingeY = 0;
  /** Teeth as triangles (6 floats each): upper teeth hang from the lip, lower teeth are in jaw space. */
  readonly teethU = new Float32Array(6 * MAX_TEETH);
  teethUN = 0;
  readonly teethL = new Float32Array(6 * MAX_TEETH);
  teethLN = 0;
  /** Horns: base A, control, tip, control, base B (10 floats each). */
  readonly horns = new Float32Array(10 * MAX_HORNS);
  hornN = 0;
  /**
   * Gnarled (knotted, possibly snapped) horns: closed outlines of HORN_PTS points each, used
   * instead of the smooth horn curves when `gnarled`.
   */
  readonly hornPoly = new Float32Array(2 * HORN_PTS * MAX_HORNS);
  gnarled = false;
  /** Crown of stony spikes along the back of the skull: base A, tip, base B (6 floats each). */
  readonly crown = new Float32Array(6 * MAX_CROWN);
  crownN = 0;
  /** Gill stalks: root x, root y, angle, length, width (5 floats each). */
  readonly gills = new Float32Array(5 * MAX_GILLS);
  gillN = 0;
  /** Fan frill behind the jaw: radius (0 = none), rib count. */
  frill = 0;
  frillRibs = 0;
  /** Whisker length (0 = none). */
  whisker = 0;
  eyeX = 0;
  eyeY = 0;
  eyeR = 0;
  nostrilX = 0;
  nostrilY = 0;
  /** Front of the upper lip (fire comes out between here and the lower lip). */
  lipX = 0;
  lipY = 0;
  /** Lower lip front in jaw space (rotates with the jaw). */
  chinX = 0;
  chinY = 0;
  /** Where the cheek membrane meets the lips (0..1 along the gape from the hinge). */
  gapeX = 0;
  /** Hit ellipse (forgiving). */
  hitX = 0;
  hitY = 0;
  hitRX = 0;
  hitRY = 0;
  /** Tongue root (inside the mouth). */
  tongueX = 0;
  tongueY = 0;

  build(ind: Individual): void {
    const C = ind.cranium;
    const Hs = ind.snout;
    const J = ind.jaw;
    const eR = ind.eyeSize;
    const B = ind.brow;
    const ex = hx(ind.eyePos);
    const ey = -0.44 * C;
    this.eyeX = ex;
    this.eyeY = ey;
    this.eyeR = eR;

    const u = this.upper;
    let n = 0;
    const put = (x: number, y: number): void => {
      u[n++] = x;
      u[n++] = y;
    };
    put(XB - 0.03, MOUTH_Y + 0.03); // back-bottom (hidden in the neck)
    put(XB + 0.015, -0.22 * C); // back of the skull
    put(XB - 0.06, -0.78 * C); // occiput
    put(hx(0.3), -C); // cranium top
    put(ex + 0.035, -(0.92 * C + B)); // brow ridge over the eye
    put(ex - eR - 0.07, -0.72 * C + 0.35 * B); // the stop, in front of the eye
    put(hx(0.8), -(Hs + 0.025)); // nasal bridge
    put(hx(0.93), -(Hs + 0.05)); // nostril bump
    put(XS, -0.42 * Hs); // snout front
    put(XS + 0.02, MOUTH_Y - 0.005); // upper lip front
    put(hx(0.6), MOUTH_Y + 0.015); // upper lip
    put(hx(0.3), MOUTH_Y + 0.012); // mouth corner
    put(hx(0.1), MOUTH_Y + 0.55 * J); // jowl (covers the hinge)
    this.upperN = n >> 1;

    this.hingeX = hx(0.2);
    this.hingeY = MOUTH_Y - 0.02;
    const j = this.jaw;
    n = 0;
    const jp = (x: number, y: number): void => {
      j[n++] = x;
      j[n++] = y;
    };
    jp(hx(0.13), MOUTH_Y - 0.035);
    jp(hx(0.17), MOUTH_Y + 0.86 * J);
    jp(hx(0.6), MOUTH_Y + 0.8 * J);
    jp(hx(0.87), MOUTH_Y + 0.44 * J);
    jp(XS + 0.045, MOUTH_Y + 0.018);
    jp(hx(0.36), MOUTH_Y + 0.004);
    this.jawN = n >> 1;
    this.chinX = XS + 0.045;
    this.chinY = MOUTH_Y + 0.018;
    this.lipX = XS + 0.03;
    this.lipY = MOUTH_Y;
    this.gapeX = 0.42;
    this.tongueX = hx(0.55);
    this.tongueY = MOUTH_Y + 0.02;

    // Teeth: a row of little triangles, a fang near the front.
    const nt = ind.teeth > 0.02 ? Math.min(MAX_TEETH, Math.round(3 + 4 * ind.teeth)) : 0;
    const ts = 0.035 + 0.05 * ind.teeth;
    let t = 0;
    for (let i = 0; i < nt; i++) {
      const p = 0.48 + (0.42 * i) / Math.max(1, nt - 1);
      const x = hx(p);
      const s = i === nt - 2 ? ts * 1.6 : ts * (0.75 + 0.25 * Math.sin(i * 2.3 + 1));
      this.teethU[t++] = x + s * 0.42;
      this.teethU[t++] = MOUTH_Y;
      this.teethU[t++] = x;
      this.teethU[t++] = MOUTH_Y + s;
      this.teethU[t++] = x - s * 0.42;
      this.teethU[t++] = MOUTH_Y;
    }
    this.teethUN = nt;
    t = 0;
    const nl = Math.max(0, nt - 1);
    for (let i = 0; i < nl; i++) {
      const p = 0.5 + (0.36 * i) / Math.max(1, nl - 1);
      const x = hx(p) - 0.03;
      const s = ts * (i === nl - 1 ? 1.3 : 0.7);
      this.teethL[t++] = x - s * 0.4;
      this.teethL[t++] = MOUTH_Y + 0.012;
      this.teethL[t++] = x;
      this.teethL[t++] = MOUTH_Y + 0.012 - s;
      this.teethL[t++] = x + s * 0.4;
      this.teethL[t++] = MOUTH_Y + 0.012;
    }
    this.teethLN = nl;

    // Horns sweep up and back from the cranium; extra pairs sit lower and behind.
    const pairs = ind.hornLen > 0.01 ? Math.min(MAX_HORNS, ind.hornPairs) : 0;
    const roots = [hx(0.25), -0.93 * C, hx(0.1), -0.58 * C, hx(0.37), -0.97 * C];
    const angs = [-0.5, -0.16, -0.85];
    const lens = [1, 0.62, 0.45];
    const curls = [1, -0.55, 0.8];
    const widths = [1, 0.78, 0.6];
    const h = this.horns;
    t = 0;
    for (let k = 0; k < pairs; k++) {
      const rx = roots[k * 2]!;
      const ry = roots[k * 2 + 1]!;
      const a = angs[k]!;
      const len = ind.hornLen * lens[k]!;
      const w = ind.hornWidth * widths[k]!;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const nx = -dy; // perpendicular, toward the lower side of the horn
      const ny = dx;
      const c = ind.hornCurl * curls[k]!;
      const tx = Math.cos(a - c);
      const ty = Math.sin(a - c);
      const mx = rx + dx * len * 0.5;
      const my = ry + dy * len * 0.5;
      h[t++] = rx - nx * w * 0.5;
      h[t++] = ry - ny * w * 0.5;
      h[t++] = mx - nx * w * 0.3;
      h[t++] = my - ny * w * 0.3;
      h[t++] = mx + tx * len * 0.5;
      h[t++] = my + ty * len * 0.5;
      h[t++] = mx + nx * w * 0.22;
      h[t++] = my + ny * w * 0.22;
      h[t++] = rx + nx * w * 0.5;
      h[t++] = ry + ny * w * 0.5;
    }
    this.hornN = pairs;
    this.gnarled = pairs > 0 && (ind.hornGnarl > 0.01 || ind.hornBreak > 0.01);
    if (this.gnarled) this.buildGnarled(ind);
    this.buildCrown(ind, C);

    // Feathery gill stalks fanning back from behind the jaw (the newt's trademark).
    const gn = ind.gills > 0.01 ? Math.min(MAX_GILLS, ind.gillCount) : 0;
    const g = this.gills;
    t = 0;
    // They fan up and back above the neck like a little crown (angle 0 = straight back).
    const glen = [0.88, 1.05, 0.9, 0.75];
    for (let k = 0; k < gn; k++) {
      const f = gn === 1 ? 0.5 : k / (gn - 1);
      g[t++] = XB - 0.09 + 0.03 * f;
      g[t++] = -0.62 * C + 0.5 * C * f;
      g[t++] = -1.55 + 1.3 * f;
      g[t++] = ind.gills * glen[k]!;
      g[t++] = 0.078;
    }
    this.gillN = gn;

    this.frill = ind.frill;
    this.frillRibs = 5;
    this.whisker = ind.whiskers;

    this.nostrilX = hx(0.93);
    this.nostrilY = -(Hs + 0.02);
    this.hitX = hx(0.48);
    this.hitY = (-C + MOUTH_Y + J) * 0.5;
    this.hitRX = 0.56;
    this.hitRY = (C + MOUTH_Y + J) * 0.5 + 0.05;
  }

  /**
   * Knotted horn outlines from the smooth horn curves: bumps along both edges, and a jagged break
   * part way up when snapped (the Elder Newt's gnarled crown of broken horns).
   */
  private buildGnarled(ind: Individual): void {
    const rng = new Rng((ind.seed ^ 0x6e4a1) >>> 0);
    const H = this.horns;
    const P = this.hornPoly;
    for (let k = 0; k < this.hornN; k++) {
      const o = k * 10;
      // Broken horns snap between 45% and 80% of the way up; the first (biggest) one survives more.
      const broken = ind.hornBreak > 0.01 && (k > 0 || rng.float() < 0.6);
      const tb = broken ? 1 - ind.hornBreak * (0.2 + 0.35 * rng.float()) : 1;
      const ph = rng.float() * 6.28;
      const amp = ind.hornGnarl * ind.hornWidth * 0.16;
      let m = k * HORN_PTS * 2;
      // Edge 1: base A -> tip (quadratic through the first control), up to the break.
      for (let i = 0; i < 7; i++) {
        const t = (i / 6) * tb;
        const u = 1 - t;
        const x = u * u * H[o]! + 2 * u * t * H[o + 2]! + t * t * H[o + 4]!;
        const y = u * u * H[o + 1]! + 2 * u * t * H[o + 3]! + t * t * H[o + 5]!;
        const bump = amp * Math.sin(ph + t * 13) * (1 - t * 0.6);
        P[m++] = x + bump;
        P[m++] = y - bump * 0.6;
      }
      // Across the end: a jagged break, or the sharp tip.
      const ex1 = P[m - 2]!;
      const ey1 = P[m - 1]!;
      const t2 = 1 - tb;
      const u2 = 1 - t2;
      const ex2 = u2 * u2 * H[o + 4]! + 2 * u2 * t2 * H[o + 6]! + t2 * t2 * H[o + 8]!;
      const ey2 = u2 * u2 * H[o + 5]! + 2 * u2 * t2 * H[o + 7]! + t2 * t2 * H[o + 9]!;
      const jag = broken ? 0.35 + 0.3 * rng.float() : 0;
      const nx = -(ey2 - ey1);
      const ny = ex2 - ex1;
      P[m++] = ex1 + (ex2 - ex1) * 0.3 + nx * jag * 0.4;
      P[m++] = ey1 + (ey2 - ey1) * 0.3 + ny * jag * 0.4;
      P[m++] = ex1 + (ex2 - ex1) * 0.55 - nx * jag * 0.25;
      P[m++] = ey1 + (ey2 - ey1) * 0.55 - ny * jag * 0.25;
      P[m++] = ex1 + (ex2 - ex1) * 0.8 + nx * jag * 0.3;
      P[m++] = ey1 + (ey2 - ey1) * 0.8 + ny * jag * 0.3;
      // Edge 2: from the break down to base B.
      for (let i = 0; i < 7; i++) {
        const t = t2 + (i / 6) * (1 - t2);
        const u = 1 - t;
        const x = u * u * H[o + 4]! + 2 * u * t * H[o + 6]! + t * t * H[o + 8]!;
        const y = u * u * H[o + 5]! + 2 * u * t * H[o + 7]! + t * t * H[o + 9]!;
        const bump = amp * Math.sin(ph + 2.1 + (1 - t) * 11) * (0.4 + t * 0.6);
        P[m++] = x - bump;
        P[m++] = y + bump * 0.6;
      }
      // The hit test and bounds use the (broken) tip.
      H[o + 4] = (ex1 + ex2) * 0.5;
      H[o + 5] = (ey1 + ey2) * 0.5;
    }
  }

  /** A crown of stony spikes fanning up and back along the back of the skull (seeded, uneven). */
  private buildCrown(ind: Individual, C: number): void {
    const n = ind.crownLen > 0.01 ? Math.min(MAX_CROWN, ind.crownN | 0) : 0;
    this.crownN = n;
    if (n === 0) return;
    const rng = new Rng((ind.seed ^ 0xc70a3) >>> 0);
    const c = this.crown;
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      // Roots from the crown of the head back over the occiput and down the back of the skull.
      const rx = hx(0.36) + (XB + 0.02 - hx(0.36)) * t;
      const ry = -C * (0.98 - 0.62 * t * t);
      // Middle spikes longest; each leans further back than the one before.
      const len = ind.crownLen * (0.55 + 0.6 * Math.sin(Math.PI * (0.2 + 0.7 * t))) * (0.75 + 0.5 * rng.float());
      const a = -1.45 + 1.15 * t + (rng.float() - 0.5) * 0.35;
      const w = 0.05 + 0.04 * rng.float() + len * 0.24;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Stony: the tip skews to one side, the base is uneven.
      const skew = (rng.float() - 0.5) * 0.3 * len;
      c[k * 6] = rx - sa * w * (0.4 + 0.3 * rng.float()) - ca * w * 0.3;
      c[k * 6 + 1] = ry + ca * w * 0.5;
      c[k * 6 + 2] = rx + ca * len - sa * skew;
      c[k * 6 + 3] = ry + sa * len + ca * skew;
      c[k * 6 + 4] = rx + sa * w * 0.5 + ca * w * 0.2;
      c[k * 6 + 5] = ry - ca * w * (0.4 + 0.3 * rng.float());
    }
  }
}
