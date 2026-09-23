// Knight rig: a tiny 2D skeleton (pelvis, torso, head, two IK legs, two IK arms) posed by a flat
// Pose record and drawn as ONE silhouette (a union of shapes in a single color). Everything is in
// "figure units": feet on y = 0, the top of the helm at y ~ -100, facing +x. The sprite baker
// (sheets.ts) and the live hero (hero.ts) both draw through here, so every knight shares proportions.
//
// Proportions are deliberately chunky (big helms, broad pauldrons, long weapons) so the shapes still
// read when a knight is 15 px tall.
import { drawHorse, horseAnchors, horseBounds } from './horse';

/**
 * 'rider' is the lancer's knight alone (no sword: the lance is drawn live); 'lancer' is the whole
 * mounted figure (horse.ts + rider); 'aldric' and 'brunhild' are the champions (drawn live).
 */
export type FigureKind = 'foot' | 'bearer' | 'archer' | 'hero' | 'rider' | 'lancer' | 'aldric' | 'brunhild';

/** Knight height in figure units (feet to helm top). KNIGHT_HEIGHT m maps to this. */
export const FIG_UNITS = 100;

const THIGH = 25;
const SHIN = 24;
const UPPER_ARM = 18;
const FOREARM = 17;
const TORSO = 31;

/** Sword blade length by kind (figure units). */
export function bladeLength(kind: FigureKind): number {
  return kind === 'hero' ? 52 : kind === 'aldric' ? 50 : kind === 'brunhild' ? AXE_HAFT : 44;
}

/** Dame Brunhild's great axe: haft length ahead of the grip, and behind it (figure units). */
export const AXE_HAFT = 62;
const AXE_BUTT = 14;

/** A pose. Angles in radians; positions in figure units relative to the root (feet center). */
export class Pose {
  hipX = 0;
  hipY = -46;
  /** Torso tilt from vertical, + leans forward (toward +x). */
  lean = 0;
  /** Extra head tilt on top of the torso. */
  head = 0;
  aFootX = 8;
  aFootY = 0;
  bFootX = -7;
  bFootY = 0;
  /** Near hand: shield (foot, hero), pole (bearer), bow (archer). */
  nHandX = 11;
  nHandY = -60;
  /** Far hand: sword (foot, bearer, hero) or bowstring (archer). */
  fHandX = 4;
  fHandY = -56;
  /** Sword direction (screen angle: 0 = +x, -PI/2 = up). */
  weapon = -1.25;
  /** Shield tilt (0 = upright). */
  shield = 0;
  /** Bow tilt: equals the aim angle (0 = aiming level, bow upright). */
  bow = 0.12;
  /** Bowstring pull 0..1. */
  draw = 0;
  /** 1 = an arrow is on the string. */
  nock = 0;
  /** Banner pole direction (screen angle), bearers only. */
  pole = -Math.PI / 2;
  // ---- the lancer's horse (horse.ts); unused by the other kinds ----
  /** Gait cycle phase 0..1. */
  mPhase = 0;
  /** 0 = standing, 1 = full gallop. */
  mGait = 0;
  /** 0..1: rearing up on the hind legs. */
  mRear = 0;
  /** Head and neck dip (rad, + = lowered). */
  mHead = 0;
}

export function copyPose(out: Pose, a: Pose): Pose {
  out.hipX = a.hipX;
  out.hipY = a.hipY;
  out.lean = a.lean;
  out.head = a.head;
  out.aFootX = a.aFootX;
  out.aFootY = a.aFootY;
  out.bFootX = a.bFootX;
  out.bFootY = a.bFootY;
  out.nHandX = a.nHandX;
  out.nHandY = a.nHandY;
  out.fHandX = a.fHandX;
  out.fHandY = a.fHandY;
  out.weapon = a.weapon;
  out.shield = a.shield;
  out.bow = a.bow;
  out.draw = a.draw;
  out.nock = a.nock;
  out.pole = a.pole;
  out.mPhase = a.mPhase;
  out.mGait = a.mGait;
  out.mRear = a.mRear;
  out.mHead = a.mHead;
  return out;
}

