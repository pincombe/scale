// The crowd rig's hero shapes (crowd/rig.ts drawFigure, kind 'hero'), re-emitted as FILLS that
// wind clockwise on screen, so any number of them union into one path that can be filled, clipped
// to and filled again shifted (the colossus's rim light at any size). The rig strokes its limbs with
// round caps; here they are capsules of half the stroke width. Allocation-free.
import type { Joints } from '../crowd/rig';
import { bladeLength } from '../crowd/rig';


/** A round-capped stroke of half-width r from (x0, y0) to (x1, y1), as a clockwise subpath. */
export function capsule(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number): void {
  let dx = x1 - x0;
  let dy = y1 - y0;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (l < 1e-6) {
    disc(ctx, x0, y0, r);
    return;
  }
  dx /= l;
  dy /= l;
  // n = d rotated so the caps bulge outward and the contour runs clockwise on screen.
  const nx = dy;
  const ny = -dx;
  const an = Math.atan2(ny, nx);
  ctx.moveTo(x0 + nx * r, y0 + ny * r);
  ctx.lineTo(x1 + nx * r, y1 + ny * r);
  ctx.arc(x1, y1, r, an, an + Math.PI, false);
  ctx.lineTo(x0 - nx * r, y0 - ny * r);
  ctx.arc(x0, y0, r, an + Math.PI, an + Math.PI * 2, false);
  ctx.closePath();
}

/**
 * A tapered capsule: circles of radius r0 at (x0, y0) and r1 at (x1, y1) joined by their outer
 * tangents, clockwise (r0 === r1 is exactly capsule()).
 */
export function taper(ctx: CanvasRenderingContext2D, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.sqrt(dx * dx + dy * dy);
  if (l < 1e-6 || l <= Math.abs(r0 - r1) + 1e-6) {
    disc(ctx, x0, y0, Math.max(r0, r1));
    return;
  }
  const ad = Math.atan2(dy, dx);
  const ac = Math.acos((r0 - r1) / l);
  const a0 = ad - ac;
  const a1 = ad + ac;
  const c0 = Math.cos(a0);
  const s0 = Math.sin(a0);
  ctx.moveTo(x0 + r0 * c0, y0 + r0 * s0);
  ctx.lineTo(x1 + r1 * c0, y1 + r1 * s0);
  ctx.arc(x1, y1, r1, a0, a1, false);
  ctx.lineTo(x0 + r0 * Math.cos(a1), y0 + r0 * Math.sin(a1));
  ctx.arc(x0, y0, r0, a1, a0 + Math.PI * 2, false);
  ctx.closePath();
}

/**
 * A leg for the colossus: the rig's thigh and shin capsules (d = 0), morphing on a close-up
 * (d = 1) into a tapered cuisse and greave that end at the ankle, above the sole, so no round
 * stroke cap pokes out under the boot. Writes the ankle into ANKLE (the greave's lower end).
 */
export const ANKLE = { x: 0, y: 0 };
export function traceLeg(ctx: CanvasRenderingContext2D, hx: number, hy: number, kx: number, ky: number, fx: number, fy: number, d: number): void {
  const ax = fx + 0.6 * d;
  const ay = fy - 4.6 * d;
  ANKLE.x = ax;
  ANKLE.y = ay;
  taper(ctx, hx, hy, 6 + 0.5 * d, kx, ky, 6 - 0.7 * d);
  taper(ctx, kx, ky, 5 + 0.35 * d, ax, ay, 5 - 1.8 * d);
  // The poleyn: the knee cop, a touch proud of the joint.
  if (d > 0.001) disc(ctx, kx + 0.6 * d, ky - 0.2 * d, 5 + 0.75 * d);
}

export function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2, false);
  ctx.closePath();
}

/**
 * The boot's key points (figure units), written by bootPoints: heel top (h), instep (i), toe curve
 * control (c) and tip (t), sole front (s), arch control (a), heel bottom (b), heel curve control (k).
 */
export const BOOT = { hx: 0, hy: 0, ix: 0, iy: 0, cx: 0, cy: 0, tx: 0, ty: 0, sx: 0, sy: 0, ax: 0, ay: 0, bx: 0, by: 0, kx: 0, ky: 0 };

