// The charges as vector art: lion rampant, sun in splendour, wyvern, stag, tower, crown, the M1
// sword, and (for M3) eagle displayed and crescent. Each is built once per (kind, rank, detail,
// level of detail) into Path2Ds in a 100-unit box centred on (0, 0), facing dexter (the viewer's
// left), and cached. Level of detail: 0 (banners, < ~30 px) bolder limbs and no small parts;
// 1 claws, tongue, tufts and spines; 2 engraved lines (eyes, ribs, masonry, feathers).
//
// Parts come in groups painted in order: each group strokes its outline, then fills, so the parts
// of one group merge into one silhouette while a later group (the near legs, the head) keeps its
// outline over an earlier one (the far legs, the tail).
import type { ChargeKind } from './coat';
import { blob, brush, curve, oval, poly } from './pen';

/** Group tints, resolved at draw time against the charge's tinctures. */
export const T_MAIN = 0;
/** The detail tincture (claws, tongue, antlers, windows); the main tincture before it's earned. */
export const T_DETAIL = 1;
/** The main tincture, shaded (far limbs, the far wing). */
export const T_SHADE = 2;
/** Always or (crowns on charges, the flame's heart). */
export const T_GOLD = 3;
/** Always gules (the tower's pennon, the royal crown's cap, flames). */
export const T_GULES = 4;
/** A dark opening (a door or window before the detail tincture). */
export const T_HOLE = 5;
/** The charge tincture's engraving color (lines only). */
export const T_LINE = 6;

export interface Group {
  tint: number;
  outline: boolean;
  paths: Path2D[];
}

export interface Engraving {
  path: Path2D;
  /** Stroke width in charge units (100 = the charge box). */
  width: number;
  tint: number;
  /** Clip the line to this silhouette (masonry inside a castle). */
  clip?: Path2D;
  /** ...and keep it out of these holes (a big rect plus the holes, clipped even-odd). */
  clipOut?: Path2D;
}

export interface ChargeArt {
  groups: Group[];
  lines: Engraving[];
  /** Visual bounds in charge units (for fitting into a region). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * Silhouette profile for fitting into a narrowing shield point: pairs (fy, fw) = at fraction fy
   * of the height (0 top, 1 bottom) the silhouette's half-width is fw x half the bounds' width.
   */
  profile: readonly number[];
}

class Art implements ChargeArt {
  groups: Group[] = [];
  lines: Engraving[] = [];
  profile: readonly number[] = [1, 1];
  constructor(
    readonly bold: number,
    readonly lod: number,
    public x0 = -50,
    public y0 = -50,
    public x1 = 50,
    public y1 = 50,
  ) {}

  group(tint: number, outline = true): Group {
    const g: Group = { tint, outline, paths: [] };
    this.groups.push(g);
    return g;
  }

  /** A fresh subpath container in group g. */
  p(g: Group): Path2D {
    const p = new Path2D();
    g.paths.push(p);
    return p;
  }

  /** A brush stroke as its own part of group g. */
  b(g: Group, pts: readonly number[], bold = this.bold): void {
    brush(this.p(g), pts, bold);
  }

  /** An engraved line (only at lod >= minLod). */
  line(width: number, minLod = 2, tint = T_LINE, clip?: Path2D, clipOut?: Path2D): Path2D | null {
    if (this.lod < minLod) return null;
    const path = new Path2D();
    const e: Engraving = { path, width, tint };
    if (clip) e.clip = clip;
    if (clipOut) e.clipOut = clipOut;
    this.lines.push(e);
    return path;
  }

  /** An engraved smooth curve (only at lod >= minLod). */
  curve(pts: readonly number[], width = 1.1, minLod = 2, tint = T_LINE): void {
    const l = this.line(width, minLod, tint);
    if (l) curve(l, pts);
  }

  bounds(x0: number, y0: number, x1: number, y1: number, profile: readonly number[] = [1, 1]): void {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    this.profile = profile;
  }
}

/** Three curved claws from a paw at (x, y) pointing along angle `a` (radians). */
function claws(art: Art, g: Group, x: number, y: number, a: number, len = 6, spread = 2.6): void {
  if (art.lod < 1) return;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  for (let k = -1; k <= 1; k++) {
    const bx = x + -dy * k * spread + dx * 1.2;
    const by = y + dx * k * spread + dy * 1.2;
    const aa = a + k * 0.34;
    const l = len * (k === 0 ? 1.08 : 0.92);
    const ex = bx + Math.cos(aa) * l;
    const ey = by + Math.sin(aa) * l;
    // Hooked: the midpoint bows out, the tip curls in.
    const mx = (bx + ex) / 2 - Math.sin(aa) * 1.1;
    const my = (by + ey) / 2 + Math.cos(aa) * 1.1;
    art.b(g, [bx, by, 1.5, mx, my, 1.05, ex, ey, 0], 1);
  }
}

/** A small open crown (three points, pearled) with its band centred at (x, y), width w, turned by rot. */
function circlet(art: Art, g: Group, x: number, y: number, w: number, rot = 0): void {
  const h = w * 0.62;
  const hw = w / 2;
  const pts = [
    -hw, h * 0.28,
    -hw * 1.1, -h * 0.66,
    -hw * 0.5, -h * 0.1,
    0, -h * 0.9,
    hw * 0.5, -h * 0.1,
    hw * 1.1, -h * 0.66,
    hw, h * 0.28,
  ];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(x + pts[i]! * c - pts[i + 1]! * s, y + pts[i]! * s + pts[i + 1]! * c);
  poly(art.p(g), out);
}

