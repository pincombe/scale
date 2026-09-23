// The lancer's destrier: a caparisoned warhorse drawn as one silhouette in figure units (a knight is
// 100 tall; feet on y = 0, facing +x), posed by the Pose's mount fields: a gait phase and blend
// (standing .. full gallop), rearing, and a head dip. Legs are two-bone IK chains whose hooves
// follow a rotary gallop (hinds, then fores, a moment of suspension), the body bobs and pitches
// with the stride, the tail streams and the caparison's dagged hem flutters.
//
// The rider (rig.ts kind 'rider') is posed on the saddle by the lancer animations (anims.ts), from
// horseSaddle(); the lance and its pennon are drawn live (lance.ts), from the rider's far fist.
import type { Pose } from './rig';

const TAU = Math.PI * 2;

/** Leg geometry (figure units, horse-local, before the body transform). */
const FORE_X = 27;
const FORE_Y = -50;
const HIND_X = -33;
const HIND_Y = -52;
const FORE_L1 = 26;
const FORE_L2 = 28;
const HIND_L1 = 26;
const HIND_L2 = 30;
/** Half the hoof sweep during a stance (figure units), and swing lift for fores / hinds. */
const STRIDE = 25;
const LIFT_F = 27;
const LIFT_H = 18;
/** Fraction of the cycle each hoof spends on the ground. */
const DUTY = 0.38;
/** Rotary gallop: hind near, hind far, fore near, fore far. */
const LEG_OFF = [0.0, 0.09, 0.44, 0.53] as const;
/** Where the saddle seat and stirrup sit (horse-local). */
const SEAT_X = -3;
const SEAT_Y = -84;
const STIR_X = 5;
const STIR_Y = -47;

// The body transform (affine, horse-local -> figure): gallop pitch about the barrel, rearing about
// the hind hooves, then the stride's bob. Written by setBody().
const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
// Neck/head transform on top of the body (rotation about the withers).
const N = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const P = { x: 0, y: 0 };

function setBody(p: Pose): void {
  const g = p.mGait;
  const ph = p.mPhase * TAU;
  const r = p.mRear;
  // Gallop pitch about the barrel's middle (0, -60): the forehand rises as the hinds drive.
  const ga = g * 0.065 * Math.sin(ph + 0.4);
  // Rearing: rotate about the hind hooves (-30, 0); negative = nose up.
  const ra = -r * 0.56;
  const bob = -g * 3.2 * Math.sin(ph * 1 + 1.3) - r * 2;
  // R_rear(pivot) * R_gallop(center)
  const c1 = Math.cos(ga);
  const s1 = Math.sin(ga);
  // Gallop about (0,-60): x' = c1 x - s1 (y+60); y' = s1 x + c1 (y+60) - 60
  const a1 = c1;
  const b1 = s1;
  const cc1 = -s1;
  const d1 = c1;
  const e1 = -s1 * 60;
  const f1 = c1 * 60 - 60;
  const c2 = Math.cos(ra);
  const s2 = Math.sin(ra);
  const px = -30;
  const py = 0;
  // Rear about (px,py): x'' = c2 (x'-px) - s2 (y'-py) + px; y'' = s2 (x'-px) + c2 (y'-py) + py
  M.a = c2 * a1 - s2 * b1;
  M.b = s2 * a1 + c2 * b1;
  M.c = c2 * cc1 - s2 * d1;
  M.d = s2 * cc1 + c2 * d1;
  M.e = c2 * (e1 - px) - s2 * (f1 - py) + px;
  M.f = s2 * (e1 - px) + c2 * (f1 - py) + py + bob;
  // Neck and head: the head reaches forward with each stride, lifts when rearing, dips at rest.
  const na = p.mHead + g * 0.09 * Math.sin(ph + 2.2) - r * 0.12;
  const cn = Math.cos(na);
  const sn = Math.sin(na);
  const wx = 20;
  const wy = -76;
  N.a = cn;
  N.b = sn;
  N.c = -sn;
  N.d = cn;
  N.e = wx - cn * wx + sn * wy;
  N.f = wy - sn * wx - cn * wy;
}

/** Body point (horse-local) -> figure units, into P. */
function tp(x: number, y: number): void {
  P.x = M.a * x + M.c * y + M.e;
  P.y = M.b * x + M.d * y + M.f;
}

/** Neck/head point (horse-local) -> figure units, into P. */
function tn(x: number, y: number): void {
  const nx = N.a * x + N.c * y + N.e;
  const ny = N.b * x + N.d * y + N.f;
  tp(nx, ny);
}