/** out = a + (b - a) * t, field by field (angles lerp linearly: author them without wraps). */
export function lerpPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  out.hipX = a.hipX + (b.hipX - a.hipX) * t;
  out.hipY = a.hipY + (b.hipY - a.hipY) * t;
  out.lean = a.lean + (b.lean - a.lean) * t;
  out.head = a.head + (b.head - a.head) * t;
  out.aFootX = a.aFootX + (b.aFootX - a.aFootX) * t;
  out.aFootY = a.aFootY + (b.aFootY - a.aFootY) * t;
  out.bFootX = a.bFootX + (b.bFootX - a.bFootX) * t;
  out.bFootY = a.bFootY + (b.bFootY - a.bFootY) * t;
  out.nHandX = a.nHandX + (b.nHandX - a.nHandX) * t;
  out.nHandY = a.nHandY + (b.nHandY - a.nHandY) * t;
  out.fHandX = a.fHandX + (b.fHandX - a.fHandX) * t;
  out.fHandY = a.fHandY + (b.fHandY - a.fHandY) * t;
  out.weapon = a.weapon + (b.weapon - a.weapon) * t;
  out.shield = a.shield + (b.shield - a.shield) * t;
  out.bow = a.bow + (b.bow - a.bow) * t;
  out.draw = a.draw + (b.draw - a.draw) * t;
  out.pole = a.pole + (b.pole - a.pole) * t;
  out.mPhase = a.mPhase + (b.mPhase - a.mPhase) * t;
  out.mGait = a.mGait + (b.mGait - a.mGait) * t;
  out.mRear = a.mRear + (b.mRear - a.mRear) * t;
  out.mHead = a.mHead + (b.mHead - a.mHead) * t;
  out.nock = t < 0.5 ? a.nock : b.nock;
  return out;
}

/** Solved joint positions (figure units). Allocate once, reuse. */
export class Joints {
  hipX = 0;
  hipY = 0;
  /** Torso up and forward unit vectors. */
  upX = 0;
  upY = -1;
  fwX = 1;
  fwY = 0;
  neckX = 0;
  neckY = 0;
  headX = 0;
  headY = 0;
  /** Head rotation (0 = upright). */
  headA = 0;
  nShX = 0;
  nShY = 0;
  fShX = 0;
  fShY = 0;
  nElX = 0;
  nElY = 0;
  fElX = 0;
  fElY = 0;
  nHX = 0;
  nHY = 0;
  fHX = 0;
  fHY = 0;
  aHipX = 0;
  aHipY = 0;
  bHipX = 0;
  bHipY = 0;
  aKnX = 0;
  aKnY = 0;
  bKnX = 0;
  bKnY = 0;
  aFtX = 0;
  aFtY = 0;
  bFtX = 0;
  bFtY = 0;
}

export const ik = { jx: 0, jy: 0, ex: 0, ey: 0 };

/** Two-bone IK from (ax, ay) toward (tx, ty); bend +1 / -1 picks the joint side. Writes `ik`. */
export function solveIk(ax: number, ay: number, tx: number, ty: number, l1: number, l2: number, bend: number): void {
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
  ik.jx = ax + Math.cos(ja) * l1;
  ik.jy = ay + Math.sin(ja) * l1;
  ik.ex = ax + Math.cos(a) * d;
  ik.ey = ay + Math.sin(a) * d;
}

/** Forward + inverse kinematics: pose -> joints. Allocation-free. */
export function solve(p: Pose, j: Joints): Joints {
  const upX = Math.sin(p.lean);
  const upY = -Math.cos(p.lean);
  const fwX = -upY;
  const fwY = upX;
  j.upX = upX;
  j.upY = upY;
  j.fwX = fwX;
  j.fwY = fwY;
  j.hipX = p.hipX;
  j.hipY = p.hipY;
  j.neckX = p.hipX + upX * TORSO;
  j.neckY = p.hipY + upY * TORSO;
  j.headA = p.lean + p.head;
  j.headX = j.neckX + Math.sin(j.headA) * 11;
  j.headY = j.neckY - Math.cos(j.headA) * 11;
  const shX = p.hipX + upX * (TORSO - 4);
  const shY = p.hipY + upY * (TORSO - 4);
  j.nShX = shX - fwX * 2;
  j.nShY = shY - fwY * 2;
  j.fShX = shX + fwX * 3;
  j.fShY = shY + fwY * 3;

  solveIk(j.nShX, j.nShY, p.nHandX, p.nHandY, UPPER_ARM, FOREARM, 1);
  j.nElX = ik.jx;
  j.nElY = ik.jy;
  j.nHX = ik.ex;
  j.nHY = ik.ey;
  solveIk(j.fShX, j.fShY, p.fHandX, p.fHandY, UPPER_ARM, FOREARM, 1);
  j.fElX = ik.jx;
  j.fElY = ik.jy;
  j.fHX = ik.ex;
  j.fHY = ik.ey;

  j.aHipX = p.hipX + fwX * 2;
  j.aHipY = p.hipY + fwY * 2;
  j.bHipX = p.hipX - fwX * 2;
  j.bHipY = p.hipY - fwY * 2;
  solveIk(j.aHipX, j.aHipY, p.aFootX, p.aFootY, THIGH, SHIN, -1);
  j.aKnX = ik.jx;
  j.aKnY = ik.jy;
  j.aFtX = ik.ex;
  j.aFtY = ik.ey;
  solveIk(j.bHipX, j.bHipY, p.bFootX, p.bFootY, THIGH, SHIN, -1);
  j.bKnX = ik.jx;
  j.bKnY = ik.jy;
  j.bFtX = ik.ex;
  j.bFtY = ik.ey;
  return j;
}