/** A flame-like tuft (three curling locks) at (x, y), leaning along angle a. */
function tuft(art: Art, g: Group, x: number, y: number, a: number, s = 1): void {
  for (let k = -1; k <= 1; k++) {
    const aa = a + k * 0.6;
    const l = (k === 0 ? 11 : 8) * s;
    const ex = x + Math.cos(aa) * l;
    const ey = y + Math.sin(aa) * l;
    const mx = x + Math.cos(aa + 0.3) * l * 0.55;
    const my = y + Math.sin(aa + 0.3) * l * 0.55;
    // The tip curls back toward the leaning side.
    const cx = ex + Math.cos(aa + 1.9) * 2.2 * s;
    const cy = ey + Math.sin(aa + 1.9) * 2.2 * s;
    art.b(g, [x, y, 1.3 * s, mx, my, 2.9 * s, ex, ey, 1.2 * s, cx, cy, 0]);
  }
}

// ---- lion rampant ----------------------------------------------------------------------------

function lion(art: Art, rank: number): void {
  art.bounds(-45, -52, 45, 49, [0.8, 0.56, 1, 0.45]);
  const lod1 = art.lod >= 1;
  // Far limbs, shaded: the lower foreleg reaching forward, the planted hind leg.
  const far = art.group(T_SHADE);
  art.b(far, [-6, -8, 6.8, -18, -1, 5.2, -28, -3, 3.9, -35, -7, 4]);
  art.b(far, [12, 20, 8.6, 18, 30, 6.2, 15, 39, 4.1, 9, 45, 3.5, 0, 46.5, 3.6]);
  if (lod1) {
    art.b(far, [-19, 0, 1.6, -18, 4.5, 1.2, -22, 7.5, 0]);
    art.b(far, [16, 40, 1.4, 20, 43, 0]);
  }
  const farClaw = art.group(T_DETAIL);
  claws(art, farClaw, -35.5, -7.5, Math.PI + 0.3);
  claws(art, farClaw, -1, 46.5, Math.PI + 0.05, 5.4, 2.4);

  // Tail: an S rising from the rump, curling over at the tuft; double-queued at rank 2.
  const tail = art.group(T_MAIN);
  art.b(tail, [13, 19, 3, 22, 16, 2.6, 28, 6, 2.3, 26, -6, 2.1, 28, -16, 1.9, 34, -22, 1.7]);
  tuft(art, tail, 34, -22, -1.05);
  if (rank >= 2) {
    art.b(tail, [26, -2, 2, 34, -6, 1.8, 39, -13, 1.6, 41, -21, 1.5]);
    tuft(art, tail, 41, -21, -1.45, 0.85);
  }

  // Body, the raised hind leg and the raised foreleg: one silhouette.
  const body = art.group(T_MAIN);
  art.b(body, [-12, -17, 10, -9, -7, 10.5, -3, 2, 7.6, 3, 8, 6.3, 9, 14, 8.6, 12, 20, 9.4, 11, 26, 6.5]);
  art.b(body, [9, 16, 9.6, 1, 22, 7.6, -5, 27, 5.2, -8, 33, 3.9, -15, 35, 3.5, -21, 34.5, 3.8]);
  art.b(body, [-10, -15, 8, -24, -13, 5, -33, -26, 3.5, -38, -34, 4]);
  if (lod1) {
    // Tufts at the elbow and hock.
    art.b(body, [-24, -12.5, 1.7, -23, -7.5, 1.3, -27, -4.5, 0]);
    art.b(body, [-7, 34, 1.5, -3, 38.5, 0]);
  }
  const nearClaw = art.group(T_DETAIL);
  claws(art, nearClaw, -38.5, -34.5, Math.PI + 0.85);
  claws(art, nearClaw, -22, 34.5, Math.PI - 0.05);

  // Head and mane: curling locks cascading from the crown of the head down the neck.
  const head = art.group(T_MAIN);
  art.b(head, [-9, -44, 3.6, -3, -49.5, 3.3, 4, -50.5, 1.9, 7, -46.5, 0]);
  art.b(head, [-4, -40, 4.3, 4, -44, 3.5, 11, -42.5, 1.9, 13, -38, 0]);
  art.b(head, [-2, -34, 4.5, 7, -35, 3.7, 13, -31.5, 1.9, 14, -26.5, 0]);
  art.b(head, [-2, -28, 4.5, 6, -25.5, 3.7, 10, -20.5, 1.9, 9, -15.5, 0]);
  art.b(head, [-5, -23, 4.3, -1, -17, 3.5, -1, -11, 1.9, -5, -8, 0]);
  art.b(head, [-11, -21, 3.9, -11, -14, 3.1, -14, -9, 1.7, -18, -8, 0]);
  art.b(head, [-17, -21.5, 3.1, -19.5, -16.5, 2.5, -23, -13.5, 1.4, -26, -14.5, 0]);
  blob(art.p(head), [-5, -45, -13, -45.5, -20, -42.5, -25, -37.5, -28.2, -34.2, -27.6, -31.4, -24, -30.6, -17.5, -29.4, -24.2, -27.2, -23.4, -24.6, -19, -22.2, -11, -22, -2, -27, 0, -37]);
  art.b(head, [-7, -43, 2.9, -5.5, -48.5, 0]);
  const tongue = art.group(T_DETAIL);
  art.b(tongue, [-18.5, -28.7, 1.8, -23.5, -28.2, 1.7, -27.5, -29, 1.4, -29.6, -31, 1, -29.4, -33.8, 0], Math.max(1, art.bold * 0.9));
  art.curve([-17.5, -29.4, -21.5, -29.9, -25, -30.8], 0.9);
  if (rank >= 1) circlet(art, art.group(T_GOLD), -10.5, -48, 12.5, -0.12);

  // Engraving: eye and brow, nostril, teeth line, shoulder, ribs, haunch, mane partings.
  art.curve([-20.5, -38.2, -17.5, -39.8, -14.5, -38.6], 1.5, 1);
  art.curve([-22, -41, -17, -42.6, -12, -41.4], 1);
  art.curve([-26.2, -35.4, -24.6, -34.4], 1);
  art.curve([-6, -12, -12, -6, -18, -7]);
  art.curve([-5, -3, -1, -1.5]);
  art.curve([-3, 2, 1, 4]);
  art.curve([0, 7, 4, 9.5]);
  art.curve([6, 13, 1, 19, -4, 21]);
  art.curve([13, 24, 17, 30]);
  art.curve([-3, -38, 3, -38.5, 8, -40]);
  art.curve([-1, -31, 5, -30.5, 10, -32]);
  art.curve([-2, -25, 3, -22.5, 6, -19]);
}

