// Wyvern and boss parts for the dragon painter (paint.ts): wing-arms, craggy rock plates, the rock
// club, and the boss dressings: moss and lichen, old scars, a mantle of snow, torn membranes.
// Path builders add subpaths (the caller fills or strokes). Everything is in rig units (u), except
// the head-frame builders (head units), and allocation-free per frame; DressLayout holds the
// per-individual random layout, rebuilt when the dragon changes.
import { Rng } from '../../lib/rng';
import { LEG_FF, LEG_FN, MAX_FINGERS, type DragonRig, type SpineSample } from './rig';
import { MOUTH_Y, type HeadShape } from './head';
import { capsule } from './shapes';

const TAU = Math.PI * 2;
const MAX_HOLES = 4;
const MAX_MOSS = 14;
const MAX_BEARD = 6;
const MAX_SCARS = 6;

const sA: SpineSample = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };
const sB: SpineSample = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };
const sC: SpineSample = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };
/** Plate vertices scratch (x/y): lead base, lead cliff, peak, notch, crag, ledge, trailing base. */
const pv = new Float32Array(14);

function smooth01(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

/** Fractional main-chain index the burn has reached (n - 1 = intact). */
function cutAt(rig: DragonRig): number {
  return rig.dissolve >= 1 ? rig.n - 1 : rig.indexOfS(rig.dissolve);
}

/** Per-individual random layout of the boss dressings (tears, moss, beard, scars). */
export class DressLayout {
  readonly holeN = new Uint8Array(2);
  readonly holeG = new Uint8Array(2 * MAX_HOLES);
  readonly holeT = new Float32Array(2 * MAX_HOLES);
  readonly holeU = new Float32Array(2 * MAX_HOLES);
  readonly holeR = new Float32Array(2 * MAX_HOLES);
  readonly holeRot = new Float32Array(2 * MAX_HOLES);
  readonly holeK = new Float32Array(2 * MAX_HOLES * 6);
  /** Rips in the trailing edge: position along each scallop and depth. */
  readonly notchT = new Float32Array(2 * MAX_FINGERS);
  readonly notchD = new Float32Array(2 * MAX_FINGERS);
  mossN = 0;
  readonly mossI = new Float32Array(MAX_MOSS);
  readonly mossR = new Float32Array(MAX_MOSS);
  readonly mossL = new Float32Array(MAX_MOSS);
  beardN = 0;
  readonly beardX = new Float32Array(MAX_BEARD);
  readonly beardLen = new Float32Array(MAX_BEARD);
  readonly beardPh = new Float32Array(MAX_BEARD);
  scarN = 0;
  readonly scarAt = new Float32Array(MAX_SCARS);
  readonly scarSide = new Float32Array(MAX_SCARS);
  readonly scarAng = new Float32Array(MAX_SCARS);
  readonly scarLen = new Float32Array(MAX_SCARS);
  readonly scarLines = new Uint8Array(MAX_SCARS);
  faceScar = 0;

  layout(rig: DragonRig): void {
    const ind = rig.ind;
    const d = ind.dress;
    const rng = new Rng((ind.seed ^ 0xd4e55e5) >>> 0);
    const F = rig.fingers;
    // Torn membranes: a few ragged holes between the fingers, rips in the trailing edge.
    for (let slot = 0; slot < 2; slot++) {
      const n = d.torn > 0.01 ? Math.min(MAX_HOLES, 2 + rng.int(3) - slot) : 0;
      this.holeN[slot] = n;
      for (let h = 0; h < n; h++) {
        const i = slot * MAX_HOLES + h;
        this.holeG[i] = rng.int(F);
        this.holeT[i] = 0.4 + 0.4 * rng.float();
        this.holeU[i] = 0.3 + 0.4 * rng.float();
        this.holeR[i] = 0.14 + 0.16 * rng.float();
        this.holeRot[i] = rng.float() * TAU;
        for (let k = 0; k < 6; k++) this.holeK[i * 6 + k] = 0.55 + 0.6 * rng.float();
      }
      for (let f = 0; f < MAX_FINGERS; f++) {
        this.notchT[slot * MAX_FINGERS + f] = 0.25 + 0.5 * rng.float();
        this.notchD[slot * MAX_FINGERS + f] = rng.float() < 0.7 ? 0.2 + 0.35 * rng.float() : 0;
      }
    }
    // Moss and lichen tufts along the crest; beard strands under the jaw.
    this.mossN = 0;
    this.beardN = 0;
    if (d.moss > 0.01) {
      const i0 = rig.indexOfS(ind.crestFrom);
      const i1 = rig.indexOfS(Math.min(ind.crestTo, 0.75));
      const n = Math.min(MAX_MOSS, 10 + rng.int(4));
      for (let k = 0; k < n; k++) {
        this.mossI[k] = i0 + ((k + 0.2 + 0.6 * rng.float()) / n) * (i1 - i0);
        this.mossR[k] = (0.006 + 0.008 * rng.float()) * (k % 4 === 0 ? 1.4 : 1);
        this.mossL[k] = rng.float() * TAU;
      }
      this.mossN = n;
      const b = Math.min(MAX_BEARD, 4 + rng.int(3));
      for (let k = 0; k < b; k++) {
        this.beardX[k] = 0.3 + (0.42 * (k + rng.float() * 0.6)) / b;
        this.beardLen[k] = 0.22 + 0.24 * rng.float();
        this.beardPh[k] = rng.float() * TAU;
      }
      this.beardN = b;
    }
    // Old claw scars on the flank and neck, and one across the face.
    this.scarN = Math.min(MAX_SCARS, Math.round(d.scars));
    for (let k = 0; k < this.scarN; k++) {
      this.scarAt[k] = k === 0 ? -0.35 - 0.2 * rng.float() : 0.1 + 0.75 * rng.float();
      this.scarSide[k] = -0.25 + 0.75 * rng.float();
      this.scarAng[k] = -0.9 + 0.55 * rng.float();
      this.scarLen[k] = 0.03 + 0.025 * rng.float();
      this.scarLines[k] = k === 0 ? 1 : 3;
    }
    this.faceScar = d.scars > 0.5 ? 1 : 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Rock plates
// ---------------------------------------------------------------------------------------------

/**
 * Vertices of plate p on the live spine into pv; false when the burn has taken it. A broad slab of
 * rock leaning toward the tail: a steep leading cliff up to the peak, then a jagged top stepping
 * down (a notch, a lower crag, a ledge) to the trailing base.
 */
function plateVerts(rig: DragonRig, p: number, cut: number): boolean {
  const c = rig.plateI[p]!;
  const hw = rig.plateW[p]!;
  if (c + hw >= cut) return false;
  const h = rig.plateH[p]!;
  rig.spineAt(c - hw, sA);
  rig.spineAt(c + hw, sB);
  rig.spineAt(c, sC);
  const nx = sC.nx;
  const ny = sC.ny;
  // Tangent toward the tail.
  const tx = -ny;
  const ty = nx;
  const ax = sA.x + sA.nx * sA.back * 0.7;
  const ay = sA.y + sA.ny * sA.back * 0.7;
  const fx = sB.x + sB.nx * sB.back * 0.7;
  const fy = sB.y + sB.ny * sB.back * 0.7;
  // The base sinks into the back; the top stands off the back line and leans back.
  const lift = sC.back * 0.2;
  const lean = rig.plateLean[p]!;
  const j1 = rig.plateJ1[p]!;
  const j2 = rig.plateJ2[p]!;
  const j3 = rig.plateJ3[p]!;
  pv[0] = ax;
  pv[1] = ay;
  vert(1, ax, ay, fx, fy, 0.06, lift + h * 0.62, nx, ny, tx, ty, lean * h * 0.62);
  vert(2, ax, ay, fx, fy, 0.24, lift + h, nx, ny, tx, ty, lean * h);
  vert(3, ax, ay, fx, fy, 0.3 + 0.18 * j1, lift + h * (1 - j2), nx, ny, tx, ty, lean * h * (1 - j2));
  vert(4, ax, ay, fx, fy, 0.6, lift + h * j3, nx, ny, tx, ty, lean * h * j3);
  vert(5, ax, ay, fx, fy, 0.84, lift + h * 0.4, nx, ny, tx, ty, lean * h * 0.4);
  pv[12] = fx;
  pv[13] = fy;
  return true;
}

/** Plate vertex i: fraction t along the base, raised `up` along the normal, leaning `back` toward the tail. */
function vert(i: number, ax: number, ay: number, fx: number, fy: number, t: number, up: number, nx: number, ny: number, tx: number, ty: number, back: number): void {
  pv[i * 2] = ax + (fx - ax) * t + nx * up + tx * back;
  pv[i * 2 + 1] = ay + (fy - ay) * t + ny * up + ty * back;
}

/** The near (far = false) or far row of rock plates along the back. */
export function platesPath(ctx: CanvasRenderingContext2D, rig: DragonRig, far: boolean): void {
  const i0 = far ? rig.plateN : 0;
  const i1 = far ? rig.plateN + rig.plateFarN : rig.plateN;
  const cut = cutAt(rig);
  for (let p = i0; p < i1; p++) {
    if (!plateVerts(rig, p, cut)) continue;
    ctx.moveTo(pv[0]!, pv[1]!);
    for (let v = 1; v < 7; v++) ctx.lineTo(pv[v * 2]!, pv[v * 2 + 1]!);
    ctx.closePath();
  }
}

/**
 * Snow caps on the plates (the near or far row) and, for the near row, a lumpy band of snow along
 * the back between them: Grimmaw's mantle.
 */
export function snowPath(ctx: CanvasRenderingContext2D, rig: DragonRig, far: boolean, amount: number): void {
  const i0 = far ? rig.plateN : 0;
  const i1 = far ? rig.plateN + rig.plateFarN : rig.plateN;
  const cut = cutAt(rig);
  for (let p = i0; p < i1; p++) {
    if (!plateVerts(rig, p, cut)) continue;
    const h = rig.plateH[p]!;
    rig.spineAt(rig.plateI[p]!, sC);
    const nx = sC.nx;
    const ny = sC.ny;
    // A thin band along the top edges (lead cliff, peak, notch, crag, ledge), heaped on the peak and
    // hanging in a drip or two down the faces: bright against the dark rock.
    const k = h * (0.55 + 0.45 * amount);
    const j = rig.plateJ1[p]!;
    ctx.moveTo(pv[2]! + (pv[4]! - pv[2]!) * 0.35, pv[3]! + (pv[5]! - pv[3]!) * 0.35);
    for (let v = 2; v <= 5; v++) ctx.lineTo(pv[v * 2]! + nx * h * 0.03, pv[v * 2 + 1]! + ny * h * 0.03);
    // Back along the underside: thin at the ends, deeper at the peak, drips under the notch and crag.
    snowUnder(ctx, 5, 0.06 * k, nx, ny);
    snowUnder(ctx, 4.5, (0.34 + 0.2 * j) * k, nx, ny);
    snowUnder(ctx, 4, 0.14 * k, nx, ny);
    snowUnder(ctx, 3.5, 0.3 * k, nx, ny);
    snowUnder(ctx, 3, 0.1 * k, nx, ny);
    snowUnder(ctx, 2, 0.22 * k, nx, ny);
    ctx.closePath();
  }
  if (far || rig.plateN === 0) return;
  // Drifts along the back from the first plate to past the last: patchy, heaped here and there.
  const a = Math.max(0, rig.plateI[0]! - rig.plateW[0]! * 2);
  const b = Math.min(cut, rig.plateI[rig.plateN - 1]! + rig.plateW[rig.plateN - 1]! * 2.5);
  if (b <= a + 0.5) return;
  const steps = 22;
  for (let q = 0; q <= steps; q++) {
    rig.spineAt(a + ((b - a) * q) / steps, sA);
    const o = sA.back * (1 + 0.12 * drift(q, steps) * amount);
    if (q === 0) ctx.moveTo(sA.x + sA.nx * o, sA.y + sA.ny * o);
    else ctx.lineTo(sA.x + sA.nx * o, sA.y + sA.ny * o);
  }
  for (let q = steps; q >= 0; q--) {
    rig.spineAt(a + ((b - a) * q) / steps, sA);
    const o = sA.back * (1 - 0.3 * drift(q, steps) * amount);
    ctx.lineTo(sA.x + sA.nx * o, sA.y + sA.ny * o);
  }
  ctx.closePath();
}

/** A point on the underside of a snow cap: plate vertex f (fractional: between two), `d` below it. */
function snowUnder(ctx: CanvasRenderingContext2D, f: number, d: number, nx: number, ny: number): void {
  const a = Math.floor(f);
  const t = f - a;
  const b = Math.min(6, a + 1);
  const x = pv[a * 2]! + (pv[b * 2]! - pv[a * 2]!) * t;
  const y = pv[a * 2 + 1]! + (pv[b * 2 + 1]! - pv[a * 2 + 1]!) * t;
  ctx.lineTo(x - nx * d, y - ny * d);
}

/** Drift depth 0..1 at step q of n: patches that thin out to nothing between heaps, tapered at the ends. */
function drift(q: number, n: number): number {
  const u = q / n;
  const d = 0.55 * Math.sin(q * 1.3 + 0.7) + 0.35 * Math.sin(q * 3.1 + 2.1) + 0.2;
  return (d > 0 ? d : 0) * Math.sin(Math.PI * u);
}

// ---------------------------------------------------------------------------------------------
// Tail club of rock
// ---------------------------------------------------------------------------------------------

/**
 * A mace-head of rock at the tail tip (tx, ty), pointing along (dx, dy): an irregular lump,
 * longer than it is wide, with a few jutting crags.
 */
export function rockClubPath(ctx: CanvasRenderingContext2D, rig: DragonRig, tx: number, ty: number, dx: number, dy: number, r: number): void {
  // Centered just past the tip, so the tail runs into it.
  const cx = tx + dx * r * 0.2;
  const cy = ty + dy * r * 0.2;
  const nx = -dy;
  const ny = dx;
  for (let v = 0; v < 9; v++) {
    const a = rig.clubA[v]!;
    const rr = r * rig.clubR2[v]!;
    const u = Math.cos(a) * rr * 1.3;
    const w = Math.sin(a) * rr * 0.85;
    const x = cx + dx * u + nx * w;
    const y = cy + dy * u + ny * w;
    if (v === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------------------------------------
// Wing-arms
// ---------------------------------------------------------------------------------------------

/**
 * A wing-arm's membrane: shoulder, elbow, wrist, scalloped between the finger tips, to its root
 * behind the hip. Torn (a boss): rips in the trailing edge and ragged holes, wound against the
 * membrane so a nonzero fill leaves them open (only once the wing is open enough to show them).
 */
export function armMembranePath(ctx: CanvasRenderingContext2D, rig: DragonRig, slot: number, dress: DressLayout | null, torn: number): void {
  const w = rig.armPose[slot]!;
  const p = w.pts;
  const F = rig.fingers;
  // Folded, the membrane is bunched taut between the fingers (no scallops): one solid wedge.
  const open = smooth01((rig.armLift[slot]! - 0.4) / 0.55);
  const sc = rig.wingScallop * (0.15 + 0.85 * open);
  const wx = p[4]!;
  const wy = p[5]!;
  ctx.moveTo(p[0]!, p[1]!);
  ctx.lineTo(p[2]!, p[3]!);
  ctx.lineTo(wx, wy);
  ctx.lineTo(p[6]!, p[7]!);
  const ragged = torn > 0.01 && dress !== null;
  for (let f = 0; f < F; f++) {
    const ax = p[6 + f * 2]!;
    const ay = p[7 + f * 2]!;
    const bx = p[8 + f * 2]!;
    const by = p[9 + f * 2]!;
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const s = f + 1 < F ? sc : sc * 0.6;
    const cx = mx + (wx - mx) * s;
    const cy = my + (wy - my) * s;
    const nd = ragged ? dress.notchD[slot * MAX_FINGERS + f]! * torn : 0;
    if (nd > 0.001) {
      const nt = dress!.notchT[slot * MAX_FINGERS + f]!;
      for (let i = 1; i <= 7; i++) {
        const t = i / 7;
        const u = 1 - t;
        let qx = u * u * ax + 2 * u * t * cx + t * t * bx;
        let qy = u * u * ay + 2 * u * t * cy + t * t * by;
        const d = Math.abs(t - nt);
        if (d < 0.16) {
          const k = (1 - d / 0.16) * nd;
          qx += (wx - qx) * k;
          qy += (wy - qy) * k;
        }
        ctx.lineTo(qx, qy);
      }
    } else ctx.quadraticCurveTo(cx, cy, bx, by);
  }
  ctx.closePath();
  if (!ragged) return;
  const hopen = smooth01((rig.armLift[slot]! - 0.3) / 0.5);
  if (hopen < 0.02) return;
  const n = dress.holeN[slot]!;
  for (let h = 0; h < n; h++) {
    const i = slot * MAX_HOLES + h;
    const g = Math.min(F - 1, dress.holeG[i]!);
    const ax = p[6 + g * 2]!;
    const ay = p[7 + g * 2]!;
    const bx = p[8 + g * 2]!;
    const by = p[9 + g * 2]!;
    const t = dress.holeT[i]!;
    const p1x = wx + (ax - wx) * t;
    const p1y = wy + (ay - wy) * t;
    const p2x = wx + (bx - wx) * t;
    const p2y = wy + (by - wy) * t;
    const u = dress.holeU[i]!;
    const cx = p1x + (p2x - p1x) * u;
    const cy = p1y + (p2y - p1y) * u;
    const gap = Math.sqrt((p2x - p1x) * (p2x - p1x) + (p2y - p1y) * (p2y - p1y));
    const rad = gap * dress.holeR[i]! * hopen * torn;
    if (rad < 1e-5) continue;
    // Wind against this part of the membrane (the fan triangle wrist -> a -> b).
    const cross = (ax - wx) * (by - wy) - (ay - wy) * (bx - wx);
    const dir = cross > 0 ? -1 : 1;
    const rot = dress.holeRot[i]!;
    for (let k = 0; k < 6; k++) {
      const a = rot + dir * k * (TAU / 6);
      const rr = rad * dress.holeK[i * 6 + k]!;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

/**
 * A wing-arm's bones: a heavy humerus and forearm, a craggy spur jutting from the elbow, the finger
 * bones out to the tips (dark over the lighter membrane), the knuckle it walks on and a hooked thumb.
 */
export function armBonesPath(ctx: CanvasRenderingContext2D, rig: DragonRig, slot: number): void {
  const k = slot === 0 ? LEG_FN : LEG_FF;
  const r = rig.legR[k]!;
  const sx = rig.hipX[k]!;
  const sy = rig.hipY[k]!;
  const ex = rig.kneeX[k]!;
  const ey = rig.kneeY[k]!;
  const wx = rig.ankX[k]!;
  const wy = rig.ankY[k]!;
  capsule(ctx, sx, sy, r * 1.55, ex, ey, r * 0.95);
  capsule(ctx, ex, ey, r * 0.95, wx, wy, r * 0.62);
  // Elbow spur: out of the joint, away from both bones.
  let ux = sx - ex;
  let uy = sy - ey;
  let l = Math.sqrt(ux * ux + uy * uy) || 1;
  ux /= l;
  uy /= l;
  let vx = wx - ex;
  let vy = wy - ey;
  l = Math.sqrt(vx * vx + vy * vy) || 1;
  vx /= l;
  vy /= l;
  let ox = -(ux + vx);
  let oy = -(uy + vy);
  l = Math.sqrt(ox * ox + oy * oy);
  if (l < 1e-4) {
    ox = 0;
    oy = -1;
  } else {
    ox /= l;
    oy /= l;
  }
  const sl = r * 2.3;
  ctx.moveTo(ex - oy * r * 0.8, ey + ox * r * 0.8);
  ctx.lineTo(ex + ox * sl + oy * r * 0.5, ey + oy * sl - ox * r * 0.5);
  ctx.lineTo(ex + oy * r * 0.8, ey - ox * r * 0.8);
  ctx.closePath();
  // Finger bones.
  const p = rig.armPose[slot]!.pts;
  const F = rig.fingers;
  let mx = 0;
  let my = 0;
  for (let f = 0; f < F; f++) {
    const tx = p[6 + f * 2]!;
    const ty = p[7 + f * 2]!;
    capsule(ctx, wx, wy, r * 0.42, tx, ty, r * 0.1);
    mx += tx - wx;
    my += ty - wy;
  }
  // The knuckle it walks on, and a hooked thumb pointing away from the fingers.
  ctx.moveTo(wx + r * 0.78, wy);
  ctx.arc(wx, wy, r * 0.78, 0, TAU);
  l = Math.sqrt(mx * mx + my * my) || 1;
  const lift = rig.armLift[slot]!;
  let cx = -1 + (-mx / l + 1) * lift;
  let cy = 0.1 + (-my / l - 0.1) * lift;
  l = Math.sqrt(cx * cx + cy * cy) || 1;
  cx /= l;
  cy /= l;
  const cl = r * 2.3;
  ctx.moveTo(wx - cy * r * 0.55, wy + cx * r * 0.55);
  ctx.quadraticCurveTo(wx + cx * cl * 0.9 - cy * r * 0.6, wy + cy * cl * 0.9 + cx * r * 0.6, wx + cx * cl + cy * r * 0.2, wy + cy * cl - cx * r * 0.2);
  ctx.lineTo(wx + cy * r * 0.5, wy - cx * r * 0.5);
  ctx.closePath();
}

// ---------------------------------------------------------------------------------------------
// Boss dressings
// ---------------------------------------------------------------------------------------------

/** Moss and lichen tufts heaped along the crest (the Elder Newt): lumpy clumps of three lobes. */
export function mossPath(ctx: CanvasRenderingContext2D, rig: DragonRig, dress: DressLayout): void {
  const cut = cutAt(rig);
  for (let k = 0; k < dress.mossN; k++) {
    const f = dress.mossI[k]!;
    if (f >= cut) continue;
    rig.spineAt(f, sA);
    const r = dress.mossR[k]!;
    const ch = rig.crestHeightAt(Math.round(f)) * 0.55;
    const bx = sA.x + sA.nx * (sA.back + ch * 0.5);
    const by = sA.y + sA.ny * (sA.back + ch * 0.5);
    const tx = -sA.ny;
    const ty = sA.nx;
    const ph = dress.mossL[k]!;
    // A low, lumpy cushion: flattened lobes along the back.
    for (let q = -2; q <= 2; q++) {
      const rr = r * (0.6 + 0.4 * Math.sin(ph + q * 2.1)) * (q === 0 ? 1.15 : q === 2 || q === -2 ? 0.6 : 0.85);
      const x = bx + tx * q * r * 0.7 + sA.nx * rr * 0.2;
      const y = by + ty * q * r * 0.7 + sA.ny * rr * 0.2;
      ctx.moveTo(x + rr, y);
      ctx.ellipse(x, y, rr, rr * 0.72, Math.atan2(ty, tx), 0, TAU);
    }
  }
}

/**
 * Lichen beard strands hanging from under the jaw (head units, in the head frame). `c, s` rotate
 * with the lower jaw about the hinge (hx, hy).
 */
export function beardPath(ctx: CanvasRenderingContext2D, hs: HeadShape, dress: DressLayout, jaw: number, time: number, droop: number, c: number, s: number): void {
  const hx = hs.hingeX;
  const hy = hs.hingeY;
  for (let k = 0; k < dress.beardN; k++) {
    // Root along the underside of the jaw (x from the hinge toward the chin).
    const rx0 = hx + (hs.chinX - hx) * dress.beardX[k]!;
    const ry0 = MOUTH_Y + jaw * 0.75;
    const px = rx0 - hx;
    const py = ry0 - hy;
    const rx = hx + px * c - py * s;
    const ry = hy + px * s + py * c;
    const len = dress.beardLen[k]! * 1.25 * (1 + 0.3 * droop);
    const sway = 0.07 * Math.sin(time * 1.1 + dress.beardPh[k]!);
    // Hangs down (head frame: +y is down), trailing back, with a lazy kink.
    const mx = rx + 0.02 - sway * 0.6;
    const my = ry + len * 0.5;
    const ex = rx + 0.12 + sway;
    const ey = ry + len;
    const w = 0.012;
    ctx.moveTo(rx - w * 1.6, ry);
    ctx.quadraticCurveTo(mx - w, my, ex, ey);
    ctx.quadraticCurveTo(mx + w, my, rx + w * 1.6, ry);
    ctx.closePath();
  }
}

/** Old claw scars across the flank and neck (stroked by the caller). */
export function scarsPath(ctx: CanvasRenderingContext2D, rig: DragonRig, dress: DressLayout): void {
  const cut = cutAt(rig);
  for (let k = 0; k < dress.scarN; k++) {
    rig.spineAtBody(dress.scarAt[k]!, sA);
    if (rig.iS + dress.scarAt[k]! * 8 >= cut) continue;
    const side = dress.scarSide[k]!;
    const o = (side >= 0 ? side * sA.back : side * sA.belly) * 0.75;
    const px = sA.x + sA.nx * o;
    const py = sA.y + sA.ny * o;
    // Direction: the body tangent turned by the scar's angle.
    const base = Math.atan2(sA.nx, -sA.ny) + dress.scarAng[k]!;
    const dx = Math.cos(base);
    const dy = Math.sin(base);
    const len = dress.scarLen[k]!;
    const lines = dress.scarLines[k]!;
    const gap = len * 0.28;
    for (let q = 0; q < lines; q++) {
      const off = (q - (lines - 1) * 0.5) * gap;
      const cx = px - dy * off;
      const cy = py + dx * off;
      const l = len * (q === 1 ? 1 : 0.8);
      ctx.moveTo(cx - dx * l * 0.5, cy - dy * l * 0.5);
      ctx.quadraticCurveTo(cx - dy * l * 0.08, cy + dx * l * 0.08, cx + dx * l * 0.5, cy + dy * l * 0.5);
    }
  }
}

/** A scar across the brow and eye (head units, in the head frame; stroked). */
export function faceScarPath(ctx: CanvasRenderingContext2D, hs: HeadShape): void {
  const x = hs.eyeX;
  const y = hs.eyeY;
  const r = Math.max(hs.eyeR, 0.06);
  ctx.moveTo(x + r * 1.6, y - r * 2.6);
  ctx.quadraticCurveTo(x + r * 0.4, y - r * 0.4, x - r * 1.3, y + r * 2.1);
}