// ---- drawing -------------------------------------------------------------------------------

/** Kite shields are drawn a touch oversized so they read at a distance. */
export const SHIELD_SCALE = 1.12;

/** A sabaton: a wedge that points forward from the ankle. */
function boot(ctx: CanvasRenderingContext2D, fx: number, fy: number, kx: number, ky: number): void {
  // Shin direction decides the ankle angle a little; the sole stays near the ground.
  const lean = Math.max(-0.5, Math.min(0.5, (fx - kx) / 30));
  ctx.beginPath();
  ctx.moveTo(fx - 5, fy - 5 - lean * 2);
  ctx.lineTo(fx + 3, fy - 6);
  ctx.quadraticCurveTo(fx + 12, fy - 3, fx + 12.5, fy + 0.5);
  ctx.lineTo(fx - 5.5, fy + 0.5);
  ctx.closePath();
  ctx.fill();
}

function limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number): void {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Point in a rotated local frame: origin (ox, oy), local x along angle a. Writes `lp`. */
const lp = { x: 0, y: 0 };
function local(ox: number, oy: number, cs: number, sn: number, x: number, y: number): void {
  lp.x = ox + x * cs - y * sn;
  lp.y = oy + x * sn + y * cs;
}

function helm(ctx: CanvasRenderingContext2D, kind: FigureKind, j: Joints): void {
  const cs = Math.cos(j.headA);
  const sn = Math.sin(j.headA);
  const hx = j.headX;
  const hy = j.headY;
  ctx.beginPath();
  if (kind === 'archer') {
    // Hood: a rounded cowl with a pointed liripipe trailing down the back, and a mantle.
    local(hx, hy, cs, sn, -10, 11);
    ctx.moveTo(lp.x, lp.y);
    local(hx, hy, cs, sn, -13, -3);
    const c1x = lp.x;
    const c1y = lp.y;
    local(hx, hy, cs, sn, -24, 12);
    ctx.quadraticCurveTo(c1x, c1y, lp.x, lp.y); // liripipe tip
    local(hx, hy, cs, sn, -14, -16);
    const c2x = lp.x;
    const c2y = lp.y;
    local(hx, hy, cs, sn, 2, -14);
    ctx.quadraticCurveTo(c2x, c2y, lp.x, lp.y);
    local(hx, hy, cs, sn, 13, -12);
    const c3x = lp.x;
    const c3y = lp.y;
    local(hx, hy, cs, sn, 12, 2);
    ctx.quadraticCurveTo(c3x, c3y, lp.x, lp.y);
    local(hx, hy, cs, sn, 9, 5); // face opening dips in under the brow
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 11, 12);
    ctx.lineTo(lp.x, lp.y);
    ctx.closePath();
    ctx.fill();
    // Mantle over the shoulders.
    ctx.beginPath();
    local(hx, hy, cs, sn, -12, 8);
    ctx.moveTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 12, 8);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 17, 22);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, -17, 22);
    ctx.lineTo(lp.x, lp.y);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (kind === 'aldric') {
    // Sugarloaf great helm: tall and tapering to a rounded point (the plume's socket), a flared
    // brow and a jutting breath plate. Taller than anyone's, which is rather the point of Ser Aldric.
    local(hx, hy, cs, sn, -11, 12);
    ctx.moveTo(lp.x, lp.y);
    local(hx, hy, cs, sn, -12, -4);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, -12, -22);
    const c1x = lp.x;
    const c1y = lp.y;
    local(hx, hy, cs, sn, -1, -31);
    ctx.quadraticCurveTo(c1x, c1y, lp.x, lp.y);
    local(hx, hy, cs, sn, 12, -21);
    const c2x = lp.x;
    const c2y = lp.y;
    local(hx, hy, cs, sn, 13, -5);
    ctx.quadraticCurveTo(c2x, c2y, lp.x, lp.y);
    local(hx, hy, cs, sn, 16, 0);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 14, 13);
    ctx.lineTo(lp.x, lp.y);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (kind === 'brunhild') {
    // A rounded spangenhelm with a long nasal and cheek plates over a mail aventail that flares to
    // the shoulders: broad, low, immovable.
    local(hx, hy, cs, sn, -13, 13);
    ctx.moveTo(lp.x, lp.y);
    local(hx, hy, cs, sn, -14, -3);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, -14, -19);
    const c1x = lp.x;
    const c1y = lp.y;
    local(hx, hy, cs, sn, 0, -20);
    ctx.quadraticCurveTo(c1x, c1y, lp.x, lp.y);
    local(hx, hy, cs, sn, 13, -19);
    const c2x = lp.x;
    const c2y = lp.y;
    local(hx, hy, cs, sn, 13, -4);
    ctx.quadraticCurveTo(c2x, c2y, lp.x, lp.y);
    local(hx, hy, cs, sn, 16, -3);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 16, 7); // nasal tip
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 12, 6);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 13, 14);
    ctx.lineTo(lp.x, lp.y);
    ctx.closePath();
    ctx.fill();
    // Aventail: mail falling from the rim over the shoulders.
    ctx.beginPath();
    local(hx, hy, cs, sn, -14, 2);
    ctx.moveTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 11, 8);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 17, 22);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, -19, 22);
    ctx.lineTo(lp.x, lp.y);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (kind === 'hero') {
    // Pointed bascinet with a jutting "pig-face" visor: the hero's unmistakable profile.
    local(hx, hy, cs, sn, -11, 12);
    ctx.moveTo(lp.x, lp.y);
    local(hx, hy, cs, sn, -13, -4);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, -10, -17);
    const c1x = lp.x;
    const c1y = lp.y;
    local(hx, hy, cs, sn, -2, -24);
    ctx.quadraticCurveTo(c1x, c1y, lp.x, lp.y);
    local(hx, hy, cs, sn, 9, -15);
    const c2x = lp.x;
    const c2y = lp.y;
    local(hx, hy, cs, sn, 11, -4);
    ctx.quadraticCurveTo(c2x, c2y, lp.x, lp.y);
    local(hx, hy, cs, sn, 20, 2);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 12, 9);
    ctx.lineTo(lp.x, lp.y);
    local(hx, hy, cs, sn, 13, 13);
    ctx.lineTo(lp.x, lp.y);
    ctx.closePath();
    ctx.fill();
    return;
  }
  // Great helm: a flat-topped bucket, a touch wider at the bottom, with a low crest ridge.
  local(hx, hy, cs, sn, -11, 12);
  ctx.moveTo(lp.x, lp.y);
  local(hx, hy, cs, sn, -12, -6);
  ctx.lineTo(lp.x, lp.y);
  local(hx, hy, cs, sn, -11, -15);
  const c1x = lp.x;
  const c1y = lp.y;
  local(hx, hy, cs, sn, 0, -15);
  ctx.quadraticCurveTo(c1x, c1y, lp.x, lp.y);
  local(hx, hy, cs, sn, 12, -15);
  const c2x = lp.x;
  const c2y = lp.y;
  local(hx, hy, cs, sn, 13, -5);
  ctx.quadraticCurveTo(c2x, c2y, lp.x, lp.y);
  local(hx, hy, cs, sn, 14, 12);
  ctx.lineTo(lp.x, lp.y);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  local(hx, hy, cs, sn, -8, -13);
  ctx.moveTo(lp.x, lp.y);
  local(hx, hy, cs, sn, -1, -22);
  const c3x = lp.x;
  const c3y = lp.y;
  local(hx, hy, cs, sn, 8, -13);
  ctx.quadraticCurveTo(c3x, c3y, lp.x, lp.y);
  ctx.closePath();
  ctx.fill();
}