// ---- wyvern ----------------------------------------------------------------------------------

function wing(art: Art, g: Group, sx: number, sy: number, wx: number, wy: number, tips: readonly number[]): void {
  // Membrane: shoulder -> wrist -> tip, scalloped between finger tips, back to the flank.
  const p = art.p(g);
  p.moveTo(sx, sy);
  p.quadraticCurveTo((sx + wx) / 2 - 3, (sy + wy) / 2, wx, wy);
  let px = tips[0]!;
  let py = tips[1]!;
  p.lineTo(px, py);
  for (let i = 2; i < tips.length; i += 2) {
    const nx = tips[i]!;
    const ny = tips[i + 1]!;
    // Concave scallop: the control point pulled toward the wrist.
    const cx = (px + nx) / 2 + (wx - (px + nx) / 2) * 0.3;
    const cy = (py + ny) / 2 + (wy - (py + ny) / 2) * 0.3;
    p.quadraticCurveTo(cx, cy, nx, ny);
    px = nx;
    py = ny;
  }
  p.closePath();
  // Arm and leading edge (thicker than the membrane), and the wrist's thumb claw.
  art.b(g, [sx, sy, 3.4, (sx + wx) / 2 - 2, (sy + wy) / 2, 3, wx, wy, 2.4]);
  art.b(g, [wx, wy, 2.4, (wx + tips[0]!) / 2, (wy + tips[1]!) / 2 - 1.5, 1.7, tips[0]!, tips[1]!, 0.3]);
  if (art.lod >= 1) art.b(g, [wx, wy, 1.5, wx - 3, wy - 6, 0]);
  // Finger bones, engraved.
  for (let i = 2; i < tips.length - 2; i += 2) art.curve([wx, wy, (wx + tips[i]!) / 2 + 1, (wy + tips[i + 1]!) / 2 - 1.5, tips[i]!, tips[i + 1]!], 1.1, 1);
}