function moveB(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  tp(x, y);
  ctx.moveTo(P.x, P.y);
}
function lineB(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  tp(x, y);
  ctx.lineTo(P.x, P.y);
}
function quadB(ctx: CanvasRenderingContext2D, cx: number, cy: number, x: number, y: number): void {
  tp(cx, cy);
  const qx = P.x;
  const qy = P.y;
  tp(x, y);
  ctx.quadraticCurveTo(qx, qy, P.x, P.y);
}
function moveN(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  tn(x, y);
  ctx.moveTo(P.x, P.y);
}
function lineN(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  tn(x, y);
  ctx.lineTo(P.x, P.y);
}
function quadN(ctx: CanvasRenderingContext2D, cx: number, cy: number, x: number, y: number): void {
  tn(cx, cy);
  const qx = P.x;
  const qy = P.y;
  tn(x, y);
  ctx.quadraticCurveTo(qx, qy, P.x, P.y);
}

// Two-bone IK (own copy: rig.ts imports this module).
const K = { jx: 0, jy: 0, ex: 0, ey: 0 };
function ik2(ax: number, ay: number, tx: number, ty: number, l1: number, l2: number, bend: number): void {
  const dx = tx - ax;
  const dy = ty - ay;
  let d = Math.sqrt(dx * dx + dy * dy);
  const a = d < 1e-6 ? Math.PI / 2 : Math.atan2(dy, dx);
  const maxD = l1 + l2 - 0.01;
  const minD = Math.abs(l1 - l2) + 0.5;
  if (d > maxD) d = maxD;
  if (d < minD) d = minD;
  let c = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  if (c > 1) c = 1;
  if (c < -1) c = -1;
  const ja = a + bend * Math.acos(c);
  K.jx = ax + Math.cos(ja) * l1;
  K.jy = ay + Math.sin(ja) * l1;
  K.ex = ax + Math.cos(a) * d;
  K.ey = ay + Math.sin(a) * d;
}

/** Hoof target for leg i (0,1 hind; 2,3 fore), relative to its pivot's figure x; writes P. */
function hoof(p: Pose, i: number, pivX: number): void {
  const fore = i >= 2;
  const g = p.mGait;
  // Standing: square under the body, the far pair a touch behind.
  const sx = pivX + (i & 1 ? -3 : 3) + (fore ? 1 : 4);
  let gx = sx;
  let gy = 0;
  if (g > 0) {
    let u = p.mPhase - LEG_OFF[i]!;
    u -= Math.floor(u);
    if (u < DUTY) {
      gx = pivX + STRIDE * (1 - (2 * u) / DUTY) + (fore ? 4 : 0);
      gy = 0;
    } else {
      const s = (u - DUTY) / (1 - DUTY);
      gx = pivX - STRIDE + 2 * STRIDE * (0.5 - 0.5 * Math.cos(Math.PI * s)) + (fore ? 4 : 0);
      gy = -(fore ? LIFT_F : LIFT_H) * Math.sin(Math.PI * s);
      // Fores fold tight under the chest at the top of the swing.
      if (fore) gx -= 10 * Math.sin(Math.PI * s);
    }
  }
  let x = sx + (gx - sx) * g;
  let y = gy * g;
  const r = p.mRear;
  if (r > 0) {
    if (fore) {
      // Pawing the air in front of the chest: one foreleg reaching, one folded.
      tp(i === 2 ? FORE_X + 40 : FORE_X + 30, i === 2 ? FORE_Y + 8 : FORE_Y + 34);
      x += (P.x - x) * r;
      y += (P.y - y) * r;
    } else {
      // Planted under the haunches.
      const hx = pivX + (i & 1 ? 10 : 22);
      x += (hx - x) * r;
      y += (0 - y) * r;
    }
  }
  P.x = x;
  P.y = y;
}