/** Kite shield outline centered near the near hand. */
export function shieldPath(ctx: CanvasRenderingContext2D, j: Joints, tilt: number, scale = 1): void {
  const cs = Math.cos(tilt) * scale;
  const sn = Math.sin(tilt) * scale;
  const ox = j.nHX + 2;
  const oy = j.nHY + 1;
  ctx.beginPath();
  local(ox, oy, cs, sn, -12, -15);
  ctx.moveTo(lp.x, lp.y);
  local(ox, oy, cs, sn, 0, -19);
  const c1x = lp.x;
  const c1y = lp.y;
  local(ox, oy, cs, sn, 12, -15);
  ctx.quadraticCurveTo(c1x, c1y, lp.x, lp.y);
  local(ox, oy, cs, sn, 12, 3);
  const c2x = lp.x;
  const c2y = lp.y;
  local(ox, oy, cs, sn, 0, 25);
  ctx.quadraticCurveTo(c2x, c2y, lp.x, lp.y);
  local(ox, oy, cs, sn, -12, 3);
  const c3x = lp.x;
  const c3y = lp.y;
  local(ox, oy, cs, sn, -12, -15);
  ctx.quadraticCurveTo(c3x, c3y, lp.x, lp.y);
  ctx.closePath();
}

function sword(ctx: CanvasRenderingContext2D, kind: FigureKind, j: Joints, a: number, minW: number): void {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -dy;
  const py = dx;
  const hx = j.fHX;
  const hy = j.fHY;
  const L = bladeLength(kind);
  const bw = Math.max(3.1, minW * 0.6);
  // Pommel, grip, crossguard.
  disc(ctx, hx - dx * 7, hy - dy * 7, 2.8);
  limb(ctx, hx - dx * 6, hy - dy * 6, hx + dx * 3, hy + dy * 3, Math.max(3.5, minW));
  limb(ctx, hx + dx * 4 - px * 8, hy + dy * 4 - py * 8, hx + dx * 4 + px * 8, hy + dy * 4 + py * 8, Math.max(3.4, minW));
  // Blade: tapered.
  ctx.beginPath();
  ctx.moveTo(hx + dx * 5 - px * bw, hy + dy * 5 - py * bw);
  ctx.lineTo(hx + dx * (5 + L * 0.86) - px * bw * 0.75, hy + dy * (5 + L * 0.86) - py * bw * 0.75);
  ctx.lineTo(hx + dx * (5 + L), hy + dy * (5 + L));
  ctx.lineTo(hx + dx * (5 + L * 0.86) + px * bw * 0.75, hy + dy * (5 + L * 0.86) + py * bw * 0.75);
  ctx.lineTo(hx + dx * 5 + px * bw, hy + dy * 5 + py * bw);
  ctx.closePath();
  ctx.fill();
}