function wyvern(art: Art, rank: number): void {
  art.bounds(rank >= 2 ? -56 : -40, -52, 47, 48, [0.8, 0.8, 1, 0.55]);
  // Far wing and far leg, shaded.
  const far = art.group(T_SHADE);
  wing(art, far, -3, -10, -4, -33, [4, -52, 16, -45, 20, -31, 9, -16]);
  art.b(far, [12, 11, 6.2, 17, 21, 4.6, 13, 30, 3.1, 15, 39, 2.7]);
  const farClaw = art.group(T_DETAIL);
  claws(art, farClaw, 15, 39.5, 0.55, 5, 2);
  // Near wing: raised high, spread wide.
  const nw = art.group(T_MAIN);
  wing(art, nw, 2, -6, 15, -32, [33, -51, 46, -36, 47, -17, 36, -1, 12, 4]);
  // Tail: sweeping back and curling, ending in a barb.
  const tail = art.group(T_MAIN);
  art.b(tail, [8, 14, 6.6, 18, 22, 5.2, 28, 26, 4, 36, 34, 3, 35, 43, 2.2, 26, 46.5, 1.7, 20, 42, 1.4]);
  const barb = art.group(T_DETAIL);
  arrowhead(art, barb, 20.5, 42.5, -2.3, 7);
  // Body, neck and near leg.
  const body = art.group(T_MAIN);
  art.b(body, [-7, -12, 6.8, -4, -2, 9.4, 3, 8, 9.8, 9, 15, 7.6]);
  art.b(body, [-7, -8, 6.4, -11, -18, 5.1, -13, -27, 4.3, -12, -34, 4.2]);
  art.b(body, [6, 8, 7.8, -2, 18, 5.7, 2, 28, 3.6, -2, 38, 3]);
  if (art.lod >= 1) {
    // Dorsal spines along the neck and back.
    const sp = art.p(body);
    const spines = [-8, -32, -6, -25, -4.5, -18, -1.5, -11, 4.5, -5];
    for (let i = 0; i < spines.length; i += 2) {
      const x = spines[i]!;
      const y = spines[i + 1]!;
      sp.moveTo(x - 1.2, y - 2.8);
      sp.lineTo(x + 5.5, y - 2.4);
      sp.lineTo(x + 0.6, y + 2.8);
      sp.closePath();
    }
  }
  const nearClaw = art.group(T_DETAIL);
  claws(art, nearClaw, -2.5, 38.5, Math.PI - 0.5, 5.5, 2.2);
  // Head: a long snout, open jaws, swept horns.
  const head = art.group(T_MAIN);
  blob(art.p(head), [-8, -38, -14, -42, -22, -41.4, -30, -39, -36.5, -37.4, -37.4, -34.6, -30, -34, -23.5, -33.4, -32, -31, -33.4, -29, -26, -27.6, -17, -29.4, -9, -32]);
  art.b(head, [-11, -40, 2.2, -5, -45.5, 1.4, 1.5, -48.5, 0]);
  art.b(head, [-15, -41.2, 1.7, -12, -47.5, 0]);
  if (rank < 2) {
    const tongue = art.group(T_DETAIL);
    art.b(tongue, [-24, -31.8, 1.35, -31, -31.9, 1.15, -37.5, -32.4, 0.7], Math.max(1, art.bold * 0.9));
    if (art.lod >= 1) arrowhead(art, tongue, -37.5, -32.4, Math.PI + 0.05, 3.8);
  } else {
    // Incensed: a jet of fire from the jaws (gules, with a golden heart).
    const fire = art.group(T_GULES);
    flame(art, fire, -35, -32.5, 1.25);
    const heart = art.group(T_GOLD, false);
    flame(art, heart, -36.5, -32.5, 0.7);
  }
  if (rank >= 1) circlet(art, art.group(T_GOLD), -17.5, -43.2, 10.5, -0.12);
  art.curve([-25, -38, -22.5, -39, -20.5, -37.8], 1.4, 1);
  art.curve([-7, -6, -5, 0, -1, 5]);
  for (let i = 0; i < 5; i++) art.curve([-11 + i * 1.6, -9 + i * 4.2, -6 + i * 1.6, -8 + i * 4.2]);
  art.curve([4, 12, 0, 18]);
}

/** A jet of flame from (x, y) streaming toward -x, scaled by s. */
function flame(art: Art, g: Group, x: number, y: number, s: number): void {
  art.b(g, [x, y, 1.6 * s, x - 6 * s, y - 1 * s, 4.6 * s, x - 12 * s, y + 0.6 * s, 4 * s, x - 17 * s, y - 2 * s, 1.6 * s, x - 20 * s, y - 5 * s, 0]);
  art.b(g, [x, y, 1.3 * s, x - 6 * s, y - 4.5 * s, 3.4 * s, x - 10 * s, y - 9.5 * s, 1.8 * s, x - 11 * s, y - 14 * s, 0]);
  art.b(g, [x, y + 0.5 * s, 1.3 * s, x - 6 * s, y + 4.5 * s, 3.2 * s, x - 11.5 * s, y + 7 * s, 1.5 * s, x - 15.5 * s, y + 5.5 * s, 0]);
  art.b(g, [x - 8 * s, y, 1 * s, x - 13 * s, y + 3.5 * s, 2.2 * s, x - 18 * s, y + 3 * s, 0]);
}

function arrowhead(art: Art, g: Group, x: number, y: number, a: number, s: number): void {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  poly(art.p(g), [
    x + dx * s, y + dy * s,
    x - dy * s * 0.55 - dx * s * 0.25, y + dx * s * 0.55 - dy * s * 0.25,
    x + dx * s * 0.12, y + dy * s * 0.12,
    x + dy * s * 0.55 - dx * s * 0.25, y - dx * s * 0.55 - dy * s * 0.25,
  ]);
}

// ---- eagle displayed (M3) --------------------------------------------------------------------