/**
 * d = 0: crowd/rig.ts boot(), a wedge pointing forward from the ankle. d = 1 (a close-up): a long
 * pointed sabaton with a rounded heel and an arched sole. Everything in between is a lerp.
 */
export function bootPoints(fx: number, fy: number, kx: number, d: number): typeof BOOT {
  const lean = Math.max(-0.5, Math.min(0.5, (fx - kx) / 30));
  const b = BOOT;
  b.hx = fx - 5 + 0.7 * d;
  b.hy = fy - 5 - lean * 2 - 0.5 * d;
  b.ix = fx + 3 + 0.8 * d;
  b.iy = fy - 6 - 0.2 * d;
  b.cx = fx + 12 + 2.2 * d;
  b.cy = fy - 3 - 0.8 * d;
  b.tx = fx + 12.5 + 4 * d;
  b.ty = fy + 0.5 - 0.55 * d;
  b.sx = b.tx - 2.2 * d;
  b.sy = fy + 0.5 + 0.1 * d;
  b.bx = fx - 5.5 + 0.9 * d;
  b.by = fy + 0.5 + 0.1 * d;
  b.ax = (b.sx + b.bx) * 0.5;
  b.ay = b.sy - 0.5 * d;
  b.kx = (b.bx + b.hx) * 0.5 - 2.4 * d;
  b.ky = (b.by + b.hy) * 0.5 + 0.2 * d;
  return b;
}

export function traceBoot(ctx: CanvasRenderingContext2D, fx: number, fy: number, kx: number, d = 0): void {
  const b = bootPoints(fx, fy, kx, d);
  ctx.moveTo(b.hx, b.hy);
  ctx.lineTo(b.ix, b.iy);
  ctx.quadraticCurveTo(b.cx, b.cy, b.tx, b.ty);
  ctx.lineTo(b.sx, b.sy);
  ctx.quadraticCurveTo(b.ax, b.ay, b.bx, b.by);
  ctx.quadraticCurveTo(b.kx, b.ky, b.hx, b.hy);
  ctx.closePath();
}

/** crowd/rig.ts surcoat skirt (hero flare). */
export function traceSkirt(ctx: CanvasRenderingContext2D, j: Joints): void {
  const hx = j.hipX;
  const hy = j.hipY;
  const kneeMidX = (j.aKnX + j.bKnX) * 0.5;
  const kneeMidY = (j.aKnY + j.bKnY) * 0.5;
  const hemX = hx + (kneeMidX - hx) * 0.55;
  const hemY = hy + (kneeMidY - hy) * 0.55;
  const flare = 14;
  ctx.moveTo(hx + j.upX * 6 - j.fwX * 10, hy + j.upY * 6 - j.fwY * 10);
  ctx.lineTo(hx + j.upX * 6 + j.fwX * 10, hy + j.upY * 6 + j.fwY * 10);
  ctx.lineTo(hemX + j.fwX * flare, hemY + j.fwY * flare + 2);
  ctx.lineTo(hemX - j.fwX * flare, hemY - j.fwY * flare + 2);
  ctx.closePath();
}

/** crowd/rig.ts torso (hero bulk). */
export function traceTorso(ctx: CanvasRenderingContext2D, j: Joints): void {
  const hx = j.hipX;
  const hy = j.hipY;
  const upX = j.upX;
  const upY = j.upY;
  const fwX = j.fwX;
  const fwY = j.fwY;
  const bulk = 1.06;
  ctx.moveTo(hx + upX * 4 - fwX * 7.5 * bulk, hy + upY * 4 - fwY * 7.5 * bulk);
  ctx.lineTo(hx + upX * 21 - fwX * 11.5 * bulk, hy + upY * 21 - fwY * 11.5 * bulk);
  ctx.lineTo(hx + upX * 29 - fwX * 11 * bulk, hy + upY * 29 - fwY * 11 * bulk);
  ctx.quadraticCurveTo(hx + upX * 35, hy + upY * 35, hx + upX * 29 + fwX * 11 * bulk, hy + upY * 29 + fwY * 11 * bulk);
  ctx.lineTo(hx + upX * 19 + fwX * 14 * bulk, hy + upY * 19 + fwY * 14 * bulk);
  ctx.lineTo(hx + upX * 4 + fwX * 8 * bulk, hy + upY * 4 + fwY * 8 * bulk);
  ctx.closePath();
}