/** Bow tips and string point, written by bowGeometry. */
export const bowGeo = { tx0: 0, ty0: 0, tx1: 0, ty1: 0, cx: 0, cy: 0, sx: 0, sy: 0, ax: 0, ay: 0 };
const BOW_HALF = 40;

/** Bow limb tips, the quadratic control through the grip, the string point and the aim direction. */
export function bowGeometry(p: Pose, j: Joints): typeof bowGeo {
  // Aim direction = bow angle; the bow's axis is perpendicular to it.
  const ax = Math.cos(p.bow);
  const ay = Math.sin(p.bow);
  const axisX = ay; // rotate aim by -90 deg: upper limb direction
  const axisY = -ax;
  const gx = j.nHX;
  const gy = j.nHY;
  const bend = 9 + 9 * p.draw;
  const tx0 = gx + axisX * BOW_HALF - ax * bend;
  const ty0 = gy + axisY * BOW_HALF - ay * bend;
  const tx1 = gx - axisX * BOW_HALF - ax * bend;
  const ty1 = gy - axisY * BOW_HALF - ay * bend;
  bowGeo.tx0 = tx0;
  bowGeo.ty0 = ty0;
  bowGeo.tx1 = tx1;
  bowGeo.ty1 = ty1;
  // Control point so the curve passes through the grip.
  bowGeo.cx = 2 * gx - (tx0 + tx1) * 0.5;
  bowGeo.cy = 2 * gy - (ty0 + ty1) * 0.5;
  if (p.draw > 0.05) {
    bowGeo.sx = j.fHX;
    bowGeo.sy = j.fHY;
  } else {
    bowGeo.sx = (tx0 + tx1) * 0.5;
    bowGeo.sy = (ty0 + ty1) * 0.5;
  }
  bowGeo.ax = ax;
  bowGeo.ay = ay;
  return bowGeo;
}

function bowAndQuiver(ctx: CanvasRenderingContext2D, p: Pose, j: Joints, minW: number): void {
  // Quiver slung across the back, arrow shafts bristling out over the shoulder.
  const qx0 = j.hipX + j.upX * 6 - j.fwX * 5;
  const qy0 = j.hipY + j.upY * 6 - j.fwY * 5;
  const qdx = j.upX * 0.8 - j.fwX * 0.6;
  const qdy = j.upY * 0.8 - j.fwY * 0.6;
  limb(ctx, qx0, qy0, qx0 + qdx * 27, qy0 + qdy * 27, 7.5);
  const topX = qx0 + qdx * 27;
  const topY = qy0 + qdy * 27;
  for (let k = 0; k < 4; k++) {
    const sp = (k - 1.5) * 0.16;
    const fx = qdx * Math.cos(sp) - qdy * Math.sin(sp);
    const fy = qdx * Math.sin(sp) + qdy * Math.cos(sp);
    const len = 9 + (k & 1) * 3;
    limb(ctx, topX, topY, topX + fx * len, topY + fy * len, Math.max(1.4, minW));
    // Fletching: a small diamond at the end of each shaft.
    const ex = topX + fx * len;
    const ey = topY + fy * len;
    ctx.beginPath();
    ctx.moveTo(ex + fx * 3.5, ey + fy * 3.5);
    ctx.lineTo(ex - fy * 1.8, ey + fx * 1.8);
    ctx.lineTo(ex - fx * 2, ey - fy * 2);
    ctx.lineTo(ex + fy * 1.8, ey - fx * 1.8);
    ctx.closePath();
    ctx.fill();
  }
  // Bow.
  const g = bowGeometry(p, j);
  ctx.lineWidth = Math.max(3.6, minW * 1.2);
  ctx.beginPath();
  ctx.moveTo(g.tx0, g.ty0);
  ctx.quadraticCurveTo(g.cx, g.cy, g.tx1, g.ty1);
  ctx.stroke();
  disc(ctx, j.nHX, j.nHY, 3.4);
  // String.
  ctx.lineWidth = Math.max(1.1, minW * 0.7);
  ctx.beginPath();
  ctx.moveTo(g.tx0, g.ty0);
  ctx.lineTo(g.sx, g.sy);
  ctx.lineTo(g.tx1, g.ty1);
  ctx.stroke();
  // Nocked arrow.
  if (p.nock > 0.5) {
    const ex = g.sx + g.ax * 60;
    const ey = g.sy + g.ay * 60;
    limb(ctx, g.sx, g.sy, ex, ey, Math.max(1.8, minW * 0.8));
    ctx.beginPath();
    ctx.moveTo(ex + g.ax * 6, ey + g.ay * 6);
    ctx.lineTo(ex - g.ay * 3, ey + g.ax * 3);
    ctx.lineTo(ex + g.ay * 3, ey - g.ax * 3);
    ctx.closePath();
    ctx.fill();
  }
}