function eagle(art: Art, rank: number): void {
  art.bounds(-50, -52, 50, 44, [0.7, 0.55, 1, 0.3]);
  const wings = art.group(T_MAIN);
  for (const s of [-1, 1]) {
    // Overlapping primaries fanning up and out from the wing, and the coverts over their roots.
    const ox = 7 * s;
    const oy = -10;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = -1.38 + (i / (n - 1)) * 1.9;
      const ca = s > 0 ? Math.cos(a) : -Math.cos(a);
      const sa = Math.sin(a);
      const len = 44 - Math.abs(i - 2.5) * 2.2;
      const r0 = 13;
      art.b(wings, [ox + ca * r0, oy + sa * r0, 4.6, ox + ca * len * 0.66, oy + sa * len * 0.66, 4.2, ox + ca * len, oy + sa * len, 1.6]);
    }
    blob(art.p(wings), [s * 3, -18, s * 10, -30, s * 22, -33, s * 31, -24, s * 27, -10, s * 12, -3]);
  }
  const body = art.group(T_MAIN);
  art.b(body, [0, -22, 5.8, 0, -12, 9.4, 0, 2, 8.8, 0, 12, 5.6]);
  for (const s of [-1, 1]) art.b(body, [s * 4, 6, 3.8, s * 10, 14, 3, s * 14, 20, 2.4]);
  art.b(body, [0, 10, 4.2, -9, 24, 5, -14, 34, 1.4]);
  art.b(body, [0, 10, 4.2, 0, 26, 5, 0, 38, 1.4]);
  art.b(body, [0, 10, 4.2, 9, 24, 5, 14, 34, 1.4]);
  blob(art.p(body), [4, -33, -1, -36.5, -6, -34.5, -10, -31, -12.5, -29.5, -11.5, -27, -8, -27, -6, -24.5, -2, -22.5, 3, -24.5, 5, -29]);
  const armed = art.group(T_DETAIL);
  poly(art.p(armed), [-9, -31.5, -15.5, -30.4, -16, -26.4, -12.6, -28.2, -9, -27.6]);
  for (const s of [-1, 1]) claws(art, armed, s * 14, 20.5, Math.PI / 2 + s * 0.5, 5.5, 2.2);
  if (rank >= 1) circlet(art, art.group(T_GOLD), -1, -39, 11.5);
  art.curve([-6.5, -31.8, -4.5, -32.6, -2.8, -31.6], 1.3, 1);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) art.curve([s * (6 + i * 5), -24 + i * 1.5, s * (9 + i * 5), -17 + i * 2]);
}

// ---- stag ------------------------------------------------------------------------------------

function antler(art: Art, g: Group, x: number, y: number, dx: number, rank: number): void {
  // The beam sweeps up and back; tines rise from it (a royal stag at rank 2 carries more).
  art.b(g, [x, y, 2.3, x, y - 8, 2, x + 4 + dx, y - 16, 1.7, x + 10 + dx, y - 21, 1.3, x + 17 + dx, y - 22.5, 0.4]);
  art.b(g, [x, y - 5, 1.5, x - 5, y - 10, 1.1, x - 8, y - 15, 0]);
  art.b(g, [x + 2 + dx, y - 13, 1.4, x - 1 + dx, y - 20.5, 0]);
  art.b(g, [x + 7 + dx, y - 19.3, 1.3, x + 6 + dx, y - 26.5, 0]);
  if (rank >= 2) {
    art.b(g, [x + 12.5 + dx, y - 21.8, 1.1, x + 14 + dx, y - 28.5, 0]);
    art.b(g, [x - 2.5, y - 8.5, 1.1, x - 9, y - 7.5, 0]);
  }
}

/** A cloven hoof whose sole's centre is at (x, y), turned by rot (0 = standing, toe to -x). */
function hoofAt(art: Art, g: Group, x: number, y: number, rot = 0): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pts = [-2.1, -1.4, 2.1, -1.4, 2.4, 2.3, -3.3, 2.3];
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(x + pts[i]! * c - pts[i + 1]! * s, y + pts[i]! * s + pts[i + 1]! * c);
  poly(art.p(g), out);
}

function stag(art: Art, rank: number): void {
  art.bounds(-40, -51, 28, 45, [0.8, 0.7, 1, 0.62]);
  const lod1 = art.lod >= 1;
  // Trippant: the near foreleg raised, the others planted. Slender legs, pointed hooves.
  const far = art.group(T_SHADE);
  art.b(far, [-9, 9, 4.6, -9.5, 20, 2.7, -9, 30, 1.8, -8.5, 41, 1.6]);
  art.b(far, [5, 8, 5.8, 8, 20, 3.5, 4.5, 30, 2, 5, 41, 1.7]);
  const hoofFar = art.group(T_DETAIL);
  if (lod1) {
    hoofAt(art, hoofFar, -8.5, 41.2);
    hoofAt(art, hoofFar, 5, 41.2);
  }
  // The far antler sits behind the head.
  const farAnt = art.group(T_DETAIL);
  antler(art, farAnt, -21.5, -23, 4, rank);
  const body = art.group(T_MAIN);
  art.b(body, [-16, 4, 9.6, -6, 6, 10.2, 6, 5, 9.7, 15, 2, 9.6]);
  art.b(body, [-15, 9, 5.2, -21, 18, 3, -21.5, 25, 1.9, -18.5, 30, 1.7]);
  art.b(body, [11, 7, 7.8, 16, 19, 4.5, 12, 30, 2.1, 13, 41, 1.8]);
  art.b(body, [20, -2, 3.2, 24, -6, 2.1, 25.5, -9.5, 0]);
  art.b(body, [-15, 1, 8, -21, -8, 6.2, -24, -15, 5]);
  blob(art.p(body), [-20.5, -20.5, -26, -23.5, -31.5, -21.5, -36.5, -15.5, -39, -12.5, -36.5, -9.5, -30.5, -11, -25, -13.5, -20.5, -16]);
  art.b(body, [-22, -20, 2.8, -15, -25, 1.9, -10.5, -25, 0]);
  const hoof = art.group(T_DETAIL);
  if (lod1) {
    hoofAt(art, hoof, -17.6, 30.6, -0.9);
    hoofAt(art, hoof, 13, 41.2);
  }
  const ant = art.group(T_DETAIL);
  antler(art, ant, -26, -23.5, 0, rank);
  // Gorged with a coronet: a crown collar about the neck, its points toward the head.
  if (rank >= 1) circlet(art, art.group(T_GOLD), -19.5, -5.5, 14.5, -0.5);
  art.curve([-31, -17.5, -29.2, -18.6, -27.5, -17.8], 1.3, 1);
  art.curve([-37.4, -12.2, -36.2, -11.4], 1);
  art.curve([-19, -2, -13, 1, -8, 0]);
  art.curve([5, 0, 9, 5, 11, 11]);
  art.curve([-10, 13, -2, 14.5, 6, 13]);
}