function limbL(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number): void {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function drawLeg(ctx: CanvasRenderingContext2D, p: Pose, i: number, minW: number): void {
  const fore = i >= 2;
  tp(fore ? FORE_X - (i & 1) * 3 : HIND_X - (i & 1) * 3, fore ? FORE_Y : HIND_Y);
  const ax = P.x;
  const ay = P.y;
  hoof(p, i, ax);
  const tx = P.x;
  const ty = P.y;
  // Fores: the knee points forward; hinds: the hock points back.
  ik2(ax, ay, tx, ty, fore ? FORE_L1 : HIND_L1, fore ? FORE_L2 : HIND_L2, fore ? -1 : 1);
  const lw = Math.max(6.4, minW * 1.1);
  limbL(ctx, ax, ay, K.jx, K.jy, fore ? 12 : 15);
  // Taper: a thick forearm / gaskin into the joint, then the slim cannon.
  limbL(ctx, K.jx + (ax - K.jx) * 0.35, K.jy + (ay - K.jy) * 0.35, K.jx, K.jy, fore ? 10 : 11);
  limbL(ctx, K.jx, K.jy, K.ex, K.ey, lw);
  // Fetlock and hoof: a wedge angled along the cannon.
  let dx = K.ex - K.jx;
  let dy = K.ey - K.jy;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= l;
  dy /= l;
  const hx = K.ex;
  const hy = K.ey;
  ctx.beginPath();
  ctx.moveTo(hx - dx * 7 - dy * 3.6, hy - dy * 7 + dx * 3.6);
  ctx.lineTo(hx - dx * 7 + dy * 3.4, hy - dy * 7 - dx * 3.4);
  ctx.lineTo(hx + dx * 1.2 + dy * 5.5, hy + dy * 1.2 - dx * 5.5);
  ctx.lineTo(hx + dx * 1.2 - dy * 4.5, hy + dy * 1.2 + dx * 4.5);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw the horse as one silhouette with the current fill/stroke color (set both). Allocation-free.
 * The rider is drawn on top by the caller (rig.ts drawFigure, kind 'lancer').
 */
export function drawHorse(ctx: CanvasRenderingContext2D, p: Pose, minW: number): void {
  setBody(p);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Far legs, near legs (one color: order only matters for the rim pass, which is a union).
  for (let i = 0; i < 4; i++) drawLeg(ctx, p, i, minW);

  const g = p.mGait;
  const ph = p.mPhase * TAU;

  // Tail: streams back and up at the gallop, hangs and swishes at rest.
  const sw = Math.sin(ph * (g > 0.5 ? 1 : 0.5) + 0.8);
  tp(-50, -66);
  const t0x = P.x;
  const t0y = P.y;
  tp(-62 - 8 * g, -58 - 3 * g + 2 * sw);
  const t1x = P.x;
  const t1y = P.y;
  tp(-70 - 20 * g, -45 - 2 * g + 3 * sw * g);
  const t2x = P.x;
  const t2y = P.y;
  tp(-72 - 30 * g + 3 * sw * (1 - g), -30 - 10 * g - 5 * sw * g);
  const t3x = P.x;
  const t3y = P.y;
  limbL(ctx, t0x, t0y, t1x, t1y, 11);
  limbL(ctx, t1x, t1y, t2x, t2y, 9);
  limbL(ctx, t2x, t2y, t3x, t3y, Math.max(6, minW));
  ctx.beginPath();
  ctx.moveTo(t2x, t2y - 3);
  ctx.quadraticCurveTo(t3x + 2, t3y - 2, t3x - 4 * g - 2, t3y + 7);
  ctx.lineTo(t2x - 1, t2y + 4);
  ctx.closePath();
  ctx.fill();

  // Barrel: withers, a dip at the saddle, the rounded croup, belly, deep chest.
  ctx.beginPath();
  moveB(ctx, -48, -72);
  quadB(ctx, -34, -82, -14, -79);
  quadB(ctx, 6, -77, 20, -82);
  quadB(ctx, 44, -80, 46, -58);
  quadB(ctx, 44, -40, 26, -41);
  quadB(ctx, -6, -38, -36, -45);
  quadB(ctx, -58, -48, -56, -62);
  quadB(ctx, -55, -72, -48, -72);
  ctx.closePath();
  ctx.fill();

  // Caparison: a heavy cloth over the barrel to mid-leg, dagged along the hem, which trails and
  // ripples with the stride (it drapes lower at the chest and the rump, like cloth over a body).
  const trail = 6 * g;
  ctx.beginPath();
  moveB(ctx, -57, -64);
  quadB(ctx, -60 - trail * 0.5, -48, -58 - trail, -38);
  const dags = 7;
  const x0h = -58 - trail;
  const x1h = 47 - trail * 0.3;
  for (let k = 0; k < dags; k++) {
    const u0 = k / dags;
    const u1 = (k + 1) / dags;
    const xa = x0h + (x1h - x0h) * u0;
    const xb = x0h + (x1h - x0h) * u1;
    // The hem sags in the middle of each side (between the legs) and swings with the stride.
    const sagA = -38 + 6 * Math.sin(Math.PI * u0);
    const sagB = -38 + 6 * Math.sin(Math.PI * u1);
    const wv = g * 2.6 * Math.sin(ph * 2 - k * 1.3);
    quadB(ctx, (xa + xb) * 0.5, (sagA + sagB) * 0.5 + 7 + wv, xb, sagB + wv * 0.4);
  }
  quadB(ctx, 50, -48, 47, -64);
  lineB(ctx, 30, -80);
  ctx.closePath();
  ctx.fill();

  // Neck under a crinet: thick at the base, an arched crest up to the poll, the throat sweeping
  // back down to the chest.
  ctx.beginPath();
  moveN(ctx, 6, -80);
  quadN(ctx, 24, -112, 47, -119);
  lineN(ctx, 57, -110);
  quadN(ctx, 50, -92, 50, -60);
  lineN(ctx, 26, -58);
  ctx.closePath();
  ctx.fill();
  // Head: broad forehead, a long straight face, a soft muzzle, the jaw curving back to the throat.
  ctx.beginPath();
  moveN(ctx, 44, -118);
  quadN(ctx, 50, -123, 57, -119);
  lineN(ctx, 82, -98);
  quadN(ctx, 88, -93, 84, -87);
  quadN(ctx, 80, -83, 73, -86);
  lineN(ctx, 68, -88);
  quadN(ctx, 58, -91, 54, -101);
  lineN(ctx, 46, -104);
  ctx.closePath();
  ctx.fill();
  // Ears: two small leaves pricked forward.
  ctx.beginPath();
  moveN(ctx, 46, -118);
  quadN(ctx, 44, -126, 49, -131);
  quadN(ctx, 51, -124, 51, -119);
  moveN(ctx, 50, -120);
  quadN(ctx, 50, -128, 55, -132);
  quadN(ctx, 57, -124, 55, -119);
  ctx.fill();
  // Mane tufts along the crest (reads as hair at any size), streaming back at the gallop.
  ctx.beginPath();
  moveN(ctx, 10, -84);
  for (let k = 0; k < 4; k++) {
    const u = (k + 1) / 4;
    const bx = 10 + 36 * u;
    const by = -84 - 34 * u + 6 * u * u;
    const fl = 3 + g * 5 * (0.6 + 0.4 * Math.sin(ph * 2 - k));
    quadN(ctx, bx - 10 - fl, by - 3, bx, by);
  }
  lineN(ctx, 48, -112);
  lineN(ctx, 16, -78);
  ctx.closePath();
  ctx.fill();

  // Saddle: a high cantle behind the rider and a pommel before him.
  tp(-15, -80);
  const cx0 = P.x;
  const cy0 = P.y;
  tp(-19, -95);
  limbL(ctx, cx0, cy0, P.x, P.y, 6);
  tp(9, -81);
  const px0 = P.x;
  const py0 = P.y;
  tp(12, -91);
  limbL(ctx, px0, py0, P.x, P.y, 5);
}

/** The saddle seat, the stirrup and the body pitch for a mount pose (figure units). */
export function horseSaddle(p: Pose, out: { x: number; y: number; sx: number; sy: number; pitch: number }): void {
  setBody(p);
  tp(SEAT_X, SEAT_Y);
  out.x = P.x;
  out.y = P.y;
  tp(STIR_X, STIR_Y);
  out.sx = P.x;
  out.sy = P.y;
  out.pitch = Math.atan2(M.b, M.a);
}

/** Point on the horse: tip = the muzzle, launch = the chest (for dust and impacts). */
export function horseAnchors(p: Pose, out: { tipX: number; tipY: number; launchX: number; launchY: number }): void {
  setBody(p);
  tn(80, -90);
  out.tipX = P.x;
  out.tipY = P.y;
  tp(44, -54);
  out.launchX = P.x;
  out.launchY = P.y;
}

/** Grow bounds by every extreme of the horse (conservative). */
export function horseBounds(p: Pose, inc: (x: number, y: number, r: number) => void): void {
  setBody(p);
  const pts = BOUNDS_PTS;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 2] === 1) tn(pts[i]!, pts[i + 1]!);
    else tp(pts[i]!, pts[i + 1]!);
    inc(P.x, P.y, 6);
  }
  // Hooves.
  for (let i = 0; i < 4; i++) {
    const fore = i >= 2;
    tp(fore ? FORE_X : HIND_X, fore ? FORE_Y : HIND_Y);
    hoof(p, i, P.x);
    inc(P.x, P.y, 10);
  }
  // Tail tip at full stream.
  tp(-106, -44);
  inc(P.x, P.y, 8);
  tp(-76, -28);
  inc(P.x, P.y, 8);
}

/** x, y, space (0 body, 1 neck/head). */
const BOUNDS_PTS = [-60, -84, 0, 50, -84, 0, 50, -24, 0, -64, -24, 0, 90, -86, 1, 66, -124, 1, 50, -136, 1, -20, -98, 0];