/** Per-kind build: torso bulk, skirt flare, limb thickness, pauldron radius. */
function build(kind: FigureKind): number {
  return kind === 'archer' ? 0.86 : kind === 'hero' ? 1.06 : kind === 'aldric' ? 1.04 : kind === 'brunhild' ? 1.3 : 0.95;
}

/**
 * Draw the whole knight as one silhouette with the current fillStyle/strokeStyle (set both to the
 * same color). `minW` is the thinnest stroke in figure units (so thin parts survive small LODs).
 * The hero's cape and plume are drawn by hero.ts; the bearer's pole and flag by banner.ts; the
 * lancer's horse by horse.ts (called from here) and its lance by lance.ts (live).
 */
export function drawFigure(ctx: CanvasRenderingContext2D, kind: FigureKind, p: Pose, j: Joints, minW: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'lancer') {
    drawHorse(ctx, p, minW);
    kind = 'rider';
  }
  const upX = j.upX;
  const upY = j.upY;
  const fwX = j.fwX;
  const fwY = j.fwY;
  const hx = j.hipX;
  const hy = j.hipY;
  const big = kind === 'brunhild';
  const lw = big ? 1.22 : 1;

  // Legs and boots.
  limb(ctx, j.bHipX, j.bHipY, j.bKnX, j.bKnY, 12 * lw);
  limb(ctx, j.bKnX, j.bKnY, j.bFtX, j.bFtY, 10 * lw);
  limb(ctx, j.aHipX, j.aHipY, j.aKnX, j.aKnY, 12 * lw);
  limb(ctx, j.aKnX, j.aKnY, j.aFtX, j.aFtY, 10 * lw);
  boot(ctx, j.aFtX, j.aFtY, j.aKnX, j.aKnY);
  boot(ctx, j.bFtX, j.bFtY, j.bKnX, j.bKnY);

  // Surcoat skirt: flares from the waist, its hem swings with the knees.
  const kneeMidX = (j.aKnX + j.bKnX) * 0.5;
  const kneeMidY = (j.aKnY + j.bKnY) * 0.5;
  const hemX = hx + (kneeMidX - hx) * 0.55;
  const hemY = hy + (kneeMidY - hy) * 0.55;
  const flare = kind === 'archer' ? 11 : kind === 'hero' ? 14 : big ? 16 : kind === 'aldric' ? 13.5 : 12.5;
  ctx.beginPath();
  ctx.moveTo(hx + upX * 6 - fwX * 10 * lw, hy + upY * 6 - fwY * 10 * lw);
  ctx.lineTo(hx + upX * 6 + fwX * 10 * lw, hy + upY * 6 + fwY * 10 * lw);
  ctx.lineTo(hemX + fwX * flare, hemY + fwY * flare + 2);
  ctx.lineTo(hemX - fwX * flare, hemY - fwY * flare + 2);
  ctx.closePath();
  ctx.fill();

  // Torso: waist -> barrel chest -> shoulders, then a rounded top.
  const bulk = build(kind);
  ctx.beginPath();
  ctx.moveTo(hx + upX * 4 - fwX * 7.5 * bulk, hy + upY * 4 - fwY * 7.5 * bulk);
  ctx.lineTo(hx + upX * 21 - fwX * 11.5 * bulk, hy + upY * 21 - fwY * 11.5 * bulk);
  ctx.lineTo(hx + upX * 29 - fwX * 11 * bulk, hy + upY * 29 - fwY * 11 * bulk);
  ctx.quadraticCurveTo(hx + upX * 35, hy + upY * 35, hx + upX * 29 + fwX * 11 * bulk, hy + upY * 29 + fwY * 11 * bulk);
  ctx.lineTo(hx + upX * 19 + fwX * 14 * bulk, hy + upY * 19 + fwY * 14 * bulk);
  ctx.lineTo(hx + upX * 4 + fwX * 8 * bulk, hy + upY * 4 + fwY * 8 * bulk);
  ctx.closePath();
  ctx.fill();

  helm(ctx, kind, j);

  // Arms, pauldrons, gauntlets.
  limb(ctx, j.fShX, j.fShY, j.fElX, j.fElY, 9 * lw);
  limb(ctx, j.fElX, j.fElY, j.fHX, j.fHY, 8 * lw);
  limb(ctx, j.nShX, j.nShY, j.nElX, j.nElY, 9 * lw);
  limb(ctx, j.nElX, j.nElY, j.nHX, j.nHY, 8 * lw);
  const pr = kind === 'archer' ? 6.5 : big ? 11 : 8.5;
  disc(ctx, j.nShX, j.nShY, pr);
  disc(ctx, j.fShX, j.fShY, pr);
  disc(ctx, j.nHX, j.nHY, 4.8 * lw);
  disc(ctx, j.fHX, j.fHY, 4.8 * lw);

  if (kind === 'archer') {
    bowAndQuiver(ctx, p, j, minW);
    return;
  }
  if (big) {
    greatAxe(ctx, j, p.weapon, minW);
    return;
  }
  if (kind !== 'rider') sword(ctx, kind, j, p.weapon, minW);
  if (kind === 'foot' || kind === 'hero' || kind === 'aldric' || kind === 'rider') {
    shieldPath(ctx, j, p.shield, SHIELD_SCALE);
    ctx.fill();
  }
}