// ---- sun in splendour ------------------------------------------------------------------------

function sun(art: Art, rank: number, face: boolean): void {
  art.bounds(-48, -48, 48, 48, [0.75, 0.75, 0.88, 0.45, 1, 0.1]);
  const rays = art.group(T_MAIN);
  const n = rank >= 2 ? 24 : 16;
  const disc = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const straight = i % 2 === 0;
    if (straight) {
      const w = rank >= 2 ? 0.1 : 0.14;
      poly(art.p(rays), [
        Math.cos(a - w) * (disc - 2), Math.sin(a - w) * (disc - 2),
        ca * 47.5, sa * 47.5,
        Math.cos(a + w) * (disc - 2), Math.sin(a + w) * (disc - 2),
      ]);
    } else if (rank >= 1) {
      // Wavy flame rays.
      const pts: number[] = [];
      const r0 = disc - 3;
      const r1 = rank >= 2 ? 40 : 43;
      for (let k = 0; k <= 4; k++) {
        const r = r0 + ((r1 - r0) * k) / 4;
        const off = Math.sin(k * 1.9) * 2.8 * (k / 4 + 0.3);
        const w = 3.6 * (1 - k / 4) + 0.1;
        pts.push(ca * r - sa * off, sa * r + ca * off, k === 4 ? 0 : w);
      }
      art.b(rays, pts);
    } else {
      const w = 0.12;
      poly(art.p(rays), [
        Math.cos(a - w) * (disc - 2), Math.sin(a - w) * (disc - 2),
        ca * 39, sa * 39,
        Math.cos(a + w) * (disc - 2), Math.sin(a + w) * (disc - 2),
      ]);
    }
  }
  const d = art.group(T_MAIN);
  oval(art.p(d), 0, 0, disc, disc);
  const ring = art.line(1.1, 1);
  if (ring) {
    ring.moveTo(disc - 3, 0);
    ring.arc(0, 0, disc - 3, 0, Math.PI * 2);
  }
  if (face && art.lod >= 2) {
    // The sun's face (in splendour): brows, eyes, nose, a calm mouth.
    art.curve([-10.5, -7, -7, -9, -3, -7.5], 1.1);
    art.curve([10.5, -7, 7, -9, 3, -7.5], 1.1);
    art.curve([-10, -3.8, -7, -5.2, -4, -3.8], 1.35);
    art.curve([10, -3.8, 7, -5.2, 4, -3.8], 1.35);
    art.curve([0, -5.5, 1.3, 1.5, -1.3, 3.2], 1.1);
    const lips = art.group(T_DETAIL, false);
    blob(art.p(lips), [-5.4, 7.6, 0, 6.6, 5.4, 7.6, 0, 10.2]);
    art.curve([-5.4, 7.6, 0, 8.3, 5.4, 7.6], 0.9);
  }
}

// ---- tower / castle --------------------------------------------------------------------------

/** Crenellations from x0 to x1 (left to right): n merlons, with embrasures `drop` deep. */
function merlons(pts: number[], x0: number, x1: number, top: number, drop: number, n: number): void {
  const w = (x1 - x0) / (n * 2 - 1);
  for (let i = 0; i < n; i++) {
    const a = x0 + i * 2 * w;
    pts.push(a, top, a + w, top);
    if (i < n - 1) pts.push(a + w, top + drop, a + 2 * w, top + drop);
  }
}

/** A crenellated turret: body x0..x1 from `top` down to `bottom`, a corbelled parapet. */
function turret(x0: number, x1: number, top: number, bottom: number, n: number, drop: number): number[] {
  const o = (x1 - x0) * 0.1;
  const pts: number[] = [x0, bottom, x0, top + drop + 6, x0 - o, top + drop + 3];
  merlons(pts, x0 - o, x1 + o, top, drop, n);
  pts.push(x1 + o, top + drop + 3, x1, top + drop + 6, x1, bottom);
  return pts;
}