/** A point in a rotated local frame (origin ox, oy; x along cos/sin): writes LP. Allocation-free. */
export const LP = { x: 0, y: 0 };
export function local(ox: number, oy: number, cs: number, sn: number, x: number, y: number): void {
  LP.x = ox + x * cs - y * sn;
  LP.y = oy + x * sn + y * cs;
}

/** crowd/rig.ts helm (hero): the pointed bascinet with its pig-face visor. */
export function traceHelm(ctx: CanvasRenderingContext2D, j: Joints): void {
  const cs = Math.cos(j.headA);
  const sn = Math.sin(j.headA);
  const hx = j.headX;
  const hy = j.headY;
  local(hx, hy, cs, sn, -11, 12);
  ctx.moveTo(LP.x, LP.y);
  local(hx, hy, cs, sn, -13, -4);
  ctx.lineTo(LP.x, LP.y);
  local(hx, hy, cs, sn, -10, -17);
  let qx = LP.x;
  let qy = LP.y;
  local(hx, hy, cs, sn, -2, -24);
  ctx.quadraticCurveTo(qx, qy, LP.x, LP.y);
  local(hx, hy, cs, sn, 9, -15);
  qx = LP.x;
  qy = LP.y;
  local(hx, hy, cs, sn, 11, -4);
  ctx.quadraticCurveTo(qx, qy, LP.x, LP.y);
  local(hx, hy, cs, sn, 20, 2);
  ctx.lineTo(LP.x, LP.y);
  local(hx, hy, cs, sn, 12, 9);
  ctx.lineTo(LP.x, LP.y);
  local(hx, hy, cs, sn, 13, 13);
  ctx.lineTo(LP.x, LP.y);
  ctx.closePath();
}

/** crowd/rig.ts shieldPath() without its beginPath (it joins the silhouette): the kite shield. */
export function traceShield(ctx: CanvasRenderingContext2D, j: Joints, tilt: number, scale: number): void {
  const cs = Math.cos(tilt) * scale;
  const sn = Math.sin(tilt) * scale;
  const ox = j.nHX + 2;
  const oy = j.nHY + 1;
  local(ox, oy, cs, sn, -12, -15);
  ctx.moveTo(LP.x, LP.y);
  local(ox, oy, cs, sn, 0, -19);
  let qx = LP.x;
  let qy = LP.y;
  local(ox, oy, cs, sn, 12, -15);
  ctx.quadraticCurveTo(qx, qy, LP.x, LP.y);
  local(ox, oy, cs, sn, 12, 3);
  qx = LP.x;
  qy = LP.y;
  local(ox, oy, cs, sn, 0, 25);
  ctx.quadraticCurveTo(qx, qy, LP.x, LP.y);
  local(ox, oy, cs, sn, -12, 3);
  qx = LP.x;
  qy = LP.y;
  local(ox, oy, cs, sn, -12, -15);
  ctx.quadraticCurveTo(qx, qy, LP.x, LP.y);
  ctx.closePath();
}

/** crowd/rig.ts sword (hero): pommel, grip, crossguard, tapered blade. */
export function traceSword(ctx: CanvasRenderingContext2D, j: Joints, a: number): void {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -dy;
  const py = dx;
  const hx = j.fHX;
  const hy = j.fHY;
  const L = bladeLength('hero');
  const bw = 3.1;
  disc(ctx, hx - dx * 7, hy - dy * 7, 2.8);
  capsule(ctx, hx - dx * 6, hy - dy * 6, hx + dx * 3, hy + dy * 3, 1.75);
  capsule(ctx, hx + dx * 4 - px * 8, hy + dy * 4 - py * 8, hx + dx * 4 + px * 8, hy + dy * 4 + py * 8, 1.7);
  ctx.moveTo(hx + dx * 5 - px * bw, hy + dy * 5 - py * bw);
  ctx.lineTo(hx + dx * (5 + L * 0.86) - px * bw * 0.75, hy + dy * (5 + L * 0.86) - py * bw * 0.75);
  ctx.lineTo(hx + dx * (5 + L), hy + dy * (5 + L));
  ctx.lineTo(hx + dx * (5 + L * 0.86) + px * bw * 0.75, hy + dy * (5 + L * 0.86) + py * bw * 0.75);
  ctx.lineTo(hx + dx * 5 + px * bw, hy + dy * 5 + py * bw);
  ctx.closePath();
}