/** Where the great axe's head sits along the haft (figure units from the grip), and its geometry. */
export function axeHead(j: Joints, a: number, out: { x: number; y: number }): void {
  out.x = j.fHX + Math.cos(a) * (AXE_HAFT - 6);
  out.y = j.fHY + Math.sin(a) * (AXE_HAFT - 6);
}

/**
 * Dame Brunhild's great axe: a long haft through both fists, a broad bearded crescent on the
 * leading side (the side it swings toward) and a back spike.
 */
function greatAxe(ctx: CanvasRenderingContext2D, j: Joints, a: number, minW: number): void {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  // Leading side: +90 degrees from the haft (a downward chop swings the head that way).
  const px = -dy;
  const py = dx;
  const hx = j.fHX;
  const hy = j.fHY;
  limb(ctx, hx - dx * AXE_BUTT, hy - dy * AXE_BUTT, hx + dx * AXE_HAFT, hy + dy * AXE_HAFT, Math.max(4.2, minW));
  disc(ctx, hx - dx * AXE_BUTT, hy - dy * AXE_BUTT, 3.2);
  const ax = hx + dx * (AXE_HAFT - 6);
  const ay = hy + dy * (AXE_HAFT - 6);
  // Blade: cheek at the haft, a broad sweeping crescent edge, a hooked beard trailing down the haft.
  ctx.beginPath();
  ctx.moveTo(ax + dx * 7 + px * 3, ay + dy * 7 + py * 3);
  ctx.lineTo(ax + dx * 16 + px * 17, ay + dy * 16 + py * 17);
  ctx.quadraticCurveTo(ax + dx * 4 + px * 36, ay + dy * 4 + py * 36, ax - dx * 21 + px * 21, ay - dy * 21 + py * 21);
  ctx.lineTo(ax - dx * 15 + px * 11, ay - dy * 15 + py * 11);
  ctx.quadraticCurveTo(ax - dx * 7 + px * 7, ay - dy * 7 + py * 7, ax - dx * 6 + px * 2, ay - dy * 6 + py * 2);
  ctx.closePath();
  ctx.fill();
  // Back spike and a socket.
  ctx.beginPath();
  ctx.moveTo(ax + dx * 5 - px * 2, ay + dy * 5 - py * 2);
  ctx.lineTo(ax - dx * 1 - px * 17, ay - dy * 1 - py * 17);
  ctx.lineTo(ax - dx * 5 - px * 2, ay - dy * 5 - py * 2);
  ctx.closePath();
  ctx.fill();
  limb(ctx, ax - dx * 7, ay - dy * 7, ax + dx * 9, ay + dy * 9, 6.5);
}

/** Small colored details drawn over the silhouette: the visor glint. */
export function drawDetails(ctx: CanvasRenderingContext2D, kind: FigureKind, j: Joints, glint: string): void {
  if (kind === 'archer' || kind === 'brunhild') return;
  const cs = Math.cos(j.headA);
  const sn = Math.sin(j.headA);
  ctx.strokeStyle = glint;
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (kind === 'hero') {
    local(j.headX, j.headY, cs, sn, 6, -4);
    ctx.moveTo(lp.x, lp.y);
    local(j.headX, j.headY, cs, sn, 14, -1);
    ctx.lineTo(lp.x, lp.y);
  } else if (kind === 'aldric') {
    local(j.headX, j.headY, cs, sn, 3, -6);
    ctx.moveTo(lp.x, lp.y);
    local(j.headX, j.headY, cs, sn, 12.5, -5);
    ctx.lineTo(lp.x, lp.y);
  } else {
    local(j.headX, j.headY, cs, sn, 4, -3);
    ctx.moveTo(lp.x, lp.y);
    local(j.headX, j.headY, cs, sn, 12.5, -3);
    ctx.lineTo(lp.x, lp.y);
  }
  ctx.stroke();
}