function tower(art: Art, rank: number, detail: boolean): void {
  // Openings show dark until the detail tincture lights them (lit windows, a golden gate).
  const openings: Group = { tint: detail ? T_DETAIL : T_HOLE, outline: false, paths: [] };
  const sil = new Path2D();
  const holes = new Path2D();
  holes.rect(-200, -200, 400, 400);
  const o = new Path2D();
  openings.paths.push(o);
  if (rank >= 2) {
    // Castle triple-towered: a curtain wall, two side towers and a taller keep.
    art.bounds(-35, -46, 35, 46);
    const g = art.group(T_MAIN);
    const wall: number[] = [-22, 46];
    merlons(wall, -22, 22, 2, 4.5, 5);
    wall.push(22, 46);
    const parts = [wall, turret(-33, -19, -18, 46, 3, 5), turret(19, 33, -18, 46, 3, 5), turret(-10, 10, -40, 6, 3, 6)];
    // A battered plinth under everything.
    parts.push([-36, 46, -34, 40, 34, 40, 36, 46]);
    for (const pts of parts) {
      poly(art.p(g), pts);
      poly(sil, pts);
    }
    for (const h of [o, holes]) {
      arch(h, 0, 46, 6.2, 16);
      arch(h, -26, 8, 2.1, 9);
      arch(h, 26, 8, 2.1, 9);
      arch(h, 0, -14, 2.4, 10);
    }
    art.groups.push(openings);
    courses(art, sil, holes, -37, 37, -40, 46);
  } else {
    art.bounds(-22, rank >= 1 ? -52 : -44, 22, 46);
    const g = art.group(T_MAIN);
    const pts = turret(-14, 14, -40, 40, 4, 7);
    const plinth = [-19, 46, -18, 40, 18, 40, 19, 46];
    poly(art.p(g), pts);
    poly(art.p(g), plinth);
    poly(sil, pts);
    poly(sil, plinth);
    for (const h of [o, holes]) {
      arch(h, 0, 46, 6, 16);
      arch(h, -6.5, 8, 1.9, 10);
      arch(h, 6.5, 8, 1.9, 10);
      arch(h, 0, -12, 2.1, 10);
    }
    art.groups.push(openings);
    courses(art, sil, holes, -20, 20, -30, 46);
    if (rank >= 1) {
      // A pennon flies from the battlements.
      const pole = art.group(T_MAIN);
      art.b(pole, [3, -39, 1.1, 3, -52, 0.9], 1);
      const pen = art.group(T_GULES);
      const p = art.p(pen);
      p.moveTo(3, -52);
      p.quadraticCurveTo(-6, -51, -17, -48);
      p.quadraticCurveTo(-7, -46.5, 3, -44.5);
      p.closePath();
    }
  }
}

/** An arched opening (door or window) whose sill is at (x, y), half-width w, height h. */
function arch(p: Path2D, x: number, y: number, w: number, h: number): void {
  p.moveTo(x - w, y);
  p.lineTo(x - w, y - h + w);
  p.arc(x, y - h + w, w, Math.PI, 0);
  p.lineTo(x + w, y);
  p.closePath();
}

/** Masonry courses (engraved), clipped to the silhouette. */
function courses(art: Art, clip: Path2D, holes: Path2D, x0: number, x1: number, y0: number, y1: number): void {
  const l = art.line(0.75, 2, T_LINE, clip, holes);
  if (!l) return;
  let row = 0;
  for (let y = y0 + 6; y < y1 - 1; y += 6, row++) {
    l.moveTo(x0, y);
    l.lineTo(x1, y);
    for (let x = x0 + (row % 2 ? 4 : 8); x < x1 - 1; x += 8) {
      l.moveTo(x, y);
      l.lineTo(x, Math.min(y1, y + 6));
    }
  }
}

// ---- crown -----------------------------------------------------------------------------------

function crown(art: Art, rank: number, detail: boolean): void {
  if (rank >= 2) {
    // The royal crown: a crimson cap under two gilt arches, an orb and cross above.
    art.bounds(-32, -50, 32, 22, [1, 1]);
    const cap = art.group(T_GULES);
    blob(art.p(cap), [-23, 6, -20, -10, -10, -20, 0, -22, 10, -20, 20, -10, 23, 6]);
    const arches = art.group(T_MAIN);
    art.b(arches, [-25, 4, 2.1, -23, -12, 1.9, -13, -24, 1.7, 0, -27.5, 1.7]);
    art.b(arches, [25, 4, 2.1, 23, -12, 1.9, 13, -24, 1.7, 0, -27.5, 1.7]);
    art.b(arches, [0, 4, 1.9, 0, -12, 1.7, 0, -27.5, 1.7]);
    oval(art.p(arches), 0, -33, 5.2, 5.2);
    art.b(arches, [0, -37.5, 1.6, 0, -48, 1.6]);
    art.b(arches, [-4.8, -43.5, 1.5, 4.8, -43.5, 1.5]);
    if (art.lod >= 1) {
      const pearls = art.group(T_GOLD);
      for (let i = 0; i < 5; i++) {
        const t = (i + 1) / 6;
        oval(art.p(pearls), -25 + t * 25 + Math.sin(t * Math.PI) * -2, 4 - t * 31 + Math.sin(t * Math.PI) * -6, 1.5, 1.5);
        oval(art.p(pearls), 25 - t * 25 - Math.sin(t * Math.PI) * -2, 4 - t * 31 + Math.sin(t * Math.PI) * -6, 1.5, 1.5);
      }
    }
  } else if (rank === 1) {
    art.bounds(-32, -25, 32, 22, [1, 1]);
  } else {
    art.bounds(-32, -26, 32, 22, [1, 1]);
  }
  const g = art.group(T_MAIN);
  const band = art.p(g);
  band.moveTo(-30, 4);
  band.quadraticCurveTo(0, 9, 30, 4);
  band.lineTo(30, 18);
  band.quadraticCurveTo(0, 23, -30, 18);
  band.closePath();
  if (rank === 0) {
    // An antique crown: five sharp rays, pearled.
    const p = art.p(g);
    const xs = [-26, -13, 0, 13, 26];
    p.moveTo(-30, 6);
    for (const x of xs) {
      const base = 6 + (1 - (x / 30) ** 2) * 1.5;
      p.lineTo(x - 5, base);
      p.lineTo(x, x === 0 ? -20 : -14);
      p.lineTo(x + 5, base);
    }
    p.lineTo(30, 6);
    p.closePath();
    if (art.lod >= 1) for (const x of xs) oval(art.p(g), x, x === 0 ? -21.5 : -15.5, 2.7, 2.7);
  } else {
    // Fleurons (strawberry leaves) between pearled points.
    for (const x of [-22, 0, 22]) fleuron(art, g, x, 6, x === 0 ? 1.15 : 1);
    for (const x of [-11, 11]) {
      art.b(g, [x, 6, 1.7, x, -3, 1.3]);
      oval(art.p(g), x, -5, 2.5, 2.5);
    }
  }
  const gems = art.group(T_DETAIL);
  if (detail && art.lod >= 1) {
    oval(art.p(gems), 0, 12.8, 3.8, 3);
    oval(art.p(gems), -18, 12, 2.9, 2.4);
    oval(art.p(gems), 18, 12, 2.9, 2.4);
  }
  art.curve([-30, 7.5, 0, 12.5, 30, 7.5], 0.8);
  art.curve([-30, 15, 0, 19.5, 30, 15], 0.8);
}