/** Anchors a knight exposes to the crowd (figure units): weapon tip, banner pole, arrow launch. */
export interface Anchors {
  tipX: number;
  tipY: number;
  poleX: number;
  poleY: number;
  /** Pole direction (screen angle), pointing from the grip toward the top. */
  poleA: number;
  /** Where an arrow leaves the bow, and the aim angle. */
  launchX: number;
  launchY: number;
  aim: number;
}

export function anchors(kind: FigureKind, p: Pose, j: Joints, out: Anchors): Anchors {
  if (kind === 'archer') {
    const g = bowGeometry(p, j);
    out.tipX = g.tx0;
    out.tipY = g.ty0;
    out.launchX = j.nHX + g.ax * 8;
    out.launchY = j.nHY + g.ay * 8;
    out.aim = p.bow;
    // Sashimono-style pole strapped to the back (only drawn for archer bearers).
    out.poleX = j.hipX + j.upX * 12 - j.fwX * 12;
    out.poleY = j.hipY + j.upY * 12 - j.fwY * 12;
    out.poleA = Math.atan2(j.upY, j.upX) - 0.12;
    return out;
  }
  if (kind === 'lancer') {
    // pole = the lance grip (far fist, the lance is drawn live); tip/launch = the horse's muzzle
    // and chest (dust and impact effects).
    horseAnchors(p, out);
    out.poleX = j.fHX;
    out.poleY = j.fHY;
    out.poleA = p.weapon;
    out.aim = p.weapon;
    return out;
  }
  const L = 5 + bladeLength(kind);
  out.tipX = j.fHX + Math.cos(p.weapon) * L;
  out.tipY = j.fHY + Math.sin(p.weapon) * L;
  out.poleX = j.nHX;
  out.poleY = j.nHY;
  out.poleA = p.pole;
  out.launchX = out.tipX;
  out.launchY = out.tipY;
  out.aim = p.weapon;
  return out;
}

/** Conservative bounds of the drawn silhouette (figure units), including weapons. */
export function figureBounds(kind: FigureKind, p: Pose, j: Joints, out: { x0: number; y0: number; x1: number; y1: number }): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const inc = (x: number, y: number, r: number): void => {
    if (x - r < x0) x0 = x - r;
    if (y - r < y0) y0 = y - r;
    if (x + r > x1) x1 = x + r;
    if (y + r > y1) y1 = y + r;
  };
  inc(j.hipX, j.hipY, 18);
  inc(j.neckX, j.neckY, 16);
  inc(j.headX, j.headY, 26);
  inc(j.aKnX, j.aKnY, 8);
  inc(j.bKnX, j.bKnY, 8);
  inc(j.aFtX, j.aFtY, 12);
  inc(j.bFtX, j.bFtY, 12);
  inc(j.nElX, j.nElY, 7);
  inc(j.fElX, j.fElY, 7);
  inc(j.nHX, j.nHY, kind === 'foot' || kind === 'hero' || kind === 'aldric' || kind === 'lancer' || kind === 'rider' ? 31 : 8);
  inc(j.fHX, j.fHY, 12);
  if (kind === 'lancer') {
    horseBounds(p, inc);
    out.x0 = x0;
    out.y0 = y0;
    out.x1 = x1;
    out.y1 = y1;
    return;
  }
  if (kind === 'archer') {
    const g = bowGeometry(p, j);
    inc(g.tx0, g.ty0, 5);
    inc(g.tx1, g.ty1, 5);
    inc(g.cx * 0.5 + j.nHX * 0.5, g.cy * 0.5 + j.nHY * 0.5, 5);
    if (p.nock > 0.5) inc(g.sx + g.ax * 68, g.sy + g.ay * 68, 5);
    inc(j.hipX + j.upX * 40 - j.fwX * 24, j.hipY + j.upY * 40 - j.fwY * 24, 6);
  } else {
    const L = 5 + bladeLength(kind);
    inc(j.fHX + Math.cos(p.weapon) * L, j.fHY + Math.sin(p.weapon) * L, kind === 'brunhild' ? 30 : 5);
    if (kind === 'brunhild') inc(j.fHX - Math.cos(p.weapon) * AXE_BUTT, j.fHY - Math.sin(p.weapon) * AXE_BUTT, 5);
  }
  out.x0 = x0;
  out.y0 = y0;
  out.x1 = x1;
  out.y1 = y1;
}