/** A strawberry-leaf fleuron standing on the band at (x, y). */
function fleuron(art: Art, g: Group, x: number, y: number, s: number): void {
  art.b(g, [x, y + 1, 2.4 * s, x, y - 8 * s, 3.3 * s, x, y - 17 * s, 0]);
  art.b(g, [x, y - 2, 1.4 * s, x - 5 * s, y - 7 * s, 2.4 * s, x - 9 * s, y - 13 * s, 0]);
  art.b(g, [x, y - 2, 1.4 * s, x + 5 * s, y - 7 * s, 2.4 * s, x + 9 * s, y - 13 * s, 0]);
}

// ---- sword (M1) ------------------------------------------------------------------------------

function sword(art: Art): void {
  art.bounds(-24, -48, 24, 46, [0.3, 0.9, 0.6, 0.2, 1, 0.1]);
  const blade = art.group(T_MAIN);
  poly(art.p(blade), [-4.6, -18, 4.6, -18, 3.9, 32, 0, 45.5, -3.9, 32]);
  const hilt = art.group(T_DETAIL);
  art.b(hilt, [-22, -18.5, 2.7, -11, -20.5, 3.2, 0, -21, 3.4, 11, -20.5, 3.2, 22, -18.5, 2.7]);
  if (art.lod >= 1) {
    oval(art.p(hilt), -22.5, -18.3, 3, 3);
    oval(art.p(hilt), 22.5, -18.3, 3, 3);
  }
  art.b(hilt, [0, -38, 2.8, 0, -30, 3.2, 0, -23, 2.9]);
  oval(art.p(hilt), 0, -42, 5.4, 5.4);
  art.curve([0, -16, 0, 31], 1.2);
  art.curve([-2.8, -36, 2.8, -34], 0.8);
  art.curve([-2.8, -31, 2.8, -29], 0.8);
  art.curve([-2.8, -26, 2.8, -24], 0.8);
}

// ---- crescent (M3) ---------------------------------------------------------------------------

function moon(art: Art): void {
  art.bounds(-32, -36, 32, 38, [0.6, 1, 0.85, 0.72, 1, 0.3]);
  const g = art.group(T_MAIN);
  // Increscent-up crescent: the outer circle minus an offset inner one, traced along both arcs.
  const R = 32;
  const oy = 5;
  const r = 26;
  const iy = -6;
  const d = oy - iy;
  const yI = (R * R - r * r - (oy * oy - iy * iy)) / (-2 * d);
  const xI = Math.sqrt(Math.max(0, R * R - (yI - oy) ** 2));
  const aR = Math.atan2(yI - oy, xI);
  const aL = Math.atan2(yI - oy, -xI);
  const bR = Math.atan2(yI - iy, xI);
  const bL = Math.atan2(yI - iy, -xI);
  const p = art.p(g);
  p.moveTo(xI, yI);
  p.arc(0, oy, R, aR, aL + (aL < aR ? Math.PI * 2 : 0), false);
  p.arc(0, iy, r, bL, bR, true);
  p.closePath();
  art.curve([-24, 10, -12, 20, 0, 23, 12, 20, 24, 10], 0.9);
}

// ---- cache -----------------------------------------------------------------------------------

const cache = new Map<string, ChargeArt>();

/** The art for a charge (cached). `detail`: whether the detail tincture applies (faces, windows, gems). */
export function chargeArt(kind: ChargeKind, rank: number, detail: boolean, lod: number): ChargeArt {
  const key = kind + rank + (detail ? 'd' : '') + lod;
  let a = cache.get(key);
  if (a) return a;
  const art = new Art(lod === 0 ? 1.4 : lod === 1 ? 1.12 : 1, lod);
  switch (kind) {
    case 'lion': lion(art, rank); break;
    case 'wyvern': wyvern(art, rank); break;
    case 'eagle': eagle(art, rank); break;
    case 'stag': stag(art, rank); break;
    case 'sun': sun(art, rank, detail); break;
    case 'tower': tower(art, rank, detail); break;
    case 'crown': crown(art, rank, detail); break;
    case 'sword': sword(art); break;
    case 'moon': moon(art); break;
  }
  a = art;
  cache.set(key, a);
  return a;
}
